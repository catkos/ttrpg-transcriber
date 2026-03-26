import { useState, useRef, useEffect, ChangeEvent } from "react";

// --- Mock data (comment out the line below to use real backend) ---
import { MOCK_SPEAKERS, MOCK_SESSIONS, MOCK_TRANSCRIPT } from "./mockData";
const USE_MOCK = true; // set to false to use real backend

// --- Types ---
interface SpeakerVoice {
  id: number;
  label: string;
}

interface Speaker {
  id: number;
  name: string;
  created_at: string;
  voices: SpeakerVoice[];
}

interface SessionInfo {
  id: number;
  name: string;
  created_at: string;
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

interface GroupedSegment {
  speaker: string;
  texts: string[];
  start: number;
  end: number;
}

type Status = "idle" | "recording" | "processing" | "done" | "error";
type Mode = "mic" | "file";
type View = "speakers" | "sessions" | "transcribe";

interface AudioProcessor {
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
}

// --- Constants ---
const API = "http://localhost:8000";

const SPEAKER_COLORS: Record<string, string> = {};
const COLOR_CLASSES = [
  "text-sky-400", "text-rose-400", "text-emerald-400", "text-amber-400",
  "text-violet-400", "text-cyan-400", "text-orange-400", "text-pink-400",
];
const BG_CLASSES = [
  "bg-sky-400/10 border-sky-400/20",
  "bg-rose-400/10 border-rose-400/20",
  "bg-emerald-400/10 border-emerald-400/20",
  "bg-amber-400/10 border-amber-400/20",
  "bg-violet-400/10 border-violet-400/20",
  "bg-cyan-400/10 border-cyan-400/20",
  "bg-orange-400/10 border-orange-400/20",
  "bg-pink-400/10 border-pink-400/20",
];

let colorIndex = 0;
function getSpeakerColor(speaker: string): string {
  if (!SPEAKER_COLORS[speaker]) {
    SPEAKER_COLORS[speaker] = COLOR_CLASSES[colorIndex % COLOR_CLASSES.length];
    colorIndex++;
  }
  return SPEAKER_COLORS[speaker];
}
function getSpeakerBg(speaker: string): string {
  const idx = COLOR_CLASSES.indexOf(getSpeakerColor(speaker));
  return BG_CLASSES[idx] ?? BG_CLASSES[0];
}

const LANGUAGES = [
  { code: "en", label: "English" }, { code: "fi", label: "Finnish" },
  { code: "sv", label: "Swedish" }, { code: "de", label: "German" },
  { code: "fr", label: "French" }, { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" }, { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" }, { code: "ru", label: "Russian" },
  { code: "pt", label: "Portuguese" }, { code: "nl", label: "Dutch" },
  { code: "ko", label: "Korean" }, { code: "ar", label: "Arabic" },
];

// --- Main App ---
export default function App() {
  const [view, setView] = useState<View>("speakers");
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">🎲 ttrpg scribe</h1>
            <p className="text-zinc-500 text-xs mt-0.5">live transcription · speaker diarization</p>
          </div>

          {/* Nav */}
          <div className="flex gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            {(["speakers", "sessions", "transcribe"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  view === v ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {v === "speakers" ? "👤 Speakers" : v === "sessions" ? "📋 Sessions" : "🎙 Transcribe"}
              </button>
            ))}
          </div>
        </div>

        {/* Views */}
        {view === "speakers" && <SpeakersView />}
        {view === "sessions" && (
          <SessionsView
            onStartSession={(s) => { setActiveSession(s); setView("transcribe"); }}
          />
        )}
        {view === "transcribe" && (
          <TranscribeView session={activeSession} />
        )}
      </div>
    </div>
  );
}

