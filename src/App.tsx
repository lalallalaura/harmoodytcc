import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  RotateCcw,
  Loader2,
  ListMusic,
  CheckCircle2,
  RefreshCw,
  ArrowDown,
  Disc3,
  Sun,
  Moon,
  Play,
} from "lucide-react";

import { MoodSelector } from "./components/MoodSelector";
import { SongCard } from "./components/SongCard";
import { ScoreCard } from "./components/ScoreCard";
import { BottomNav } from "./components/BottomNav";
import { SpotifyConnect } from "./components/SpotifyConnect";
import { getValidAccessToken, isSpotifyConnected } from "./services/spotifyAuth";
import { moods } from "./data";
import {
  recommendSongs,
  RecommendationResult,
} from "./services/recommendations";
import { createPlaylistFromRecommendations } from "./services/spotifyPlaylist";
import { getHeroTracks } from "./services/heroTracks";
import { MoodId, Song, SpotifyTrack } from "./types";
import {
  getHistory,
  saveHistory,
  updateHistorySongs,
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
  const [replayMonth, setReplayMonth] = useState(() => new Date().getMonth());
  const [replayYear, setReplayYear] = useState(() => new Date().getFullYear());
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [playlistSize, setPlaylistSize] = useState(12);
  const [heroTracks, setHeroTracks] = useState<SpotifyTrack[]>([]);
  const [spotifyProfile, setSpotifyProfile] = useState<{ name: string; image: string | null } | null>(null);
  const [pendingReplacements, setPendingReplacements] = useState<Array<{ id: string; position: number }>>([]);
  const replacingIds = useRef(new Set<string>());
  const shownIdsRef = useRef<string[]>([]);
  const resultRef = useRef<RecommendationResult | null>(null);
  const currentHistoryIdRef = useRef<string | null>(null);
  const moodRef = useRef<MoodId | null>(null);
  const generationRef = useRef(0);

  moodRef.current = selectedMood;

  const [playlistState, setPlaylistState] = useState<PlaylistState>({
    status: "idle",
  });

  useEffect(() => {
    localStorage.setItem("harmoody_theme", theme);
  }, [theme]);

  useEffect(() => {
    if (activeTab !== "profile") return;
    let cancelled = false;
    if (!isSpotifyConnected()) {
      setSpotifyProfile(null);
      return;
    }
    async function loadSpotifyProfile() {
      try {
        const token = await getValidAccessToken();
        const response = await fetch("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Não foi possível carregar o perfil");
        const data: { display_name?: string; images?: Array<{ url: string }> } = await response.json();
        if (!cancelled) setSpotifyProfile({
          name: data.display_name || "Meu universo",
          image: data.images?.[0]?.url || null,
        });
      } catch {
        if (!cancelled) setSpotifyProfile(null);
      }
    }
    void loadSpotifyProfile();
    return () => { cancelled = true; };
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;

    getHeroTracks()
      .then((tracks) => {
        if (!cancelled) setHeroTracks(tracks);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    replacingIds.current.clear();
    setPendingReplacements([]);
    shownIdsRef.current = [];
    resultRef.current = null;
    currentHistoryIdRef.current = null;
    setShownIds([]);
    setResult(null);
    setCurrentHistoryId(null);

    if (!selectedMood) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPlaylistState({ status: "idle" });
    setPlaylistSize(12);

    recommendSongs(selectedMood)
      .then((data) => {
        if (generation !== generationRef.current) return;

        resultRef.current = data;
        setResult(data);
        setLoading(false);

        const ids = data.songs.map((song) => song.id);
        shownIdsRef.current = ids;
        setShownIds(ids);

        const newHistoryItem = saveHistory(selectedMood, data.songs);
        currentHistoryIdRef.current = newHistoryItem.id;
        setCurrentHistoryId(newHistoryItem.id);
        setHistory(getHistory());
      })
      .catch(() => {
        if (generation === generationRef.current) {
          setLoading(false);
        }
      });
  }, [selectedMood]);

  const replaySessions = history.filter((item) => {
    const date = new Date(item.createdAt);
    return date.getMonth() === replayMonth && date.getFullYear() === replayYear;
  });
  const replaySongs = replaySessions.flatMap((item) => item.songs ?? []);
  const replayArtists = Object.values(replaySongs.reduce<Record<string, { name: string; count: number; cover: string }>>((acc, song) => {
    const name = song.artist || "Artista desconhecido";
    const key = name.toLocaleLowerCase("pt-BR");
    if (!acc[key]) acc[key] = { name, count: 0, cover: song.cover };
    acc[key].count += 1;
    if (!acc[key].cover && song.cover) acc[key].cover = song.cover;
    return acc;
  }, {})).sort((a, b) => b.count - a.count).slice(0, 5);
  const replayTopSongs = Object.values(replaySongs.reduce<Record<string, { song: Song; count: number }>>((acc, song) => {
    const key = song.id;
    if (!acc[key]) acc[key] = { song, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => b.count - a.count).slice(0, 8);
  const replayMoods = moods.map((mood) => ({
    ...mood,
    count: replaySessions.filter((item) => item.mood === mood.id).length,
  })).sort((a, b) => b.count - a.count);
  const replayMonths = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const replayMonthName = new Date(replayYear, replayMonth, 1).toLocaleDateString("pt-BR", { month: "long" });

  const currentMood = moods.find((mood) => mood.id === selectedMood);

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

  async function handleDislike(song: Song) {
    const moodId = moodRef.current;
    const current = resultRef.current;

    if (
      !moodId ||
      !current ||
      replacingIds.current.has(song.id) ||
      !current.songs.some((item) => item.id === song.id)
    ) {
      return;
    }

    replacingIds.current.add(song.id);
    const generation = generationRef.current;
    const historyId = currentHistoryIdRef.current;
    const position = current.songs.findIndex((item) => item.id === song.id);
    const remaining = current.songs.filter((item) => item.id !== song.id);
    const nextResult = { ...current, songs: remaining };
    setPendingReplacements((items) => [...items, { id: song.id, position }]);

    resultRef.current = nextResult;
    setResult(nextResult);
    setPlaylistState({ status: "idle" });

    const excludedIds = [
      ...new Set([
        ...shownIdsRef.current,
        ...current.songs.map((item) => item.id),
      ]),
    ];

    shownIdsRef.current = excludedIds;
    setShownIds(excludedIds);

    if (historyId) {
      updateHistorySongs(historyId, remaining);
      setHistory(getHistory());
    }

    try {
      const replacement = await recommendSongs(moodId, {
        excludeIds: excludedIds,
        count: 1,
      });

      if (generation !== generationRef.current) return;

      const latest = resultRef.current;
      if (!latest) return;

      const existingIds = new Set(latest.songs.map((item) => item.id));
      const newSong = replacement.songs.find(
        (item) => !existingIds.has(item.id) && item.id !== song.id
      );

      if (!newSong) return;

      const updated = [...latest.songs];
      updated.splice(Math.min(position, updated.length), 0, newSong);

      const updatedResult = { ...latest, songs: updated };
      resultRef.current = updatedResult;
      setResult(updatedResult);

      const ids = [...new Set([...shownIdsRef.current, newSong.id])];
      shownIdsRef.current = ids;
      setShownIds(ids);

      if (historyId && currentHistoryIdRef.current === historyId) {
        updateHistorySongs(historyId, updated);
        setHistory(getHistory());
      }
    } catch {
      return;
    } finally {
      replacingIds.current.delete(song.id);
      setPendingReplacements((items) => items.filter((item) => item.id !== song.id));
    }
  }

  async function handleShowMore() {
    const moodId = moodRef.current;
    if (!moodId || moreLoading) return;

    const generation = generationRef.current;
    setMoreLoading(true);

    try {
      const data = await recommendSongs(moodId, {
        excludeIds: shownIdsRef.current,
      });

      if (generation !== generationRef.current) return;

      const dislikedIds = new Set(
        [...replacingIds.current]
      );
      const filteredSongs = data.songs.filter(
        (song) => !dislikedIds.has(song.id)
      );
      const updatedData = { ...data, songs: filteredSongs };

      resultRef.current = updatedData;
      setResult(updatedData);
      setPlaylistState({ status: "idle" });

      const ids = [
        ...new Set([
          ...shownIdsRef.current,
          ...filteredSongs.map((song) => song.id),
        ]),
      ];
      shownIdsRef.current = ids;
      setShownIds(ids);

      const historyId = currentHistoryIdRef.current;
      if (historyId) {
        updateHistorySongs(historyId, filteredSongs);
        setHistory(getHistory());
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

      setPlaylistState({
        status: "done",
        url: created.url,
      });
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
                <span className="hero-index">
                  01 / YOUR FEELING STUDIO
                </span>

                <span className="hero-status">
                  <span className="status-dot" />
                  FEITO PARA VOCÊ
                </span>
              </div>

              <div className="hero-main">
                <div className="hero-copy">
                  <span className="eyebrow hero-eyebrow">
                    DESCUBRA SEU SOM
                  </span>

                  <h1>
                    Seu momento,
                    <br />
                    sua <span>música.</span>
                  </h1>

                  <p className="hero-description">
                    Uma trilha sonora para o que você quer sentir.
                  </p>

                  <a className="hero-scroll" href="#mood-selection">
                    <span>EXPLORAR MOODS</span>
                    <ArrowDown size={15} />
                  </a>
                </div>

                {/* CARROSSEL DE MÚSICAS */}

                <div className="hero-carousel">
                  <div
                    className="hero-carousel-track"
                    onMouseDown={(event) => {
                      const track = event.currentTarget;

                      track.dataset.dragging = "true";
                      track.dataset.startX = String(event.pageX);
                      track.dataset.scrollLeft = String(track.scrollLeft);

                      event.preventDefault();
                    }}
                    onMouseMove={(event) => {
                      const track = event.currentTarget;

                      if (track.dataset.dragging !== "true") return;

                      const startX = Number(track.dataset.startX);
                      const scrollLeft = Number(track.dataset.scrollLeft);

                      track.scrollLeft =
                        scrollLeft - (event.pageX - startX);
                    }}
                    onMouseUp={(event) => {
                      event.currentTarget.dataset.dragging = "false";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.dataset.dragging = "false";
                    }}
                  >
                    {(selectedMood ? result?.songs ?? [] : heroTracks).length > 0 ? (
                      (selectedMood ? result?.songs ?? [] : heroTracks)
                        .slice(0, 6)
                        .map((song, index) => (
                          <article
                            className="hero-music-card hero-music-enter"
                            key={song.id}
                            onClick={() => {
                              if (song.spotifyUrl) {
                                window.open(song.spotifyUrl, "_blank", "noopener,noreferrer");
                              }
                            }}
                            style={{ cursor: song.spotifyUrl ? "pointer" : "default", animationDelay: `${Math.min(index, 5) * 75}ms` }}
                          >
                            <img
                              src={song.cover}
                              alt={`Capa de ${song.title}`}
                              className="hero-music-cover"
                              loading="lazy"
                              draggable={false}
                            />
                            <div className="hero-music-overlay">
                              <span className="hero-music-number">
                                TRACK {String(index + 1).padStart(2, "0")}
                              </span>
                              <div>
                                <h3>{song.title}</h3>
                                <p>{song.artist}</p>
                              </div>
                            </div>
                          </article>
                        ))
                    ) : (
                      <article className="hero-music-card hero-music-placeholder">
                        <div className="placeholder-content">
                          <Disc3 size={48} />
                          <span>
                            SUA PRÓXIMA
                            <br />
                            MÚSICA FAVORITA!
                          </span>
                          <p>
                            Escolha como você quer se sentir e descubra
                            novos sons.
                          </p>
                        </div>
                      </article>
                    )}
                  </div>

                  <span className="hero-carousel-hint">
                    ARRASTE PARA DESCOBRIR <span>⟶</span>
                  </span>
                </div>
              </div>

              <div className="hero-bottomline">
                <span>ENCONTRE O SOM DO SEU MOMENTO</span>
                <span>2026 · HARMOODY</span>
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

                  {(() => {
                    const slots: Array<{ song?: Song; pendingId?: string }> =
                      result.songs.map((song) => ({ song }));
                    [...pendingReplacements]
                      .sort((a, b) => a.position - b.position)
                      .forEach(({ id, position }) => {
                        slots.splice(Math.min(position, slots.length), 0, { pendingId: id });
                      });
                    return slots.map((slot) =>
                      slot.song ? (
                        <div className="song-transition-item" key={slot.song.id}>
                          <SongCard
                            song={slot.song}
                            moodId={currentMood.id}
                            onDislike={handleDislike}
                          />
                        </div>
                      ) : (
                        <div className="song-replacement-placeholder" key={`pending-${slot.pendingId}`} role="status" aria-label="Buscando outra música">
                          <div className="song-replacement-cover" />
                          <div className="song-replacement-copy">
                            <span />
                            <span />
                          </div>
                          <Loader2 size={18} className="spin" />
                        </div>
                      )
                    );
                  })()}

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
                    musical pensada para o que você deseja sentir!
                  </p>
                </div>
              </section>
            )}

            <footer className="home-footer">
              <span>HARMOODY © 2026</span>
              <span>ENCONTRE SEU SOM. ♡</span>
            </footer>
          </div>
        )}

        {/* HISTÓRICO */}

        {activeTab === "history" && (
          <section className="history-page">
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

                      <section className="history-songs">
                        <h3>MINHA TRILHA DO MOMENTO</h3>

                        {selectedHistoryItem.songs?.length ? (
                          <div className="history-songs-list">
                            {selectedHistoryItem.songs.map((song, index) => (
                              <div
                                className="history-song-item"
                                key={`${song.id}-${index}`}
                              >
                                {song.cover ? (
                                  <img
                                    src={song.cover}
                                    alt={`Capa de ${song.title}`}
                                  />
                                ) : (
                                  <div className="history-song-placeholder">
                                    ♪
                                  </div>
                                )}

                                <div className="history-song-info">
                                  <strong>{song.title}</strong>
                                  <span>{song.artist}</span>
                                </div>

                                {song.spotifyUrl && (
                                  <a
                                    href={song.spotifyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Abrir ${song.title} no Spotify`}
                                  >
                                    𝄞
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>
                            Este registro não possui músicas salvas.
                            Os registros anteriores à atualização não
                            guardavam essa informação.
                          </p>
                        )}
                      </section>

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
                          onChange={(event) =>
                            setHistoryNote(event.target.value)
                          }
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
            ) : (
              <>
                <header className="replay-heading">
                  <div>
                    <span className="eyebrow">HARMOODY / SEU UNIVERSO MUSICAL</span>
                    <h1>Seu <em>Replay.</em></h1>
                    <p>As músicas que fizeram parte dos seus momentos.</p>
                  </div>
                  <select aria-label="Ano do Replay" value={replayYear} onChange={(event) => setReplayYear(Number(event.target.value))}>
                    {[...new Set([new Date().getFullYear(), ...history.map((item) => new Date(item.createdAt).getFullYear())])].sort((a, b) => b - a).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </header>
                <div className="replay-months" aria-label="Selecionar mês">
                  {replayMonths.map((month, index) => (
                    <button type="button" key={month} className={replayMonth === index ? "active" : ""} onClick={() => setReplayMonth(index)}>{month}</button>
                  ))}
                </div>
                <div className="replay-banner">
                  <span>SEU RESUMO DE {replayMonthName.toLocaleUpperCase("pt-BR")}</span>
                  <h2>{replaySessions.length} {replaySessions.length === 1 ? "sessão musical" : "sessões musicais"}.</h2>
                  <p>{replaySongs.length} músicas recomendadas para os seus momentos.</p>
                </div>
                {replaySessions.length === 0 ? (
                  <div className="replay-empty"><Disc3 size={28}/><h3>Nenhuma sessão neste mês.</h3><p>Escolha um mood na página inicial para começar sua coleção musical.</p></div>
                ) : (
                  <>
                    <section className="replay-section">
                      <h2>Seus artistas em destaque</h2>
                      {replayArtists.length ? (
                        <div className="replay-artist-track">
                          {replayArtists.map((artist, index) => (
                            <article className="replay-artist-card" key={artist.name}>
                              {artist.cover ? <img src={artist.cover} alt={`Capa de música de ${artist.name}`} loading="lazy"/> : <div className="replay-art-fallback"><Disc3 size={36}/></div>}
                              <strong className="replay-rank">{index + 1}</strong>
                              <div className="replay-artist-caption"><strong>{artist.name}</strong><span>{artist.count} {artist.count === 1 ? "recomendação" : "recomendações"}</span></div>
                            </article>
                          ))}
                        </div>
                      ) : <p className="replay-muted">Os registros deste mês não possuem músicas salvas.</p>}
                    </section>
                    <section className="replay-section">
                      <h2>Suas músicas em destaque</h2>
                      <div className="replay-song-list">
                        {replayTopSongs.map(({ song, count }, index) => (
                          <div className="replay-song-row" key={song.id}>
                            <span className="replay-song-rank">{index + 1}</span>
                            {song.cover ? <img src={song.cover} alt={`Capa de ${song.title}`} loading="lazy"/> : <div className="replay-song-fallback"><Disc3 size={20}/></div>}
                            <div className="replay-song-text"><strong>{song.title}</strong><span>{song.artist} · {count} {count === 1 ? "recomendação" : "recomendações"}</span></div>
                            {song.spotifyUrl && <a href={song.spotifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ouvir ${song.title} no Spotify`}><Play size={17}/></a>}
                          </div>
                        ))}
                        {!replayTopSongs.length && <p className="replay-muted">Ainda não há músicas registradas.</p>}
                      </div>
                    </section>
                    <section className="replay-section">
                      <h2>Seus moods favoritos</h2>
                      <div className="replay-mood-list">
                        {replayMoods.filter((mood) => mood.count > 0).map((mood) => (
                          <div className="replay-mood-row" key={mood.id}>
                            <div><strong>{mood.label}</strong><span>{mood.count} {mood.count === 1 ? "sessão" : "sessões"}</span></div>
                            <div className="replay-mood-bar"><span style={{ width: `${(mood.count / replaySessions.length) * 100}%` }}/></div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="replay-section">
                      <h2>Suas sessões</h2>
                      <div className="replay-sessions">
                        {replaySessions.map((item) => {
                          const mood = moods.find((m) => m.id === item.mood);
                          const date = new Date(item.createdAt);
                          return (
                            <button type="button" className="replay-session" key={item.id} onClick={() => openHistoryItem(item)}>
                              <div className="replay-session-cover">
                                {item.songs?.find((song) => song.cover)?.cover ? <img src={item.songs.find((song) => song.cover)!.cover} alt="Capa de música da sessão" loading="lazy"/> : <Disc3 size={26}/>}
                              </div>
                              <div className="replay-session-info"><strong>{mood?.label ?? item.mood}</strong><span>{date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {item.songs?.length ?? 0} músicas</span></div>
                              <span className="replay-session-arrow">›</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* PERFIL */}

        {activeTab === "profile" && (
          <section className="profile-page profile-music-page">
            <header className="profile-music-header">
              <span className="profile-kicker">HARMOODY / SEU ESPAÇO</span>
              <div className="profile-music-title">
                <div className="profile-music-avatar">{spotifyProfile?.image ? <img src={spotifyProfile.image} alt="Foto de perfil do Spotify" referrerPolicy="no-referrer" /> : <Disc3 size={32} />}</div>
                <div>
                  <h1>{spotifyProfile ? spotifyProfile.name : "Meu"} <em>{spotifyProfile ? "no Harmoody." : "universo."}</em></h1>
                  <p>Suas descobertas, seus moods e sua história musical.</p>
                </div>
              </div>
            </header>

            <div className="profile-music-stats">
              <div><strong>{history.length}</strong><span>Sessões</span></div>
              <div><strong>{history.reduce((total, item) => total + (item.songs?.length ?? 0), 0)}</strong><span>Recomendações</span></div>
              <div><strong>{new Set(history.map((item) => item.mood)).size}</strong><span>Moods explorados</span></div>
            </div>

            <section className="profile-music-panel">
              <div className="profile-music-panel-heading">
                <div>
                  <span className="profile-kicker">SUA IDENTIDADE MUSICAL</span>
                  <h2>Seu mood mais escolhido</h2>
                </div>
              </div>
              {history.length ? (() => {
                const favorite = [...moods].sort(
                  (a, b) =>
                    history.filter((item) => item.mood === b.id).length -
                    history.filter((item) => item.mood === a.id).length
                )[0];
                const count = history.filter((item) => item.mood === favorite.id).length;
                return (
                  <div className="profile-favorite-mood">
                    <Disc3 size={26} />
                    <div><strong>{favorite.label}</strong><span>{count} {count === 1 ? "sessão registrada" : "sessões registradas"}</span></div>
                  </div>
                );
              })() : (
                <p className="profile-music-empty">Escolha um mood na Home para começar seu universo musical.</p>
              )}
            </section>

            <section className="profile-music-panel">
              <div className="profile-music-panel-heading">
                <div>
                  <span className="profile-kicker">SUA COLEÇÃO</span>
                  <h2>Artistas que apareceram por aqui</h2>
                </div>
              </div>
              {(() => {
                const artists = Object.values(
                  history.flatMap((item) => item.songs ?? []).reduce<
                    Record<string, { name: string; count: number; cover: string }>
                  >((acc, song) => {
                    const name = song.artist || "Artista desconhecido";
                    const key = name.toLocaleLowerCase("pt-BR");
                    if (!acc[key]) acc[key] = { name, count: 0, cover: song.cover };
                    acc[key].count += 1;
                    if (!acc[key].cover && song.cover) acc[key].cover = song.cover;
                    return acc;
                  }, {})
                ).sort((a, b) => b.count - a.count).slice(0, 4);

                return artists.length ? (
                  <div className="profile-artist-list">
                    {artists.map((artist, index) => (
                      <div className="profile-artist-row" key={artist.name}>
                        <span className="profile-artist-rank">{String(index + 1).padStart(2, "0")}</span>
                        {artist.cover ? <img src={artist.cover} alt="" loading="lazy" /> : <div className="profile-artist-cover-fallback"><Disc3 size={18} /></div>}
                        <div><strong>{artist.name}</strong><span>{artist.count} {artist.count === 1 ? "recomendação" : "recomendações"}</span></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="profile-music-empty">Os artistas das suas recomendações vão aparecer aqui.</p>
                );
              })()}
            </section>

            <button
              type="button"
              className="profile-replay-link"
              onClick={() => {
                setSelectedHistoryItem(null);
                setActiveTab("history");
              }}
            >
              <div>
                <span className="profile-kicker">SUA RETROSPECTIVA</span>
                <strong>Explorar meu Replay</strong>
                <small>Reveja suas músicas, artistas e sessões.</small>
              </div>
              <span aria-hidden="true">↗</span>
            </button>

            <section className="profile-spotify">
              <div className="profile-section-heading">
                <span>SPOTIFY / CONEXÃO</span>
                <h2>Sua conta musical.</h2>
                <p>Gerencie sua conexão com o Spotify.</p>
              </div>
              <SpotifyConnect />
            </section>

            <details className="profile-about-details">
              <summary>Sobre o Harmoody <span aria-hidden="true">+</span></summary>
              <p>O Harmoody combina características musicais e preferências para recomendar faixas compatíveis com o clima que você deseja alcançar.</p>
            </details>

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
