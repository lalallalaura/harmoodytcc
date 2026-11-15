import { SpotifyAuthError, getValidAccessToken } from "./spotifyAuth";
import { SpotifyTrack } from "../types";

const API_BASE = "https://api.spotify.com/v1";

class SpotifyApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function spotifyFetch(path: string, options?: { method?: string; body?: string }): Promise<any> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    if (err instanceof SpotifyAuthError) throw new SpotifyApiError(err.code, err.message);
    throw err;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options?.body,
    });
  } catch {
    throw new SpotifyApiError("network-error", "Não foi possível falar com o Spotify agora. Verifique sua internet.");
  }

  if (response.status === 401) throw new SpotifyApiError("unauthorized", "Sua conexão com o Spotify expirou. Conecte novamente.");
  if (response.status === 403) throw new SpotifyApiError("forbidden", "O Spotify recusou essa solicitação para o seu app.");
  if (response.status === 429) throw new SpotifyApiError("rate-limited", "Muitas solicitações ao Spotify agora. Tente novamente em instantes.");
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = body?.error?.message ?? "";
    } catch {}
    throw new SpotifyApiError("spotify-error", detail
      ? `O Spotify recusou a solicitação (${response.status}: ${detail}).`
      : "O Spotify está indisponível no momento. Tente novamente mais tarde.");
  }
  return response.json();
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

/** Busca músicas mais ouvidas no período escolhido. Mantém medium_term como padrão para compatibilidade. */
export async function fetchUserTopTracks(limit = 10, timeRange: SpotifyTimeRange = "medium_term"): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const params = new URLSearchParams({ limit: String(safeLimit), time_range: timeRange });
  const data = await spotifyFetch(`/me/top/tracks?${params.toString()}`);
  const items = data.items ?? [];
  if (!items.length) throw new SpotifyApiError("no-tracks", "Ainda não encontramos músicas suficientes nesse período.");
  return items.map(mapTrack);
}

export async function fetchUserSavedTracks(limit = 10): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(limit, 10);
  const data = await spotifyFetch(`/me/tracks?limit=${safeLimit}`);
  const items = data.items ?? [];
  if (!items.length) throw new SpotifyApiError("no-tracks", "Você ainda não tem músicas salvas na sua biblioteca do Spotify.");
  return items.map((item: any) => mapTrack(item.track));
}

export async function searchTracks(query: string, limit = 10, offset = 0): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(limit, 10);
  const params = new URLSearchParams({ q: query, type: "track", limit: String(safeLimit), offset: String(offset) });
  const data = await spotifyFetch(`/search?${params.toString()}`);
  return (data.tracks?.items ?? []).filter(Boolean).map(mapTrack);
}

export async function fetchArtistsGenres(artistIds: string[]): Promise<Record<string, string[]>> {
  const uniqueIds = Array.from(new Set(artistIds)).slice(0, 40);
  if (!uniqueIds.length) return {};
  const results = await Promise.allSettled(uniqueIds.map((id) => spotifyFetch(`/artists/${id}`)));
  const result: Record<string, string[]> = {};
  results.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" && outcome.value) result[uniqueIds[index]] = outcome.value.genres ?? [];
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
