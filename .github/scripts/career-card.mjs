// Draws the Valorant-style "career" card: contributions, streaks, combat stats and languages.
// Replaces the github-readme-stats and streak-stats cards. Public repositories only.
// Run by the profile workflow: GITHUB_TOKEN=... node .github/scripts/career-card.mjs <user> <out.svg>
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { C, cham, fetchTotal, fontFace, rankFor, rankIcon, uniq } from "./rank-card.mjs";

const SOFT = "#b9c2c9", TEAL = "#36e6b5", ROW = "#1a2733";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "career-card" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export async function fetchStats(user, token) {
  const base = await gql(token, `query($login:String!, $prs:String!, $issues:String!) {
    user(login:$login) {
      createdAt
      repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100) {
        nodes { stargazerCount languages(first:10, orderBy:{field:SIZE, direction:DESC}) { edges { size node { name color } } } }
      }
      repositoriesContributedTo(first:1, privacy:PUBLIC, contributionTypes:[COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) { totalCount }
      contributionsCollection { totalCommitContributions }
    }
    prs: search(query:$prs, type:ISSUE, first:0) { issueCount }
    issues: search(query:$issues, type:ISSUE, first:0) { issueCount }
  }`, { login: user, prs: `author:${user} type:pr is:public`, issues: `author:${user} type:issue is:public` });
  const u = base.user;

  // The calendar API returns at most a year per call, so ask for every year since the account was made.
  const firstYear = new Date(u.createdAt).getUTCFullYear();
  const thisYear = new Date().getUTCFullYear();
  const parts = [];
  for (let y = firstYear; y <= thisYear; y++)
    parts.push(`y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${y}-12-31T23:59:59Z") { contributionCalendar { weeks { contributionDays { date contributionCount } } } }`);
  const cal = await gql(token, `query($login:String!) { user(login:$login) { ${parts.join("\n")} } }`, { login: user });
  const today = new Date().toISOString().slice(0, 10);
  const days = Object.values(cal.user)
    .flatMap((c) => c.contributionCalendar.weeks.flatMap((w) => w.contributionDays))
    .filter((d) => d.date >= u.createdAt.slice(0, 10) && d.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const langs = {};
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const e of r.languages.edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color || C.muted };
      langs[e.node.name].size += e.size;
    }
  }
  const langTotal = Object.values(langs).reduce((a, l) => a + l.size, 0) || 1;
  const languages = Object.entries(langs)
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / langTotal) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);

  return {
    createdAt: u.createdAt,
    days,
    stars,
    languages,
    commits: u.contributionsCollection.totalCommitContributions,
    prs: base.prs.issueCount,
    issues: base.issues.issueCount,
    contributedTo: u.repositoriesContributedTo.totalCount,
  };
}

export function streaks(days) {
  let longest = { len: 0, start: null, end: null };
  let run = { len: 0, start: null };
  for (const d of days) {
    if (d.contributionCount > 0) {
      run = run.len ? { len: run.len + 1, start: run.start } : { len: 1, start: d.date };
      if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date };
    } else run = { len: 0, start: null };
  }
  // Today not having a contribution yet doesn't break the streak.
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let cur = { len: 0, start: null, end: i >= 0 ? days[i].date : null };
  while (i >= 0 && days[i].contributionCount > 0) { cur.len++; cur.start = days[i].date; i--; }
  return { current: cur, longest };
}

