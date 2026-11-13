
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
  getDislikedArtists,
  getFeedback,
  getPreferredGenresFromFeedback,
} from "./feedback";

const MOOD_QUERIES: Record<MoodId, string[]> = {
  energized: [
    "electropop",
    "dance pop",
    "pop rock",
    "synthpop",
    "disco funk",
    "indie dance",
    "nu disco",
  ],
  calm: [
    "ambient",
    "dream pop",
    "indie folk",
    "acoustic folk",
    "lofi hip hop",
    "slowcore",
    "soft jazz",
  ],
  romantic: [
    "neo soul",
    "alternative r&b",
    "dream pop",
    "soul ballads",
    "indie love songs",
    "bedroom pop",
    "bossa nova",
  ],
  light: [
    "indie pop",
    "sunshine pop",
    "jangle pop",
    "twee pop",
    "indie folk",
    "sophisti pop",
    "chamber pop",
  ],
};

const MOOD_KEYWORD: Record<MoodId, string> = {
  energized: "dance pop",
  calm: "ambient",
  romantic: "neo soul",
  light: "indie pop",
};

const RESULTS_PER_QUERY = 10;
const TARGET_COUNT = 12;
const MAX_PER_ARTIST = 2;
const MAX_TASTE_QUERIES = 3;
const TASTE_CACHE_MS = 10 * 60 * 1000;

// Pesos da recomendação.
const MOOD_WEIGHT = 0.6;
const TASTE_WEIGHT = 0.3;
const DISCOVERY_WEIGHT = 0.1;

