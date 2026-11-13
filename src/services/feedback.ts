
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

  // Uma avaliação por música em cada mood.
  const filtered = list.filter(
    (item) => !(item.songId === song.id && item.mood === mood)
  );

  filtered.unshift({
    songId: song.id,
    artist: song.artist,
    genres: [...new Set(
      (genres ?? song.genres ?? []).map((genre) =>
        genre.trim().toLowerCase()
      )
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

export function getArtistFeedbackScore(artistName: string): number {
  const normalizedArtist = artistName.trim().toLowerCase();

  const score = getFeedback().reduce((total, item) => {
    if (item.artist.trim().toLowerCase() !== normalizedArtist) {
      return total;
    }

    return total + (item.value === "like" ? 1 : -1);
  }, 0);

  return Math.max(-3, Math.min(3, score));
}

export function getDislikedArtists(): Set<string> {
  return new Set(
    getFeedback()
      .filter((item) => item.value === "dislike")
      .map((item) => item.artist.trim().toLowerCase())
  );
}

export function hasFeedbackSignal(): boolean {
  return getFeedback().length > 0;
}

export function getPreferredGenresFromFeedback(): Map<string, number> {
  const scores = new Map<string, number>();

  for (const item of getFeedback()) {
    const weight = item.value === "like" ? 1 : -1;

    for (const genre of item.genres ?? []) {
      const normalizedGenre = genre.trim().toLowerCase();
      if (!normalizedGenre) continue;

      scores.set(
        normalizedGenre,
        (scores.get(normalizedGenre) ?? 0) + weight
      );
    }
  }

  return scores;
}
