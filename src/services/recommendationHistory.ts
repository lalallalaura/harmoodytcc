
import { MoodId, Song } from "../types";

const STORAGE_KEY = "harmoody_recommendation_history";
const MAX_ITEMS_PER_MOOD = 60;
const EXPIRATION_DAYS = 7;

interface RecommendationHistoryItem {
  id: string;
  date: number;
}

type RecommendationHistory = Partial<
  Record<MoodId, RecommendationHistoryItem[]>
>;

function getHistory(): RecommendationHistory {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) return {};

    const parsed = JSON.parse(stored);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function getValidItems(
  items: RecommendationHistoryItem[] = []
): RecommendationHistoryItem[] {
  const expiration =
    Date.now() - EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

  return items.filter(
    (item) =>
      typeof item.id === "string" &&
      typeof item.date === "number" &&
      item.date > expiration
  );
}

export function getRecentlyRecommendedIds(
  moodId: MoodId
): string[] {
  const history = getHistory();

  return getValidItems(history[moodId]).map(
    (item) => item.id
  );
}

export function saveRecommendedSongs(
  moodId: MoodId,
  songs: Song[]
): void {
  if (songs.length === 0) return;

  const history = getHistory();
  const current = getValidItems(history[moodId]);
  const newIds = new Set(songs.map((song) => song.id));

  const updated = [
    ...songs.map((song) => ({
      id: song.id,
      date: Date.now(),
    })),
    ...current.filter((item) => !newIds.has(item.id)),
  ].slice(0, MAX_ITEMS_PER_MOOD);

  history[moodId] = updated;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(history)
  );
}
