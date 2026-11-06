// scripts/build-site.ts —— 生成对局回放页（GitHub Pages 目标：docs/replay.html）
// 零外部依赖：用 Node 跑一次权威对局，把逐帧快照内联进一个自包含的 index.html。
// 合并版：展示 SkyBlast 环形大世界对局回放（玩家/弹道/障碍物/占点，相机跟随 P1）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { World } from '../src/core/sim/world.ts'
import { ServerSim } from '../src/net/ServerSim.ts'
import { ClientSession } from '../src/net/ClientSession.ts'
import { createLoopback } from '../src/net/transport/Loopback.ts'
import { InputMapper } from '../src/input/InputMapper.ts'
import { WEAPONS } from '../src/core/weapons.ts'

const DT = 1 / 60
const TICKS = 300
const SEED = 20261106

// ── 跑一次脚本化对局（服务器权威） ──
const world = new World(SEED)
world.config.loadoutLock = false
const a = world.addPlayer('Alice', 'red')
const b = world.addPlayer('Bob', 'blue')
a.weaponIndex = 2  // 狙击（爆头穿透）
b.weaponIndex = 1  // 突击步枪
b.pos = { x: a.pos.x + 520, y: a.pos.y }

const server = new ServerSim(world)
const lbA = createLoopback()
const lbB = createLoopback()
server.accept(a.id, lbA.server)
server.accept(b.id, lbB.server)
const csA = new ClientSession(lbA.client, a.id)
const csB = new ClientSession(lbB.client, b.id)
const mapper = new InputMapper()

interface FramePlayer {
  id: number; x: number; y: number; aim: number; hp: number; alive: boolean;
  kills: number; deaths: number; weapon: string; shield: number; name: string
}
interface FrameProj { x: number; y: number; owner: number; r: number; color: string }
interface Frame {
  tick: number
  players: FramePlayer[]
  projectiles: FrameProj[]
  obstacles: { x: number; y: number; w: number; h: number; hp: number; maxHp: number; color: string; border: string }[]
  cps: { x: number; y: number; code: string; owner: string | null; progress: number }[]
}

const frames: Frame[] = []
for (let i = 0; i < TICKS; i++) {
  const t = i * DT
  const secA = (Math.abs(t - 1.4) < DT / 2) ? { kind: 'frag', targetX: b.pos.x, targetY: b.pos.y } : null
  csA.sendIntents(mapper.map({ moveX: 0, aimAngle: 0, fire: i % 20 < 14, jump: false, jetpack: false, reload: false, secondary: secA ?? undefined }))
  csB.sendIntents(mapper.map({ moveX: 0, aimAngle: Math.PI, fire: i % 24 < 10, jump: false, jetpack: false, reload: false }))
  server.step(DT)
  world.drainEvents()
  const snap = world.snapshot()
  frames.push({
    tick: snap.tick,
    players: snap.players.map(p => ({
      id: p.id, x: p.pos.x, y: p.pos.y, aim: p.aim, hp: p.hp, alive: p.alive,
      kills: p.kills, deaths: p.deaths, weapon: WEAPONS[p.weaponIndex].shortName,
      shield: p.shieldTimer > 0 ? p.shieldHp : 0, name: p.name,
    })),
    projectiles: snap.projectiles.map(pr => ({ x: pr.pos.x, y: pr.pos.y, owner: pr.owner, r: pr.r, color: pr.color })),
    obstacles: snap.obstacles.map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, hp: o.hp, maxHp: o.maxHp, color: o.color, border: o.borderColor })),
    cps: snap.capturePoints.map(c => ({ x: c.x, y: c.y, code: c.code, owner: c.ownerTeam, progress: Math.round(c.progress) })),
  })
}

// 静态地图图元（一次下发）
const staticRects = world.terrain.rects.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, c: r.color, b: r.borderColor }))
const staticShadows = world.terrain.shadows.map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h, a: s.alpha }))

const meta = {
  title: 'SkyBlast 2D — 环形大世界对局回放',
  subtitle: 'Teeworlds 风格 2D 横版 PVP：服务器权威 + 确定性模拟 + 环形世界（13200×4400，双轴无缝循环）。',
  dt: DT, ticks: TICKS, seed: SEED,
  worldW: 13200, worldH: 4400,
  viewW: 960, viewH: 560,
  scores: world.scores,
}

