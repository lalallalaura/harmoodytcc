import { moods } from "../data";
import { MoodId, Song, SpotifyTrack } from "../types";
import {
  fetchArtistsGenres,
  fetchUserSavedTracks,
  fetchUserTopTracks,
  searchTracks,
  SpotifyApiError,
} from "./spotifyApi";
import { estimateProfile } from "./moodProfile";
import {
  getArtistFeedbackScore,
  getFeedback,
  getFeedbackForSong,
  getPreferredGenresFromFeedback,
} from "./feedback";

const MOOD_GENRES: Record<MoodId, string[]> = {
  energized: ["dance pop", "electropop", "synthpop", "pop rock", "indie dance", "nu disco", "power pop", "alternative dance"],
  calm: ["dream pop", "ambient", "indie folk", "acoustic", "lo-fi", "slowcore", "soft jazz", "downtempo"],
  romantic: ["neo soul", "alternative r&b", "soul", "bedroom pop", "dream pop", "bossa nova", "indie folk", "soft rock"],
  light: ["indie pop", "sunshine pop", "jangle pop", "twee pop", "indie folk", "chamber pop", "sophisti-pop", "soft pop"],
};
const BPM_TARGETS: Record<MoodId, number> = { energized: 120, calm: 80, romantic: 95, light: 100 };
const RECENT_KEY = "harmoody_recent_recommendations_v1";
const MAX_RECENT = 100;
const RECENT_PER_MOOD = 48;
const RESULTS_PER_QUERY = 10;
const DEFAULT_COUNT = 12;
const MIN_DISCOVERY_SCORE = 0.58;

function clamp(n: number, low = 0, high = 1) { return Math.max(low, Math.min(high, n)); }
function norm(s: string) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function keyOf(t: SpotifyTrack) { return `${norm(t.title)}|${norm(t.artist)}`; }
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function recentFor(moodId: MoodId): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return [];
    const value = (parsed as Record<string, unknown>)[moodId];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, MAX_RECENT) : [];
  } catch { return []; }
}
function remember(moodId: MoodId, ids: string[]) {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
    const state: Record<string, string[]> = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string[]>) : {};
    state[moodId] = [...new Set([...ids, ...recentFor(moodId)])].slice(0, RECENT_PER_MOOD);
    localStorage.setItem(RECENT_KEY, JSON.stringify(state));
  } catch { /* Navegação privada ou armazenamento indisponível. */ }
}

function valid(t: SpotifyTrack): boolean {
  if (!t.id || !t.title?.trim() || !t.artist?.trim() || t.durationMs < 60000) return false;
  if (/\b(karaoke|tribute|nightcore|sped up|slowed|8d audio)\b/i.test(t.title)) return false;
  return true;
}

interface Taste {
  artists: Set<string>;
  artistIds: Set<string>;
  genres: Map<string, number>;
  hasSignal: boolean;
}

async function getTaste(moodId: MoodId): Promise<Taste> {
  const [top, saved] = await Promise.allSettled([fetchUserTopTracks(10), fetchUserSavedTracks(10)]);
  const tracks = [
    ...(top.status === "fulfilled" ? top.value : []),
    ...(saved.status === "fulfilled" ? saved.value : []),
  ];
  const artists = new Set<string>();
  const artistIds = new Set<string>();
  for (const track of tracks) {
    // O campo artist pode conter vários artistas separados por vírgula.
    for (const artist of track.artist.split(",")) if (artist.trim()) artists.add(norm(artist));
    track.artistIds.forEach((id) => artistIds.add(id));
  }
  const feedback = getFeedback().filter((item) => item.mood === moodId);
  feedback.filter((item) => item.value === "like").forEach((item) => artists.add(norm(item.artist)));
  const counts = new Map<string, number>();
  const genresByArtist = await fetchArtistsGenres([...artistIds].slice(0, 25)).catch(() => ({} as Record<string, string[]>));
  Object.values(genresByArtist).forEach((genres) => genres.forEach((genre) => {
    const key = norm(genre);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }));
  for (const [genre, delta] of getPreferredGenresFromFeedback(moodId)) {
    const key = norm(genre);
    counts.set(key, (counts.get(key) ?? 0) + delta * 3);
  }
  const max = Math.max(1, ...[...counts.values()].map(Math.abs));
  const genres = new Map([...counts].map(([genre, count]) => [genre, count / max]));
  return { artists, artistIds, genres, hasSignal: artists.size > 0 || genres.size > 0 || feedback.length > 0 };
}

