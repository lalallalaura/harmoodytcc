
import { useEffect, useState } from "react";
import {
  Sparkles,
  RotateCcw,
  Loader2,
  ListMusic,
  CheckCircle2,
  RefreshCw,
  Music2,
  ArrowDown,
  Disc3,
  Sun,
  Moon,
} from "lucide-react";

import { MoodSelector } from "./components/MoodSelector";
import { SongCard } from "./components/SongCard";
import { ScoreCard } from "./components/ScoreCard";
import { BottomNav } from "./components/BottomNav";
import { SpotifyConnect } from "./components/SpotifyConnect";
import { moods } from "./data";
import {
  recommendSongs,
  RecommendationResult,
} from "./services/recommendations";
import { createPlaylistFromRecommendations } from "./services/spotifyPlaylist";
import { MoodId } from "./types";
import {
  getHistory,
  saveHistory,
  updateHistoryNote,
  deleteHistory,
  type HistoryItem,
} from "./services/history";

type PlaylistState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; url: string | null }
  | { status: "error"; message: string };

export default function App() {
  const [selectedMood, setSelectedMood] = useState<MoodId | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
  return localStorage.getItem("harmoody_theme") === "light"
    ? "light"
    : "dark";
});
  const [selectedHistoryItem, setSelectedHistoryItem] =
  useState<HistoryItem | null>(null);
  const [activeTab, setActiveTab] = useState("home");
  const [historyNote, setHistoryNote] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>(getHistory());
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [playlistSize, setPlaylistSize] = useState(12);
  const [playlistState, setPlaylistState] = useState<PlaylistState>({
    status: "idle",
  });
  useEffect(() => {
  localStorage.setItem("harmoody_theme", theme);
}, [theme]);
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
  function openHistoryItem(item: HistoryItem) {
  setSelectedHistoryItem(item);
  setHistoryNote(item.note || "");
}
function handleSaveHistoryNote() {
  if (!selectedHistoryItem) return;

  updateHistoryNote(selectedHistoryItem.id, historyNote);

  const updatedItem = {
    ...selectedHistoryItem,
    note: historyNote,
  };

  setSelectedHistoryItem(updatedItem);
  setHistory(getHistory());
}

