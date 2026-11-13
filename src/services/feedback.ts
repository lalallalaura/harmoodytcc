
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
    const stored = localStorage.getItem(KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFeedback(
  song: Song,
  mood: MoodId,
  value: FeedbackValue,
  genres?: string[]
) {
  const list = getFeedback();

  const filtered = list.filter(
    (item) => !(item.songId === song.id && item.mood === mood)
  );

  filtered.unshift({
    songId: song.id,
    artist: song.artist,
    genres: [...new Set(
      (genres ?? song.genres ?? []).map(normalize)
    )],
    mood,
    value,
    createdAt: new Date().toISOString(),
  });

  localStorage.setItem(
    KEY,
    JSON.stringify(filtered.slice(0, MAX_ITEMS))
  );
}

export function removeFeedback(songId: string, mood: MoodId) {
  const list = getFeedback().filter(
    (item) => !(item.songId === songId && item.mood === mood)
  );

  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getFeedbackForSong(
  songId: string,
  mood: MoodId
): FeedbackValue | null {
  const item = getFeedback().find(
    (entry) => entry.songId === songId && entry.mood === mood
  );

  return item?.value ?? null;
}

/**
 * Calcula a avaliação de um artista.
 * Quando um mood é informado, considera somente avaliações daquele mood.
 */
export function getArtistFeedbackScore(
  artistName: string,
  mood?: MoodId
): number {
  const normalizedArtist = normalize(artistName);

  const score = getFeedback().reduce((total, item) => {
    if (normalize(item.artist) !== normalizedArtist) return total;
    if (mood && item.mood !== mood) return total;

    return total + (item.value === "like" ? 1 : -1);
  }, 0);

  return Math.max(-3, Math.min(3, score));
}

export function getDislikedArtists(mood?: MoodId): Set<string> {
  return new Set(
    getFeedback()
      .filter(
        (item) =>
          item.value === "dislike" &&
          (!mood || item.mood === mood)
      )
      .map((item) => normalize(item.artist))
  );
}

export function hasFeedbackSignal(mood?: MoodId): boolean {
  return mood
    ? getFeedback().some((item) => item.mood === mood)
    : getFeedback().length > 0;
}

/**
 * Soma os likes e dislikes dos gêneros.
 * Quando um mood é informado, considera somente as avaliações daquele mood.
 */
export function getPreferredGenresFromFeedback(
  mood?: MoodId
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const item of getFeedback()) {
    if (mood && item.mood !== mood) continue;

    const weight = item.value === "like" ? 1 : -1;

    for (const genre of item.genres ?? []) {
      const normalizedGenre = normalize(genre);
      if (!normalizedGenre) continue;

      scores.set(
        normalizedGenre,
        (scores.get(normalizedGenre) ?? 0) + weight
      );
    }
  }

  return scores;
}
