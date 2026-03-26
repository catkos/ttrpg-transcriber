import { useState, useEffect } from "react";
import type { SessionInfo } from "../types";
import { API, USE_MOCK, LANGUAGES } from "../constants";
import { MOCK_SESSIONS } from "../mockData";

interface Props {
  onStartSession: (s: SessionInfo) => void;
}

export default function SessionsView({ onStartSession }: Props) {
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
    if (USE_MOCK) { // --- MOCK ---
      onStartSession({ id: 99, name: newName.trim(), created_at: new Date().toISOString(), language, max_speakers: maxSpeakers });
      return;
    }
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
            onKeyDown={(e) => e.key === "Enter" && createSession()}
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
