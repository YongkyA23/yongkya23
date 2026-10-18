// "The Range": the contribution graph as a Valorant practice range. Every day with contributions
// is a target, sized by GitHub's level. A crosshair clears them in rounds of five, with a kill
// banner for each kill and an ACE on the fifth, then the targets respawn.
// Replaces the contribution snake. Run: node .github/scripts/range-card.mjs <user> <out.svg>
// The kill banner is VALORANT's current default, the cross knives (Base_Kill_Banner_Alternate.png
// from the VALORANT Fandom wiki; Riot replaced the old skull with it),
// used under Riot's fan content policy; the README carries the required notice.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { C, cham, fontFace, uniq } from "./rank-card.mjs";

const TEAL = "#36e6b5";
const GOLD = "#f2c14e";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Timing in seconds. A round is five kills; the ACE gets a short pause so it can be read.
const PER_KILL = 0.3, ACE_PAUSE = 0.6, LEAD = 0.5, TAIL = 2.4, HOLD = 0.12;

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

// On/off windows for a calcMode="discrete" animation, as fractions of the loop.
function discrete(windows, L) {
  const vals = [0], keys = [0];
  for (const [a, b] of windows) { vals.push(1, 0); keys.push(f(a / L), f(b / L)); }
  return { values: vals.join(";"), keyTimes: keys.join(";") };
}

// A quick jump to `big` at each time, easing back to `rest` (a scale pop, or a rotation sweep).
function pops(times, L, big, settle, rest = 1) {
  const vals = [rest], keys = [0];
  for (const t of times) { vals.push(rest, big, rest); keys.push(f((t - 0.01) / L), f(t / L), f((t + settle) / L)); }
  vals.push(rest); keys.push(1);
  return { values: vals.join(";"), keyTimes: keys.join(";") };
}

const KILL_BANNER = join(dirname(fileURLToPath(import.meta.url)), "..", "valorant", "kill-banner.png");
// In the 312x400 source image the ring is centred at (156, 215) and the kill bar sits ~133px above it.
const KB_CX = 156, KB_CY = 215, KB_BAR_R = 133, KB_SCALE = 0.34;

function arc(r, from, to) {
  const p = (a) => `${f(Math.cos((a * Math.PI) / 180) * r)} ${f(Math.sin((a * Math.PI) / 180) * r)}`;
  return `M${p(from)}A${r} ${r} 0 0 1 ${p(to)}`;
}

const BANNER_X = -86;

// Bar angles per kill count, as in the default banner: one bar on top for the first kill, a left and
// right pair for the second, then k bars spread evenly from the top (120°, 90°, 72°, 60°).
const barAngles = (k) => (k === 2 ? [180, 0] : Array.from({ length: k }, (_, i) => -90 + (i * 360) / k));

// Kill banner, centred on (0,0). The source image's own top bar is clipped off (see #kbclip) and
// every bar is drawn here, so kill 2 can drop the top bar the way the game does.
// `sweep` holds animateTransforms that swing the bars in from further out when the kill lands.
function banner(k, sweep = "") {
  const ace = k === 5;
  const col = ace ? GOLD : k === 4 ? C.red : C.cream;
  const bar = ace ? GOLD : TEAL;
  const s = KB_SCALE, R = KB_BAR_R * s;
  const bars = barAngles(k)
    .map((a) => `<path d="${arc(R, a - 16, a + 16)}" fill="none" stroke="${bar}" stroke-width="${f(13 * s)}" stroke-linecap="round"/>`)
    .join("");
  const emblem = `<g transform="translate(${BANNER_X} 0)"><use href="#kb" transform="translate(${f(-KB_CX * s)} ${f(-KB_CY * s)}) scale(${s})"${ace ? ' filter="url(#gold)"' : ""}/><g>${sweep}${bars}</g></g>`;
  const pips = Array.from({ length: 5 }, (_, i) => `<path d="M${-26 + i * 17} 14h12l-3 5h-12z" fill="${i < k ? col : C.line}"/>`).join("");
  const wings = ace ? `<path d="M-180 0h40M66 0h40" stroke="${GOLD}" stroke-width="2"/><path d="M-190 -6l10 6-10 6M116 -6l-10 6 10 6" fill="${GOLD}"/>` : "";
  return `${wings}${emblem}<text class="d" x="-26" y="6" font-size="${ace ? 32 : 26}" letter-spacing="${ace ? 6 : 2}" fill="${col}">${ace ? "ACE" : `KILL ${k}`}</text>${pips}`;
}

