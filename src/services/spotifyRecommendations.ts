import { moods } from "../data";
import { MoodId, Song, SpotifyTrack } from "../types";
import {
  fetchUserSavedTracks,
  fetchUserTopTracks,
  searchTracks,
  SpotifyApiError,
} from "./spotifyApi";
import { estimateProfile } from "./moodProfile";
import { getValidAccessToken } from "./spotifyAuth";
import { cachedTasteData, loadCandidatePool, saveCandidatePool, syncSpotifySession, type CandidatePool, type SearchHint } from "./recommendationCache";
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
  light: ["indie pop", "indie folk", "acoustic folk", "chamber pop", "jangle pop", "bedroom pop", "sophisti-pop", "soft pop"],
};
const BPM_TARGETS: Record<MoodId, number> = { energized: 120, calm: 80, romantic: 95, light: 100 };
const RECENT_KEY = "harmoody_recent_recommendations_v1";
const MAX_RECENT = 100;
const RECENT_PER_MOOD = 48;
const RESULTS_PER_QUERY = 10;
const DEFAULT_COUNT = 12;
// Termos simples servem como plano B quando o filtro genre: não retorna faixas.
const MOOD_SEARCH_TERMS: Record<MoodId, string[]> = {
  energized: ["dance pop", "electropop", "indie dance", "pop rock"],
  calm: ["dream pop", "acoustic chill", "soft jazz", "indie folk"],
  romantic: ["neo soul", "indie love songs", "bedroom pop", "bossa nova"],
  light: ["indie folk", "soft indie pop", "acoustic folk", "chamber pop"],
};

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

// Exclui títulos que são apenas etiquetas de gênero ou coleções genéricas.
// A comparação é exata depois de normalizar pontuação: não bloqueia, por
// exemplo, uma música legítima chamada "Indie Pop Heart".
const GENERIC_TITLES = new Set([
  "pop rock", "dance pop", "indie pop", "synthpop", "electropop",
  "indie dance", "nu disco", "power pop", "alternative dance",
  "dream pop", "ambient", "indie folk", "acoustic folk", "acoustic chill",
  "lofi hip hop", "lo fi hip hop", "lofi", "lo fi", "slowcore",
  "soft jazz", "downtempo", "neo soul", "alternative r b", "soul",
  "soul ballads", "bedroom pop", "bossa nova", "soft rock",
  "sunshine pop", "jangle pop", "twee pop", "chamber pop",
  "soft pop", "indie love songs", "feel good indie", "love songs",
  "romantic songs", "chill music", "relaxing music", "background music",
]);

function isGenericTitle(title: string): boolean {
  const clean = norm(title)
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Alguns resultados incluem apenas ano ou "music" no fim do gênero.
  const withoutYear = clean.replace(/\s+(?:20\d{2}|music|playlist)$/, "").trim();
  return GENERIC_TITLES.has(clean) || GENERIC_TITLES.has(withoutYear);
}

function valid(t: SpotifyTrack): boolean {
  if (!t.id || !t.title?.trim() || !t.artist?.trim() || t.durationMs < 60000) return false;
  if (/\b(karaoke|tribute|nightcore|sped up|slowed|8d audio)\b/i.test(t.title)) return false;
  if (isGenericTitle(t.title)) return false;
  return true;
}

interface Taste {
  artists: Set<string>;
  artistIds: Set<string>;
  genres: Map<string, number>;
  hasSignal: boolean;
  tracks: SpotifyTrack[];
  artistWeights: Map<string, number>;
}

