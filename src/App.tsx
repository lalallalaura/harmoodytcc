import { useEffect, useState } from "react";
import { Sparkles, RotateCcw, Loader2, ListMusic, CheckCircle2, RefreshCw } from "lucide-react";
import { MoodSelector } from "./components/MoodSelector";
import { SongCard } from "./components/SongCard";
import { ScoreCard } from "./components/ScoreCard";
import { BottomNav } from "./components/BottomNav";
import { SpotifyConnect } from "./components/SpotifyConnect";
import { moods } from "./data";
import { recommendSongs, RecommendationResult } from "./services/recommendations";
import { createPlaylistFromRecommendations } from "./services/spotifyPlaylist";
import { getHistory, HistoryItem, saveHistory } from "./services/history";
import { MoodId } from "./types";

type PlaylistState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; url: string | null }
  | { status: "error"; message: string };

export default function App() {
  const [selectedMood, setSelectedMood] = useState<MoodId | null>(null);
  const [activeTab, setActiveTab] = useState("home");
  const [history, setHistory] = useState<HistoryItem[]>(getHistory());
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [playlistSize, setPlaylistSize] = useState(12);
  const [playlistState, setPlaylistState] = useState<PlaylistState>({ status: "idle" });

  useEffect(() => {
    if (!selectedMood) {
      setResult(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPlaylistState({ status: "idle" });
    setShownIds([]);
    setPlaylistSize(12);

    recommendSongs(selectedMood).then((data) => {
      if (!cancelled) {
        setResult(data);
        setLoading(false);
        if (data.source === "spotify") {
          setShownIds(data.songs.map((s) => s.id));
        }
      }
    });

    saveHistory(selectedMood);
    setHistory(getHistory());

    return () => {
      cancelled = true;
    };
  }, [selectedMood]);

  const currentMood = moods.find((m) => m.id === selectedMood);

  function chooseMood(mood: MoodId) {
    setSelectedMood(mood);
    setActiveTab("home");
  }

  function reset() {
    setSelectedMood(null);
  }

  async function handleShowMore() {
    if (!selectedMood || moreLoading) return;
    setMoreLoading(true);
    try {
      const data = await recommendSongs(selectedMood, { excludeIds: shownIds });
      setResult(data);
      setPlaylistState({ status: "idle" });
      if (data.source === "spotify") {
        setShownIds((prev) => [...prev, ...data.songs.map((s) => s.id)]);
      }
    } finally {
      setMoreLoading(false);
    }
  }

  async function handleCreatePlaylist() {
    if (!result || !currentMood || result.source !== "spotify") return;
    setPlaylistState({ status: "saving" });
    try {
      const created = await createPlaylistFromRecommendations(currentMood, result.songs, playlistSize);
      setPlaylistState({ status: "done", url: created.url });
    } catch (err: any) {
      setPlaylistState({
        status: "error",
        message: err?.message ?? "Não foi possível criar a playlist no Spotify agora.",
      });
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand">HARMOODY</span>
          <p>música para o que você quer sentir</p>
        </div>
        <div className="brand-mark">♪</div>
      </header>

      <main className="content">
        {activeTab === "home" && (
          <>
            <section className="hero">
              <div className="sparkle"><Sparkles size={18} /></div>
              <div>
                <span className="eyebrow">Sua experiência de hoje</span>
                <h1>Como você quer ficar hoje?</h1>
                <p>Escolha um clima. O Harmoody encontra músicas que combinam com ele.</p>
              </div>
            </section>

            <MoodSelector selected={selectedMood} onSelect={chooseMood} />

            {loading && (
              <div className="empty-state">
                <div className="empty-icon"><Loader2 size={22} className="spin" /></div>
                <h3>Buscando suas músicas...</h3>
                <p>Estamos consultando o Spotify para montar seu mix.</p>
              </div>
            )}

            {!loading && result && currentMood && (
              <>
                <section className="result-heading">
                  <div>
                    <span className="eyebrow">Seu clima</span>
                    <h2>{currentMood.emoji} {currentMood.label}</h2>
                  </div>
                  <button className="reset-button" onClick={reset}>
                    <RotateCcw size={16} /> Trocar
                  </button>
                </section>

                <ScoreCard score={result.score} />

                {result.notice && (
                  <p className="spotify-error" style={{ marginTop: 12 }}>{result.notice}</p>
                )}

                {result.source === "spotify" && (
                  <div className="spotify-actions" style={{ marginTop: 14 }}>
                    {playlistState.status !== "done" && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Tamanho da playlist:</span>
                        {[12, 24, 36].map((size) => (
                          <button
                            key={size}
                            className="spotify-secondary-button"
                            style={
                              playlistSize === size
                                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                                : undefined
                            }
                            onClick={() => setPlaylistSize(size)}
                            disabled={playlistState.status === "saving"}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    )}

                    {playlistState.status === "done" ? (
                      <span className="spotify-status connected">
                        <CheckCircle2 size={14} /> Playlist criada no Spotify
                        {playlistState.url && (
                          <>
                            {" · "}
                            <a href={playlistState.url} target="_blank" rel="noopener noreferrer">
                              abrir
                            </a>
                          </>
                        )}
                      </span>
                    ) : (
                      <button
                        className="spotify-connect-button"
                        onClick={handleCreatePlaylist}
                        disabled={playlistState.status === "saving"}
                      >
                        <ListMusic size={16} />
                        {playlistState.status === "saving"
                          ? "Criando playlist..."
                          : `Salvar ${playlistSize} músicas como playlist no Spotify`}
                      </button>
                    )}
                    {playlistState.status === "error" && (
                      <p className="spotify-error" style={{ width: "100%" }}>{playlistState.message}</p>
                    )}
                  </div>
                )}

                <section className="songs-section">
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">Recomendadas para você</span>
                      <h2>Seu mix emocional</h2>
                    </div>
                    <span className="song-count">{result.songs.length} faixas</span>
                  </div>

                  {result.songs.map((song) => (
                    <SongCard key={song.id} song={song} moodId={currentMood.id} />
                  ))}

                  {result.source === "spotify" && (
                    <button
                      className="reset-button"
                      style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
                      onClick={handleShowMore}
                      disabled={moreLoading}
                    >
                      {moreLoading ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      {moreLoading ? "Buscando novas músicas..." : "✨ Descobrir novas músicas"}
                    </button>
                  )}
                </section>
              </>
            )}

            {!loading && !result && (
              <div className="empty-state">
                <div className="empty-icon">♪</div>
                <h3>Vamos começar?</h3>
                <p>Escolha uma das quatro opções acima e o Harmoody monta sua experiência musical.</p>
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <section>
            <div className="page-heading">
              <span className="eyebrow">Suas escolhas</span>
              <h1>Histórico</h1>
              <p>Veja os climas que você escolheu recentemente.</p>
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">♡</div>
                <h3>Ainda não há histórico</h3>
                <p>Escolha um clima na página inicial para começar.</p>
              </div>
            ) : (
              <div className="history-list">
                {history.map((item) => {
                  const mood = moods.find((m) => m.id === item.mood)!;
                  return (
                    <button key={item.id} className="history-item" onClick={() => chooseMood(item.mood)}>
                      <span className="history-emoji">{mood.emoji}</span>
                      <div>
                        <strong>{mood.label}</strong>
                        <span>{new Date(item.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "profile" && (
          <section>
            <div className="page-heading">
              <span className="eyebrow">Harmoody</span>
              <h1>Perfil</h1>
              <p>Uma experiência musical baseada em emoção, energia e valência.</p>
            </div>
            <div className="about-card">
              <div className="about-logo">H</div>
              <div>
                <h3>Seu bem-estar através da música</h3>
                <p>O Harmoody cruza características musicais para encontrar faixas compatíveis com o clima que você deseja alcançar.</p>
              </div>
            </div>

            <SpotifyConnect />
          </section>
        )}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}