export async function renderRangeCard({ cells, total }) {
  const W = 1200, H = 428;
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
  const arrive = targets.map((_, i) => LEAD + i * PER_KILL + Math.floor(i / 5) * ACE_PAUSE);
  const hitAt = arrive.map((a) => a + 0.05);
  const lastEnd = N ? hitAt[N - 1] + PER_KILL + ACE_PAUSE : LEAD;
  const L = f(lastEnd + TAIL);

  const radius = [0, 4.2, 5.6, 6.8, 7.8];
  const empty = cells
    .filter((c) => c.level === 0)
    .map((c) => `<rect x="${cx(c) - size / 2}" y="${cy(c) - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.panel}"/>`)
    .join("");

  const targetEls = targets
    .map((c, i) => {
      const r = radius[c.level];
      const head = c.level === 4;
      const hit = f(hitAt[i] / L);
      const respawn = f((lastEnd + 0.3 + 1.6 * (c.col / cols)) / L);
      const ring = i % 5 === 4 ? GOLD : head ? C.red : C.cream;
      const x = cx(c), y = cy(c);
      return `<g><animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;${hit};${f(hit + 0.002)};${respawn};1" dur="${L}s" repeatCount="indefinite"/>
<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.panel}"/>
<circle cx="${x}" cy="${y}" r="${r}" fill="${C.bg}" stroke="${C.red}" stroke-width="${head ? 2 : 1.5}"/>
<circle cx="${x}" cy="${y}" r="${f(r * 0.38)}" fill="${head ? C.red : C.cream}"/></g>
<circle cx="${x}" cy="${y}" r="0" fill="none" stroke="${ring}" stroke-width="2" opacity="0"><animate attributeName="r" values="0;0;14;14" keyTimes="0;${hit};${f(hit + 0.15 / L)};1" dur="${L}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${hit};${f(hit + 0.01 / L)};${f(hit + 0.2 / L)};1" dur="${L}s" repeatCount="indefinite"/></circle>`;
    })
    .join("\n");

  // Crosshair: lands on each target, holds for the shot, moves on, and returns to the start.
  const vals = [], keys = [];
  if (N) {
    const p0 = `${cx(targets[0])} ${cy(targets[0])}`;
    vals.push(p0); keys.push(0);
    targets.forEach((c, i) => {
      const p = `${cx(c)} ${cy(c)}`;
      vals.push(p, p); keys.push(f(arrive[i] / L), f((arrive[i] + HOLD) / L));
    });
    vals.push(p0); keys.push(1);
  }
  const kick = pops(hitAt, L, 1.45, 0.1);

  // Banner k shows from its kill until the next kill; the ACE banner also covers the pause.
  const windowsFor = (k) =>
    targets.map((_, i) => i).filter((i) => i % 5 === k - 1)
      .map((i) => [hitAt[i], i + 1 < N ? hitAt[i + 1] : hitAt[i] + PER_KILL + ACE_PAUSE]);
  const bx = W / 2, by = y0 + 7 * step + 54;
  const banners = [1, 2, 3, 4, 5]
    .map((k) => {
      const w = windowsFor(k);
      if (!w.length) return "";
      const vis = discrete(w, L);
      const starts = w.map((x) => x[0]);
      const pop = pops(starts, L, k === 5 ? 1.35 : 1.2, 0.09);
      const rot = pops(starts, L, -40, 0.22, 0);
      const grow = pops(starts, L, 1.35, 0.2);
      const sweep = `<animateTransform attributeName="transform" type="rotate" values="${rot.values}" keyTimes="${rot.keyTimes}" dur="${L}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="scale" additive="sum" values="${grow.values}" keyTimes="${grow.keyTimes}" dur="${L}s" repeatCount="indefinite"/>`;
      return `<g transform="translate(${bx} ${by})"><g opacity="0"><animate attributeName="opacity" values="${vis.values}" keyTimes="${vis.keyTimes}" dur="${L}s" repeatCount="indefinite" calcMode="discrete"/><animateTransform attributeName="transform" type="scale" values="${pop.values}" keyTimes="${pop.keyTimes}" dur="${L}s" repeatCount="indefinite"/>${banner(k, sweep)}</g></g>`;
    })
    .join("\n");
  // Teal burst around the emblem on every kill, like the particle pop in game.
  const ringR = 97 * KB_SCALE;
  const burstR = [ringR], burstO = [0], burstK = [0];
  for (const t of hitAt) {
    burstR.push(ringR, ringR, ringR + 22, ringR); burstO.push(0, 0.9, 0, 0);
    burstK.push(f((t - 0.005) / L), f(t / L), f((t + 0.25) / L), f((t + 0.26) / L));
  }
  burstR.push(ringR); burstO.push(0); burstK.push(1);
  const burst = N ? `<circle cx="${bx + BANNER_X}" cy="${by}" r="${ringR}" fill="none" stroke="${TEAL}" stroke-width="3" stroke-dasharray="3 6" opacity="0"><animate attributeName="r" values="${burstR.join(";")}" keyTimes="${burstK.join(";")}" dur="${L}s" repeatCount="indefinite"/><animate attributeName="opacity" values="${burstO.join(";")}" keyTimes="${burstK.join(";")}" dur="${L}s" repeatCount="indefinite"/></circle>` : "";
  const aceTimes = windowsFor(5).map(([a]) => a);
  const aceBig = discrete(aceTimes.map((a) => [a, a + 0.55]), L);
  const acePop = pops(aceTimes, L, 1.5, 0.14);
  const flash = discrete(aceTimes.map((a) => [a, a + 0.18]), L);

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

  const stats = [["HITS", total.toLocaleString("en-US")], ["TARGETS", String(N)], ["ACES", String(Math.floor(N / 5))]];
  const barY = H - 46, barW = cols * step - gap;

  const display = await fontFace("Anton", 400, uniq(["THE RANGE", "KILL 12345", "ACE", ...stats.map((s) => s[1])]));
  const h6 = await fontFace("Rajdhani", 600, uniq(["CONTRIBUTIONS // LAST 52 WEEKS", "TARGETS CLEARED", ...MONTHS, ...stats.map((s) => s[0])]));

  let sx = W - x0;
  const statEls = stats
    .slice()
    .reverse()
    .map(([k, v]) => {
      const el = `<text class="d" x="${sx}" y="80" text-anchor="end" font-size="30" fill="${k === "ACES" ? GOLD : C.cream}">${v}</text><text class="h6" x="${sx}" y="100" text-anchor="end" font-size="12" letter-spacing="3" fill="${C.muted}">${k}</text>`;
      sx -= 130;
      return el;
    })
    .join("");

  const frame = cham(0.75, 0.75, W - 1.5, H - 1.5, 28);
  const kb = `data:image/png;base64,${(await readFile(KILL_BANNER)).toString("base64")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Range: ${N} days with contributions in the last year shown as targets. A crosshair clears them in rounds of five, with a kill banner for each kill and an ACE every fifth. ${total} contributions in total.">
<title>The Range</title>
<style>${display}${h6}
.d{font-family:'Anton',Impact,'Arial Narrow',sans-serif}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
@media (prefers-reduced-motion: reduce){.xh,.fx{display:none}}
</style>
<defs>
  <clipPath id="kbclip"><rect x="0" y="100" width="312" height="300"/></clipPath>
  <image id="kb" href="${kb}" width="312" height="400" clip-path="url(#kbclip)"/>
  <filter id="gold" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.36 0.36 0.36 0 0  0.29 0.29 0.29 0 0  0.12 0.12 0.12 0 0  0 0 0 1 0"/></filter>
</defs>
<path d="${frame}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>
<path class="fx" d="${frame}" fill="none" stroke="${GOLD}" stroke-width="3" opacity="0"><animate attributeName="opacity" values="${flash.values}" keyTimes="${flash.keyTimes}" dur="${L}s" repeatCount="indefinite" calcMode="discrete"/></path>
<rect x="${x0}" y="52" width="10" height="34" fill="${C.red}"/>
<text class="d" x="${x0 + 22}" y="84" font-size="40" letter-spacing="1" fill="${C.cream}">THE RANGE</text>
<text class="h6" x="${x0 + 22}" y="106" font-size="14" letter-spacing="4" fill="${C.muted}">CONTRIBUTIONS // LAST 52 WEEKS</text>
${statEls}
${monthEls}
${empty}
${targetEls}
<g class="xh">
  ${N ? `<animateTransform attributeName="transform" type="translate" values="${vals.join(";")}" keyTimes="${keys.join(";")}" dur="${L}s" repeatCount="indefinite" calcMode="linear"/>` : ""}
  <g><animateTransform attributeName="transform" type="scale" values="${kick.values}" keyTimes="${kick.keyTimes}" dur="${L}s" repeatCount="indefinite"/>
    <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="#000" stroke-opacity=".6" stroke-width="4"/>
    <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="${TEAL}" stroke-width="2"/>
  </g>
  <circle r="1.8" fill="${TEAL}"/>
</g>
<g class="fx" transform="translate(${W / 2} ${y0 + 3.5 * step + 30})"><g opacity="0">
  <animate attributeName="opacity" values="${aceBig.values}" keyTimes="${aceBig.keyTimes}" dur="${L}s" repeatCount="indefinite" calcMode="discrete"/>
  <animateTransform attributeName="transform" type="scale" values="${acePop.values}" keyTimes="${acePop.keyTimes}" dur="${L}s" repeatCount="indefinite"/>
  <text class="d" x="0" y="0" text-anchor="middle" font-size="96" letter-spacing="14" fill="${GOLD}" stroke="${C.bg}" stroke-width="6" paint-order="stroke">ACE</text>
</g></g>
<g class="fx">${banners}${burst}</g>
<text class="h6" x="${x0}" y="${barY + 22}" font-size="11" letter-spacing="3" fill="${C.muted}">TARGETS CLEARED</text>
<rect x="${x0 + 130}" y="${barY + 15}" width="${barW - 130}" height="4" fill="${C.line}"/>
<rect x="${x0 + 130}" y="${barY + 15}" width="0" height="4" fill="${C.red}"><animate attributeName="width" values="0;0;${barW - 130};${barW - 130};0" keyTimes="0;${f(LEAD / L)};${f(lastEnd / L)};${f((lastEnd + 1.8) / L)};1" dur="${L}s" repeatCount="indefinite"/></rect>
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