async function getTaste(moodId: MoodId): Promise<Taste> {
  // O gosto musical só é buscado novamente depois do TTL (ou troca de conta).
  // O feedback local continua sendo lido a cada recomendação.
  const tracks = await cachedTasteData("spotify-taste", async () => {
    const [top, saved] = await Promise.allSettled([fetchUserTopTracks(10), fetchUserSavedTracks(10)]);
    const topTracks = top.status === "fulfilled" ? top.value : [];
    const savedTracks = saved.status === "fulfilled" ? saved.value : [];
    if (!topTracks.length && !savedTracks.length &&
        (top.status === "rejected" || saved.status === "rejected")) {
      throw top.status === "rejected" ? top.reason :
        saved.status === "rejected" ? saved.reason : new SpotifyApiError("no-taste", "Preferências indisponíveis.");
    }
    return { topTracks, savedTracks };
  });
  const allTracks = [...tracks.topTracks, ...tracks.savedTracks];
  const artists = new Set<string>();
  const artistIds = new Set<string>();
  const artistWeights = new Map<string, number>();
  const addArtist = (artist: string, weight: number) => {
    const name = norm(artist);
    if (!name) return;
    artists.add(name);
    artistWeights.set(name, (artistWeights.get(name) ?? 0) + weight);
  };
  tracks.topTracks.forEach((track, index) => {
    for (const artist of track.artist.split(",")) addArtist(artist, 1.6 - index * 0.08);
  });
  tracks.savedTracks.forEach((track) => {
    for (const artist of track.artist.split(",")) addArtist(artist, 0.7);
  });
  allTracks.forEach((track) => track.artistIds.forEach((id) => artistIds.add(id)));
  const feedback = getFeedback().filter((item) => item.mood === moodId);
  for (const item of feedback) {
    if (item.value === "like") for (const artist of item.artist.split(",")) addArtist(artist, 1.8);
    else for (const artist of item.artist.split(",")) {
      const name = norm(artist);
      artistWeights.set(name, Math.max(0, (artistWeights.get(name) ?? 0) - 1.6));
    }
  }
  const counts = new Map<string, number>();
  // Apenas gêneros realmente registrados no feedback, não nomes de consultas.
  for (const [genre, delta] of getPreferredGenresFromFeedback(moodId)) {
    const key = norm(genre);
    counts.set(key, (counts.get(key) ?? 0) + delta * 3);
  }
  const max = Math.max(1, ...[...counts.values()].map(Math.abs));
  const genres = new Map([...counts].map(([genre, count]) => [genre, count / max]));
  return { artists, artistIds, artistWeights, genres, tracks: allTracks,
    hasSignal: artists.size > 0 || genres.size > 0 || feedback.length > 0 };

}

function queriesFor(moodId: MoodId, taste: Taste): string[] {
  // Metade das buscas usa sinais da conta; a outra metade explora o mood.
  // Evita consultar /artists/{id}, reduzindo risco de 429.
  const favoriteArtists = [...taste.artistWeights]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8).map(([name]) => name);
  // A primeira busca deve partir do perfil da conta; não de termos aleatórios.
  const artistQueries = favoriteArtists.slice(0, 3)
    .map((name) => `artist:"${name.replace(/"/g, "")}"`);
  const personalGenre = [...taste.genres]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1).map(([genre]) => `genre:"${genre.replace(/"/g, "")}"`);
  // Termos mais coerentes com o perfil estimado; evita que o modo Leve
  // pesquise estilos que a estimativa classifica como muito agitados.
  const moodSearchGenres: Record<MoodId, string[]> = {
    energized: ["dance pop", "electropop", "pop rock", "indie dance"],
    calm: ["ambient", "indie folk", "downtempo", "soft jazz", "lo-fi"],
    romantic: ["neo soul", "bedroom pop", "indie folk", "bossa nova"],
    light: ["indie folk", "bedroom pop", "indie pop", "acoustic folk"],
  };
  const moodQuery = shuffle(moodSearchGenres[moodId]).slice(0, 1)
    .map((genre) => `genre:"${genre}"`);
  // Sem perfil musical, fazemos uma descoberta por mood; com perfil, usamos
  // mais espaço para procurar músicas dos artistas favoritos.
  const discoveryQuery = taste.hasSignal
    ? []
    : shuffle(MOOD_SEARCH_TERMS[moodId]).slice(0, 2);
  return [...new Set([...artistQueries, ...personalGenre, ...moodQuery, ...discoveryQuery])].slice(0, 4);
}

// Conta resultados realmente novos; excluir músicas vistas não pode enganar o fallback.
function availableCount(pool: SpotifyTrack[], excluded: Set<string>, moodId: MoodId): number {
  const unique = new Set<string>();
  for (const track of pool) {
    if (!valid(track) || excluded.has(track.id) || getFeedbackForSong(track.id, moodId) === "dislike") continue;
    unique.add(keyOf(track));
  }
  return unique.size;
}


