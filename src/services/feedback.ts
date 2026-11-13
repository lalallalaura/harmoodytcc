
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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function getFeedback(): FeedbackItem[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");

    if (!Array.isArray(data)) return [];

    return data;
  } catch {
    return [];
  }
}

/** Salva ou substitui a avaliação de uma música. */
export function saveFeedback(
  song: Song,
  mood: MoodId,
  value: FeedbackValue,
  genres?: string[]
) {
  const list = getFeedback().filter(
    (item) => item.songId !== song.id
  );

  list.unshift({
    songId: song.id,
    artist: song.artist,
    genres: genres ?? song.genres ?? [],
    mood,
    value,
    createdAt: new Date().toISOString(),
  });

  localStorage.setItem(
    KEY,
    JSON.stringify(list.slice(0, MAX_ITEMS))
  );
}

/** Remove a avaliação de uma música. */
export function removeFeedback(songId: string) {
  const list = getFeedback().filter(
    (item) => item.songId !== songId
  );

  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getFeedbackForSong(
  songId: string
): FeedbackValue | null {
  const item = getFeedback().find(
    (feedback) => feedback.songId === songId
  );

  return item ? item.value : null;
}

/**
 * Retorna a afinidade do usuário com um artista.
 * Cada like soma 1 e cada dislike subtrai 1.
 * O resultado fica limitado entre -3 e 3.
 */
export function getArtistFeedbackScore(
  artistName: string
): number {
  const target = normalize(artistName);

  let score = 0;

  for (const item of getFeedback()) {
    if (normalize(item.artist) !== target) continue;

    score += item.value === "like" ? 1 : -1;
  }

  return Math.max(-3, Math.min(3, score));
}

/** Retorna os nomes dos artistas que receberam dislikes. */
export function getDislikedArtists(): Set<string> {
  return new Set(
    getFeedback()
      .filter((item) => item.value === "dislike")
      .map((item) => normalize(item.artist))
  );
}

/** Indica se existe qualquer avaliação, positiva ou negativa. */
export function hasFeedbackSignal(): boolean {
  return getFeedback().length > 0;
}

/**
 * Saldo de preferências por gênero.
 * Likes somam 1 e dislikes subtraem 1.
 */
export function getPreferredGenresFromFeedback(): Record<string, number> {
  const weights: Record<string, number> = {};

  for (const item of getFeedback()) {
    if (!item.genres || item.genres.length === 0) continue;

    const delta = item.value === "like" ? 1 : -1;

    for (const genre of new Set(item.genres)) {
      const key = normalize(genre);

      weights[key] = (weights[key] ?? 0) + delta;
    }
  }

  return weights;
}
