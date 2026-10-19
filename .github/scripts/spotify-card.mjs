// Recently played on Spotify, as a Valorant-style card the same size as the rank card.
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN (set them once with
// `node .github/scripts/spotify-auth.mjs`). Without them it exits quietly and writes nothing.
// Run hourly by the profile workflow: node .github/scripts/spotify-card.mjs <out.svg>
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { C, cham, fontFace, uniq } from "./rank-card.mjs";

const TEAL = "#36e6b5";
const SPOTIFY_GREEN = "#1ed760";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TZ_OFFSET_H = 7; // times are shown in WIB

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function accessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Spotify token refresh failed: ${json.error_description || json.error || res.status}`);
  return json.access_token;
}

async function art(url) {
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const smallest = (images = []) => [...images].sort((a, b) => a.width - b.width)[0]?.url;

export async function fetchTracks(creds) {
  const token = await accessToken(creds);
  const headers = { Authorization: `Bearer ${token}` };
  const now = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers });
  const playing = now.status === 200 ? await now.json() : null;
  const recent = await (await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=3", { headers })).json();
  const tracks = (recent.items || []).map((it) => ({ track: it.track, playedAt: it.played_at }));
  if (playing?.is_playing && playing.item?.type === "track") {
    tracks.unshift({ track: playing.item, playedAt: null });
  }
  const seen = new Set();
  const out = [];
  for (const { track, playedAt } of tracks) {
    if (seen.has(track.id) || out.length === 3) continue;
    seen.add(track.id);
    out.push({
      title: track.name,
      artist: track.artists.map((a) => a.name).join(", "),
      art: await art(smallest(track.album?.images)),
      playedAt,
    });
  }
  return { nowPlaying: Boolean(playing?.is_playing), tracks: out };
}

function when(iso) {
  if (!iso) return "NOW";
  const t = new Date(Date.parse(iso) + TZ_OFFSET_H * 3600e3);
  const today = new Date(Date.now() + TZ_OFFSET_H * 3600e3);
  const hhmm = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  const day = (d) => Math.floor(d.getTime() / 86400e3);
  const diff = day(today) - day(t);
  if (diff === 0) return `TODAY ${hhmm}`;
  if (diff === 1) return `YESTERDAY ${hhmm}`;
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

// Spotify's mark, drawn as three arcs inside a circle.
const spotifyMark = (x, y, r, color) =>
  `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${color}"/><path d="M${-r * 0.55} ${-r * 0.22}q${r * 0.55} ${-r * 0.22} ${r * 1.1} ${r * 0.12}M${-r * 0.45} ${r * 0.1}q${r * 0.45} ${-r * 0.17} ${r * 0.9} ${r * 0.1}M${-r * 0.36} ${r * 0.4}q${r * 0.36} ${-r * 0.12} ${r * 0.72} ${r * 0.08}" fill="none" stroke="${C.bg}" stroke-width="${r * 0.17}" stroke-linecap="round"/></g>`;

export async function renderSpotifyCard({ nowPlaying, tracks }) {
  const W = 400, H = 229;
  const head = nowPlaying ? "NOW PLAYING" : "RECENTLY PLAYED";
  const rows = tracks.map((t) => ({ ...t, title: clip(t.title, 30), artist: clip(t.artist, 34), at: when(t.playedAt) }));
  const h6 = await fontFace("Rajdhani", 600, uniq(["SPOTIFY", ...rows.map((r) => r.artist + r.at)]));
  const h7 = await fontFace("Rajdhani", 700, uniq([head, "RADIO // COMMS", ...rows.map((r) => r.title)]));

  const rowEls = rows
    .map((r, i) => {
      const y = 50 + i * 56;
      const first = i === 0;
      const cover = r.art
        ? `<image href="${r.art}" x="20" y="${y}" width="44" height="44" clip-path="url(#cov)"/>`
        : `<rect x="20" y="${y}" width="44" height="44" fill="${C.panel}"/>`;
      const eq = first
        ? Array.from({ length: 4 }, (_, k) => `<rect x="${W - 46 + k * 6}" y="${y + 8}" width="3.5" height="16" fill="${TEAL}" style="transform-origin:0 ${y + 24}px;animation:eq ${0.7 + k * 0.17}s ${k * 0.11}s ease-in-out infinite alternate"/>`).join("")
        : "";
      return `<g class="row" style="animation-delay:${(0.15 + i * 0.12).toFixed(2)}s">
  ${first ? `<path d="${cham(12, y - 6, W - 24, 56, 8)}" fill="${C.panel}"/>` : ""}
  ${cover}
  <path d="${cham(20, y, 44, 44, 7)}" fill="none" stroke="${first ? C.red : C.line}" stroke-width="1.2"/>
  <text class="h7" x="76" y="${y + 19}" font-size="16" fill="${C.cream}">${esc(r.title)}</text>
  <text class="h6" x="76" y="${y + 37}" font-size="13" fill="${C.muted}">${esc(r.artist)}</text>
  ${first ? eq : `<text class="h6" x="${W - 20}" y="${y + 19}" text-anchor="end" font-size="11" letter-spacing="1.5" fill="${C.muted}">${esc(r.at)}</text>`}
  ${first ? `<text class="h6" x="${W - 52}" y="${y + 37}" text-anchor="end" font-size="11" letter-spacing="1.5" fill="${nowPlaying ? TEAL : C.muted}">${esc(r.at)}</text>` : ""}
</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${head.toLowerCase()} on Spotify: ${rows.map((r) => `${r.title} by ${r.artist}`).join("; ")}">
<title>${head}</title>
<style>${h6}${h7}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
.h7{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:700}
.row{opacity:0;animation:in .5s forwards}
@keyframes in{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
@keyframes eq{from{transform:scaleY(.2)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.row{opacity:1}}
</style>
<defs><clipPath id="cov" clipPathUnits="objectBoundingBox"><path d="${cham(0, 0, 1, 1, 0.16)}"/></clipPath></defs>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 16)}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>
<rect x="20" y="16" width="4" height="16" fill="${C.red}"/>
<text class="h7" x="32" y="29" font-size="13" letter-spacing="3" fill="${C.cream}">${head}</text>
${spotifyMark(W - 30, 24, 8, SPOTIFY_GREEN)}
<text class="h6" x="${W - 44}" y="28" text-anchor="end" font-size="11" letter-spacing="2" fill="${C.muted}">SPOTIFY</text>
${rowEls}
</svg>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out] = process.argv.slice(2);
  const creds = { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET, refreshToken: process.env.SPOTIFY_REFRESH_TOKEN };
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    console.log("spotify: secrets not set, skipping");
    process.exit(0);
  }
  const data = await fetchTracks(creds);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderSpotifyCard(data));
  console.log(`spotify: ${data.tracks.length} tracks${data.nowPlaying ? " (now playing)" : ""}`);
}