function hintForQuery(query: string): SearchHint {
  if (query.startsWith('genre:"')) return { term: query.slice(7, -1), kind: "genre" };
  if (query.startsWith('artist:"')) return { term: query.slice(8, -1), kind: "artist" };
  return { term: query, kind: "term" };
}

async function searchMany(
  queries: string[], offset: number, hints: Map<string, SearchHint>
): Promise<SpotifyTrack[]> {
  if (!queries.length) return [];
  const results = await Promise.allSettled(queries.map((query) => searchTracks(query, RESULTS_PER_QUERY, offset)));
  const ok = results.filter((r): r is PromiseFulfilledResult<SpotifyTrack[]> => r.status === "fulfilled");
  if (!ok.length) {
    const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw error?.reason ?? new SpotifyApiError("spotify-error", "Não foi possível buscar músicas.");
  }
  const tracks: SpotifyTrack[] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const hint = hintForQuery(queries[index]);
    for (const track of result.value.filter(valid)) {
      // Guardamos de qual pesquisa a faixa veio, não inventamos gêneros reais.
      const previous = hints.get(track.id);
      const rank = { genre: 3, term: 2, artist: 1 };
      if (!previous || rank[hint.kind] > rank[previous.kind]) hints.set(track.id, hint);
      tracks.push(track);
    }
  });
  if (!tracks.length) {
    const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (error) throw error.reason;
  }
  return tracks;
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
  // Uma conta diferente nunca reutiliza a seleção da anterior.
  const token = await getValidAccessToken();
  syncSpotifySession(token);
  // Se o Spotify recusar o perfil, não fingimos que uma seleção aleatória é personalizada.
  const taste = await getTaste(moodId).catch((error: unknown): Taste => {
    if (error instanceof SpotifyApiError && error.code === "rate-limited") throw error;
    return { artists: new Set(), artistIds: new Set(), artistWeights: new Map(),
      genres: new Map(), tracks: [], hasSignal: false };
  });

  // Só a primeira geração de cada mood faz buscas iniciais.
  // Na troca de faixas e em "Descobrir novas músicas", selecionamos localmente.
  const poolData: CandidatePool = await loadCandidatePool(moodId, async () => {
    const queries = queriesFor(moodId, taste);
    const hints = new Map<string, SearchHint>();
    let tracks: SpotifyTrack[] = [];
    let searchError: unknown = null;
    try {
      tracks = await searchMany(queries, 0, hints);
    } catch (error) {
      searchError = error;
    }
    if (tracks.length < count) {
      // Buscas simples são mais resilientes do que depender só de genre:.
      const extra = MOOD_SEARCH_TERMS[moodId].filter((term) => !queries.includes(term)).slice(0, 2);
      try { tracks.push(...await searchMany(extra, 0, hints)); }
      catch (error) { searchError = searchError ?? error; }
    }
    if (!tracks.length && !taste.tracks.length && searchError) throw searchError;
    return { tracks: [...tracks, ...taste.tracks], hints, queries, nextOffset: 10 };
  });
  let pool = poolData.tracks;
  const hints = poolData.hints;

  // Reabastecimento progressivo: o cache inicial não é um catálogo infinito.
  // No máximo DUAS novas pesquisas por clique, sem depender de /artists/{id}.
  // Tentamos primeiro termos ainda não buscados; depois novas páginas.
  if (availableCount(pool, excluded, moodId) < count) {
    const discoveryQueries = [
      ...MOOD_SEARCH_TERMS[moodId],
      ...MOOD_GENRES[moodId].map((genre) => `genre:"${genre}"`),
      ...[...taste.artistWeights].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([artist]) => `artist:"${artist.replace(/"/g, "")}"`),
    ];
    const unseen = [...new Set(discoveryQueries)].filter((query) => !poolData.queries.includes(query));
    const batch = unseen.slice(0, 2);
    let offset = 0;

    if (!batch.length) {
      // Todos os termos já usados: percorre as páginas, sem limite artificial de 20.
      // No máximo duas consultas por tentativa, para não provocar outro 429.
      batch.push(...poolData.queries.slice(0, 2));
      offset = poolData.nextOffset;
      poolData.nextOffset = poolData.nextOffset >= 90 ? 10 : poolData.nextOffset + RESULTS_PER_QUERY;
    } else {
      poolData.queries.push(...batch);
    }

    if (batch.length) {
      try {
        const more = await searchMany(batch, offset, hints);
        poolData.tracks = [...poolData.tracks, ...more];
        pool = poolData.tracks;
        saveCandidatePool(moodId, poolData);
      } catch (error) {
        // Se a busca falhar por cota, o cache continua disponível.
        // Se não houver faixas inéditas, exibimos o erro real abaixo.
        if (availableCount(pool, excluded, moodId) === 0) throw error;
      }
    }
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const candidates = pool.filter((track) => {
    const key = keyOf(track);
    if (!valid(track) || excluded.has(track.id) || seenIds.has(track.id) || seenNames.has(key) || getFeedbackForSong(track.id, moodId) === "dislike") return false;
    seenIds.add(track.id);
    seenNames.add(key);
    return true;
  });
  if (!candidates.length) {
    throw new SpotifyApiError("no-tracks", "As opções inéditas deste clima se esgotaram por enquanto. Tente novamente ou escolha outro mood.");
  }

  // Os termos da pesquisa não comprovam o gênero real da música.
  // Pesos: 55% mood / 35% preferências / 10% descoberta, com exigência
  // mínima de evidência para candidatos completamente desconhecidos.
  const scored = candidates.map((track) => {
    const hint = hints.get(track.id);
    const suggestedGenre = hint && hint.kind !== "artist" ? [hint.term] : [];
    const profile = estimateProfile(suggestedGenre);
    const fit = suggestedGenre.length ? genreFit(suggestedGenre, MOOD_GENRES[moodId]) : null;
    const acoustic = 0.45 * clamp(1 - Math.abs(profile.energy - mood.energy))
      + 0.4 * clamp(1 - Math.abs(profile.valence - mood.valence))
      + 0.15 * clamp(1 - Math.abs(profile.bpm - BPM_TARGETS[moodId]) / 100);
    const sourceConfidence = hint?.kind === "genre" ? 0.55 : hint?.kind === "term" ? 0.32 : 0;
    // Só penaliza energia quando existe alguma pista musical da busca.
    // São estimativas por termo pesquisado, NÃO atributos reais da faixa.
    const inferredFromQuery = Boolean(hint && hint.kind !== "artist");
    let moodMismatchPenalty = 0;
    if (inferredFromQuery) {
      if (moodId === "light" && profile.energy > 0.66) moodMismatchPenalty = 0.16;
      if (moodId === "calm" && profile.energy > 0.58) moodMismatchPenalty = 0.15;
      if (moodId === "romantic" && profile.energy > 0.72) moodMismatchPenalty = 0.12;
      if (moodId === "energized" && profile.energy < 0.40) moodMismatchPenalty = 0.11;
    }
    const moodScore = clamp(acoustic * 0.65 + (fit ?? 0) * 0.2
      + sourceConfidence * 0.15 - moodMismatchPenalty);
    const names = track.artist.split(",").map(norm);
    const familiar = track.artistIds.some((id) => taste.artistIds.has(id)) ||
      names.some((name) => taste.artists.has(name));
    const favoriteStrength = Math.max(0, ...names.map((name) => taste.artistWeights.get(name) ?? 0));
    const affinity = suggestedGenre.length
      ? Math.max(0, taste.genres.get(norm(suggestedGenre[0])) ?? 0) : 0;
    const feedbackScore = clamp(getArtistFeedbackScore(track.artist, moodId) / 3, -1, 1);
    const liked = getFeedbackForSong(track.id, moodId) === "like";
    // Não atribuímos afinidade alta a faixas cujo único sinal é uma busca genérica.
    const tasteScore = clamp(0.18 + 0.37 * clamp(favoriteStrength / 2.8)
      + 0.2 * affinity + 0.2 * feedbackScore + (liked ? 0.15 : 0));
    const discovery = familiar ? 0.35 : (affinity > 0 ? 0.85 : 0.45);
    const score = taste.hasSignal
      ? moodScore * 0.55 + tasteScore * 0.35 + discovery * 0.1 : moodScore;
    const song: Song = {
      id: track.id, title: track.title, artist: track.artist, cover: track.cover,
      bpm: profile.bpm, energy: profile.energy, valence: profile.valence,
      moods: [moodId], spotifyUrl: track.spotifyUrl, estimated: true, genres: [],
    };
    // Nível de confiança: afinidade real vale mais que o termo de uma busca.
    // Uma busca genérica, por si só, não comprova preferência do usuário.
    const personalEvidence = familiar || liked || affinity > 0;
    const moodEvidence = (hint?.kind === "genre" || hint?.kind === "term") && fit !== null && fit > 0;
    return { song, score, artist: track.artistIds[0] ?? norm(track.artist),
      familiar, recent: recent.has(track.id), personalEvidence, moodEvidence, liked, affinity, fit };
  });

  // Na PRIMEIRA recomendação, artistas e curtidas do usuário têm prioridade
  // para que a lista não comece com doze descobertas genéricas. O restante
  // preserva descoberta, mood e variedade. Sem limite fixo por artista.
  const eligible = scored.filter((item) => item.personalEvidence || item.moodEvidence);
  const remaining = eligible.length ? [...eligible] : [...scored];
  const selected: typeof scored = [];
  const artistCounts = new Map<string, number>();
  const TEMPERATURE = 0.085;
  const firstSelection = excluded.size === 0;
  const personalCandidates = remaining.filter((item) => item.personalEvidence).length;
  const personalTarget = firstSelection && taste.hasSignal
    ? Math.min(personalCandidates, Math.ceil(count * 0.6))
    : 0;

  while (selected.length < count && remaining.length > 0) {
    const personalChosen = selected.filter((item) => item.personalEvidence).length;
    // Começamos pelas faixas com algum vínculo real com a conta. Se não há
    // candidatas suficientes, usamos a descoberta por mood sem travar a lista.
    const personalPhase = personalChosen < personalTarget;
    const choices = personalPhase
      ? remaining.filter((item) => item.personalEvidence)
      : remaining;
    const weights = choices.map((item) => {
      const repeats = artistCounts.get(item.artist) ?? 0;
      const diversityPenalty = 0.13 * Math.log2(1 + repeats * 2);
      const recentPenalty = item.recent ? 0.07 : 0;
      const weakEvidencePenalty = taste.hasSignal && !item.personalEvidence ? 0.075 : 0;
      const adjusted = item.score - diversityPenalty - recentPenalty - weakEvidencePenalty;
      return Math.exp((adjusted - 1) / TEMPERATURE);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = Math.random() * total;
    let index = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i];
      if (draw <= 0) { index = i; break; }
    }
    const chosen = choices[index];
    remaining.splice(remaining.indexOf(chosen), 1);
    selected.push(chosen);
    artistCounts.set(chosen.artist, (artistCounts.get(chosen.artist) ?? 0) + 1);
  }

  if (import.meta.env.DEV) {
    console.group(`[HARMOODY] Diagnóstico — ${moodId}`);
    console.table(selected.map((item) => {
      const hint = hints.get(item.song.id);
      return {
        musica: item.song.title,
        artista: item.song.artist,
        origem: hint?.term ?? "Sem origem registrada",
        tipoBusca: hint?.kind ?? "Desconhecido",
        familiar: item.familiar,
        afinidade: item.affinity,
        compatibilidade: item.fit,
        pontuacao: Number(item.score.toFixed(3)),
      };
    }));
    console.groupEnd();
  }

  remember(moodId, selected.map((item) => item.song.id));
  const average = selected.reduce((sum, item) => sum + item.score, 0) / Math.max(selected.length, 1);
  return { songs: selected.map((item) => item.song), score: selected.length ? Math.round(clamp(average, 0.3, 0.99) * 100) : 0 };
}