function queriesFor(moodId: MoodId, taste: Taste): string[] {
  const moodGenres = shuffle(MOOD_GENRES[moodId]).slice(0, 5).map((genre) => `genre:"${genre}"`);
  const personalGenres = [...taste.genres]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => `genre:"${genre.replace(/"/g, "")}"`);
  // Apenas uma busca por artista: não deixa os favoritos dominarem os candidatos.
  const artist = shuffle([...taste.artists]).slice(0, 1).map((name) => `artist:"${name.replace(/"/g, "")}"`);
  return [...new Set([...moodGenres, ...personalGenres, ...artist])];
}

async function searchMany(queries: string[], offset: number): Promise<SpotifyTrack[]> {
  const results = await Promise.allSettled(queries.map((query) => searchTracks(query, RESULTS_PER_QUERY, offset)));
  const ok = results.filter((r): r is PromiseFulfilledResult<SpotifyTrack[]> => r.status === "fulfilled");
  if (!ok.length) {
    const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw error?.reason ?? new SpotifyApiError("spotify-error", "Não foi possível buscar músicas.");
  }
  return ok.flatMap((result) => result.value).filter(valid);
}

function genreFit(genres: string[], targets: string[]): number | null {
  if (!genres.length) return null;
  let best = 0;
  for (const genre of genres.map(norm)) {
    for (const target of targets.map(norm)) {
      if (genre === target) best = Math.max(best, 1);
      else if (genre.length >= 5 && target.length >= 5 && (genre.includes(target) || target.includes(genre))) best = Math.max(best, 0.7);
    }
  }
  return best;
}

