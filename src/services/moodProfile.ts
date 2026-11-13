
export interface GenreProfile {
  energy: number;
  valence: number;
  bpm: number;
}

interface GenreRule {
  matchers: string[];
  profile: GenreProfile;
}

const GENRE_RULES: GenreRule[] = [
  {
    matchers: ["edm", "house", "techno", "electro", "dubstep", "big room", "dance pop"],
    profile: { energy: 0.9, valence: 0.75, bpm: 128 },
  },
  {
    matchers: ["pop rock", "power pop", "dance"],
    profile: { energy: 0.82, valence: 0.78, bpm: 118 },
  },
  {
    matchers: ["indie pop", "indie folk", "bedroom pop"],
    profile: { energy: 0.55, valence: 0.7, bpm: 100 },
  },
  {
    matchers: ["hip hop", "trap", "rap"],
    profile: { energy: 0.78, valence: 0.55, bpm: 95 },
  },
  {
    matchers: ["neo soul", "r&b", "soul"],
    profile: { energy: 0.5, valence: 0.6, bpm: 88 },
  },
  {
    matchers: ["romantic", "love song", "singer-songwriter"],
    profile: { energy: 0.42, valence: 0.75, bpm: 85 },
  },
  {
    matchers: ["lo-fi", "lofi", "chillhop"],
    profile: { energy: 0.25, valence: 0.55, bpm: 80 },
  },
  {
    matchers: ["ambient", "downtempo", "chill"],
    profile: { energy: 0.2, valence: 0.5, bpm: 75 },
  },
  {
    matchers: ["piano", "classical", "instrumental"],
    profile: { energy: 0.22, valence: 0.55, bpm: 78 },
  },
  {
    matchers: ["sad", "emo", "melancholic"],
    profile: { energy: 0.35, valence: 0.3, bpm: 85 },
  },
  {
    matchers: ["folk", "acoustic"],
    profile: { energy: 0.35, valence: 0.65, bpm: 90 },
  },
  {
    matchers: ["alternative", "indie"],
    profile: { energy: 0.6, valence: 0.6, bpm: 105 },
  },
  {
    matchers: ["workout", "gym"],
    profile: { energy: 0.92, valence: 0.7, bpm: 140 },
  },
  {
    matchers: ["pop"],
    profile: { energy: 0.7, valence: 0.72, bpm: 112 },
  },
  {
    matchers: ["rock", "punk", "metal"],
    profile: { energy: 0.85, valence: 0.5, bpm: 130 },
  },
  {
    matchers: ["jazz"],
    profile: { energy: 0.4, valence: 0.6, bpm: 92 },
  },
];

const NEUTRAL_PROFILE: GenreProfile = {
  energy: 0.5,
  valence: 0.5,
  bpm: 100,
};

/**
 * Encontra a regra mais específica que corresponde ao gênero.
 *
 * Exemplo:
 * "indie pop" corresponde a "indie pop", e não à regra genérica "pop".
 */
function findBestGenreRule(genre: string): GenreRule | undefined {
  const normalizedGenre = genre.trim().toLowerCase();

  const matches = GENRE_RULES.flatMap((rule) =>
    rule.matchers
      .filter((matcher) => normalizedGenre.includes(matcher.toLowerCase()))
      .map((matcher) => ({
        rule,
        specificity: matcher.length,
      }))
  );

  matches.sort((a, b) => b.specificity - a.specificity);

  return matches[0]?.rule;
}

/**
 * Estima energy, valence e BPM usando os gêneros do artista.
 *
 * Importante:
 * Esses valores são estimativas próprias do Harmoody,
 * não dados medidos ou fornecidos pelo Spotify.
 *
 * Quando nenhum gênero é reconhecido, utiliza um perfil neutro.
 * Assim, o algoritmo não presume que a música combina com o
 * clima escolhido sem possuir informações para sustentar isso.
 */
export function estimateProfile(
  genres: string[],
  _fallback?: { energy: number; valence: number }
): GenreProfile {
  const uniqueGenres = [...new Set(
    genres.map((genre) => genre.trim().toLowerCase()).filter(Boolean)
  )];

  const matches: GenreProfile[] = [];

  for (const genre of uniqueGenres) {
    const rule = findBestGenreRule(genre);

    if (rule) {
      matches.push(rule.profile);
    }
  }

  if (matches.length === 0) {
    return { ...NEUTRAL_PROFILE };
  }

  const total = matches.reduce(
    (acc, profile) => ({
      energy: acc.energy + profile.energy,
      valence: acc.valence + profile.valence,
      bpm: acc.bpm + profile.bpm,
    }),
    { energy: 0, valence: 0, bpm: 0 }
  );

  return {
    energy: Math.min(1, Math.max(0, total.energy / matches.length)),
    valence: Math.min(1, Math.max(0, total.valence / matches.length)),
    bpm: Math.round(total.bpm / matches.length),
  };
}
