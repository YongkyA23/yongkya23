// "The Range": the contribution graph as a Valorant Shooting Test. Every day with contributions is a
// target with an agent's head. Targets pop up one at a time, a Vandal shoots them (tracer, recoil, damage numbers,
// 25-round magazine with reloads) and each kill leaves a hit mark, until the board is cleared.
// Run: node .github/scripts/range-card.mjs <user> <out.svg>
// The Range map art, the Vandal and the agent headshots are official VALORANT assets (valorant-api.com), used under
// Riot's fan content policy; the README carries the required notice.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { C, cham, fontFace, uniq } from "./rank-card.mjs";

const TEAL = "#36e6b5";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "valorant");

// Timing in seconds. The Vandal holds 25 rounds; every empty magazine costs a reload.
const PER_SHOT = 0.28, RELOAD = 1.4, MAG = 25, LEAD = 0.6, TAIL = 2.6, HOLD = 0.1, SPAWN = 0.45;
// Vandal damage by GitHub level: legs, body, body, head.
const DAMAGE = [0, 34, 40, 40, 160];
const PAD_TINT = [0, 0.16, 0.26, 0.38, 0.52];

export async function fetchGrid(user) {
  const html = await (await fetch(`https://github.com/users/${user}/contributions`, { headers: { "User-Agent": "range-card" } })).text();
  const cells = [...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})" id="contribution-day-component-(\d+)-(\d+)" data-level="(\d)"/g)].map((m) => ({
    date: m[1], row: +m[2], col: +m[3], level: +m[4],
  }));
  if (!cells.length) throw new Error("Could not read the contribution graph");
  const total = Number(html.match(/id="js-contribution-activity-description"[^>]*>\s*([\d,]+)/)?.[1].replace(/,/g, "") ?? 0);
  return { cells, total };
}

const f = (n) => +n.toFixed(4);

// SMIL values/keyTimes from [seconds, value] events, resting at `rest` at both ends of the loop.
function track(L, rest, events) {
  const vals = [rest], keys = [0];
  let last = 0;
  for (const [t, v] of events) {
    const k = Math.max(f(t / L), f(last + 0.0001));
    if (k >= 1) break;
    vals.push(v); keys.push(k); last = k;
  }
  vals.push(rest); keys.push(1);
  return `values="${vals.join(";")}" keyTimes="${keys.join(";")}"`;
}

// On/off windows for a calcMode="discrete" animation.
function windows(L, wins) {
  const vals = [0], keys = [0];
  for (const [a, b] of wins) { vals.push(1, 0); keys.push(f(a / L), f(b / L)); }
  return `values="${vals.join(";")}" keyTimes="${keys.join(";")}"`;
}

// Agent headshots (official icons, 24px, in ../valorant/agents) defined once and reused per target.
// Order is a fixed shuffle so neighbouring targets show different agents.
async function agentDefs() {
  const dir = join(ASSETS, "agents");
  const files = (await readdir(dir)).filter((n) => n.endsWith(".png")).sort();
  let seed = 23;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }
  const defs = [];
  for (const [i, n] of files.entries()) {
    const png = (await readFile(join(dir, n))).toString("base64");
    defs.push(`<image id="ag${i}" href="data:image/png;base64,${png}" x="-8" y="-16" width="16" height="16" clip-path="url(#headclip)"/>`);
  }
  return { count: files.length, defs: defs.join("") };
}

// An agent head filling its 16px cell, standing on (0,0) like the training bots did.
// Headshot days (level 4) get a red frame.
const head = (k, level) =>
  `<rect x="-8" y="-16" width="16" height="16" rx="2" fill="${C.bg}"/><use href="#ag${k}"/>${level === 4 ? `<rect x="-7.4" y="-15.4" width="14.8" height="14.8" rx="2" fill="none" stroke="${C.red}" stroke-width="1.2"/>` : ""}`;