function distance(a: number, b: number) {
  return Math.abs(a - b);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeKey(track: SpotifyTrack): string {
  return `${normalize(track.title)}|${normalize(track.artist)}`;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const GENERIC_TITLES = new Set([
  "pop",
  "rock",
  "pop rock",
  "rock pop",
  "indie pop",
  "indie rock",
  "dream pop",
  "synthpop",
  "electropop",
  "electro pop",
  "dance pop",
  "dancepop",
  "alternative pop",
  "alternative rock",
  "soft rock",
  "hard rock",
  "punk rock",
  "post rock",
  "nu disco",
  "disco",
  "disco funk",
  "funk",
  "soul",
  "neo soul",
  "rnb",
  "r and b",
  "alternative rnb",
  "hip hop",
  "lofi hip hop",
  "rap",
  "jazz",
  "soft jazz",
  "blues",
  "folk",
  "indie folk",
  "acoustic folk",
  "country",
  "bossa nova",
  "samba",
  "reggae",
  "ambient",
  "downtempo",
  "slowcore",
  "chill",
  "chillout",
  "chill out",
  "house",
  "deep house",
  "techno",
  "trance",
  "edm",
  "electronic",
  "electronic music",
  "classical",
  "instrumental",
  "piano",
  "soft piano",
  "upbeat pop",
  "upbeat music",
  "dance workout",
  "edm hits",
  "energetic pop rock",
  "power pop",
  "acoustic chill",
  "ambient calm",
  "lo fi chill",
  "romantic r b",
  "love songs",
  "love song",
  "happy",
  "soul love songs",
  "acoustic love songs",
  "singer songwriter love",
  "feel good indie",
  "happy indie pop",
  "chill pop good vibes",
  "sunny day pop",
  "indie folk happy",
]);

function isGenericTrack(track: SpotifyTrack): boolean {
  return GENERIC_TITLES.has(normalizeTitle(track.title));
}

function isValidTrack(track: SpotifyTrack): boolean {
  return Boolean(
    track.id &&
    track.title?.trim() &&
    track.artist?.trim() &&
    !isGenericTrack(track) &&
    track.durationMs >= 60000
  );
}

interface TasteProfile {
  favoriteArtistIds: Set<string>;
  favoriteArtistNames: Set<string>;
  dislikedArtistNames: Set<string>;
  genreWeights: Map<string, number>;
  hasSignal: boolean;
}

const cachedTasteProfiles = new Map<
  MoodId,
  {
    profile: TasteProfile;
    at: number;
    feedbackSignature: string;
  }
>();

function getFeedbackSignature(moodId: MoodId): string {
  return getFeedback()
    .filter((item) => item.mood === moodId)
    .map((item) =>
      [
        item.songId,
        item.mood,
        item.value,
        normalize(item.artist),
        [...(item.genres ?? [])].map(normalize).sort().join(","),
        item.createdAt,
      ].join(":")
    )
    .sort()
    .join("|");
}

async function buildTasteProfile(
  moodId: MoodId
): Promise<TasteProfile> {
  const feedbackSignature = getFeedbackSignature(moodId);
  const cached = cachedTasteProfiles.get(moodId);

  if (
    cached &&
    Date.now() - cached.at < TASTE_CACHE_MS &&
    cached.feedbackSignature === feedbackSignature
  ) {
    return cached.profile;
  }

  const favoriteArtistIds = new Set<string>();
  const favoriteArtistNames = new Set<string>();
  const genreCounts = new Map<string, number>();

  // 1. Histórico musical do Spotify.
  const [topResult, savedResult] = await Promise.allSettled([
    fetchUserTopTracks(10),
    fetchUserSavedTracks(10),
  ]);

  const allHistoryTracks: SpotifyTrack[] = [
    ...(topResult.status === "fulfilled" ? topResult.value : []),
    ...(savedResult.status === "fulfilled" ? savedResult.value : []),
  ];

  // Evita contar a mesma faixa duas vezes.
  const seenHistoryIds = new Set<string>();

  const historyTracks = allHistoryTracks.filter((track) => {
    if (seenHistoryIds.has(track.id)) return false;

    seenHistoryIds.add(track.id);
    return true;
  });

  for (const track of historyTracks) {
    favoriteArtistNames.add(normalize(track.artist));
    track.artistIds.forEach((id) => favoriteArtistIds.add(id));
  }

  if (historyTracks.length > 0) {
    const artistIds = historyTracks.flatMap(
      (track) => track.artistIds
    );

    const genresByArtist = await fetchArtistsGenres(artistIds).catch(
      () => ({} as Record<string, string[]>)
    );

    for (const genres of Object.values(genresByArtist)) {
      for (const genre of genres) {
        const key = normalize(genre);
        genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // 2. Feedback somente do mood escolhido.
  const moodFeedback = getFeedback().filter(
    (item) => item.mood === moodId
  );

  for (const item of moodFeedback) {
    if (item.value === "like") {
      favoriteArtistNames.add(normalize(item.artist));
    }
  }

  // 3. Preferências de gênero específicas desse mood.
  const feedbackGenres = getPreferredGenresFromFeedback(moodId);

  for (const [genre, delta] of feedbackGenres) {
    const key = normalize(genre);

    genreCounts.set(
      key,
      (genreCounts.get(key) ?? 0) + delta * 3
    );
  }

  // Normaliza os pesos entre -1 e 1.
  const maxAbsWeight = Math.max(
    1,
    ...[...genreCounts.values()].map((value) =>
      Math.abs(value)
    )
  );

  const genreWeights = new Map<string, number>();

  for (const [genre, weight] of genreCounts) {
    genreWeights.set(genre, weight / maxAbsWeight);
  }

  const dislikedArtistNames = getDislikedArtists(moodId);

  const hasSignal =
    favoriteArtistIds.size > 0 ||
    favoriteArtistNames.size > 0 ||
    dislikedArtistNames.size > 0 ||
    genreWeights.size > 0;

  const profile: TasteProfile = {
    favoriteArtistIds,
    favoriteArtistNames,
    dislikedArtistNames,
    genreWeights,
    hasSignal,
  };

  cachedTasteProfiles.set(moodId, {
    profile,
    at: Date.now(),
    feedbackSignature,
  });

  return profile;
}

function isFamiliarArtist(
  track: SpotifyTrack,
  taste: TasteProfile
): boolean {
  return (
    track.artistIds.some((id) =>
      taste.favoriteArtistIds.has(id)
    ) ||
    taste.favoriteArtistNames.has(normalize(track.artist))
  );
}

function getGenreAffinity(
  genres: string[],
  taste: TasteProfile
): number {
  if (genres.length === 0 || taste.genreWeights.size === 0) {
    return 0;
  }

  const uniqueGenres = [...new Set(genres.map(normalize))];

  const total = uniqueGenres.reduce(
    (sum, genre) =>
      sum + (taste.genreWeights.get(genre) ?? 0),
    0
  );

  return total / uniqueGenres.length;
}

/**
 * Calcula afinidade musical entre 0 e 1.
 * Considera artistas conhecidos, gêneros e feedback do mood.
 */
function tasteScoreFor(
  track: SpotifyTrack,
  genres: string[],
  taste: TasteProfile,
  moodId: MoodId
): number {
  if (taste.dislikedArtistNames.has(normalize(track.artist))) {
    return 0;
  }

  let score = 0.5;

  if (isFamiliarArtist(track, taste)) {
    score += 0.15;
  }

  const genreAffinity = getGenreAffinity(genres, taste);
  score += genreAffinity * 0.25;

  const artistFeedback = getArtistFeedbackScore(
    track.artist,
    moodId
  );

  score += (artistFeedback / 3) * 0.25;

  return Math.max(0, Math.min(1, score));
}

/**
 * Mede a qualidade de uma descoberta.
 * Artistas novos recebem vantagem somente quando seus gêneros
 * apresentam relação com as preferências musicais.
 */
function discoveryScoreFor(
  track: SpotifyTrack,
  genres: string[],
  taste: TasteProfile
): number {
  if (isFamiliarArtist(track, taste)) {
    return 0.5;
  }

  if (genres.length === 0 || taste.genreWeights.size === 0) {
    return 0.5;
  }

  const affinity = getGenreAffinity(genres, taste);

  return Math.max(
    0,
    Math.min(1, 0.5 + affinity * 0.5)
  );
}

/**
 * Busca novos resultados a partir dos gêneros com avaliação positiva.
 */
function buildTasteQueries(
  moodId: MoodId,
  taste: TasteProfile
): string[] {
  const preferredGenres = [...taste.genreWeights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TASTE_QUERIES)
    .map(([genre]) => genre);

  return preferredGenres.map(
    (genre) => `${genre} ${MOOD_KEYWORD[moodId]}`
  );
}

async function collectCandidates(
  queries: string[],
  offset: number
): Promise<SpotifyTrack[]> {
  const settled = await Promise.allSettled(
    queries.map((query) =>
      searchTracks(query, RESULTS_PER_QUERY, offset)
    )
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
      if (!isValidTrack(track)) continue;

      const key = normalizeKey(track);

      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push(track);
    }
  }

  const allFailed = settled.every(
    (result) => result.status === "rejected"
  );

  if (allFailed && firstError) {
    throw firstError;
  }

  return candidates;
}

export async function recommendSongsFromSpotify(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): Promise<{ songs: Song[]; score: number }> {
  const mood = moods.find((item) => item.id === moodId);

  if (!mood) {
    throw new SpotifyApiError(
      "invalid-mood",
      "Não foi possível identificar o clima selecionado."
    );
  }

  const excludeIds = new Set(options?.excludeIds ?? []);
  const targetCount = options?.count ?? TARGET_COUNT;

  const taste = await buildTasteProfile(moodId).catch(
    (): TasteProfile => ({
      favoriteArtistIds: new Set(),
      favoriteArtistNames: new Set(),
      dislikedArtistNames: new Set(),
      genreWeights: new Map(),
      hasSignal: false,
    })
  );

  // Busca principal baseada no mood e em gêneros positivos.
  const queries = [
    ...MOOD_QUERIES[moodId],
    ...buildTasteQueries(moodId, taste),
  ];

  const baseOffset =
    excludeIds.size > 0
      ? Math.floor(Math.random() * 30)
      : 0;

  const extraOffsets =
    targetCount <= 12
      ? []
      : targetCount <= 24
        ? [baseOffset + 10]
        : [baseOffset + 10, baseOffset + 20];

  const batches = await Promise.all(
    [baseOffset, ...extraOffsets].map((offset) =>
      collectCandidates(queries, offset)
    )
  );

  const seenIds = new Set<string>();
  const candidates: SpotifyTrack[] = [];

  for (const batch of batches) {
    for (const track of batch) {
      if (excludeIds.has(track.id) || seenIds.has(track.id)) {
        continue;
      }

      seenIds.add(track.id);
      candidates.push(track);
    }
  }

  if (candidates.length < targetCount && baseOffset !== 0) {
    const fallbackBatch = await collectCandidates(queries, 0);

    for (const track of fallbackBatch) {
      if (excludeIds.has(track.id) || seenIds.has(track.id)) {
        continue;
      }

      seenIds.add(track.id);
      candidates.push(track);
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

  const artistIds = candidates.flatMap(
    (track) => track.artistIds
  );

  const genresByArtist = await fetchArtistsGenres(artistIds).catch(
    () => ({} as Record<string, string[]>)
  );

  const bpmTarget =
    moodId === "energized"
      ? 120
      : moodId === "calm"
        ? 80
        : moodId === "romantic"
          ? 95
          : 100;

  const scored = candidates.map((track) => {
    const genres = track.artistIds.flatMap(
      (id) => genresByArtist[id] ?? []
    );

    const profile = estimateProfile(genres, {
      energy: 0.5,
      valence: 0.5,
    });

    const energyFit =
      1 - distance(profile.energy, mood.energy);

    const valenceFit =
      1 - distance(profile.valence, mood.valence);

    const bpmFit =
      1 - Math.min(
        distance(profile.bpm, bpmTarget) / 100,
        1
      );

    const moodScore =
      energyFit * 0.45 +
      valenceFit * 0.4 +
      bpmFit * 0.15;

    const tasteScore = tasteScoreFor(
      track,
      genres,
      taste,
      moodId
    );

    const discoveryScore = discoveryScoreFor(
      track,
      genres,
      taste
    );

    const combinedScore = taste.hasSignal
      ? moodScore * MOOD_WEIGHT +
        tasteScore * TASTE_WEIGHT +
        discoveryScore * DISCOVERY_WEIGHT
      : moodScore;

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
      moodScore,
      tasteScore,
      discoveryScore,
      primaryArtistId: track.artistIds[0] ?? track.artist,
      isFamiliar: isFamiliarArtist(track, taste),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const maxPerArtist = Math.max(
    MAX_PER_ARTIST,
    Math.ceil(targetCount / 6)
  );

  const selected: (typeof scored)[number][] = [];
  const selectedIds = new Set<string>();
  const artistCount = new Map<string, number>();

  function tryAdd(item: (typeof scored)[number]): boolean {
    if (selectedIds.has(item.song.id)) return false;

    const count = artistCount.get(item.primaryArtistId) ?? 0;

    if (count >= maxPerArtist) return false;

    artistCount.set(item.primaryArtistId, count + 1);
    selected.push(item);
    selectedIds.add(item.song.id);

    return true;
  }

  // Primeiro, seleciona as melhores recomendações gerais.
  const discoveryLimit = taste.hasSignal
    ? Math.min(
        Math.round(targetCount * 0.25),
        targetCount
      )
    : 0;

  const discoveries = scored.filter(
    (item) =>
      !item.isFamiliar &&
      item.discoveryScore >= 0.6 &&
      item.tasteScore >= 0.5
  );

  const mainCandidates = scored.filter(
    (item) => !discoveries.includes(item)
  );

  for (const item of mainCandidates) {
    if (selected.length >= targetCount - discoveryLimit) {
      break;
    }

    tryAdd(item);
  }

  // Depois, inclui descobertas que tenham relação com o gosto pessoal.
  for (const item of discoveries) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // Completa com as melhores opções restantes, sem obrigar descobertas.
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // Último recurso: completa a lista se não houver artistas suficientes.
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      if (selectedIds.has(item.song.id)) continue;

      selected.push(item);
      selectedIds.add(item.song.id);
    }
  }

  const avgScore =
    selected.reduce(
      (total, item) => total + item.score,
      0
    ) / Math.max(selected.length, 1);

  return {
    songs: selected.map((item) => item.song),
    score: Math.round(
      Math.min(Math.max(avgScore * 100, 30), 99)
    ),
  };
}
