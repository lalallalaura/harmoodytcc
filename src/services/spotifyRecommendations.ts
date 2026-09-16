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
import { getArtistFeedbackScore, getFeedback, getPreferredGenresFromFeedback } from "./feedback";

// Queries de busca por mood (mantidas: continuam garantindo que sempre
// exista um lote de faixas compatível com o clima escolhido).
const MOOD_QUERIES: Record<MoodId, string[]> = {
  energized: ["upbeat pop", "dance workout", "edm hits", "energetic pop rock", "power pop"],
  calm: ["acoustic chill", "ambient calm", "lo-fi chill", "soft piano", "downtempo"],
  romantic: ["romantic r&b", "love songs", "soul love songs", "acoustic love songs", "singer songwriter love"],
  light: ["feel good indie", "happy indie pop", "chill pop good vibes", "sunny day pop", "indie folk happy"],
};

// Palavra-chave curta por mood, usada para combinar com os gêneros
// favoritos do usuário nas buscas de "descoberta" (ex: "rock upbeat").
const MOOD_KEYWORD: Record<MoodId, string> = {
  energized: "upbeat",
  calm: "chill",
  romantic: "romantic",
  light: "feel good",
};

const RESULTS_PER_QUERY = 10; // máximo permitido pelo /search desde fev/2026
const TARGET_COUNT = 12;
const MAX_PER_ARTIST = 2;
const EXPLORATION_RATIO = 0.3; // fatia reservada para artistas ainda não ouvidos pelo usuário
const MAX_TASTE_QUERIES = 3;

function distance(a: number, b: number) {
  return Math.abs(a - b);
}

function normalizeKey(track: SpotifyTrack): string {
  return `${track.title.toLowerCase().trim()}|${track.artist.toLowerCase().trim()}`;
}

// ---------------------------------------------------------------------
// Perfil de gosto pessoal (o "Essa música combina com o que esse
// usuário costuma gostar?"). Combina duas fontes que já existem no
// projeto e não eram usadas na recomendação:
//   1) Top tracks e músicas salvas do próprio Spotify do usuário;
//   2) O feedback ❤️/👎 dado nas telas anteriores.
// ---------------------------------------------------------------------

interface TasteProfile {
  favoriteArtistIds: Set<string>;
  favoriteArtistNames: Set<string>;
  dislikedArtistNames: Set<string>;
  genreWeights: Map<string, number>; // 0..1, normalizado
  hasSignal: boolean;
}

let cachedTasteProfile: { profile: TasteProfile; at: number } | null = null;
const TASTE_CACHE_MS = 10 * 60 * 1000; // 10 min: evita refazer várias chamadas ao Spotify a cada "mostrar mais"

