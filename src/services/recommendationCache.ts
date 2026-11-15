/** Cache curto em memória: não persiste catálogo do Spotify no navegador. */
import type { MoodId, SpotifyTrack } from "../types";

export type SearchHint = { term: string; kind: "genre" | "term" | "artist" };
export interface CandidatePool {
  tracks: SpotifyTrack[];
  hints: Map<string, SearchHint>;
  queries: string[];
  nextOffset: number;
}

const POOL_TTL_MS = 8 * 60 * 1000;
const TASTE_TTL_MS = 5 * 60 * 1000;
const pools = new Map<MoodId, { expires: number; value: CandidatePool }>();
const loadingPools = new Map<MoodId, Promise<CandidatePool>>();
const values = new Map<string, { expires: number; value: unknown }>();
const loadingValues = new Map<string, Promise<unknown>>();
let sessionToken: string | null = null;

/** Não misturar recomendações entre contas ao trocar o token Spotify. */
export function syncSpotifySession(token: string): void {
  if (sessionToken === token) return;
  sessionToken = token;
  pools.clear();
  loadingPools.clear();
  values.clear();
  loadingValues.clear();
}

export function getCandidatePool(mood: MoodId): CandidatePool | undefined {
  const entry = pools.get(mood);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) { pools.delete(mood); return undefined; }
  return entry.value;
}

export function saveCandidatePool(mood: MoodId, value: CandidatePool): void {
  pools.set(mood, { value, expires: Date.now() + POOL_TTL_MS });
}

export async function loadCandidatePool(mood: MoodId, loader: () => Promise<CandidatePool>): Promise<CandidatePool> {
  const cached = getCandidatePool(mood);
  if (cached) return cached;
  const pending = loadingPools.get(mood);
  if (pending) return pending;
  const promise = loader().then((pool) => {
    // Uma troca de conta não deve gravar resultados antigos na sessão nova.
    if (loadingPools.get(mood) === promise) saveCandidatePool(mood, pool);
    return pool;
  }).finally(() => {
    if (loadingPools.get(mood) === promise) loadingPools.delete(mood);
  });
  loadingPools.set(mood, promise);
  return promise;
}

export async function cachedTasteData<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const entry = values.get(key);
  if (entry && entry.expires > Date.now()) return entry.value as T;
  const pending = loadingValues.get(key);
  if (pending) return pending as Promise<T>;
  const promise = loader().then((value) => {
    if (loadingValues.get(key) === promise) values.set(key, { value, expires: Date.now() + TASTE_TTL_MS });
    return value;
  }).finally(() => {
    if (loadingValues.get(key) === promise) loadingValues.delete(key);
  });
  loadingValues.set(key, promise);
  return promise;
}