// --- Speakers View ---
function SpeakersView() {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [newName, setNewName] = useState("");
  const [enrollingName, setEnrollingName] = useState<string | null>(null);
  const [enrollMode, setEnrollMode] = useState<"mic" | "file" | null>(null);
  const [enrollLabel, setEnrollLabel] = useState("normal");
  const [isRecordingEnroll, setIsRecordingEnroll] = useState(false);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioProcessorRef = useRef<{ audioContext: AudioContext; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { fetchSpeakers(); }, []);

  async function fetchSpeakers() {
    if (USE_MOCK) { setSpeakers(MOCK_SPEAKERS); return; } // --- MOCK ---
    const res = await fetch(`${API}/speakers`);
    setSpeakers(await res.json());
  }

  async function createSpeaker() {
    if (!newName.trim()) return;
    await fetch(`${API}/speakers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName("");
    fetchSpeakers();
  }

  async function deleteSpeaker(name: string) {
    await fetch(`${API}/speakers/${name}`, { method: "DELETE" });
    fetchSpeakers();
  }

  async function deleteVoice(speakerName: string, voiceId: number) {
    await fetch(`${API}/speakers/${speakerName}/voices/${voiceId}`, { method: "DELETE" });
    fetchSpeakers();
  }

  async function startEnrollMic(name: string, label: string) {
    setEnrollingName(name);
    setEnrollMode("mic");
    setEnrollStatus("Recording... speak for 10-15 seconds then stop.");
    setIsRecordingEnroll(true);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1 },
    });
    streamRef.current = stream;

    const ws = new WebSocket(`ws://localhost:8000/ws/enroll/${name}/${label}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.success) {
        setEnrollStatus(`✓ Voice '${label}' enrolled for ${name}`);
        setIsRecordingEnroll(false);
        fetchSpeakers();
      } else if (data.error) {
        setEnrollStatus(`Error: ${data.error}`);
        setIsRecordingEnroll(false);
      }
    };

    ws.onopen = () => {
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
  }

  function stopEnrollMic() {
    setIsRecordingEnroll(false);
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
    setEnrollStatus("Processing enrollment...");
  }

  async function handleEnrollFile(e: ChangeEvent<HTMLInputElement>, name: string, label: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEnrollStatus("Uploading...");

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API}/speakers/${name}/enroll/upload?label=${encodeURIComponent(label)}`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (res.ok) {
      setEnrollStatus(`✓ Voice '${label}' enrolled for ${name}`);
      fetchSpeakers();
    } else {
      setEnrollStatus(`Error: ${data.detail}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">Speaker Profiles</h2>

        {/* Add speaker */}
        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createSpeaker()}
            placeholder="Speaker name..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={createSpeaker}
            className="px-4 py-2 bg-white text-zinc-900 text-sm font-bold rounded-md hover:bg-zinc-200 transition-colors"
          >
            Add
          </button>
        </div>

        {speakers.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center py-8">No speakers yet — add one above</p>
        ) : (
          <div className="space-y-3">
            {speakers.map((spk) => (
              <div key={spk.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                {/* Speaker header */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`font-bold text-sm ${getSpeakerColor(spk.name)}`}>{spk.name}</span>
                  <button
                    onClick={() => deleteSpeaker(spk.name)}
                    className="text-xs text-rose-500 hover:text-rose-400 border border-rose-500/30 px-2 py-1 rounded transition-colors"
                  >
                    Delete speaker
                  </button>
                </div>

                {/* Existing voices */}
                {spk.voices.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {spk.voices.map((v) => (
                      <div key={v.id} className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-3 py-1">
                        <span className="text-xs text-zinc-300">{v.label}</span>
                        <button
                          onClick={() => deleteVoice(spk.name, v.id)}
                          className="text-zinc-600 hover:text-rose-400 text-xs leading-none"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add voice */}
                <div className="flex items-center gap-2">
                  <input
                    placeholder="Voice label (e.g. normal, goblin...)"
                    defaultValue="normal"
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    onChange={(e) => {
                      if (enrollingName === spk.name) setEnrollLabel(e.target.value);
                    }}
                    onFocus={() => { setEnrollingName(spk.name); setEnrollLabel("normal"); }}
                  />
                  {isRecordingEnroll && enrollingName === spk.name ? (
                    <button
                      onClick={stopEnrollMic}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 text-white text-xs font-bold rounded-md"
                    >
                      <span className="w-1.5 h-1.5 rounded-sm bg-white animate-pulse" /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => startEnrollMic(spk.name, enrollLabel)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold rounded-md transition-colors"
                    >
                      🎙 Record
                    </button>
                  )}
                  <button
                    onClick={() => { setEnrollingName(spk.name); fileInputRef.current?.click(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold rounded-md transition-colors"
                  >
                    📁 Upload
                  </button>
                </div>

                {enrollingName === spk.name && enrollStatus && (
                  <p className="text-xs text-zinc-400 mt-2">{enrollStatus}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => enrollingName && handleEnrollFile(e, enrollingName, enrollLabel)}
        />
      </div>
    </div>
  );
}

// --- Sessions View ---
function SessionsView({ onStartSession }: { onStartSession: (s: SessionInfo) => void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [language, setLanguage] = useState("en");
  const [maxSpeakers, setMaxSpeakers] = useState(5);

  useEffect(() => { fetchSessions(); }, []);

  async function fetchSessions() {
    if (USE_MOCK) { setSessions(MOCK_SESSIONS); return; } // --- MOCK ---
    const res = await fetch(`${API}/sessions`);
    setSessions(await res.json());
  }

  async function createSession() {
    if (!newName.trim()) return;
    const res = await fetch(`${API}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), language, max_speakers: maxSpeakers }),
    });
    const session = await res.json();
    setNewName("");
    fetchSessions();
    onStartSession(session);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">New Session</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Session name (e.g. Session 12 - The Dark Forest)..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-md px-3 py-1.5 focus:outline-none"
              >
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">Max speakers</label>
              <select
                value={maxSpeakers}
                onChange={(e) => setMaxSpeakers(parseInt(e.target.value))}
                className="bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-md px-3 py-1.5 focus:outline-none"
              >
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <button
            onClick={createSession}
            disabled={!newName.trim()}
            className="w-full py-2 bg-white text-zinc-900 text-sm font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Session →
          </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">Past Sessions</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-zinc-200">{s.name}</p>
                  <p className="text-xs text-zinc-600">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={() => onStartSession(s)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded transition-colors"
                >
                  Resume →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Transcribe View ---
function TranscribeView({ session }: { session: SessionInfo | null }) {
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mic");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Load existing transcripts if resuming session
  useEffect(() => {
    if (!session) return;
    if (USE_MOCK) { setTranscript(MOCK_TRANSCRIPT); return; } // --- MOCK ---
    fetch(`${API}/sessions/${session.id}/transcripts`)
      .then((r) => r.json())
      .then((data) => setTranscript([...data].sort((a, b) => a.start - b.start)));
  }, [session]);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">
        No active session — go to Sessions to start one
      </div>
    );
  }

  function setupWebSocket(): WebSocket {
    const ws = new WebSocket(`ws://localhost:8000/ws/${session!.id}`);

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
        ws.send(JSON.stringify({ language: session!.language, max_speakers: session!.max_speakers }));
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
        ws.send(JSON.stringify({ language: session!.language, max_speakers: session!.max_speakers }));
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

  return (
    <div className="space-y-4">
      {/* Session info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-zinc-200">{session.name}</p>
          <p className="text-xs text-zinc-600">{new Date(session.created_at).toLocaleDateString()}</p>
        </div>

        {/* Status */}
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
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={isDisabled}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                mode === m ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
              } disabled:opacity-40`}
            >
              {m === "mic" ? "🎙 Mic" : "📁 File"}
            </button>
          ))}
        </div>

        {mode === "mic" ? (
          !isRecording ? (
            <button
              onClick={startRecording}
              disabled={status === "processing"}
              className="flex items-center gap-2 px-4 py-2 bg-white text-zinc-900 text-xs font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40"
            >
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Record
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500 text-white text-xs font-bold rounded-md hover:bg-rose-600 transition-colors"
            >
              <span className="w-2 h-2 rounded-sm bg-white animate-pulse" /> Stop
            </button>
          )
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isDisabled}
              className="px-4 py-2 bg-white text-zinc-900 text-xs font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40"
            >
              Choose File
            </button>
            <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            {fileName && <span className="text-xs text-zinc-500 truncate max-w-32">{fileName}</span>}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* Transcript */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800">
          <span className="w-3 h-3 rounded-full bg-zinc-700" />
          <span className="w-3 h-3 rounded-full bg-zinc-700" />
          <span className="w-3 h-3 rounded-full bg-zinc-700" />
          <span className="ml-3 text-xs text-zinc-600">transcript · {session.name}</span>
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
                <div className="shrink-0 w-24">
                  <div className={`text-xs font-bold ${getSpeakerColor(group.speaker)}`}>
                    {group.speaker}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">{group.start.toFixed(1)}s</div>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed">{group.texts.join(" ")}</p>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}