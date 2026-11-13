
import { MoodId, Song } from "../types";

export interface HistoryItem {
  id: string;
  mood: MoodId;
  createdAt: string;
  note?: string;
  songs?: Song[];
}

const KEY = "harmoody_history";

export function getHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveHistory(
  mood: MoodId,
  songs: Song[] = []
): HistoryItem {
  const history = getHistory();

  const item: HistoryItem = {
    id: crypto.randomUUID(),
    mood,
    createdAt: new Date().toISOString(),
    songs: songs.map((song) => ({
      ...song,
      genres: song.genres ? [...song.genres] : undefined,
    })),
  };

  history.unshift(item);

  localStorage.setItem(
    KEY,
    JSON.stringify(history.slice(0, 30))
  );

  return item;
}

export function updateHistorySongs(id: string, songs: Song[]) {
  const history = getHistory();

  const updatedHistory = history.map((item) => {
    if (item.id !== id) return item;

    const existingSongs = item.songs || [];
    const existingIds = new Set(existingSongs.map((song) => song.id));

    const newSongs = songs.filter(
      (song) => !existingIds.has(song.id)
    );

    return {
      ...item,
      songs: [...existingSongs, ...newSongs],
    };
  });

  localStorage.setItem(KEY, JSON.stringify(updatedHistory));
}

export function updateHistoryNote(id: string, note: string) {
  const history = getHistory();

  const updatedHistory = history.map((item) =>
    item.id === id ? { ...item, note } : item
  );

  localStorage.setItem(KEY, JSON.stringify(updatedHistory));
}

export function deleteHistory(id: string) {
  const history = getHistory();

  const updatedHistory = history.filter((item) => item.id !== id);

  localStorage.setItem(KEY, JSON.stringify(updatedHistory));
}
