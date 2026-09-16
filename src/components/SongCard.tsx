import { useState } from "react";
import { Play, Heart, ThumbsDown } from "lucide-react";
import { MoodId, Song } from "../types";
import { FeedbackValue, getFeedbackForSong, removeFeedback, saveFeedback } from "../services/feedback";

export function SongCard({ song, moodId }: { song: Song; moodId: MoodId }) {
  const [feedback, setFeedback] = useState<FeedbackValue | null>(() => getFeedbackForSong(song.id));

  function openInSpotify() {
    if (song.spotifyUrl) {
      window.open(song.spotifyUrl, "_blank", "noopener,noreferrer");
    }
  }

  function handleFeedback(value: FeedbackValue) {
    const next = feedback === value ? null : value;
    setFeedback(next);
    if (next) {
      saveFeedback(song, moodId, next, song.genres);
    } else {
      removeFeedback(song.id);
    }
  }

  return (
    <article className="song-card">
      <img src={song.cover} alt="" />
      <div className="song-info">
        <strong>{song.title}</strong>
        <span>{song.artist}</span>
        <div className="song-meta">
          <span>{song.estimated ? "~" : ""}{song.bpm} BPM</span>
          <span>Valência {Math.round(song.valence * 100)}%</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
        <button
          type="button"
          title={feedback === "like" ? "Remover 'gostei'" : "Gostei"}
          onClick={() => handleFeedback("like")}
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: 0,
            display: "grid",
            placeItems: "center",
            background: feedback === "like" ? "rgba(236,72,153,.22)" : "rgba(255,255,255,.06)",
            color: feedback === "like" ? "#ec4899" : "#aaa5b8",
          }}
        >
          <Heart size={14} fill={feedback === "like" ? "#ec4899" : "none"} />
        </button>
        <button
          type="button"
          title={feedback === "dislike" ? "Remover 'não gostei'" : "Não gostei"}
          onClick={() => handleFeedback("dislike")}
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: 0,
            display: "grid",
            placeItems: "center",
            background: feedback === "dislike" ? "rgba(139,92,246,.22)" : "rgba(255,255,255,.06)",
            color: feedback === "dislike" ? "#a78bfa" : "#aaa5b8",
          }}
        >
          <ThumbsDown size={14} fill={feedback === "dislike" ? "#a78bfa" : "none"} />
        </button>
        <button
          className="play-button"
          title={song.spotifyUrl ? "Ouvir no Spotify" : "Ouvir"}
          onClick={openInSpotify}
          disabled={!song.spotifyUrl}
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>
    </article>
  );
}