const dataJson = JSON.stringify({ meta, frames, rects: staticRects, shadows: staticShadows })

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${meta.title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #0f1115; color: #d7dae0; line-height: 1.5; }
  .wrap { max-width: 1040px; margin: 0 auto; }
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
  .foot { margin-top: 16px; font-size: 12px; color: #6b7380; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${meta.title}</h1>
  <p class="sub">${meta.subtitle}</p>
  <div class="panel">
    <canvas id="cv"></canvas>
    <div class="controls">
      <button id="playBtn">▶ Play</button>
      <input type="range" id="slider" min="0" max="${frames.length - 1}" value="0" />
      <label>speed <select id="speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="2">2×</option></select></label>
      <span class="readout" id="readout"></span>
    </div>
  </div>
  <p class="foot">由确定性服务器权威模拟逐帧生成（${meta.ticks} ticks @ ${meta.dt}s，seed ${meta.seed}）。相机跟随 P1，环形世界双轴无缝循环。</p>
</div>
<script>
const DATA = ${dataJson};
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const playBtn = document.getElementById('playBtn');
const slider = document.getElementById('slider');
const speedSel = document.getElementById('speed');
const readout = document.getElementById('readout');
const W = DATA.meta.viewW, H = DATA.meta.viewH;
const WW = DATA.meta.worldW, WH = DATA.meta.worldH;
const COLORS = {1:'#6ea8fe',2:'#f0a868'};
let idx = 0, playing = false, last = 0, acc = 0;

function resize() {
  const cw = cv.clientWidth;
  cv.width = cw * (window.devicePixelRatio||1);
  cv.height = Math.round(cw * (H/W)) * (window.devicePixelRatio||1);
  ctx.setTransform(cv.width/W, 0, 0, cv.height/H, 0, 0);
}
window.addEventListener('resize', resize); resize();

function wrapDelta(a, b, S){ let d=b-a; if(d>S/2)d-=S; if(d<-S/2)d+=S; return d; }

function drawFrame(f) {
  const cam = f.players[0] || {x:0,y:0};
  function sx(x){ return W/2 + wrapDelta(cam.x, x, WW); }
  function sy(y){ return H/2 + wrapDelta(cam.y, y, WH); }
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0b0d12'; ctx.fillRect(0,0,W,H);
  // 地形
  for (const r of DATA.rects) {
    const x = sx(r.x + r.w/2) - r.w/2, y = sy(r.y + r.h/2) - r.h/2;
    if (x > W+40 || x+r.w < -40 || y > H+40 || y+r.h < -40) continue;
    ctx.fillStyle = r.c; ctx.fillRect(x,y,r.w,r.h);
    if (r.b) { ctx.strokeStyle = r.b; ctx.lineWidth = 1; ctx.strokeRect(x+.5,y+.5,r.w-1,r.h-1); }
  }
  for (const s of DATA.shadows) {
    const x = sx(s.x + s.w/2) - s.w/2, y = sy(s.y + s.h/2) - s.h/2;
    if (x > W || x+s.w < 0 || y > H || y+s.h < 0) continue;
    ctx.fillStyle = 'rgba(0,0,0,'+s.a+')'; ctx.fillRect(x,y,s.w,s.h);
  }
  // 障碍物
  for (const o of f.obstacles) {
    const x = sx(o.x + o.w/2) - o.w/2, y = sy(o.y + o.h/2) - o.h/2;
    if (x > W+40 || x+o.w < -40 || y > H+40 || y+o.h < -40) continue;
    ctx.fillStyle = o.color; ctx.fillRect(x,y,o.w,o.h);
    ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.strokeRect(x+1,y+1,o.w-2,o.h-2);
    ctx.fillStyle = '#000'; ctx.fillRect(x,y-5,o.w,3);
    ctx.fillStyle = '#5ad37a'; ctx.fillRect(x,y-5,o.w*(o.hp/o.maxHp),3);
  }
  // 占点
  for (const c of f.cps) {
    const x = sx(c.x), y = sy(c.y);
    if (x < -60 || x > W+60 || y < -60 || y > H+60) continue;
    ctx.strokeStyle = c.owner ? (c.owner==='red'?'#f43f5e':c.owner==='blue'?'#0ea5e9':c.owner==='green'?'#10b981':'#eab308') : '#94a3b8';
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x,y,55,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '12px monospace'; ctx.textAlign='center';
    ctx.fillText('🚩'+c.code+' '+c.progress+'%', x, y-64);
  }
  // 弹道
  for (const pr of f.projectiles) {
    const x = sx(pr.x), y = sy(pr.y);
    if (x < -10 || x > W+10 || y < -10 || y > H+10) continue;
    ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(x,y,pr.r,0,Math.PI*2); ctx.fill();
  }
  // 玩家
  for (const p of f.players) {
    const x = sx(p.x), y = sy(p.y);
    const col = COLORS[p.id] || '#fff';
    ctx.fillStyle = p.alive ? col : '#475569';
    ctx.fillRect(x-10, y-26, 20, 42);
    ctx.beginPath(); ctx.arc(x, y-24, 8, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y-12); ctx.lineTo(x+Math.cos(p.aim)*34, y-12+Math.sin(p.aim)*34); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillRect(x-18, y-40, 36, 4);
    ctx.fillStyle = p.hp > 50 ? '#5ad37a' : p.hp > 25 ? '#e0b74d' : '#e05a5a';
    ctx.fillRect(x-18, y-40, 36*Math.max(0,p.hp)/100, 4);
    if (p.shield > 0) { ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y-12, 26, 0, Math.PI*2); ctx.stroke(); }
    ctx.fillStyle = col; ctx.font = '11px monospace'; ctx.textAlign='center';
    ctx.fillText((p.name||('P'+p.id))+' '+p.kills+'/'+p.deaths, x, y-46);
  }
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(8,8,520,46);
  ctx.fillStyle = '#e5e7eb'; ctx.font = '12px monospace'; ctx.textAlign='left';
  ctx.fillText('tick '+f.tick+'/'+DATA.meta.ticks+'   scores R/B/G '+DATA.meta.scores.red+'/'+DATA.meta.scores.blue+'/'+DATA.meta.scores.green, 14, 24);
  const p1 = f.players[0];
  if (p1) ctx.fillText('P1 '+p1.weapon+'  hp='+Math.round(p1.hp)+'  pos=('+Math.round(p1.x)+','+Math.round(p1.y)+')', 14, 42);
}

function render() {
  const f = DATA.frames[idx];
  drawFrame(f);
  readout.textContent = 'tick ' + f.tick + ' / ' + DATA.meta.ticks;
  slider.value = idx;
}

function step() {
  idx += 1;
  if (idx >= DATA.frames.length) idx = 0;
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
const outFile = join(outDir, 'replay.html')
writeFileSync(outFile, html, 'utf8')
console.log(`Wrote ${outFile} (${Buffer.byteLength(html)} bytes, ${frames.length} frames)`)