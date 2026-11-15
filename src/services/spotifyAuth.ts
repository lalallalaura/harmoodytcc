

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

// user-top-read / user-library-read: já usados para buscar músicas do usuário.
// playlist-modify-private: necessário para criar a playlist do Harmoody
// e adicionar as faixas recomendadas nela (criamos como privada por padrão).
const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-private",
  "user-library-read",
  "playlist-modify-private",
].join(" ");

const STORAGE_TOKEN_KEY = "harmoody_spotify_token";
const STORAGE_VERIFIER_KEY = "harmoody_spotify_pkce_verifier";
const STORAGE_STATE_KEY = "harmoody_spotify_pkce_state";

export interface SpotifyTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; 
}

function getClientId(): string {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new SpotifyAuthError(
      "missing-config",
      "O Harmoody ainda não está configurado para conectar ao Spotify."
    );
  }
  return clientId;
}

function getRedirectUri(): string {
  const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined;
  if (!redirectUri) {
    throw new SpotifyAuthError(
      "missing-config",
      "O Harmoody ainda não está configurado para conectar ao Spotify."
    );
  }
  return redirectUri;
}

export class SpotifyAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}


function randomString(length: number): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => possible[v % possible.length]).join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


export async function startSpotifyLogin(): Promise<void> {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);

  sessionStorage.setItem(STORAGE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(STORAGE_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}


export async function completeSpotifyLogin(
  searchParams: URLSearchParams
): Promise<void> {
  const errorParam = searchParams.get("error");
  if (errorParam) {
    clearPkceSession();
    if (errorParam === "access_denied") {
      throw new SpotifyAuthError(
        "access_denied",
        "Você não autorizou o acesso ao Spotify."
      );
    }
    throw new SpotifyAuthError(
      "authorize-error",
      "Não foi possível concluir a conexão com o Spotify."
    );
  }

  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const savedState = sessionStorage.getItem(STORAGE_STATE_KEY);
  const verifier = sessionStorage.getItem(STORAGE_VERIFIER_KEY);

  if (!code || !returnedState || !verifier || returnedState !== savedState) {
    clearPkceSession();
    throw new SpotifyAuthError(
      "invalid-callback",
      "O link de retorno do Spotify é inválido ou expirou. Tente conectar novamente."
    );
  }

  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    clearPkceSession();
    throw new SpotifyAuthError(
      "network-error",
      "Não foi possível falar com o Spotify agora. Verifique sua internet e tente de novo."
    );
  }

  clearPkceSession();

  if (!response.ok) {
    throw new SpotifyAuthError(
      "token-exchange-failed",
      "O Spotify recusou a conexão. Tente conectar novamente."
    );
  }

  const data = await response.json();
  saveToken({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

function clearPkceSession() {
  sessionStorage.removeItem(STORAGE_VERIFIER_KEY);
  sessionStorage.removeItem(STORAGE_STATE_KEY);
}

// ---------- Armazenamento do token ----------

function saveToken(token: SpotifyTokenData) {
  localStorage.setItem(STORAGE_TOKEN_KEY, JSON.stringify(token));
}

function readStoredToken(): SpotifyTokenData | null {
  try {
    const raw = localStorage.getItem(STORAGE_TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SpotifyTokenData;
  } catch {
    return null;
  }
}

export function isSpotifyConnected(): boolean {
  return readStoredToken() !== null;
}

export function disconnectSpotify(): void {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
}

async function refreshToken(current: SpotifyTokenData): Promise<SpotifyTokenData> {
  const clientId = getClientId();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: clientId,
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new SpotifyAuthError(
      "network-error",
      "Não foi possível renovar a conexão com o Spotify agora."
    );
  }

  if (!response.ok) {
    disconnectSpotify();
    throw new SpotifyAuthError(
      "refresh-failed",
      "Sua conexão com o Spotify expirou. Conecte novamente."
    );
  }

  const data = await response.json();
  const updated: SpotifyTokenData = {
    accessToken: data.access_token,
    // o Spotify pode ou não devolver um novo refresh_token
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  saveToken(updated);
  return updated;
}


export async function getValidAccessToken(): Promise<string> {
  const token = readStoredToken();
  if (!token) {
    throw new SpotifyAuthError(
      "not-connected",
      "Conecte sua conta do Spotify para continuar."
    );
  }

  const isExpiringSoon = Date.now() > token.expiresAt - 60_000;
  if (!isExpiringSoon) {
    return token.accessToken;
  }

  const refreshed = await refreshToken(token);
  return refreshed.accessToken;
}
