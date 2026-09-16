import { MoodId, Song } from "../types";



export type FeedbackValue = "like" | "dislike";

export interface FeedbackItem {
  songId: string;
  artist: string;
  genres: string[];
  mood: MoodId;
  value: FeedbackValue;
  createdAt: string;
}

const KEY = "harmoody_feedback";
const MAX_ITEMS = 300;

export function getFeedback(): FeedbackItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

/** Salva (ou substitui) o feedback do usuário para uma música. */
export function saveFeedback(
  song: Song,
  mood: MoodId,
  value: FeedbackValue,
  genres?: string[]
) {
  const list = getFeedback().filter((item) => item.songId !== song.id);
  list.unshift({
    songId: song.id,
    artist: song.artist,
    genres: genres ?? song.genres ?? [],
    mood,
    value,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
}

/** Remove o feedback de uma música (usado quando o usuário desmarca). */
export function removeFeedback(songId: string) {
  const list = getFeedback().filter((item) => item.songId !== songId);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getFeedbackForSong(songId: string): FeedbackValue | null {
  const item = getFeedback().find((f) => f.songId === songId);
  return item ? item.value : null;
}

/**
 * Afinidade acumulada do usuário com um artista, com base no
 * feedback já dado: soma +1 por "gostei" e -1 por "não gostei",
 * limitada entre -3 e 3 para não deixar um único artista dominar
 * demais o ranking.
 */
export function getArtistFeedbackScore(artistName: string): number {
  const lower = artistName.toLowerCase();
  let score = 0;
  for (const item of getFeedback()) {
    if (item.artist.toLowerCase() !== lower) continue;
    score += item.value === "like" ? 1 : -1;
  }
  return Math.max(-3, Math.min(3, score));
}

/**
 * Gêneros preferidos com base no feedback (só existe quando o feedback
 * veio de músicas do Spotify, que carregam `genres`). Retorna um saldo
 * (gostei - não gostei) por gênero.
 */
export function getPreferredGenresFromFeedback(): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const item of getFeedback()) {
    if (!item.genres || item.genres.length === 0) continue;
    const delta = item.value === "like" ? 1 : -1;
    for (const genre of item.genres) {
      const key = genre.toLowerCase();
      weights[key] = (weights[key] ?? 0) + delta;
    }
  }
  return weights;
}
