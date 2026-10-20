// Live Spotify card, drawn on every request by a Vercel function so the README shows what is
// playing right now instead of what played at the last hourly run. GitHub's image proxy refetches
// it on each page view because the response says not to cache; Vercel's CDN keeps it for a few
// seconds so a burst of views makes one set of Spotify calls.
// Env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN (see .github/scripts/spotify-auth.mjs).
// If anything fails it redirects to the hourly card on the output branch.
import { fetchTracks, renderSpotifyCard } from "../.github/scripts/spotify-card.mjs";

const FALLBACK = "https://raw.githubusercontent.com/YongkyA23/YongkyA23/output/spotify.svg";

export default async function handler(req, res) {
  const creds = { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET, refreshToken: process.env.SPOTIFY_REFRESH_TOKEN };
  try {
    if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) throw new Error("Spotify env vars not set");
    const svg = await renderSpotifyCard(await fetchTracks(creds));
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, max-age=0");
    res.setHeader("Vercel-CDN-Cache-Control", "max-age=10, stale-while-revalidate=20");
    res.status(200).send(svg);
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-cache, max-age=0");
    res.redirect(302, FALLBACK);
  }
}
