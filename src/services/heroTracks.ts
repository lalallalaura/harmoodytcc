
import { SpotifyTrack } from "../types";
import { searchTracks } from "./spotifyApi";

const CACHE_KEY = "harmoody_hero_tracks";
const CACHE_DURATION = 60 * 60 * 1000;

interface HeroCache {
  tracks: SpotifyTrack[];
  timestamp: number;
}

export async function getHeroTracks(): Promise<SpotifyTrack[]> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);

    if (cached) {
      const parsed: HeroCache = JSON.parse(cached);

      if (
        Date.now() - parsed.timestamp < CACHE_DURATION &&
        parsed.tracks.length > 0
      ) {
        return parsed.tracks;
      }
    }
  } catch {
  }

  const queries = [
    "indie pop",
    "alternative rock",
    "dream pop",
    "synthpop",
    "r&b soul",
    "electropop",
  ];

  const results = await Promise.allSettled(
    queries.map((query) => searchTracks(query, 5))
  );

  const tracks: SpotifyTrack[] = [];
  const seenIds = new Set<string>();

  results.forEach((result) => {
    if (result.status !== "fulfilled") return;

    for (const track of result.value) {
      if (
        !track.id ||
        !track.cover ||
        seenIds.has(track.id)
      ) {
        continue;
      }

      tracks.push(track);
      seenIds.add(track.id);
      break;
    }
  });

  if (tracks.length > 0) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          tracks,
          timestamp: Date.now(),
        })
      );
    } catch {
    }
  }

  return tracks;
}
