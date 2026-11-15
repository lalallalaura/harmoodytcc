import { moods, songs } from "../data";
import { MoodId, Song } from "../types";
import { isSpotifyConnected } from "./spotifyAuth";
import { recommendSongsFromSpotify } from "./spotifyRecommendations";
import {
  getArtistFeedbackScore,
  getFeedback,
  getFeedbackForSong,
} from "./feedback";

function distance(a: number, b: number) {
  return Math.abs(a - b);
}

function recommendFromLocalData(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): { songs: Song[]; score: number } {
  const mood = moods.find((item) => item.id === moodId);

  if (!mood) {
    return { songs: [], score: 0 };
  }

  const excludedIds = new Set(options?.excludeIds ?? []);
  const count = Math.max(0, options?.count ?? 12);

  const hasFeedback = getFeedback().some(
    (item) => item.mood === moodId
  );

  const bpmTarget =
    moodId === "energized"
      ? 120
      : moodId === "calm"
      ? 80
      : moodId === "romantic"
      ? 95
      : 100;

  const ranked = songs
    .filter(
      (song) =>
        !excludedIds.has(song.id) &&
        getFeedbackForSong(song.id, moodId) !== "dislike"
    )
    .map((song) => {
      const moodBonus = song.moods.includes(moodId) ? 0.35 : 0;

      const energyFit =
        1 - distance(song.energy, mood.energy);

      const valenceFit =
        1 - distance(song.valence, mood.valence);

      const bpmFit =
        1 - Math.min(distance(song.bpm, bpmTarget) / 100, 1);

      const moodScore =
        moodBonus +
        energyFit * 0.3 +
        valenceFit * 0.25 +
        bpmFit * 0.1;

      const feedbackScore = getArtistFeedbackScore(
        song.artist,
        moodId
      );

      const tasteScore = Math.max(
        0,
        Math.min(1, 0.5 + feedbackScore * 0.15)
      );

      const score = hasFeedback
        ? moodScore * 0.7 + tasteScore * 0.3
        : moodScore;

      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count);

  const avgFit =
    ranked.reduce((total, item) => {
      const energyFit =
        1 - distance(item.song.energy, mood.energy);

      const valenceFit =
        1 - distance(item.song.valence, mood.valence);

      const bpmFit =
        1 -
        Math.min(
          distance(item.song.bpm, bpmTarget) / 100,
          1
        );

      return (
        total +
        energyFit * 0.45 +
        valenceFit * 0.4 +
        bpmFit * 0.15
      );
    }, 0) / Math.max(ranked.length, 1);

  return {
    songs: ranked.map((item) => item.song),
    score:
      ranked.length === 0
        ? 0
        : Math.round(
            Math.min(Math.max(avgFit * 100, 30), 99)
          ),
  };
}

export interface RecommendationResult {
  songs: Song[];
  score: number;
  source: "spotify" | "local";
  notice?: string;
}

export async function recommendSongs(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): Promise<RecommendationResult> {
  if (!isSpotifyConnected()) {
    return {
      ...recommendFromLocalData(moodId, options),
      source: "local",
      notice:
        "Conecte seu Spotify no Perfil para receber recomendações com músicas reais!",
    };
  }

  try {
    const result = await recommendSongsFromSpotify(
      moodId,
      options
    );

    return {
      ...result,
      source: "spotify",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Não conseguimos buscar músicas no Spotify agora. Mostrando sugestões locais.";

    return {
      ...recommendFromLocalData(moodId, options),
      source: "local",
      notice: message,
    };
  }
}