async function buildTasteProfile(): Promise<TasteProfile> {
  if (cachedTasteProfile && Date.now() - cachedTasteProfile.at < TASTE_CACHE_MS) {
    return cachedTasteProfile.profile;
  }

  const favoriteArtistIds = new Set<string>();
  const favoriteArtistNames = new Set<string>();
  const dislikedArtistNames = new Set<string>();
  const genreCounts = new Map<string, number>();

  // 1) Histórico real do Spotify (falhas individuais não derrubam o resto,
  // ex: usuário sem músicas salvas ainda).
  const [topResult, savedResult] = await Promise.allSettled([
    fetchUserTopTracks(10),
    fetchUserSavedTracks(10),
  ]);

  const historyTracks: SpotifyTrack[] = [
    ...(topResult.status === "fulfilled" ? topResult.value : []),
    ...(savedResult.status === "fulfilled" ? savedResult.value : []),
  ];

  for (const track of historyTracks) {
    favoriteArtistNames.add(track.artist.toLowerCase());
    track.artistIds.forEach((id) => favoriteArtistIds.add(id));
  }

  if (historyTracks.length > 0) {
    const artistIds = historyTracks.flatMap((t) => t.artistIds);
    const genresByArtist = await fetchArtistsGenres(artistIds).catch(() => ({} as Record<string, string[]>));
    for (const genres of Object.values(genresByArtist)) {
      for (const genre of genres) {
        const key = genre.toLowerCase();
        genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // 2) Feedback local (❤️/👎) dado dentro do próprio app.
  for (const item of getFeedback()) {
    const lower = item.artist.toLowerCase();
    if (item.value === "like") favoriteArtistNames.add(lower);
    else dislikedArtistNames.add(lower);
  }

  const feedbackGenres = getPreferredGenresFromFeedback();
  for (const [genre, delta] of Object.entries(feedbackGenres)) {
    if (delta <= 0) continue;
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + delta);
  }

  const maxCount = Math.max(1, ...genreCounts.values());
  const genreWeights = new Map<string, number>();
  for (const [genre, count] of genreCounts) {
    genreWeights.set(genre, count / maxCount);
  }

  const hasSignal =
    favoriteArtistIds.size > 0 || favoriteArtistNames.size > 0 || genreWeights.size > 0;

  const profile: TasteProfile = {
    favoriteArtistIds,
    favoriteArtistNames,
    dislikedArtistNames,
    genreWeights,
    hasSignal,
  };

  cachedTasteProfile = { profile, at: Date.now() };
  return profile;
}

function isFamiliarArtist(track: SpotifyTrack, taste: TasteProfile): boolean {
  return (
    track.artistIds.some((id) => taste.favoriteArtistIds.has(id)) ||
    taste.favoriteArtistNames.has(track.artist.toLowerCase())
  );
}

/** "Essa música combina com o que esse usuário costuma gostar?" (0..1) */
function tasteScoreFor(track: SpotifyTrack, genres: string[], taste: TasteProfile): number {
  let score = 0.15; // pequena base neutra

  if (isFamiliarArtist(track, taste)) score += 0.5;

  if (genres.length > 0 && taste.genreWeights.size > 0) {
    const genreScore =
      genres.reduce((sum, g) => sum + (taste.genreWeights.get(g.toLowerCase()) ?? 0), 0) /
      genres.length;
    score += genreScore * 0.35;
  }

  score += getArtistFeedbackScore(track.artist) * 0.08; // ±3 feedbacks => ±0.24

  if (taste.dislikedArtistNames.has(track.artist.toLowerCase())) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/** Monta queries extras de busca a partir dos gêneros favoritos, para
 * trazer artistas semelhantes (ainda não ouvidos) além dos já conhecidos. */
function buildTasteQueries(moodId: MoodId, taste: TasteProfile): string[] {
  if (taste.genreWeights.size === 0) return [];
  const topGenres = [...taste.genreWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TASTE_QUERIES)
    .map(([genre]) => genre);
  const keyword = MOOD_KEYWORD[moodId];
  return topGenres.map((genre) => `${genre} ${keyword}`);
}

async function collectCandidates(queries: string[], offset: number): Promise<SpotifyTrack[]> {
  const settled = await Promise.allSettled(
    queries.map((q) => searchTracks(q, RESULTS_PER_QUERY, offset))
  );

  const seen = new Set<string>();
  const candidates: SpotifyTrack[] = [];
  let firstError: unknown = null;

  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      firstError = firstError ?? outcome.reason;
      continue;
    }
    for (const track of outcome.value) {
      const key = normalizeKey(track);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(track);
    }
  }

  const allFailed = settled.every((s) => s.status === "rejected");
  if (allFailed && firstError) {
    throw firstError;
  }

  return candidates;
}

export async function recommendSongsFromSpotify(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): Promise<{ songs: Song[]; score: number }> {
  const mood = moods.find((m) => m.id === moodId)!;
  const excludeIds = new Set(options?.excludeIds ?? []);
  const targetCount = options?.count ?? TARGET_COUNT;

  // Gosto pessoal não deve travar a recomendação: se falhar, seguimos
  // com um perfil vazio (equivale ao comportamento antigo, só por mood).
  const taste = await buildTasteProfile().catch(
    (): TasteProfile => ({
      favoriteArtistIds: new Set(),
      favoriteArtistNames: new Set(),
      dislikedArtistNames: new Set(),
      genreWeights: new Map(),
      hasSignal: false,
    })
  );

  const queries = [...MOOD_QUERIES[moodId], ...buildTasteQueries(moodId, taste)];

  const baseOffset = excludeIds.size > 0 ? Math.floor(Math.random() * 30) : 0;

  const extraOffsets =
    targetCount <= 12 ? [] : targetCount <= 24 ? [baseOffset + 10] : [baseOffset + 10, baseOffset + 20];

  const batches = await Promise.all(
    [baseOffset, ...extraOffsets].map((offset) => collectCandidates(queries, offset))
  );

  const seenIds = new Set<string>();
  let candidates: SpotifyTrack[] = [];
  for (const batch of batches) {
    for (const track of batch) {
      if (excludeIds.has(track.id) || seenIds.has(track.id)) continue;
      seenIds.add(track.id);
      candidates.push(track);
    }
  }

  if (candidates.length < targetCount && baseOffset !== 0) {
    const fallbackBatch = (await collectCandidates(queries, 0)).filter(
      (t) => !excludeIds.has(t.id) && !seenIds.has(t.id)
    );
    for (const track of fallbackBatch) {
      candidates.push(track);
      seenIds.add(track.id);
    }
  }

  if (candidates.length === 0) {
    throw new SpotifyApiError(
      "no-tracks",
      excludeIds.size > 0
        ? "Não encontramos músicas novas para esse clima agora. Tente de novo em instantes."
        : "Não encontramos músicas no Spotify para esse clima agora."
    );
  }

  const artistIds = candidates.flatMap((t) => t.artistIds);
  const genresByArtist = await fetchArtistsGenres(artistIds).catch(() => ({} as Record<string, string[]>));

  const bpmTarget =
    moodId === "energized" ? 120 : moodId === "calm" ? 80 : moodId === "romantic" ? 95 : 100;

  const scored = candidates.map((track) => {
    const genres = track.artistIds.flatMap((id) => genresByArtist[id] ?? []);
    const profile = estimateProfile(genres, { energy: mood.energy, valence: mood.valence });

    // "Essa música combina com o que o usuário quer sentir?"
    const energyFit = 1 - distance(profile.energy, mood.energy);
    const valenceFit = 1 - distance(profile.valence, mood.valence);
    const bpmFit = 1 - Math.min(distance(profile.bpm, bpmTarget) / 100, 1);
    const moodScore = energyFit * 0.45 + valenceFit * 0.4 + bpmFit * 0.15;

    // "Essa música combina com o que esse usuário costuma gostar?"
    const tasteScoreValue = tasteScoreFor(track, genres, taste);

    // Sem sinal de gosto (usuário novo, sem top tracks/feedback ainda):
    // o peso todo vai para o mood, preservando o comportamento anterior.
    const tasteWeight = taste.hasSignal ? 0.45 : 0;
    const moodWeight = taste.hasSignal ? 0.45 : 0.9;
    const combinedScore = tasteScoreValue * tasteWeight + moodScore * moodWeight;

    const song: Song = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      bpm: profile.bpm,
      energy: profile.energy,
      valence: profile.valence,
      moods: [moodId],
      spotifyUrl: track.spotifyUrl,
      estimated: true,
      genres,
    };

    return {
      song,
      score: combinedScore,
      primaryArtistId: track.artistIds[0] ?? track.artist,
      isFamiliar: isFamiliarArtist(track, taste),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const maxPerArtist = Math.max(MAX_PER_ARTIST, Math.ceil(targetCount / 6));

  // Diversidade: em vez de uma nota por música (o que não faz muito
  // sentido — diversidade é uma característica do CONJUNTO escolhido,
  // não de uma faixa isolada), aplicamos como regra de seleção:
  //   1) limite de faixas por artista;
  //   2) uma fatia reservada para artistas ainda não ouvidos pelo
  //      usuário, para não travar só nos artistas já conhecidos.
  const explorationSlots = taste.hasSignal ? Math.max(1, Math.round(targetCount * EXPLORATION_RATIO)) : 0;
  const mainSlots = targetCount - explorationSlots;

  const artistCount = new Map<string, number>();
  const selected: { song: Song; score: number; isFamiliar: boolean }[] = [];
  const selectedIds = new Set<string>();

  function tryAdd(item: (typeof scored)[number]): boolean {
    if (selectedIds.has(item.song.id)) return false;
    const count = artistCount.get(item.primaryArtistId) ?? 0;
    if (count >= maxPerArtist) return false;
    artistCount.set(item.primaryArtistId, count + 1);
    selected.push({ song: item.song, score: item.score, isFamiliar: item.isFamiliar });
    selectedIds.add(item.song.id);
    return true;
  }

  // Passo 1: melhores no geral, até preencher as vagas "principais".
  for (const item of scored) {
    if (selected.length >= mainSlots) break;
    tryAdd(item);
  }

  // Passo 2: vagas de descoberta, priorizando artistas ainda não ouvidos.
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    if (!item.isFamiliar) tryAdd(item);
  }

  // Passo 3: preenche o que faltar com o melhor disponível (respeitando o limite por artista).
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // Passo 4 (mesma rede de segurança de antes): se ainda faltar, ignora o
  // limite por artista para garantir que a lista não fique menor que o pedido.
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      if (selectedIds.has(item.song.id)) continue;
      selected.push({ song: item.song, score: item.score, isFamiliar: item.isFamiliar });
      selectedIds.add(item.song.id);
    }
  }

  const avgScore =
    selected.reduce((total, item) => total + item.score, 0) / Math.max(selected.length, 1);

  return {
    songs: selected.map((item) => item.song),
    score: Math.round(Math.min(Math.max(avgScore * 100, 30), 99)),
  };
}
