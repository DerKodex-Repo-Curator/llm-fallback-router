/**
 * Observability surface:
 *   - `renderScoreboard()` → the shareable terminal scoreboard.
 *   - `createDashboardServer()` → a zero-dependency live web dashboard + JSON API.
 *
 * Both read straight off a `Router`, so what you see is exactly what the engine
 * is routing on. Import from "llm-fallback-router/dashboard".
 */

import http from "node:http";
import type { Router } from "./router.js";
import type { Scoreboard, ScoreboardRow, ProviderStatus } from "./types.js";

// ---------- terminal scoreboard ----------

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function statusColor(s: ProviderStatus): string {
  return s === "healthy" ? ANSI.green : s === "degraded" ? ANSI.yellow : ANSI.red;
}

function dot(s: ProviderStatus): string {
  return s === "healthy" ? "●" : s === "degraded" ? "◐" : "○";
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function padStart(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function scoreBar(score: number): string {
  const filled = Math.round((score / 100) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export interface RenderOptions {
  color?: boolean;
  /** Provider the router last selected (highlighted). Defaults to scoreboard.decision. */
  decision?: string;
}

export function renderScoreboard(board: Scoreboard, opts: RenderOptions = {}): string {
  const color = opts.color ?? Boolean(process.stdout?.isTTY);
  const c = (code: string, s: string) => (color ? code + s + ANSI.reset : s);

  const header = c(
    ANSI.bold,
    " " + pad("PROVIDER", 14) + pad("MODEL", 22) + pad("STATUS", 12) + padStart("LATENCY", 9) + padStart("ERRORS", 9) + padStart("SCORE", 7) + "  HEALTH",
  );
  const sep = c(ANSI.gray, " " + "─".repeat(86));
  const lines: string[] = [header, sep];

  for (const r of board.rows) {
    const sc = statusColor(r.status);
    const statusCell = c(sc, dot(r.status) + " " + r.status);
    const row =
      " " +
      pad(r.provider, 14) +
      c(ANSI.dim, pad(truncate(r.model, 20), 22)) +
      pad(statusCell, 12 + (color ? sc.length + ANSI.reset.length : 0)) +
      padStart(r.latencyMs + "ms", 9) +
      padStart((r.errorRate * 100).toFixed(1) + "%", 9) +
      c(ANSI.bold, padStart(String(r.score), 7)) +
      "  " +
      c(sc, scoreBar(r.score));
    lines.push(row);
  }

  if (board.decision) {
    lines.push("");
    lines.push(c(ANSI.cyan, ` → router selected: ${ANSI.bold}${board.decision}${ANSI.reset}${ANSI.cyan}`) + ANSI.reset);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------- live web dashboard ----------

export interface DashboardOptions {
  port?: number;
  host?: string;
  /** Page title. */
  title?: string;
}

export function createDashboardServer(router: Router, opts: DashboardOptions = {}): http.Server {
  const port = opts.port ?? 7575;
  const host = opts.host ?? "127.0.0.1";
  const title = opts.title ?? "LLM Fallback Router";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const json = (data: unknown) => {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(data));
    };
    switch (url.pathname) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE.replace("__TITLE__", title));
        return;
      case "/api/scoreboard":
        return json(router.scoreboard());
      case "/api/health":
        return json(router.health());
      case "/api/metrics":
        return json(router.metrics());
      case "/api/decisions":
        return json(router.decisions().slice(-25).reverse());
      default:
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
    }
  });

  server.listen(port, host);
  return server;
}

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
 :root{--bg:#0b0e14;--panel:#121622;--line:#1f2737;--txt:#e6edf3;--mut:#8b98ad;--grn:#3fb950;--yel:#d29922;--red:#f85149;--cyan:#58a6ff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
 header{padding:20px 28px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px}
 header h1{font-size:16px;margin:0;font-weight:600;letter-spacing:.3px}
 header .live{margin-left:auto;color:var(--mut);font-size:12px;display:flex;align-items:center;gap:7px}
 .pulse{width:8px;height:8px;border-radius:50%;background:var(--grn);box-shadow:0 0 8px var(--grn);animation:p 1.6s infinite}
 @keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
 main{padding:24px 28px;max-width:1100px;margin:0 auto}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
 .card .k{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.6px}
 .card .v{font-size:26px;font-weight:600;margin-top:6px}
 table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
 th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--line)}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:600}
 tr:last-child td{border-bottom:none}
 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:middle}
 .healthy{color:var(--grn)}.healthy .dot{background:var(--grn);box-shadow:0 0 7px var(--grn)}
 .degraded{color:var(--yel)}.degraded .dot{background:var(--yel)}
 .down{color:var(--red)}.down .dot{background:var(--red)}
 .bar{height:7px;border-radius:4px;background:var(--line);overflow:hidden;width:90px}
 .bar > i{display:block;height:100%;border-radius:4px}
 .chosen{background:rgba(88,166,255,.08)}
 .chosen td:first-child::after{content:" ◄ selected";color:var(--cyan);font-size:11px}
 .num{font-variant-numeric:tabular-nums}
 h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin:28px 0 10px}
 .feed{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 0;max-height:300px;overflow:auto}
 .ev{padding:8px 16px;border-bottom:1px solid var(--line);font-size:13px}
 .ev:last-child{border-bottom:none}
 .ev .meta{color:var(--mut);font-size:11px}
 .pill{display:inline-block;padding:1px 7px;border-radius:5px;font-size:11px;margin-left:6px}
 .ok{background:rgba(63,185,80,.15);color:var(--grn)}
 .fail{background:rgba(248,81,73,.15);color:var(--red)}
 .skip{background:rgba(139,152,173,.15);color:var(--mut)}