const fmt = (iso, year = false) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ""}`;
};
const range = (s, e, year) => (!s ? "NO ACTIVE STREAK" : s === e ? fmt(s, year) : `${fmt(s)} – ${fmt(e, year)}`);
const badgeFor = (n) => (n === 0 ? "NO STREAK" : n === 1 ? "FIRST BLOOD" : n < 5 ? `${n}K` : "ACE");

export async function renderCareerCard(stats, last365) {
  const W = 1200, H = 552;
  const total = stats.days.reduce((a, d) => a + d.contributionCount, 0);
  const { current, longest } = streaks(stats.days);
  const r = rankFor(last365);
  const rankName = r.tier.name === "RADIANT" ? "RADIANT" : `${r.tier.name} ${r.division}`;
  const rankSub = r.tier.name === "RADIANT" ? "LAST 365 DAYS" : `${r.rr} RR  ·  LAST 365 DAYS`;
  const since = `${fmt(stats.createdAt.slice(0, 10), true)} – PRESENT`;
  const badge = badgeFor(current.len);

  const kpis = [
    { label: "TOTAL CONTRIBUTIONS", value: total.toLocaleString("en-US"), unit: "", sub: since },
    { label: "CURRENT STREAK", value: String(current.len), unit: current.len === 1 ? "DAY" : "DAYS", sub: range(current.start, current.end, false), hot: true },
    { label: "LONGEST STREAK", value: String(longest.len), unit: longest.len === 1 ? "DAY" : "DAYS", sub: range(longest.start, longest.end, true) },
  ];
  const rows = [
    ["COMMITS", "LAST YEAR", stats.commits],
    ["PULL REQUESTS", "", stats.prs],
    ["ISSUES", "", stats.issues],
    ["STARS EARNED", "", stats.stars],
    ["CONTRIBUTED TO", "LAST YEAR", stats.contributedTo],
  ];
  const langs = stats.languages;

  const display = await fontFace("Anton", 400, uniq(["CAREER", rankName, ...kpis.map((k) => k.value), ...rows.map((r) => String(r[2]))]));
  const h6 = await fontFace("Rajdhani", 600, uniq(["MATCH SUMMARY // PUBLIC REPOS", rankSub, ...kpis.map((k) => k.label + k.sub), ...rows.map((r) => r[0] + r[1])]));
  const h7 = await fontFace("Rajdhani", 700, uniq(["COMBAT STATS", "LOADOUT // LANGUAGES", badge, "DAYS", ...langs.map((l) => l.name.toUpperCase())]));
  const mono = await fontFace("JetBrains Mono", 500, "0123456789.%");

  // KPI row
  const kw = 357, kh = 150, ky = 136;
  let kpiEls = "";
  kpis.forEach((k, i) => {
    const x = 48 + i * (kw + 16);
    kpiEls += `<g class="rise" style="animation-delay:${(0.15 + i * 0.1).toFixed(2)}s">
  <path d="${cham(x, ky, kw, kh, 14)}" fill="${C.panel}" stroke="${k.hot ? C.red : C.line}" stroke-opacity="${k.hot ? 0.8 : 1}"/>
  <rect x="${x + 14}" y="${ky}" width="48" height="3" fill="${C.red}"/>
  <text class="h6" x="${x + 24}" y="${ky + 36}" font-size="13" letter-spacing="3" fill="${C.muted}">${k.label}</text>
  <text class="d" x="${x + 24}" y="${ky + 104}" font-size="60" fill="${k.hot ? C.red : C.cream}">${esc(k.value)}${k.unit ? `<tspan class="h7" font-size="18" dx="8" letter-spacing="2" fill="${C.muted}">${k.unit}</tspan>` : ""}</text>
  <text class="h6" x="${x + 24}" y="${ky + 132}" font-size="14" letter-spacing="1.5" fill="${SOFT}">${esc(k.sub)}</text>
</g>`;
  });
  // Badge on the current streak panel, sparkline of the last 20 weeks on the total panel.
  const bx = 48 + kw + 16, bw = badge.length * 9 + 28;
  kpiEls += `<g class="badge"><path d="${cham(bx + kw - 24 - bw, ky + 20, bw, 26, 7)}" fill="${current.len ? C.red : C.line}"/><text class="h7" x="${bx + kw - 24 - bw / 2}" y="${ky + 38}" text-anchor="middle" font-size="14" letter-spacing="2" fill="${C.cream}">${badge}</text></g>`;
  const weeks = [];
  for (let i = stats.days.length - 1; i >= 0 && weeks.length < 140; i--) weeks.push(stats.days[i].contributionCount);
  const weekly = [];
  for (let i = 0; i < 20; i++) weekly.unshift(weeks.slice(i * 7, i * 7 + 7).reduce((a, b) => a + b, 0));
  const maxW = Math.max(1, ...weekly);
  const sx = 48 + 210, sy = ky + 112;
  const spark = weekly
    .map((v, i) => {
      const h = Math.max(2, (v / maxW) * 56);
      return `<rect class="bar" x="${sx + i * 6.5}" y="${(sy - h).toFixed(1)}" width="4" height="${h.toFixed(1)}" fill="${i === weekly.length - 1 ? C.red : TEAL}" fill-opacity="${i === weekly.length - 1 ? 1 : 0.55}" style="animation-delay:${(0.5 + i * 0.03).toFixed(2)}s;transform-origin:0 ${sy}px"/>`;
    })
    .join("");

  // Combat stats
  const py = 302, ph = 226;
  const lw = 540;
  let rowEls = "";
  rows.forEach(([label, note, value], i) => {
    const y = py + 52 + i * 32;
    rowEls += `<g class="fade" style="animation-delay:${(0.5 + i * 0.08).toFixed(2)}s">
  ${i % 2 === 0 ? `<path d="${cham(72, y, lw - 48, 28, 6)}" fill="${ROW}"/>` : ""}
  <text class="h6" x="86" y="${y + 19}" font-size="16" letter-spacing="1" fill="${SOFT}">${label}${note ? `<tspan font-size="12" dx="8" letter-spacing="2" fill="${C.muted}">${note}</tspan>` : ""}</text>
  <text class="d" x="${48 + lw - 38}" y="${y + 22}" text-anchor="end" font-size="22" fill="${C.cream}">${value}</text>
