// Draws a Valorant-style rank card from the contributions of the last 365 days.
// Run by the "Contribution snake" workflow: node .github/scripts/rank-card.mjs <user> <out.svg>
// The emblem is drawn here; no Riot artwork is used.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const C = { bg: "#0f1923", panel: "#16222e", line: "#2b3b4a", red: "#ff4655", cream: "#ece8e1", muted: "#8a9aa6" };

// Contributions needed to reach division 1 of each tier; each tier splits its range into 3 divisions.
const TIERS = [
  { name: "IRON", min: 0, color: "#8b8f94" },
  { name: "BRONZE", min: 75, color: "#b47b52" },
  { name: "SILVER", min: 200, color: "#cfd6db" },
  { name: "GOLD", min: 360, color: "#eac25c" },
  { name: "PLATINUM", min: 550, color: "#3fbccc" },
  { name: "DIAMOND", min: 780, color: "#c98ef2" },
  { name: "ASCENDANT", min: 1050, color: "#3fcf84" },
  { name: "IMMORTAL", min: 1350, color: "#ff5a6e" },
  { name: "RADIANT", min: 1800, color: "#fff1a6" },
];

export function rankFor(total) {
  let t = 0;
  while (t + 1 < TIERS.length && total >= TIERS[t + 1].min) t++;
  const tier = TIERS[t];
  if (tier.name === "RADIANT") return { tier, t, division: 0, rr: 100, next: null, toNext: 0 };
  const span = (TIERS[t + 1].min - tier.min) / 3;
  const division = Math.min(3, Math.floor((total - tier.min) / span) + 1);
  const floor = tier.min + span * (division - 1);
  const ceil = floor + span;
  const rr = Math.floor(((total - floor) / span) * 100);
  const next = division < 3 ? `${tier.name} ${division + 1}` : t + 1 === TIERS.length - 1 ? "RADIANT" : `${TIERS[t + 1].name} 1`;
  return { tier, t, division, rr, next, toNext: Math.ceil(ceil - total) };
}

export async function fetchTotal(user) {
  const html = await (await fetch(`https://github.com/users/${user}/contributions`, { headers: { "User-Agent": "rank-card" } })).text();
  const m = html.match(/id="js-contribution-activity-description"[^>]*>\s*([\d,]+)\s+contributions?/);
  if (!m) throw new Error("Could not find the contribution total");
  return Number(m[1].replace(/,/g, ""));
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
async function fontFace(family, weight, text) {
  const fam = family.replace(/ /g, "+") + (family === "Anton" ? "" : `:wght@${weight}`);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(text)}`, { headers: { "User-Agent": UA } })).text();
  const src = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!src) return ""; // fall back to the system stack rather than failing the whole workflow
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2')}`;
}
const uniq = (strings) => [...new Set(strings.join("").split(""))].join("");
const cham = (x, y, w, h, c) => `M${x + c} ${y}H${x + w}V${y + h - c}L${x + w - c} ${y + h}H${x}V${y + c}Z`;

function emblem(color, division, radiant) {
  const pips = radiant
    ? ""
    : Array.from({ length: division }, (_, i) => {
        const x = (i - (division - 1) / 2) * 16;
        return `<rect x="${x - 4}" y="54" width="8" height="8" transform="rotate(45 ${x} 58)" fill="${color}"/>`;
      }).join("");
  const rays = radiant
    ? Array.from({ length: 8 }, (_, i) => `<rect x="-2" y="-66" width="4" height="14" fill="${color}" transform="rotate(${i * 45})"/>`).join("")
    : "";
  return `${rays}
  <polygon points="0,-46 38,-22 38,18 0,46 -38,18 -38,-22" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="2"/>
  <polygon points="0,-30 22,-8 0,30 -22,-8" fill="${color}"/>
  <polygon points="0,-30 22,-8 0,-2" fill="#fff" fill-opacity=".38"/>
  <polygon points="0,30 -22,-8 0,-2" fill="#000" fill-opacity=".18"/>
  ${pips}`;
}

