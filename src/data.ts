import { Mood, Song } from "./types";

export const moods: Mood[] = [
  {
    id: "energized",
    label: "Energizado",
    description: "Quero ganhar energia e disposição",
    energy: 0.88,
    valence: 0.82,
  },
  {
    id: "calm",
    label: "Calmo",
    description: "Quero desacelerar e respirar",
    energy: 0.28,
    valence: 0.55,
  },
  {
    id: "romantic",
    label: "Romântico",
    description: "Quero um clima especial",
    energy: 0.45,
    valence: 0.72,
  },
  {
    id: "light",
    label: "Leve",
    description: "Quero ficar bem e tranquilo",
    energy: 0.52,
    valence: 0.68,
  },
];

const covers = [
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=500&q=80",
  "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=500&q=80",
  "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=500&q=80",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=500&q=80",
  "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=500&q=80",
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=500&q=80",
];

export const songs: Song[] = [
  { id: "local-1", title: "Golden Hour", artist: "JVKE", bpm: 94, valence: .82, energy: .65, moods: ["light","romantic"], cover: covers[0] },
  { id: "local-2", title: "Levitating", artist: "Dua Lipa", bpm: 103, valence: .91, energy: .86, moods: ["energized","light"], cover: covers[1] },
  { id: "local-3", title: "Good as Hell", artist: "Lizzo", bpm: 96, valence: .9, energy: .82, moods: ["energized"], cover: covers[2] },
  { id: "local-4", title: "Sunroof", artist: "Nicky Youre", bpm: 132, valence: .88, energy: .84, moods: ["energized","light"], cover: covers[3] },
  { id: "local-5", title: "Until I Found You", artist: "Stephen Sanchez", bpm: 102, valence: .78, energy: .45, moods: ["romantic"], cover: covers[4] },
  { id: "local-6", title: "Adore You", artist: "Harry Styles", bpm: 99, valence: .76, energy: .55, moods: ["romantic","light"], cover: covers[5] },
  { id: "local-7", title: "Ocean Eyes", artist: "Billie Eilish", bpm: 73, valence: .48, energy: .3, moods: ["calm","romantic"], cover: covers[0] },
  { id: "local-8", title: "Bloom", artist: "The Paper Kites", bpm: 83, valence: .64, energy: .29, moods: ["calm","romantic"], cover: covers[1] },
  { id: "local-9", title: "Sunset Lover", artist: "Petit Biscuit", bpm: 91, valence: .69, energy: .42, moods: ["calm","light"], cover: covers[2] },
  { id: "local-10", title: "Put Your Records On", artist: "Corinne Bailey Rae", bpm: 96, valence: .86, energy: .52, moods: ["light"], cover: covers[3] },
  { id: "local-11", title: "Electric Love", artist: "BØRNS", bpm: 120, valence: .83, energy: .72, moods: ["energized","romantic"], cover: covers[4] },
  { id: "local-12", title: "Best Part", artist: "Daniel Caesar", bpm: 75, valence: .72, energy: .3, moods: ["romantic","calm"], cover: covers[5] },
];