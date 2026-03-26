import { useState } from "react";
import type { SessionInfo, View } from "./types";
import SpeakersView from "./views/SpeakersView";
import SessionsView from "./views/SessionsView";
import TranscribeView from "./views/TranscribeView";

export default function App() {
  const [view, setView] = useState<View>("speakers");
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-dragon">
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold uppercase">🎲 ttrpg scribe</h1>
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