</g>`;
  });

  // Languages
  const lx = 604, lwR = 548, barX = lx + 24, barW = lwR - 48;
  let acc = 0;
  const segs = langs
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const el = `<rect x="${(barX + acc).toFixed(1)}" y="${py + 54}" width="${Math.max(0, w - 2).toFixed(1)}" height="10" fill="${l.color}"/>`;
      acc += w;
      return el;
    })
    .join("");
  const colW = (barW - 24) / 2;
  const langEls = langs
    .map((l, i) => {
      const x = barX + (i % 2) * (colW + 24);
      const y = py + 100 + Math.floor(i / 2) * 30;
      return `<g class="fade" style="animation-delay:${(0.7 + i * 0.06).toFixed(2)}s"><rect x="${x}" y="${y - 10}" width="9" height="9" transform="rotate(45 ${x + 4.5} ${y - 5.5})" fill="${l.color}"/><text class="h7" x="${x + 20}" y="${y}" font-size="16" letter-spacing=".5" fill="${C.cream}">${esc(l.name.toUpperCase())}</text><text class="m" x="${x + colW}" y="${y}" text-anchor="end" font-size="13" fill="${C.muted}">${l.pct.toFixed(1)}%</text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Career: ${total} total contributions since ${fmt(stats.createdAt.slice(0, 10), true)}, current streak ${current.len} days, longest streak ${longest.len} days. ${stats.commits} commits last year, ${stats.prs} pull requests, ${stats.issues} issues, ${stats.stars} stars. Top languages: ${langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")}.">
<title>Career</title>
<style>${display}${h6}${h7}${mono}
.d{font-family:'Anton',Impact,'Arial Narrow',sans-serif}
.h6{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:600}
.h7{font-family:'Rajdhani','Arial Narrow',sans-serif;font-weight:700}
.m{font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;font-weight:500}
.rise{opacity:0;animation:rise .6s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.fade{opacity:0;animation:fade .5s forwards}
@keyframes fade{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
.bar{transform:scaleY(0);animation:bar .5s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes bar{to{transform:scaleY(1)}}
.badge{opacity:0;animation:fade .3s .6s forwards,pulse 2.4s 1s ease-in-out infinite}
@keyframes pulse{50%{opacity:.55}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.rise,.fade,.badge{opacity:1}.bar{transform:none}}
</style>
<defs>
  <clipPath id="langBar"><rect x="${barX}" y="${py + 50}" width="0" height="18"><animate attributeName="width" from="0" to="${barW}" dur="1.1s" begin=".6s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1"/></rect></clipPath>
</defs>
<path d="${cham(0.75, 0.75, W - 1.5, H - 1.5, 28)}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>
<rect x="48" y="52" width="10" height="34" fill="${C.red}"/>
<text class="d" x="70" y="86" font-size="46" letter-spacing="1" fill="${C.cream}">CAREER</text>
<text class="h6" x="70" y="112" font-size="15" letter-spacing="4" fill="${C.muted}">MATCH SUMMARY // PUBLIC REPOS</text>
<image href="${await rankIcon(r.t, r.division)}" x="1088" y="38" width="64" height="64"><title>${rankName}</title></image>
<text class="d" x="1078" y="78" text-anchor="end" font-size="28" letter-spacing="1" fill="${r.tier.color}">${rankName}</text>
<text class="h6" x="1078" y="100" text-anchor="end" font-size="13" letter-spacing="2" fill="${C.muted}">${rankSub}</text>
${kpiEls}
<g class="rise" style="animation-delay:.2s">${spark}</g>
<g class="rise" style="animation-delay:.4s">
  <path d="${cham(48, py, lw, ph, 14)}" fill="${C.panel}" stroke="${C.line}"/>
  <text class="h7" x="72" y="${py + 34}" font-size="13" letter-spacing="3" fill="${C.red}">COMBAT STATS</text>
</g>
${rowEls}
<g class="rise" style="animation-delay:.5s">
  <path d="${cham(lx, py, lwR, ph, 14)}" fill="${C.panel}" stroke="${C.line}"/>
  <text class="h7" x="${barX}" y="${py + 34}" font-size="13" letter-spacing="3" fill="${C.red}">LOADOUT // LANGUAGES</text>
  <rect x="${barX}" y="${py + 54}" width="${barW}" height="10" fill="${C.line}"/>
  <g clip-path="url(#langBar)">${segs}</g>
</g>
${langEls}
</svg>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [user, out] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const [stats, last365] = await Promise.all([fetchStats(user, token), fetchTotal(user)]);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await renderCareerCard(stats, last365));
  const s = streaks(stats.days);
  console.log(`career: ${stats.days.length} days, streak ${s.current.len} (longest ${s.longest.len}), ${stats.languages.length} languages`);
}