function handleDeleteHistoryItem() {
  if (!selectedHistoryItem) return;

  const confirmed = window.confirm(
    "Tem certeza que deseja excluir este registro?"
  );

  if (!confirmed) return;

  deleteHistory(selectedHistoryItem.id);
  setHistory(getHistory());
  setSelectedHistoryItem(null);
  setHistoryNote("");
}
  async function handleShowMore() {
    if (!selectedMood || moreLoading) return;

    setMoreLoading(true);

    try {
      const data = await recommendSongs(selectedMood, {
        excludeIds: shownIds,
      });

      setResult(data);
      setPlaylistState({ status: "idle" });

      if (data.source === "spotify") {
        setShownIds((prev) => [
          ...prev,
          ...data.songs.map((s) => s.id),
        ]);
      }
    } finally {
      setMoreLoading(false);
    }
  }

  async function handleCreatePlaylist() {
    if (!result || !currentMood || result.source !== "spotify") return;

    setPlaylistState({ status: "saving" });

    try {
      const created = await createPlaylistFromRecommendations(
        currentMood,
        result.songs,
        playlistSize
      );

      setPlaylistState({ status: "done", url: created.url });
    } catch (err: any) {
      setPlaylistState({
        status: "error",
        message:
          err?.message ??
          "Não foi possível criar a playlist no Spotify agora.",
      });
    }
  }

  return (
<div className="app-shell" data-theme={theme}>
  <header className="topbar">
    <div className="topbar-brand">
      <span className="brand">
        HARMOODY<span className="brand-period">.</span>
      </span>
      <p>música para o que você quer sentir</p>
    </div>

    <button
      type="button"
      className="theme-toggle"
      onClick={() =>
        setTheme((current) =>
          current === "dark" ? "light" : "dark"
        )
      }
      aria-label={
        theme === "dark"
          ? "Ativar modo claro"
          : "Ativar modo escuro"
      }
      title={
        theme === "dark"
          ? "Ativar modo claro"
          : "Ativar modo escuro"
      }
    >
      {theme === "dark" ? (
        <Sun size={20} strokeWidth={1.8} />
      ) : (
        <Moon size={20} strokeWidth={1.8} />
      )}
    </button>
  </header>
  
      <main className="content">
        {activeTab === "home" && (
          <div className="home-page">

            {/* APRESENTAÇÃO */}

            <section className="home-hero">
              <div className="hero-topline">
                <span className="hero-index">01 / YOUR FEELING STUDIO</span>
                <span className="hero-status">
                  <span className="status-dot" />
                  FEITO PARA VOCÊ
                </span>
              </div>

              <div className="hero-main">
                <div className="hero-copy">
                  <span className="eyebrow hero-eyebrow">
                    MÚSICA · EMOÇÃO · CONEXÃO
                  </span>

                  <h1>
                    A vida tem
                    <br />
                    <span>uma trilha</span>
                    <br />
                    sonora.
                  </h1>

                  <p className="hero-description">
                    Nem sempre sabemos o que ouvir.
                    Mas sabemos como queremos nos sentir.
                    <strong> Comece por aí.</strong>
                  </p>

                  <a className="hero-scroll" href="#mood-selection">
                    <span>ENCONTRE SEU CLIMA</span>
                    <ArrowDown size={15} />
                  </a>
                </div>

                <div className="hero-art" aria-hidden="true">
                  <div className="art-circle art-circle-one" />
                  <div className="art-circle art-circle-two" />
                  <div className="art-disc">
                    <div className="disc-center">
                      <Music2 size={27} />
                    </div>
                  </div>
                  <span className="art-star star-one">𝄞</span>
                  <span className="art-star star-two">♪</span>
                  <span className="art-note">♫</span>
                  <span className="art-caption">SOUNDTRACK<br/>OF YOURSELF</span>
                </div>
              </div>

              <div className="hero-bottomline">
                <span>ENCONTRE O SOM DO SEU MOMENTO</span>
                <span>EST. 2026 · HARMOODY</span>
              </div>
            </section>

            {/* SELEÇÃO DE HUMOR */}

            <section className="mood-selection" id="mood-selection">
              <div className="section-kicker">
                <span>02</span>
                <span>ESCOLHA SUA DIREÇÃO</span>
              </div>

              <div className="mood-intro">
                <div>
                  <span className="eyebrow">UM POUCO SOBRE VOCÊ</span>
                  <h2>
                    Como você quer
                    <br />
                    <span>ficar hoje?</span>
                  </h2>
                </div>

                <span className="mood-side-note">
                  NÃO EXISTE JEITO
                  <br />
                  CERTO DE SENTIR.
                </span>
              </div>

              <p className="mood-description">
                Escolha o sentimento que deseja alcançar.
                A gente encontra músicas para acompanhar esse caminho.
              </p>

              <div className="mood-selector-wrap">
                <MoodSelector
                  selected={selectedMood}
                  onSelect={chooseMood}
                />
              </div>

              <div className="selection-footnote">
                <Sparkles size={14} />
                <span>SEU PRÓXIMO MOMENTO COMEÇA AQUI</span>
              </div>
            </section>

            {/* CARREGAMENTO */}

            {loading && (
              <div className="empty-state">
                <div className="empty-icon">
                  <Loader2 size={22} className="spin" />
                </div>
                <h3>Preparando sua trilha...</h3>
                <p>
                  Estamos procurando músicas que combinem com o
                  sentimento que você escolheu.
                </p>
              </div>
            )}

            {/* RESULTADOS */}

            {!loading && result && currentMood && (
              <section className="recommendation-area">
                <div className="section-kicker">
                  <span>03</span>
                  <span>SUA DESCOBERTA MUSICAL</span>
                </div>

                <section className="result-heading">
                  <div>
                    <span className="eyebrow">SEU CLIMA ESCOLHIDO</span>
                    <h2>
                      {currentMood.emoji} {currentMood.label}
                    </h2>
                  </div>

                  <button className="reset-button" onClick={reset}>
                    <RotateCcw size={15} />
                    Trocar
                  </button>
                </section>

                <ScoreCard score={result.score} />

                {result.notice && (
                  <p className="spotify-error" style={{ marginTop: 12 }}>
                    {result.notice}
                  </p>
                )}

                {result.source === "spotify" && (
                  <div className="spotify-actions" style={{ marginTop: 14 }}>
                    {playlistState.status !== "done" && (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          width: "100%",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                          }}
                        >
                          Tamanho da playlist:
                        </span>

                        {[12, 24, 36].map((size) => (
                          <button
                            key={size}
                            className="spotify-secondary-button"
                            style={
                              playlistSize === size
                                ? {
                                    background: "var(--purple)",
                                    color: "white",
                                    borderColor: "var(--purple)",
                                  }
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
                        <CheckCircle2 size={14} />
                        Playlist criada no Spotify
                        {playlistState.url && (
                          <>
                            {" · "}
                            <a
                              href={playlistState.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
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
                      <p
                        className="spotify-error"
                        style={{ width: "100%" }}
                      >
                        {playlistState.message}
                      </p>
                    )}
                  </div>
                )}

                <section className="songs-section">
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">
                        SELEÇÃO ESPECIALMENTE PARA VOCÊ
                      </span>
                      <h2>Seu mix emocional</h2>
                    </div>

                    <span className="song-count">
                      {result.songs.length} faixas
                    </span>
                  </div>

                  {result.songs.map((song) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      moodId={currentMood.id}
                    />
                  ))}

                  {result.source === "spotify" && (
                    <button
                      className="reset-button discover-more"
                      onClick={handleShowMore}
                      disabled={moreLoading}
                    >
                      {moreLoading ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}

                      {moreLoading
                        ? "Buscando novas músicas..."
                        : "Descobrir novas músicas"}
                    </button>
                  )}
                </section>
              </section>
            )}

            {/* ESTADO INICIAL */}

            {!loading && !result && (
              <section className="home-note">
                <div className="home-note-icon">
                  <Disc3 size={24} />
                </div>

                <div>
                  <span className="eyebrow">UM CONVITE</span>
                  <h3>Deixe a música encontrar você.</h3>
                  <p>
                    Escolha um dos quatro climas e descubra uma seleção
                    musical pensada para o que você deseja sentir.
                  </p>
                </div>

              </section>
            )}

            <footer className="home-footer">
              <span>HARMOODY © 2026</span>
              <span>FEEL IT. FIND YOUR SOUND. ♡</span>
            </footer>
          </div>
        )}

        {/* HISTÓRICO */}

        

{activeTab === "history" && (
  <section className="history-page">

    <header className="history-intro">
      <div className="history-heading">
        <span className="eyebrow">
          HARMOODY / SEU ARQUIVO PESSOAL
        </span>

        <h1>Fragmentos <em>de você.</em></h1>

        <p>
          Cada escolha guarda um pouco do que você sentiu
          e daquilo que quis encontrar na música.
        </p>
      </div>

      <div className="history-total">
        <strong>{String(history.length).padStart(2, "0")}</strong>
        <span>REGISTROS</span>
      </div>
    </header>

    {selectedHistoryItem ? (
      
<div className="history-detail">
  <button
    type="button"
    onClick={() => {
      setSelectedHistoryItem(null);
      setHistoryNote("");
    }}
  >
    Voltar ao histórico
  </button>

  {(() => {
    const mood = moods.find(
      (m) => m.id === selectedHistoryItem.mood
    );

    const date = new Date(selectedHistoryItem.createdAt);

    if (!mood) return null;

    return (
      <div>
        <span>REGISTRO MUSICAL</span>

        <h2>{mood.label}</h2>

        <p>
          {date.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>

        <p>
          {date.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        <div className="history-note">
          <label htmlFor="history-note-input">
            MINHAS ANOTAÇÕES
          </label>

          <textarea
            id="history-note-input"
            value={historyNote}
            onChange={(e) => setHistoryNote(e.target.value)}
            placeholder="O que estava passando pela sua cabeça naquele momento?"
            rows={5}
          />

          <button
            type="button"
            onClick={handleSaveHistoryNote}
          >
            Salvar anotação
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            chooseMood(selectedHistoryItem.mood);
            setSelectedHistoryItem(null);
          }}
        >
          Explorar músicas deste clima
        </button>

        <button
          type="button"
          onClick={handleDeleteHistoryItem}
        >
          Excluir registro
        </button>
      </div>
    );
  })()}
</div>

    ) : history.length === 0 ? (

      <div className="history-empty">
        <span className="history-empty-mark">H.</span>
        <span className="eyebrow">PÁGINA EM BRANCO</span>
        <h3>Sua história começa aqui.</h3>
        <p>
          Escolha um clima na página inicial.
          Seus registros aparecerão neste espaço.
        </p>
      </div>

    ) : (

      <>
        <div className="history-archive-label">
          <span>01 / MEMÓRIAS MUSICAIS</span>
          <span>REGISTROS RECENTES</span>
        </div>

        <div className="history-mosaic">
          {history.map((item, index) => {
            const mood = moods.find((m) => m.id === item.mood);

            if (!mood) return null;

            const date = new Date(item.createdAt);

            return (
              <button
                key={item.id}
                className={`history-card history-card-${index % 4}`}
                onClick={() => openHistoryItem(item)}
              >
                <div className="history-card-top">
                  <span>
                    NO. {String(index + 1).padStart(2, "0")}
                  </span>

                  <span>
                    {date.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <div className="history-card-art">
                  <span>{mood.emoji}</span>
                  <div className="history-card-orbit" />
                </div>

                <div className="history-card-bottom">
                  <div>
                    <span className="history-card-caption">
                      CLIMA ESCOLHIDO
                    </span>

                    <strong>{mood.label}</strong>
                  </div>

                  <span className="history-card-time">
                    {date.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <span className="history-card-open">
                  ABRIR REGISTRO ↗
                </span>
              </button>
            );
          })}
        </div>
      </>
    )}

  </section>
)}





        {/* PERFIL */}

        {activeTab === "profile" && (
          <section className="profile-page">

            <div className="profile-heading">
              <span className="profile-kicker">
                HARMOODY / SEU ESPAÇO
              </span>

              <h1>
                Música que
                <br />
                <em>conversa com você.</em>
              </h1>

              <p>
                Descubra como a música pode acompanhar seus sentimentos,
                respeitar seu momento e ajudar você a encontrar novas sensações.
              </p>
            </div>

            <div className="profile-about">
              <div className="profile-about-top">
                <span>01 / SOBRE O PROJETO</span>
                <span>HARMOODY</span>
              </div>

              <div className="profile-about-content">
                <span className="profile-letter">H.</span>

                <div>
                  <h2>Seu bem-estar através da música.</h2>

                  <p>
                    O Harmoody cruza características musicais, como energia,
                    andamento e valência das letras, para encontrar faixas
                    compatíveis com o clima que você deseja alcançar.
                  </p>
                </div>
              </div>

              <div className="profile-about-footer">
                <span>EMOÇÃO</span>
                <span>ENERGIA</span>
                <span>MÚSICA</span>
              </div>
            </div>

            <div className="profile-spotify">
              <div className="profile-section-heading">
                <span>02 / SUA CONEXÃO</span>
                <h2>Seu universo musical.</h2>
                <p>
                  Conecte sua conta para descobrir recomendações musicais.
                </p>
              </div>

              <SpotifyConnect />
            </div>

            <footer className="profile-footer">
              <span>HARMOODY © 2026</span>
              <span>MÚSICA PARA O QUE VOCÊ QUER SENTIR</span>
            </footer>

          </section>
        )}

      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />

    </div>
  );
}