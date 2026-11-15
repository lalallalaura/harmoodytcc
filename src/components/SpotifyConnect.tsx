import { useEffect, useState } from "react";
import { Music2, CheckCircle2, RefreshCcw, LogOut } from "lucide-react";
import { disconnectSpotify, isSpotifyConnected, startSpotifyLogin } from "../services/spotifyAuth";
import { fetchUserTopTracks, type SpotifyTimeRange } from "../services/spotifyApi";
import { SpotifyTrack } from "../types";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

export function SpotifyConnect() {
  const [connected, setConnected] = useState(isSpotifyConnected());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [timeRange, setTimeRange] = useState<SpotifyTimeRange>("short_term");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!connected) {
      setTracks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setTracks([]);
      try {
        const result = await fetchUserTopTracks(8, timeRange);
        if (!cancelled) setTracks(result);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? "Não foi possível carregar suas músicas do Spotify.");
        if (["not-connected", "unauthorized", "refresh-failed"].includes(err?.code)) setConnected(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [connected, timeRange, refreshCount]);

  async function handleConnectClick() {
    setError(null);
    try { await startSpotifyLogin(); }
    catch (err: any) { setError(err?.message ?? "Não foi possível iniciar a conexão com o Spotify."); }
  }

  function handleDisconnect() {
    disconnectSpotify();
    setConnected(false);
    setTracks([]);
    setError(null);
  }

  return (
    <div className="spotify-card">
      <div className="spotify-card-header">
        <div className="spotify-card-title"><Music2 size={18} /><span>Spotify</span></div>
        {connected ? (
          <span className="spotify-status connected"><CheckCircle2 size={14} /> Spotify conectado ✓</span>
        ) : <span className="spotify-status">Não conectado</span>}
      </div>

      <p className="spotify-card-description">
        {connected ? "Explore suas músicas mais ouvidas em diferentes períodos." : "Conecte sua conta do Spotify para o Harmoody conhecer suas músicas."}
      </p>
      {error && <p className="spotify-error">{error}</p>}

      {connected ? (
        <>
          <div className="spotify-period-filter">
            <span className="eyebrow">SUAS MÚSICAS MAIS OUVIDAS</span>
            <div className="spotify-period-buttons">
              {([
                ["short_term", "4 semanas"],
                ["medium_term", "6 meses"],
                ["long_term", "Longo prazo"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button"
                  className={`spotify-period-button ${timeRange === value ? "active" : ""}`}
                  onClick={() => setTimeRange(value)} aria-pressed={timeRange === value}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="spotify-actions">
            <button type="button" className="spotify-secondary-button"
              onClick={() => setRefreshCount((count) => count + 1)} disabled={loading}>
              <RefreshCcw size={14} /> {loading ? "Atualizando..." : "Atualizar músicas"}
            </button>
            <button type="button" className="spotify-secondary-button" onClick={handleDisconnect}>
              <LogOut size={14} /> Desconectar
            </button>
          </div>
          {loading && <p className="spotify-card-description">Buscando suas músicas...</p>}
          {!loading && tracks.length > 0 && (
            <div className="spotify-track-list">
              {tracks.map((track) => (
                <article key={track.id} className="song-card">
                  {track.cover && <img src={track.cover} alt="" />}
                  <div className="song-info">
                    <strong>{track.title}</strong>
                    <span>{track.artist}</span>
                    <div className="song-meta">
                      <span>{track.album}</span>
                      <span>{formatDuration(track.durationMs)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="spotify-actions">
          <button type="button" className="spotify-connect-button" onClick={handleConnectClick}>
            <Music2 size={16} /> Conectar Spotify
          </button>
        </div>
      )}
    </div>
  );
}
