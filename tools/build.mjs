// Generates the static animated SVGs for the GitHub profile README (Valorant theme): hero, comms
// buttons, abilities, arsenal, kill feed, divider and footer. The live cards (range, career, rank,
// views, Spotify) are drawn hourly by .github/scripts in the workflow.
// Official VALORANT assets (valorant-api.com) live in tools/valorant and are used under Riot's fan
// content policy; the README carries the notice.
// Usage: node tools/build.mjs           -> writes assets/*.svg
//        node tools/build.mjs --preview -> also writes preview/index.html (every image inlined)
// Set PROFILE_USER to your GitHub username when you fork this.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Works from the profile repo itself, or from a workspace that keeps the repo in ./profile.
const PROFILE = existsSync(join(ROOT, "profile", ".github")) ? join(ROOT, "profile") : ROOT;
const OUT = join(PROFILE, "assets");
const USER = process.env.PROFILE_USER || "YongkyA23";
const script = (name) => import(pathToFileURL(join(PROFILE, ".github", "scripts", name)).href);
const { fetchTotal, renderRankCard } = await script("rank-card.mjs");
const { fetchStats, renderCareerCard } = await script("career-card.mjs");
const { fetchGrid, renderRangeCard } = await script("range-card.mjs");
const { fetchViews, renderViewsCard } = await script("views-card.mjs");
const { renderSpotifyCard } = await script("spotify-card.mjs");

const C = {
  bg: "#0f1923",
  panel: "#16222e",
  panel2: "#1d2b38",
  line: "#2b3b4a",
  red: "#ff4655",
  cream: "#ece8e1",
  muted: "#8a9aa6",
  soft: "#b9c2c9",
  teal: "#36e6b5",
};
const DISPLAY = "Anton";
const HUD = "Rajdhani";
const MONO = "JetBrains Mono";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const uniq = (strings) => [...new Set(strings.join("").split(""))].join("");

// Google Fonts subsets a face to just the glyphs we pass in `text`, so each SVG embeds a few KB.
async function fontFace(family, weight, text) {
  const fam = family.replace(/ /g, "+") + (family === DISPLAY ? "" : `:wght@${weight}`);
  const url = `https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const src = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!src) throw new Error(`No font for ${family} ${weight}:\n${css}`);
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2')}`;
}

const fontCss = `
.d{font-family:'${DISPLAY}',Impact,'Arial Narrow',sans-serif;font-weight:400}
.h6{font-family:'${HUD}','Arial Narrow',sans-serif;font-weight:600}
.h7{font-family:'${HUD}','Arial Narrow',sans-serif;font-weight:700}
.m{font-family:'${MONO}',ui-monospace,Consolas,monospace;font-weight:500}`;

const reducedMotion = (extra = "") =>
  `@media (prefers-reduced-motion: reduce){*{animation:none!important}${extra}}`;

// Valorant UI panels cut the top-left and bottom-right corners.
const cham = (x, y, w, h, c = 12) => `M${x + c} ${y}H${x + w}V${y + h - c}L${x + w - c} ${y + h}H${x}V${y + c}Z`;

function brackets(x, y, w, h, len, color, sw = 2) {
  const p = [
    `M${x} ${y + len}V${y}H${x + len}`,
    `M${x + w - len} ${y}H${x + w}V${y + len}`,
    `M${x + w} ${y + h - len}V${y + h}H${x + w - len}`,
    `M${x + len} ${y + h}H${x}V${y + h - len}`,
  ];
  return `<path d="${p.join("")}" fill="none" stroke="${color}" stroke-width="${sw}" opacity=".35"/>`;
}

// Headshot marker for the kill feed.
const headshot = (x, y) =>
  `<g transform="translate(${x} ${y})"><circle r="8" fill="none" stroke="${C.red}" stroke-width="1.6"/><circle r="2.4" fill="${C.red}"/><path d="M-12 0h3M9 0h3M0 -12v3M0 9v3" stroke="${C.red}" stroke-width="1.6"/></g>`;

// The "Y" agent emblem, centred on (0,0), about 100 units tall.
const emblem = `<g>
  <polygon points="-46,-44 -24,-44 10,6 -10,6" fill="${C.red}"/>
  <polygon points="46,-44 25,-44 2,-10 13,4" fill="${C.cream}"/>
  <polygon points="-10,6 10,6 10,48 -10,48" fill="${C.red}"/>
</g>`;

// skillicons.dev has no Proxmox icon, so draw one in the same style from the simple-icons logo.
const FALLBACK_ICONS = { proxmox: { slug: "proxmox", color: "#E57000" } };
const iconCache = new Map();
async function icon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let svg;
  if (FALLBACK_ICONS[id]) {
    const { slug, color } = FALLBACK_ICONS[id];
    const logo = await (await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/${slug}.svg`)).text();
    const path = logo.match(/<path d="([^"]+)"/)[1];
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 256 256"><rect width="256" height="256" rx="60" fill="#242938"/><path d="${path}" fill="${color}" transform="translate(48 48) scale(6.667)"/></svg>`;
  } else {
    svg = await (await fetch(`https://skillicons.dev/icons?i=${id}&theme=dark`)).text();
    if (svg.includes("undefined")) throw new Error(`skillicons.dev has no icon "${id}"`);
  }
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  iconCache.set(id, uri);
  return uri;
}

