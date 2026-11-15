
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

/* ==========================================
   CONFIGURAÇÃO DOS MOODS
========================================== */

const MOOD_GENRES: Record<MoodId, string[]> = {
  energized: [
    "dance pop",
    "electropop",
    "synthpop",
    "pop rock",
    "indie dance",
    "nu disco",
    "power pop",
    "alternative dance",
  ],

  calm: [
    "dream pop",
    "ambient",
    "indie folk",
    "acoustic",
    "lo-fi",
    "slowcore",
    "soft jazz",
    "downtempo",
  ],

  romantic: [
    "neo soul",
    "alternative r&b",
    "soul",
    "bedroom pop",
    "dream pop",
    "bossa nova",
    "indie folk",
    "soft rock",
  ],

  light: [
    "indie pop",
    "sunshine pop",
    "jangle pop",
    "twee pop",
    "indie folk",
    "chamber pop",
    "sophisti-pop",
    "soft pop",
  ],
};

const BPM_TARGETS: Record<MoodId, number> = {
  energized: 120,
  calm: 80,
  romantic: 95,
  light: 100,
};

const RESULTS_PER_QUERY = 10;
const TARGET_COUNT = 12;
const MAX_PER_ARTIST = 2;
const MAX_TASTE_QUERIES = 3;
const TASTE_CACHE_MS = 10 * 60 * 1000;

const MOOD_WEIGHT = 0.6;
const TASTE_WEIGHT = 0.3;
const DISCOVERY_WEIGHT = 0.1;

/* ==========================================
   FUNÇÕES AUXILIARES
========================================== */

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(track: SpotifyTrack) {
  return `${normalize(track.title)}|${normalize(track.artist)}`;
}

