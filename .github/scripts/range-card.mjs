// "The Range": the contribution graph as a Valorant practice range. Every day with contributions
// is a target, sized by GitHub's level; a crosshair clears them one by one, then they respawn.
// Replaces the contribution snake. Run: node .github/scripts/range-card.mjs <user> <out.svg>
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { C, cham, fontFace, uniq } from "./rank-card.mjs";

const TEAL = "#36e6b5";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

export async function renderRangeCard({ cells, total }) {
  const W = 1200, H = 350;
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
  const L = Math.min(40, Math.max(12, N * 0.15)); // loop length in seconds
  const active = 0.88, start = 0.02, hold = 0.4;
  const stepT = active / Math.max(N, 1);
  const t = targets.map((_, i) => start + i * stepT);

  const radius = [0, 4.2, 5.6, 6.8, 7.8];
  const empty = cells
    .filter((c) => c.level === 0)
    .map((c) => `<rect x="${cx(c) - size / 2}" y="${cy(c) - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.panel}"/>`)
    .join("");

  const targetEls = targets
    .map((c, i) => {
      const r = radius[c.level];
      const head = c.level === 4;
      const hit = f(t[i] + stepT * hold * 0.5);
      const respawn = f(Math.max(hit + 0.01, 0.93 + 0.05 * (c.col / cols)));
      const x = cx(c), y = cy(c);
      return `<g><animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;${hit};${f(hit + 0.003)};${respawn};1" dur="${L}s" repeatCount="indefinite"/>
<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="2" fill="${C.panel}"/>
<circle cx="${x}" cy="${y}" r="${r}" fill="${C.bg}" stroke="${C.red}" stroke-width="${head ? 2 : 1.5}"/>
<circle cx="${x}" cy="${y}" r="${f(r * 0.38)}" fill="${head ? C.red : C.cream}"/></g>
<circle cx="${x}" cy="${y}" r="0" fill="none" stroke="${head ? C.red : C.cream}" stroke-width="2" opacity="0"><animate attributeName="r" values="0;0;13;13" keyTimes="0;${hit};${f(hit + 0.012)};1" dur="${L}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${hit};${f(hit + 0.001)};${f(hit + 0.016)};1" dur="${L}s" repeatCount="indefinite"/></circle>`;
    })
    .join("\n");

  // Crosshair: lands on each target, holds for the shot, moves on, and returns to the start.
  const vals = [], keys = [];
  if (N) {
    vals.push(`${cx(targets[0])} ${cy(targets[0])}`); keys.push(0);
    targets.forEach((c, i) => {
      const p = `${cx(c)} ${cy(c)}`;
      vals.push(p, p); keys.push(f(t[i]), f(t[i] + stepT * hold));
    });
    vals.push(`${cx(targets[0])} ${cy(targets[0])}`); keys.push(1);
  }
  const shotPeriod = f(stepT * L);

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
  const stats = [["HITS", total.toLocaleString("en-US")], ["TARGETS", String(N)], ["HEADSHOTS", String(heads)]];
  const barY = y0 + 7 * step + 14, barW = cols * step - gap;

  const display = await fontFace("Anton", 400, uniq(["THE RANGE", ...stats.map((s) => s[1])]));
  const h6 = await fontFace("Rajdhani", 600, uniq(["CONTRIBUTIONS // LAST 52 WEEKS", "TARGETS CLEARED", ...MONTHS, ...stats.map((s) => s[0])]));

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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Range: ${N} days with contributions in the last year shown as targets that a crosshair shoots down, ${total} contributions in total">
<title>The Range</title>
<style>${display}${h6}
.d{font-family:'Anton',Impact,'Arial Narrow',sans-serif}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
.kick{animation:kick ${shotPeriod}s ${f(start * L + stepT * L * hold * 0.5)}s infinite}
@keyframes kick{0%{transform:scale(1)}8%{transform:scale(1.45)}30%,100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.xh{display:none}}
</style>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 28)}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>
<rect x="${x0}" y="52" width="10" height="34" fill="${C.red}"/>
<text class="d" x="${x0 + 22}" y="84" font-size="40" letter-spacing="1" fill="${C.cream}">THE RANGE</text>
<text class="h6" x="${x0 + 22}" y="106" font-size="14" letter-spacing="4" fill="${C.muted}">CONTRIBUTIONS // LAST 52 WEEKS</text>
${statEls}
${monthEls}
${empty}
${targetEls}
<g class="xh">
  ${N ? `<animateTransform attributeName="transform" type="translate" values="${vals.join(";")}" keyTimes="${keys.join(";")}" dur="${L}s" repeatCount="indefinite" calcMode="linear"/>` : ""}
  <g class="kick">
    <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="#000" stroke-opacity=".6" stroke-width="4"/>
    <path d="M-15 0h8M7 0h8M0 -15v8M0 7v8" stroke="${TEAL}" stroke-width="2"/>
  </g>
  <circle r="1.8" fill="${TEAL}"/>
</g>
<text class="h6" x="${x0}" y="${barY + 22}" font-size="11" letter-spacing="3" fill="${C.muted}">TARGETS CLEARED</text>
<rect x="${x0 + 130}" y="${barY + 15}" width="${barW - 130}" height="4" fill="${C.line}"/>
<rect x="${x0 + 130}" y="${barY + 15}" width="0" height="4" fill="${C.red}"><animate attributeName="width" values="0;0;${barW - 130};${barW - 130};0" keyTimes="0;${start};${f(start + active)};0.95;1" dur="${L}s" repeatCount="indefinite"/></rect>
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
