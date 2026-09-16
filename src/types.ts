export type MoodId = "energized" | "calm" | "romantic" | "light";

export interface Mood {
  id: MoodId;
  label: string;
  emoji: string;
  description: string;
  energy: number;
  valence: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  valence: number;
  energy: number;
  moods: MoodId[];
  cover: string;
  spotifyUrl?: string | null;
  estimated?: boolean;
  /** Gêneros do artista (quando disponíveis via Spotify), usados para o gosto pessoal. */
  genres?: string[];
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  artistIds: string[];
  album: string;
  cover: string;
  durationMs: number;
  previewUrl: string | null;
  spotifyUrl: string | null;
}