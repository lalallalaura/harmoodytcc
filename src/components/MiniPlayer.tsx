
import { X, ExternalLink } from "lucide-react";
import type { Song } from "../types";

interface MiniPlayerProps {
  song: Song;
  onClose: () => void;
}

export function MiniPlayer({ song, onClose }: MiniPlayerProps) {
  const match = song.spotifyUrl?.match(
    /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/
  );

  if (!match) return null;

  const trackId = match[1];

  return (
    <aside className="harmoody-mini-player" aria-label="Player de música">
      <div className="mini-player-heading">
        <span>HARMOODY / NOW PLAYING</span>

        <button
          type="button"
          className="mini-player-close"
          onClick={onClose}
          aria-label="Fechar player"
          title="Fechar player"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mini-player-song">
        {song.cover && (
          <img src={song.cover} alt="" />
        )}

        <div className="mini-player-info">
          <strong>{song.title}</strong>
          <span>{song.artist}</span>
        </div>

        <a
  href={song.spotifyUrl ?? undefined}
  target="_blank"
  rel="noopener noreferrer"
  title="Abrir no Spotify"
  aria-label={`Abrir ${song.title} no Spotify`}
>
  <ExternalLink size={17} />
</a>
      </div>

      <iframe
        key={trackId}
        title={`Ouvir ${song.title} no Spotify`}
        src={`https://open.spotify.com/embed/track/${trackId}?utm_source=generator`}
        width="100%"
        height="152"
        style={{ border: 0, borderRadius: 12 }}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="eager"
      />
    </aside>
  );
}
