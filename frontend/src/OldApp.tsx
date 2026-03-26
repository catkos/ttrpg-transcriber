import { useState, useRef, useEffect, ChangeEvent } from "react";

const SPEAKER_COLORS = [
  "text-sky-400",
  "text-rose-400",
  "text-emerald-400",
  "text-amber-400",
  "text-violet-400",
  "text-cyan-400",
  "text-orange-400",
  "text-pink-400",
];

const SPEAKER_BG_COLORS = [
  "bg-sky-400/10 border-sky-400/20",
  "bg-rose-400/10 border-rose-400/20",
  "bg-emerald-400/10 border-emerald-400/20",
  "bg-amber-400/10 border-amber-400/20",
  "bg-violet-400/10 border-violet-400/20",
  "bg-cyan-400/10 border-cyan-400/20",
  "bg-orange-400/10 border-orange-400/20",
  "bg-pink-400/10 border-pink-400/20",
];

function getSpeakerIndex(speaker: string): number {
  return parseInt(speaker.replace("SPEAKER_", "")) % SPEAKER_COLORS.length;
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

interface GroupedSegment {
  speaker: string;
  texts: string[];
  start: number;
  end: number;
}

type Status = "idle" | "recording" | "processing" | "done" | "error";
type Mode = "mic" | "file";

interface AudioProcessor {
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fi", label: "Finnish" },
  { code: "sv", label: "Swedish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("mic");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [language, setLanguage] = useState("en");
  const [numSpeakers, setNumSpeakers] = useState(2);

  const wsRef = useRef<WebSocket | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  function setupWebSocket(): WebSocket {
    const ws = new WebSocket("ws://localhost:8000/ws");

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string);
      if (data.done) {
        setStatus("done");
        ws.close();
        return;
      }
      if (data.error) {
        setError(data.error as string);
        setStatus("error");
        return;
      }
      setTranscript((prev) => [...prev, data as TranscriptSegment]);
    };

    ws.onerror = () => {
      setError("WebSocket connection failed. Is the backend running?");
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus((prev) => (prev === "processing" ? "done" : prev));
    };

    return ws;
  }

  async function startRecording(): Promise<void> {
    setError(null);
    setTranscript([]);
    setStatus("recording");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const ws = setupWebSocket();
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ language, num_speakers: numSpeakers }));

        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
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
      setError("Microphone access denied or not available.");
      setStatus("error");
    }
  }

  function stopRecording(): void {
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

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setTranscript([]);
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
        ws.send(JSON.stringify({ language, num_speakers: numSpeakers }));
        const CHUNK_SIZE = 160000;
        const rawBytes = int16.buffer;
        let offset = 0;
        while (offset < rawBytes.byteLength) {
          ws.send(rawBytes.slice(offset, offset + CHUNK_SIZE));
          offset += CHUNK_SIZE;
        }
        ws.send(new TextEncoder().encode("END"));
      };
    } catch {
      setError("Failed to decode audio file. Make sure it's a valid audio file.");
      setStatus("error");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearTranscript(): void {
    setTranscript([]);
    setStatus("idle");
    setError(null);
    setFileName(null);
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-widest">v0.1</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            🎙 transcriber
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Multi-speaker diarization · Whisper + pyannote
          </p>
        </div>

        {/* Config row */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isDisabled}
              className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Speakers</label>
            <select
              value={numSpeakers}
              onChange={(e) => setNumSpeakers(parseInt(e.target.value))}
              disabled={isDisabled}
              className="bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4 bg-zinc-900 p-1 rounded-lg w-fit border border-zinc-800">
          {(["mic", "file"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); clearTranscript(); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === m
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m === "mic" ? "🎙 Mic" : "📁 File"}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6">
          {mode === "mic" ? (
            !isRecording ? (
              <button
                onClick={startRecording}
                disabled={status === "processing"}
                className="flex items-center gap-2 px-5 py-2 bg-white text-zinc-900 text-sm font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                Record
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-5 py-2 bg-rose-500 text-white text-sm font-bold rounded-md hover:bg-rose-600 transition-colors"
              >
                <span className="w-2 h-2 rounded-sm bg-white inline-block animate-pulse" />
                Stop
              </button>
            )
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={status === "processing"}
                className="px-5 py-2 bg-white text-zinc-900 text-sm font-bold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Choose File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              {fileName && (
                <span className="text-xs text-zinc-400 truncate max-w-48">{fileName}</span>
              )}
            </div>
          )}

          {transcript.length > 0 && (
            <button
              onClick={clearTranscript}
              className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-md transition-colors"
            >
              Clear
            </button>
          )}

          {/* Status indicator */}
          <div className="ml-auto flex items-center gap-2 text-xs">
            {status === "recording" && (
              <><span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" /><span className="text-rose-400">recording</span></>
            )}
            {status === "processing" && (
              <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /><span className="text-amber-400">processing</span></>
            )}
            {status === "done" && (
              <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-emerald-400">done</span></>
            )}
            {status === "idle" && (
              <><span className="w-1.5 h-1.5 rounded-full bg-zinc-600" /><span className="text-zinc-500">idle</span></>
            )}
            {status === "error" && (
              <><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /><span className="text-rose-400">error</span></>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* Transcript */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Terminal header bar */}
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="w-3 h-3 rounded-full bg-zinc-700" />
            <span className="ml-3 text-xs text-zinc-600">transcript</span>
          </div>

          <div className="p-4 min-h-72 max-h-[480px] overflow-y-auto space-y-3">
            {grouped.length === 0 ? (
              <div className="flex items-center justify-center h-60 text-zinc-600 text-sm">
                {status === "processing"
                  ? "waiting for results..."
                  : "transcript will appear here"}
              </div>
            ) : (
              grouped.map((group, i) => {
                const idx = getSpeakerIndex(group.speaker);
                return (
                  <div key={i} className={`flex gap-3 p-3 rounded-lg border ${SPEAKER_BG_COLORS[idx]}`}>
                    <div className="shrink-0 w-24">
                      <div className={`text-xs font-bold ${SPEAKER_COLORS[idx]}`}>
                        {group.speaker.replace("SPEAKER_", "spk_")}
                      </div>
                      <div className="text-xs text-zinc-600 mt-0.5">
                        {group.start.toFixed(1)}s
                      </div>
                    </div>
                    <p className="text-sm text-zinc-200 leading-relaxed">
                      {group.texts.join(" ")}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>

      </div>
    </div>
  );
}