// --- Toggle mock data on/off ---
// Set to false to use real backend
export const USE_MOCK = true;

// backend url http://20.251.144.64:8000/health
export const API = "http://20.251.144.64:8000";

export const COLOR_CLASSES = [
  "text-sky-400",
  "text-rose-400",
  "text-emerald-400",
  "text-amber-400",
  "text-violet-400",
  "text-cyan-400",
  "text-orange-400",
  "text-pink-400",
];

export const BG_CLASSES = [
  "bg-sky-400/10 border-sky-400/20",
  "bg-rose-400/10 border-rose-400/20",
  "bg-emerald-400/10 border-emerald-400/20",
  "bg-amber-400/10 border-amber-400/20",
  "bg-violet-400/10 border-violet-400/20",
  "bg-cyan-400/10 border-cyan-400/20",
  "bg-orange-400/10 border-orange-400/20",
  "bg-pink-400/10 border-pink-400/20",
];

const speakerColorMap: Record<string, number> = {};
let colorIndex = 0;

export function getSpeakerColor(speaker: string): string {
  if (!(speaker in speakerColorMap)) {
    speakerColorMap[speaker] = colorIndex % COLOR_CLASSES.length;
    colorIndex++;
  }
  return COLOR_CLASSES[speakerColorMap[speaker]];
}

export function getSpeakerBg(speaker: string): string {
  if (!(speaker in speakerColorMap)) {
    speakerColorMap[speaker] = colorIndex % BG_CLASSES.length;
    colorIndex++;
  }
  return BG_CLASSES[speakerColorMap[speaker]];
}

export const LANGUAGES = [
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
