// scripts/build-site.ts —— 生成静态部署站点（GitHub Pages 目标：docs/index.html）
// 零外部依赖：用 Node 跑一次权威对局，把逐帧快照内联进一个自包含的 index.html
// （内联 CSS + 内联 JS + 内联 JSON 数据，不引外部脚本/样式/库）。
//
// 页面内容中立：展示"一个 TS 写的 2D 射击对战骨架 + 一次对局的回放与统计"，
// 不涉及任何外部 IP / 玩法扩展。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { World, GROUND_Y, WALL_L, WALL_R, PLAYER_R, MAG_SIZE, FIRE_DAMAGE } from '../src/core/sim/world.ts'
import { ServerSim } from '../src/net/ServerSim.ts'
import { ClientSession } from '../src/net/ClientSession.ts'
import { createLoopback } from '../src/net/transport/Loopback.ts'
import { InputMapper } from '../src/input/InputMapper.ts'
import type { TouchState } from '../src/input/InputMapper.ts'

const DT = 1 / 60
const TICKS = 300

// ── 跑一次与 main.ts 相同的脚本化对局（服务器权威），逐帧抓快照 ──
const world = new World()
const a = world.addPlayer(200, GROUND_Y)
const b = world.addPlayer(760, GROUND_Y)
const server = new ServerSim(world)
const lbA = createLoopback()
const lbB = createLoopback()
server.accept(a.id, lbA.server)
server.accept(b.id, lbB.server)
const csA = new ClientSession(lbA.client, a.id)
const csB = new ClientSession(lbB.client, b.id)
const mapper = new InputMapper()

const touchA: TouchState = { moveX: 0.6, aimAngle: -0.12, fire: true, jump: false, jetpack: false, reload: false }
const touchB: TouchState = { moveX: -0.6, aimAngle: Math.PI + 0.12, fire: true, jump: false, jetpack: false, reload: false }

interface FramePlayer { id: number; x: number; y: number; aim: number; hp: number; ammo: number; alive: boolean; kills: number; deaths: number }
interface FrameProj { x: number; y: number; owner: number; r: number }
interface Frame { tick: number; players: FramePlayer[]; projectiles: FrameProj[] }

const frames: Frame[] = []
for (let i = 0; i < TICKS; i++) {
  csA.sendIntents(mapper.map(touchA))
  csB.sendIntents(mapper.map(touchB))
  server.step(DT)
  const snap = world.snapshot()
  frames.push({
    tick: snap.tick,
    players: snap.players.map(p => ({ id: p.id, x: p.pos.x, y: p.pos.y, aim: p.aim, hp: p.hp, ammo: p.ammo, alive: p.alive, kills: p.kills, deaths: p.deaths })),
    projectiles: snap.projectiles.map(pr => ({ x: pr.pos.x, y: pr.pos.y, owner: pr.owner, r: pr.r })),
  })
}

const finalPlayers = frames[frames.length - 1].players
const totalHits = world.hits

// ── 组装自包含 index.html ──
const meta = {
  title: 'TS 2D Side-View Shooter Skeleton — Match Replay',
  subtitle: '一个用 TypeScript 写的 2D 射击对战骨架：三层分离（input / net / ui）+ 确定性服务器权威模拟。',
  dt: DT,
  ticks: TICKS,
  world: { groundY: GROUND_Y, wallL: WALL_L, wallR: WALL_R, playerR: PLAYER_R },
  sim: { magSize: MAG_SIZE, fireDamage: FIRE_DAMAGE },
  final: finalPlayers,
  hits: totalHits,
  generatedAt: new Date().toISOString(),
}