function wrap(text, max) {
  const out = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// Panel frame + section heading shared by the content cards.
const sectionHead = (title, sub, size = 46) =>
  `<rect x="48" y="52" width="10" height="34" fill="${C.red}"/>
<text class="d" x="70" y="86" font-size="${size}" letter-spacing="1" fill="${C.cream}">${esc(title)}</text>
${sub ? `<text class="h6" x="70" y="112" font-size="15" letter-spacing="4" fill="${C.muted}">${esc(sub)}</text>` : ""}`;
const frame = (W, H) => `<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 28)}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>`;

// Official VALORANT assets (valorant-api.com) kept in tools/valorant, inlined as data URIs.
const asset = async (file) => `data:image/${file.endsWith(".jpg") ? "jpeg" : "png"};base64,${(await readFile(join(ROOT, "tools", "valorant", file))).toString("base64")}`;

// ---------- hero: agent select ----------
async function hero() {
  const W = 1200, H = 360;
  const label = "AGENT // YONGKYA23";
  const first = "YONGKY", last = "ANTHONY";
  const roles = ["SHIPS FULL-STACK WEB APPS", "BUILDS APIS WITH NESTJS", "SELF-HOSTS ON PROXMOX", "MAKES ROBLOX GAMES"];
  const info = [["ROLE", "FULL-STACK DEV", 64], ["TEAM", "HANTAM KREASI UTAMA", 249], ["REGION", "AP · INDONESIA", 503]];
  const marquee = "FULL-STACK DEVELOPER  ·  ";
  const btn = ["LOCK IN", "AGENT LOCKED"];

  const display = await fontFace(DISPLAY, 400, uniq([first, last, marquee, ...btn]));
  const h6 = await fontFace(HUD, 600, uniq([label, ...roles, "//", ...info.map((i) => i[0])]));
  const h7 = await fontFace(HUD, 700, uniq(info.map((i) => i[1])));

  const ex = 960, ey = 160;
  const buddy = await asset("buddy.png"); // V26A3: Radiant Buddy
  const card = await asset("jett-card.jpg"); // VALORANT Jett Card (player card)
  const roleEls = roles
    .map((t, i) => `<text class="h6 role" x="392" y="257" font-size="18" letter-spacing="2" fill="${C.cream}" style="animation-delay:${i * 3}s"><tspan fill="${C.red}">// </tspan>${esc(t)}</text>`)
    .join("");
  const infoEls = info
    .map(([k, v, x], i) => `${i ? `<line x1="${x - 16}" x2="${x - 16}" y1="290" y2="334" stroke="${C.line}"/>` : ""}<text class="h6" x="${x}" y="304" font-size="13" letter-spacing="3" fill="${C.muted}">${k}</text><text class="h7" x="${x}" y="329" font-size="21" letter-spacing="1" fill="${C.cream}">${esc(v)}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Agent select screen: Yongky Anthony, full-stack developer, team Hantam Kreasi Utama, region Indonesia">
<title>Yongky Anthony</title>
<style>${display}${h6}${h7}${fontCss}
.in{opacity:0;animation:in .6s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes in{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
.pop{opacity:0;transform-origin:${ex}px ${ey}px;animation:pop .7s .3s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes pop{from{opacity:0;transform:scale(.6) rotate(-20deg)}to{opacity:1;transform:none}}
.g1,.g2{opacity:0;animation:glitch 5s 2s infinite steps(1)}
.g2{animation-delay:2.07s}
@keyframes glitch{0%{opacity:0}92%{opacity:1;transform:translate(-6px,0)}94%{opacity:1;transform:translate(5px,0)}96%{opacity:1;transform:translate(-2px,0)}98%,100%{opacity:0}}
.role{opacity:0;animation:role 12s infinite}
@keyframes role{0%{opacity:0;transform:translateY(8px)}3%,22%{opacity:1;transform:none}25%,100%{opacity:0;transform:translateY(-8px)}}
.spin{transform-origin:${ex}px ${ey}px;animation:spin 30s linear infinite}
.spin.r{animation-duration:16s;animation-direction:reverse}
@keyframes spin{to{transform:rotate(360deg)}}
.marq{animation:marq 40s linear infinite}
@keyframes marq{to{transform:translateX(-1600px)}}
.b1{animation:b1 6s infinite}.b2{opacity:0;animation:b2 6s infinite}
@keyframes b1{0%,70%{opacity:1}72%,100%{opacity:0}}
@keyframes b2{0%,70%{opacity:0}72%,100%{opacity:1}}
.bbg{animation:bbg 6s infinite}
@keyframes bbg{0%,70%{fill:${C.red}}72%,100%{fill:${C.cream}}}
.timer{transform-origin:0 0;animation:timer 10s linear infinite}
.swing{transform-origin:1150px 18px;animation:swing 3.2s ease-in-out infinite}
@keyframes swing{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}
@keyframes timer{from{transform:scaleX(0)}to{transform:scaleX(1)}}
${reducedMotion(".in,.pop{opacity:1}.role:first-of-type{opacity:1}")}
</style>
<defs>
  <clipPath id="card"><path d="${cham(0, 0, W, H, 32)}"/></clipPath>
  <pattern id="diag" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="14" stroke="${C.line}" stroke-width="1"/></pattern>
  <pattern id="hazard" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    <rect width="8" height="16" fill="${C.red}"/>
  </pattern>
  <clipPath id="panel"><polygon points="800,0 ${W},0 ${W},${H} 700,${H}"/></clipPath>
  <linearGradient id="cardShade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.bg}" stop-opacity=".35"/><stop offset=".55" stop-color="${C.bg}" stop-opacity=".55"/><stop offset="1" stop-color="${C.bg}" stop-opacity=".9"/></linearGradient>
  <clipPath id="top"><rect x="0" y="0" width="${W}" height="165"/></clipPath>
  <clipPath id="bot"><rect x="0" y="165" width="${W}" height="${H}"/></clipPath>
</defs>
<g clip-path="url(#card)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <g opacity=".18"><g class="marq">
    <text class="d" x="0" y="340" font-size="190" fill="none" stroke="${C.line}" stroke-width="1.5" textLength="1600" lengthAdjust="spacingAndGlyphs">${esc(marquee.repeat(2))}</text>
    <text class="d" x="1600" y="340" font-size="190" fill="none" stroke="${C.line}" stroke-width="1.5" textLength="1600" lengthAdjust="spacingAndGlyphs">${esc(marquee.repeat(2))}</text>
  </g></g>
  <polygon points="800,0 ${W},0 ${W},${H} 700,${H}" fill="${C.panel}"/>
  <g clip-path="url(#panel)"><image href="${card}" x="690" y="-160" width="520" height="1242" preserveAspectRatio="xMidYMin slice" opacity=".55"/>
    <rect x="690" y="0" width="520" height="${H}" fill="url(#cardShade)"/></g>
  <polygon points="800,0 ${W},0 ${W},${H} 700,${H}" fill="url(#diag)" opacity=".35"/>
  <polygon points="782,0 800,0 700,${H} 682,${H}" fill="${C.red}"/>
  <rect x="1060" y="0" width="${W - 1060}" height="18" fill="url(#hazard)"/>
  <g class="swing"><line x1="1150" y1="18" x2="1150" y2="34" stroke="${C.muted}" stroke-width="1.5"/><image href="${buddy}" x="1098" y="26" width="104" height="104"/></g>

  <g class="pop">
    <circle cx="${ex}" cy="${ey}" r="122" fill="none" stroke="${C.cream}" stroke-opacity=".25" stroke-dasharray="2 10" class="spin"/>
    <circle cx="${ex}" cy="${ey}" r="104" fill="none" stroke="${C.red}" stroke-width="3" stroke-dasharray="90 73.4" class="spin r"/>
    <path d="M${ex} ${ey - 150}v18M${ex} ${ey + 132}v18M${ex - 150} ${ey}h18M${ex + 132} ${ey}h18" stroke="${C.cream}" stroke-opacity=".6" stroke-width="2"/>
    <rect x="${ex - 66}" y="${ey - 66}" width="132" height="132" transform="rotate(45 ${ex} ${ey})" fill="${C.bg}" stroke="${C.cream}" stroke-opacity=".5"/>
    <g transform="translate(${ex} ${ey}) scale(.95)">${emblem}</g>
  </g>
  ${brackets(812, 14, 296, 270, 18, C.cream, 1.5)}

  <g transform="translate(${ex - 100} 296)">
    <path class="bbg" d="${cham(0, 0, 200, 44, 10)}" fill="${C.red}"/>
    <text class="d b1" x="100" y="32" text-anchor="middle" font-size="26" letter-spacing="5" fill="${C.cream}">${btn[0]}</text>
    <text class="d b2" x="100" y="32" text-anchor="middle" font-size="22" letter-spacing="3" fill="${C.bg}">${btn[1]}</text>
  </g>

  <g class="in" style="animation-delay:.1s"><rect x="64" y="58" width="10" height="10" fill="${C.red}"/><text class="h6" x="84" y="68" font-size="16" letter-spacing="4" fill="${C.muted}">${esc(label)}</text></g>
  <g class="in" style="animation-delay:.2s">
    <text class="d" x="64" y="200" font-size="128" textLength="430" lengthAdjust="spacingAndGlyphs" fill="${C.cream}">${first}</text>
    <text class="d g1" x="64" y="200" font-size="128" textLength="430" lengthAdjust="spacingAndGlyphs" fill="${C.red}" clip-path="url(#top)">${first}</text>
    <text class="d g2" x="64" y="200" font-size="128" textLength="430" lengthAdjust="spacingAndGlyphs" fill="${C.teal}" clip-path="url(#bot)">${first}</text>
  </g>
  <g class="in" style="animation-delay:.4s"><text class="d" x="64" y="258" font-size="54" textLength="300" lengthAdjust="spacingAndGlyphs" fill="${C.red}" fill-opacity=".14" stroke="${C.red}" stroke-width="1.5">${last}</text></g>
  ${roleEls}
  <g class="in" style="animation-delay:.7s">${infoEls}</g>

  <rect x="0" y="${H - 5}" width="${W}" height="5" fill="${C.line}"/>
  <rect class="timer" x="0" y="${H - 5}" width="${W}" height="5" fill="${C.red}"/>
</g>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 32)}" fill="none" stroke="${C.line}" stroke-width="1.5"/>
</svg>`;
}

// ---------- abilities: C / Q / E / X ----------
const ABILITIES = [
  { key: "C", type: "BASIC", name: "TYPE SAFETY", icon: "ts", desc: "Puts up a type wall that stops runtime bugs before they cross.", tags: "TypeScript · Zod", charges: 2 },
  { key: "Q", type: "BASIC", name: "COMPONENT FLASH", icon: "react", desc: "Pops reusable UI into view, fast and accessible.", tags: "React · Tailwind CSS · Vite · shadcn/ui", charges: 2 },
  { key: "E", type: "SIGNATURE", name: "API SMOKE", icon: "nestjs", desc: "Covers the whole backend with APIs, workers and queues.", tags: "NestJS · Fastify · Bun · Prisma · PostgreSQL", charges: "sig" },
  { key: "X", type: "ULTIMATE", name: "DEPLOY PROTOCOL", icon: "docker", desc: "Ships the full stack to self-hosted infra in one push.", tags: "Docker · Nginx · Cloudflare · Proxmox", charges: "ult" },
];

async function abilities() {
  const W = 1200, H = 470;
  const title = "ABILITIES", sub = "LOADOUT // YONGKY", right = "DUELIST CLASS";
  const display = await fontFace(DISPLAY, 400, uniq([title, ...ABILITIES.map((a) => a.key + a.name)]));
  const h6 = await fontFace(HUD, 600, uniq([sub, right, "READY", ...ABILITIES.map((a) => a.type + a.desc)]));
  const mono = await fontFace(MONO, 500, uniq(ABILITIES.map((a) => a.tags)));

  const cw = 264, ch = 304, gap = 16, top = 134;
  let cards = "";
  for (let i = 0; i < ABILITIES.length; i++) {
    const a = ABILITIES[i];
    const x = 48 + i * (cw + gap), y = top;
    const ult = a.charges === "ult";
    const desc = wrap(a.desc, 27).map((l, j) => `<text class="h6" x="${x + 20}" y="${y + 170 + j * 22}" font-size="17" fill="${C.soft}">${esc(l)}</text>`).join("");
    const tags = wrap(a.tags, 27).map((l, j) => `<text class="m" x="${x + 20}" y="${y + 240 + j * 18}" font-size="12.5" fill="${C.teal}">${esc(l)}</text>`).join("");
    let charges = "";
    const py = y + ch - 30;
    if (typeof a.charges === "number") {
      for (let k = 0; k < a.charges; k++) charges += `<rect x="${x + 20 + k * 22}" y="${py}" width="16" height="6" fill="${C.cream}"/>`;
    } else if (a.charges === "sig") {
      charges = `<rect x="${x + 20}" y="${py}" width="60" height="6" fill="${C.line}"/><rect class="sig" x="${x + 20}" y="${py}" width="60" height="6" fill="${C.cream}" style="transform-origin:${x + 20}px ${py}px"/>`;
    } else {
      for (let k = 0; k < 7; k++) {
        const px = x + 26 + k * 20;
        charges += `<rect x="${px - 5}" y="${py - 2}" width="10" height="10" transform="rotate(45 ${px} ${py + 3})" fill="none" stroke="${C.red}" stroke-opacity=".5"/>`;
        charges += `<rect class="pip" x="${px - 5}" y="${py - 2}" width="10" height="10" transform="rotate(45 ${px} ${py + 3})" fill="${C.red}" style="animation-delay:${(k * 0.45).toFixed(2)}s"/>`;
      }
      charges += `<text class="h6 ready" x="${x + cw - 20}" y="${py + 8}" text-anchor="end" font-size="15" letter-spacing="3" fill="${C.red}">READY</text>`;
    }
    cards += `<g class="card" style="animation-delay:${(0.2 + i * 0.12).toFixed(2)}s">
  <path d="${cham(x, y, cw, ch, 16)}" fill="${ult ? C.panel2 : C.panel}" stroke="${ult ? C.red : C.line}" stroke-opacity="${ult ? 0.7 : 1}"/>
  <rect x="${x + 16}" y="${y}" width="56" height="3" fill="${C.red}"/>
  <rect x="${x + 20}" y="${y + 22}" width="44" height="44" fill="${ult ? C.red : C.bg}" stroke="${C.red}"/>
  <text class="d" x="${x + 42}" y="${y + 56}" text-anchor="middle" font-size="28" fill="${C.cream}">${a.key}</text>
  <image href="${await icon(a.icon)}" x="${x + cw - 68}" y="${y + 20}" width="48" height="48"/>
  <text class="h6" x="${x + 20}" y="${y + 98}" font-size="13" letter-spacing="3" fill="${ult ? C.red : C.muted}">${a.type}</text>
  <text class="d" x="${x + 20}" y="${y + 134}" font-size="29" letter-spacing=".5" fill="${C.cream}">${esc(a.name)}</text>
  ${desc}${tags}${charges}
</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Abilities. C, Type Safety: TypeScript and Zod. Q, Component Flash: React, Tailwind CSS, Vite, shadcn/ui. E, API Smoke: NestJS, Fastify, Bun, Prisma, PostgreSQL. X, Deploy Protocol: Docker, Nginx, Cloudflare, Proxmox.">
<title>Abilities</title>
<style>${display}${h6}${mono}${fontCss}
.card{opacity:0;animation:rise .6s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.sig{animation:sig 4s ease-in-out infinite}
@keyframes sig{0%{transform:scaleX(0)}70%,100%{transform:scaleX(1)}}
.pip{opacity:0;animation:pip 6s infinite}
@keyframes pip{0%{opacity:0}6%,85%{opacity:1}100%{opacity:0}}
.ready{opacity:0;animation:ready 6s infinite}
@keyframes ready{0%,52%{opacity:0}55%,62%,70%,85%{opacity:1}58%,66%{opacity:.3}100%{opacity:0}}
${reducedMotion(".card,.pip,.ready{opacity:1}")}
</style>
${frame(W, H)}
${sectionHead(title, sub)}
<text class="h6" x="1152" y="86" text-anchor="end" font-size="16" letter-spacing="5" fill="${C.red}">${right}</text>
<line x1="${1152 - 150}" x2="1152" y1="98" y2="98" stroke="${C.line}"/>
${cards}
</svg>`;
}

// ---------- arsenal: buy menu ----------
const ARSENAL = [
  { cat: "SIDEARMS", weapon: "classic", sub: "TOOLING", items: [["git", "Git", 0], ["linux", "Linux", 150], ["vite", "Vite", 300], ["vitest", "Vitest", 450], ["figma", "Figma", 500], ["lua", "Luau", 800]] },
  { cat: "SMGS", weapon: "spectre", sub: "FRONTEND", items: [["html", "HTML", 950], ["css", "CSS", 1100], ["js", "JavaScript", 1600], ["tailwind", "Tailwind", 1850], ["threejs", "Three.js", 2050]] },
  { cat: "RIFLES", weapon: "vandal", sub: "CORE", items: [["ts", "TypeScript", 2900], ["react", "React", 2900], ["nestjs", "NestJS", 2250], ["bun", "Bun", 2050], ["nodejs", "Node.js", 1850], ["php", "PHP", 1600]] },
  { cat: "SNIPERS", weapon: "operator", sub: "DATA", items: [["postgres", "PostgreSQL", 4700], ["prisma", "Prisma", 2400], ["mysql", "MySQL", 1100], ["firebase", "Firebase", 950]] },
  { cat: "HEAVIES", weapon: "odin", sub: "INFRA", items: [["docker", "Docker", 3200], ["proxmox", "Proxmox", 3200], ["nginx", "Nginx", 1600], ["cloudflare", "Cloudflare", 1100]] },
];

async function arsenal() {
  const W = 1200;
  const title = "ARSENAL", sub = "TECH STACK // BUY PHASE";
  const names = ARSENAL.flatMap((c) => c.items.map((i) => i[1].toUpperCase()));
  const display = await fontFace(DISPLAY, 400, uniq([title, "9000", ...ARSENAL.map((c) => c.cat)]));
  const h6 = await fontFace(HUD, 600, uniq([sub, "VALORANT POINTS", ...ARSENAL.map((c) => c.sub)]));
  // Official VALORANT Points icon (valorant-api.com), defined once and reused on every tile.
  const vp = `data:image/png;base64,${(await readFile(join(ROOT, "tools", "valorant", "vp.png"))).toString("base64")}`;
  const h7 = await fontFace(HUD, 700, uniq(names));
  const mono = await fontFace(MONO, 500, "0123456789");

  const colW = 208, gap = 16, tileH = 54, rowGap = 10, tilesTop = 200;
  const rows = Math.max(...ARSENAL.map((c) => c.items.length));
  const H = tilesTop + rows * (tileH + rowGap) + 30;
  let cols = "";
  const positions = [];
  let n = 0;
  for (let ci = 0; ci < ARSENAL.length; ci++) {
    const c = ARSENAL[ci];
    const x = 48 + ci * (colW + gap);
    cols += `<text class="d" x="${x}" y="158" font-size="26" letter-spacing="1" fill="${C.cream}">${c.cat}</text>`;
    cols += `<text class="h6" x="${x}" y="180" font-size="13" letter-spacing="3" fill="${C.muted}">${c.sub}</text>`;
    cols += `<rect x="${x}" y="188" width="36" height="2" fill="${C.red}"/>`;
    // Official weapon silhouette for the category, right-aligned in the column header.
    cols += `<image href="${await asset(`weapons/${c.weapon}.png`)}" x="${x + colW - 104}" y="136" width="104" height="38" preserveAspectRatio="xMaxYMid meet" opacity=".7"/>`;
    for (let ri = 0; ri < c.items.length; ri++) {
      const [id, name, price] = c.items[ri];
      const y = tilesTop + ri * (tileH + rowGap);
      positions.push([x, y]);
      cols += `<g class="tile" style="animation-delay:${(0.15 + n * 0.035).toFixed(2)}s">
  <path d="${cham(x, y, colW, tileH, 10)}" fill="${C.panel}" stroke="${C.line}"/>
  <image href="${await icon(id)}" x="${x + 12}" y="${y + 11}" width="32" height="32"/>
  <text class="h7" x="${x + 56}" y="${y + 25}" font-size="17" letter-spacing=".5" fill="${C.cream}">${esc(name.toUpperCase())}</text>
  <use href="#vp" x="${x + 56}" y="${y + 33}" width="12" height="12" opacity=".75"/><text class="m" x="${x + 73}" y="${y + 43}" font-size="12" fill="${C.muted}">${price}</text>
</g>`;
      n++;
    }
  }
  const step = 0.7;
  const values = positions.map(([x, y]) => `${x} ${y}`).join(";");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Arsenal, the tech stack as a buy menu with VALORANT weapon classes. Tooling: Git, Linux, Vite, Vitest, Figma, Luau. Frontend: HTML, CSS, JavaScript, Tailwind, Three.js. Core: TypeScript, React, NestJS, Bun, Node.js, PHP. Data: PostgreSQL, Prisma, MySQL, Firebase. Infra: Docker, Proxmox, Nginx, Cloudflare.">
<title>Arsenal</title>
<style>${display}${h6}${h7}${mono}${fontCss}
.tile{opacity:0;animation:tile .45s ease-out forwards}
@keyframes tile{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sel{opacity:0;animation:selIn .3s 1.4s forwards}
@keyframes selIn{to{opacity:1}}
${reducedMotion(".tile{opacity:1}.sel{display:none}")}
</style>
${frame(W, H)}
${sectionHead(title, sub)}
<defs><symbol id="vp" viewBox="0 0 128 128"><image href="${vp}" width="128" height="128"/></symbol></defs>
<use href="#vp" x="1044" y="57" width="28" height="28"/>
<text class="d" x="1152" y="86" text-anchor="end" font-size="36" fill="${C.cream}">9000</text>
<text class="h6" x="1152" y="110" text-anchor="end" font-size="13" letter-spacing="4" fill="${C.muted}">VALORANT POINTS</text>
${cols}
<g class="sel"><g transform="translate(${positions[0][0]} ${positions[0][1]})">
  <animateTransform attributeName="transform" type="translate" values="${values}" dur="${(positions.length * step).toFixed(1)}s" begin="1.4s" repeatCount="indefinite" calcMode="discrete"/>
  <path d="${cham(0, 0, colW, tileH, 10)}" fill="${C.red}" fill-opacity=".1" stroke="${C.red}" stroke-width="2"/>
  <rect x="${colW - 8}" y="${tileH / 2 - 8}" width="3" height="16" fill="${C.red}"/>
</g></g>
</svg>`;
}

// ---------- combat report + kill feed ----------
async function killfeed() {
  const W = 1200, H = 290;
  const title = "COMBAT REPORT";
  const report = [
    ["CURRENT MISSION", "Building full-stack web apps at Hantam Kreasi Utama"],
    ["TRAINING", "Three.js · Roblox game dev (Luau + Rojo)"],
    ["COMMS", "linkedin.com/in/yongky-anthonychow"],
  ];
  const kills = [["react", "LEGACY JQUERY SPAGHETTI"], ["ts", "UNDEFINED IS NOT A FUNCTION"], ["docker", "WORKS ON MY MACHINE"], ["postgres", "N+1 QUERIES"]];
  const display = await fontFace(DISPLAY, 400, title);
  const h6 = await fontFace(HUD, 600, uniq(report.map((r) => r[1])));
  const h7 = await fontFace(HUD, 700, uniq([...report.map((r) => r[0]), "YONGKY", ...kills.map((k) => k[1])]));

  const left = report
    .map(([k, v], i) => `<g class="in" style="animation-delay:${(0.2 + i * 0.15).toFixed(2)}s"><text class="h7" x="48" y="${132 + i * 56}" font-size="13" letter-spacing="3" fill="${C.red}">${k}</text><text class="h6" x="48" y="${156 + i * 56}" font-size="20" fill="${C.cream}">${esc(v)}</text></g>`)
    .join("");

  const kx = 624, kw = 528, kh = 44, kgap = 14, ky = 48;
  let feed = "";
  for (let i = 0; i < kills.length; i++) {
    const [id, enemy] = kills[i];
    const y = ky + i * (kh + kgap);
    feed += `<g class="kill" style="animation-delay:${(0.6 + i * 0.55).toFixed(2)}s">
  <path d="${cham(kx, y, kw, kh, 10)}" fill="${C.panel}" stroke="${C.line}"/>
  <rect x="${kx}" y="${y + 10}" width="4" height="${kh - 10}" fill="${C.teal}"/>
  <text class="h7" x="${kx + 20}" y="${y + 29}" font-size="18" letter-spacing="1" fill="${C.teal}">YONGKY</text>
  <image href="${await icon(id)}" x="${kx + 104}" y="${y + 9}" width="26" height="26"/>
  ${headshot(kx + 156, y + 22)}
  <text class="h7" x="${kx + 180}" y="${y + 29}" font-size="18" letter-spacing="1" fill="${C.red}">${esc(enemy)}</text>
</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Combat report. Current mission: building full-stack web apps at Hantam Kreasi Utama. Training: Three.js and Roblox game dev. Kill feed: Yongky eliminated legacy jQuery spaghetti, undefined is not a function, works on my machine, and N+1 queries.">
<title>Combat report</title>
<style>${display}${h6}${h7}${fontCss}
.in{opacity:0;animation:in .6s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes in{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:none}}
.kill{opacity:0;animation:kill 10s infinite}
@keyframes kill{0%{opacity:0;transform:translateX(40px)}4%{opacity:1;transform:none}78%{opacity:1;transform:none}86%,100%{opacity:0;transform:none}}
${reducedMotion(".in,.kill{opacity:1}")}
</style>
${frame(W, H)}
${sectionHead(title, "", 40)}
${left}
<line x1="592" x2="592" y1="48" y2="${H - 48}" stroke="${C.line}"/>
${feed}
</svg>`;
}

// ---------- divider ----------
async function divider() {
  const W = 1200, H = 28, cx = W / 2, cy = H / 2;
  // Current map pool from valorant-api.com, scrolling like a map-rotation ticker.
  const maps = (await (await fetch("https://valorant-api.com/v1/maps")).json()).data
    .filter((m) => m.tacticalDescription)
    .map((m) => m.displayName.toUpperCase());
  const strip = maps.join("  ·  ") + "  ·  ";
  const h6 = await fontFace(HUD, 600, uniq([strip]));
  const SPAN = 1400;
  const text = (x) => `<text class="h6" x="${x}" y="${cy + 4}" font-size="11" letter-spacing="4" textLength="${SPAN}" lengthAdjust="spacing" fill="${C.muted}">${esc(strip)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Map rotation: ${maps.join(", ")}">
<style>${h6}${fontCss}
.dm{transform-origin:${cx}px ${cy}px;animation:dm 2.4s ease-in-out infinite}@keyframes dm{50%{transform:scale(.6)}}
.ticker{animation:ticker 60s linear infinite}@keyframes ticker{to{transform:translateX(-${SPAN}px)}}
${reducedMotion()}</style>
<defs>
  <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".12" stop-color="#fff"/><stop offset=".88" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="m"><rect x="20" y="0" width="${cx - 90}" height="${H}" fill="url(#fadeL)"/><rect x="${cx + 70}" y="0" width="${cx - 90}" height="${H}" fill="url(#fadeL)"/></mask>
</defs>
<g mask="url(#m)"><g class="ticker">${text(0)}${text(SPAN)}</g></g>
<path d="M${cx - 60} ${cy}H${cx - 26}M${cx + 26} ${cy}H${cx + 60}" stroke="${C.red}" stroke-width="2"/>
<g transform="rotate(45 ${cx} ${cy})"><rect class="dm" x="${cx - 7}" y="${cy - 7}" width="14" height="14" fill="${C.red}"/></g>
</svg>`;
}

// ---------- footer: victory screen ----------
async function footer() {
  const W = 1200, H = 250;
  const big = "VICTORY", gg = "GG";
  const small = "THANKS FOR STOPPING BY  ·  SEE YOU NEXT MATCH";
  const display = await fontFace(DISPLAY, 400, big + gg);
  const h7 = await fontFace(HUD, 700, uniq([small, "13 — 0", "FLAWLESS"]));
  const cx = W / 2;
  const spray = await asset("spray-gg.png"); // GG Shooter Spray
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Victory. Thanks for stopping by, see you next match.">
<title>Victory</title>
<style>${display}${h7}${fontCss}
.v{opacity:0;transform-origin:${cx}px 120px;animation:v .8s .2s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes v{from{opacity:0;transform:scale(1.35)}to{opacity:1;transform:none}}
.ln{transform-origin:${cx}px 0;transform:scaleX(0);animation:ln .9s .5s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes ln{to{transform:scaleX(1)}}
.fade{opacity:0;animation:fade .6s 1s forwards}
@keyframes fade{to{opacity:1}}
.spray{opacity:0;transform-origin:1045px 125px;animation:spray .35s 1.4s cubic-bezier(.3,1.6,.5,1) forwards}
@keyframes spray{from{opacity:0;transform:scale(1.6) rotate(-14deg)}to{opacity:.92;transform:rotate(-8deg)}}
${reducedMotion(".v,.fade{opacity:1}.ln{transform:none}.spray{opacity:.92;transform:rotate(-8deg)}")}
</style>
<defs>
  <clipPath id="card"><path d="${cham(0, 0, W, H, 28)}"/></clipPath>
  <linearGradient id="shine" x1="0" x2="${W}" y1="0" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${C.cream}"/><stop offset=".46" stop-color="${C.cream}"/><stop offset=".5" stop-color="#ffffff"/><stop offset=".54" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.cream}"/>
    <animateTransform attributeName="gradientTransform" type="translate" values="-1200 0;1200 0" dur="4s" begin="1.2s" repeatCount="indefinite"/>
  </linearGradient>
</defs>
<g clip-path="url(#card)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <text class="d" x="${cx}" y="300" text-anchor="middle" font-size="380" fill="none" stroke="${C.line}" stroke-width="2" opacity=".55">${gg}</text>
  <polygon points="${cx - 330},64 ${cx + 360},64 ${cx + 330},164 ${cx - 360},164" fill="${C.red}" opacity=".1"/>
  <text class="h7 fade" x="${cx}" y="48" text-anchor="middle" font-size="20" letter-spacing="4"><tspan fill="${C.teal}">13</tspan><tspan fill="${C.muted}"> — </tspan><tspan fill="${C.red}">0</tspan><tspan fill="${C.muted}" font-size="14" dx="14">FLAWLESS</tspan></text>
  <g class="ln"><rect x="${cx - 420}" y="146" width="250" height="3" fill="${C.red}"/><rect x="${cx + 170}" y="146" width="250" height="3" fill="${C.red}"/></g>
  <text class="d v" x="${cx}" y="150" text-anchor="middle" font-size="104" letter-spacing="6" fill="url(#shine)">${big}</text>
  <text class="h7 fade" x="${cx}" y="200" text-anchor="middle" font-size="18" letter-spacing="4" fill="${C.muted}">${esc(small)}</text>
  <image class="spray" href="${spray}" x="922" y="2" width="246" height="246"/>
</g>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 28)}" fill="none" stroke="${C.line}" stroke-width="1.5"/>
</svg>`;
}

// ---------- comms buttons (LinkedIn, Discord) ----------
async function commsButton(name, n, slug) {
  const W = 240, H = 60;
  const label = `COMMS // 0${n}`;
  const logo = await (await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/${slug}.svg`)).text();
  const path = logo.match(/<path d="([^"]+)"/)[1];
  const display = await fontFace(DISPLAY, 400, name);
  const h6 = await fontFace(HUD, 600, label);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${name}">
<title>${name}</title>
<style>${display}${h6}${fontCss}
.go{animation:go 1.6s ease-in-out infinite}
@keyframes go{50%{transform:translateX(4px)}}
${reducedMotion()}
</style>
<defs>
  <clipPath id="c"><path d="${cham(0, 0, W, H, 12)}"/></clipPath>
  <linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<g clip-path="url(#c)">
  <rect width="${W}" height="${H}" fill="${C.panel}"/>
  <rect width="60" height="${H}" fill="${C.red}"/>
  <path d="${path}" fill="${C.cream}" transform="translate(17 17) scale(1.083)"/>
  <rect x="60" y="${H - 3}" width="${W - 60}" height="3" fill="${C.red}" opacity=".5"/>
  <rect x="-80" y="0" width="80" height="${H}" fill="url(#s)" transform="skewX(-20)"><animate attributeName="x" values="-80;${W + 80}" dur="3.5s" repeatCount="indefinite"/></rect>
</g>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 12)}" fill="none" stroke="${C.line}" stroke-width="1.5"/>
<text class="h6" x="76" y="24" font-size="11" letter-spacing="3" fill="${C.muted}">${label}</text>
<text class="d" x="76" y="47" font-size="23" letter-spacing="2" fill="${C.cream}">${name}</text>
<g class="go"><path d="M${W - 34} 22l8 8-8 8M${W - 26} 22l8 8-8 8" fill="none" stroke="${C.red}" stroke-width="2.5"/></g>
</svg>`;
}

// ---------- third-party cards (same URLs as the README), snapshotted for the preview ----------
export const EXTERNAL = {
  spotify: `https://spotify-recently-played-readme.vercel.app/api?user=yongky_anthony&count=3`,
};

// Preview only: until the Spotify secrets exist, read the current tracks from the old
// spotify-recently-played-readme card so the new card can be shown with real data.
function parseSpotifyReadme(svg) {
  const dec = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const arts = [...svg.matchAll(/<image[^>]*href="(data:image\/[^"]+)"/g)].map((m) => m[1]);
  const titles = [...svg.matchAll(/<text[^>]*x="60"[^>]*font-size="14"[^>]*>([^<]*)<\/text>/g)].map((m) => dec(m[1]));
  const artists = [...svg.matchAll(/<text[^>]*x="60"[^>]*font-size="13"[^>]*>([^<]*)<\/text>/g)].map((m) => dec(m[1]));
  const ago = [...svg.matchAll(/>(\d+)([mhd]) ago<\/text>/g)].map((m) => Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]]);
  return titles.slice(0, 3).map((title, i) => ({ title, artist: artists[i] || "", art: arts[i] || null, playedAt: ago[i] ? new Date(ago[i]).toISOString() : null }));
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// ---------- main ----------
await mkdir(OUT, { recursive: true });
const built = {
  hero: await hero(),
  abilities: await abilities(),
  arsenal: await arsenal(),
  killfeed: await killfeed(),
  divider: await divider(),
  footer: await footer(),
  linkedin: await commsButton("LINKEDIN", 1, "linkedin"),
  discord: await commsButton("DISCORD", 2, "discord"),
};
for (const [name, svg] of Object.entries(built)) {
  await writeFile(join(OUT, `${name}.svg`), svg);
  console.log(`${name}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
}

if (process.argv.includes("--preview")) {
  const tpl = await readFile(join(ROOT, "tools", "preview.template.html"), "utf8");
  const map = Object.fromEntries(Object.entries(built).map(([k, v]) => [k, dataUri(v)]));
  const last365 = await fetchTotal(USER);
  map.rank = dataUri(await renderRankCard(last365));
  // The workflow uses its GITHUB_TOKEN; locally the preview borrows the gh CLI login.
  const token = process.env.GITHUB_TOKEN || execSync("gh auth token").toString().trim();
  map.career = dataUri(await renderCareerCard(await fetchStats(USER, token), last365));
  map.range = dataUri(await renderRangeCard(await fetchGrid(USER)));
  // query_only read, so building the preview does not add a profile view.
  map.views = dataUri(await renderViewsCard(await fetchViews(`${USER}.${USER.toLowerCase()}`)));
  const avatar = Buffer.from(await (await fetch(`https://github.com/${USER}.png?size=200`)).arrayBuffer());
  const avatarType = avatar[0] === 0xff ? "image/jpeg" : "image/png";
  map.avatar = `data:${avatarType};base64,${avatar.toString("base64")}`;
  for (const [k, url] of Object.entries(EXTERNAL)) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const body = await res.text();
    if (!res.ok) console.warn(`! ${k}: HTTP ${res.status}`);
    map[k] = k === "spotify" ? dataUri(await renderSpotifyCard({ nowPlaying: false, tracks: parseSpotifyReadme(body) })) : dataUri(body);
  }
  map.readme = (await readFile(join(PROFILE, "README.md"), "utf8"))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in map)) throw new Error(`missing {{${k}}}`);
    return map[k];
  });
  await mkdir(join(ROOT, "preview"), { recursive: true });
  await writeFile(join(ROOT, "preview", "index.html"), html);
  console.log(`preview/index.html  ${(html.length / 1024).toFixed(1)} KB`);
}
