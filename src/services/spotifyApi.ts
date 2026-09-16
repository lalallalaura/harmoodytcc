import { SpotifyAuthError, getValidAccessToken } from "./spotifyAuth";
import { SpotifyTrack } from "../types";

const API_BASE = "https://api.spotify.com/v1";

// IMPORTANTE — sobre BPM/energia/valência:
// Em 27/11/2024 o Spotify restringiu os endpoints "Audio Features",
// "Audio Analysis", "Recommendations" e "Related Artists" para qualquer
// app novo. Não existe forma oficial de pedir BPM/energia/valência ao
// Spotify para um app novo como o Harmoody — por isso usamos uma
// estimativa própria baseada em gênero (ver moodProfile.ts).
//
// IMPORTANTE — reforma de fevereiro de 2026:
// O Spotify removeu vários endpoints e campos nessa data (ver
// https://developer.spotify.com/documentation/web-api/references/changes/february-2026),
// entre eles: GET /artists (busca em lote), o campo "popularity" da
// faixa, POST /users/{id}/playlists e POST /playlists/{id}/tracks. Este
// arquivo já reflete os endpoints atuais.

class SpotifyApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function spotifyFetch(
  path: string,
  options?: { method?: string; body?: string }
): Promise<any> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    if (err instanceof SpotifyAuthError) {
      throw new SpotifyApiError(err.code, err.message);
    }
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
    throw new SpotifyApiError(
      "network-error",
      "Não foi possível falar com o Spotify agora. Verifique sua internet."
    );
  }

  if (response.status === 401) {
    throw new SpotifyApiError(
      "unauthorized",
      "Sua conexão com o Spotify expirou. Conecte novamente."
    );
  }
  if (response.status === 403) {
    throw new SpotifyApiError(
      "forbidden",
      "O Spotify recusou essa solicitação para o seu app."
    );
  }
  if (response.status === 429) {
    throw new SpotifyApiError(
      "rate-limited",
      "Muitas solicitações ao Spotify agora. Tente novamente em instantes."
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = body?.error?.message ?? "";
    } catch {
    }
    throw new SpotifyApiError(
      "spotify-error",
      detail
        ? `O Spotify recusou a solicitação (${response.status}: ${detail}).`
        : "O Spotify está indisponível no momento. Tente novamente mais tarde."
    );
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
    durationMs: raw.duration_ms ?? 0,
    previewUrl: raw.preview_url ?? null,
    spotifyUrl: raw.external_urls?.spotify ?? null,
  };
}

/**
 * Busca as músicas mais ouvidas do usuário conectado (curto prazo).
 * Requer o escopo "user-top-read".
 */
export async function fetchUserTopTracks(limit = 10): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(limit, 10);
  const data = await spotifyFetch(
    `/me/top/tracks?limit=${safeLimit}&time_range=medium_term`
  );
  const items = data.items ?? [];
  if (items.length === 0) {
    throw new SpotifyApiError(
      "no-tracks",
      "Ainda não encontramos músicas suficientes no seu histórico do Spotify."
    );
  }
  return items.map(mapTrack);
}

/**
 * Busca músicas salvas na biblioteca do usuário.
 */
export async function fetchUserSavedTracks(limit = 10): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(limit, 10);
  const data = await spotifyFetch(`/me/tracks?limit=${safeLimit}`);
  const items = data.items ?? [];
  if (items.length === 0) {
    throw new SpotifyApiError(
      "no-tracks",
      "Você ainda não tem músicas salvas na sua biblioteca do Spotify."
    );
  }
  return items.map((item: any) => mapTrack(item.track));
}

/**
 * Busca faixas por termo de pesquisa livre (usado para montar os
 * candidatos de recomendação por humor, já que /recommendations e
 * audio-features não estão mais disponíveis).
 *
 * Desde fev/2026 o Spotify reduziu o limite máximo do /search de 50
 * para 10 por chamada — por isso o valor é sempre limitado aqui.
 */
export async function searchTracks(query: string, limit = 10, offset = 0): Promise<SpotifyTrack[]> {
  const safeLimit = Math.min(limit, 10);
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(safeLimit),
    offset: String(offset),
  });
  const data = await spotifyFetch(`/search?${params.toString()}`);
  const items = data.tracks?.items ?? [];
  return items.filter(Boolean).map(mapTrack);
}

/**
 * Busca os gêneros dos artistas informados.
 *
 * Desde fev/2026 o Spotify removeu o endpoint em lote (GET /artists),
 * então agora é preciso uma chamada por artista (GET /artists/{id}, que
 * continua disponível). Falhas individuais são ignoradas (o artista fica
 * sem gênero conhecido) para não derrubar a recomendação inteira por
 * causa de um único artista.
 */
export async function fetchArtistsGenres(
  artistIds: string[]
): Promise<Record<string, string[]>> {
  const uniqueIds = Array.from(new Set(artistIds)).slice(0, 40);
  if (uniqueIds.length === 0) return {};

  const results = await Promise.allSettled(
    uniqueIds.map((id) => spotifyFetch(`/artists/${id}`))
  );

  const result: Record<string, string[]> = {};
  results.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" && outcome.value) {
      result[uniqueIds[index]] = outcome.value.genres ?? [];
    }
  });
  return result;
}

export async function createPlaylist(
  name: string,
  description: string
): Promise<{ id: string; url: string | null }> {
  const data = await spotifyFetch(`/me/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, description, public: false }),
  });
  return { id: data.id, url: data.external_urls?.spotify ?? null };
}

export async function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[]
): Promise<void> {
  const uris = trackIds.map((id) => `spotify:track:${id}`);
  await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });
}

export { SpotifyApiError };