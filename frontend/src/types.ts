export interface SpeakerVoice {
  id: number;
  label: string;
}

export interface Speaker {
  id: number;
  name: string;
  created_at: string;
  voices: SpeakerVoice[];
}

export interface SessionInfo {
  id: number;
  name: string;
  created_at: string;
  language?: string;
  max_speakers?: number;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface GroupedSegment {
  speaker: string;
  texts: string[];
  start: number;
  end: number;
}

export interface AudioProcessor {
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
}

export type Status = "idle" | "recording" | "processing" | "done" | "error";
export type Mode = "mic" | "file";
export type View = "speakers" | "sessions" | "transcribe";