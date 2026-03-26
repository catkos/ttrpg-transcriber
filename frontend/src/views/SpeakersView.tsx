import { useState, useRef, useEffect, ChangeEvent } from "react";
import type { Speaker } from "../types";
import { API, USE_MOCK, getSpeakerColor } from "../constants";
import { MOCK_SPEAKERS } from "../mockData";

export default function SpeakersView() {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [newName, setNewName] = useState("");
  const [enrollingName, setEnrollingName] = useState<string | null>(null);
  const [enrollLabel, setEnrollLabel] = useState("normal");
  const [isRecordingEnroll, setIsRecordingEnroll] = useState(false);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioProcessorRef = useRef<{
    audioContext: AudioContext;
    processor: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
  } | null>(null);
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
      <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Speaker Profiles</h2>

      {/* Add speaker */}
      <div className="flex gap-2">
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

      {/* Speaker list */}
      {speakers.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-8">No speakers yet — add one above</p>
      ) : (
        <div className="space-y-3">
          {speakers.map((spk) => (
            <div key={spk.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">

              {/* Header */}
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
                  onChange={(e) => { if (enrollingName === spk.name) setEnrollLabel(e.target.value); }}
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
  );
}