</style></head>
<body>
<header>
 <h1>⚡ __TITLE__</h1>
 <div class="live"><span class="pulse"></span> live · refreshes every 2s</div>
</header>
<main>
 <div class="cards" id="cards"></div>
 <table><thead><tr><th>Provider</th><th>Model</th><th>Status</th><th>Latency</th><th>Error rate</th><th>Score</th><th>Requests</th><th>Cost</th></tr></thead>
 <tbody id="rows"></tbody></table>
 <h2>Recent routing decisions</h2>
 <div class="feed" id="feed"></div>
</main>
<script>
const barColor=s=>s>=80?'var(--grn)':s>=50?'var(--yel)':'var(--red)';
const usd=n=>'$'+(n||0).toFixed(n<1?5:2);
async function tick(){
 try{
  const [board,metrics,decisions]=await Promise.all([
   fetch('/api/scoreboard').then(r=>r.json()),
   fetch('/api/metrics').then(r=>r.json()),
   fetch('/api/decisions').then(r=>r.json())]);
  const t=metrics.totals;
  const succ=t.requests?((t.successes/t.requests)*100).toFixed(1):'100.0';
  document.getElementById('cards').innerHTML=[
   ['Providers',t.providers],['Requests',t.requests],['Success rate',succ+'%'],
   ['Failovers',t.failovers],['Total cost',usd(t.totalCostUsd)]
  ].map(([k,v])=>'<div class="card"><div class="k">'+k+'</div><div class="v num">'+v+'</div></div>').join('');
  document.getElementById('rows').innerHTML=board.rows.map(r=>{
   const cls=r.status;
   const sel=r.provider===board.decision?' class="chosen"':'';
   return '<tr'+sel+'><td>'+r.provider+'</td><td style="color:var(--mut)">'+r.model+'</td>'
    +'<td class="'+cls+'"><span class="dot"></span>'+r.status+'</td>'
    +'<td class="num">'+r.latencyMs+'ms</td>'
    +'<td class="num">'+(r.errorRate*100).toFixed(1)+'%</td>'
    +'<td><div class="bar"><i style="width:'+r.score+'%;background:'+barColor(r.score)+'"></i></div></td>'
    +'<td class="num">'+r.requests+'</td><td class="num">'+usd(r.costUsd)+'</td></tr>';
  }).join('');
  document.getElementById('feed').innerHTML=decisions.map(d=>{
   const last=d.attempts[d.attempts.length-1]||{};
   const chips=d.attempts.map(a=>'<span class="pill '+(a.outcome==='success'?'ok':a.outcome==='failed'?'fail':'skip')+'">'+a.provider+'</span>').join('');
   return '<div class="ev"><b>'+(d.chosen||'— failed —')+'</b>'+chips
    +'<div class="meta">'+new Date(d.timestamp).toLocaleTimeString()+' · '+d.strategy
    +' · '+d.totalLatencyMs+'ms · '+usd(d.costUsd)+'</div></div>';
  }).join('')||'<div class="ev meta">no requests yet</div>';
 }catch(e){}
}
tick();setInterval(tick,2000);
</script>
</body></html>`;
