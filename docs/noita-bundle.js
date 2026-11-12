(function() {
  const __modules = {
  "./src/web/main-noita.ts": function(exports, __require) {
"use strict";

var _NoitaWorld = __require("./src/core/noita/NoitaWorld.ts");
var _fullscreen = __require("./src/web/fullscreen.ts");
// web/main-noita.ts —— 仿 Noita 浏览器入口：可破坏像素地形 + 落沙 + 悬浮 + 360°瞄准

const LW = _NoitaWorld.W * _NoitaWorld.TILE; // 960
const LH = _NoitaWorld.H * _NoitaWorld.TILE; // 600

const canvas = document.getElementById('game');
const vp = (0, _fullscreen.fitCanvas)(canvas, LW, LH);
const ctx = canvas.getContext('2d');

// Noita 页面不需要 Controls 的跳/喷语义，自建轻量输入（键盘+鼠标+触屏）
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
// 触屏：左半=左右移动，右半=悬浮+瞄准开火
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

// 像素地形渲染：offscreen 瓦片 canvas（1 tile=1px），每帧只重绘脏瓦片
const terrainCv = document.createElement('canvas');
terrainCv.width = _NoitaWorld.W;
terrainCv.height = _NoitaWorld.H;
const tctx = terrainCv.getContext('2d');
let dirty = true;
const lastTiles = new Uint8Array(_NoitaWorld.W * _NoitaWorld.H);
function syncTerrain() {
  const t = world.tiles;
  if (dirty) {
    // 全量重绘（首次/炸坑后）
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
    // 增量：落沙每帧有变化，diff 重绘（36000 瓦片 diff 很快）
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
  // 键盘
  if (keys.has('a') || keys.has('arrowleft')) move = -1;
  if (keys.has('d') || keys.has('arrowright')) move = 1;
  if (keys.has('w') || keys.has(' ') || keys.has('arrowup')) hover = true;
  aim = Math.atan2(mouse.y - player.pos.y, mouse.x - player.pos.x);
  fire = mouseDown;
  // 触屏覆盖
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

// AI：朝玩家射 + 追踪
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
  // 360° 瞄准线
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
  // 背景层：每帧先清屏再铺底色，否则 drawImage 只写非透明像素，旧帧残留 → 拖影
  ctx.clearRect(0, 0, LW, LH);
  ctx.fillStyle = '#0e1420'; // 深夜空底色（与地形 offscreen 透明区一致）
  ctx.fillRect(0, 0, LW, LH);
  // 地形（像素放大）
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainCv, 0, 0, _NoitaWorld.W, _NoitaWorld.H, 0, 0, LW, LH);
  // 弹丸
  ctx.fillStyle = '#ffd166';
  for (const b of world.projectiles) {
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  drawPlayer(player, '#4ade80', 'YOU');
  drawPlayer(enemy, '#f87171', 'AI');
  // HUD
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`K/D ${player.kills}/${player.deaths} vs ${enemy.kills}/${enemy.deaths}   能量 ${Math.round(player.energy * 100)}%   HP ${player.hp}   tick ${world.tick}`, 12, 20);
  // 能量条
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
requestAnimationFrame(frame)

// 炸坑检测：暴露给测试（渲染脏标记用）
;
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
  "./src/core/noita/NoitaWorld.ts": function(exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.W = exports.TILE = exports.STONE = exports.SAND = exports.PLAYER_R = exports.NoitaWorld = exports.MOVE_SPEED = exports.HOVER_MAX_UP = exports.HOVER_ACCEL = exports.H = exports.GRAVITY = exports.FRICTION = exports.FIRE_DAMAGE = exports.FIRE_CD = exports.ENERGY_RECHARGE = exports.ENERGY_MAX = exports.ENERGY_DRAIN = exports.EMPTY = exports.BULLET_SPEED = exports.BULLET_LIFE = exports.BLAST_R = exports.AIR_FRICTION = exports.ACCEL = void 0;
exports.defaultNoitaInput = defaultNoitaInput;
// core/noita/NoitaWorld.ts —— 仿 Noita：像素可破坏地形 + 落沙 + 360°自由瞄准 + 悬浮飞行（能量）
// 纯 TS 零依赖，确定性 step(dt, inputs)。地形 = Uint8Array 瓦片图（0=空 1=沙 2=石），弹丸命中炸坑。

const TILE = 4; // 瓦片像素尺寸（逻辑 px）
exports.TILE = TILE;
const W = 240; // 地形宽（瓦片数）→ 240*4=960 逻辑px
exports.W = W;
const H = 150; // 地形高（瓦片数）→ 150*4=600 逻辑px
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
const FRICTION = 30; // 地面摩擦 λ
exports.FRICTION = FRICTION;
const AIR_FRICTION = 1.5;
exports.AIR_FRICTION = AIR_FRICTION;
const HOVER_ACCEL = 1900; // 悬浮升力（>重力 900）
exports.HOVER_ACCEL = HOVER_ACCEL;
const HOVER_MAX_UP = 320; // 悬浮升速上限
exports.HOVER_MAX_UP = HOVER_MAX_UP;
const ENERGY_MAX = 1;
exports.ENERGY_MAX = ENERGY_MAX;
const ENERGY_DRAIN = 0.5; // 悬浮每秒消耗（1=满能量悬浮2s）
exports.ENERGY_DRAIN = ENERGY_DRAIN;
const ENERGY_RECHARGE = 0.65; // 落地每秒回充
exports.ENERGY_RECHARGE = ENERGY_RECHARGE;
const FIRE_CD = 0.25;
exports.FIRE_CD = FIRE_CD;
const BULLET_SPEED = 480;
exports.BULLET_SPEED = BULLET_SPEED;
const BULLET_LIFE = 2.5;
exports.BULLET_LIFE = BULLET_LIFE;
const BLAST_R = 5; // 炸坑半径（瓦片）
exports.BLAST_R = BLAST_R;
const FIRE_DAMAGE = 25;
exports.FIRE_DAMAGE = FIRE_DAMAGE;
const PLAYER_R = 6; // 玩家碰撞半径（逻辑 px）
exports.PLAYER_R = PLAYER_R;
class NoitaWorld {
  players = [];
  projectiles = [];
  // 行主序地形：idx = x + y*W
  tiles = new Uint8Array(W * H);
  tick = 0;
  pid = 1;
  prj = 1;
  constructor() {
    this.genTerrain();
  }

  /** 生成地形：底部石头 + 起伏沙面 + 中间挖出两玩家平台 + 浮空石岛 */
  genTerrain() {
    const t = this.tiles;
    // 基岩底：下 30 行石头
    for (let y = H - 30; y < H; y++) for (let x = 0; x < W; x++) t[x + y * W] = STONE;
    // 起伏沙面（正弦叠加，确定）
    for (let x = 0; x < W; x++) {
      const h = H - 30 - Math.floor(10 + 8 * Math.sin(x / 14) + 5 * Math.sin(x / 3.7 + 2));
      for (let y = h; y < H - 30; y++) t[x + y * W] = SAND;
    }
    // 挖出玩家出生区（左 40-60，右 180-200，宽 20、高 12 的空腔）
    const carve = cx => {
      for (let y = H - 52; y < H - 36; y++) for (let x = cx - 10; x <= cx + 10; x++) t[x + y * W] = EMPTY;
    };
    carve(50);
    carve(190);
    // 中间浮空石岛（掩体）
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
    if (x < 0 || x >= W || y < 0 || y >= H) return STONE; // 边界外算实体（挡）
    return this.tiles[x + y * W];
  }

  /** 圆 vs 地形采样碰撞：返回是否碰到实体（地图边界外算实体，与 tileAt 一致） */
  circleHit(px, py, r) {
    const x0 = Math.floor((px - r) / TILE),
      x1 = Math.floor((px + r) / TILE);
    const y0 = Math.floor((py - r) / TILE),
      y1 = Math.floor((py + r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) {
        // 边界外按实体处理（但先做 AABB 相交确认，避免大范围误判）
        const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE));
        const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE));
        const dx = px - nx,
          dy = py - ny;
        if (dx * dx + dy * dy < r * r) return true;
        continue;
      }
      if (this.tiles[x + y * W] !== EMPTY) {
        // 瓦片 AABB 与圆相交
        const nx = Math.max(x * TILE, Math.min(px, x * TILE + TILE));
        const ny = Math.max(y * TILE, Math.min(py, y * TILE + TILE));
        const dx = px - nx,
          dy = py - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  /** 玩家落地判定（脚下 1px） */
  grounded(p) {
    return this.circleHit(p.pos.x, p.pos.y + PLAYER_R + 1, PLAYER_R * 0.4);
  }
  step(dt, inputs) {
    this.tick++;
    // 玩家
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? defaultNoitaInput();
      this.applyPlayer(p, w, dt);
    }
    // 弹丸
    for (const b of this.projectiles) this.stepBullet(b, dt);
    // 弹丸命中玩家
    this.bulletHits();
    this.projectiles = this.projectiles.filter(b => b.life > 0);
    // 落沙（活跃区列表，确定性遍历）
    this.fallSand();
  }
  applyPlayer(p, w, dt) {
    const g = this.grounded(p);
    // 水平：地面/空中分离（同移植模型）
    const speed = g ? MOVE_SPEED : MOVE_SPEED * 0.6;
    const fric = g ? FRICTION : AIR_FRICTION;
    if (w.move < 0) p.vel.x = Math.max(-speed, p.vel.x - ACCEL * dt);else if (w.move > 0) p.vel.x = Math.min(speed, p.vel.x + ACCEL * dt);else p.vel.x *= Math.exp(-fric * dt);
    // 悬浮：能量门控
    const canHover = w.hover && p.energy > 0;
    if (canHover) p.vel.y = Math.max(-HOVER_MAX_UP, p.vel.y - (HOVER_ACCEL - GRAVITY) * dt);
    p.energy = canHover ? Math.max(0, p.energy - ENERGY_DRAIN * dt) : g ? Math.min(ENERGY_MAX, p.energy + ENERGY_RECHARGE * dt) : p.energy;
    // 重力
    if (!canHover) p.vel.y += GRAVITY * dt;
    p.vel.y = Math.min(p.vel.y, 420);
    // 位置积分 + 地形碰撞（X/Y 分离）
    this.moveWithCollision(p, dt);
    // 瞄准/开火
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

  /** 分离轴移动：先 X 后 Y，撞地形停该轴（挖坑后可穿） */
  moveWithCollision(p, dt) {
    // X
    let nx = p.pos.x + p.vel.x * dt;
    if (!this.circleHit(nx, p.pos.y, PLAYER_R)) p.pos.x = nx;else {
      // 撞墙：逐像素步进找贴墙点（不瞬移）
      const step = Math.sign(p.vel.x) * 0.5;
      let x = p.pos.x;
      while (!this.circleHit(x + step, p.pos.y, PLAYER_R)) x += step;
      p.pos.x = x;
      p.vel.x = 0;
    }
    // Y
    let ny = p.pos.y + p.vel.y * dt;
    if (!this.circleHit(p.pos.x, ny, PLAYER_R)) p.pos.y = ny;else {
      const step = Math.sign(p.vel.y) * 0.5;
      let y = p.pos.y;
      while (!this.circleHit(p.pos.x, y + step, PLAYER_R)) y += step;
      p.pos.y = y;
      p.vel.y = 0;
    }
    // 边界
    p.pos.x = Math.max(PLAYER_R, Math.min(W * TILE - PLAYER_R, p.pos.x));
    p.pos.y = Math.max(PLAYER_R, Math.min(H * TILE - PLAYER_R, p.pos.y));
  }
  stepBullet(b, dt) {
    // 弹丸受重力（Noita 弹道也下坠）
    b.vel.y += 500 * dt;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.life -= dt;
    // 撞地形 → 炸坑（可破坏地形）
    if (b.life > 0 && this.tileAt(b.pos.x, b.pos.y) !== EMPTY) {
      this.explode(b.pos.x, b.pos.y, BLAST_R);
      b.life = 0;
    }
    if (b.pos.x < 0 || b.pos.x > W * TILE || b.pos.y < 0 || b.pos.y > H * TILE) b.life = 0;
  }

  /** 炸坑：圆形范围清空瓦片（石头也可炸） */
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
    // 重生：出生空腔（左/右轮流）
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

  /** 落沙物理：每 tick 自下而上扫，沙向下掉（含斜滑），已稳定的沙不动 */
  fallSand() {
    const t = this.tiles;
    // 自倒数第二行向上扫（y 从 H-2 到 0）：沙向下落
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
        // 石头不动
      }
    }
    // 瓦片坐标下边界：最底行沙固定（基岩）
  }
}
exports.NoitaWorld = NoitaWorld;
  },
  "./src/core/types.ts": function(exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.defaultWorldInput = defaultWorldInput;
// core/types.ts —— 纯数据契约（零逻辑、可 JSON 序列化 = 天然快照格式）
// 覆盖 SkyBlast 全部玩法实体：玩家/弹丸/手雷/地雷/空袭/可破坏障碍物/占领点/弹药点/补给箱/迫击炮/瞭望塔/传送门/替身人偶/事件

// 模拟层只认这个归一化输入（由 InputMapper 从 Intent[] 翻译而来）

// 触发事件（瞬态、不进快照；由 World 产出、net/ui 层订阅 → killfeed/音效/粒子）

function defaultWorldInput() {
  return {
    move: 0,
    jump: false,
    jetpack: false,
    dive: false,
    aim: 0,
    fire: false,
    reload: false,
    switchWeapon: null,
    interact: false,
    secondary: null
  };
}
  },
  "./src/web/fullscreen.ts": function(exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fitCanvas = fitCanvas;
exports.isFullscreen = isFullscreen;
exports.toggleFullscreen = toggleFullscreen;
// web/fullscreen.ts —— 全屏 API + canvas 视口适配（浏览器，零依赖，含沙箱降级支持）
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
    } catch {/* ignore */}
    return false;
  } else {
    pseudoFullscreen = true;
    document.body.classList.add('pseudo-fullscreen');
    try {
      const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {/* ignore */}
    return true;
  }
}
/**
 * 把 canvas 铺满窗口；内部分辨率 = logical × devicePixelRatio；
 * 返回坐标换算与每帧 transform 设置。监听 resize/orientationchange。
 */
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
  }
  };
  const __cache = {};
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const m = { exports: {} };
    __cache[id] = m;
    if (!__modules[id]) throw new Error('Module not found: ' + id);
    __modules[id](m.exports, __require);
    return m.exports;
  }
  __require("./src/web/main-noita.ts");
})();