export async function renderRankCard(total) {
  const W = 400, H = 229;
  const r = rankFor(total);
  const { tier } = r;
  const radiant = tier.name === "RADIANT";
  const rankName = radiant ? "RADIANT" : `${tier.name} ${r.division}`;
  const totalText = `${total.toLocaleString("en-US")} CONTRIBUTIONS`;
  const rrText = radiant ? "TOP RANK" : `${r.rr} / 100 RR`;
  const nextText = radiant ? "TOP 500 ENERGY" : `${r.toNext} TO ${r.next}`;

  const anton = await fontFace("Anton", 400, rankName);
  const h6 = await fontFace("Rajdhani", 600, uniq(["LAST 365 DAYS", "CURRENT RANK", nextText]));
  const h7 = await fontFace("Rajdhani", 700, uniq(["COMPETITIVE", totalText, rrText]));

  const ladder = TIERS.map((t, i) => {
    const x = 36 + i * 41;
    const on = i <= r.t;
    const cur = i === r.t;
    return `<g transform="translate(${x} 203)">${cur ? `<rect x="-9" y="-9" width="18" height="18" transform="rotate(45)" fill="none" stroke="${t.color}" stroke-width="1.5"/>` : ""}<rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="${t.color}" fill-opacity="${on ? 1 : 0.22}"/></g>${i < TIERS.length - 1 ? `<line x1="${x + 9}" x2="${x + 32}" y1="203" y2="203" stroke="${i < r.t ? TIERS[i + 1].color : C.line}" stroke-opacity="${i < r.t ? 0.6 : 1}"/>` : ""}`;
  }).join("");

  const ex = 88, ey = 112, barX = 170, barW = 210;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rank ${rankName}: ${total} contributions in the last 365 days">
<title>${rankName}</title>
<style>${anton}${h6}${h7}
.d{font-family:'Anton',Impact,'Arial Narrow',sans-serif}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
.h7{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:700}
.glow{transform-origin:${ex}px ${ey}px;animation:glow 3s ease-in-out infinite}
@keyframes glow{50%{transform:scale(1.18);opacity:.45}}
.em{transform-origin:${ex}px ${ey}px;opacity:0;animation:em .7s .1s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes em{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
.bar{transform-origin:${barX}px 0;transform:scaleX(0);animation:bar 1.2s .5s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes bar{to{transform:scaleX(1)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.em{opacity:1}.bar{transform:none}}
</style>
<defs>
  <radialGradient id="g"><stop offset="0" stop-color="${tier.color}" stop-opacity=".45"/><stop offset="1" stop-color="${tier.color}" stop-opacity="0"/></radialGradient>
  <linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <clipPath id="barClip"><rect x="${barX}" y="150" width="${(barW * r.rr) / 100}" height="6"/></clipPath>
</defs>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 16)}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>
<rect x="20" y="20" width="4" height="16" fill="${C.red}"/>
<text class="h7" x="32" y="33" font-size="13" letter-spacing="3" fill="${C.cream}">COMPETITIVE</text>
<text class="h6" x="380" y="33" text-anchor="end" font-size="11" letter-spacing="2" fill="${C.muted}">LAST 365 DAYS</text>
<circle class="glow" cx="${ex}" cy="${ey}" r="60" fill="url(#g)"/>
<g class="em"><g transform="translate(${ex} ${ey - 6})">${emblem(tier.color, r.division, radiant)}</g></g>
<text class="h6" x="${barX}" y="78" font-size="11" letter-spacing="3" fill="${C.muted}">CURRENT RANK</text>
<text class="d" x="${barX}" y="114" font-size="34" letter-spacing="1" fill="${tier.color}">${rankName}</text>
<text class="h7" x="${barX}" y="138" font-size="15" letter-spacing="1" fill="${C.cream}">${totalText}</text>
<rect x="${barX}" y="150" width="${barW}" height="6" fill="${C.line}"/>
<g class="bar"><rect x="${barX}" y="150" width="${(barW * r.rr) / 100}" height="6" fill="${tier.color}"/>
  <rect x="${barX - 60}" y="150" width="60" height="6" fill="url(#shine)" clip-path="url(#barClip)"><animate attributeName="x" values="${barX - 60};${barX + barW}" dur="2.6s" begin="1.8s" repeatCount="indefinite"/></rect></g>
<text class="h7" x="${barX}" y="176" font-size="13" letter-spacing="1" fill="${C.cream}">${rrText}</text>
<text class="h6" x="380" y="176" text-anchor="end" font-size="11" letter-spacing="1.5" fill="${C.muted}">${nextText}</text>
${ladder}
</svg>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [user, out] = process.argv.slice(2);
  const total = await fetchTotal(user);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderRankCard(total));
  const r = rankFor(total);
  console.log(`${total} contributions -> ${r.tier.name} ${r.division || ""} (${r.rr} RR)`);
}
