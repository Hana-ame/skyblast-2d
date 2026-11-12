"use strict";
(() => {
  const __mods = [
    // [0] src/web/main-noita.ts
    function(module, exports, __req) {
"use strict";

var _NoitaWorld = __req(1);
var _fullscreen = __req(2);
const LW = _NoitaWorld.W * _NoitaWorld.TILE;
const LH = _NoitaWorld.H * _NoitaWorld.TILE;
const canvas = document.getElementById('game');
const vp = (0, _fullscreen.fitCanvas)(canvas, LW, LH);
const ctx = canvas.getContext('2d');
const keys = new Set();
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
let mouse = {
  x: LW / 2,
  y: LH / 2
};
let mouseDown = false;
canvas.addEventListener('mousemove', e => {
  const w = vp.toWorld(e.clientX, e.clientY);
  mouse = w;
});
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) mouseDown = true;
});
window.addEventListener('mouseup', () => {
  mouseDown = false;
});
const touches = new Map();
canvas.addEventListener('touchstart', e => onTouch(e), {
  passive: false
});
canvas.addEventListener('touchmove', e => onTouch(e), {
  passive: false
});
canvas.addEventListener('touchend', e => onTouchEnd(e), {
  passive: false
});
function onTouch(e) {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    const w = vp.toWorld(t.clientX, t.clientY);
    touches.set(t.identifier, {
      side: w.x < LW / 2 ? 'L' : 'R',
      ...w
    });
  }
}
function onTouchEnd(e) {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier);
}
const world = new _NoitaWorld.NoitaWorld();
const player = world.addPlayer(50 * _NoitaWorld.TILE, (_NoitaWorld.H - 46) * _NoitaWorld.TILE);
const enemy = world.addPlayer(190 * _NoitaWorld.TILE, (_NoitaWorld.H - 46) * _NoitaWorld.TILE);
const terrainCv = document.createElement('canvas');
terrainCv.width = _NoitaWorld.W;
terrainCv.height = _NoitaWorld.H;
const tctx = terrainCv.getContext('2d');
let dirty = true;
const lastTiles = new Uint8Array(_NoitaWorld.W * _NoitaWorld.H);
function syncTerrain() {
  const t = world.tiles;
  if (dirty) {
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, _NoitaWorld.W, _NoitaWorld.H);
    for (let y = 0; y < _NoitaWorld.H; y++) for (let x = 0; x < _NoitaWorld.W; x++) {
      const v = t[x + y * _NoitaWorld.W];
      if (v === _NoitaWorld.EMPTY) continue;
      tctx.fillStyle = v === _NoitaWorld.SAND ? '#c9a227' : '#5a6470';
      tctx.fillRect(x, y, 1, 1);
    }
    lastTiles.set(t);
    dirty = false;
  } else {
    for (let y = 0; y < _NoitaWorld.H; y++) {
      for (let x = 0; x < _NoitaWorld.W; x++) {
        const i = x + y * _NoitaWorld.W;
        if (t[i] !== lastTiles[i]) {
          tctx.fillStyle = t[i] === _NoitaWorld.EMPTY ? '#000' : t[i] === _NoitaWorld.SAND ? '#c9a227' : '#5a6470';
          tctx.fillRect(x, y, 1, 1);
          lastTiles[i] = t[i];
        }
      }
    }
  }
}
document.getElementById('btn-fullscreen')?.addEventListener('click', _fullscreen.toggleFullscreen);
function toInput() {
  let move = 0;
  let hover = false;
  let aim = player.aim;
  let fire = false;
  if (keys.has('a') || keys.has('arrowleft')) move = -1;
  if (keys.has('d') || keys.has('arrowright')) move = 1;
  if (keys.has('w') || keys.has(' ') || keys.has('arrowup')) hover = true;
  aim = Math.atan2(mouse.y - player.pos.y, mouse.x - player.pos.x);
  fire = mouseDown;
  for (const t of touches.values()) {
    if (t.side === 'L') move = t.x < player.pos.x - 20 ? -1 : t.x > player.pos.x + 20 ? 1 : 0;else {
      hover = true;
      aim = Math.atan2(t.y - player.pos.y, t.x - player.pos.x);
      fire = true;
    }
  }
  return {
    move,
    hover,
    moveY: 0,
    aim,
    fire
  };
}
function aiInput() {
  const dx = player.pos.x - enemy.pos.x,
    dy = player.pos.y - enemy.pos.y;
  const dist = Math.hypot(dx, dy);
  return {
    move: Math.abs(dx) > 140 ? dx > 0 ? 1 : -1 : 0,
    hover: dist > 220 && enemy.energy > 0.5,
    moveY: 0,
    aim: Math.atan2(dy, dx),
    fire: world.tick % 20 < 14
  };
}
function drawPlayer(p, color, label) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.pos.x, p.pos.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.pos.x, p.pos.y);
  ctx.lineTo(p.pos.x + Math.cos(p.aim) * 18, p.pos.y + Math.sin(p.aim) * 18);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, p.pos.x, p.pos.y - 12);
}
function render() {
  vp.applyTransform();
  ctx.clearRect(0, 0, LW, LH);
  ctx.fillStyle = '#0e1420';
  ctx.fillRect(0, 0, LW, LH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainCv, 0, 0, _NoitaWorld.W, _NoitaWorld.H, 0, 0, LW, LH);
  ctx.fillStyle = '#ffd166';
  for (const b of world.projectiles) {
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  drawPlayer(player, '#4ade80', 'YOU');
  drawPlayer(enemy, '#f87171', 'AI');
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`K/D ${player.kills}/${player.deaths} vs ${enemy.kills}/${enemy.deaths}   能量 ${Math.round(player.energy * 100)}%   HP ${player.hp}   tick ${world.tick}`, 12, 20);
  ctx.fillStyle = '#333';
  ctx.fillRect(12, 28, 100, 6);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(12, 28, 100 * player.energy, 6);
}
const FIXED = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  let guard = 0;
  while (acc >= FIXED && guard < 5) {
    const inp = toInput();
    world.step(FIXED, new Map([[player.id, inp], [enemy.id, aiInput()]]));
    acc -= FIXED;
    guard++;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__noita = {
  world,
  get player() {
    return player;
  },
  get enemy() {
    return enemy;
  },
  markDirty() {
    dirty = true;
  }
};
    },
    // [1] src/core/noita/NoitaWorld.ts
    function(module, exports, __req) {
"use strict";

exports.__esModule = true;
exports.W = exports.TILE = exports.STONE = exports.SAND = exports.PLAYER_R = exports.NoitaWorld = exports.MOVE_SPEED = exports.HOVER_MAX_UP = exports.HOVER_ACCEL = exports.H = exports.GRAVITY = exports.FRICTION = exports.FIRE_DAMAGE = exports.FIRE_CD = exports.ENERGY_RECHARGE = exports.ENERGY_MAX = exports.ENERGY_DRAIN = exports.EMPTY = exports.BULLET_SPEED = exports.BULLET_LIFE = exports.BLAST_R = exports.AIR_FRICTION = exports.ACCEL = void 0;
exports.defaultNoitaInput = defaultNoitaInput;
const TILE = 4;
exports.TILE = TILE;
const W = 240;
exports.W = W;
const H = 150;
exports.H = H;
const EMPTY = 0;
exports.EMPTY = EMPTY;
const SAND = 1;
exports.SAND = SAND;
const STONE = 2;
exports.STONE = STONE;
function defaultNoitaInput() {
  return {
    move: 0,
    hover: false,
    moveY: 0,
    aim: 0,
    fire: false
  };
}
const GRAVITY = 900;
exports.GRAVITY = GRAVITY;
const MOVE_SPEED = 180;
exports.MOVE_SPEED = MOVE_SPEED;
const ACCEL = 1400;
exports.ACCEL = ACCEL;
const FRICTION = 30;
exports.FRICTION = FRICTION;
const AIR_FRICTION = 1.5;
exports.AIR_FRICTION = AIR_FRICTION;
const HOVER_ACCEL = 1900;
exports.HOVER_ACCEL = HOVER_ACCEL;
const HOVER_MAX_UP = 320;
exports.HOVER_MAX_UP = HOVER_MAX_UP;
const ENERGY_MAX = 1;
exports.ENERGY_MAX = ENERGY_MAX;
const ENERGY_DRAIN = 0.5;
exports.ENERGY_DRAIN = ENERGY_DRAIN;
const ENERGY_RECHARGE = 0.65;
exports.ENERGY_RECHARGE = ENERGY_RECHARGE;
const FIRE_CD = 0.25;
exports.FIRE_CD = FIRE_CD;
const BULLET_SPEED = 480;
exports.BULLET_SPEED = BULLET_SPEED;
const BULLET_LIFE = 2.5;
exports.BULLET_LIFE = BULLET_LIFE;
const BLAST_R = 5;
exports.BLAST_R = BLAST_R;
const FIRE_DAMAGE = 25;
exports.FIRE_DAMAGE = FIRE_DAMAGE;
const PLAYER_R = 6;
exports.PLAYER_R = PLAYER_R;
class NoitaWorld {
  players = [];
  projectiles = [];
  tiles = new Uint8Array(W * H);
  tick = 0;
  pid = 1;
  prj = 1;
  constructor() {
    this.genTerrain();
  }
  genTerrain() {
    const t = this.tiles;
    for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) t[x + y * W] = STONE;
    for (let x = 0; x < W; x++) {
      const h = H - 30 - Math.floor(10 + 8 * Math.sin(x / 14) + 5 * Math.sin(x / 3.7 + 2));
      for (let y = h; y < H - 30; y++) t[x + y * W] = SAND;
    }
    const carve = cx => {
      for (let y = H - 52; y < H - 36; y++) for (let x = cx - 10; x <= cx + 10; x++) t[x + y * W] = EMPTY;
    };
    carve(50);
    carve(190);
    for (let y = H - 75; y < H - 68; y++) for (let x = 100; x <= 140; x++) t[x + y * W] = STONE;
  }
  addPlayer(x, y) {
    const p = {
      id: this.pid++,
      pos: {
        x,
        y
      },
      vel: {
        x: 0,
        y: 0
      },
      aim: 0,
      hp: 100,
      energy: ENERGY_MAX,
      alive: true,
      kills: 0,
      deaths: 0,
      fireCd: 0
    };
    this.players.push(p);
    return p;
  }
  tileAt(px, py) {
    const x = Math.floor(px / TILE),
      y = Math.floor(py / TILE);
    if (x < 0 || x >= W || y < 0 || y >= H) return STONE;
    return this.tiles[x + y * W];
  }
  circleHit(px, py, r) {
    const x0 = Math.floor((px - r) / TILE),
      x1 = Math.floor((px + r) / TILE);
    const y0 = Math.floor((py - r) / TILE),
      y1 = Math.floor((py + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) {
        const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE));
        const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE));
        const dx = px - nx,
          dy = py - ny;
        if (dx * dx + dy * dy < r * r) return true;
        continue;
      }
      if (this.tiles[x + y * W] !== EMPTY) {
        const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE));
        const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE));
        const dx = px - nx,
          dy = py - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }
  grounded(p) {
    return this.circleHit(p.pos.x, p.pos.y + PLAYER_R + 1, PLAYER_R * 0.4);
  }
  step(dt, inputs) {
    this.tick++;
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultNoitaInput();
      this.applyPlayer(p, w, dt);
    }
    for (const b of this.projectiles) this.stepBullet(b, dt);
    this.bulletHits();
    this.projectiles = this.projectiles.filter(b => b.life > 0);
    this.fallSand();
  }
  applyPlayer(p, w, dt) {
    const g = this.grounded(p);
    const speed = g ? MOVE_SPEED : MOVE_SPEED * 0.6;
    const fric = g ? FRICTION : AIR_FRICTION;
    if (w.move < 0) p.vel.x = Math.max(-speed, p.vel.x - ACCEL * dt);else if (w.move > 0) p.vel.x = Math.min(speed, p.vel.x + ACCEL * dt);else p.vel.x *= Math.exp(-fric * dt);
    const canHover = w.hover && p.energy > 0;
    if (canHover) p.vel.y = Math.max(-HOVER_MAX_UP, p.vel.y - (HOVER_ACCEL - GRAVITY) * dt);
    p.energy = canHover ? Math.max(0, p.energy - ENERGY_DRAIN * dt) : g ? Math.min(ENERGY_MAX, p.energy + ENERGY_RECHARGE * dt) : p.energy;
    if (!canHover) p.vel.y += GRAVITY * dt;
    p.vel.y = Math.min(p.vel.y, 420);
    this.moveWithCollision(p, dt);
    p.aim = w.aim;
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (w.fire && p.fireCd <= 0) {
      const muzzle = {
        x: p.pos.x + Math.cos(p.aim) * 10,
        y: p.pos.y + Math.sin(p.aim) * 10
      };
      this.projectiles.push({
        id: this.prj++,
        owner: p.id,
        pos: muzzle,
        vel: {
          x: Math.cos(p.aim) * BULLET_SPEED,
          y: Math.sin(p.aim) * BULLET_SPEED
        },
        life: BULLET_LIFE
      });
      p.fireCd = FIRE_CD;
    }
  }
  moveWithCollision(p, dt) {
    let nx = p.pos.x + p.vel.x * dt;
    if (!this.circleHit(nx, p.pos.y, PLAYER_R)) p.pos.x = nx;else {
      const step = Math.sign(p.vel.x) * 0.5;
      let x = p.pos.x;
      while (!this.circleHit(x + step, p.pos.y, PLAYER_R)) x += step;
      p.pos.x = x;
      p.vel.x = 0;
    }
    let ny = p.pos.y + p.vel.y * dt;
    if (!this.circleHit(p.pos.x, ny, PLAYER_R)) p.pos.y = ny;else {
      const step = Math.sign(p.vel.y) * 0.5;
      let y = p.pos.y;
      while (!this.circleHit(p.pos.x, y + step, PLAYER_R)) y += step;
      p.pos.y = y;
      p.vel.y = 0;
    }
    p.pos.x = Math.max(PLAYER_R, Math.min(W * TILE - PLAYER_R, p.pos.x));
    p.pos.y = Math.max(PLAYER_R, Math.min(H * TILE - PLAYER_R, p.pos.y));
  }
  stepBullet(b, dt) {
    b.vel.y += 500 * dt;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.life -= dt;
    if (b.life > 0 && this.tileAt(b.pos.x, b.pos.y) !== EMPTY) {
      this.explode(b.pos.x, b.pos.y, BLAST_R);
      b.life = 0;
    }
    if (b.pos.x < 0 || b.pos.x > W * TILE || b.pos.y < 0 || b.pos.y > H * TILE) b.life = 0;
  }
  explode(cx, cy, rTiles) {
    const tx = Math.floor(cx / TILE),
      ty = Math.floor(cy / TILE);
    for (let y = ty - rTiles; y <= ty + rTiles; y++) for (let x = tx - rTiles; x <= tx + rTiles; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= rTiles * rTiles) {
        this.tiles[x + y * W] = EMPTY;
      }
    }
  }
  bulletHits() {
    for (const b of this.projectiles) {
      if (b.life <= 0) continue;
      for (const p of this.players) {
        if (!p.alive || p.id === b.owner) continue;
        const dx = p.pos.x - b.pos.x,
          dy = p.pos.y - b.pos.y;
        if (dx * dx + dy * dy < (PLAYER_R + 3) ** 2) {
          b.life = 0;
          p.hp -= FIRE_DAMAGE;
          if (p.hp <= 0) this.kill(p);
        }
      }
    }
  }
  kill(v) {
    v.deaths++;
    v.alive = false;
    v.hp = 100;
    v.energy = ENERGY_MAX;
    const left = v.id % 2 === 1;
    v.pos = {
      x: (left ? 50 : 190) * TILE,
      y: (H - 46) * TILE
    };
    v.vel = {
      x: 0,
      y: 0
    };
    v.alive = true;
  }
  fallSand() {
    const t = this.tiles;
    for (let y = H - 2; y >= 0; y--) {
      for (let x = 0; x < W; x++) {
        const i = x + y * W;
        if (t[i] !== SAND) continue;
        if (t[i + W] === EMPTY) {
          t[i + W] = SAND;
          t[i] = EMPTY;
        } else if (x > 0 && t[i - 1 + W] === EMPTY && t[i - 1] === EMPTY) {
          t[i - 1 + W] = SAND;
          t[i] = EMPTY;
        } else if (x < W - 1 && t[i + 1 + W] === EMPTY && t[i + 1] === EMPTY) {
          t[i] = EMPTY;
          t[i + 1 + W] = SAND;
        }
      }
    }
  }
}
exports.NoitaWorld = NoitaWorld;
    },
    // [2] src/web/fullscreen.ts
    function(module, exports, __req) {
"use strict";

exports.__esModule = true;
exports.fitCanvas = fitCanvas;
exports.isFullscreen = isFullscreen;
exports.toggleFullscreen = toggleFullscreen;
let pseudoFullscreen = false;
function isFullscreen() {
  const d = document;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement) || pseudoFullscreen;
}
function toggleFullscreen() {
  const el = document.documentElement;
  const d = document;
  if (isFullscreen()) {
    pseudoFullscreen = false;
    document.body.classList.remove('pseudo-fullscreen');
    try {
      const p = d.exitFullscreen?.() ?? d.webkitExitFullscreen?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
    return false;
  } else {
    pseudoFullscreen = true;
    document.body.classList.add('pseudo-fullscreen');
    try {
      const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
    return true;
  }
}
function fitCanvas(canvas, logicalW, logicalH) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = Math.max(1, Math.round(logicalW * dpr));
    canvas.height = Math.max(1, Math.round(logicalH * dpr));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  };
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.body.style.touchAction = 'none';
  document.body.style.overflow = 'hidden';
  return {
    toWorld: (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width * logicalW,
        y: (clientY - rect.top) / rect.height * logicalH
      };
    },
    applyTransform: () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };
}
    },
  ];
  const __cache = {};
  function __req(id) {
    let m = __cache[id];
    if (m) return m.exports;
    m = __cache[id] = { exports: {} };
    __mods[id](m, m.exports, __req);
    return m.exports;
  }
  __req(0);
})();