const dataJson = JSON.stringify({ meta, frames })

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${meta.title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0f1115; color: #d7dae0; line-height: 1.5;
  }
  .wrap { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #f0f3f8; }
  .sub { font-size: 13px; color: #9aa2b0; margin: 0 0 18px; }
  .panel { background: #161a22; border: 1px solid #262c38; border-radius: 10px; padding: 16px; }
  canvas { display: block; width: 100%; background: #0b0d12; border: 1px solid #262c38; border-radius: 8px; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
  button { background: #2a3342; color: #e6eaf0; border: 1px solid #3b4657; border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; font-size: 13px; }
  button:hover { background: #354157; }
  input[type="range"] { flex: 1; min-width: 180px; accent-color: #6ea8fe; }
  label, select { font-size: 13px; color: #aab3c2; }
  select { background: #1c222d; color: #e6eaf0; border: 1px solid #3b4657; border-radius: 6px; padding: 4px 8px; }
  .readout { font-size: 13px; color: #8f98a6; }
  .stats { margin-top: 18px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #222834; }
  th { color: #8f98a6; font-weight: 600; }
  .p1 { color: #6ea8fe; } .p2 { color: #f0a868; }
  .foot { margin-top: 16px; font-size: 12px; color: #6b7380; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${meta.title}</h1>
  <p class="sub">${meta.subtitle}</p>
  <div class="panel">
    <canvas id="cv" width="960" height="560"></canvas>
    <div class="controls">
      <button id="playBtn">▶ Play</button>
      <input type="range" id="slider" min="0" max="${frames.length - 1}" value="0" />
      <label>speed <select id="speed">
        <option value="1">1×</option>
        <option value="0.5">0.5×</option>
        <option value="2">2×</option>
      </select></label>
      <span class="readout" id="readout"></span>
    </div>
    <div class="stats">
      <table>
        <thead><tr><th>Player</th><th>HP</th><th>Ammo</th><th>Kills</th><th>Deaths</th></tr></thead>
        <tbody id="statsBody"></tbody>
      </table>
      <p class="readout" id="simMeta"></p>
    </div>
  </div>
  <p class="foot">Rendered from a deterministic server-authoritative simulation (${meta.ticks} ticks @ ${meta.dt}s). Generated ${meta.generatedAt}.</p>
</div>

<script>
const DATA = ${dataJson};
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const playBtn = document.getElementById('playBtn');
const slider = document.getElementById('slider');
const speedSel = document.getElementById('speed');
const readout = document.getElementById('readout');
const statsBody = document.getElementById('statsBody');
const simMeta = document.getElementById('simMeta');

const W = DATA.meta.world;
const COLORS = { 1: '#6ea8fe', 2: '#f0a868' };
let idx = 0, playing = false, last = 0, acc = 0;

function resize() {
  const cw = cv.clientWidth;
  const ch = Math.round(cw * (560 / 960));
  cv.width = cw * (window.devicePixelRatio || 1);
  cv.height = ch * (window.devicePixelRatio || 1);
  ctx.setTransform(cv.width / 960, 0, 0, cv.height / 560, 0, 0);
}
window.addEventListener('resize', resize); resize();

function drawFrame(f) {
  ctx.clearRect(0, 0, 960, 560);
  // ground + walls
  ctx.strokeStyle = '#2b3240'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W.wallL, W.groundY); ctx.lineTo(W.wallR, W.groundY); ctx.stroke();
  ctx.strokeStyle = '#1f2530';
  ctx.beginPath(); ctx.moveTo(W.wallL, 0); ctx.lineTo(W.wallL, W.groundY); ctx.moveTo(W.wallR, 0); ctx.lineTo(W.wallR, W.groundY); ctx.stroke();
  // projectiles
  for (const pr of f.projectiles) {
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[pr.owner] || '#8f98a6'; ctx.fill();
  }
  // players
  for (const p of f.players) {
    const c = COLORS[p.id] || '#fff';
    // aim line
    ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.aim) * 42, p.y + Math.sin(p.aim) * 42); ctx.stroke();
    ctx.globalAlpha = 1;
    // body
    ctx.beginPath(); ctx.arc(p.x, p.y, W.playerR, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0b0d12'; ctx.stroke();
    // HP bar
    const bw = 44, bx = p.x - bw / 2, by = p.y - W.playerR - 14;
    ctx.fillStyle = '#1f2530'; ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = p.hp > 50 ? '#5ad37a' : p.hp > 25 ? '#e0b74d' : '#e05a5a';
    ctx.fillRect(bx, by, bw * Math.max(0, p.hp) / 100, 5);
    // label
    ctx.fillStyle = c; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('P' + p.id + '  ' + p.kills + '/' + p.deaths, p.x, by - 6);
  }
}

function renderStats(f) {
  statsBody.innerHTML = f.players.map(p =>
    '<tr><td class="p' + p.id + '">Player ' + p.id + '</td><td>' + Math.round(p.hp) + '</td><td>' + p.ammo + '/' + DATA.meta.sim.magSize + '</td><td>' + p.kills + '</td><td>' + p.deaths + '</td></tr>'
  ).join('');
  simMeta.textContent = 'frame ' + (f.tick) + ' / ' + DATA.meta.ticks + ' · total hits ' + DATA.meta.hits + ' · mag ' + DATA.meta.sim.magSize + ' · dmg ' + DATA.meta.sim.fireDamage;
}

function render() {
  const f = DATA.frames[idx];
  drawFrame(f); renderStats(f);
  readout.textContent = 'tick ' + f.tick + ' / ' + DATA.meta.ticks;
  slider.value = idx;
}

function step(dt) {
  idx += 1;
  if (idx >= DATA.frames.length) { idx = 0; }
  render();
}

function tick(now) {
  if (playing) {
    const s = parseFloat(speedSel.value);
    acc += (now - last) / 1000 * s;
    while (acc >= DATA.meta.dt) { acc -= DATA.meta.dt; step(); }
  }
  last = now;
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? '⏸ Pause' : '▶ Play'; });
slider.addEventListener('input', () => { idx = parseInt(slider.value, 10); render(); });
render();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
</script>
</body>
</html>
`

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'docs')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'index.html')
writeFileSync(outFile, html, 'utf8')
console.log(`Wrote ${outFile} (${Buffer.byteLength(html)} bytes, ${frames.length} frames)`)