export async function recommendSongsFromSpotify(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): Promise<{ songs: Song[]; score: number }> {
  const mood = moods.find((item) => item.id === moodId);
  if (!mood) throw new SpotifyApiError("invalid-mood", "Não foi possível identificar o clima selecionado.");
  const count = Math.max(0, Math.floor(options?.count ?? DEFAULT_COUNT));
  if (!count) return { songs: [], score: 0 };
  const excluded = new Set(options?.excludeIds ?? []);
  const recent = new Set(recentFor(moodId));
  const taste = await getTaste(moodId).catch((): Taste => ({ artists: new Set(), artistIds: new Set(), genres: new Map(), hasSignal: false }));
  const queries = queriesFor(moodId, taste);
  const offset = Math.floor(Math.random() * 4) * 10;
  const first = await searchMany(queries, offset);
  let pool = first;
  if (pool.length < count * 3) {
    const more = await searchMany(queries, offset === 0 ? 10 : 0).catch(() => [] as SpotifyTrack[]);
    pool = [...pool, ...more];
  }
  // Busca aberta somente como último recurso; os resultados ainda passam pelo ranking.
  if (pool.length < count) {
    const fallback = await searchMany(shuffle(MOOD_GENRES[moodId]).slice(0, 3), 0).catch(() => [] as SpotifyTrack[]);
    pool = [...pool, ...fallback];
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const candidates = pool.filter((track) => {
    const key = keyOf(track);
    if (excluded.has(track.id) || seenIds.has(track.id) || seenNames.has(key) || getFeedbackForSong(track.id, moodId) === "dislike") return false;
    seenIds.add(track.id);
    seenNames.add(key);
    return true;
  });
  if (!candidates.length) throw new SpotifyApiError("no-tracks", "Não encontramos músicas novas para esse clima agora.");

  const artistIds = [...new Set(candidates.flatMap((track) => track.artistIds))];
  const genresByArtist = await fetchArtistsGenres(artistIds).catch(() => ({} as Record<string, string[]>));
  const scored = candidates.map((track) => {
    const genres = [...new Set(track.artistIds.flatMap((id) => genresByArtist[id] ?? []))];
    const profile = estimateProfile(genres);
    const fit = genreFit(genres, MOOD_GENRES[moodId]);
    const acoustic = 0.45 * clamp(1 - Math.abs(profile.energy - mood.energy))
      + 0.4 * clamp(1 - Math.abs(profile.valence - mood.valence))
      + 0.15 * clamp(1 - Math.abs(profile.bpm - BPM_TARGETS[moodId]) / 100);
    // Valores estimados sem gênero têm baixa confiança: não os trate como confirmação de mood.
    const moodScore = fit === null ? acoustic * 0.65 : acoustic * 0.7 + fit * 0.3;
    const familiar = track.artistIds.some((id) => taste.artistIds.has(id)) || track.artist.split(",").some((name) => taste.artists.has(norm(name)));
    const affinity = genres.length
      ? genres.reduce((sum, genre) => sum + (taste.genres.get(norm(genre)) ?? 0), 0) / genres.length
      : 0;
    const feedbackScore = clamp(getArtistFeedbackScore(track.artist, moodId) / 3, -1, 1);
    const liked = getFeedbackForSong(track.id, moodId) === "like";
    const tasteScore = clamp(0.5 + (familiar ? 0.15 : 0) + 0.2 * affinity + 0.2 * feedbackScore + (liked ? 0.1 : 0));
    const discovery = !familiar && affinity > 0 ? clamp(0.5 + affinity * 0.5) : 0.5;
    const score = taste.hasSignal ? moodScore * 0.55 + tasteScore * 0.35 + discovery * 0.1 : moodScore;
    const song: Song = {
      id: track.id, title: track.title, artist: track.artist, cover: track.cover,
      bpm: profile.bpm, energy: profile.energy, valence: profile.valence,
      moods: [moodId], spotifyUrl: track.spotifyUrl, estimated: true, genres,
    };
    return { song, score, artist: track.artistIds[0] ?? norm(track.artist), familiar, recent: recent.has(track.id), fit, affinity, liked };
  });

  // Escolhe por qualidade, com pequena variação somente entre faixas próximas.
  const eligible = scored.filter((item) => {
    // Não rejeita músicas por país/idioma: exige evidência de afinidade
    // para descobertas sem gênero conhecido ou compatível com o mood.
    if (item.familiar || item.liked || item.affinity > 0) return true;
    if (item.fit === null || item.fit === 0) return false;
    return item.score >= MIN_DISCOVERY_SCORE;
  });
  if (!eligible.length) {
    throw new SpotifyApiError("no-tracks", "Não encontramos músicas com compatibilidade suficiente para esse clima agora.");
  }
  // Sorteio ponderado: afinidade continua sendo a base, mas cada escolha
  // diminui gradualmente a prioridade dos artistas já presentes na seleção.
  // Não existe limite fixo por artista.
  const selected: typeof eligible = [];
  const remaining = [...eligible];
  const artistCounts = new Map<string, number>();
  const TEMPERATURE = 0.11;

  while (selected.length < count && remaining.length > 0) {
    const weights = remaining.map((item) => {
      const repeats = artistCounts.get(item.artist) ?? 0;
      const diversityPenalty = 0.095 * Math.log2(1 + repeats * 2);
      const recentPenalty = item.recent ? 0.045 : 0;
      const adjusted = item.score - diversityPenalty - recentPenalty;
      return Math.exp((adjusted - 1) / TEMPERATURE);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = Math.random() * total;
    let index = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i];
      if (draw <= 0) { index = i; break; }
    }
    const [chosen] = remaining.splice(index, 1);
    selected.push(chosen);
    artistCounts.set(chosen.artist, (artistCounts.get(chosen.artist) ?? 0) + 1);
  }

  remember(moodId, selected.map((item) => item.song.id));
  const average = selected.reduce((sum, item) => sum + item.score, 0) / Math.max(selected.length, 1);
  return { songs: selected.map((item) => item.song), score: selected.length ? Math.round(clamp(average, 0.3, 0.99) * 100) : 0 };
}
