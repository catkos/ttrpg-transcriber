// mockData.ts
// To use mock data: import from this file in App.tsx (already set up)
// To use real backend: comment out the mock imports in App.tsx

export const MOCK_SPEAKERS = [
  {
    id: 1,
    name: "Game Master",
    created_at: "2024-01-01T00:00:00",
    voices: [
      { id: 1, label: "normal" },
    ],
  },
  {
    id: 2,
    name: "Steve",
    created_at: "2024-01-01T00:00:00",
    voices: [
      { id: 2, label: "normal" },
      { id: 3, label: "goblin" },
      { id: 4, label: "wizard" },
    ],
  },
  {
    id: 3,
    name: "Alice",
    created_at: "2024-01-01T00:00:00",
    voices: [
      { id: 5, label: "normal" },
      { id: 6, label: "elf" },
    ],
  },
  {
    id: 4,
    name: "Bob",
    created_at: "2024-01-01T00:00:00",
    voices: [],
  },
];

export const MOCK_SESSIONS = [
  { id: 1, name: "Session 1 - The Dark Forest", created_at: "2024-01-01T00:00:00" },
  { id: 2, name: "Session 2 - The Goblin King", created_at: "2024-01-08T00:00:00" },
  { id: 3, name: "Session 3 - The Dragon's Lair", created_at: "2024-01-15T00:00:00" },
];

export const MOCK_TRANSCRIPT = [
  { speaker: "Game Master", text: "You enter the dark forest. The trees loom overhead, their branches twisted like grasping fingers.", start: 0.0, end: 4.2 },
  { speaker: "Steve", text: "I draw my sword and look around cautiously.", start: 4.5, end: 7.1 },
  { speaker: "Alice", text: "I cast detect magic and scan the area.", start: 7.3, end: 10.0 },
  { speaker: "Game Master", text: "Alice, you sense a faint magical aura coming from the north. It feels ancient, and somewhat sinister.", start: 10.2, end: 15.8 },
  { speaker: "Bob", text: "I check for tracks on the ground.", start: 16.0, end: 18.3 },
  { speaker: "Game Master", text: "Roll perception, Bob.", start: 18.5, end: 20.1 },
  { speaker: "Bob", text: "I got a 17!", start: 20.3, end: 21.5 },
  { speaker: "Game Master", text: "You find large footprints — something big came through here recently. Heading north.", start: 21.8, end: 26.4 },
  { speaker: "Steve", text: "Let's follow them. I move north slowly, keeping to the shadows.", start: 26.6, end: 30.2 },
  { speaker: "Alice", text: "Wait — I want to memorize a protection spell first.", start: 30.5, end: 33.8 },
  { speaker: "Game Master", text: "As you prepare, you hear a low growl from the darkness ahead.", start: 34.0, end: 38.1 },
  { speaker: "unknown", text: "Greetings, small ones. You dare enter MY forest?", start: 38.5, end: 42.0 },
  { speaker: "Steve", text: "Who goes there? Show yourself!", start: 42.3, end: 44.5 },
  { speaker: "Game Master", text: "A massive troll steps out from behind an ancient oak, its eyes glowing a dim yellow.", start: 44.8, end: 50.2 },
  { speaker: "Bob", text: "I ready my bow.", start: 50.5, end: 52.0 },
  { speaker: "Alice", text: "I try to communicate with it. Do you speak Common?", start: 52.3, end: 55.6 },
];