function normalizeTitle(value: string) {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_TITLES = new Set([
  "pop",
  "rock",
  "indie pop",
  "indie rock",
  "dream pop",
  "dance pop",
  "synthpop",
  "electropop",
  "ambient",
  "jazz",
  "folk",
  "hip hop",
  "lofi",
  "soul",
  "neo soul",
  "bossa nova",
  "love songs",
  "happy",
  "chill",
  "relax",
  "music",
]);

function isValidTrack(track: SpotifyTrack) {
  if (!track.id || !track.title?.trim() || !track.artist?.trim()) {
    return false;
  }

  if (!Number.isFinite(track.durationMs) || track.durationMs < 60000) {
    return false;
  }

  const title = normalizeTitle(track.title);

  if (GENERIC_TITLES.has(title)) {
    return false;
  }

  // Evita versões alternativas que costumam
  // prejudicar a qualidade da seleção.
  const unwantedVersions = [
    /\bkaraoke\b/i,
    /\btribute\b/i,
    /\bsped up\b/i,
    /\bslowed\b/i,
    /\bnightcore\b/i,
    /\b8d audio\b/i,
    /\binstrumental version\b/i,
  ];

  return !unwantedVersions.some((pattern) =>
    pattern.test(track.title)
  );
}

/* ==========================================
   PERFIL MUSICAL DO USUÁRIO
========================================== */

interface TasteProfile {
  favoriteArtistIds: Set<string>;
  favoriteArtistNames: Set<string>;
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

function getFeedbackSignature(moodId: MoodId) {
  return getFeedback()
    .filter((item) => item.mood === moodId)
    .map((item) =>
      [
        item.songId,
        item.mood,
        item.value,
        normalize(item.artist),
        [...(item.genres ?? [])]
          .map(normalize)
          .sort()
          .join(","),
        item.createdAt,
      ].join(":")
    )
    .sort()
    .join("|");
}

async function buildTasteProfile(
  moodId: MoodId
): Promise<TasteProfile> {
  const signature = getFeedbackSignature(moodId);
  const cached = cachedTasteProfiles.get(moodId);

  if (
    cached &&
    Date.now() - cached.at < TASTE_CACHE_MS &&
    cached.feedbackSignature === signature
  ) {
    return cached.profile;
  }

  const favoriteArtistIds = new Set<string>();
  const favoriteArtistNames = new Set<string>();
  const genreCounts = new Map<string, number>();

  const [topResult, savedResult] = await Promise.allSettled([
    fetchUserTopTracks(10),
    fetchUserSavedTracks(10),
  ]);

  const historyTracks: SpotifyTrack[] = [
    ...(topResult.status === "fulfilled"
      ? topResult.value
      : []),
    ...(savedResult.status === "fulfilled"
      ? savedResult.value
      : []),
  ];

  const uniqueTracks = [
    ...new Map(
      historyTracks.map((track) => [track.id, track])
    ).values(),
  ];

  for (const track of uniqueTracks) {
    favoriteArtistNames.add(normalize(track.artist));

    for (const id of track.artistIds) {
      favoriteArtistIds.add(id);
    }
  }

  if (uniqueTracks.length > 0) {
    const artistIds = [
      ...new Set(
        uniqueTracks.flatMap((track) => track.artistIds)
      ),
    ];

    const genresByArtist = await fetchArtistsGenres(
      artistIds
    ).catch(() => ({} as Record<string, string[]>));

    for (const genres of Object.values(genresByArtist)) {
      for (const genre of genres) {
        const key = normalize(genre);

        genreCounts.set(
          key,
          (genreCounts.get(key) ?? 0) + 1
        );
      }
    }
  }

  const moodFeedback = getFeedback().filter(
    (item) => item.mood === moodId
  );

  for (const item of moodFeedback) {
    if (item.value === "like") {
      favoriteArtistNames.add(normalize(item.artist));
    }
  }

  const preferredGenres =
    getPreferredGenresFromFeedback(moodId);

  for (const [genre, delta] of preferredGenres) {
    const key = normalize(genre);

    genreCounts.set(
      key,
      (genreCounts.get(key) ?? 0) + delta * 3
    );
  }

  const maxWeight = Math.max(
    1,
    ...[...genreCounts.values()].map(Math.abs)
  );

  const genreWeights = new Map<string, number>();

  for (const [genre, weight] of genreCounts) {
    genreWeights.set(genre, weight / maxWeight);
  }

  const profile: TasteProfile = {
    favoriteArtistIds,
    favoriteArtistNames,
    genreWeights,
    hasSignal:
      favoriteArtistNames.size > 0 ||
      genreWeights.size > 0,
  };

  cachedTasteProfiles.set(moodId, {
    profile,
    at: Date.now(),
    feedbackSignature: signature,
  });

  return profile;
}

/* ==========================================
   BUSCAS MAIS PRECISAS
========================================== */

function buildMoodQueries(moodId: MoodId) {
  return MOOD_GENRES[moodId].map(
    (genre) => `genre:"${genre}"`
  );
}

function buildTasteQueries(
  taste: TasteProfile
): string[] {
  return [...taste.genreWeights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TASTE_QUERIES)
    .map(([genre]) => `genre:"${genre}"`);
}

function buildArtistQueries(taste: TasteProfile) {
  return [...taste.favoriteArtistNames]
    .filter(Boolean)
    .slice(0, 3)
    .map((artist) => {
      const safeArtist = artist.replace(/"/g, "");
      return `artist:"${safeArtist}"`;
    });
}

async function collectCandidates(
  queries: string[],
  offset: number
): Promise<SpotifyTrack[]> {
  const results = await Promise.allSettled(
    queries.map((query) =>
      searchTracks(query, RESULTS_PER_QUERY, offset)
    )
  );

  const candidates: SpotifyTrack[] = [];
  const seen = new Set<string>();

  let firstError: unknown = null;

  for (const result of results) {
    if (result.status === "rejected") {
      firstError ??= result.reason;
      continue;
    }

    for (const track of result.value) {
      if (!isValidTrack(track)) continue;

      const key = normalizeKey(track);

      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push(track);
    }
  }

  if (
    results.length > 0 &&
    results.every((item) => item.status === "rejected") &&
    firstError
  ) {
    throw firstError;
  }

  return candidates;
}

/* ==========================================
   COMPATIBILIDADE DE GÊNEROS
========================================== */

function isFamiliarArtist(
  track: SpotifyTrack,
  taste: TasteProfile
) {
  return (
    track.artistIds.some((id) =>
      taste.favoriteArtistIds.has(id)
    ) ||
    taste.favoriteArtistNames.has(
      normalize(track.artist)
    )
  );
}

function getGenreAffinity(
  genres: string[],
  taste: TasteProfile
) {
  if (!genres.length || !taste.genreWeights.size) {
    return 0;
  }

  const unique = [...new Set(genres.map(normalize))];

  const total = unique.reduce(
    (sum, genre) =>
      sum + (taste.genreWeights.get(genre) ?? 0),
    0
  );

  return total / unique.length;
}

function getMoodGenreFit(
  genres: string[],
  moodId: MoodId
) {
  if (!genres.length) {
    return null;
  }

  const expected = MOOD_GENRES[moodId].map(normalize);

  let best = 0;

  for (const genre of genres) {
    const normalized = normalize(genre);

    for (const target of expected) {
      if (normalized === target) {
        best = Math.max(best, 1);
      } else if (
        normalized.includes(target) ||
        target.includes(normalized)
      ) {
        // Correspondência parcial recebe menos peso.
        if (normalized.length >= 4 && target.length >= 4) {
          best = Math.max(best, 0.7);
        }
      }
    }
  }

  return best;
}

/* ==========================================
   PONTUAÇÃO PERSONALIZADA
========================================== */

function tasteScoreFor(
  track: SpotifyTrack,
  genres: string[],
  taste: TasteProfile,
  moodId: MoodId
) {
  let score = 0.5;

  if (isFamiliarArtist(track, taste)) {
    score += 0.15;
  }

  score += getGenreAffinity(genres, taste) * 0.25;

  const artistFeedback = getArtistFeedbackScore(
    track.artist,
    moodId
  );

  score += (artistFeedback / 3) * 0.25;

  if (
    getFeedbackForSong(track.id, moodId) === "like"
  ) {
    score += 0.1;
  }

  return clamp(score);
}

function discoveryScoreFor(
  track: SpotifyTrack,
  genres: string[],
  taste: TasteProfile
) {
  if (isFamiliarArtist(track, taste)) {
    return 0.5;
  }

  if (!genres.length || !taste.genreWeights.size) {
    return 0.5;
  }

  return clamp(
    0.5 + getGenreAffinity(genres, taste) * 0.5
  );
}

/* ==========================================
   RECOMENDAÇÃO PRINCIPAL
========================================== */

export async function recommendSongsFromSpotify(
  moodId: MoodId,
  options?: {
    excludeIds?: string[];
    count?: number;
  }
): Promise<{ songs: Song[]; score: number }> {
  const mood = moods.find(
    (item) => item.id === moodId
  );

  if (!mood) {
    throw new SpotifyApiError(
      "invalid-mood",
      "Não foi possível identificar o clima selecionado."
    );
  }

  const excludeIds = new Set(
    options?.excludeIds ?? []
  );

  const targetCount = Math.max(
    0,
    Math.floor(options?.count ?? TARGET_COUNT)
  );

  if (targetCount === 0) {
    return { songs: [], score: 0 };
  }

  const taste = await buildTasteProfile(
    moodId
  ).catch(
    (): TasteProfile => ({
      favoriteArtistIds: new Set<string>(),
      favoriteArtistNames: new Set<string>(),
      genreWeights: new Map<string, number>(),
      hasSignal: false,
    })
  );

  const moodQueries = buildMoodQueries(moodId);
  const tasteQueries = buildTasteQueries(taste);
  const artistQueries = buildArtistQueries(taste);

  const queries = [
    ...new Set([
      ...moodQueries,
      ...tasteQueries,
      ...artistQueries,
    ]),
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

  const candidates: SpotifyTrack[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  function addCandidate(track: SpotifyTrack) {
    const key = normalizeKey(track);

    if (
      excludeIds.has(track.id) ||
      seenIds.has(track.id) ||
      seenKeys.has(key) ||
      getFeedbackForSong(track.id, moodId) === "dislike"
    ) {
      return;
    }

    seenIds.add(track.id);
    seenKeys.add(key);
    candidates.push(track);
  }

  for (const batch of batches) {
    for (const track of batch) {
      addCandidate(track);
    }
  }

  // Busca complementar se as consultas específicas
  // retornarem poucas músicas.
  if (candidates.length < targetCount) {
    const fallbackQueries = [
      ...new Set([
        ...MOOD_GENRES[moodId].slice(0, 4),
        ...artistQueries,
      ]),
    ];

    const fallback = await collectCandidates(
      fallbackQueries,
      0
    ).catch(() => [] as SpotifyTrack[]);

    for (const track of fallback) {
      addCandidate(track);
    }
  }

  if (candidates.length === 0) {
    throw new SpotifyApiError(
      "no-tracks",
      "Não encontramos músicas para esse clima agora."
    );
  }

  /* ========================================
     ANÁLISE DOS CANDIDATOS
  ======================================== */

  const artistIds = [
    ...new Set(
      candidates.flatMap((track) => track.artistIds)
    ),
  ];

  const genresByArtist = await fetchArtistsGenres(
    artistIds
  ).catch(() => ({} as Record<string, string[]>));

  const bpmTarget = BPM_TARGETS[moodId];

  const scored = candidates.map((track) => {
    const genres = [
      ...new Set(
        track.artistIds.flatMap(
          (id) => genresByArtist[id] ?? []
        )
      ),
    ];

    const profile = estimateProfile(genres);

    const energyFit = clamp(
      1 - Math.abs(profile.energy - mood.energy)
    );

    const valenceFit = clamp(
      1 - Math.abs(profile.valence - mood.valence)
    );

    const bpmFit = clamp(
      1 - Math.abs(profile.bpm - bpmTarget) / 100
    );

    const moodGenreFit = getMoodGenreFit(
      genres,
      moodId
    );

    const acousticMoodScore =
      energyFit * 0.45 +
      valenceFit * 0.4 +
      bpmFit * 0.15;

    // Gêneros compatíveis reforçam o mood.
    // Sem gêneros disponíveis, usamos apenas
    // o perfil estimado, sem presumir compatibilidade.
    const moodScore =
      moodGenreFit === null
        ? acousticMoodScore
        : acousticMoodScore * 0.7 +
          moodGenreFit * 0.3;

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
      primaryArtistId:
        track.artistIds[0] ?? normalize(track.artist),
      isFamiliar: isFamiliarArtist(track, taste),
      genreFit: moodGenreFit,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  /* ========================================
     SELEÇÃO FINAL E DIVERSIDADE
  ======================================== */

  const maxPerArtist = Math.max(
    MAX_PER_ARTIST,
    Math.ceil(targetCount / 6)
  );

  const selected: (typeof scored)[number][] = [];
  const selectedIds = new Set<string>();
  const artistCount = new Map<string, number>();

  function tryAdd(
    item: (typeof scored)[number],
    enforceArtistLimit = true
  ) {
    if (selectedIds.has(item.song.id)) {
      return false;
    }

    const count =
      artistCount.get(item.primaryArtistId) ?? 0;

    if (
      enforceArtistLimit &&
      count >= maxPerArtist
    ) {
      return false;
    }

    selectedIds.add(item.song.id);

    artistCount.set(
      item.primaryArtistId,
      count + 1
    );

    selected.push(item);

    return true;
  }

  // Primeiro, priorizamos faixas com evidência
  // de compatibilidade de gênero.
  const strongMatches = scored.filter(
    (item) => item.genreFit !== null &&
      item.genreFit >= 0.7
  );

  for (const item of strongMatches) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // Depois, usamos a classificação completa
  // para preencher as vagas restantes.
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

  const discoveryIds = new Set(
    discoveries.map((item) => item.song.id)
  );

  for (const item of scored) {
    if (
      selected.length >=
      targetCount - discoveryLimit
    ) {
      break;
    }

    if (!discoveryIds.has(item.song.id)) {
      tryAdd(item);
    }
  }

  for (const item of discoveries) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  for (const item of scored) {
    if (selected.length >= targetCount) break;
    tryAdd(item);
  }

  // Último recurso: permite mais faixas do
  // mesmo artista para não retornar lista vazia.
  if (selected.length < targetCount) {
    for (const item of scored) {
      if (selected.length >= targetCount) break;
      tryAdd(item, false);
    }
  }

  const avgScore =
    selected.reduce(
      (total, item) => total + item.score,
      0
    ) / Math.max(selected.length, 1);

  return {
    songs: selected.map((item) => item.song),
    score:
      selected.length === 0
        ? 0
        : Math.round(
            Math.min(
              Math.max(avgScore * 100, 30),
              99
            )
          ),
  };
}
