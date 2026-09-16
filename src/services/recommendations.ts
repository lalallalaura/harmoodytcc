import { moods, songs } from "../data";
import { MoodId, Song } from "../types";
import { isSpotifyConnected } from "./spotifyAuth";
import { recommendSongsFromSpotify } from "./spotifyRecommendations";
import { getArtistFeedbackScore, getFeedback } from "./feedback";

function distance(a: number, b: number) {
  return Math.abs(a - b);
}

function recommendFromLocalData(moodId: MoodId): { songs: Song[]; score: number } {
  const mood = moods.find((item) => item.id === moodId)!;

  // Sem Spotify não temos top tracks nem gêneros reais, então o único
  // sinal de gosto pessoal disponível aqui é o feedback ❤️/👎 já dado
  // pelo próprio usuário nesta tela (por artista, já que as músicas
  // locais não têm gênero cadastrado).
  const hasFeedback = getFeedback().length > 0;

  const ranked = songs
    .map((song) => {
      const moodBonus = song.moods.includes(moodId) ? 0.35 : 0;
      const energyFit = 1 - distance(song.energy, mood.energy);
      const valenceFit = 1 - distance(song.valence, mood.valence);
      const bpmTarget =
        moodId === "energized" ? 120 : moodId === "calm" ? 80 : moodId === "romantic" ? 95 : 100;
      const bpmFit = 1 - Math.min(distance(song.bpm, bpmTarget) / 100, 1);
      const moodScore = moodBonus + energyFit * 0.3 + valenceFit * 0.25 + bpmFit * 0.1;

      const feedbackScore = getArtistFeedbackScore(song.artist); // -3..3
      const tasteScore = Math.max(0, Math.min(1, 0.5 + feedbackScore * 0.15));
      const score = hasFeedback ? moodScore * 0.7 + tasteScore * 0.3 : moodScore;

      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // Mesmo critério de sensibilidade usado no modo Spotify: sem piso
  // artificial de 50, considerando energy + valence + bpm.
  const avgFit =
    ranked.reduce((total, item) => {
      const energyFit = 1 - distance(item.song.energy, mood.energy);
      const valenceFit = 1 - distance(item.song.valence, mood.valence);
      const bpmTarget =
        moodId === "energized" ? 120 : moodId === "calm" ? 80 : moodId === "romantic" ? 95 : 100;
      const bpmFit = 1 - Math.min(distance(item.song.bpm, bpmTarget) / 100, 1);
      return total + (energyFit * 0.45 + valenceFit * 0.4 + bpmFit * 0.15);
    }, 0) / Math.max(ranked.length, 1);

  return {
    songs: ranked.map((item) => item.song),
    score: Math.round(Math.min(Math.max(avgFit * 100, 30), 99)),
  };
}

export interface RecommendationResult {
  songs: Song[];
  score: number;
  source: "spotify" | "local";
  /** Mensagem amigável para mostrar ao usuário quando cai no fallback local */
  notice?: string;
}

export async function recommendSongs(
  moodId: MoodId,
  options?: { excludeIds?: string[]; count?: number }
): Promise<RecommendationResult> {
  if (!isSpotifyConnected()) {
    return {
      ...recommendFromLocalData(moodId),
      source: "local",
      notice: "Conecte seu Spotify no Perfil para receber recomendações com músicas reais!",
    };
  }

  try {
    const result = await recommendSongsFromSpotify(moodId, options);
    return { ...result, source: "spotify" };
  } catch (err: any) {
    return {
      ...recommendFromLocalData(moodId),
      source: "local",
      notice: err?.message ?? "Não conseguimos buscar músicas no Spotify agora. Mostrando sugestões locais.",
    };
  }
}