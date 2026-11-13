
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
const EXPLORATION_RATIO = 0.3;
const MAX_TASTE_QUERIES = 3;

// O clima escolhido sempre tem prioridade sobre o gosto pessoal.
const MOOD_WEIGHT = 0.8;
const TASTE_WEIGHT = 0.2;

function distance(a: number, b: number) {
  return Math.abs(a - b);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeKey(track: SpotifyTrack): string {
  return `${normalize(track.title)}|${normalize(track.artist)}`;
}
function isGenericTrack(track: SpotifyTrack): boolean {
  const title = normalize(track.title)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  const genericTitles = [
    "upbeat pop",
    "upbeat music",
    "dance workout",
    "edm hits",
    "energetic pop rock",
    "power pop",
    "electro pop",
    "electropop",
    "acoustic chill",
    "dance pop",
    "dancepop",
    "ambient calm",
    "lo fi chill",
    "soft piano",
    "downtempo",
    "romantic r b",
    "love songs",
    "soul love songs",
    "acoustic love songs",
    "singer songwriter love",
    "feel good indie",
    "happy indie pop",
    "chill pop good vibes",
    "sunny day pop",
    "indie folk happy",
  ];

  return genericTitles.includes(title);
}
interface TasteProfile {
  favoriteArtistIds: Set<string>;
  favoriteArtistNames: Set<string>;
  dislikedArtistNames: Set<string>;
  genreWeights: Map<string, number>;
  hasSignal: boolean;
}

let cachedTasteProfile: {
  profile: TasteProfile;
  at: number;
  feedbackSignature: string;
} | null = null;

const TASTE_CACHE_MS = 10 * 60 * 1000;

function getFeedbackSignature(): string {
  return getFeedback()
    .map((item) =>
      [
        item.songId,
        item.value,
        normalize(item.artist),
        [...(item.genres ?? [])].map(normalize).sort().join(","),
      ].join(":")
    )
    .sort()
    .join("|");
}

async function buildTasteProfile(): Promise<TasteProfile> {
  const feedbackSignature = getFeedbackSignature();

  if (
    cachedTasteProfile &&
    Date.now() - cachedTasteProfile.at < TASTE_CACHE_MS &&
    cachedTasteProfile.feedbackSignature === feedbackSignature
  ) {
    return cachedTasteProfile.profile;
  }

  const favoriteArtistIds = new Set<string>();
  const favoriteArtistNames = new Set<string>();
  const dislikedArtistNames = new Set<string>();
  const genreCounts = new Map<string, number>();

  // 1. Histórico do Spotify.
  const [topResult, savedResult] = await Promise.allSettled([
    fetchUserTopTracks(10),
    fetchUserSavedTracks(10),
  ]);

  const historyTracks: SpotifyTrack[] = [
    ...(topResult.status === "fulfilled" ? topResult.value : []),
    ...(savedResult.status === "fulfilled" ? savedResult.value : []),
  ];

  for (const track of historyTracks) {
    favoriteArtistNames.add(normalize(track.artist));
    track.artistIds.forEach((id) => favoriteArtistIds.add(id));
  }

  if (historyTracks.length > 0) {
    const artistIds = historyTracks.flatMap((track) => track.artistIds);

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

  // 2. Feedback dado dentro do Harmoody.
  for (const item of getFeedback()) {
    const artist = normalize(item.artist);

    if (item.value === "like") {
      favoriteArtistNames.add(artist);
    } else {
      dislikedArtistNames.add(artist);
    }
  }

  // Likes aumentam o peso dos gêneros; dislikes diminuem.
  const feedbackGenres = getPreferredGenresFromFeedback();

  for (const [genre, delta] of Object.entries(feedbackGenres)) {
    const key = normalize(genre);
    genreCounts.set(key, (genreCounts.get(key) ?? 0) + delta);
  }

  // Normaliza os pesos positivos e negativos entre -1 e 1.
  const maxAbsWeight = Math.max(
    1,
    ...[...genreCounts.values()].map((value) => Math.abs(value))
  );

  const genreWeights = new Map<string, number>();

  for (const [genre, weight] of genreCounts) {
    genreWeights.set(genre, weight / maxAbsWeight);
  }

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

  cachedTasteProfile = {
    profile,
    at: Date.now(),
    feedbackSignature,
  };

  return profile;
}

function isFamiliarArtist(track: SpotifyTrack, taste: TasteProfile): boolean {
  return (
    track.artistIds.some((id) => taste.favoriteArtistIds.has(id)) ||
    taste.favoriteArtistNames.has(normalize(track.artist))
  );
}

/**
 * Estima o quanto a faixa combina com o histórico musical do usuário.
 * O resultado fica entre 0 e 1.
 */
function tasteScoreFor(
  track: SpotifyTrack,
  genres: string[],
  taste: TasteProfile
): number {
  let score = 0.5;

  if (isFamiliarArtist(track, taste)) {
    score += 0.2;
  }

  if (genres.length > 0 && taste.genreWeights.size > 0) {
    const uniqueGenres = [...new Set(genres.map(normalize))];

    const genreScore =
      uniqueGenres.reduce(
        (sum, genre) => sum + (taste.genreWeights.get(genre) ?? 0),
        0
      ) / uniqueGenres.length;

    score += genreScore * 0.2;
  }

  const artistFeedback = getArtistFeedbackScore(track.artist);
  score += artistFeedback * 0.1;

  // Um dislike reduz a preferência pelo artista, mas não o bloqueia.
  if (taste.dislikedArtistNames.has(normalize(track.artist))) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Busca artistas novos com gêneros semelhantes aos favoritos.
 * Somente gêneros com avaliação positiva entram nessas buscas.
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
      if (isGenericTrack(track)) continue;

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
  const mood = moods.find((item) => item.id === moodId)!;
  const excludeIds = new Set(options?.excludeIds ?? []);
  const targetCount = options?.count ?? TARGET_COUNT;

  const taste = await buildTasteProfile().catch(
    (): TasteProfile => ({
      favoriteArtistIds: new Set(),
      favoriteArtistNames: new Set(),
      dislikedArtistNames: new Set(),
      genreWeights: new Map(),
      hasSignal: false,
    })
  );

  // As buscas principais sempre partem do clima selecionado.
  const queries = [
    ...MOOD_QUERIES[moodId],
    ...buildTasteQueries(moodId, taste),
  ];

  const baseOffset =
    excludeIds.size > 0 ? Math.floor(Math.random() * 30) : 0;

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
      if (excludeIds.has(track.id) || seenIds.has(track.id)) continue;

      seenIds.add(track.id);
      candidates.push(track);
    }
  }

  if (candidates.length < targetCount && baseOffset !== 0) {
    const fallbackBatch = await collectCandidates(queries, 0);

    for (const track of fallbackBatch) {
      if (excludeIds.has(track.id) || seenIds.has(track.id)) continue;

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

  const artistIds = candidates.flatMap((track) => track.artistIds);

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

    // Sem gêneros conhecidos, usamos um perfil neutro.
    // Assim, não fingimos que a faixa combina perfeitamente com o mood.
    const profile = estimateProfile(genres, {
      energy: 0.5,
      valence: 0.5,
    });

    const energyFit = 1 - distance(profile.energy, mood.energy);
    const valenceFit = 1 - distance(profile.valence, mood.valence);
    const bpmFit =
      1 - Math.min(distance(profile.bpm, bpmTarget) / 100, 1);

    const moodScore =
      energyFit * 0.45 +
      valenceFit * 0.4 +
      bpmFit * 0.15;

    const tasteScore = tasteScoreFor(track, genres, taste);

    const combinedScore = taste.hasSignal
      ? moodScore * MOOD_WEIGHT + tasteScore * TASTE_WEIGHT
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
      primaryArtistId: track.artistIds[0] ?? track.artist,
      isFamiliar: isFamiliarArtist(track, taste),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const maxPerArtist = Math.max(
    MAX_PER_ARTIST,
    Math.ceil(targetCount / 6)
  );

  const explorationSlots = taste.hasSignal
    ? Math.max(1, Math.round(targetCount * EXPLORATION_RATIO))
    : 0;

  const mainSlots = targetCount - explorationSlots;

  const artistCount = new Map<string, number>();
  const selected: (typeof scored)[number][] = [];
  const selectedIds = new Set<string>();

  function tryAdd(item: (typeof scored)[number]): boolean {
    if (selectedIds.has(item.song.id)) return false;

    const count = artistCount.get(item.primaryArtistId) ?? 0;

    if (count >= maxPerArtist) return false;

    artistCount.set(item.primaryArtistId, count + 1);
    selected.push(item);
    selectedIds.add(item.song.id);

    return true;
  }

  // 1. Seleciona primeiro as melhores faixas considerando clima + gosto.
  for (const item of scored) {
    if (selected.length >= mainSlots) break;
    tryAdd(item);
  }

  // 2. Reserva vagas para artistas novos.
  // Dentro desse grupo, o clima escolhido é o principal critério.
  const discoveries = scored
    .filter((item) => !item.isFamiliar)
    .sort(
      (a, b) =>
        b.moodScore - a.moodScore ||
        b.score - a.score
    );

  for (const item of discoveries) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // 3. Se ainda houver vagas, completa com as melhores faixas restantes.
  for (const item of scored) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // 4. Último recurso: completa a lista mesmo que ultrapasse o limite
  // de faixas por artista.
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      if (selectedIds.has(item.song.id)) continue;

      selected.push(item);
      selectedIds.add(item.song.id);
    }
  }

  const avgScore =
    selected.reduce((total, item) => total + item.score, 0) /
    Math.max(selected.length, 1);

  return {
    songs: selected.map((item) => item.song),
    score: Math.round(Math.min(Math.max(avgScore * 100, 30), 99)),
  };
}
