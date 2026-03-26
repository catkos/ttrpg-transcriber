import { useState, useRef, useEffect, ChangeEvent, useCallback } from "react";
import type { SessionInfo, TranscriptSegment, GroupedSegment, Status, Mode, AudioProcessor } from "../types";
import { API, USE_MOCK, getSpeakerColor, getSpeakerBg } from "../constants";
import { MOCK_TRANSCRIPT } from "../mockData";

interface Note {
  id: number;
  content: string;
  generated_at: string;
}

interface Props {
  session: SessionInfo | null;
}

export default function TranscribeView({ session }: Props) {
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mic");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [notes, setNotes] = useState<Note | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoNotesTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (!session) return;
    if (USE_MOCK) { setTranscript(MOCK_TRANSCRIPT); return; } // --- MOCK ---
    fetch(`${API}/sessions/${session.id}/transcripts`)
      .then((r) => r.json())
      .then((data) => setTranscript([...data].sort((a, b) => a.start - b.start)));

    // Load latest existing note
    fetch(`${API}/sessions/${session.id}/notes`)
      .then((r) => r.json())
      .then((data) => { if (data.length > 0) setNotes(data[0]); });
  }, [session]);

  const generateNotes = useCallback(async () => {
    if (!session || notesLoading) return;
    setNotesLoading(true);
    setNotesError(null);
    try {
      const res = await fetch(`${API}/sessions/${session.id}/notes/generate`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? "Failed to generate notes");
      }
      const note = await res.json();
      setNotes(note);
    } catch (e: unknown) {
      setNotesError(e instanceof Error ? e.message : "Failed to generate notes");
    } finally {
      setNotesLoading(false);
    }
  }, [session, notesLoading, transcript]);

  // Auto-generate notes every 3 minutes while recording
  useEffect(() => {
    if (isRecording && session && !USE_MOCK) {
      autoNotesTimerRef.current = setInterval(() => {
        generateNotes();
      }, 3 * 60 * 1000);
    } else {
      if (autoNotesTimerRef.current) {
        clearInterval(autoNotesTimerRef.current);
        autoNotesTimerRef.current = null;
      }
    }
    return () => {
      if (autoNotesTimerRef.current) clearInterval(autoNotesTimerRef.current);
    };
  }, [isRecording, session, generateNotes]);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">
        No active session — go to Sessions to start one
      </div>
    );
  }

  function setupWebSocket(): WebSocket {
    const ws = new WebSocket(`${API.replace("http", "ws")}/ws/${session!.id}`);
    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.done) { setStatus("done"); ws.close(); return; }
      if (data.error) { setError(data.error); setStatus("error"); return; }
      setTranscript((prev) => [...prev, data as TranscriptSegment].sort((a, b) => a.start - b.start));
    };
    ws.onerror = () => { setError("WebSocket connection failed."); setStatus("error"); };
    ws.onclose = () => setStatus((prev) => prev === "processing" ? "done" : prev);
    return ws;
  }

  async function startRecording() {
    setError(null);
    setStatus("recording");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ws = setupWebSocket();
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ language: session!.language ?? "en", max_speakers: session!.max_speakers ?? 5 }));
        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
          }
          ws.send(int16.buffer);
        };
        source.connect(processor);
        processor.connect(audioContext.destination);
        audioProcessorRef.current = { audioContext, processor, source };
      };
      setIsRecording(true);
    } catch {
      setError("Microphone access denied.");
      setStatus("error");
    }
  }

  function stopRecording() {
    setIsRecording(false);
    setStatus("processing");
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioProcessorRef.current) {
      const { audioContext, processor, source } = audioProcessorRef.current;
      source.disconnect(processor);
      processor.disconnect();
      audioContext.close();
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(new TextEncoder().encode("END"));
    }
  }

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setStatus("processing");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      await audioContext.close();
      const float32 = audioBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      const ws = setupWebSocket();
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ language: session!.language ?? "en", max_speakers: session!.max_speakers ?? 5 }));
        const CHUNK_SIZE = 160000;
        let offset = 0;
        while (offset < int16.buffer.byteLength) {
          ws.send(int16.buffer.slice(offset, offset + CHUNK_SIZE));
          offset += CHUNK_SIZE;
        }
        ws.send(new TextEncoder().encode("END"));
      };
    } catch {
      setError("Failed to decode audio file.");
      setStatus("error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const grouped = transcript.reduce<GroupedSegment[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === item.speaker) {
      last.texts.push(item.text);
      last.end = item.end;
    } else {
      acc.push({ speaker: item.speaker, texts: [item.text], start: item.start, end: item.end });
    }
    return acc;
  }, []);

  const isDisabled = isRecording || status === "processing";

  // Render notes content with basic markdown-like formatting
  function renderNotes(content: string) {
    return content.split("\n").map((line, i) => {
      if (line.startsWith("## ")) {
        return <p key={i} className="text-xs font-bold text-zinc-400 uppercase tracking-wider mt-4 mb-1 first:mt-0">{line.replace("## ", "")}</p>;
      }
      if (line.startsWith("- ")) {
        return <p key={i} className="text-xs text-zinc-300 leading-relaxed pl-2">· {line.replace("- ", "")}</p>;
      }
      if (line.trim() === "") return null;
      return <p key={i} className="text-xs text-zinc-400">{line}</p>;
    });
  }

  return (
    <div className="space-y-4">
      {/* Session info + status */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-zinc-200">{session.name}</p>
          <p className="text-xs text-zinc-600">{new Date(session.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {status === "recording" && <><span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" /><span className="text-rose-400">recording</span></>}
          {status === "processing" && <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /><span className="text-amber-400">processing</span></>}
          {status === "done" && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-emerald-400">done</span></>}
          {status === "idle" && <><span className="w-1.5 h-1.5 rounded-full bg-zinc-600" /><span className="text-zinc-500">idle</span></>}
          {status === "error" && <><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /><span className="text-rose-400">error</span></>}
        </div>
      </div>

      {/* Mode tabs + controls */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
          {(["mic", "file"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={isDisabled}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${mode === m ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"} disabled:opacity-40`}>
              {m === "mic" ? "🎙 Mic" : "📁 File"}
            </button>
          ))}
        </div>
        {mode === "mic" ? (
          !isRecording ? (
            <button onClick={startRecording} disabled={status === "processing"}
              className="flex items-center gap-2 px-4 py-2 bg-white text-zinc-900 text-xs font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Record
            </button>
          ) : (
            <button onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500 text-white text-xs font-bold rounded-md hover:bg-rose-600 transition-colors">
              <span className="w-2 h-2 rounded-sm bg-white animate-pulse" /> Stop
            </button>
          )
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => fileInputRef.current?.click()} disabled={isDisabled}
              className="px-4 py-2 bg-white text-zinc-900 text-xs font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40">
              Choose File
            </button>
            <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            {fileName && <span className="text-xs text-zinc-500 truncate max-w-32">{fileName}</span>}
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">{error}</div>
      )}

      {/* Side by side layout */}
      <div className="grid grid-cols-2 gap-4">

        {/* Transcript panel */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800">
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="ml-3 text-xs text-zinc-600">transcript</span>
            <span className="ml-auto text-xs text-zinc-600">{transcript.length} segments</span>
          </div>
          <div className="p-4 min-h-72 max-h-[520px] overflow-y-auto space-y-3">
            {grouped.length === 0 ? (
              <div className="flex items-center justify-center h-60 text-zinc-600 text-sm">
                {status === "processing" ? "waiting for results..." : "start recording to see transcript"}
              </div>
            ) : (
              grouped.map((group, i) => (
                <div key={i} className={`flex gap-3 p-3 rounded-lg border ${getSpeakerBg(group.speaker)}`}>
                  <div className="shrink-0 w-20">
                    <div className={`text-xs font-bold ${getSpeakerColor(group.speaker)}`}>{group.speaker}</div>
                    <div className="text-xs text-zinc-600 mt-0.5">{group.start.toFixed(1)}s</div>
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed">{group.texts.join(" ")}</p>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Notes panel */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800">
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="ml-3 text-xs text-zinc-600">session notes</span>
            <div className="ml-auto flex items-center gap-2">
              {notes && (
                <span className="text-xs text-zinc-600">
                  {new Date(notes.generated_at).toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={generateNotes}
                disabled={notesLoading || transcript.length === 0}
                className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-2 py-1 rounded transition-colors disabled:opacity-40"
              >
                {notesLoading ? "generating..." : "↻ refresh"}
              </button>
            </div>
          </div>
          <div className="p-4 min-h-72 max-h-[520px] overflow-y-auto">
            {notesError && (
              <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs mb-3">
                {notesError}
              </div>
            )}
            {notesLoading ? (
              <div className="flex items-center justify-center h-60 text-zinc-600 text-sm">
                asking ollama...
              </div>
            ) : notes ? (
              <div className="space-y-1">
                {renderNotes(notes.content)}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-60 gap-3 text-zinc-600 text-sm">
                <span>no notes yet</span>
                <button
                  onClick={generateNotes}
                  disabled={transcript.length === 0}
                  className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded transition-colors disabled:opacity-40"
                >
                  generate notes
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}