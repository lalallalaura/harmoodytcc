import { SpotifyAuthError, getValidAccessToken } from "./spotifyAuth";
import { SpotifyTrack } from "../types";

const API_BASE = "https://api.spotify.com/v1";
const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_CONCURRENT_REQUESTS = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ARTIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ARTIST_LOOKUPS = 6;
const MAX_AUTOMATIC_RETRY_MS = 10000;

class SpotifyApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SpotifyApiError";
    this.code = code;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let activeRequests = 0;
let nextRequestAt = 0;
let cooldownUntil = 0;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
const pendingTasks: Array<() => void> = [];

// Inicia no máximo três chamadas simultâneas, espaçadas em 200 ms.
// A fila NÃO fica presa esperando a resposta de uma chamada anterior.
function processQueue(): void {
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
  if (!pendingTasks.length || activeRequests >= MAX_CONCURRENT_REQUESTS) return;

  const delay = Math.max(0, nextRequestAt - Date.now(), cooldownUntil - Date.now());
  if (delay > 0) {
    queueTimer = setTimeout(processQueue, delay);
    return;
  }

  const task = pendingTasks.shift()!;
  activeRequests++;
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  task();
  if (pendingTasks.length) queueTimer = setTimeout(processQueue, MIN_REQUEST_INTERVAL_MS);
}

function schedule<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingTasks.push(() => {
      void operation()
        .then(resolve, reject)
        .finally(() => {
          activeRequests--;
          processQueue();
        });
    });
    processQueue();
  });
}

type CacheEntry = { value: any; expiresAt: number };
const responseCache = new Map<string, CacheEntry>();
const pendingGets = new Map<string, Promise<any>>();
const artistCache = new Map<string, { genres: string[]; expiresAt: number }>();

function cachedValue(key: string): any | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.value;
}

async function spotifyFetch(path: string, options?: { method?: string; body?: string }): Promise<any> {
  const method = options?.method ?? "GET";
  const cacheKey = `${method}:${path}`;
  if (method === "GET") {
    const cached = cachedValue(cacheKey);
    if (cached !== undefined) return cached;
    const pending = pendingGets.get(cacheKey);
    if (pending) return pending;
  }

  const run = (async () => {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch (err) {
      if (err instanceof SpotifyAuthError) throw new SpotifyApiError(err.code, err.message);
      throw err;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      // Cada tentativa ocupa um slot apenas enquanto a chamada HTTP está ativa.
      const response = await schedule(async () => {
        try {
          return await fetch(`${API_BASE}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(options?.body ? { "Content-Type": "application/json" } : {}),
            },
            body: options?.body,
          });
        } catch {
          throw new SpotifyApiError("network-error", "Não foi possível falar com o Spotify agora. Verifique sua internet.");
        }
      });

      if (response.status === 429) {
        const rawRetryAfter = response.headers.get("Retry-After");
        const seconds = rawRetryAfter === null ? NaN : Number(rawRetryAfter);
        const delayMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5000;
        cooldownUntil = Math.max(cooldownUntil, Date.now() + delayMs);
        processQueue();
        // Evita deixar a tela carregando por um minuto inteiro.
        if (attempt === 0 && delayMs <= MAX_AUTOMATIC_RETRY_MS) {
          await wait(delayMs);
          continue;
        }
        throw new SpotifyApiError("rate-limited", "O Spotify limitou as solicitações. Aguarde um pouco antes de tentar novamente.");
      }
      if (response.status === 401) throw new SpotifyApiError("unauthorized", "Sua conexão com o Spotify expirou. Conecte novamente.");
      if (response.status === 403) throw new SpotifyApiError("forbidden", "O Spotify recusou essa solicitação para o seu app.");
      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.clone().json();
          detail = body?.error?.message ?? "";
        } catch { /* Resposta sem JSON. */ }
        throw new SpotifyApiError("spotify-error", detail
          ? `O Spotify recusou a solicitação (${response.status}: ${detail}).`
          : "O Spotify está indisponível no momento. Tente novamente mais tarde.");
      }
      const data = await response.json();
      if (method === "GET") responseCache.set(cacheKey, { value: data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    }
    throw new SpotifyApiError("rate-limited", "O Spotify limitou as solicitações. Tente novamente mais tarde.");
  })();

  if (method !== "GET") return run;
  pendingGets.set(cacheKey, run);
  try { return await run; }
  finally { pendingGets.delete(cacheKey); }
}

function mapTrack(raw: any): SpotifyTrack {
  return {
    id: raw.id,
    artistIds: (raw.artists ?? []).map((a: any) => a.id).filter(Boolean),
    title: raw.name,
    artist: (raw.artists ?? []).map((a: any) => a.name).join(", "),
    album: raw.album?.name ?? "",
    cover: raw.album?.images?.[0]?.url ?? "",
    popularity: raw.popularity ?? 0,
    durationMs: raw.duration_ms ?? 0,
    previewUrl: raw.preview_url ?? null,
    spotifyUrl: raw.external_urls?.spotify ?? null,
  };
}

export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";

export async function fetchUserTopTracks(limit = 10, timeRange: SpotifyTimeRange = "medium_term"): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const params = new URLSearchParams({ limit: String(safeLimit), time_range: timeRange });
  const data = await spotifyFetch(`/me/top/tracks?${params.toString()}`);
  const items = data.items ?? [];
  if (!items.length) throw new SpotifyApiError("no-tracks", "Ainda não encontramos músicas suficientes nesse período.");
  return items.map(mapTrack);
}

export async function fetchUserSavedTracks(limit = 10): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const data = await spotifyFetch(`/me/tracks?limit=${safeLimit}`);
  const items = data.items ?? [];
  if (!items.length) throw new SpotifyApiError("no-tracks", "Você ainda não tem músicas salvas na sua biblioteca do Spotify.");
  return items.map((item: any) => mapTrack(item.track));
}

export async function searchTracks(query: string, limit = 10, offset = 0): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const params = new URLSearchParams({ q: query, type: "track", limit: String(safeLimit), offset: String(offset) });
  const data = await spotifyFetch(`/search?${params.toString()}`);
  return (data.tracks?.items ?? []).filter(Boolean).map(mapTrack);
}

export async function fetchArtistsGenres(artistIds: string[]): Promise<Record<string, string[]>> {
  const uniqueIds = [...new Set(artistIds.filter(Boolean))];
  const result: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const id of uniqueIds) {
    const cached = artistCache.get(id);
    if (cached && cached.expiresAt > Date.now()) result[id] = cached.genres;
    else missing.push(id);
  }
  const lookups = missing.slice(0, MAX_ARTIST_LOOKUPS);
  const outcomes = await Promise.allSettled(lookups.map((id) => spotifyFetch(`/artists/${id}`)));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" && outcome.value) {
      const genres: string[] = outcome.value.genres ?? [];
      const id = lookups[index];
      artistCache.set(id, { genres, expiresAt: Date.now() + ARTIST_CACHE_TTL_MS });
      result[id] = genres;
    }
  });
  return result;
}

export async function createPlaylist(name: string, description: string): Promise<{ id: string; url: string | null }> {
  const data = await spotifyFetch(`/me/playlists`, { method: "POST", body: JSON.stringify({ name, description, public: false }) });
  return { id: data.id, url: data.external_urls?.spotify ?? null };
}

export async function addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
  const uris = trackIds.map((id) => `spotify:track:${id}`);
  await spotifyFetch(`/playlists/${playlistId}/items`, { method: "POST", body: JSON.stringify({ uris }) });
}

export { SpotifyApiError };