export async function renderRangeCard({ cells, total }) {
  const W = 1200, H = 430;
  const size = 16, gap = 5, step = size + gap;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const x0 = Math.round((W - (cols * step - gap)) / 2), y0 = 136;
  const cx = (c) => x0 + c.col * step + size / 2;
  const cy = (c) => y0 + c.row * step + size / 2;

  // Serpentine order down one column and up the next, like sweeping the range.
  const targets = cells
    .filter((c) => c.level > 0)
    .sort((a, b) => a.col - b.col || (a.col % 2 ? b.row - a.row : a.row - b.row));
  const N = targets.length;
  const arrive = targets.map((_, i) => LEAD + i * PER_SHOT + Math.floor(i / MAG) * RELOAD);
  const hitAt = arrive.map((a) => a + 0.05);
  const lastEnd = N ? hitAt[N - 1] + 0.5 : LEAD;
  const L = f(lastEnd + TAIL);
  const clearAt = (c) => lastEnd + 0.4 + 1.6 * (c.col / cols);

  // Empty days are plain pads; active days are tinted by level so the pattern reads before any shot.
  const pads = cells
    .map((c) => `<rect x="${cx(c) - size / 2}" y="${cy(c) - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.panel}" fill-opacity=".85"/>${c.level ? `<rect x="${cx(c) - size / 2}" y="${cy(c) - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.red}" fill-opacity="${PAD_TINT[c.level]}"/>` : ""}`)
    .join("");

  // Each target is an agent head in its own cell: it rises from the bottom of the cell, gets shot,
  // tips over and drops out, leaving a hit mark on the pad.
  const agents = await agentDefs();
  const botEls = targets
    .map((c, i) => {
      const t = hitAt[i], spawn = Math.max(0.05, t - SPAWN);
      const x = cx(c), base = cy(c) + size / 2;
      const dmg = DAMAGE[c.level], hs = c.level === 4;
      return `<g transform="translate(${x} ${base})">
  <g opacity="0"><animate attributeName="opacity" ${track(L, 0, [[spawn, 0], [spawn + 0.01, 1], [t + 0.16, 1], [t + 0.26, 0]])} dur="${L}s" repeatCount="indefinite"/>
    <g><animateTransform attributeName="transform" type="rotate" ${track(L, 0, [[t, 0], [t + 0.15, hs ? -85 : 80]])} dur="${L}s" repeatCount="indefinite"/>
      <g><animateTransform attributeName="transform" type="scale" ${track(L, "1 0", [[spawn, "1 0"], [spawn + 0.12, "1 1"]])} dur="${L}s" repeatCount="indefinite"/>${head(i % agents.count, c.level)}</g>
    </g>
  </g>
  <path d="M-3.5 -11.5l7 7M3.5 -11.5l-7 7" stroke="${hs ? C.red : C.cream}" stroke-width="1.8" opacity="0"><animate attributeName="opacity" ${track(L, 0, [[t + 0.14, 0], [t + 0.15, hs ? 1 : 0.75], [clearAt(c), hs ? 1 : 0.75], [clearAt(c) + 0.2, 0]])} dur="${L}s" repeatCount="indefinite"/></path>
  <text class="d" x="0" y="-19" text-anchor="middle" font-size="${hs ? 15 : 12}" fill="${hs ? C.red : C.cream}" stroke="${C.bg}" stroke-width="3" paint-order="stroke" opacity="0">${dmg}<animate attributeName="opacity" ${track(L, 0, [[t, 0], [t + 0.01, 1], [t + 0.55, 0]])} dur="${L}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" ${track(L, "0 0", [[t, "0 0"], [t + 0.6, "0 -16"]])} dur="${L}s" repeatCount="indefinite"/></text>
</g>`;
    })
    .join("\n");

  // Crosshair lands on each bot, holds for the shot, moves on, and returns to the start.
  const xhEvents = [];
  targets.forEach((c, i) => { xhEvents.push([arrive[i], `${cx(c)} ${cy(c)}`], [arrive[i] + HOLD, `${cx(c)} ${cy(c)}`]); });
  const xhStart = N ? `${cx(targets[0])} ${cy(targets[0])}` : "0 0";
  const hitmark = (on) => hitAt.flatMap((t) => [[t, 0], [t + 0.01, on], [t + 0.12, 0]]);

  // Vandal in the bottom right (the icon already points left, at the board), with recoil, muzzle flash and a tracer.
  const vandal = `data:image/png;base64,${(await readFile(join(ASSETS, "vandal.png"))).toString("base64")}`;
  const bg = `data:image/jpeg;base64,${(await readFile(join(ASSETS, "range-bg.jpg"))).toString("base64")}`;
  const gw = 250, gh = gw * (128 / 420);
  const gx = W - 70 - gw, gy = H - 38 - gh;
  const muzzle = [gx + 6, gy + gh * 0.36];
  const recoil = hitAt.flatMap((t) => [[t - 0.005, "0 0"], [t, "7 -3"], [t + 0.12, "0 0"]]);
  const tracerX = targets.flatMap((c, i) => [[hitAt[i] - 0.005, cx(c)]]);
  const tracerY = targets.flatMap((c, i) => [[hitAt[i] - 0.005, cy(c)]]);

  // Ammo counter: one element per value, each shown while the magazine holds that many rounds.
  const segs = [];
  let now = 0, ammo = MAG;
  hitAt.forEach((t, i) => {
    segs.push([now, t, String(ammo)]);
    ammo--;
    now = t;
    if (ammo === 0 && i < N - 1) {
      segs.push([now, now + 0.25, "0"], [now + 0.25, arrive[i + 1] - 0.05, "RELOADING"]);
      now = arrive[i + 1] - 0.05;
      ammo = MAG;
    }
  });
  segs.push([now, L, String(ammo)]);
  const byLabel = new Map();
  for (const [a, b, label] of segs) if (b > a) (byLabel.get(label) ?? byLabel.set(label, []).get(label)).push([a, b]);
  const ammoX = gx - 26, ammoY = H - 48;
  const ammoEls = [...byLabel]
    .map(([label, wins]) => {
      const reload = label === "RELOADING";
      const text = reload
        ? `<text class="h7" x="${ammoX}" y="${ammoY - 6}" text-anchor="end" font-size="16" letter-spacing="3" fill="${TEAL}">RELOADING</text>`
        : `<text class="d" x="${ammoX}" y="${ammoY}" text-anchor="end" font-size="40" fill="${label === "0" ? C.red : Number(label) <= 5 ? C.red : C.cream}">${label}</text>`;
      return `<g opacity="0"><animate attributeName="opacity" ${windows(L, wins)} dur="${L}s" repeatCount="indefinite" calcMode="discrete"/>${text}</g>`;
    })
    .join("");

  const months = [];
  let lastMonth = -1;
  for (const c of cells.filter((c) => c.row === 0).sort((a, b) => a.col - b.col)) {
    const m = Number(c.date.slice(5, 7)) - 1;
    if (m !== lastMonth && c.col < cols - 2) { months.push({ col: c.col, label: MONTHS[m] }); lastMonth = m; }
  }
  const monthEls = months
    .filter((m, i) => i === 0 || m.col - months[i - 1].col >= 3)
    .map((m) => `<text class="h6" x="${x0 + m.col * step}" y="${y0 - 10}" font-size="11" letter-spacing="2" fill="${C.muted}">${m.label}</text>`)
    .join("");

  const heads = targets.filter((c) => c.level === 4).length;
  const stats = [["HITS", total.toLocaleString("en-US")], ["BOTS", String(N)], ["HEADSHOTS", String(heads)]];
  const barY = H - 56, barW = gx - 140 - x0;

  const display = await fontFace("Anton", 400, uniq(["THE RANGE", "0123456789", ...stats.map((s) => s[1])]));
  const h6 = await fontFace("Rajdhani", 600, uniq(["SHOOTING TEST // HARD  ·  LAST 52 WEEKS", "TARGETS CLEARED", "VANDAL", ...MONTHS, ...stats.map((s) => s[0])]));
  const h7 = await fontFace("Rajdhani", 700, "RELOADING/∞");

  let sx = W - x0;
  const statEls = stats
    .slice()
    .reverse()
    .map(([k, v]) => {
      const el = `<text class="d" x="${sx}" y="80" text-anchor="end" font-size="30" fill="${k === "HEADSHOTS" ? C.red : C.cream}">${v}</text><text class="h6" x="${sx}" y="100" text-anchor="end" font-size="12" letter-spacing="3" fill="${C.muted}">${k}</text>`;
      sx -= 130;
      return el;
    })
    .join("");

  const frame = cham(0.75, 0.75, W - 1.5, H - 1.5, 28);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Range, a Shooting Test: ${N} days with contributions in the last year appear as agent head targets that a Vandal shoots down one by one, with damage numbers and reloads. ${total} contributions in total.">
<title>The Range</title>
<style>${display}${h6}${h7}
.d{font-family:'Anton',Impact,'Arial Narrow',sans-serif}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
.h7{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:700}
@media (prefers-reduced-motion: reduce){.fx{display:none}}
</style>
<defs>
  <clipPath id="card"><path d="${frame}"/></clipPath>
  <clipPath id="headclip"><rect x="-8" y="-16" width="16" height="16" rx="2"/></clipPath>
  ${agents.defs}
  <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="${C.bg}" stop-opacity=".93"/><stop offset=".7" stop-color="${C.bg}" stop-opacity=".86"/><stop offset="1" stop-color="${C.bg}" stop-opacity=".7"/></linearGradient>
</defs>
<g clip-path="url(#card)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <image href="${bg}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity=".9"/>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
</g>
<path d="${frame}" fill="none" stroke="${C.line}" stroke-width="1.5"/>
<rect x="${x0}" y="52" width="10" height="34" fill="${C.red}"/>
<text class="d" x="${x0 + 22}" y="84" font-size="40" letter-spacing="1" fill="${C.cream}">THE RANGE</text>
<text class="h6" x="${x0 + 22}" y="106" font-size="14" letter-spacing="4" fill="${C.muted}">SHOOTING TEST // HARD  ·  LAST 52 WEEKS</text>
${statEls}
${monthEls}
${pads}
<g class="fx">
${botEls}
<line x1="${muzzle[0]}" y1="${muzzle[1]}" x2="${muzzle[0]}" y2="${muzzle[1]}" stroke="#ffe7a8" stroke-width="1.6" stroke-linecap="round" opacity="0">
  <animate attributeName="x2" ${track(L, muzzle[0], tracerX)} dur="${L}s" repeatCount="indefinite" calcMode="discrete"/>
  <animate attributeName="y2" ${track(L, muzzle[1], tracerY)} dur="${L}s" repeatCount="indefinite" calcMode="discrete"/>
  <animate attributeName="opacity" ${track(L, 0, hitAt.flatMap((t) => [[t - 0.004, 0], [t, 0.85], [t + 0.06, 0]]))} dur="${L}s" repeatCount="indefinite"/>
</line>
<g>
  <animateTransform attributeName="transform" type="translate" ${track(L, "0 0", recoil)} dur="${L}s" repeatCount="indefinite"/>
  <image href="${vandal}" x="${gx}" y="${f(gy)}" width="${gw}" height="${f(gh)}"/>
  <path d="M${muzzle[0]} ${muzzle[1]}l-16 -5l6 5l-12 0l12 3l-8 7l18 -10z" fill="#ffd36b" opacity="0"><animate attributeName="opacity" ${track(L, 0, hitAt.flatMap((t) => [[t - 0.004, 0], [t, 1], [t + 0.05, 0]]))} dur="${L}s" repeatCount="indefinite"/></path>
</g>
<g>
  <animateTransform attributeName="transform" type="translate" ${track(L, xhStart, xhEvents)} dur="${L}s" repeatCount="indefinite"/>
  <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="#000" stroke-opacity=".6" stroke-width="4"/>
  <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="${TEAL}" stroke-width="2"/>
  <circle r="1.8" fill="${TEAL}"/>
  <path d="M-9 -9l4 4M9 -9l-4 4M-9 9l4 -4M9 9l-4 -4" stroke="#fff" stroke-width="2" opacity="0"><animate attributeName="opacity" ${track(L, 0, hitmark(1))} dur="${L}s" repeatCount="indefinite"/></path>
</g>
${ammoEls}
</g>
<text class="h7" x="${ammoX + 6}" y="${ammoY}" font-size="20" fill="${C.muted}">/ ∞</text>
<text class="h6" x="${gx + gw}" y="${H - 22}" text-anchor="end" font-size="11" letter-spacing="3" fill="${C.muted}">VANDAL</text>
<text class="h6" x="${x0}" y="${barY + 22}" font-size="11" letter-spacing="3" fill="${C.muted}">TARGETS CLEARED</text>
<rect x="${x0 + 130}" y="${barY + 15}" width="${barW}" height="4" fill="${C.line}"/>
<rect x="${x0 + 130}" y="${barY + 15}" width="0" height="4" fill="${C.red}"><animate attributeName="width" values="0;0;${barW};${barW};0" keyTimes="0;${f(LEAD / L)};${f(lastEnd / L)};${f((lastEnd + 2) / L)};1" dur="${L}s" repeatCount="indefinite"/></rect>
</svg>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [user, out] = process.argv.slice(2);
  const grid = await fetchGrid(user);
  await mkdir(dirname(out), { recursive: true });
  const svg = await renderRangeCard(grid);
  await writeFile(out, svg);
  console.log(`range: ${grid.cells.filter((c) => c.level > 0).length} targets, ${(svg.length / 1024).toFixed(0)} KB`);
}
