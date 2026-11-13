import { MoodId } from "../types";

export interface HistoryItem {
  id: string;
  mood: MoodId;
  createdAt: string;
  note?: string;
}

const KEY = "harmoody_history";

export function getHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveHistory(mood: MoodId) {
  const history = getHistory();
  history.unshift({
    id: crypto.randomUUID(),
    mood,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(KEY, JSON.stringify(history.slice(0, 30)));
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