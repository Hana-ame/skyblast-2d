(() => {
  const __modules = {
    "src/core/sim/physics.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RECOIL_SCALE = exports.RECOIL_DISPLACEMENT_FACTOR = exports.RECOIL_DECAY = void 0;
exports.applyGravity = applyGravity;
exports.getPhysicsParams = getPhysicsParams;
exports.integrate = integrate;
exports.jetpack = jetpack;
exports.jump = jump;
exports.move = move;
exports.recoilDelta = recoilDelta;
exports.resetPhysicsParams = resetPhysicsParams;
exports.setPhysicsParams = setPhysicsParams;
exports.stepRecoilVel = stepRecoilVel;
exports.substep = substep;
exports.updateJetpackFuel = updateJetpackFuel;
const defaults = {
  mass: 1.3,
  gravity: 1250,
  moveSpeed: 300,
  jumpImpulse: 490,
  maxFall: 1200,
  jetpackAccel: 4200,
  jetpackMaxUp: 280,
  jetpackFuel: 1.0,
  jetpackDrain: 0.5,
  jetpackRecharge: 0.7
};
let P = {
  ...defaults
};
function getPhysicsParams() {
  return P;
}
function setPhysicsParams(overrides) {
  P = {
    ...P,
    ...overrides
  };
  return {
    ...P
  };
}
function resetPhysicsParams() {
  P = {
    ...defaults
  };
  return {
    ...P
  };
}
function integrate(p, v, dt) {
  p.x += v.x * dt;
  p.y += v.y * dt;
}
function applyGravity(v, dt, mult = 1) {
  v.y += P.gravity / P.mass * mult * dt;
  const cap = mult > 1 ? P.maxFall * 1.6 : P.maxFall;
  if (v.y > cap) v.y = cap;
}
function move(v, dir) {
  v.x = dir * P.moveSpeed;
}
function jump(v) {
  v.y = -P.jumpImpulse;
}
function jetpack(v, dt, ascendMult = 1) {
  const cap = -P.jetpackMaxUp * ascendMult;
  if (v.y <= cap) return;
  v.y = Math.max(cap, v.y - P.jetpackAccel * ascendMult / P.mass * dt);
}
function updateJetpackFuel(fuel, active, onGround, dt, maxFuel = P.jetpackFuel) {
  const next = active ? fuel - P.jetpackDrain * dt : onGround ? fuel + P.jetpackRecharge * dt : fuel;
  return Math.min(maxFuel, Math.max(0, next));
}
function substep(dt, maxStep = 1 / 120) {
  if (dt <= 0) return [];
  if (maxStep <= 0) return [dt];
  const n = Math.ceil(dt / maxStep);
  const step = dt / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(step);
  return out;
}
const RECOIL_SCALE = 0.56;
exports.RECOIL_SCALE = RECOIL_SCALE;
const RECOIL_DECAY = 7.0;
exports.RECOIL_DECAY = RECOIL_DECAY;
const RECOIL_EPSILON = 4;
function recoilDelta(recoil, aim) {
  return {
    x: -Math.cos(aim) * recoil * RECOIL_SCALE,
    y: -Math.sin(aim) * recoil * RECOIL_SCALE
  };
}
const RECOIL_INTEGRAL = (1 - Math.exp(-RECOIL_DECAY * (1 / 60))) / RECOIL_DECAY;
const RECOIL_DISPLACEMENT_FACTOR = RECOIL_INTEGRAL;
exports.RECOIL_DISPLACEMENT_FACTOR = RECOIL_DISPLACEMENT_FACTOR;
function stepRecoilVel(rv, dt) {
  const k = Math.exp(-RECOIL_DECAY * dt);
  rv.x *= k;
  rv.y *= k;
  if (Math.hypot(rv.x, rv.y) < RECOIL_EPSILON) {
    rv.x = 0;
    rv.y = 0;
  }
}
    },
    "src/core/wrap.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WORLD_W = exports.WORLD_H = exports.SURFACE_Y = void 0;
exports.clamp = clamp;
exports.wrapDeltaX = wrapDeltaX;
exports.wrapDeltaY = wrapDeltaY;
exports.wrapDist = wrapDist;
exports.wrapX = wrapX;
exports.wrapY = wrapY;
const WORLD_W = 13200;
exports.WORLD_W = WORLD_W;
const WORLD_H = 4400;
exports.WORLD_H = WORLD_H;
const SURFACE_Y = 2800;
exports.SURFACE_Y = SURFACE_Y;
function wrapX(x) {
  return (x % WORLD_W + WORLD_W) % WORLD_W;
}
function wrapY(y) {
  return (y % WORLD_H + WORLD_H) % WORLD_H;
}
function wrapDeltaX(fromX, toX) {
  let dx = wrapX(toX) - wrapX(fromX);
  if (dx > WORLD_W * 0.5) dx -= WORLD_W;
  if (dx < -WORLD_W * 0.5) dx += WORLD_W;
  return dx;
}
function wrapDeltaY(fromY, toY) {
  let dy = wrapY(toY) - wrapY(fromY);
  if (dy > WORLD_H * 0.5) dy -= WORLD_H;
  if (dy < -WORLD_H * 0.5) dy += WORLD_H;
  return dy;
}
function wrapDist(x1, y1, x2, y2) {
  return Math.hypot(wrapDeltaX(x1, x2), wrapDeltaY(y1, y2));
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
    },
    "src/core/map.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WALL_THICK = exports.UNIFIED_EDGE_HIGHLIGHT = exports.UNDERGROUND_FLOOR_THICK = exports.TUNNEL_HEIGHT = exports.STAIR_SMALL_SQUARE_SIZE = exports.SKY_SQUARE_SIZE = exports.MAIN_DECK_TOP = exports.MAIN_DECK_THICK = exports.M249_RIGHT_PERCH_X = exports.M249_PERCH_Y = exports.M249_PERCH_X = exports.M249_PERCH_SIZE = exports.M249_LEFT_PERCH_X = exports.GROUND_PIT_OPEN_W = exports.GROUND_PIT_FLOOR_TOP = exports.GROUND_PIT_FLOOR_THICK = exports.GROUND_PIT_DEPTH = exports.GAUSS_CENTER_PERCH_Y = exports.GAUSS_CENTER_PERCH_X = exports.GAUSS_CENTER_PERCH_SIZE = exports.FIRST_COVER_HEIGHT = exports.CENTER_SHAFT_X1 = exports.CENTER_SHAFT_X0 = exports.CENTER_SHAFT_W = exports.CEILING_TOP = exports.CEILING_THICK = exports.CEILING_HOLE_X1 = exports.CEILING_HOLE_X0 = exports.BEDROCK_TOP = exports.ARCH_CENTER_TOP = void 0;
exports.carveTunnelInSolids = carveTunnelInSolids;
exports.defaultMapData = defaultMapData;
exports.sanitizeMapData = sanitizeMapData;
var _wrap = __require("src/core/wrap.ts");
const CEILING_TOP = 280;
exports.CEILING_TOP = CEILING_TOP;
const CEILING_THICK = 80;
exports.CEILING_THICK = CEILING_THICK;
const CEILING_HOLE_X0 = 6600;
exports.CEILING_HOLE_X0 = CEILING_HOLE_X0;
const CEILING_HOLE_X1 = 6600;
exports.CEILING_HOLE_X1 = CEILING_HOLE_X1;
const BEDROCK_TOP = 4160;
exports.BEDROCK_TOP = BEDROCK_TOP;
const WALL_THICK = 60;
exports.WALL_THICK = WALL_THICK;
const TUNNEL_HEIGHT = 160;
exports.TUNNEL_HEIGHT = TUNNEL_HEIGHT;
const UNDERGROUND_FLOOR_THICK = 120;
exports.UNDERGROUND_FLOOR_THICK = UNDERGROUND_FLOOR_THICK;
const MAIN_DECK_TOP = 3280;
exports.MAIN_DECK_TOP = MAIN_DECK_TOP;
const MAIN_DECK_THICK = 160;
exports.MAIN_DECK_THICK = MAIN_DECK_THICK;
const FIRST_COVER_HEIGHT = 140;
exports.FIRST_COVER_HEIGHT = FIRST_COVER_HEIGHT;
const CENTER_SHAFT_W = 280;
exports.CENTER_SHAFT_W = CENTER_SHAFT_W;
const CENTER_SHAFT_X0 = (_wrap.WORLD_W - CENTER_SHAFT_W) / 2;
exports.CENTER_SHAFT_X0 = CENTER_SHAFT_X0;
const CENTER_SHAFT_X1 = CENTER_SHAFT_X0 + CENTER_SHAFT_W;
exports.CENTER_SHAFT_X1 = CENTER_SHAFT_X1;
const GROUND_PIT_OPEN_W = 240;
exports.GROUND_PIT_OPEN_W = GROUND_PIT_OPEN_W;
const GROUND_PIT_DEPTH = 80;
exports.GROUND_PIT_DEPTH = GROUND_PIT_DEPTH;
const GROUND_PIT_FLOOR_TOP = MAIN_DECK_TOP + GROUND_PIT_DEPTH;
exports.GROUND_PIT_FLOOR_TOP = GROUND_PIT_FLOOR_TOP;
const GROUND_PIT_FLOOR_THICK = MAIN_DECK_THICK - GROUND_PIT_DEPTH;
exports.GROUND_PIT_FLOOR_THICK = GROUND_PIT_FLOOR_THICK;
const SKY_SQUARE_SIZE = 260;
exports.SKY_SQUARE_SIZE = SKY_SQUARE_SIZE;
const ARCH_CENTER_TOP = 980;
exports.ARCH_CENTER_TOP = ARCH_CENTER_TOP;
const GAUSS_CENTER_PERCH_SIZE = 0;
exports.GAUSS_CENTER_PERCH_SIZE = GAUSS_CENTER_PERCH_SIZE;
const GAUSS_CENTER_PERCH_X = _wrap.WORLD_W / 2;
exports.GAUSS_CENTER_PERCH_X = GAUSS_CENTER_PERCH_X;
const GAUSS_CENTER_PERCH_Y = _wrap.WORLD_H / 2;
exports.GAUSS_CENTER_PERCH_Y = GAUSS_CENTER_PERCH_Y;
const STAIR_SMALL_SQUARE_SIZE = 80;
exports.STAIR_SMALL_SQUARE_SIZE = STAIR_SMALL_SQUARE_SIZE;
const M249_PERCH_SIZE = 100;
exports.M249_PERCH_SIZE = M249_PERCH_SIZE;
const M249_PERCH_Y = 520;
exports.M249_PERCH_Y = M249_PERCH_Y;
const M249_LEFT_PERCH_X = 3380;
exports.M249_LEFT_PERCH_X = M249_LEFT_PERCH_X;
const M249_RIGHT_PERCH_X = _wrap.WORLD_W - M249_LEFT_PERCH_X - M249_PERCH_SIZE;
exports.M249_RIGHT_PERCH_X = M249_RIGHT_PERCH_X;
const M249_PERCH_X = M249_RIGHT_PERCH_X;
exports.M249_PERCH_X = M249_PERCH_X;
const UNIFIED_EDGE_HIGHLIGHT = '#38bdf8';
exports.UNIFIED_EDGE_HIGHLIGHT = UNIFIED_EDGE_HIGHLIGHT;
function mirrorSolid(s) {
  return {
    x: _wrap.WORLD_W - s.x - s.w,
    y: s.y,
    w: s.w,
    h: s.h,
    kind: s.kind
  };
}
function mirrorPairs(leftSolids) {
  return [...leftSolids, ...leftSolids.map(mirrorSolid)];
}
function defaultMapData() {
  const leftThickGroundWithPits = [{
    x: WALL_THICK,
    y: MAIN_DECK_TOP,
    w: 440,
    h: MAIN_DECK_THICK,
    kind: 'platform'
  }, {
    x: 740,
    y: MAIN_DECK_TOP - FIRST_COVER_HEIGHT,
    w: 120,
    h: FIRST_COVER_HEIGHT,
    kind: 'cover'
  }, {
    x: 680,
    y: MAIN_DECK_TOP,
    w: 980,
    h: MAIN_DECK_THICK,
    kind: 'platform'
  }, {
    x: 1660,
    y: GROUND_PIT_FLOOR_TOP,
    w: GROUND_PIT_OPEN_W,
    h: GROUND_PIT_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 1900,
    y: MAIN_DECK_TOP,
    w: 960,
    h: MAIN_DECK_THICK,
    kind: 'platform'
  }, {
    x: 2860,
    y: GROUND_PIT_FLOOR_TOP,
    w: GROUND_PIT_OPEN_W,
    h: GROUND_PIT_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 3100,
    y: MAIN_DECK_TOP,
    w: 1260,
    h: MAIN_DECK_THICK,
    kind: 'platform'
  }, {
    x: 4360,
    y: GROUND_PIT_FLOOR_TOP,
    w: GROUND_PIT_OPEN_W,
    h: GROUND_PIT_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 4600,
    y: MAIN_DECK_TOP,
    w: 1400,
    h: MAIN_DECK_THICK,
    kind: 'platform'
  }];
  const solids = [{
    x: 0,
    y: CEILING_TOP,
    w: _wrap.WORLD_W,
    h: CEILING_THICK,
    kind: 'platform'
  }, ...mirrorPairs([{
    x: 0,
    y: CEILING_TOP + CEILING_THICK,
    w: WALL_THICK,
    h: BEDROCK_TOP - (CEILING_TOP + CEILING_THICK),
    kind: 'platform'
  }]), ...SKY_ARCH_BLOCKS(), ...SYMMETRIC_CORNER_STAIRCASE_BLOCKS(), ...mirrorPairs(leftThickGroundWithPits), ...UNDERGROUND_THREE_LAYER_TUNNEL_SOLIDS()];
  return {
    name: '高耸方形拱桥·正中悬浮高斯枪·五据点·三层薄板竞技场',
    solids
  };
}
function SKY_ARCH_BLOCKS() {
  const S = SKY_SQUARE_SIZE;
  const leftSquares = [{
    x: 1080,
    y: 2940,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 1500,
    y: 2660,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 1920,
    y: 2380,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 2340,
    y: 2480,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 2760,
    y: 2180,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 3180,
    y: 1900,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 3600,
    y: 2000,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 4020,
    y: 1700,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 4440,
    y: 1420,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 4860,
    y: 1520,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 5280,
    y: 1240,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 5700,
    y: 1340,
    w: S,
    h: S,
    kind: 'block'
  }, {
    x: 6120,
    y: 1080,
    w: S,
    h: S,
    kind: 'block'
  }];
  return [...mirrorPairs(leftSquares), {
    x: 6470,
    y: ARCH_CENTER_TOP,
    w: S,
    h: S,
    kind: 'block'
  }];
}
function SYMMETRIC_CORNER_STAIRCASE_BLOCKS() {
  const s = STAIR_SMALL_SQUARE_SIZE;
  const leftStaircase = [{
    x: 4780,
    y: 1040,
    w: s,
    h: s,
    kind: 'block'
  }, {
    x: 4320,
    y: 860,
    w: s,
    h: s,
    kind: 'block'
  }, {
    x: 3860,
    y: 680,
    w: s,
    h: s,
    kind: 'block'
  }, {
    x: M249_LEFT_PERCH_X,
    y: M249_PERCH_Y,
    w: M249_PERCH_SIZE,
    h: M249_PERCH_SIZE,
    kind: 'block'
  }];
  return mirrorPairs(leftStaircase);
}
function UNDERGROUND_THREE_LAYER_TUNNEL_SOLIDS() {
  const leftUnderground = [{
    x: WALL_THICK,
    y: 3440,
    w: 440,
    h: 560,
    kind: 'block'
  }, {
    x: 680,
    y: 3600,
    w: 1820,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 680,
    y: 3880,
    w: 820,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 1680,
    y: 3880,
    w: 820,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 2680,
    y: 3600,
    w: 280,
    h: 400,
    kind: 'block'
  }, {
    x: 3220,
    y: 3600,
    w: 280,
    h: 400,
    kind: 'block'
  }, {
    x: 3680,
    y: 3600,
    w: 1060,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 4940,
    y: 3600,
    w: 1060,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 3680,
    y: 3880,
    w: 2320,
    h: UNDERGROUND_FLOOR_THICK,
    kind: 'platform'
  }, {
    x: 6180,
    y: MAIN_DECK_TOP,
    w: 280,
    h: 4000 - MAIN_DECK_TOP,
    kind: 'block'
  }];
  return mirrorPairs(leftUnderground);
}
function carveTunnelInSolids(solids, carve, minSize = 20) {
  const cx0 = carve.x;
  const cy0 = carve.y;
  const cx1 = carve.x + carve.w;
  const cy1 = carve.y + carve.h;
  const out = [];
  for (const s of solids) {
    const sx0 = s.x;
    const sy0 = s.y;
    const sx1 = s.x + s.w;
    const sy1 = s.y + s.h;
    if (sx1 <= cx0 || sx0 >= cx1 || sy1 <= cy0 || sy0 >= cy1) {
      out.push(s);
      continue;
    }
    if (cy0 - sy0 >= minSize) {
      out.push({
        x: sx0,
        y: sy0,
        w: s.w,
        h: cy0 - sy0,
        kind: s.kind
      });
    }
    if (sy1 - cy1 >= minSize) {
      out.push({
        x: sx0,
        y: cy1,
        w: s.w,
        h: sy1 - cy1,
        kind: s.kind
      });
    }
    const midY0 = Math.max(sy0, cy0);
    const midY1 = Math.min(sy1, cy1);
    const midH = midY1 - midY0;
    if (midH >= minSize) {
      if (cx0 - sx0 >= minSize) {
        out.push({
          x: sx0,
          y: midY0,
          w: cx0 - sx0,
          h: midH,
          kind: s.kind
        });
      }
      if (sx1 - cx1 >= minSize) {
        out.push({
          x: cx1,
          y: midY0,
          w: sx1 - cx1,
          h: midH,
          kind: s.kind
        });
      }
    }
  }
  return out;
}
function sanitizeMapData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw;
  const solidsRaw = Array.isArray(o.solids) ? o.solids : [];
  const solids = [];
  for (const s of solidsRaw) {
    if (!s || typeof s !== 'object') continue;
    const r = s;
    const x = Number(r.x),
      y = Number(r.y),
      w = Number(r.w),
      h = Number(r.h);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (w <= 0 || h <= 0) continue;
    const kind = r.kind === 'platform' || r.kind === 'block' ? r.kind : 'cover';
    solids.push({
      x,
      y,
      w,
      h,
      kind
    });
    if (solids.length >= 2000) break;
  }
  if (solids.length === 0) return null;
  return {
    name: typeof o.name === 'string' ? o.name : '自定义地图',
    solids
  };
}
    },
    "src/core/terrain.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Terrain = exports.TILE_SIZE = exports.OBSTACLE_PRESETS = exports.GRID_W = exports.GRID_H = void 0;
var _wrap = __require("src/core/wrap.ts");
var _map = __require("src/core/map.ts");
const TILE_SIZE = 20;
exports.TILE_SIZE = TILE_SIZE;
const GRID_W = Math.floor(_wrap.WORLD_W / TILE_SIZE);
exports.GRID_W = GRID_W;
const GRID_H = Math.floor(_wrap.WORLD_H / TILE_SIZE);
exports.GRID_H = GRID_H;
const UNIFIED_FILL = '#1e293b';
const UNIFIED_BORDER = _map.UNIFIED_EDGE_HIGHLIGHT;
class Terrain {
  grid = new Uint8Array(GRID_W * GRID_H);
  rects = [];
  shadows = [];
  setGridRect(x, y, w, h, val) {
    const gx0 = Math.max(0, Math.floor(x / TILE_SIZE));
    const gy0 = Math.max(0, Math.floor(y / TILE_SIZE));
    const gx1 = Math.min(GRID_W, Math.ceil((x + w) / TILE_SIZE));
    const gy1 = Math.min(GRID_H, Math.ceil((y + h) / TILE_SIZE));
    for (let gy = gy0; gy < gy1; gy++) {
      const row = gy * GRID_W;
      for (let gx = gx0; gx < gx1; gx++) this.grid[row + gx] = val;
    }
  }
  addSolidBlock(x, y, w, h, color, borderColor, kind, label = '') {
    this.setGridRect(x, y, w, h, 2);
    this.rects.push({
      x,
      y,
      w,
      h,
      color,
      borderColor,
      kind,
      label
    });
  }
  addDeco(x, y, w, h, kind, color, borderColor = '') {
    this.rects.push({
      x,
      y,
      w,
      h,
      color,
      borderColor,
      kind,
      label: ''
    });
  }
  carveTunnel(x, y, w, h, label = '地下地道') {
    this.setGridRect(x, y, w, h, 0);
    this.rects.push({
      x,
      y,
      w,
      h,
      color: '#090d16',
      borderColor: UNIFIED_BORDER,
      kind: 'tunnel_bg',
      label
    });
    this.shadows.push({
      x,
      y,
      w,
      h,
      label,
      alpha: 0.76
    });
  }
  build(customSolids) {
    this.grid.fill(0);
    this.rects.length = 0;
    this.shadows.length = 0;
    const list = customSolids ?? (0, _map.defaultMapData)().solids;
    const hasDeepUnderground = list.some(r => r.y + r.h > _wrap.SURFACE_Y);
    const earthTop = hasDeepUnderground ? _map.BEDROCK_TOP : _wrap.SURFACE_Y;
    this.addSolidBlock(0, earthTop, _wrap.WORLD_W, _wrap.WORLD_H - earthTop, UNIFIED_FILL, UNIFIED_BORDER, 'earth');
    for (const r of list) {
      const label = r.kind === 'platform' ? '平台' : r.kind === 'block' ? '方块' : '掩体';
      this.addSolidBlock(r.x, r.y, r.w, r.h, UNIFIED_FILL, UNIFIED_BORDER, 'kind' in r ? r.kind : 'block', label);
    }
  }
  isSolidAt(x, y) {
    const wx = (0, _wrap.wrapX)(x);
    const wy = (0, _wrap.wrapY)(y);
    const gx = Math.floor(wx / TILE_SIZE);
    const gy = Math.floor(wy / TILE_SIZE);
    const gyy = (gy % GRID_H + GRID_H) % GRID_H;
    if (gx >= 0 && gx < GRID_W && gyy >= 0 && gyy < GRID_H) {
      if (this.grid[gyy * GRID_W + gx] !== 0) return true;
    }
    return false;
  }
}
exports.Terrain = Terrain;
const OBSTACLE_PRESETS = [{
  id: 'obs_1',
  x: 1600,
  y: 240,
  w: 60,
  h: 80,
  hp: 260,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_2',
  x: 3400,
  y: 240,
  w: 60,
  h: 80,
  hp: 260,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_3',
  x: 4600,
  y: 240,
  w: 60,
  h: 80,
  hp: 240,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_box_1',
  x: 5400,
  y: 238,
  w: 68,
  h: 70,
  hp: 170,
  label: '重装掩体箱',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_5',
  x: 7800,
  y: 240,
  w: 60,
  h: 80,
  hp: 260,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_6',
  x: 11200,
  y: 240,
  w: 60,
  h: 80,
  hp: 260,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}, {
  id: 'obs_7',
  x: 12500,
  y: 240,
  w: 60,
  h: 80,
  hp: 260,
  label: '方形掩体',
  color: '#1e293b',
  borderColor: UNIFIED_BORDER
}];
exports.OBSTACLE_PRESETS = OBSTACLE_PRESETS;
    },
    "src/core/rng.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Rng = void 0;
exports.makeSeed = makeSeed;
class Rng {
  s;
  constructor(seed) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    this.s = this.s + 0x6d2b79f5 | 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
}
exports.Rng = Rng;
function makeSeed() {
  return Math.random() * 0xffffffff >>> 0;
}
    },
    "src/core/weapons.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WEAPONS = exports.SECONDARY_UNLOCK_ORDER = exports.SECONDARIES = exports.DEFAULT_CONFIG = void 0;
exports.formatSecondaryButtonTitle = formatSecondaryButtonTitle;
exports.formatSecondaryCardSubtitle = formatSecondaryCardSubtitle;
exports.formatWeaponAmmoText = formatWeaponAmmoText;
exports.formatWeaponCardSubtitle = formatWeaponCardSubtitle;
exports.getEffectiveUnlockStreak = getEffectiveUnlockStreak;
exports.getHighestUnlockedSecondary = getHighestUnlockedSecondary;
exports.getPlayerFragMaxCharges = getPlayerFragMaxCharges;
exports.getUnlockedSecondaries = getUnlockedSecondaries;
exports.isSecondaryUnlocked = isSecondaryUnlocked;
exports.weaponFalloff = weaponFalloff;
const WEAPONS = [{
  id: 0,
  name: '霰弹枪',
  shortName: '霰弹',
  isSupplyOnly: false,
  damage: 24,
  headshotMult: 1.0,
  pellets: 8,
  spread: 0.24,
  grazeDamageMin: 20,
  shellReload: true,
  speed: 1000,
  recoil: 1560,
  magSize: 8,
  maxReserve: 72,
  reloadTime: 1.5,
  fireDelay: 0.42,
  shellReloadFireDelayMult: 2.0714285714285716,
  terrainRadius: 12,
  explosive: false,
  pierceOnHeadshot: false,
  moveSpeedMult: 1.08,
  fuelMult: 1.05,
  fovMult: 1.0,
  color: '#fbbf24',
  falloffStart: 200,
  falloffEnd: 700,
  falloffMin: 0.45,
  traitDesc: '近距高伤 · 全中致死'
}, {
  id: 1,
  name: '突击步枪',
  shortName: '突击步枪',
  isSupplyOnly: false,
  damage: 33,
  headshotMult: 2.2,
  pellets: 1,
  spread: 0.045,
  grazeDamageMin: 27,
  speed: 1500,
  recoil: 84,
  magSize: 30,
  maxReserve: 90,
  reloadTime: 1.7,
  fireDelay: 0.12,
  terrainRadius: 8,
  explosive: false,
  pierceOnHeadshot: false,
  moveSpeedMult: 1.0,
  fuelMult: 1.0,
  fovMult: 1.0,
  color: '#38bdf8',
  traitDesc: '稳定连发 · 均衡主力'
}, {
  id: 2,
  name: '狙击步枪',
  shortName: '狙',
  isSupplyOnly: false,
  damage: 137,
  headshotMult: 2.5,
  pellets: 1,
  spread: 0.003,
  speed: 4000,
  recoil: 390,
  magSize: 10,
  maxReserve: 20,
  reloadTime: 2.8,
  fireDelay: 0.95,
  chargeSeconds: 0.50,
  terrainRadius: 16,
  explosive: false,
  laser: true,
  pierceOnHeadshot: true,
  lifeSeconds: 999,
  moveSpeedMult: 0.85,
  fuelMult: 1.0,
  ascendMult: 0.85,
  fovMult: 1.30,
  color: '#c084fc',
  edgeDamage: 99,
  grazeDamageMin: 99,
  farRange: 900,
  farDamage: 99,
  traitDesc: '无限射程 · 命中即死'
}, {
  id: 3,
  name: '火箭筒',
  shortName: '火箭筒',
  isSupplyOnly: false,
  damage: 160,
  headshotMult: 1.5,
  pellets: 1,
  spread: 0.0,
  blastFalloffExponent: 1.8,
  speed: 780,
  recoil: 420,
  magSize: 1,
  maxReserve: 20,
  reloadTime: 2.0,
  fireDelay: 0,
  terrainRadius: 124,
  explosive: true,
  gravityScale: 0,
  lifeSeconds: 999,
  rocket: true,
  pierceOnHeadshot: false,
  moveSpeedMult: 1.0,
  fuelMult: 1.0,
  ascendMult: 1.0,
  fovMult: 1.0,
  color: '#fb7185',
  friendlyFire: true,
  selfDamage: true,
  traitDesc: '直线慢速 · 碰到爆炸'
}, {
  id: 4,
  name: '高斯枪',
  shortName: '高斯枪',
  isSupplyOnly: true,
  damage: 25,
  headshotMult: 2.0,
  pellets: 1,
  spread: 0.0,
  speed: 3000,
  recoil: 0,
  magSize: 24,
  maxReserve: 48,
  reloadTime: 3.0,
  fireDelay: 0,
  terrainRadius: 18,
  explosive: false,
  laser: true,
  pierceAll: true,
  pierceOnHeadshot: true,
  bounces: 2,
  beam: true,
  friendlyFire: true,
  selfDamage: true,
  damagePerSecond: 90,
  ammoPerSecond: 6,
  moveSpeedMult: 0.95,
  fuelMult: 1.0,
  fovMult: 1.0,
  color: '#22d3ee',
  traitDesc: '即时光束 · 反射2次 · 全段自伤'
}, {
  id: 5,
  name: 'M249',
  shortName: 'M249',
  isSupplyOnly: true,
  damage: 33,
  headshotMult: 1.8,
  pellets: 1,
  spread: 0.11,
  grazeDamageMin: 27,
  speed: 1300,
  recoil: 66,
  magSize: 120,
  maxReserve: 240,
  reloadTime: 3.0,
  fireDelay: 0.06,
  terrainRadius: 8,
  explosive: false,
  pierceOnHeadshot: false,
  moveSpeedMult: 0.78,
  fuelMult: 0.7,
  fovMult: 1.30,
  color: '#f97316',
  traitDesc: '重型机枪 · 火力压制'
}, {
  id: 6,
  name: '引力枪',
  shortName: '引力枪',
  isSupplyOnly: true,
  damage: 33,
  headshotMult: 1.6,
  pellets: 1,
  spread: 0.01,
  grazeDamageMin: 27,
  speed: 1100,
  recoil: 240,
  magSize: 6,
  maxReserve: 18,
  reloadTime: 2.2,
  fireDelay: 0.9,
  terrainRadius: 130,
  lifeSeconds: 2.2,
  explosive: true,
  isGravityOrb: true,
  gravityScale: 0.02,
  passWalls: true,
  dragPerSecond: 0.7,
  friendlyFire: true,
  selfDamage: true,
  pierceOnHeadshot: false,
  moveSpeedMult: 0.86,
  fuelMult: 0.8,
  fovMult: 1.0,
  color: '#a855f7',
  falloffStart: 200,
  falloffEnd: 700,
  falloffMin: 0.12,
  traitDesc: '穿墙引力场 · 弯折弹道'
}, {
  id: 7,
  name: '手枪',
  shortName: '手枪',
  isSupplyOnly: false,
  damage: 24,
  headshotMult: 2.0,
  pellets: 1,
  spread: 0.090,
  grazeDamageMin: 20,
  speed: 1000,
  recoil: 60,
  magSize: 12,
  maxReserve: 60,
  reloadTime: 0.9,
  fireDelay: 0.17,
  terrainRadius: 6,
  explosive: false,
  gravityScale: 0.03,
  pierceOnHeadshot: false,
  moveSpeedMult: 1.50,
  fuelMult: 2.00,
  ascendMult: 1.25,
  fovMult: 1.0,
  color: '#fde047',
  traitDesc: '移速最快 · 双倍飞行'
}, {
  id: 8,
  name: '冲锋枪',
  shortName: '冲锋枪',
  extraSecondarySlot: true,
  isSupplyOnly: false,
  damage: 24,
  headshotMult: 1.8,
  pellets: 1,
  spread: 0.24,
  grazeDamageMin: 20,
  speed: 1000,
  recoil: 48,
  magSize: 30,
  maxReserve: 150,
  reloadTime: 1.2,
  fireDelay: 0.05,
  terrainRadius: 8,
  explosive: false,
  gravityScale: 0.04,
  pierceOnHeadshot: false,
  moveSpeedMult: 1.25,
  fuelMult: 1.0,
  fovMult: 1.0,
  color: '#4ade80',
  traitDesc: '极高射速 · 机动压制'
}];
exports.WEAPONS = WEAPONS;
function weaponFalloff(wep, dist, exponent = 1) {
  const start = wep.falloffStart ?? 0;
  const end = wep.falloffEnd ?? 0;
  const min = wep.falloffMin ?? 1;
  if (end <= start) return 1;
  if (dist <= start) return 1;
  if (dist >= end) return min;
  const t = Math.pow((dist - start) / (end - start), exponent);
  return 1 - (1 - min) * t;
}
const SECONDARY_UNLOCK_ORDER = ['frag', 'obstacle', 'shield', 'teleport', 'doll'];
exports.SECONDARY_UNLOCK_ORDER = SECONDARY_UNLOCK_ORDER;
const SECONDARIES = {
  frag: {
    id: 'frag',
    name: '手榴弹',
    icon: '💣',
    cd: 0.8,
    unlockStreak: 0,
    desc: '1 充能自然回复（6s/枚）'
  },
  obstacle: {
    id: 'obstacle',
    name: '障碍物',
    icon: '🧱',
    cd: 10.0,
    unlockStreak: 1,
    supplyOnly: true,
    desc: '10s冷却 · 无限生成240HP掩体'
  },
  shield: {
    id: 'shield',
    name: '护盾',
    icon: '🛡️',
    cd: 10.0,
    unlockStreak: 2,
    supplyOnly: true,
    desc: '100HP 护盾 · 伤害不溢出 · 碰撞箱略大'
  },
  teleport: {
    id: 'teleport',
    name: 'Teleport',
    icon: '🌀',
    cd: 10.0,
    unlockStreak: 3,
    supplyOnly: true,
    desc: '读条后直接出现在右键位置'
  },
  doll: {
    id: 'doll',
    name: '替身人偶',
    icon: '🎎',
    cd: 24.0,
    unlockStreak: 4,
    supplyOnly: true,
    desc: '连死4解锁或特殊补给拾取'
  }
};
exports.SECONDARIES = SECONDARIES;
function getEffectiveUnlockStreak(deathStreak, weaponIndex) {
  const base = Math.max(0, Math.floor(deathStreak ?? 0));
  const bonus = weaponIndex !== undefined && WEAPONS[weaponIndex]?.extraSecondarySlot ? 1 : 0;
  return base + bonus;
}
function getPlayerFragMaxCharges(deathStreak, baseMax = 1) {
  return Math.max(baseMax, Math.floor(deathStreak ?? 0));
}
function isSecondaryUnlocked(secId, deathStreak, dollCharges = 0, weaponIndex) {
  const def = SECONDARIES[secId];
  if (!def) return false;
  if (secId === 'doll' && dollCharges > 0) return true;
  return getEffectiveUnlockStreak(deathStreak, weaponIndex) >= def.unlockStreak;
}
function getUnlockedSecondaries(deathStreak, dollCharges = 0, weaponIndex) {
  return SECONDARY_UNLOCK_ORDER.filter(id => isSecondaryUnlocked(id, deathStreak, dollCharges, weaponIndex));
}
function getHighestUnlockedSecondary(deathStreak, dollCharges = 0, weaponIndex) {
  const s = getEffectiveUnlockStreak(deathStreak, weaponIndex);
  for (let i = SECONDARY_UNLOCK_ORDER.length - 1; i >= 0; i--) {
    const id = SECONDARY_UNLOCK_ORDER[i];
    if (s >= SECONDARIES[id].unlockStreak) return id;
  }
  if (dollCharges > 0) return 'doll';
  return 'frag';
}
const DEFAULT_CONFIG = {
  maxHp: 100,
  headRadius: 13,
  shieldHp: 100,
  shieldDuration: 5.0,
  dollDuration: 10.0,
  obstacleDefaultHp: 240,
  teleportCastTime: 0.35,
  grenadeDamage: 520,
  grenadeRadius: 100,
  grenadeFuse: 1.65,
  mineDamage: 110,
  mineTriggerRadius: 48,
  mineRespawnTime: 14,
  airstrikeDamage: 88,
  airstrikeRadius: 80,
  mortarDamage: 130,
  mortarRadius: 105,
  mortarCooldown: 2.2,
  pistolDamage: 25,
  pistolHeadshotMult: 2.0,
  captureRadius: 135,
  captureRate: 28,
  ammoPackInterval: 7.0,
  ammoPackMaxActive: 8,
  supplyRespawnTime: 22,
  watchtowerDuration: 20,
  watchtowerFovMult: 1.65,
  respawnDelay: 4.0,
  loadoutLock: true,
  randomSpawn: false,
  grenadeFriendlyFire: true,
  grenadeSelfDamage: true,
  fragMaxCharges: 1,
  fragRechargeSeconds: 6.0,
  dollMaxCharges: 2
};
exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
function formatWeaponAmmoText(w) {
  return w.pellets > 1 ? `${w.magSize}/${w.maxReserve}发(${w.pellets}丸)` : `${w.magSize}/${w.maxReserve}发`;
}
function formatWeaponCardSubtitle(w) {
  const ammo = formatWeaponAmmoText(w);
  return w.traitDesc ? `${ammo} · ${w.traitDesc}` : ammo;
}
function formatSecondaryButtonTitle(s, withSupplyTag = false) {
  if (s.unlockStreak <= 0) return `${s.icon} ${s.name} [默认]`;
  if (s.id === 'doll' && withSupplyTag) return `${s.icon} ${s.name} [连死${s.unlockStreak}/补给]`;
  return `${s.icon} ${s.name} [连死${s.unlockStreak}]`;
}
function formatSecondaryCardSubtitle(s, cfg = DEFAULT_CONFIG) {
  if (s.id === 'frag') return `${cfg.fragMaxCharges} 充能自然回复（${cfg.fragRechargeSeconds}s/枚）`;
  if (s.id === 'obstacle') return `${s.cd}s冷却 · 无限生成${cfg.obstacleDefaultHp}HP掩体`;
  if (s.id === 'shield') return `${cfg.shieldHp}HP 护盾 · 伤害不溢出 · 碰撞箱略大`;
  if (s.id === 'teleport') return '读条后直接出现在右键位置';
  if (s.id === 'doll') return `连死${s.unlockStreak}解锁或特殊补给拾取`;
  return s.desc ?? '';
}
    },
    "src/core/types.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.defaultWorldInput = defaultWorldInput;
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
    "src/core/sim/landmarks.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WATCHTOWERS = exports.WARP_PORTALS = exports.SUPPLY_SPOTS = exports.SPAWN_POINTS = exports.RANDOM_SPAWN_CANDIDATES = exports.MORTARS_INIT = exports.MINE_PRESETS = exports.MAIN_DECK_STAND = exports.M249_SKY_Y = exports.M249_SKY_X = exports.M249_RIGHT_SKY_X = exports.M249_LEFT_SKY_X = exports.JUMP_PADS = exports.HOLE_X1 = exports.HOLE_X0 = exports.GROUND_STAND = exports.GRAVITY_BOTTOM_Y = exports.GRAVITY_BOTTOM_X = exports.GAUSS_CENTER_Y = exports.GAUSS_CENTER_X = exports.FFA_SPAWN_POINTS = exports.DOLL_SUPPLY_SPOTS = exports.CP_INITS = exports.CENTER_RESPAWN_Y = exports.CENTER_RESPAWN_X = exports.CENTER_RESPAWN_POINT = exports.CEILING_STAND = exports.BODY_TOP = exports.BODY_HALF_W = exports.BODY_BOTTOM = exports.AMMO_SPOTS = void 0;
var _map = __require("src/core/map.ts");
const BODY_HALF_W = 10;
exports.BODY_HALF_W = BODY_HALF_W;
const BODY_TOP = 26;
exports.BODY_TOP = BODY_TOP;
const BODY_BOTTOM = 16;
exports.BODY_BOTTOM = BODY_BOTTOM;
const CEILING_STAND = 264;
exports.CEILING_STAND = CEILING_STAND;
const GROUND_STAND = _map.BEDROCK_TOP - 60;
exports.GROUND_STAND = GROUND_STAND;
const MAIN_DECK_STAND = _map.MAIN_DECK_TOP - 16;
exports.MAIN_DECK_STAND = MAIN_DECK_STAND;
const CENTER_RESPAWN_X = 6600;
exports.CENTER_RESPAWN_X = CENTER_RESPAWN_X;
const CENTER_RESPAWN_Y = _map.ARCH_CENTER_TOP - 16;
exports.CENTER_RESPAWN_Y = CENTER_RESPAWN_Y;
const GAUSS_CENTER_X = 6600;
exports.GAUSS_CENTER_X = GAUSS_CENTER_X;
const GAUSS_CENTER_Y = 2200;
exports.GAUSS_CENTER_Y = GAUSS_CENTER_Y;
const M249_LEFT_SKY_X = _map.M249_LEFT_PERCH_X + _map.M249_PERCH_SIZE / 2;
exports.M249_LEFT_SKY_X = M249_LEFT_SKY_X;
const M249_RIGHT_SKY_X = _map.M249_RIGHT_PERCH_X + _map.M249_PERCH_SIZE / 2;
exports.M249_RIGHT_SKY_X = M249_RIGHT_SKY_X;
const M249_SKY_X = M249_RIGHT_SKY_X;
exports.M249_SKY_X = M249_SKY_X;
const M249_SKY_Y = _map.M249_PERCH_Y - 16;
exports.M249_SKY_Y = M249_SKY_Y;
const GRAVITY_BOTTOM_X = 6600;
exports.GRAVITY_BOTTOM_X = GRAVITY_BOTTOM_X;
const GRAVITY_BOTTOM_Y = _map.BEDROCK_TOP - 16;
exports.GRAVITY_BOTTOM_Y = GRAVITY_BOTTOM_Y;
const HOLE_X0 = 6600;
exports.HOLE_X0 = HOLE_X0;
const HOLE_X1 = 6600;
exports.HOLE_X1 = HOLE_X1;
const CENTER_RESPAWN_POINT = {
  id: 'cp_c',
  code: 'C',
  name: '正中复活点',
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y
};
exports.CENTER_RESPAWN_POINT = CENTER_RESPAWN_POINT;
const FFA_SPAWN_POINTS = [{
  x: 1170,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·西翼地面'
}, {
  x: 1630,
  y: 2660 - 16,
  team: 'ffa',
  label: 'FFA·西低方岛'
}, {
  x: 2050,
  y: 2380 - 16,
  team: 'ffa',
  label: 'FFA·西中方岛'
}, {
  x: 2380,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·中西地面'
}, {
  x: 2470,
  y: 2480 - 16,
  team: 'ffa',
  label: 'FFA·西外方岛'
}, {
  x: 3310,
  y: 1900 - 16,
  team: 'ffa',
  label: 'FFA·西中拱岛'
}, {
  x: 3730,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·西中地面'
}, {
  x: 3730,
  y: 2000 - 16,
  team: 'ffa',
  label: 'FFA·西高方岛'
}, {
  x: 4210,
  y: 3600 - 16,
  team: 'ffa',
  label: 'FFA·西区上层地道'
}, {
  x: 4300,
  y: 3880 - 16,
  team: 'ffa',
  label: 'FFA·西区中层地道'
}, {
  x: 4570,
  y: 1420 - 16,
  team: 'ffa',
  label: 'FFA·中西高方岛'
}, {
  x: 5300,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·中心西地面'
}, {
  x: 7900,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·中心东地面'
}, {
  x: 8630,
  y: 1420 - 16,
  team: 'ffa',
  label: 'FFA·中东高方岛'
}, {
  x: 8900,
  y: 3880 - 16,
  team: 'ffa',
  label: 'FFA·东区中层地道'
}, {
  x: 8990,
  y: 3600 - 16,
  team: 'ffa',
  label: 'FFA·东区上层地道'
}, {
  x: 9470,
  y: 2000 - 16,
  team: 'ffa',
  label: 'FFA·东高方岛'
}, {
  x: 9470,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·东中地面'
}, {
  x: 9890,
  y: 1900 - 16,
  team: 'ffa',
  label: 'FFA·东中拱岛'
}, {
  x: 10730,
  y: 2480 - 16,
  team: 'ffa',
  label: 'FFA·东外方岛'
}, {
  x: 10820,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·中东地面'
}, {
  x: 11150,
  y: 2380 - 16,
  team: 'ffa',
  label: 'FFA·东中方岛'
}, {
  x: 11570,
  y: 2660 - 16,
  team: 'ffa',
  label: 'FFA·东低方岛'
}, {
  x: 12030,
  y: MAIN_DECK_STAND,
  team: 'ffa',
  label: 'FFA·东翼地面'
}];
exports.FFA_SPAWN_POINTS = FFA_SPAWN_POINTS;
const SPAWN_POINTS = [{
  x: 260,
  y: MAIN_DECK_STAND,
  team: 'red'
}, {
  x: 12940,
  y: MAIN_DECK_STAND,
  team: 'blue'
}, {
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y,
  team: 'green'
}, ...FFA_SPAWN_POINTS.map(({
  x,
  y,
  team
}) => ({
  x,
  y,
  team
}))];
exports.SPAWN_POINTS = SPAWN_POINTS;
const AMMO_SPOTS = [{
  x: 4950,
  y: MAIN_DECK_STAND,
  area: '中心西·主地面内侧弹药点'
}, {
  x: 4570,
  y: 1420 - 16,
  area: '中心西·中拱方岛弹药点'
}, {
  x: 5410,
  y: 1240 - 16,
  area: '中心西·内拱方岛弹药点'
}, {
  x: 6250,
  y: 1080 - 16,
  area: '正中西侧·拱顶方岛弹药点'
}, {
  x: 6950,
  y: 1080 - 16,
  area: '正中东侧·拱顶方岛弹药点'
}, {
  x: 7790,
  y: 1240 - 16,
  area: '中心东·内拱方岛弹药点'
}, {
  x: 8630,
  y: 1420 - 16,
  area: '中心东·中拱方岛弹药点'
}, {
  x: 8250,
  y: MAIN_DECK_STAND,
  area: '中心东·主地面内侧弹药点'
}, {
  x: 4200,
  y: 3600 - 16,
  area: '地下西区·一层通道弹药点'
}, {
  x: 9000,
  y: 3600 - 16,
  area: '地下东区·一层通道弹药点'
}, {
  x: 3090,
  y: 4160 - 16,
  area: '地下西区·底层通道弹药点'
}, {
  x: 10110,
  y: 4160 - 16,
  area: '地下东区·底层通道弹药点'
}];
exports.AMMO_SPOTS = AMMO_SPOTS;
const SUPPLY_SPOTS = [{
  x: 1500,
  y: CEILING_STAND,
  area: '天花板·西区补给点',
  weaponId: 4
}, {
  x: 10300,
  y: CEILING_STAND,
  area: '天花板·东区补给点',
  weaponId: 4
}, {
  x: GAUSS_CENTER_X,
  y: GAUSS_CENTER_Y,
  area: '正中空中(世界/2)·高斯枪补给点',
  weaponId: 4
}, {
  x: M249_LEFT_SKY_X,
  y: M249_SKY_Y,
  area: '左翼阶梯·天花板下M249补给点',
  weaponId: 5
}, {
  x: M249_RIGHT_SKY_X,
  y: M249_SKY_Y,
  area: '右翼阶梯·天花板下M249补给点',
  weaponId: 5
}, {
  x: GRAVITY_BOTTOM_X,
  y: GRAVITY_BOTTOM_Y,
  area: '地下中央竖井最底部·引力枪补给点',
  weaponId: 6
}];
exports.SUPPLY_SPOTS = SUPPLY_SPOTS;
const DOLL_SUPPLY_SPOTS = [{
  x: 4600,
  y: CEILING_STAND,
  area: '天花板·中央西特殊补给点'
}, {
  x: 8560,
  y: CEILING_STAND,
  area: '天花板·东区特殊补给点'
}];
exports.DOLL_SUPPLY_SPOTS = DOLL_SUPPLY_SPOTS;
const MORTARS_INIT = [{
  id: 'mortar_left',
  name: '西区迫击炮',
  x: 920,
  y: CEILING_STAND,
  angle: -Math.PI * 0.28,
  power: 24.0
}, {
  id: 'mortar_mid_w',
  name: '中央西迫击炮',
  x: 3300,
  y: CEILING_STAND,
  angle: -Math.PI * 0.30,
  power: 23.0
}, {
  id: 'mortar_center',
  name: '中央迫击炮',
  x: 5400,
  y: CEILING_STAND,
  angle: -Math.PI * 0.35,
  power: 24.5
}, {
  id: 'mortar_mid_e',
  name: '中央东迫击炮',
  x: 7800,
  y: CEILING_STAND,
  angle: -Math.PI * 0.70,
  power: 23.0
}, {
  id: 'mortar_right',
  name: '东区迫击炮',
  x: 12260,
  y: CEILING_STAND,
  angle: -Math.PI * 0.72,
  power: 24.0
}];
exports.MORTARS_INIT = MORTARS_INIT;
const MINE_PRESETS = [{
  x: 1720,
  y: CEILING_STAND
}, {
  x: 3900,
  y: CEILING_STAND
}, {
  x: 5400,
  y: CEILING_STAND
}, {
  x: 7800,
  y: CEILING_STAND
}, {
  x: 10200,
  y: CEILING_STAND
}, {
  x: 11420,
  y: CEILING_STAND
}];
exports.MINE_PRESETS = MINE_PRESETS;
const WATCHTOWERS = [{
  id: 'tower_1',
  name: '西部瞭望塔',
  x: 3700,
  y: CEILING_STAND,
  operatorId: null
}, {
  id: 'tower_2',
  name: '中西瞭望塔',
  x: 5400,
  y: CEILING_STAND,
  operatorId: null
}, {
  id: 'tower_3',
  name: '中央东瞭望塔',
  x: 7800,
  y: CEILING_STAND,
  operatorId: null
}, {
  id: 'tower_4',
  name: '东部瞭望塔',
  x: 11900,
  y: CEILING_STAND,
  operatorId: null
}];
exports.WATCHTOWERS = WATCHTOWERS;
const WARP_PORTALS = [{
  id: 'warp_1',
  name: 'W1 西区传送门',
  x: 880,
  y: CEILING_STAND,
  targetId: 'warp_2',
  color: '#06b6d4'
}, {
  id: 'warp_2',
  name: 'W2 中西传送门',
  x: 3150,
  y: CEILING_STAND,
  targetId: 'warp_1',
  color: '#06b6d4'
}, {
  id: 'warp_3',
  name: 'W3 中央传送门',
  x: 4700,
  y: CEILING_STAND,
  targetId: 'warp_4',
  color: '#a855f7'
}, {
  id: 'warp_4',
  name: 'W4 中东传送门',
  x: 10000,
  y: CEILING_STAND,
  targetId: 'warp_3',
  color: '#a855f7'
}, {
  id: 'warp_5',
  name: 'W5 中央东传送门',
  x: 5400,
  y: CEILING_STAND,
  targetId: 'warp_6',
  color: '#10b981'
}, {
  id: 'warp_6',
  name: 'W6 东区传送门',
  x: 12280,
  y: CEILING_STAND,
  targetId: 'warp_5',
  color: '#10b981'
}];
exports.WARP_PORTALS = WARP_PORTALS;
const RANDOM_SPAWN_CANDIDATES = [{
  x: 1170,
  y: MAIN_DECK_STAND - 20
}, {
  x: 1480,
  y: MAIN_DECK_STAND - 20
}, {
  x: 2100,
  y: MAIN_DECK_STAND - 20
}, {
  x: 2380,
  y: MAIN_DECK_STAND - 20
}, {
  x: 2680,
  y: MAIN_DECK_STAND - 20
}, {
  x: 3350,
  y: MAIN_DECK_STAND - 20
}, {
  x: 3730,
  y: MAIN_DECK_STAND - 20
}, {
  x: 4120,
  y: MAIN_DECK_STAND - 20
}, {
  x: 4900,
  y: MAIN_DECK_STAND - 20
}, {
  x: 5300,
  y: MAIN_DECK_STAND - 20
}, {
  x: 5720,
  y: MAIN_DECK_STAND - 20
}, {
  x: 1630,
  y: 2660 - 36
}, {
  x: 2050,
  y: 2380 - 36
}, {
  x: 2470,
  y: 2480 - 36
}, {
  x: 2890,
  y: 2180 - 36
}, {
  x: 3310,
  y: 1900 - 36
}, {
  x: 3730,
  y: 2000 - 36
}, {
  x: 4150,
  y: 1700 - 36
}, {
  x: 4570,
  y: 1420 - 36
}, {
  x: 4990,
  y: 1520 - 36
}, {
  x: 5410,
  y: 1240 - 36
}, {
  x: 5830,
  y: 1340 - 36
}, {
  x: 6250,
  y: 1080 - 36
}, {
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y - 24
}, {
  x: 6950,
  y: 1080 - 36
}, {
  x: 7370,
  y: 1340 - 36
}, {
  x: 7790,
  y: 1240 - 36
}, {
  x: 8210,
  y: 1520 - 36
}, {
  x: 8630,
  y: 1420 - 36
}, {
  x: 9050,
  y: 1700 - 36
}, {
  x: 9470,
  y: 2000 - 36
}, {
  x: 9890,
  y: 1900 - 36
}, {
  x: 10310,
  y: 2180 - 36
}, {
  x: 10730,
  y: 2480 - 36
}, {
  x: 11150,
  y: 2380 - 36
}, {
  x: 11570,
  y: 2660 - 36
}, {
  x: 7480,
  y: MAIN_DECK_STAND - 20
}, {
  x: 8300,
  y: MAIN_DECK_STAND - 20
}, {
  x: 9470,
  y: MAIN_DECK_STAND - 20
}, {
  x: 10820,
  y: MAIN_DECK_STAND - 20
}];
exports.RANDOM_SPAWN_CANDIDATES = RANDOM_SPAWN_CANDIDATES;
const JUMP_PADS = [{
  x: 1000,
  y: 280,
  vx: 210,
  vy: -810
}, {
  x: 4300,
  y: 280,
  vx: 180,
  vy: -870
}, {
  x: 10400,
  y: 280,
  vx: -180,
  vy: -870
}, {
  x: 13050,
  y: 280,
  vx: -210,
  vy: -810
}];
exports.JUMP_PADS = JUMP_PADS;
const CP_INITS = [{
  id: 'cp_a',
  code: 'A',
  name: '据点A·地下中西',
  x: 5470,
  y: 3880 - 16,
  ownerTeam: null
}, {
  id: 'cp_b',
  code: 'B',
  name: '据点B·西拱半路',
  x: 3730,
  y: 2000 - 16,
  ownerTeam: null
}, {
  id: 'cp_c',
  code: 'C',
  name: '正中复活点',
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y,
  ownerTeam: null
}, {
  id: 'cp_d',
  code: 'D',
  name: '据点D·东拱半路',
  x: 9470,
  y: 2000 - 16,
  ownerTeam: null
}, {
  id: 'cp_e',
  code: 'E',
  name: '据点E·地下中东',
  x: 7730,
  y: 3880 - 16,
  ownerTeam: null
}, {
  id: 'cp_f',
  code: 'F',
  name: '据点F·西外地面',
  x: 2380,
  y: MAIN_DECK_STAND,
  ownerTeam: null
}, {
  id: 'cp_g',
  code: 'G',
  name: '据点G·西内地面',
  x: 3730,
  y: MAIN_DECK_STAND,
  ownerTeam: null
}, {
  id: 'cp_h',
  code: 'H',
  name: '据点H·东内地面',
  x: 9470,
  y: MAIN_DECK_STAND,
  ownerTeam: null
}, {
  id: 'cp_i',
  code: 'I',
  name: '据点I·东外地面',
  x: 10820,
  y: MAIN_DECK_STAND,
  ownerTeam: null
}, {
  id: 'cp_j',
  code: 'J',
  name: '据点J·西区地道',
  x: 1590,
  y: 3600 - 16,
  ownerTeam: null
}];
exports.CP_INITS = CP_INITS;
    },
    "src/core/sim/spatial.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PLAYER_BROAD_PAD = exports.OBSTACLE_BROAD_PAD = exports.NUM_BUCKETS = exports.INV_BUCKET_SIZE = exports.BUCKET_SIZE = void 0;
exports.bucketIdx = bucketIdx;
exports.checkBodyOverlapsAt = checkBodyOverlapsAt;
exports.findObstacleAt = findObstacleAt;
exports.lineBlockedByTerrain = lineBlockedByTerrain;
exports.obstacleAtBucket = obstacleAtBucket;
exports.recordPlayerLagHistory = recordPlayerLagHistory;
exports.truncateSegmentToFree = truncateSegmentToFree;
exports.withRewoundPlayersForShooter = withRewoundPlayersForShooter;
var _terrain = __require("src/core/terrain.ts");
var _wrap = __require("src/core/wrap.ts");
const BUCKET_SIZE = 200;
exports.BUCKET_SIZE = BUCKET_SIZE;
const INV_BUCKET_SIZE = 1 / BUCKET_SIZE;
exports.INV_BUCKET_SIZE = INV_BUCKET_SIZE;
const NUM_BUCKETS = Math.ceil(_wrap.WORLD_W / BUCKET_SIZE);
exports.NUM_BUCKETS = NUM_BUCKETS;
const PLAYER_BROAD_PAD = 48;
exports.PLAYER_BROAD_PAD = PLAYER_BROAD_PAD;
const OBSTACLE_BROAD_PAD = 16;
exports.OBSTACLE_BROAD_PAD = OBSTACLE_BROAD_PAD;
function bucketIdx(wx) {
  const b = wx * INV_BUCKET_SIZE | 0;
  return b >= 0 && b < NUM_BUCKETS ? b : (b % NUM_BUCKETS + NUM_BUCKETS) % NUM_BUCKETS;
}
function obstacleAtBucket(list, wx, y, pad = 0) {
  for (let i = 0; i < list.length; i++) {
    const ob = list[i];
    if (ob.hp <= 0) continue;
    if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad) {
      const dy = (0, _wrap.wrapDeltaY)(ob.y, y);
      if (dy >= -pad && dy <= ob.h + pad) return ob;
    }
  }
  return null;
}
function findObstacleAt(obstacles, obstacleBroadBuckets, x, y, pad = 0) {
  const wx = x >= 0 && x < _wrap.WORLD_W ? x : (0, _wrap.wrapX)(x);
  if (obstacleBroadBuckets && pad <= OBSTACLE_BROAD_PAD) {
    const list = obstacleBroadBuckets[bucketIdx(wx)];
    return list && list.length > 0 ? obstacleAtBucket(list, wx, y, pad) : null;
  }
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    if (ob.hp <= 0) continue;
    const dy = (0, _wrap.wrapDeltaY)(ob.y, y);
    if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob;
  }
  return null;
}
function lineBlockedByTerrain(terrain, obstacles, obstacleBroadBuckets, x1, y1, x2, y2, rawDx, rawDy) {
  const dx = rawDx ?? (0, _wrap.wrapDeltaX)(x1, x2);
  const dy = rawDy ?? (0, _wrap.wrapDeltaY)(y1, y2);
  const dist = Math.hypot(dx, dy);
  if (dist <= 1) return false;
  const steps = Math.max(1, Math.ceil(dist / 4));
  const tGrid = terrain.grid;
  const invSteps = 1 / steps;
  const hasObs = obstacles.length > 0;
  for (let k = 1; k < steps; k++) {
    const f = k * invSteps;
    let px = x1 + dx * f;
    if (px >= _wrap.WORLD_W || px < 0) px = (0, _wrap.wrapX)(px);
    let py = y1 + dy * f;
    if (py >= _wrap.WORLD_H || py < 0) py = (0, _wrap.wrapY)(py);
    if (tGrid[(py * 0.05 | 0) * _terrain.GRID_W + (px * 0.05 | 0)] !== 0) return true;
    if (hasObs && findObstacleAt(obstacles, obstacleBroadBuckets, px, py)) return true;
  }
  return false;
}
function truncateSegmentToFree(terrain, x1, y1, _x2, _y2, rawDx, rawDy) {
  const dx = rawDx ?? (0, _wrap.wrapDeltaX)(x1, _x2);
  const dy = rawDy ?? (0, _wrap.wrapDeltaY)(y1, _y2);
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return {
    x: x1,
    y: y1,
    dx: 0,
    dy: 0,
    shortened: false
  };
  const steps = Math.max(1, Math.ceil(len / 3));
  const tGrid = terrain.grid;
  const invSteps = 1 / steps;
  let lastDx = 0;
  let lastDy = 0;
  for (let k = 1; k <= steps; k++) {
    const f = k * invSteps;
    const curDx = dx * f;
    const curDy = dy * f;
    let px = x1 + curDx;
    if (px >= _wrap.WORLD_W || px < 0) px = (0, _wrap.wrapX)(px);
    let py = y1 + curDy;
    if (py >= _wrap.WORLD_H || py < 0) py = (0, _wrap.wrapY)(py);
    if (tGrid[(py * 0.05 | 0) * _terrain.GRID_W + (px * 0.05 | 0)] !== 0) {
      return {
        x: (0, _wrap.wrapX)(x1 + lastDx),
        y: (0, _wrap.wrapY)(y1 + lastDy),
        dx: lastDx,
        dy: lastDy,
        shortened: true
      };
    }
    lastDx = curDx;
    lastDy = curDy;
  }
  return {
    x: (0, _wrap.wrapX)(x1 + dx),
    y: (0, _wrap.wrapY)(y1 + dy),
    dx,
    dy,
    shortened: false
  };
}
function checkBodyOverlapsAt(terrain, obstacles, x, y, obstacleBroadBuckets) {
  const wx = x >= 0 && x < _wrap.WORLD_W ? x : (0, _wrap.wrapX)(x);
  const halfW = 10;
  const tGrid = terrain.grid;
  const gx0 = Math.floor((wx - halfW) / _terrain.TILE_SIZE);
  const gx1 = Math.floor((wx + halfW) / _terrain.TILE_SIZE);
  const wyTop = y - 30 >= 0 && y - 30 < _wrap.WORLD_H ? y - 30 : (0, _wrap.wrapY)(y - 30);
  const wyBot = y + 16 >= 0 && y + 16 < _wrap.WORLD_H ? y + 16 : (0, _wrap.wrapY)(y + 16);
  const gy0 = Math.floor(wyTop / _terrain.TILE_SIZE);
  const gy1 = Math.floor(wyBot / _terrain.TILE_SIZE);
  for (let gx = gx0; gx <= gx1; gx++) {
    const gxx = gx >= 0 && gx < _terrain.GRID_W ? gx : (gx % _terrain.GRID_W + _terrain.GRID_W) % _terrain.GRID_W;
    for (let gy = gy0; gy <= gy1; gy++) {
      const gyy = gy >= 0 && gy < _terrain.GRID_H ? gy : (gy % _terrain.GRID_H + _terrain.GRID_H) % _terrain.GRID_H;
      if (tGrid[gyy * _terrain.GRID_W + gxx] === 0) continue;
      const cellX = gxx * _terrain.TILE_SIZE + _terrain.TILE_SIZE / 2;
      const cellY = gyy * _terrain.TILE_SIZE + _terrain.TILE_SIZE / 2;
      const lx = (0, _wrap.wrapDeltaX)(wx, cellX);
      const ly = (0, _wrap.wrapDeltaY)(y, cellY);
      const tileL = lx - _terrain.TILE_SIZE / 2;
      const tileR = lx + _terrain.TILE_SIZE / 2;
      const tileT = ly - _terrain.TILE_SIZE / 2;
      const tileB = ly + _terrain.TILE_SIZE / 2;
      if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
    }
  }
  const obList = obstacleBroadBuckets ? obstacleBroadBuckets[bucketIdx(wx)] : obstacles;
  if (obList && obList.length > 0) {
    for (let i = 0; i < obList.length; i++) {
      const ob = obList[i];
      if (ob.hp <= 0) continue;
      const dx = (0, _wrap.wrapDeltaX)(wx, ob.x + ob.w / 2);
      const dy = (0, _wrap.wrapDeltaY)(y, ob.y + ob.h / 2);
      const tileL = dx - ob.w / 2;
      const tileR = dx + ob.w / 2;
      const tileT = dy - ob.h / 2;
      const tileB = dy + ob.h / 2;
      if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
    }
  }
  return false;
}
const MAX_LAG_HISTORY_TICKS = 36;
function recordPlayerLagHistory(history, tick, players) {
  let entry;
  if (history.length >= MAX_LAG_HISTORY_TICKS) {
    entry = history.shift();
    entry.tick = tick;
    entry.positions.clear();
  } else {
    entry = {
      tick,
      positions: new Map()
    };
  }
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.deployed && p.alive && p.respawnTimer <= 0) {
      entry.positions.set(p.id, {
        x: p.pos.x,
        y: p.pos.y
      });
    }
  }
  history.push(entry);
}
function withRewoundPlayersForShooter(enabled, history, playerLagMs, shooterId, players, rebuildBuckets, fn) {
  if (!enabled || history.length === 0) return fn();
  const lagMs = playerLagMs.get(shooterId) ?? 0;
  if (lagMs < 16) return fn();
  const rewindTicks = Math.min(30, Math.max(1, Math.round(lagMs / (1000 / 60))));
  const idx = Math.max(0, history.length - 1 - rewindTicks);
  const snap = history[idx];
  if (!snap) return fn();
  const saved = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === shooterId || !p.deployed || !p.alive || p.respawnTimer > 0) continue;
    const histPos = snap.positions.get(p.id);
    if (histPos && Math.abs((0, _wrap.wrapDeltaX)(p.pos.x, histPos.x)) < 480 && Math.abs((0, _wrap.wrapDeltaY)(p.pos.y, histPos.y)) < 480) {
      saved.push({
        p,
        x: p.pos.x,
        y: p.pos.y
      });
      p.pos.x = histPos.x;
      p.pos.y = histPos.y;
    }
  }
  if (saved.length === 0) return fn();
  rebuildBuckets();
  try {
    return fn();
  } finally {
    for (let i = 0; i < saved.length; i++) {
      saved[i].p.pos.x = saved[i].x;
      saved[i].p.pos.y = saved[i].y;
    }
    rebuildBuckets();
  }
}
    },
    "src/core/sim/playerPhysics.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bodiesOverlap = bodiesOverlap;
exports.ensureFreePosition = ensureFreePosition;
exports.playerBlockingAt = playerBlockingAt;
exports.playerHitsPoint = playerHitsPoint;
exports.predictLocalPlayerStep = predictLocalPlayerStep;
exports.resolvePenetration = resolvePenetration;
exports.separateOverlappingPlayers = separateOverlappingPlayers;
exports.stepPlayerKinematic = stepPlayerKinematic;
exports.torsoBlockedAt = torsoBlockedAt;
exports.tryNudgePlayer = tryNudgePlayer;
var _physics = __require("src/core/sim/physics.ts");
var _terrain = __require("src/core/terrain.ts");
var _weapons = __require("src/core/weapons.ts");
var _wrap = __require("src/core/wrap.ts");
var _landmarks = __require("src/core/sim/landmarks.ts");
var _spatial = __require("src/core/sim/spatial.ts");
function bodiesOverlap(ax, ay, bx, by) {
  if (ay + 16 <= by - 30 || ay - 30 >= by + 16) return false;
  return Math.abs((0, _wrap.wrapDeltaX)(ax, bx)) < 20;
}
function playerHitsPoint(playerBroadBuckets, x, y, selfId, curSelfX, curSelfY, nextSelfX, nextSelfY) {
  const list = playerBroadBuckets[(0, _spatial.bucketIdx)(x)];
  if (!list || list.length === 0) return false;
  for (let i = 0; i < list.length; i++) {
    const other = list[i];
    if (other.id === selfId) continue;
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue;
    if (y <= other.pos.y - 30 || y >= other.pos.y + 16) continue;
    if (Math.abs((0, _wrap.wrapDeltaX)(x, other.pos.x)) <= 10) {
      if (curSelfX !== undefined && curSelfY !== undefined && bodiesOverlap(curSelfX, curSelfY, other.pos.x, other.pos.y)) {
        if (nextSelfX !== undefined && Math.abs((0, _wrap.wrapDeltaX)(nextSelfX, other.pos.x)) > Math.abs((0, _wrap.wrapDeltaX)(curSelfX, other.pos.x)) + 1e-4) {
          continue;
        }
        if (nextSelfY !== undefined && nextSelfY < curSelfY && curSelfY <= other.pos.y) {
          continue;
        }
      }
      return true;
    }
  }
  return false;
}
function playerBlockingAt(playerBroadBuckets, x, y, selfId) {
  const list = playerBroadBuckets[(0, _spatial.bucketIdx)(x)];
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const other = list[i];
    if (other.id === selfId) continue;
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue;
    if (bodiesOverlap(x, y, other.pos.x, other.pos.y)) return other;
  }
  return null;
}
function tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, other, dir, amount) {
  if (dir === 0) return;
  const nx = (0, _wrap.wrapX)(other.pos.x + dir * amount);
  if (terrain.isSolidAt(nx, other.pos.y - 6)) return;
  if (terrain.isSolidAt(nx, other.pos.y + 15)) return;
  if ((0, _spatial.findObstacleAt)(obstacles, obstacleBroadBuckets, nx, other.pos.y)) return;
  const list = playerBroadBuckets[(0, _spatial.bucketIdx)(nx)];
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.id === other.id) continue;
      if (!t.deployed || !t.alive || t.respawnTimer > 0) continue;
      if (bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) {
        const wasOverlapping = bodiesOverlap(other.pos.x, other.pos.y, t.pos.x, t.pos.y);
        if (!wasOverlapping) return;
        const prevDist = Math.abs((0, _wrap.wrapDeltaX)(other.pos.x, t.pos.x));
        const nextDist = Math.abs((0, _wrap.wrapDeltaX)(nx, t.pos.x));
        if (nextDist <= prevDist) return;
      }
    }
  }
  other.pos.x = nx;
}
function torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, x, y) {
  const wx = (0, _wrap.wrapX)(x);
  const checkPt = (px, py) => terrain.isSolidAt(px, py) || (0, _spatial.findObstacleAt)(obstacles, obstacleBroadBuckets, px, py) !== null;
  return checkPt(wx - 10, y - 4) || checkPt(wx + 10, y - 4) || checkPt(wx, y - 6) || checkPt(wx - 10, y - 26) || checkPt(wx + 10, y - 26) || checkPt(wx, y - 30);
}
function ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p) {
  if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, p.pos.x, p.pos.y)) return false;
  for (let r = 24; r <= 320; r += 24) {
    for (let a = 0; a < 16; a++) {
      const ang = a * Math.PI / 8;
      const x = (0, _wrap.wrapX)(p.pos.x + Math.cos(ang) * r);
      const y = (0, _wrap.wrapY)(p.pos.y + Math.sin(ang) * r);
      if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, x, y)) {
        p.pos = {
          x,
          y
        };
        p.vel = {
          x: 0,
          y: 0
        };
        return true;
      }
    }
  }
  const base = _landmarks.SPAWN_POINTS.find(s => s.team === p.team) ?? _landmarks.SPAWN_POINTS[0];
  p.pos = {
    x: (0, _wrap.wrapX)(base.x),
    y: base.y
  };
  p.vel = {
    x: 0,
    y: 0
  };
  return true;
}
function resolvePenetration(terrain, obstacles, obstacleBroadBuckets, p) {
  const halfW = 10;
  let moved = false;
  for (let iter = 0; iter < 6; iter++) {
    if (!(0, _spatial.checkBodyOverlapsAt)(terrain, obstacles, p.pos.x, p.pos.y, obstacleBroadBuckets)) break;
    const wx = (0, _wrap.wrapX)(p.pos.x);
    let bestDx = 0;
    let bestDy = 0;
    let bestLen = Infinity;
    let found = false;
    const consider = (tileL, tileR, tileT, tileB) => {
      if (!(tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16)) return;
      const d1 = tileL - halfW;
      if (Math.abs(d1) < bestLen) {
        bestLen = Math.abs(d1);
        bestDx = d1;
        bestDy = 0;
        found = true;
      }
      const d2 = tileR + halfW;
      if (Math.abs(d2) < bestLen) {
        bestLen = Math.abs(d2);
        bestDx = d2;
        bestDy = 0;
        found = true;
      }
      const d3 = tileB + 30;
      if (Math.abs(d3) < bestLen) {
        bestLen = Math.abs(d3);
        bestDx = 0;
        bestDy = d3;
        found = true;
      }
      const d4 = tileT - 16;
      if (Math.abs(d4) < bestLen) {
        bestLen = Math.abs(d4);
        bestDx = 0;
        bestDy = d4;
        found = true;
      }
    };
    const gx0 = Math.floor((wx - halfW) / _terrain.TILE_SIZE);
    const gx1 = Math.floor((wx + halfW) / _terrain.TILE_SIZE);
    const gy0 = Math.floor((0, _wrap.wrapY)(p.pos.y - 30) / _terrain.TILE_SIZE);
    const gy1 = Math.floor((0, _wrap.wrapY)(p.pos.y + 16) / _terrain.TILE_SIZE);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cellX = (0, _wrap.wrapX)(gx * _terrain.TILE_SIZE) + _terrain.TILE_SIZE / 2;
        const cellY = (0, _wrap.wrapY)(gy * _terrain.TILE_SIZE) + _terrain.TILE_SIZE / 2;
        if (!terrain.isSolidAt(cellX, cellY)) continue;
        const lx = (0, _wrap.wrapDeltaX)(wx, cellX);
        const ly = (0, _wrap.wrapDeltaY)(p.pos.y, cellY);
        consider(lx - _terrain.TILE_SIZE / 2, lx + _terrain.TILE_SIZE / 2, ly - _terrain.TILE_SIZE / 2, ly + _terrain.TILE_SIZE / 2);
      }
    }
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      if (ob.hp <= 0) continue;
      const lx = (0, _wrap.wrapDeltaX)(wx, ob.x + ob.w / 2);
      const ly = (0, _wrap.wrapDeltaY)(p.pos.y, ob.y + ob.h / 2);
      consider(lx - ob.w / 2, lx + ob.w / 2, ly - ob.h / 2, ly + ob.h / 2);
    }
    if (found) {
      p.pos.x = (0, _wrap.wrapX)(p.pos.x + bestDx);
      p.pos.y = (0, _wrap.wrapY)(p.pos.y + bestDy);
      moved = true;
    } else {
      ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p);
      moved = true;
      break;
    }
  }
  return moved;
}
function hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, x, y, curSelfX, curSelfY, nextSelfX, nextSelfY) {
  const wx = x >= 0 && x < 13200 ? x : (0, _wrap.wrapX)(x);
  const wy = y >= 0 && y < 4400 ? y : (0, _wrap.wrapY)(y);
  if (tGrid[(wy * 0.05 | 0) * _terrain.GRID_W + (wx * 0.05 | 0)] !== 0) return true;
  if ((0, _spatial.findObstacleAt)(obstacles, obstacleBroadBuckets, wx, y) !== null) return true;
  if (playerBroadBuckets) return playerHitsPoint(playerBroadBuckets, wx, y, selfId, curSelfX, curSelfY, nextSelfX, nextSelfY);
  return false;
}
function hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy, curSelfX, curSelfY) {
  return hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - _landmarks.BODY_HALF_W, cy + _landmarks.BODY_BOTTOM, curSelfX, curSelfY, cx, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + _landmarks.BODY_HALF_W, cy + _landmarks.BODY_BOTTOM, curSelfX, curSelfY, cx, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy + _landmarks.BODY_BOTTOM, curSelfX, curSelfY, cx, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - _landmarks.BODY_HALF_W, cy, curSelfX, curSelfY, cx, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + _landmarks.BODY_HALF_W, cy, curSelfX, curSelfY, cx, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy - _landmarks.BODY_TOP, curSelfX, curSelfY, cx, cy);
}
function stepPlayerKinematic(p, _w, dt, terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, mortars, watchtowers) {
  if (!p.alive || p.respawnTimer > 0) return;
  for (let i = 0; i < mortars.length; i++) {
    const mm = mortars[i];
    if (mm.operatorId === p.id) {
      p.pos = {
        x: mm.x,
        y: mm.y - 16
      };
      p.vel = {
        x: 0,
        y: 0
      };
      return;
    }
  }
  if (p.mountedTowerId) {
    for (let i = 0; i < watchtowers.length; i++) {
      const tw = watchtowers[i];
      if (tw.id === p.mountedTowerId) {
        p.pos = {
          x: tw.x,
          y: tw.y - 150 + 12
        };
        p.vel = {
          x: 0,
          y: 0
        };
        p.onGround = false;
        return;
      }
    }
  }
  (0, _physics.applyGravity)(p.vel, dt, 1);
  if (p.onGround && p.vel.y >= -20) {
    for (let i = 0; i < _landmarks.JUMP_PADS.length; i++) {
      const pad = _landmarks.JUMP_PADS[i];
      if (Math.abs(p.pos.y - pad.y) >= 34) continue;
      const d = (0, _wrap.wrapDist)(p.pos.x, p.pos.y, pad.x, pad.y);
      if (d < 34) {
        p.vel.x += pad.vx;
        p.vel.y = pad.vy;
        p.onGround = false;
      }
    }
  }
  const tGrid = terrain.grid;
  if (!p.recoilVel) p.recoilVel = {
    x: 0,
    y: 0
  };
  const rv = p.recoilVel;
  const curX = p.pos.x;
  const curY = p.pos.y;
  const nx = (0, _wrap.wrapX)(curX + p.vel.x * dt + rv.x * _physics.RECOIL_DISPLACEMENT_FACTOR);
  if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, curY, curX, curY)) {
    p.pos.x = nx;
  } else if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, curY - 10, curX, curY)) {
    p.pos.x = nx;
    p.pos.y -= 10;
  } else {
    if (playerBroadBuckets) {
      const blocker = playerBlockingAt(playerBroadBuckets, nx, curY, p.id);
      if (blocker) {
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, blocker, Math.sign((0, _wrap.wrapDeltaX)(curX, nx)), 1.4);
      }
    }
    p.vel.x = 0;
    rv.x = 0;
  }
  const vyTotal = p.vel.y + rv.y;
  const nyRaw = p.pos.y + p.vel.y * dt + rv.y * _physics.RECOIL_DISPLACEMENT_FACTOR;
  const ny = (0, _wrap.wrapY)(nyRaw);
  if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, p.pos.x, ny, p.pos.x, p.pos.y)) {
    p.pos.y = ny;
    p.onGround = false;
  } else {
    p.onGround = vyTotal > 0;
    p.vel.y = 0;
    rv.y = 0;
  }
  p.pos.x = (0, _wrap.wrapX)(p.pos.x);
  p.pos.y = (0, _wrap.wrapY)(p.pos.y);
  (0, _physics.stepRecoilVel)(rv, dt);
}
function separateOverlappingPlayers(players, playerBroadBuckets, terrain, obstacles, obstacleBroadBuckets) {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.deployed || !a.alive || a.respawnTimer > 0) continue;
    const candidates = playerBroadBuckets[(0, _spatial.bucketIdx)(a.pos.x)];
    if (!candidates) continue;
    let nudged = 0;
    for (let k = 0; k < candidates.length; k++) {
      const b = candidates[k];
      if (b.id <= a.id) continue;
      if (!b.deployed || !b.alive || b.respawnTimer > 0) continue;
      if (!bodiesOverlap(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue;
      const dx = Math.abs((0, _wrap.wrapDeltaX)(a.pos.x, b.pos.x));
      const ox = 20 - dx;
      const top = Math.max(a.pos.y - 30, b.pos.y - 30);
      const bottom = Math.min(a.pos.y + 16, b.pos.y + 16);
      const oy = bottom - top;
      if (oy > 0 && (ox <= 20 && dx <= 8 || oy <= ox)) {
        const upper = a.pos.y <= b.pos.y ? a : b;
        const upY = (0, _wrap.wrapY)(upper.pos.y - oy);
        if (!terrain.isSolidAt(upper.pos.x, upY - 26)) upper.pos.y = upY;
      } else {
        const dir = Math.sign((0, _wrap.wrapDeltaX)(a.pos.x, b.pos.x)) || (a.id < b.id ? 1 : -1);
        const pushAmt = Math.min(2.4, Math.max(0.8, ox * 0.45));
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, b, dir, pushAmt);
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, a, -dir, pushAmt);
      }
      if (++nudged >= 3) break;
    }
  }
}
function predictLocalPlayerStep(p, w, dt, terrain, obstacles = [], mortars = [], watchtowers = []) {
  if (!p.deployed || !p.alive || p.respawnTimer > 0) return;
  p.aim = w.aim;
  const wepCur = _weapons.WEAPONS[p.weaponIndex] ?? _weapons.WEAPONS[0];
  if (p.mountedTowerId) {
    p.vel.x = 0;
    p.fuel = Math.min(p.fuel, (0, _physics.getPhysicsParams)().jetpackFuel * (wepCur.fuelMult ?? 1));
  } else {
    p.vel.x = w.move * (0, _physics.getPhysicsParams)().moveSpeed * (wepCur.moveSpeedMult ?? 1);
  }
  if (w.jump && p.onGround) (0, _physics.jump)(p.vel);
  const fuelMax = (0, _physics.getPhysicsParams)().jetpackFuel * (wepCur.fuelMult ?? 1);
  const fuel = Math.min(p.fuel, fuelMax);
  const canJet = !p.mountedTowerId && w.jetpack && fuel > 0;
  if (canJet) (0, _physics.jetpack)(p.vel, dt, wepCur.ascendMult ?? 1);
  p.jetpack = canJet;
  p.fuel = (0, _physics.updateJetpackFuel)(fuel, w.jetpack, !!p.onGround, dt, fuelMax);
  stepPlayerKinematic(p, w, dt, terrain, obstacles, undefined, undefined, mortars, watchtowers);
}
    },
    "src/core/sim/projectiles.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SHIELD_HITBOX_PAD = void 0;
exports.applyGravityOrbPull = applyGravityOrbPull;
exports.calcProjectileFalloff = calcProjectileFalloff;
exports.createProjectile = createProjectile;
exports.isProjectileBodyEdgeHit = isProjectileBodyEdgeHit;
exports.projectileBodyHitQuality = projectileBodyHitQuality;
exports.stepClientProjectilesDeadReckoning = stepClientProjectilesDeadReckoning;
exports.stepProjectilesSubsystem = stepProjectilesSubsystem;
exports.updateContinuousBeam = updateContinuousBeam;
var _physics = __require("src/core/sim/physics.ts");
var _terrain = __require("src/core/terrain.ts");
var _landmarks = __require("src/core/sim/landmarks.ts");
var _weapons = __require("src/core/weapons.ts");
var _wrap = __require("src/core/wrap.ts");
var _spatial = __require("src/core/sim/spatial.ts");
const SHIELD_HITBOX_PAD = 8;
exports.SHIELD_HITBOX_PAD = SHIELD_HITBOX_PAD;
function createProjectile(id, owner, x, y, vx, vy, opts) {
  return {
    id,
    owner: owner.id,
    pos: {
      x: (0, _wrap.wrapX)(x),
      y
    },
    vel: {
      x: vx,
      y: vy
    },
    spawnX: (0, _wrap.wrapX)(x),
    spawnY: y,
    weaponId: opts.weaponId ?? -1,
    curveRate: opts.curveRate ?? 0,
    life: opts.life,
    r: opts.r,
    damage: opts.damage,
    headshotMult: opts.headshotMult,
    explosive: opts.explosive,
    terrainRadius: opts.terrainRadius,
    gravityScale: opts.gravityScale,
    pierceOnHeadshot: opts.pierceOnHeadshot ?? false,
    pierceAll: opts.pierceAll ?? false,
    isGravityOrb: opts.isGravityOrb ?? false,
    bounces: opts.bounces ?? 0,
    passWalls: opts.passWalls ?? false,
    beam: opts.beam ?? false,
    rocket: opts.rocket ?? false,
    dragPerSecond: opts.dragPerSecond ?? 1,
    weaponLabel: opts.weaponLabel,
    color: opts.color,
    hitTargets: [owner.id]
  };
}
function calcProjectileFalloff(ctx, pr, hitX, hitY) {
  if (pr.weaponId < 0) return 1;
  const wep = _weapons.WEAPONS[pr.weaponId];
  if (!wep) return 1;
  const d = (0, _wrap.wrapDist)(pr.spawnX ?? pr.pos.x, pr.spawnY ?? pr.pos.y, hitX, hitY);
  return (0, _weapons.weaponFalloff)(wep, d, ctx.config.falloffExponent);
}
function isProjectileBodyEdgeHit(rx, ry, vx, vy, bodyHalfX) {
  const spd = Math.hypot(vx, vy);
  if (spd < 1e-6) return Math.abs(rx) > 10 || ry > 13.5;
  const ux = vx / spd;
  const uy = vy / spd;
  let sMinX = -1e9;
  let sMaxX = 1e9;
  if (Math.abs(ux) > 1e-6) {
    const sx1 = (-bodyHalfX - rx) / ux;
    const sx2 = (bodyHalfX - rx) / ux;
    sMinX = Math.min(sx1, sx2);
    sMaxX = Math.max(sx1, sx2);
  }
  let sMinY = -1e9;
  let sMaxY = 1e9;
  if (Math.abs(uy) > 1e-6) {
    const sy1 = (-12 - ry) / uy;
    const sy2 = (18 - ry) / uy;
    sMinY = Math.min(sy1, sy2);
    sMaxY = Math.max(sy1, sy2);
  }
  const sEnter = Math.max(sMinX, sMinY);
  const sExit = Math.min(sMaxX, sMaxY);
  const chord = sExit - sEnter;
  const sMid = chord >= 0 ? 0.5 * (sEnter + sExit) : 0;
  const midX = Math.abs(rx + sMid * ux);
  const midY = ry + sMid * uy;
  return midX > 10 || midY > 13.5 || chord >= 0 && chord < 8;
}
function projectileBodyHitQuality(dxToCenter, dyToFeet, vx, vy, bodyHalfX) {
  const spd = Math.hypot(vx, vy);
  const TOP = -12,
    BOTTOM = 18;
  const halfY = (BOTTOM - TOP) * 0.5;
  const centerY = (BOTTOM + TOP) * 0.5;
  if (spd < 1e-6) return 1;
  const ux = vx / spd;
  const uy = vy / spd;
  let sMin = -1e9;
  let sMax = 1e9;
  const slab = (o, u, lo, hi) => {
    if (Math.abs(u) < 1e-9) return;
    const t1 = (lo - o) / u;
    const t2 = (hi - o) / u;
    sMin = Math.max(sMin, Math.min(t1, t2));
    sMax = Math.min(sMax, Math.max(t1, t2));
  };
  slab(dxToCenter, ux, -bodyHalfX, bodyHalfX);
  slab(dyToFeet, uy, TOP, BOTTOM);
  const chord = sMax - sMin;
  if (chord <= 0) return 0;
  const fullness = Math.min(1, chord / (halfY * 2));
  const midAlong = (sMin + sMax) * 0.5;
  const midY = dyToFeet + midAlong * uy;
  const midX = dxToCenter + midAlong * ux;
  const offY = Math.min(1, Math.abs(midY - centerY) / halfY);
  const offX = Math.min(1, Math.abs(midX) / Math.max(1e-6, bodyHalfX));
  const off = Math.hypot(offX, offY) / Math.SQRT2;
  const response = Math.pow(1 - off, 0.85);
  const chordFactor = 0.55 + 0.45 * fullness;
  const raw = response * chordFactor;
  return Math.max(0, Math.min(1, raw));
}
function isPointInPlayerBeamHitbox(t, px, py, baseHeadR) {
  const shieldPad = t.shieldTimer > 0 && t.shieldHp > 0 ? SHIELD_HITBOX_PAD : 0;
  const rawDy = Math.abs(t.pos.y - py);
  if (rawDy > 40 + shieldPad && rawDy < _wrap.WORLD_H - (40 + shieldPad)) return null;
  const hx = (0, _wrap.wrapDeltaX)(t.pos.x, px);
  const maxHalfX = 18 + shieldPad;
  if (hx > maxHalfX || hx < -maxHalfX) return null;
  const hy = (0, _wrap.wrapDeltaY)(t.pos.y - 24, py);
  const effHeadR = baseHeadR + shieldPad;
  const isHead = hx * hx + hy * hy <= effHeadR * effHeadR;
  const bx = Math.abs(hx);
  const by = (0, _wrap.wrapDeltaY)(t.pos.y, py);
  if (isHead || bx <= _landmarks.BODY_HALF_W + 1 + shieldPad && by >= -12 - shieldPad && by <= _landmarks.BODY_BOTTOM - 1 + shieldPad) {
    return {
      isHead
    };
  }
  return null;
}
function updateContinuousBeam(ctx, p, wep, dt) {
  if (p.respawnTimer > 0 || !p.alive) return;
  const wi = p.weaponIndex;
  if (p.reloading) return;
  if (p.ammo[wi] <= 0) {
    ctx.startReload(p);
    return;
  }
  const dps = wep.damagePerSecond ?? wep.damage * 3;
  const aps = wep.ammoPerSecond ?? 6;
  p.ammo[wi] = Math.max(0, p.ammo[wi] - aps * dt);
  if (p.ammo[wi] <= 0 && (p.reserveAmmo[wi] || 0) > 0) ctx.startReload(p);
  const segments = [];
  const hitPlayer = new Set();
  const hitObstacle = new Set();
  let dx = Math.cos(p.aim);
  let dy = Math.sin(p.aim);
  let x = 0;
  let y = 0;
  let originOk = false;
  for (let ahead = 4; ahead <= 24; ahead += 4) {
    const cx = (0, _wrap.wrapX)(p.pos.x + dx * ahead);
    const cy = (0, _wrap.wrapY)(p.pos.y - 12 + dy * ahead);
    if (ctx.terrain.isSolidAt(cx, cy) || (0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, cx, cy)) break;
    if (ahead > 4) {
      const nxProbe = (0, _wrap.wrapX)(cx + dx * 4);
      const nyProbe = (0, _wrap.wrapY)(cy + dy * 4);
      if (ctx.terrain.isSolidAt(nxProbe, nyProbe) || (0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, nxProbe, nyProbe)) break;
    }
    x = cx;
    y = cy;
    originOk = true;
  }
  if (!originOk) return;
  const step = 4;
  let bouncesLeft = wep.bounces ?? 2;
  const headR = ctx.config.headRadius + 3;
  const tGrid = ctx.terrain.grid;
  const obstacleBroadBuckets = ctx.obstacleBroadBuckets;
  const playerBroadBuckets = ctx.playerBroadBuckets;
  const obstacles = ctx.obstacles;
  let hasReflectedOrWrapped = false;
  let exitedSelf = !isPointInPlayerBeamHitbox(p, x, y, headR);
  const checkPlayersAt = (px, py, pList, segStartX, segStartY, dirX, dirY, distFromSegStart) => {
    for (let pi = 0; pi < pList.length; pi++) {
      const t = pList[pi];
      if (t.id === p.id) {
        if (!wep.selfDamage || !hasReflectedOrWrapped || !exitedSelf) continue;
      } else if (t.team === p.team && p.team !== 'ffa' && !wep.friendlyFire) {
        continue;
      }
      if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue;
      const hitInfo = isPointInPlayerBeamHitbox(t, px, py, headR);
      if (!hitInfo) continue;
      const localDist = Math.min(distFromSegStart, 64);
      const checkStartX = (0, _wrap.wrapX)(px - dirX * localDist);
      const checkStartY = (0, _wrap.wrapY)(py - dirY * localDist);
      if ((0, _spatial.lineBlockedByTerrain)(ctx.terrain, obstacles, obstacleBroadBuckets, checkStartX, checkStartY, t.pos.x, t.pos.y - 12, dirX * localDist, dirY * localDist)) continue;
      if ((0, _spatial.lineBlockedByTerrain)(ctx.terrain, obstacles, obstacleBroadBuckets, px, py, t.pos.x, t.pos.y - 12)) continue;
      hitPlayer.add(t.id);
      const mult = hitInfo.isHead ? wep.headshotMult : 1;
      ctx.damagePlayer(t, dps * mult * dt, undefined, hitInfo.isHead, false, p.id, p.team, wep.shortName);
    }
  };
  const pushBeamSegment = (x1, y1, x2, y2, rawDx, rawDy) => {
    if (Math.hypot(rawDx, rawDy) <= 1e-6) return null;
    const cut = (0, _spatial.truncateSegmentToFree)(ctx.terrain, x1, y1, x2, y2, rawDx, rawDy);
    segments.push({
      x1,
      y1,
      x2: cut.x,
      y2: cut.y,
      dx: cut.dx,
      dy: cut.dy
    });
    return cut;
  };
  let segStartX = x;
  let segStartY = y;
  let travelled = 0;
  let stepsCount = 0;
  const maxTotalSegments = Math.max(16, (wep.bounces ?? 2) + 2);
  const maxSingleSegLen = Math.ceil(Math.hypot(_wrap.WORLD_W, _wrap.WORLD_H)) + 32;
  const maxTotalSteps = Math.ceil(maxSingleSegLen * 8 / step);
  while (segments.length < maxTotalSegments && stepsCount < maxTotalSteps) {
    stepsCount++;
    const dirX = dx;
    const dirY = dy;
    const rawNx = x + dirX * step;
    const rawNy = y + dirY * step;
    const crossedSeam = rawNx < 0 || rawNx >= _wrap.WORLD_W || rawNy < 0 || rawNy >= _wrap.WORLD_H;
    const nx = crossedSeam ? (0, _wrap.wrapX)(rawNx) : rawNx;
    const ny = crossedSeam ? (0, _wrap.wrapY)(rawNy) : rawNy;
    const bIdx = nx * _spatial.INV_BUCKET_SIZE | 0;
    if (crossedSeam) {
      const gxAfter = nx * 0.05 | 0;
      const gyAfter = ny * 0.05 | 0;
      const nextIsTerrain = tGrid[gyAfter * _terrain.GRID_W + gxAfter] !== 0;
      const nextObsList = obstacleBroadBuckets[bIdx];
      const nextOb = !nextIsTerrain && nextObsList && nextObsList.length > 0 ? (0, _spatial.obstacleAtBucket)(nextObsList, nx, ny, 0) : null;
      const nextIsFree = !nextIsTerrain && !nextOb;
      if (nextIsFree) {
        bouncesLeft--;
        if (bouncesLeft <= 0) {
          if (travelled > 0) {
            pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
          }
          break;
        }
        const segLen = travelled + step;
        pushBeamSegment(segStartX, segStartY, nx, ny, dirX * segLen, dirY * segLen);
        hasReflectedOrWrapped = true;
        x = nx;
        y = ny;
        segStartX = nx;
        segStartY = ny;
        travelled = 0;
        if (!exitedSelf && !isPointInPlayerBeamHitbox(p, nx, ny, headR)) exitedSelf = true;
        const pListSeam = playerBroadBuckets[bIdx];
        if (pListSeam && pListSeam.length > 0) {
          checkPlayersAt(nx, ny, pListSeam, segStartX, segStartY, dirX, dirY, 0);
        }
        continue;
      }
      if (bouncesLeft <= 0) {
        if (travelled > 0) {
          pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
        }
        break;
      }
    }
    const gx = nx * 0.05 | 0;
    const gy = ny * 0.05 | 0;
    if (tGrid[gy * _terrain.GRID_W + gx] !== 0) {
      if (travelled > 0) {
        const cut = pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
        if (cut && cut.shortened) {
          x = cut.x;
          y = cut.y;
        }
      }
      if (bouncesLeft <= 0) break;
      bouncesLeft--;
      const prevGx = x * 0.05 | 0;
      const prevGy = y * 0.05 | 0;
      const hitX = tGrid[prevGy * _terrain.GRID_W + gx] !== 0;
      const hitY = tGrid[gy * _terrain.GRID_W + prevGx] !== 0;
      if (hitX) dx = -dx;
      if (hitY) dy = -dy;
      if (!hitX && !hitY) {
        dx = -dx;
        dy = -dy;
      }
      if (ctx.terrain.isSolidAt((0, _wrap.wrapX)(x + dx * step), (0, _wrap.wrapY)(y + dy * step))) break;
      hasReflectedOrWrapped = true;
      exitedSelf = true;
      segStartX = x;
      segStartY = y;
      travelled = 0;
      continue;
    }
    const obsList = obstacleBroadBuckets[bIdx];
    if (obsList && obsList.length > 0) {
      const ob = (0, _spatial.obstacleAtBucket)(obsList, nx, ny, 0);
      if (ob) {
        const hitX = (0, _spatial.obstacleAtBucket)([ob], nx, y, 0) !== null;
        const hitY = (0, _spatial.obstacleAtBucket)([ob], x, ny, 0) !== null;
        if (!hitObstacle.has(ob.id)) {
          hitObstacle.add(ob.id);
          ctx.damageObstacle(ob, dps * dt, undefined);
        }
        if (travelled > 0) {
          const cut = pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
          if (cut && cut.shortened) {
            x = cut.x;
            y = cut.y;
          }
        }
        if (bouncesLeft <= 0) break;
        bouncesLeft--;
        if (hitX) dx = -dx;
        if (hitY) dy = -dy;
        if (!hitX && !hitY) {
          dx = -dx;
          dy = -dy;
        }
        hasReflectedOrWrapped = true;
        exitedSelf = true;
        segStartX = x;
        segStartY = y;
        travelled = 0;
        continue;
      }
    }
    x = nx;
    y = ny;
    travelled += step;
    if (!exitedSelf && !isPointInPlayerBeamHitbox(p, nx, ny, headR)) {
      exitedSelf = true;
    }
    const pList = playerBroadBuckets[bIdx];
    if (pList && pList.length > 0) {
      checkPlayersAt(nx, ny, pList, segStartX, segStartY, dirX, dirY, travelled);
    }
  }
  ctx.events.push({
    kind: 'laser',
    x: p.pos.x,
    y: p.pos.y,
    segments,
    duration: 0.06,
    color: wep.color,
    playerId: p.id,
    weaponLabel: wep.shortName
  });
}
function applyGravityOrbPull(terrain, obstacles, activeGravityOrbs, p, dt, obstacleBroadBuckets) {
  const RANGE = 260;
  const MAX_PULL = 240;
  const MIN_RATIO = 0.35;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < activeGravityOrbs.length; i++) {
    const pr = activeGravityOrbs[i];
    if (!pr.isGravityOrb || pr.life <= 0) continue;
    const dx = (0, _wrap.wrapDeltaX)(p.pos.x, pr.pos.x);
    if (dx > RANGE || dx < -RANGE) continue;
    const dy = (0, _wrap.wrapDeltaY)(p.pos.y - 12, pr.pos.y);
    if (dy > RANGE || dy < -RANGE) continue;
    const d = Math.hypot(dx, dy);
    if (d > RANGE || d < 8) continue;
    const strength = MAX_PULL * (MIN_RATIO + (1 - MIN_RATIO) * (1 - d / RANGE));
    vx += dx / d * strength;
    vy += dy / d * strength;
  }
  if (vx === 0 && vy === 0) return;
  const tryX = (0, _wrap.wrapX)(p.pos.x + vx * dt);
  if (!(0, _spatial.checkBodyOverlapsAt)(terrain, obstacles, tryX, p.pos.y, obstacleBroadBuckets)) p.pos.x = tryX;
  const tryY = (0, _wrap.wrapY)(p.pos.y + vy * dt);
  if (!(0, _spatial.checkBodyOverlapsAt)(terrain, obstacles, p.pos.x, tryY, obstacleBroadBuckets)) p.pos.y = tryY;
}
function stepProjectilesSubsystem(ctx, dt) {
  ctx.activeGravityOrbs.length = 0;
  let writeIdx = 0;
  for (let i = 0; i < ctx.projectiles.length; i++) {
    const pr = ctx.projectiles[i];
    if (pr.damage > 0 && pr.life > 0) {
      ctx.projectiles[writeIdx++] = pr;
      if (pr.isGravityOrb && pr.life > 0) ctx.activeGravityOrbs.push(pr);
    } else {
      ctx.events.push({
        kind: 'projectile_destroy',
        projectileId: pr.id
      });
    }
  }
  ctx.projectiles.length = writeIdx;
  const g = (0, _physics.getPhysicsParams)().gravity;
  const SUBSTEP_PX = 8;
  const tGrid = ctx.terrain.grid;
  const playerBroadBuckets = ctx.playerBroadBuckets;
  const obstacleBroadBuckets = ctx.obstacleBroadBuckets;
  const hasOrbs = ctx.activeGravityOrbs.length > 0;
  for (let pi = 0; pi < ctx.projectiles.length; pi++) {
    const pr = ctx.projectiles[pi];
    if (pr.life <= 0) continue;
    if (pr.dragPerSecond < 1) {
      const k = Math.pow(pr.dragPerSecond, dt);
      pr.vel.x *= k;
      pr.vel.y *= k;
    }
    if (hasOrbs && !pr.isGravityOrb && !pr.beam) {
      const FIELD = 360;
      for (let oi = 0; oi < ctx.activeGravityOrbs.length; oi++) {
        const orb = ctx.activeGravityOrbs[oi];
        if (orb.life <= 0) continue;
        const dx = (0, _wrap.wrapDeltaX)(pr.pos.x, orb.pos.x);
        if (dx > FIELD || dx < -FIELD) continue;
        const dy = (0, _wrap.wrapDeltaY)(pr.pos.y, orb.pos.y);
        if (dy > FIELD || dy < -FIELD) continue;
        const d = Math.hypot(dx, dy);
        if (d > FIELD) continue;
        const falloff = 1 - d / FIELD;
        const cur = Math.atan2(pr.vel.y, pr.vel.x);
        const want = Math.atan2(dy, dx);
        let delta = want - cur;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const bend = Math.sign(delta) * Math.min(Math.abs(delta), (0.5 + 8.5 * falloff) * dt);
        const cosB = Math.cos(bend);
        const sinB = Math.sin(bend);
        const vx = pr.vel.x;
        const vy = pr.vel.y;
        pr.vel.x = vx * cosB - vy * sinB;
        pr.vel.y = vx * sinB + vy * cosB;
      }
    }
    pr.vel.y += g * pr.gravityScale * dt;
    pr.life -= dt;
    if (pr.life <= 0) continue;
    const dx = pr.vel.x * dt;
    const dy = pr.vel.y * dt;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / SUBSTEP_PX));
    const sx = dx / steps;
    const sy = dy / steps;
    let dead = false;
    const ownerTeam = ctx.ownerTeamOf(pr.owner);
    const wep = pr.weaponId >= 0 ? _weapons.WEAPONS[pr.weaponId] : undefined;
    const allowFF = !!wep?.friendlyFire;
    const allowSelf = !!wep?.selfDamage;
    const headHitR = ctx.config.headRadius + pr.r;
    const bodyHalfX = _landmarks.BODY_HALF_W + pr.r * 0.6;
    for (let step = 0; step < steps; step++) {
      const prevX = pr.pos.x;
      const prevY = pr.pos.y;
      let nx = prevX + sx;
      if (nx >= _wrap.WORLD_W) nx -= _wrap.WORLD_W;else if (nx < 0) nx += _wrap.WORLD_W;
      let ny = prevY + sy;
      if (ny >= _wrap.WORLD_H) ny -= _wrap.WORLD_H;else if (ny < 0) ny += _wrap.WORLD_H;
      pr.pos.x = nx;
      pr.pos.y = ny;
      const bIdx = nx * _spatial.INV_BUCKET_SIZE | 0;
      let hit = false;
      const pList = playerBroadBuckets[bIdx];
      if (pList && pList.length > 0) {
        for (let ti = 0; ti < pList.length; ti++) {
          const t = pList[ti];
          if (t.id !== pr.owner && t.team === ownerTeam && t.team !== 'ffa' && !allowFF) continue;
          if (t.id === pr.owner && !allowSelf) continue;
          if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
          const shieldPad = t.shieldTimer > 0 && t.shieldHp > 0 ? SHIELD_HITBOX_PAD : 0;
          const rawDy = Math.abs(t.pos.y - ny);
          if (rawDy > 42 + shieldPad && rawDy < _wrap.WORLD_H - (42 + shieldPad)) continue;
          if (pr.hitTargets.includes(t.id)) continue;
          const tHeadHitR = headHitR + shieldPad;
          const tHeadHitRSq = tHeadHitR * tHeadHitR;
          const tBodyHalfX = bodyHalfX + shieldPad;
          const dxHead = (0, _wrap.wrapDeltaX)(t.pos.x, nx);
          const dxBody = Math.abs(dxHead);
          if (dxBody > Math.max(tHeadHitR, tBodyHalfX)) continue;
          const dyHead = (0, _wrap.wrapDeltaY)(t.pos.y - 24, ny);
          const isRealHead = dxHead * dxHead + dyHead * dyHead <= headHitR * headHitR;
          if (isRealHead) {
            pr.hitTargets.push(t.id);
            const piercing = pr.pierceOnHeadshot || pr.pierceAll;
            if (pr.explosive) {
              ctx.explode(nx, ny, pr.terrainRadius, pr.damage * pr.headshotMult * calcProjectileFalloff(ctx, pr, nx, ny), 960, pr);
              hit = true;
            } else {
              ctx.damagePlayer(t, Math.round(pr.damage * pr.headshotMult * calcProjectileFalloff(ctx, pr, t.pos.x, t.pos.y - 24)), pr, true, piercing);
              t.vel.x += pr.vel.x * 0.12;
              t.vel.y += pr.vel.y * 0.12 - 72;
              if (!piercing) hit = true;
            }
            if (hit) break;
            continue;
          }
          const dyBody = (0, _wrap.wrapDeltaY)(t.pos.y, ny);
          const hitShieldHead = shieldPad > 0 && dxHead * dxHead + dyHead * dyHead <= tHeadHitRSq;
          const hitBodyBox = dxBody <= tBodyHalfX && dyBody >= -12 - shieldPad && dyBody <= _landmarks.BODY_BOTTOM - 1 + shieldPad;
          if (hitShieldHead || hitBodyBox) {
            pr.hitTargets.push(t.id);
            if (pr.explosive) {
              ctx.explode(nx, ny, pr.terrainRadius, pr.damage * calcProjectileFalloff(ctx, pr, nx, ny), 900, pr);
              hit = true;
            } else {
              let dmg = Math.round(pr.damage);
              if (wep?.grazeDamageMin !== undefined) {
                const q = projectileBodyHitQuality(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX);
                dmg = Math.round(wep.grazeDamageMin + (pr.damage - wep.grazeDamageMin) * q);
              } else if (wep?.edgeDamage !== undefined && isProjectileBodyEdgeHit(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)) {
                dmg = Math.min(dmg, wep.edgeDamage);
              }
              if (wep?.farRange !== undefined) {
                const owner = ctx.playerById.get(pr.owner) ?? ctx.players.find(x => x.id === pr.owner);
                if (owner) {
                  const dShot = (0, _wrap.wrapDist)(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12);
                  if (dShot > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg);
                }
              }
              dmg = Math.round(dmg * calcProjectileFalloff(ctx, pr, t.pos.x, t.pos.y - 12));
              ctx.damagePlayer(t, dmg, pr, false, false);
              t.vel.x += pr.vel.x * 0.09;
              t.vel.y += pr.vel.y * 0.09;
              if (!pr.pierceAll) hit = true;
            }
            if (hit) break;
          }
        }
      }
      if (hit) {
        dead = true;
        break;
      }
      const obsList = obstacleBroadBuckets[bIdx];
      if (obsList && obsList.length > 0) {
        const ob = (0, _spatial.obstacleAtBucket)(obsList, nx, ny, pr.r);
        if (ob) {
          if (pr.explosive) {
            ctx.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr);
            dead = true;
          } else {
            ctx.damageObstacle(ob, pr.damage, pr);
            if (!pr.pierceAll) dead = true;
          }
          if (dead) break;
        }
      }
      const gx = nx * 0.05 | 0;
      const gy = ny * 0.05 | 0;
      if (tGrid[gy * _terrain.GRID_W + gx] !== 0) {
        if (pr.passWalls) continue;
        if (pr.explosive) {
          ctx.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr);
          dead = true;
          break;
        }
        if (pr.bounces > 0) {
          const hitX = ctx.terrain.isSolidAt(nx, prevY);
          const hitY = ctx.terrain.isSolidAt(prevX, ny);
          pr.pos = {
            x: prevX,
            y: prevY
          };
          if (hitX) pr.vel.x = -pr.vel.x;
          if (hitY) pr.vel.y = -pr.vel.y;
          if (!hitX && !hitY) {
            pr.vel.x = -pr.vel.x;
            pr.vel.y = -pr.vel.y;
          }
          pr.bounces--;
          pr.hitTargets = [pr.owner];
          ctx.events.push({
            kind: 'projectile_bounce',
            projectileId: pr.id,
            playerId: pr.owner,
            weaponId: pr.weaponId,
            x: pr.pos.x,
            y: pr.pos.y,
            vx: pr.vel.x,
            vy: pr.vel.y,
            bounces: pr.bounces,
            life: pr.life
          });
          break;
        }
        dead = true;
        break;
      }
    }
    if (dead) {
      ctx.events.push({
        kind: 'projectile_destroy',
        projectileId: pr.id
      });
      pr.life = 0;
    }
  }
}
function stepClientProjectilesDeadReckoning(projectiles, dt, terrain) {
  const g = (0, _physics.getPhysicsParams)().gravity;
  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    if (pr.life <= 0) continue;
    if (pr.dragPerSecond < 1) {
      const k = Math.pow(pr.dragPerSecond, dt);
      pr.vel.x *= k;
      pr.vel.y *= k;
    }
    pr.vel.y += g * pr.gravityScale * dt;
    pr.pos.x = (0, _wrap.wrapX)(pr.pos.x + pr.vel.x * dt);
    pr.pos.y = (0, _wrap.wrapY)(pr.pos.y + pr.vel.y * dt);
    pr.life -= dt;
    if (terrain && !pr.passWalls && pr.bounces <= 0 && terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
      pr.life = 0;
    }
  }
}
    },
    "src/core/sim/throwables.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.damageObstacleInWorld = damageObstacleInWorld;
exports.damagePlayerInWorld = damagePlayerInWorld;
exports.explodeInWorld = explodeInWorld;
exports.stepExplosionsAndThrowables = stepExplosionsAndThrowables;
exports.stepPlayerTeleport = stepPlayerTeleport;
exports.useSecondaryInWorld = useSecondaryInWorld;
var _weapons = __require("src/core/weapons.ts");
var _wrap = __require("src/core/wrap.ts");
var _spatial = __require("src/core/sim/spatial.ts");
var _playerPhysics = __require("src/core/sim/playerPhysics.ts");
var _projectiles = __require("src/core/sim/projectiles.ts");
function stepPlayerTeleport(ctx, p, dt) {
  if (!p.teleportTimer || p.teleportTimer <= 0 || !p.teleportTarget) return;
  if (!p.alive || p.respawnTimer > 0 || !p.deployed) {
    p.teleportTimer = 0;
    p.teleportTarget = null;
    return;
  }
  p.teleportTimer -= dt;
  if (p.teleportTimer > 0) return;
  const target = p.teleportTarget;
  p.teleportTimer = 0;
  p.teleportTarget = null;
  const curMortar = ctx.mortars.find(m => m.operatorId === p.id);
  if (curMortar) curMortar.operatorId = null;
  if (p.mountedTowerId) {
    const tw = ctx.watchtowers.find(t => t.id === p.mountedTowerId);
    if (tw) tw.operatorId = null;
    p.mountedTowerId = null;
    p.watchtowerTimer = 0;
  }
  p.pos = {
    x: (0, _wrap.wrapX)(target.x),
    y: (0, _wrap.clamp)(target.y, 40, 4360)
  };
  if (p.vel.y > 0) p.vel.y = 0;
  (0, _playerPhysics.resolvePenetration)(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p);
  (0, _playerPhysics.ensureFreePosition)(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p);
  ctx.events.push({
    kind: 'warp',
    x: p.pos.x,
    y: p.pos.y,
    playerId: p.id,
    weaponName: 'Teleport'
  });
}
function useSecondaryInWorld(ctx, p, s) {
  if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return;
  const def = _weapons.SECONDARIES[s.type];
  if (!def) return;
  if (s.type === 'frag') {
    if (p.fragCharges <= 0) return;
    p.fragCharges--;
    p.secondaryCooldown = Math.max(p.secondaryCooldown, 0.8);
    const throwSpeed = 760;
    ctx.grenades.push({
      id: ctx.nextGrenadeId(),
      owner: p.id,
      pos: {
        x: (0, _wrap.wrapX)(p.pos.x + Math.cos(p.aim) * 20),
        y: p.pos.y - 16 + Math.sin(p.aim) * 20
      },
      vel: {
        x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25,
        y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2
      },
      fuse: ctx.config.grenadeFuse,
      bounces: 0
    });
    return;
  }
  if (s.type === 'doll') {
    if (p.dollCharges <= 0) return;
    p.dollCharges--;
    p.secondaryCooldown = def.cd;
    p.doll = {
      pos: {
        x: p.pos.x,
        y: p.pos.y
      },
      hp: p.hp,
      shieldHp: p.shieldHp,
      fuel: p.fuel,
      weaponIndex: p.weaponIndex,
      ammo: [...p.ammo],
      reserveAmmo: [...p.reserveAmmo],
      timer: ctx.config.dollDuration
    };
    ctx.events.push({
      kind: 'doll_recall',
      x: p.pos.x,
      y: p.pos.y,
      playerId: p.id,
      weaponName: 'anchor'
    });
    return;
  }
  if (!(0, _weapons.isSecondaryUnlocked)(s.type, p.deathStreak ?? 0, p.dollCharges ?? 0, p.weaponIndex) && p.secondary !== s.type) return;
  if (s.type === 'obstacle') {
    p.secondaryCooldown = def.cd;
    const w = 56;
    const h = 76;
    const dist = 76;
    const cx = (0, _wrap.wrapX)(p.pos.x + Math.cos(p.aim) * dist);
    const cy = Math.max(80, Math.min(4300 - h, p.pos.y - 16 + Math.sin(p.aim) * dist));
    const ox = (0, _wrap.wrapX)(cx - w / 2);
    let oy = cy - h / 2;
    for (let sStep = 0; sStep < 24; sStep++) {
      if (ctx.terrain.isSolidAt((0, _wrap.wrapX)(ox + w / 2), oy + h - 1) && !ctx.terrain.isSolidAt((0, _wrap.wrapX)(ox + w / 2), oy - 2)) {
        oy -= 2;
      } else break;
    }
    const obKind = 'box';
    const ob = {
      id: `p_obs_${p.id}_${ctx.nextObstacleSeq()}`,
      x: ox,
      y: oy,
      w,
      h,
      hp: ctx.config.obstacleDefaultHp,
      maxHp: ctx.config.obstacleDefaultHp,
      kind: obKind,
      color: '#334155',
      borderColor: '#38bdf8',
      label: '战术掩体'
    };
    ctx.obstacles.push(ob);
    ctx.rebuildSpatial();
    if ((0, _spatial.checkBodyOverlapsAt)(ctx.terrain, ctx.obstacles, p.pos.x, p.pos.y, ctx.obstacleBroadBuckets)) {
      (0, _playerPhysics.resolvePenetration)(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p);
      (0, _playerPhysics.ensureFreePosition)(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p);
    }
    return;
  }
  if (s.type === 'shield') {
    if (p.shieldTimer > 0 && p.shieldHp > 0) return;
    p.secondaryCooldown = def.cd;
    p.shieldHp = ctx.config.shieldHp;
    p.shieldTimer = ctx.config.shieldDuration;
    ctx.events.push({
      kind: 'shield',
      x: p.pos.x,
      y: p.pos.y,
      playerId: p.id
    });
    return;
  }
  if (s.type === 'teleport') {
    if (p.teleportTimer && p.teleportTimer > 0) return;
    p.secondaryCooldown = def.cd;
    let tx = (0, _wrap.wrapX)(p.pos.x + Math.cos(p.aim) * 280);
    let ty = (0, _wrap.clamp)(p.pos.y + Math.sin(p.aim) * 280, 40, 4360);
    if (Number.isFinite(s.targetX) && Number.isFinite(s.targetY) && (s.targetX !== 0 || s.targetY !== 0)) {
      tx = (0, _wrap.wrapX)(s.targetX);
      ty = (0, _wrap.clamp)(s.targetY, 40, 4360);
    }
    const castTime = ctx.config.teleportCastTime ?? 0.35;
    p.teleportTimer = Math.max(0.05, castTime);
    p.teleportTarget = {
      x: tx,
      y: ty
    };
    return;
  }
}
function damageObstacleInWorld(ctx, ob, dmg) {
  if (ob.hp <= 0 || dmg <= 0) return;
  ob.hp = Math.max(0, ob.hp - Math.round(dmg));
  if (ob.hp <= 0) {
    const idx = ctx.obstacles.findIndex(o => o.id === ob.id);
    if (idx >= 0) ctx.obstacles.splice(idx, 1);
    ctx.events.push({
      kind: 'explosion',
      x: ob.x,
      y: ob.y,
      radius: 28
    });
    ctx.events.push({
      kind: 'obstacle_destroy',
      obstacleId: ob.id,
      x: ob.x,
      y: ob.y
    });
  }
}
function damagePlayerInWorld(ctx, t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
  if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return;
  const atkId = attackerId ?? pr?.owner ?? 0;
  const atkTeam = attackerTeam ?? ctx.ownerTeamOf(atkId);
  const label = weaponLabel ?? pr?.weaponLabel ?? '未知';
  if (t.shieldTimer > 0 && t.shieldHp > 0) {
    const absorbed = Math.min(t.shieldHp, amount);
    t.shieldHp = Math.max(0, t.shieldHp - amount);
    ctx.events.push({
      kind: 'hit',
      x: t.pos.x,
      y: t.pos.y,
      victimId: t.id,
      attackerId: atkId,
      headshot: isHead,
      damage: absorbed,
      weaponLabel: label,
      victimTeam: t.team,
      isHeadshot: isHead,
      isPierced
    });
    ctx.onHitCount();
    if (t.shieldHp <= 0) {
      t.shieldHp = 0;
      t.shieldTimer = 0;
      ctx.events.push({
        kind: 'shield',
        x: t.pos.x,
        y: t.pos.y,
        playerId: t.id
      });
      ctx.events.push({
        kind: 'shield_break',
        x: t.pos.x,
        y: t.pos.y,
        playerId: t.id
      });
    }
    return;
  }
  t.hp -= amount;
  ctx.events.push({
    kind: 'hit',
    x: t.pos.x,
    y: t.pos.y,
    victimId: t.id,
    attackerId: atkId,
    headshot: isHead,
    damage: amount,
    weaponLabel: label,
    victimTeam: t.team,
    isHeadshot: isHead,
    isPierced
  });
  ctx.onHitCount();
  if (t.hp > 0) return;
  if (t.doll && t.doll.timer > 0) {
    ctx.recallDoll(t, 'doll_recall');
    return;
  }
  t.hp = 0;
  t.alive = false;
  t.deaths++;
  if ((t.lifeKills ?? 0) > 0) {
    t.deathStreak = 0;
    t.lifeKills = 0;
  } else {
    t.deathStreak = (t.deathStreak ?? 0) + 1;
  }
  if (!_weapons.SECONDARIES[t.secondary] || !(0, _weapons.isSecondaryUnlocked)(t.secondary, t.deathStreak, t.dollCharges, t.weaponIndex)) {
    t.secondary = 'frag';
  }
  t.respawnTimer = ctx.config.respawnDelay;
  t.shieldHp = 0;
  t.shieldTimer = 0;
  t.watchtowerTimer = 0;
  t.teleportTimer = 0;
  t.teleportTarget = null;
  const mk = ctx.mortars.find(m => m.operatorId === t.id);
  if (mk) mk.operatorId = null;
  const killer = ctx.playerById.get(atkId) ?? ctx.players.find(x => x.id === atkId);
  if (killer && atkId !== t.id) {
    killer.kills++;
    killer.lifeKills = (killer.lifeKills ?? 0) + 1;
    killer.deathStreak = 0;
    if (!_weapons.SECONDARIES[killer.secondary] || !(0, _weapons.isSecondaryUnlocked)(killer.secondary, killer.deathStreak, killer.dollCharges, killer.weaponIndex)) {
      killer.secondary = 'frag';
    }
    const killerMaxFrags = (0, _weapons.getPlayerFragMaxCharges)(killer.deathStreak, ctx.config.fragMaxCharges);
    if (killer.fragCharges > killerMaxFrags) killer.fragCharges = killerMaxFrags;
    if (ctx.scores[atkTeam] !== undefined) ctx.scores[atkTeam]++;
  }
  ctx.events.push({
    kind: 'kill',
    attackerId: atkId,
    victimId: t.id,
    weaponLabel: label,
    headshot: isHead,
    killerId: atkId,
    killerName: killer?.name ?? '战场环境',
    killerTeam: atkTeam,
    victimName: t.name,
    victimTeam: t.team,
    isHeadshot: isHead,
    isPierced,
    x: t.pos.x,
    y: t.pos.y
  });
}
function explodeInWorld(ctx, cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
  const wCx = (0, _wrap.wrapX)(cx);
  ctx.events.push({
    kind: 'explosion',
    x: wCx,
    y: cy,
    radius
  });
  for (let i = ctx.obstacles.length - 1; i >= 0; i--) {
    const ob = ctx.obstacles[i];
    const dx = (0, _wrap.wrapDeltaX)(wCx, ob.x + ob.w / 2);
    const dOb = (0, _wrap.wrapDeltaY)(ob.y, cy);
    const nearY = (0, _wrap.clamp)(dOb, 0, ob.h);
    const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY);
    if (dist <= radius * 1.25) damageObstacleInWorld(ctx, ob, maxDamage * (1 - dist / (radius * 1.25)) + 30);
  }
  const hitR = radius * 1.35;
  const atkId = ownerId ?? pr?.owner ?? 0;
  const atkTeam = ownerTeam ?? ctx.ownerTeamOf(atkId);
  const label = weaponLabel ?? pr?.weaponLabel ?? '爆炸';
  const isGrenade = label === '手榴弹';
  const srcWep = pr && pr.weaponId >= 0 ? _weapons.WEAPONS[pr.weaponId] : undefined;
  const ffAllowed = isGrenade ? ctx.config.grenadeFriendlyFire : srcWep ? srcWep.friendlyFire ?? false : false;
  const selfAllowed = isGrenade ? ctx.config.grenadeSelfDamage : srcWep ? srcWep.selfDamage ?? false : true;
  let blastExp = srcWep?.blastFalloffExponent ?? 1;
  if (!srcWep && label) {
    const byLabel = _weapons.WEAPONS.find(w => w.shortName === label || w.name === label);
    if (byLabel?.blastFalloffExponent) blastExp = byLabel.blastFalloffExponent;
  }
  for (const t of ctx.players) {
    if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
    const dx = (0, _wrap.wrapDeltaX)(wCx, t.pos.x);
    if (Math.abs(dx) > hitR) continue;
    const dy = (0, _wrap.wrapDeltaY)(cy, t.pos.y - 12);
    if (Math.abs(dy) > hitR) continue;
    const dist = Math.hypot(dx, dy);
    if (dist > hitR) continue;
    const tNorm = Math.min(1, dist / hitR);
    const falloff = Math.max(0.2, 1 - Math.pow(tNorm, blastExp));
    const nx = dist > 0.1 ? dx / dist : 0;
    const ny = dist > 0.1 ? dy / dist : -1;
    const sign = implosion ? -0.85 : 1.0;
    t.vel.x += nx * knockback * falloff * sign;
    t.vel.y += (ny * knockback - 210) * falloff * sign;
    const isSelf = t.id === atkId;
    const isTeammate = !isSelf && t.team === atkTeam && t.team !== 'ffa';
    if (isTeammate && !ffAllowed) continue;
    if (isSelf && !selfAllowed) continue;
    const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1));
    const headDist = Math.hypot(dx, (0, _wrap.wrapDeltaY)(cy, t.pos.y - 26));
    const isHead = headDist < ctx.config.headRadius * 1.6 && dist < radius * 0.6;
    damagePlayerInWorld(ctx, t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label);
  }
}
function stepExplosionsAndThrowables(ctx, dt) {
  const g0 = 1250;
  for (const g of ctx.grenades) {
    g.vel.y += g0 * 0.88 * dt;
    g.vel.x *= 0.995;
    const nx = (0, _wrap.wrapX)(g.pos.x + g.vel.x * dt);
    if (ctx.terrain.isSolidAt(nx, g.pos.y) || (0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, nx, g.pos.y)) g.vel.x *= -0.55;else g.pos.x = nx;
    const ny = g.pos.y + g.vel.y * dt;
    if (ctx.terrain.isSolidAt(g.pos.x, ny) || (0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, g.pos.x, ny)) {
      g.vel.y *= -0.45;
      g.vel.x *= 0.78;
      if (Math.abs(g.vel.y) < 72) {
        g.vel.y = 0;
        g.vel.x *= 0.88;
        if (Math.abs(g.vel.x) < 8) g.vel.x = 0;
      }
    } else g.pos.y = (0, _wrap.wrapY)(ny);
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeInWorld(ctx, g.pos.x, g.pos.y, ctx.config.grenadeRadius, ctx.config.grenadeDamage, 16 * 60, undefined, g.owner, undefined, '手榴弹');
      g.fuse = 0;
    }
  }
  for (let i = ctx.landmines.length - 1; i >= 0; i--) {
    const m = ctx.landmines[i];
    if (m.respawnTimer > 0) {
      m.respawnTimer -= dt;
      if (m.respawnTimer <= 0) {
        m.armed = true;
        m.triggered = false;
        m.fuse = 0;
        m.vel = {
          x: 0,
          y: 0
        };
      }
      continue;
    }
    if (!ctx.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !(0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, m.pos.x, m.pos.y + 8)) {
      m.vel.y += g0 * 0.86 * dt;
      const nx = (0, _wrap.wrapX)(m.pos.x + m.vel.x * dt);
      if (!ctx.terrain.isSolidAt(nx, m.pos.y) && !(0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, nx, m.pos.y)) m.pos.x = nx;else m.vel.x = -m.vel.x * 0.35;
      const ny = m.pos.y + m.vel.y * dt;
      if (!ctx.terrain.isSolidAt(m.pos.x, ny + 8) && !(0, _spatial.findObstacleAt)(ctx.obstacles, ctx.obstacleBroadBuckets, m.pos.x, ny + 8)) m.pos.y = (0, _wrap.wrapY)(ny);else {
        m.vel.y = 0;
        m.vel.x *= 0.35;
        if (Math.abs(m.vel.x) < 12) m.vel.x = 0;
      }
    } else {
      m.vel.y = 0;
      m.vel.x *= 0.5;
      if (Math.abs(m.vel.x) < 12) m.vel.x = 0;
    }
    if (m.directHit && !m.triggered) {
      const list = ctx.playerBroadBuckets[(0, _spatial.bucketIdx)(m.pos.x)];
      for (let ti = 0; ti < list.length; ti++) {
        const t = list[ti];
        if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue;
        if (t.team === ctx.ownerTeamOf(m.owner) && t.team !== 'ffa') continue;
        if ((0, _wrap.wrapDist)(m.pos.x, m.pos.y, t.pos.x, t.pos.y - 10) <= 26) {
          m.triggered = true;
          m.fuse = 0.01;
          break;
        }
      }
    }
    if (!m.armed && !m.triggered) {
      m.armTimer -= dt;
      if (m.armTimer <= 0) m.armed = true;
      continue;
    }
    if (!m.triggered) {
      for (const t of ctx.players) {
        if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
        if (!m.preset && t.id === m.owner) continue;
        if ((0, _wrap.wrapDist)(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= ctx.config.mineTriggerRadius) {
          m.triggered = true;
          m.fuse = m.instant ? 0.02 : 0.45;
          break;
        }
      }
    } else {
      m.fuse -= dt;
      if (m.fuse <= 0) {
        const label = m.instant ? '⚡瞬发地雷' : '🚨感应地雷';
        explodeInWorld(ctx, m.pos.x, m.pos.y, m.preset ? 82 : 104, m.preset ? ctx.config.mineDamage : Math.round(ctx.config.mineDamage * 1.25), 19 * 60, undefined, m.owner === 0 ? undefined : m.owner, undefined, label);
        if (m.preset) m.respawnTimer = ctx.config.mineRespawnTime;else ctx.landmines.splice(i, 1);
      }
    }
  }
  for (let i = ctx.airstrikes.length - 1; i >= 0; i--) {
    const st = ctx.airstrikes[i];
    st.timer -= dt;
    if (st.timer <= 0) {
      ctx.events.push({
        kind: 'airstrike',
        x: st.pos.x,
        y: st.pos.y
      });
      ctx.events.push({
        kind: 'airstrike_drop',
        x: st.pos.x,
        y: st.pos.y
      });
      const src = ctx.playerById.get(st.owner) ?? ctx.players.find(p => p.id === st.owner);
      for (let b = -2; b <= 2; b++) {
        const airPr = (0, _projectiles.createProjectile)(ctx.nextProjId(), src ?? {
          id: st.owner,
          pos: st.pos,
          vel: {
            x: 0,
            y: 0
          },
          aim: 0,
          team: 'ffa',
          name: '空袭'
        }, st.pos.x + b * 44, st.pos.y - 420 - Math.abs(b) * 28, ctx.rng.range(-30, 30), 900 + ctx.rng.range(0, 120), {
          damage: ctx.config.airstrikeDamage,
          headshotMult: 1.5,
          terrainRadius: ctx.config.airstrikeRadius,
          explosive: true,
          gravityScale: 0.5,
          weaponLabel: '✈️定点空袭',
          color: '#f43f5e',
          r: 7,
          life: 160 / 60
        });
        ctx.projectiles.push(airPr);
        ctx.events.push({
          kind: 'projectile_spawn',
          projectileId: airPr.id,
          playerId: st.owner,
          weaponId: -1,
          x: airPr.pos.x,
          y: airPr.pos.y,
          vx: airPr.vel.x,
          vy: airPr.vel.y,
          bounces: 0,
          life: airPr.life
        });
      }
      ctx.airstrikes.splice(i, 1);
    }
  }
}
    },
    "src/core/sim/interactables.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getNearbyInteractablePrompt = getNearbyInteractablePrompt;
exports.handlePlayerInteract = handlePlayerInteract;
exports.isCapturePointSelectable = isCapturePointSelectable;
exports.recallDollState = recallDollState;
exports.spawnSingleAmmoPack = spawnSingleAmmoPack;
exports.stepMapInteractables = stepMapInteractables;
var _physics = __require("src/core/sim/physics.ts");
var _weapons = __require("src/core/weapons.ts");
var _wrap = __require("src/core/wrap.ts");
var _landmarks = __require("src/core/sim/landmarks.ts");
function isCapturePointSelectable(cp, team) {
  if (!cp) return false;
  if (cp.ownerTeam === null || cp.progress < 100) return false;
  return cp.ownerTeam === team || team === 'ffa';
}
function getNearbyInteractablePrompt(ctx, p, pendingSpawnId) {
  if (!p.deployed || !p.alive || p.respawnTimer > 0) return null;
  const mountedMortar = ctx.mortars.find(m => m.operatorId === p.id);
  if (mountedMortar) {
    return {
      canInteract: true,
      shortLabel: '🎯 [E] 离开炮台',
      bannerText: '🎯 迫击炮操控中：拖动瞄准调节落点，开火发射 | 按 [E] 或点击此处离开'
    };
  }
  if (p.mountedTowerId) {
    return {
      canInteract: true,
      shortLabel: '🗼 [E] 下瞭望塔',
      bannerText: '🗼 瞭望塔上（视野 200%）：按 [E] 或点击此处下塔'
    };
  }
  for (const crate of ctx.supplyCrates) {
    if (crate.active && (0, _wrap.wrapDist)(p.pos.x, p.pos.y, crate.x, crate.y) < 95) {
      return {
        canInteract: true,
        shortLabel: `📦 [E] 拾取${crate.weaponName.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')}`,
        bannerText: `📦 靠近特武箱：按 [E] 或直接触碰拾取【${crate.weaponName}】`
      };
    }
  }
  const maxCpDist = Math.max(150, ctx.config.captureRadius + 35);
  let nearestCp = null;
  let nearestCpDist = Infinity;
  for (const cp of ctx.capturePoints) {
    if (cp.y <= 400) continue;
    if (Math.abs((0, _wrap.wrapDeltaY)(p.pos.y, cp.y)) > 115) continue;
    const d = (0, _wrap.wrapDist)(p.pos.x, p.pos.y, cp.x, cp.y);
    if (d < maxCpDist && d < nearestCpDist) {
      nearestCpDist = d;
      nearestCp = cp;
    }
  }
  if (nearestCp) {
    if (isCapturePointSelectable(nearestCp, p.team)) {
      const isSel = p.selectedSpawnId === nearestCp.id || pendingSpawnId === nearestCp.id;
      return {
        canInteract: !isSel,
        shortLabel: isSel ? `✅ 已选 ${nearestCp.code}点` : `🚩 [E] 选${nearestCp.code}复活`,
        bannerText: isSel ? `✅ 已选中【${nearestCp.name}】作为复活点（阵亡后将在此处复活）` : `🚩 按 [E] 或点击按钮选中【${nearestCp.name}】作为复活点`
      };
    }
    const curTeam = nearestCp.progress > 0 ? nearestCp.ownerTeam ?? nearestCp.capturingTeam : null;
    const isNeutralizing = curTeam !== null && curTeam !== p.team;
    return {
      canInteract: false,
      shortLabel: `🚩 占领${nearestCp.code} ${Math.round(nearestCp.progress)}%`,
      bannerText: isNeutralizing ? `🚩 正在夺取【${nearestCp.name}】(敌方进度 ${Math.round(nearestCp.progress)}% → 0% 后转为己方占领)` : `🚩 正在占领【${nearestCp.name}】(${Math.round(nearestCp.progress)}% → 100%) · 占领后可按 [E] 选为复活点`
    };
  }
  for (const m of ctx.mortars) {
    if (m.operatorId === null && (0, _wrap.wrapDist)(p.pos.x, p.pos.y, m.x, m.y) < 115) {
      return {
        canInteract: true,
        shortLabel: '🔥 [E] 操控迫击炮',
        bannerText: `🔥 按 [E] 或点击按钮操控【${m.name}】`
      };
    }
  }
  for (const tw of ctx.watchtowers) {
    if (tw.operatorId === null && (0, _wrap.wrapDist)(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
      return {
        canInteract: true,
        shortLabel: '🗼 [E] 登瞭望塔',
        bannerText: `🗼 按 [E] 或点击按钮登上【${tw.name}】（享 200% 视野）`
      };
    }
  }
  for (const wp of ctx.warpPortals) {
    if ((0, _wrap.wrapDist)(p.pos.x, p.pos.y, wp.x, wp.y) < 90) {
      return {
        canInteract: true,
        shortLabel: '🌀 [E] 量子传送',
        bannerText: `🌀 按 [E] 或点击按钮启动【${wp.name}】量子传送`
      };
    }
  }
  return null;
}
function recallDollState(events, p) {
  if (!p.doll) return;
  const d = p.doll;
  p.doll = null;
  p.pos = {
    x: (0, _wrap.wrapX)(d.pos.x),
    y: d.pos.y
  };
  p.vel = {
    x: 0,
    y: 0
  };
  p.hp = Math.max(1, d.hp);
  p.shieldHp = d.shieldHp;
  p.fuel = d.fuel;
  p.weaponIndex = d.weaponIndex;
  if (_weapons.WEAPONS[d.weaponIndex] && !_weapons.WEAPONS[d.weaponIndex].isSupplyOnly) p.lastPrimaryIndex = d.weaponIndex;
  p.ammo = [...d.ammo];
  p.reserveAmmo = [...d.reserveAmmo];
  p.respawnTimer = 0;
  p.alive = true;
  events.push({
    kind: 'doll_recall',
    x: p.pos.x,
    y: p.pos.y,
    playerId: p.id
  });
}
function handlePlayerInteract(ctx, p) {
  if (p.respawnTimer > 0 || !p.alive) return;
  const cur = ctx.mortars.find(m => m.operatorId === p.id);
  if (cur) {
    cur.operatorId = null;
    p.vel.y = -270;
    return;
  }
  for (const m of ctx.mortars) {
    if (m.operatorId === null && (0, _wrap.wrapDist)(p.pos.x, p.pos.y, m.x, m.y) < 115) {
      m.operatorId = p.id;
      p.pos = {
        x: m.x,
        y: m.y - 16
      };
      p.vel = {
        x: 0,
        y: 0
      };
      return;
    }
  }
  if (p.mountedTowerId) {
    const tw = ctx.watchtowers.find(t => t.id === p.mountedTowerId);
    if (tw) tw.operatorId = null;
    p.mountedTowerId = null;
    p.watchtowerTimer = 0;
    p.vel = {
      x: 0,
      y: -160
    };
    ctx.events.push({
      kind: 'warp',
      x: p.pos.x,
      y: p.pos.y,
      playerId: p.id,
      weaponName: '离开瞭望塔'
    });
    return;
  }
  for (const tw of ctx.watchtowers) {
    if (tw.operatorId === null && (0, _wrap.wrapDist)(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
      tw.operatorId = tw.id ? p.id : p.id;
      p.mountedTowerId = tw.id;
      p.pos = {
        x: tw.x,
        y: tw.y - 150 + 12
      };
      p.vel = {
        x: 0,
        y: 0
      };
      p.onGround = false;
      ctx.events.push({
        kind: 'warp',
        x: tw.x,
        y: tw.y,
        playerId: p.id,
        weaponName: `登上${tw.name}（视野 200%）`
      });
      return;
    }
  }
  for (const wp of ctx.warpPortals) {
    if ((0, _wrap.wrapDist)(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
      const dest = ctx.warpPortals.find(w => w.id === wp.targetId);
      if (!dest) continue;
      p.pos = {
        x: dest.x,
        y: dest.y - 60
      };
      p.vel = {
        x: 0,
        y: 0
      };
      p.warpCooldown = 2.5;
      ctx.events.push({
        kind: 'warp',
        x: dest.x,
        y: dest.y,
        playerId: p.id,
        weaponName: wp.name
      });
      return;
    }
  }
  for (const crate of ctx.supplyCrates) {
    if (!crate.active) continue;
    if ((0, _wrap.wrapDist)(p.pos.x, p.pos.y, crate.x, crate.y) < 95) {
      crate.active = false;
      crate.respawnTimer = ctx.config.supplyRespawnTime;
      if (crate.kind === 'doll') {
        p.dollCharges = Math.min(ctx.config.dollMaxCharges, p.dollCharges + 1);
      } else {
        p.weaponIndex = crate.weaponId;
        p.fuel = Math.min(p.fuel, (0, _physics.getPhysicsParams)().jetpackFuel * (_weapons.WEAPONS[crate.weaponId].fuelMult ?? 1));
        p.ammo[crate.weaponId] = _weapons.WEAPONS[crate.weaponId].magSize;
        p.reserveAmmo[crate.weaponId] = _weapons.WEAPONS[crate.weaponId].maxReserve;
      }
      ctx.events.push({
        kind: 'supply_pickup',
        playerId: p.id,
        playerName: p.name,
        weaponId: crate.kind === 'doll' ? -1 : crate.weaponId,
        weaponName: crate.weaponName,
        x: crate.x,
        y: crate.y
      });
      return;
    }
  }
  const maxSelectDist = Math.max(150, ctx.config.captureRadius + 35);
  let targetCp = null;
  let bestDist = Infinity;
  for (const cp of ctx.capturePoints) {
    if (cp.y <= 400) continue;
    if (!isCapturePointSelectable(cp, p.team)) continue;
    if (Math.abs((0, _wrap.wrapDeltaY)(p.pos.y, cp.y)) > 115) continue;
    const d = (0, _wrap.wrapDist)(p.pos.x, p.pos.y, cp.x, cp.y);
    if (d < maxSelectDist && d < bestDist) {
      bestDist = d;
      targetCp = cp;
    }
  }
  if (targetCp) {
    p.selectedSpawnId = targetCp.id;
    ctx.events.push({
      kind: 'warp',
      x: targetCp.x,
      y: targetCp.y,
      playerId: p.id,
      pointCode: targetCp.code,
      weaponName: `已选中【${targetCp.name}】作为复活点`
    });
  }
}
function spawnSingleAmmoPack(ctx) {
  if (ctx.ammoPacks.length >= ctx.config.ammoPackMaxActive) return;
  const available = [];
  for (let i = 0; i < _landmarks.AMMO_SPOTS.length; i++) {
    if (!ctx.ammoPacks.some(a => a.x === _landmarks.AMMO_SPOTS[i].x)) available.push(i);
  }
  if (available.length === 0) return;
  const spot = _landmarks.AMMO_SPOTS[ctx.rng.pick(available)];
  ctx.ammoPacks.push({
    id: ctx.nextAmmoId(),
    x: spot.x,
    y: spot.y,
    area: spot.area
  });
}
function stepMapInteractables(ctx, dt) {
  const capR = Math.max(150, ctx.config.captureRadius + 35);
  const capRSq = capR * capR;
  for (let ci = 0; ci < ctx.capturePoints.length; ci++) {
    const cp = ctx.capturePoints[ci];
    if (cp.y <= 400) continue;
    let cRed = 0,
      cBlue = 0,
      cGreen = 0,
      cFfa = 0;
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i];
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
      const dx = Math.abs((0, _wrap.wrapDeltaX)(p.pos.x, cp.x));
      if (dx >= capR) continue;
      const dy = (0, _wrap.wrapDeltaY)(cp.y, p.pos.y);
      if (dy > 28 || dy < -115) continue;
      if (dx * dx + dy * dy < capRSq) {
        if (p.team === 'red') cRed++;else if (p.team === 'blue') cBlue++;else if (p.team === 'green') cGreen++;else cFfa++;
      }
    }
    let topTeam = null;
    let topCount = 0;
    let secondCount = 0;
    const considerTeam = (tm, cnt) => {
      if (cnt <= 0) return;
      if (cnt > topCount) {
        secondCount = topCount;
        topCount = cnt;
        topTeam = tm;
      } else if (cnt > secondCount) {
        secondCount = cnt;
      }
    };
    considerTeam('red', cRed);
    considerTeam('blue', cBlue);
    considerTeam('green', cGreen);
    considerTeam('ffa', cFfa);
    if (topTeam !== null) {
      const t = topTeam;
      const netCount = topCount - secondCount;
      if (netCount > 0) {
        const delta = ctx.config.captureRate * dt * netCount;
        const curTeam = cp.progress > 0 ? cp.ownerTeam ?? cp.capturingTeam : null;
        if (curTeam !== null && curTeam !== t) {
          cp.capturingTeam = curTeam;
          if (cp.progress > delta) {
            cp.progress -= delta;
          } else {
            const overflow = delta - cp.progress;
            cp.ownerTeam = null;
            if (overflow > 0) {
              cp.capturingTeam = t;
              cp.progress = Math.min(100, overflow);
              if (cp.progress >= 100) {
                cp.progress = 100;
                cp.ownerTeam = t;
                ctx.events.push({
                  kind: 'capture',
                  pointCode: cp.code,
                  team: t,
                  x: cp.x,
                  y: cp.y
                });
              }
            } else {
              cp.capturingTeam = null;
              cp.progress = 0;
            }
          }
        } else if (cp.ownerTeam !== t || cp.progress < 100) {
          cp.capturingTeam = t;
          cp.progress += delta;
          if (cp.progress >= 100) {
            cp.progress = 100;
            const newlyCaptured = cp.ownerTeam !== t;
            cp.ownerTeam = t;
            cp.capturingTeam = t;
            if (newlyCaptured) {
              ctx.events.push({
                kind: 'capture',
                pointCode: cp.code,
                team: t,
                x: cp.x,
                y: cp.y
              });
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < ctx.mortars.length; i++) {
    const m = ctx.mortars[i];
    if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt);
  }
  for (let ci = 0; ci < ctx.supplyCrates.length; ci++) {
    const crate = ctx.supplyCrates[ci];
    if (!crate.active && crate.respawnTimer > 0) {
      crate.respawnTimer -= dt;
      if (crate.respawnTimer <= 0) crate.active = true;
    }
    if (!crate.active) continue;
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i];
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
      if (Math.abs((0, _wrap.wrapDeltaX)(p.pos.x, crate.x)) >= 56 || Math.abs(p.pos.y - crate.y) >= 56) continue;
      if ((0, _wrap.wrapDist)(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
        crate.active = false;
        crate.respawnTimer = ctx.config.supplyRespawnTime;
        if (crate.kind === 'doll') {
          p.dollCharges = Math.min(ctx.config.dollMaxCharges, p.dollCharges + 1);
        } else {
          p.weaponIndex = crate.weaponId;
          p.fuel = Math.min(p.fuel, (0, _physics.getPhysicsParams)().jetpackFuel * (_weapons.WEAPONS[crate.weaponId].fuelMult ?? 1));
          p.ammo[crate.weaponId] = _weapons.WEAPONS[crate.weaponId].magSize;
          p.reserveAmmo[crate.weaponId] = _weapons.WEAPONS[crate.weaponId].maxReserve;
        }
        ctx.events.push({
          kind: 'supply_pickup',
          playerId: p.id,
          playerName: p.name,
          weaponId: crate.kind === 'doll' ? -1 : crate.weaponId,
          weaponName: crate.weaponName,
          x: crate.x,
          y: crate.y
        });
        break;
      }
    }
  }
  let timer = ctx.getAmmoTimer() + dt;
  if (timer >= ctx.config.ammoPackInterval) {
    timer = 0;
    spawnSingleAmmoPack(ctx);
  }
  ctx.setAmmoTimer(timer);
  for (let i = ctx.ammoPacks.length - 1; i >= 0; i--) {
    const pack = ctx.ammoPacks[i];
    for (let pi = 0; pi < ctx.players.length; pi++) {
      const p = ctx.players[pi];
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
      if (Math.abs((0, _wrap.wrapDeltaX)(p.pos.x, pack.x)) >= 52 || Math.abs(p.pos.y - pack.y) >= 52) continue;
      if ((0, _wrap.wrapDist)(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
        const wep = _weapons.WEAPONS[p.weaponIndex];
        p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve);
        ctx.ammoPacks.splice(i, 1);
        ctx.events.push({
          kind: 'ammo_pickup',
          playerId: p.id,
          x: pack.x,
          y: pack.y
        });
        break;
      }
    }
  }
}
    },
    "src/core/sim/world.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "AMMO_SPOTS", {
  enumerable: true,
  get: function () {
    return _landmarks.AMMO_SPOTS;
  }
});
Object.defineProperty(exports, "CENTER_RESPAWN_POINT", {
  enumerable: true,
  get: function () {
    return _landmarks.CENTER_RESPAWN_POINT;
  }
});
Object.defineProperty(exports, "FFA_SPAWN_POINTS", {
  enumerable: true,
  get: function () {
    return _landmarks.FFA_SPAWN_POINTS;
  }
});
Object.defineProperty(exports, "GAUSS_CENTER_X", {
  enumerable: true,
  get: function () {
    return _landmarks.GAUSS_CENTER_X;
  }
});
Object.defineProperty(exports, "GAUSS_CENTER_Y", {
  enumerable: true,
  get: function () {
    return _landmarks.GAUSS_CENTER_Y;
  }
});
Object.defineProperty(exports, "GRAVITY_BOTTOM_X", {
  enumerable: true,
  get: function () {
    return _landmarks.GRAVITY_BOTTOM_X;
  }
});
Object.defineProperty(exports, "GRAVITY_BOTTOM_Y", {
  enumerable: true,
  get: function () {
    return _landmarks.GRAVITY_BOTTOM_Y;
  }
});
Object.defineProperty(exports, "JUMP_PADS", {
  enumerable: true,
  get: function () {
    return _landmarks.JUMP_PADS;
  }
});
Object.defineProperty(exports, "M249_SKY_X", {
  enumerable: true,
  get: function () {
    return _landmarks.M249_SKY_X;
  }
});
Object.defineProperty(exports, "M249_SKY_Y", {
  enumerable: true,
  get: function () {
    return _landmarks.M249_SKY_Y;
  }
});
Object.defineProperty(exports, "SPAWN_POINTS", {
  enumerable: true,
  get: function () {
    return _landmarks.SPAWN_POINTS;
  }
});
Object.defineProperty(exports, "SUPPLY_SPOTS", {
  enumerable: true,
  get: function () {
    return _landmarks.SUPPLY_SPOTS;
  }
});
exports.World = void 0;
Object.defineProperty(exports, "getNearbyInteractablePrompt", {
  enumerable: true,
  get: function () {
    return _interactables.getNearbyInteractablePrompt;
  }
});
Object.defineProperty(exports, "isCapturePointSelectable", {
  enumerable: true,
  get: function () {
    return _interactables.isCapturePointSelectable;
  }
});
var _physics = __require("src/core/sim/physics.ts");
var _terrain = __require("src/core/terrain.ts");
var _rng = __require("src/core/rng.ts");
var _weapons = __require("src/core/weapons.ts");
var _wrap = __require("src/core/wrap.ts");
var _types = __require("src/core/types.ts");
var _landmarks = __require("src/core/sim/landmarks.ts");
var _spatial = __require("src/core/sim/spatial.ts");
var _playerPhysics = __require("src/core/sim/playerPhysics.ts");
var _projectiles = __require("src/core/sim/projectiles.ts");
var _throwables = __require("src/core/sim/throwables.ts");
var _interactables = __require("src/core/sim/interactables.ts");
class World {
  terrain = new _terrain.Terrain();
  players = [];
  projectiles = [];
  grenades = [];
  landmines = [];
  airstrikes = [];
  obstacles = [];
  capturePoints = [];
  ammoPacks = [];
  supplyCrates = [];
  mortars = [];
  watchtowers = _landmarks.WATCHTOWERS.map(t => ({
    ...t
  }));
  warpPortals = _landmarks.WARP_PORTALS;
  scores = {
    red: 0,
    blue: 0,
    green: 0,
    ffa: 0
  };
  events = [];
  config = {
    ..._weapons.DEFAULT_CONFIG
  };
  rng;
  seed;
  tick = 0;
  hits = 0;
  mapName;
  pid = 1;
  prj = 1;
  gren = 1;
  obsSeq = 1;
  mineSeq = 1;
  ammo = 1;
  crate = 1;
  ammoSpawnTimer = 0;
  stuckTicks = new Map();
  playerBroadBuckets = Array.from({
    length: _spatial.NUM_BUCKETS
  }, () => []);
  obstacleBroadBuckets = Array.from({
    length: _spatial.NUM_BUCKETS
  }, () => []);
  playerById = new Map();
  activeGravityOrbs = [];
  lagHistory = [];
  playerLagMs = new Map();
  lagCompensationEnabled = true;
  setPlayerLagMs(playerId, lagMs) {
    this.playerLagMs.set(playerId, Math.max(0, Math.min(400, lagMs)));
  }
  constructor(seed = 12345, map) {
    this.seed = seed;
    this.rng = new _rng.Rng(seed);
    this.mapName = map?.name;
    this.terrain.build(map?.solids);
    this.resetMatch();
  }
  nextProjId() {
    return this.prj++;
  }
  nextGrenadeId() {
    return this.gren++;
  }
  nextObstacleSeq() {
    return this.obsSeq++;
  }
  nextMineId() {
    return this.mineSeq++;
  }
  nextAmmoId() {
    return this.ammo++;
  }
  getAmmoTimer() {
    return this.ammoSpawnTimer;
  }
  setAmmoTimer(t) {
    this.ammoSpawnTimer = t;
  }
  rebuildSpatial() {
    this.rebuildSpatialBuckets();
  }
  onHitCount() {
    this.hits++;
  }
  ownerTeamOf(id) {
    return (this.playerById.get(id) ?? this.players.find(p => p.id === id))?.team ?? 'ffa';
  }
  recallDoll(p) {
    (0, _interactables.recallDollState)(this.events, p);
  }
  damagePlayer(t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
    (0, _throwables.damagePlayerInWorld)(this, t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel);
  }
  damageObstacle(ob, dmg) {
    (0, _throwables.damageObstacleInWorld)(this, ob, dmg);
  }
  explode(cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
    (0, _throwables.explodeInWorld)(this, cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion);
  }
  startReload(p) {
    const wep = _weapons.WEAPONS[p.weaponIndex];
    if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return;
    if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return;
    p.reloading = true;
    p.reloadTimer = wep.shellReload ? wep.reloadTime / Math.max(1, wep.magSize) : wep.reloadTime;
  }
  rebuildSpatialBuckets() {
    for (let i = 0; i < _spatial.NUM_BUCKETS; i++) {
      this.playerBroadBuckets[i].length = 0;
      this.obstacleBroadBuckets[i].length = 0;
    }
    this.playerById.clear();
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      this.playerById.set(p.id, p);
      if (!p.deployed || !p.alive || p.respawnTimer > 0) continue;
      const wx = (0, _wrap.wrapX)(p.pos.x);
      const b0 = (0, _spatial.bucketIdx)((0, _wrap.wrapX)(wx - _spatial.PLAYER_BROAD_PAD));
      const b1 = (0, _spatial.bucketIdx)((0, _wrap.wrapX)(wx + _spatial.PLAYER_BROAD_PAD));
      this.playerBroadBuckets[b0].push(p);
      if (b1 !== b0) this.playerBroadBuckets[b1].push(p);
    }
    for (let i = 0; i < this.obstacles.length; i++) {
      const ob = this.obstacles[i];
      if (ob.hp <= 0) continue;
      const startX = ob.x - _spatial.OBSTACLE_BROAD_PAD;
      const endX = ob.x + ob.w + _spatial.OBSTACLE_BROAD_PAD;
      const steps = Math.ceil((endX - startX) * _spatial.INV_BUCKET_SIZE) + 1;
      let prevB = -1;
      for (let s = 0; s <= steps; s++) {
        const px = Math.min(endX, startX + s * _spatial.BUCKET_SIZE);
        const b = (0, _spatial.bucketIdx)((0, _wrap.wrapX)(px));
        if (b !== prevB) {
          if (!this.obstacleBroadBuckets[b].includes(ob)) this.obstacleBroadBuckets[b].push(ob);
          prevB = b;
        }
      }
    }
  }
  rebuildPlayerBucketsOnly() {
    for (let i = 0; i < _spatial.NUM_BUCKETS; i++) this.playerBroadBuckets[i].length = 0;
    this.playerById.clear();
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      this.playerById.set(p.id, p);
      if (!p.deployed || !p.alive || p.respawnTimer > 0) continue;
      const wx = (0, _wrap.wrapX)(p.pos.x);
      const b0 = (0, _spatial.bucketIdx)((0, _wrap.wrapX)(wx - _spatial.PLAYER_BROAD_PAD));
      const b1 = (0, _spatial.bucketIdx)((0, _wrap.wrapX)(wx + _spatial.PLAYER_BROAD_PAD));
      this.playerBroadBuckets[b0].push(p);
      if (b1 !== b0) this.playerBroadBuckets[b1].push(p);
    }
  }
  resetMatch() {
    this.obsSeq = 1;
    this.mineSeq = 1;
    if (this.lagHistory) this.lagHistory.length = 0;
    this.obstacles = _terrain.OBSTACLE_PRESETS.map(o => ({
      ...o,
      maxHp: o.hp
    }));
    this.capturePoints = _landmarks.CP_INITS.map(c => ({
      ...c,
      progress: c.ownerTeam ? 100 : 0,
      capturingTeam: null
    }));
    this.mortars = _landmarks.MORTARS_INIT.map(m => ({
      ...m,
      cooldown: 0,
      operatorId: null
    }));
    this.watchtowers = _landmarks.WATCHTOWERS.map(t => ({
      ...t,
      operatorId: null
    }));
    this.landmines = _landmarks.MINE_PRESETS.map((m, i) => ({
      id: -(i + 1),
      owner: 0,
      pos: {
        x: m.x,
        y: m.y
      },
      vel: {
        x: 0,
        y: 0
      },
      armed: true,
      armTimer: 0,
      triggered: false,
      fuse: 0,
      instant: false,
      directHit: false,
      preset: true,
      respawnTimer: 0
    }));
    const isIsolatedWeaponTestArena = Boolean(this.mapName && (this.mapName.startsWith('sniper-') || this.mapName.startsWith('shell-') || this.mapName.startsWith('cs-pump')));
    this.supplyCrates = [..._landmarks.SUPPLY_SPOTS.map((spot, idx) => {
      const w = _weapons.WEAPONS[spot.weaponId ?? 4 + idx % 3];
      const hideForUnitTest = isIsolatedWeaponTestArena && spot.x === _landmarks.GAUSS_CENTER_X && spot.y === _landmarks.GAUSS_CENTER_Y;
      return {
        id: this.crate++,
        x: spot.x,
        y: spot.y,
        area: spot.area,
        kind: 'weapon',
        weaponId: w.id,
        weaponName: w.name,
        color: w.color,
        active: !hideForUnitTest,
        respawnTimer: hideForUnitTest ? 9999 : 0
      };
    }), ..._landmarks.DOLL_SUPPLY_SPOTS.map(spot => ({
      id: this.crate++,
      x: spot.x,
      y: spot.y,
      area: spot.area,
      kind: 'doll',
      weaponId: -1,
      weaponName: '🎎 替身人偶（特殊补给）',
      color: '#f472b6',
      active: true,
      respawnTimer: 0
    }))];
    this.ammoPacks = [];
    for (let i = 0; i < Math.min(7, this.config.ammoPackMaxActive); i++) (0, _interactables.spawnSingleAmmoPack)(this);
    this.projectiles = [];
    this.grenades = [];
    this.airstrikes = [];
    this.ammoSpawnTimer = 0;
    this.scores = {
      red: 0,
      blue: 0,
      green: 0,
      ffa: 0
    };
    for (const p of this.players) p.selectedSpawnId = 'base';
    this.rebuildSpatialBuckets();
  }
  addPlayer(name = 'Player', team = 'ffa') {
    const p = {
      id: this.pid++,
      pos: {
        x: 6600,
        y: 2380
      },
      vel: {
        x: 0,
        y: 0
      },
      aim: 0,
      team,
      name,
      hp: this.config.maxHp,
      maxHp: this.config.maxHp,
      alive: true,
      deployed: true,
      onGround: true,
      selectedSpawnId: 'base',
      weaponIndex: 1,
      lastPrimaryIndex: 1,
      ammo: _weapons.WEAPONS.map(w => w.magSize),
      reserveAmmo: _weapons.WEAPONS.map(w => w.maxReserve),
      reloading: false,
      reloadTimer: 0,
      fireCooldown: 0,
      chargeTimer: 0,
      secondary: 'frag',
      secondaryCooldown: 0,
      fragCharges: _weapons.DEFAULT_CONFIG.fragMaxCharges,
      fragRechargeTimer: 0,
      jetpack: false,
      fuel: (0, _physics.getPhysicsParams)().jetpackFuel,
      shieldHp: 0,
      shieldTimer: 0,
      watchtowerTimer: 0,
      mountedTowerId: null,
      warpCooldown: 0,
      teleportTimer: 0,
      teleportTarget: null,
      doll: null,
      dollCharges: 0,
      respawnTimer: 0,
      kills: 0,
      deaths: 0,
      lifeKills: 0,
      deathStreak: 0
    };
    this.respawnAt(p, team);
    this.players.push(p);
    this.playerById.set(p.id, p);
    return p;
  }
  deploy(p) {
    this.respawnAt(p, p.team);
  }
  respawnAt(p, team) {
    const cur = _weapons.WEAPONS[p.weaponIndex];
    const lastIdx = p.lastPrimaryIndex ?? p.weaponIndex;
    if (!cur || cur.isSupplyOnly) {
      const fallback = _weapons.WEAPONS[lastIdx] && !_weapons.WEAPONS[lastIdx].isSupplyOnly ? lastIdx : 0;
      p.weaponIndex = fallback;
      p.lastPrimaryIndex = fallback;
    } else {
      p.lastPrimaryIndex = p.weaponIndex;
    }
    let sx, sy;
    const wantedCp = p.selectedSpawnId && p.selectedSpawnId !== 'base' ? this.capturePoints.find(c => c.id === p.selectedSpawnId && (0, _interactables.isCapturePointSelectable)(c, team)) : null;
    if (wantedCp) {
      sx = wantedCp.x;
      sy = wantedCp.y;
    } else if (this.config.randomSpawn) {
      const spot = _landmarks.RANDOM_SPAWN_CANDIDATES[this.rng.int(_landmarks.RANDOM_SPAWN_CANDIDATES.length)];
      sx = spot.x + this.rng.range(-45, 45);
      sy = spot.y;
    } else if (team === "ffa") {
      const spot = _landmarks.FFA_SPAWN_POINTS[this.rng.int(_landmarks.FFA_SPAWN_POINTS.length)];
      sx = spot.x;
      sy = spot.y;
    } else {
      if (team === "red" || team === "blue" || team === "green") this.rng.int(1);
      const base = _landmarks.SPAWN_POINTS.find(s => s.team === team) ?? _landmarks.SPAWN_POINTS[0];
      sx = base.x;
      sy = base.y;
    }
    p.pos = {
      x: (0, _wrap.wrapX)(sx + this.rng.range(-45, 45)),
      y: sy
    };
    p.vel = {
      x: 0,
      y: 0
    };
    p.hp = this.config.maxHp;
    p.ammo = _weapons.WEAPONS.map(w => w.magSize);
    p.reserveAmmo = _weapons.WEAPONS.map(w => w.maxReserve);
    const streak = p.deathStreak ?? 0;
    p.fragCharges = (0, _weapons.getPlayerFragMaxCharges)(streak, this.config.fragMaxCharges);
    p.fragRechargeTimer = 0;
    p.fuel = (0, _physics.getPhysicsParams)().jetpackFuel * (_weapons.WEAPONS[p.weaponIndex]?.fuelMult ?? 1);
    p.shieldHp = 0;
    p.shieldTimer = 0;
    p.watchtowerTimer = 0;
    p.mountedTowerId = null;
    p.warpCooldown = 0;
    p.teleportTimer = 0;
    p.teleportTarget = null;
    p.doll = null;
    p.dollCharges = streak + (_weapons.WEAPONS[p.weaponIndex]?.extraSecondarySlot ? 1 : 0) >= _weapons.SECONDARIES.doll.unlockStreak ? 1 : 0;
    if (!_weapons.SECONDARIES[p.secondary] || !(0, _weapons.isSecondaryUnlocked)(p.secondary, streak, p.dollCharges, p.weaponIndex)) {
      p.secondary = 'frag';
    }
    p.reloading = false;
    p.fireCooldown = 0;
    p.chargeTimer = 0;
    p.chargeAim = undefined;
    p.secondaryCooldown = 0;
    p.lifeKills = 0;
    p.deployed = true;
    p.alive = true;
    p.respawnTimer = 0;
    (0, _playerPhysics.resolvePenetration)(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
    (0, _playerPhysics.ensureFreePosition)(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
  }
  step(dt, inputs) {
    this.tick++;
    this.events.length = 0;
    this.rebuildSpatialBuckets();
    this.activeGravityOrbs.length = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (pr.isGravityOrb && pr.life > 0 && pr.damage > 0) this.activeGravityOrbs.push(pr);
    }
    for (const p of this.players) {
      const w = inputs.get(p.id) ?? (0, _types.defaultWorldInput)();
      this.applyPlayerInput(p, w, dt);
      if (p.deployed) {
        (0, _playerPhysics.stepPlayerKinematic)(p, w, dt, this.terrain, this.obstacles, this.obstacleBroadBuckets, this.playerBroadBuckets, this.mortars, this.watchtowers);
        if (p.alive && p.respawnTimer <= 0 && this.activeGravityOrbs.length > 0) {
          (0, _projectiles.applyGravityOrbPull)(this.terrain, this.obstacles, this.activeGravityOrbs, p, dt, this.obstacleBroadBuckets);
        }
      }
      if (p.deployed && p.alive) {
        if (this.bodyOverlapsAt(p.pos.x, p.pos.y)) {
          const fixed = (0, _playerPhysics.resolvePenetration)(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
          if (fixed) {
            p.vel.x = 0;
            p.vel.y = 0;
          }
          const n = (this.stuckTicks.get(p.id) ?? 0) + 1;
          this.stuckTicks.set(p.id, n);
          if (n >= 20) {
            (0, _playerPhysics.ensureFreePosition)(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
            this.stuckTicks.set(p.id, 0);
          }
        } else {
          this.stuckTicks.set(p.id, 0);
        }
      }
    }
    this.rebuildPlayerBucketsOnly();
    if (this.lagCompensationEnabled && this.playerLagMs.size > 0) (0, _spatial.recordPlayerLagHistory)(this.lagHistory, this.tick, this.players);
    (0, _playerPhysics.separateOverlappingPlayers)(this.players, this.playerBroadBuckets, this.terrain, this.obstacles, this.obstacleBroadBuckets);
    this.rebuildPlayerBucketsOnly();
    (0, _projectiles.stepProjectilesSubsystem)(this, dt);
    (0, _throwables.stepExplosionsAndThrowables)(this, dt);
    (0, _interactables.stepMapInteractables)(this, dt);
    let pw = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (pr.life > 0 && pr.damage > 0) {
        this.projectiles[pw++] = pr;
      } else if (!this.events.some(e => e.kind === 'projectile_destroy' && e.projectileId === pr.id)) {
        this.events.push({
          kind: 'projectile_destroy',
          projectileId: pr.id
        });
      }
    }
    this.projectiles.length = pw;
    let gw = 0;
    for (let i = 0; i < this.grenades.length; i++) {
      if (this.grenades[i].fuse > 0) this.grenades[gw++] = this.grenades[i];
    }
    this.grenades.length = gw;
  }
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
  bodyOverlapsAt(x, y) {
    return (0, _spatial.checkBodyOverlapsAt)(this.terrain, this.obstacles, x, y, this.obstacleBroadBuckets);
  }
  applyPlayerInput(p, w, dt) {
    if (!p.deployed) return;
    if (p.respawnTimer > 0) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) this.respawnAt(p, p.team);
      return;
    }
    if (!p.alive) return;
    if (w.switchWeapon !== null && w.switchWeapon !== p.weaponIndex) {
      const wep = _weapons.WEAPONS[w.switchWeapon];
      const canSwitch = !this.config.loadoutLock || p.respawnTimer > 0 || !p.deployed;
      if (wep && !wep.isSupplyOnly && canSwitch) {
        p.weaponIndex = wep.id;
        p.lastPrimaryIndex = wep.id;
        if (!(0, _weapons.isSecondaryUnlocked)(p.secondary, p.deathStreak ?? 0, p.dollCharges, p.weaponIndex)) p.secondary = 'frag';
        p.fuel = Math.min(p.fuel, (0, _physics.getPhysicsParams)().jetpackFuel * (wep.fuelMult ?? 1));
        p.reloading = false;
        p.reloadTimer = 0;
        p.fireCooldown = Math.max(p.fireCooldown, 0.3);
      }
    }
    const charging = p.chargeTimer > 0 && p.chargeAim !== undefined && !w.trackChargeAim;
    p.aim = charging ? p.chargeAim : w.aim;
    const wepCur = _weapons.WEAPONS[p.weaponIndex] ?? _weapons.WEAPONS[0];
    if (p.mountedTowerId) {
      p.vel.x = 0;
      p.fuel = Math.min(p.fuel, (0, _physics.getPhysicsParams)().jetpackFuel * (wepCur.fuelMult ?? 1));
    } else {
      p.vel.x = w.move * (0, _physics.getPhysicsParams)().moveSpeed * (wepCur.moveSpeedMult ?? 1);
    }
    if (w.jump && p.onGround) (0, _physics.jump)(p.vel);
    const fuelMax = (0, _physics.getPhysicsParams)().jetpackFuel * (wepCur.fuelMult ?? 1);
    const fuel = Math.min(p.fuel, fuelMax);
    const canJet = !p.mountedTowerId && w.jetpack && fuel > 0;
    if (canJet) (0, _physics.jetpack)(p.vel, dt, wepCur.ascendMult ?? 1);
    p.jetpack = canJet;
    p.fuel = (0, _physics.updateJetpackFuel)(fuel, w.jetpack, !!p.onGround, dt, fuelMax);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt);
    const maxFrags = (0, _weapons.getPlayerFragMaxCharges)(p.deathStreak ?? 0, this.config.fragMaxCharges);
    if (p.fragCharges < maxFrags) {
      p.fragRechargeTimer += dt;
      if (p.fragRechargeTimer >= this.config.fragRechargeSeconds) {
        p.fragRechargeTimer -= this.config.fragRechargeSeconds;
        p.fragCharges = Math.min(maxFrags, p.fragCharges + 1);
      }
    } else p.fragRechargeTimer = 0;
    if (p.shieldTimer > 0) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) {
        p.shieldTimer = 0;
        p.shieldHp = 0;
      }
    }
    if (p.watchtowerTimer > 0) p.watchtowerTimer = Math.max(0, p.watchtowerTimer - dt);
    if (p.warpCooldown > 0) p.warpCooldown = Math.max(0, p.warpCooldown - dt);
    (0, _throwables.stepPlayerTeleport)(this, p, dt);
    if (w.fire && wepCur.shellReload && p.reloading && p.ammo[p.weaponIndex] > 0) {
      p.reloading = false;
      p.reloadTimer = 0;
    }
    if (p.reloading) {
      if (!wepCur.shellReload || p.fireCooldown <= 0) {
        p.reloadTimer -= dt;
      }
      if (p.reloadTimer <= 0) {
        const wep = _weapons.WEAPONS[p.weaponIndex];
        const avail = p.reserveAmmo[p.weaponIndex] || 0;
        if (wep.shellReload) {
          if (avail > 0 && p.ammo[p.weaponIndex] < wep.magSize) {
            p.ammo[p.weaponIndex] += 1;
            p.reserveAmmo[p.weaponIndex] = avail - 1;
          }
          const stillNeeds = p.ammo[p.weaponIndex] < wep.magSize && (p.reserveAmmo[p.weaponIndex] || 0) > 0;
          if (stillNeeds) {
            p.reloadTimer = wep.reloadTime / Math.max(1, wep.magSize);
          } else {
            p.reloading = false;
            p.reloadTimer = 0;
          }
        } else {
          p.reloading = false;
          p.reloadTimer = 0;
          const needed = wep.magSize - p.ammo[p.weaponIndex];
          const transfer = Math.min(needed, avail);
          p.ammo[p.weaponIndex] += transfer;
          p.reserveAmmo[p.weaponIndex] = avail - transfer;
        }
      }
    }
    if (w.reload && !w.fire) this.startReload(p);
    if (p.doll) {
      p.doll.timer -= dt;
      if (p.doll.timer <= 0) (0, _interactables.recallDollState)(this.events, p);
    }
    const mountedNow = this.mortars.find(m => m.operatorId === p.id);
    if (mountedNow) {
      let a = p.aim;
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12;
      mountedNow.angle = a;
    }
    if (w.interact) (0, _interactables.handlePlayerInteract)(this, p);
    if (w.secondary) (0, _throwables.useSecondaryInWorld)(this, p, w.secondary);
    const wepNow = _weapons.WEAPONS[p.weaponIndex];
    if (wepNow?.beam) {
      if (w.fire) (0, _spatial.withRewoundPlayersForShooter)(this.lagCompensationEnabled, this.lagHistory, this.playerLagMs, p.id, this.players, () => this.rebuildPlayerBucketsOnly(), () => (0, _projectiles.updateContinuousBeam)(this, p, wepNow, dt));
      p.chargeTimer = 0;
    } else if ((wepNow?.chargeSeconds ?? 0) > 0) {
      const firePressed = w.fire && !p.prevFireHeld;
      if (firePressed && p.chargeTimer <= 0 && p.fireCooldown <= 0) {
        if (p.ammo[p.weaponIndex] > 0) {
          p.chargeAim = p.aim;
          p.chargeTimer = 1e-4;
        } else if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) {
          this.startReload(p);
        }
      }
      if (p.chargeTimer > 0) {
        if (w.trackChargeAim) p.chargeAim = p.aim;
        p.chargeTimer += dt;
        if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
          this.fire(p);
          p.chargeTimer = 0;
          p.chargeAim = undefined;
        }
      }
    } else if (w.fire) {
      this.fire(p);
    }
    p.prevFireHeld = w.fire;
  }
  fire(p) {
    if (p.respawnTimer > 0 || !p.alive) return;
    const m = this.mortars.find(mm => mm.operatorId === p.id);
    if (m) {
      if (m.cooldown <= 0) {
        m.cooldown = this.config.mortarCooldown;
        const mortarPr = (0, _projectiles.createProjectile)(this.prj++, p, m.x + Math.cos(m.angle) * 34, m.y - 18 + Math.sin(m.angle) * 34, Math.cos(m.angle) * m.power * 60, Math.sin(m.angle) * m.power * 60, {
          damage: this.config.mortarDamage,
          headshotMult: 1.5,
          terrainRadius: this.config.mortarRadius,
          explosive: true,
          gravityScale: 0.68,
          weaponLabel: '公共迫击炮',
          color: '#f97316',
          r: 7.5,
          life: 175 / 60
        });
        this.projectiles.push(mortarPr);
        this.events.push({
          kind: 'projectile_spawn',
          projectileId: mortarPr.id,
          playerId: p.id,
          weaponId: -1,
          x: mortarPr.pos.x,
          y: mortarPr.pos.y,
          vx: mortarPr.vel.x,
          vy: mortarPr.vel.y,
          bounces: 0,
          life: mortarPr.life
        });
        this.events.push({
          kind: 'mortar_fire',
          x: m.x,
          y: m.y,
          playerId: p.id
        });
      }
      return;
    }
    const wep = _weapons.WEAPONS[p.weaponIndex];
    const canFireWhileReloading = !!wep.shellReload && p.ammo[p.weaponIndex] > 0;
    if (p.reloading && !canFireWhileReloading || p.fireCooldown > 0) return;
    if (p.ammo[p.weaponIndex] <= 0) {
      if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p);
      return;
    }
    if (wep.shellReload && p.reloading) {
      p.reloading = false;
      p.reloadTimer = 0;
    }
    p.ammo[p.weaponIndex]--;
    p.fireCooldown = wep.fireDelay;
    if (p.ammo[p.weaponIndex] <= 0 && (p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p);
    if (wep.recoil > 0) {
      const rk = (0, _physics.recoilDelta)(wep.recoil, p.aim);
      if (!p.recoilVel) p.recoilVel = {
        x: 0,
        y: 0
      };
      p.recoilVel.x = rk.x;
      p.recoilVel.y = rk.y;
    }
    const mx = (0, _wrap.wrapX)(p.pos.x + Math.cos(p.aim) * 24);
    const my = p.pos.y - 12 + Math.sin(p.aim) * 24;
    for (let i = 0; i < wep.pellets; i++) {
      const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2);
      const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1);
      const pr = (0, _projectiles.createProjectile)(this.prj++, p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
        damage: wep.damage,
        headshotMult: wep.headshotMult,
        terrainRadius: wep.terrainRadius,
        explosive: wep.explosive,
        gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0.0 : 0.04),
        pierceOnHeadshot: !!wep.pierceOnHeadshot,
        pierceAll: !!wep.pierceAll,
        isGravityOrb: !!wep.isGravityOrb,
        bounces: wep.bounces ?? 0,
        passWalls: !!wep.passWalls,
        beam: !!wep.beam,
        rocket: !!wep.rocket,
        dragPerSecond: wep.dragPerSecond ?? 1,
        weaponId: wep.id,
        curveRate: wep.curveRate ?? 0,
        weaponLabel: wep.shortName,
        color: wep.color,
        r: wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2,
        life: wep.lifeSeconds ?? (wep.id === 2 || wep.id === 4 ? 175 : 130) / 60
      });
      this.projectiles.push(pr);
      this.events.push({
        kind: 'projectile_spawn',
        projectileId: pr.id,
        playerId: p.id,
        weaponId: pr.weaponId,
        x: pr.pos.x,
        y: pr.pos.y,
        vx: pr.vel.x,
        vy: pr.vel.y,
        bounces: pr.bounces,
        life: pr.life
      });
      if (pr.isGravityOrb && pr.life > 0 && pr.damage > 0) this.activeGravityOrbs.push(pr);
    }
  }
  snapshot() {
    return {
      tick: this.tick,
      seed: this.seed,
      players: this.players.map(p => ({
        ...p,
        pos: {
          x: p.pos.x,
          y: p.pos.y
        },
        vel: {
          x: p.vel.x,
          y: p.vel.y
        },
        ammo: [...p.ammo],
        reserveAmmo: [...p.reserveAmmo],
        teleportTarget: p.teleportTarget ? {
          x: p.teleportTarget.x,
          y: p.teleportTarget.y
        } : null,
        doll: p.doll ? {
          ...p.doll,
          pos: {
            x: p.doll.pos.x,
            y: p.doll.pos.y
          },
          ammo: [...p.doll.ammo],
          reserveAmmo: [...p.doll.reserveAmmo]
        } : null
      })),
      projectiles: this.projectiles.map(pr => ({
        ...pr,
        pos: {
          x: pr.pos.x,
          y: pr.pos.y
        },
        vel: {
          x: pr.vel.x,
          y: pr.vel.y
        },
        hitTargets: [...pr.hitTargets]
      })),
      grenades: this.grenades.map(g => ({
        ...g,
        pos: {
          x: g.pos.x,
          y: g.pos.y
        },
        vel: {
          x: g.vel.x,
          y: g.vel.y
        }
      })),
      landmines: this.landmines.map(m => ({
        ...m,
        pos: {
          x: m.pos.x,
          y: m.pos.y
        },
        vel: {
          x: m.vel.x,
          y: m.vel.y
        }
      })),
      airstrikes: this.airstrikes.map(a => ({
        ...a,
        pos: {
          x: a.pos.x,
          y: a.pos.y
        }
      })),
      obstacles: this.obstacles.map(o => ({
        ...o
      })),
      capturePoints: this.capturePoints.map(c => ({
        ...c
      })),
      ammoPacks: this.ammoPacks.map(a => ({
        ...a
      })),
      supplyCrates: this.supplyCrates.map(c => ({
        ...c
      })),
      mortars: this.mortars.map(m => ({
        ...m
      })),
      scores: {
        ...this.scores
      }
    };
  }
}
exports.World = World;
    },
    "src/net/protocol/BinaryCodec.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BINARY_STR_PREFIX = void 0;
exports.bytesToFrameString = bytesToFrameString;
exports.decodeClientMsgBinary = decodeClientMsgBinary;
exports.decodeServerMsgBinary = decodeServerMsgBinary;
exports.encodeClientMsgBinary = encodeClientMsgBinary;
exports.encodeServerMsgBinary = encodeServerMsgBinary;
exports.filterSnapshotAOI = filterSnapshotAOI;
exports.frameStringToBytes = frameStringToBytes;
exports.resetBinaryCodecState = resetBinaryCodecState;
var _weapons = __require("src/core/weapons.ts");
var _terrain = __require("src/core/terrain.ts");
var _landmarks = __require("src/core/sim/landmarks.ts");
var _wrap = __require("src/core/wrap.ts");
var _projectiles = __require("src/core/sim/projectiles.ts");
const MAGIC_SERVER = 0x53423253;
const MAGIC_CLIENT = 0x53423243;
const BINARY_STR_PREFIX = '\x00SB2:';
exports.BINARY_STR_PREFIX = BINARY_STR_PREFIX;
const TEAMS = ['red', 'blue', 'green', 'ffa'];
const TEAM_TO_IDX = {
  red: 0,
  blue: 1,
  green: 2,
  ffa: 3
};
const POS_X_SCALE = 4;
const INV_POS_X = 1 / POS_X_SCALE;
const POS_Y_SCALE = 12;
const INV_POS_Y = 1 / POS_Y_SCALE;
const VEL_SCALE = 6;
const INV_VEL = 1 / VEL_SCALE;
const AIM_SCALE = 10000;
const INV_AIM = 1 / AIM_SCALE;
function qPosX(x) {
  return (0, _wrap.clamp)(Math.round((0, _wrap.wrapX)(x) * POS_X_SCALE), 0, 65535);
}
function uPosX(q) {
  return q * INV_POS_X;
}
function qPosY(y) {
  return (0, _wrap.clamp)(Math.round((0, _wrap.wrapY)(y) * POS_Y_SCALE), 0, 65535);
}
function uPosY(q) {
  return q * INV_POS_Y;
}
function qVel(v) {
  return (0, _wrap.clamp)(Math.round(v * VEL_SCALE), -32767, 32767);
}
function uVel(q) {
  return q * INV_VEL;
}
function qAim(a) {
  return (0, _wrap.clamp)(Math.round(a * AIM_SCALE), -32767, 32767);
}
function uAim(q) {
  return q * INV_AIM;
}
function qTimerMs(t) {
  return (0, _wrap.clamp)(Math.round(Math.max(0, t) * 1000), 0, 65535);
}
function uTimerMs(q) {
  return q * 0.001;
}
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
class ByteWriter {
  buf;
  view;
  offset = 0;
  constructor(initialCapacity = 32768) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }
  reset() {
    this.offset = 0;
  }
  ensure(extra) {
    if (this.offset + extra <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < this.offset + extra) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.offset));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }
  u8(v) {
    this.buf[this.offset++] = v & 0xff;
  }
  i8(v) {
    this.view.setInt8(this.offset++, v);
  }
  u16(v) {
    this.view.setUint16(this.offset, v & 0xffff, true);
    this.offset += 2;
  }
  i16(v) {
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
  }
  u32(v) {
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }
  i32(v) {
    this.view.setInt32(this.offset, v | 0, true);
    this.offset += 4;
  }
  f32(v) {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }
  f64(v) {
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
  }
  str(s) {
    if (!s) {
      this.ensure(2);
      this.u16(0);
      return;
    }
    const n = s.length;
    let isAscii = n <= 64;
    if (isAscii) {
      for (let i = 0; i < n; i++) {
        if (s.charCodeAt(i) > 0x7f) {
          isAscii = false;
          break;
        }
      }
    }
    if (isAscii) {
      this.ensure(2 + n);
      this.view.setUint16(this.offset, n, true);
      this.offset += 2;
      for (let i = 0; i < n; i++) this.buf[this.offset + i] = s.charCodeAt(i);
      this.offset += n;
      return;
    }
    const bytes = textEncoder.encode(s);
    this.ensure(2 + bytes.length);
    this.view.setUint16(this.offset, bytes.length, true);
    this.offset += 2;
    this.buf.set(bytes, this.offset);
    this.offset += bytes.length;
  }
  finish() {
    return this.buf.slice(0, this.offset);
  }
}
class ByteReader {
  buf;
  view;
  offset = 0;
  constructor(bytes) {
    this.buf = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() {
    return this.buf[this.offset++];
  }
  i8() {
    return this.view.getInt8(this.offset++);
  }
  u16() {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }
  str() {
    const len = this.u16();
    if (len === 0) return '';
    const start = this.offset;
    const end = start + len;
    this.offset = end;
    if (len <= 64) {
      let ascii = '';
      for (let i = start; i < end; i++) {
        const c = this.buf[i];
        if (c > 0x7f) return textDecoder.decode(this.buf.subarray(start, end));
        ascii += String.fromCharCode(c);
      }
      return ascii;
    }
    return textDecoder.decode(this.buf.subarray(start, end));
  }
}
const sharedServerWriter = new ByteWriter(32768);
const sharedClientWriter = new ByteWriter(512);
function buildDefaultCapturePointsDict() {
  return _landmarks.CP_INITS.map(c => ({
    ...c,
    progress: c.ownerTeam ? 100 : 0,
    capturingTeam: null
  }));
}
function buildDefaultSupplyCratesDict() {
  const crates = [];
  let id = 1;
  for (const s of _landmarks.SUPPLY_SPOTS) {
    const wid = s.weaponId ?? 4;
    const w = _weapons.WEAPONS[wid];
    crates.push({
      id: id++,
      x: s.x,
      y: s.y,
      area: s.area,
      kind: 'weapon',
      weaponId: wid,
      weaponName: w.name,
      color: w.color,
      active: true,
      respawnTimer: 0
    });
  }
  for (const s of _landmarks.DOLL_SUPPLY_SPOTS) {
    crates.push({
      id: id++,
      x: s.x,
      y: s.y,
      area: s.area,
      kind: 'doll',
      weaponId: -1,
      weaponName: '🎎 替身人偶',
      color: '#f472b6',
      active: true,
      respawnTimer: 0
    });
  }
  return crates;
}
function buildDefaultMortarsDict() {
  return _landmarks.MORTARS_INIT.map(m => ({
    ...m,
    cooldown: 0,
    operatorId: null
  }));
}
let staticDictCapturePoints = buildDefaultCapturePointsDict();
let staticDictSupplyCrates = buildDefaultSupplyCratesDict();
let staticDictMortars = buildDefaultMortarsDict();
const staticDictAmmoSpots = new Map(_landmarks.AMMO_SPOTS.map(a => [a.x, a.area]));
const encodedPlayerNames = new Map();
const decodedPlayerNames = new Map();
let lastEncObsSig = '';
let lastEncCpSig = '';
let lastEncAmmoSig = '';
let lastEncCrateSig = '';
let lastEncMortarSig = '';
let lastDecObstacles = [];
let lastDecCapturePoints = [];
let lastDecAmmoPacks = [];
let lastDecSupplyCrates = [];
let lastDecMortars = [];
const encodedBallisticProjs = new Map();
const decodedBallisticProjs = new Map();
let lastDecodedTick = 0;
function resetBinaryCodecState() {
  staticDictCapturePoints = buildDefaultCapturePointsDict();
  staticDictSupplyCrates = buildDefaultSupplyCratesDict();
  staticDictMortars = buildDefaultMortarsDict();
  staticDictAmmoSpots.clear();
  for (const a of _landmarks.AMMO_SPOTS) staticDictAmmoSpots.set(a.x, a.area);
  encodedPlayerNames.clear();
  decodedPlayerNames.clear();
  lastEncObsSig = '';
  lastEncCpSig = '';
  lastEncAmmoSig = '';
  lastEncCrateSig = '';
  lastEncMortarSig = '';
  encodedBallisticProjs.clear();
  decodedBallisticProjs.clear();
  lastDecodedTick = 0;
}
function encodeServerMsgBinary(msg, opts = {}) {
  const w = sharedServerWriter;
  w.reset();
  w.ensure(64);
  w.u32(MAGIC_SERVER);
  const hasEvents = !!(msg.events && msg.events.length > 0);
  const hasWelcome = !!msg.welcome;
  if (hasWelcome || msg.snap.tick % 60 === 0) encodedPlayerNames.clear();
  const hasAckSeqs = !!(msg.snap.ackSeqs && Object.keys(msg.snap.ackSeqs).length > 0);
  const hdrFlags = 1 | (hasEvents ? 2 : 0) | (hasWelcome ? 4 : 0) | (hasAckSeqs ? 8 : 0) | (opts.deltaFacilities ? 16 : 0) | (opts.deltaProjectiles ? 32 : 0);
  w.u8(hdrFlags);
  encodeSnapshot(w, msg.snap, opts);
  if (hasEvents && msg.events) {
    w.ensure(4);
    w.u16(msg.events.length);
    for (let i = 0; i < msg.events.length; i++) {
      encodeWorldEvent(w, msg.events[i]);
    }
  }
  if (hasWelcome && msg.welcome) {
    w.ensure(16);
    w.u16(msg.welcome.playerId);
    w.str(msg.welcome.name);
    w.str(msg.welcome.team);
  }
  if (hasAckSeqs && msg.snap.ackSeqs) {
    const entries = Object.entries(msg.snap.ackSeqs);
    w.ensure(2 + entries.length * 6);
    w.u16(entries.length);
    for (let i = 0; i < entries.length; i++) {
      w.u16(Number(entries[i][0]));
      w.u32(entries[i][1]);
    }
  }
  return w.finish();
}
function decodeServerMsgBinary(bytes) {
  if (bytes.byteLength < 5) return null;
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== MAGIC_SERVER) return null;
  const hdrFlags = r.u8();
  const snap = decodeSnapshot(r, !!(hdrFlags & 16), !!(hdrFlags & 32));
  const out = {
    snap
  };
  if (hdrFlags & 2) {
    const evCount = r.u16();
    const events = new Array(evCount);
    for (let i = 0; i < evCount; i++) {
      events[i] = decodeWorldEvent(r);
    }
    out.events = events;
  }
  if (hdrFlags & 4) {
    const playerId = r.u16();
    const name = r.str();
    const team = r.str();
    out.welcome = {
      playerId,
      name,
      team
    };
  }
  if (hdrFlags & 8) {
    const ackCount = r.u16();
    const ackSeqs = {};
    for (let i = 0; i < ackCount; i++) {
      const pid = r.u16();
      const seq = r.u32();
      ackSeqs[pid] = seq;
    }
    snap.ackSeqs = ackSeqs;
  }
  return out;
}
function encodeSnapshot(w, s, opts) {
  w.ensure(32);
  w.u32(s.tick);
  w.i32(s.seed);
  w.u16(s.scores.red ?? 0);
  w.u16(s.scores.blue ?? 0);
  w.u16(s.scores.green ?? 0);
  w.u16(s.scores.ffa ?? 0);
  w.u16(s.players.length);
  for (let i = 0; i < s.players.length; i++) {
    encodePlayer(w, s.players[i]);
  }
  if (!opts.deltaProjectiles) {
    w.ensure(4);
    w.u16(s.projectiles.length);
    for (let i = 0; i < s.projectiles.length; i++) {
      encodeProjectile(w, s.projectiles[i]);
    }
  } else {
    const hasGravityOrb = s.projectiles.some(pr => pr.isGravityOrb && pr.life > 0);
    const fullSend = [];
    const deadReckonedIds = [];
    const currentAliveIds = new Set();
    for (let i = 0; i < s.projectiles.length; i++) {
      const pr = s.projectiles[i];
      currentAliveIds.add(pr.id);
      const prevBounces = encodedBallisticProjs.get(pr.id);
      if (!hasGravityOrb && !pr.isGravityOrb && prevBounces === pr.bounces) {
        deadReckonedIds.push(pr.id);
      } else {
        fullSend.push(pr);
        encodedBallisticProjs.set(pr.id, pr.bounces);
      }
    }
    for (const oldId of encodedBallisticProjs.keys()) {
      if (!currentAliveIds.has(oldId)) encodedBallisticProjs.delete(oldId);
    }
    w.ensure(6 + deadReckonedIds.length * 2);
    w.u16(fullSend.length);
    for (let i = 0; i < fullSend.length; i++) {
      encodeProjectile(w, fullSend[i]);
    }
    w.ensure(4 + deadReckonedIds.length * 2);
    w.u16(deadReckonedIds.length);
    for (let i = 0; i < deadReckonedIds.length; i++) {
      w.u16(deadReckonedIds[i] & 0xffff);
    }
  }
  w.ensure(4 + s.grenades.length * 18);
  w.u16(s.grenades.length);
  for (let i = 0; i < s.grenades.length; i++) {
    const g = s.grenades[i];
    w.u32(g.id);
    w.u16(g.owner);
    w.u16(qPosX(g.pos.x));
    w.u16(qPosY(g.pos.y));
    w.i16(qVel(g.vel.x));
    w.i16(qVel(g.vel.y));
    w.u16(qTimerMs(g.fuse));
    w.u8(g.bounces);
  }
  w.ensure(4 + s.landmines.length * 20);
  w.u16(s.landmines.length);
  for (let i = 0; i < s.landmines.length; i++) {
    const m = s.landmines[i];
    w.i16(m.id);
    w.u16(m.owner);
    w.u16(qPosX(m.pos.x));
    w.u16(qPosY(m.pos.y));
    w.i16(qVel(m.vel.x));
    w.i16(qVel(m.vel.y));
    const mf = (m.armed ? 1 : 0) | (m.triggered ? 2 : 0) | (m.instant ? 4 : 0) | (m.directHit ? 8 : 0) | (m.preset ? 16 : 0);
    w.u8(mf);
    w.u16(qTimerMs(m.armTimer));
    w.u16(qTimerMs(m.fuse));
    w.u16(qTimerMs(m.respawnTimer));
  }
  w.ensure(4 + s.airstrikes.length * 14);
  w.u16(s.airstrikes.length);
  for (let i = 0; i < s.airstrikes.length; i++) {
    const a = s.airstrikes[i];
    w.u32(a.id);
    w.u16(a.owner);
    w.u16(qPosX(a.pos.x));
    w.u16(qPosY(a.pos.y));
    w.i16(Math.round(a.timer * 1000));
    w.u8(a.dropped ? 1 : 0);
  }
  let facilityMask = 0x1f;
  if (opts.deltaFacilities) {
    const obsSig = s.obstacles.map(o => `${o.id}:${o.hp}`).join('|');
    const cpSig = s.capturePoints.map(c => `${c.ownerTeam}:${Math.round(c.progress)}:${c.capturingTeam}`).join('|');
    const ammoSig = s.ammoPacks.map(a => a.id).join('|');
    const crateSig = s.supplyCrates.map(c => `${c.id}:${c.active ? 1 : 0}:${c.weaponId}`).join('|');
    const mortarSig = s.mortars.map(m => `${m.operatorId}:${qAim(m.angle)}:${m.cooldown > 0 ? 1 : 0}`).join('|');
    facilityMask = (obsSig !== lastEncObsSig ? 1 : 0) | (cpSig !== lastEncCpSig ? 2 : 0) | (ammoSig !== lastEncAmmoSig ? 4 : 0) | (crateSig !== lastEncCrateSig ? 8 : 0) | (mortarSig !== lastEncMortarSig ? 16 : 0);
    lastEncObsSig = obsSig;
    lastEncCpSig = cpSig;
    lastEncAmmoSig = ammoSig;
    lastEncCrateSig = crateSig;
    lastEncMortarSig = mortarSig;
    w.ensure(2);
    w.u8(facilityMask);
  }
  if (facilityMask & 1) {
    w.ensure(4);
    w.u16(s.obstacles.length);
    for (let i = 0; i < s.obstacles.length; i++) {
      const ob = s.obstacles[i];
      const presetIdx = _terrain.OBSTACLE_PRESETS.findIndex(p => p.id === ob.id);
      if (presetIdx >= 0 && _terrain.OBSTACLE_PRESETS[presetIdx].x === ob.x && _terrain.OBSTACLE_PRESETS[presetIdx].y === ob.y) {
        w.ensure(6);
        w.u8(1);
        w.u8(presetIdx);
        w.i16(ob.hp);
        w.i16(ob.maxHp);
      } else {
        w.ensure(24);
        w.u8(0);
        w.str(ob.id);
        w.f32(ob.x);
        w.f32(ob.y);
        w.f32(ob.w);
        w.f32(ob.h);
        w.i16(ob.hp);
        w.i16(ob.maxHp);
        w.str(ob.label);
        w.str(ob.color);
        w.str(ob.borderColor);
      }
    }
  }
  if (facilityMask & 2) {
    if (!staticDictCapturePoints && s.capturePoints.length > 0) {
      staticDictCapturePoints = s.capturePoints.map(c => ({
        ...c
      }));
    }
    const canFastCp = staticDictCapturePoints !== null && staticDictCapturePoints.length === s.capturePoints.length && s.capturePoints.every((c, idx) => c.id === staticDictCapturePoints[idx].id && c.x === staticDictCapturePoints[idx].x);
    w.ensure(2 + s.capturePoints.length * 16);
    w.u8(s.capturePoints.length);
    w.u8(canFastCp ? 1 : 0);
    for (let i = 0; i < s.capturePoints.length; i++) {
      const cp = s.capturePoints[i];
      if (!canFastCp) {
        w.str(cp.id);
        w.str(cp.code);
        w.str(cp.name);
        w.ensure(14);
        w.f32(cp.x);
        w.f32(cp.y);
      }
      w.ensure(6);
      w.i8(cp.ownerTeam ? TEAM_TO_IDX[cp.ownerTeam] ?? -1 : -1);
      w.u16((0, _wrap.clamp)(Math.round(cp.progress * 100), 0, 10000));
      w.i8(cp.capturingTeam ? TEAM_TO_IDX[cp.capturingTeam] ?? -1 : -1);
    }
  }
  if (facilityMask & 4) {
    w.ensure(2);
    w.u8(s.ammoPacks.length);
    for (let i = 0; i < s.ammoPacks.length; i++) {
      const a = s.ammoPacks[i];
      const knownArea = staticDictAmmoSpots.get(a.x) === a.area;
      w.ensure(12);
      w.u16(a.id);
      w.u16(qPosX(a.x));
      w.u16(qPosY(a.y));
      if (knownArea) {
        w.u8(1);
      } else {
        staticDictAmmoSpots.set(a.x, a.area);
        w.u8(0);
        w.str(a.area);
      }
    }
  }
  if (facilityMask & 8) {
    if (!staticDictSupplyCrates && s.supplyCrates.length > 0) {
      staticDictSupplyCrates = s.supplyCrates.map(c => ({
        ...c
      }));
    }
    const canFastCrate = staticDictSupplyCrates !== null && staticDictSupplyCrates.length === s.supplyCrates.length && s.supplyCrates.every((c, idx) => c.x === staticDictSupplyCrates[idx].x && c.kind === staticDictSupplyCrates[idx].kind);
    w.ensure(4 + s.supplyCrates.length * 8);
    w.u8(s.supplyCrates.length);
    w.u8(canFastCrate ? 1 : 0);
    for (let i = 0; i < s.supplyCrates.length; i++) {
      const c = s.supplyCrates[i];
      if (canFastCrate) {
        w.ensure(6);
        w.u16(c.id);
        w.i8(c.weaponId);
        w.u8(c.active ? 1 : 0);
        w.u16(qTimerMs(c.respawnTimer));
      } else {
        w.ensure(16);
        w.u16(c.id);
        w.f32(c.x);
        w.f32(c.y);
        w.str(c.area);
        w.ensure(8);
        w.u8(c.kind === 'doll' ? 1 : 0);
        w.i8(c.weaponId);
        w.str(c.weaponName);
        w.str(c.color);
        w.ensure(6);
        w.u8(c.active ? 1 : 0);
        w.u16(qTimerMs(c.respawnTimer));
      }
    }
  }
  if (facilityMask & 16) {
    if (!staticDictMortars && s.mortars.length > 0) {
      staticDictMortars = s.mortars.map(m => ({
        ...m
      }));
    }
    const canFastMortar = staticDictMortars !== null && staticDictMortars.length === s.mortars.length && s.mortars.every((m, idx) => m.id === staticDictMortars[idx].id && m.x === staticDictMortars[idx].x);
    w.ensure(4 + s.mortars.length * 8);
    w.u8(s.mortars.length);
    w.u8(canFastMortar ? 1 : 0);
    for (let i = 0; i < s.mortars.length; i++) {
      const m = s.mortars[i];
      if (!canFastMortar) {
        w.str(m.id);
        w.str(m.name);
        w.ensure(12);
        w.f32(m.x);
        w.f32(m.y);
        w.f32(m.power);
      }
      w.ensure(6);
      w.i16(qAim(m.angle));
      w.u16(qTimerMs(m.cooldown));
      w.i16(m.operatorId ?? -1);
    }
  }
}
function decodeSnapshot(r, isDeltaFacilities, isDeltaProjectiles) {
  const tick = r.u32();
  const seed = r.i32();
  const scores = {
    red: r.u16(),
    blue: r.u16(),
    green: r.u16(),
    ffa: r.u16()
  };
  const pCount = r.u16();
  const players = new Array(pCount);
  for (let i = 0; i < pCount; i++) players[i] = decodePlayer(r);
  let projectiles;
  if (!isDeltaProjectiles) {
    const prjCount = r.u16();
    projectiles = new Array(prjCount);
    for (let i = 0; i < prjCount; i++) {
      const pr = decodeProjectile(r);
      projectiles[i] = pr;
      decodedBallisticProjs.set(pr.id & 0xffff, pr);
    }
  } else {
    const dtTicks = lastDecodedTick > 0 && tick > lastDecodedTick ? tick - lastDecodedTick : 1;
    const fullCount = r.u16();
    const freshProjs = new Array(fullCount);
    for (let i = 0; i < fullCount; i++) {
      const pr = decodeProjectile(r);
      freshProjs[i] = pr;
      decodedBallisticProjs.set(pr.id & 0xffff, pr);
    }
    const keptCount = r.u16();
    const keptProjs = [];
    for (let i = 0; i < keptCount; i++) {
      const shortId = r.u16();
      const cached = decodedBallisticProjs.get(shortId);
      if (cached) {
        (0, _projectiles.stepClientProjectilesDeadReckoning)([cached], 1 / 60 * dtTicks);
        keptProjs.push({
          ...cached,
          pos: {
            x: cached.pos.x,
            y: cached.pos.y
          },
          vel: {
            x: cached.vel.x,
            y: cached.vel.y
          },
          hitTargets: [...cached.hitTargets]
        });
      }
    }
    projectiles = [...freshProjs, ...keptProjs];
  }
  lastDecodedTick = tick;
  const gCount = r.u16();
  const grenades = new Array(gCount);
  for (let i = 0; i < gCount; i++) {
    grenades[i] = {
      id: r.u32(),
      owner: r.u16(),
      pos: {
        x: uPosX(r.u16()),
        y: uPosY(r.u16())
      },
      vel: {
        x: uVel(r.i16()),
        y: uVel(r.i16())
      },
      fuse: uTimerMs(r.u16()),
      bounces: r.u8()
    };
  }
  const mCount = r.u16();
  const landmines = new Array(mCount);
  for (let i = 0; i < mCount; i++) {
    const id = r.i16();
    const owner = r.u16();
    const px = uPosX(r.u16());
    const py = uPosY(r.u16());
    const vx = uVel(r.i16());
    const vy = uVel(r.i16());
    const mf = r.u8();
    landmines[i] = {
      id,
      owner,
      pos: {
        x: px,
        y: py
      },
      vel: {
        x: vx,
        y: vy
      },
      armed: !!(mf & 1),
      triggered: !!(mf & 2),
      instant: !!(mf & 4),
      directHit: !!(mf & 8),
      preset: !!(mf & 16),
      armTimer: uTimerMs(r.u16()),
      fuse: uTimerMs(r.u16()),
      respawnTimer: uTimerMs(r.u16())
    };
  }
  const aCount = r.u16();
  const airstrikes = new Array(aCount);
  for (let i = 0; i < aCount; i++) {
    airstrikes[i] = {
      id: r.u32(),
      owner: r.u16(),
      pos: {
        x: uPosX(r.u16()),
        y: uPosY(r.u16())
      },
      timer: r.i16() * 0.001,
      dropped: r.u8() !== 0
    };
  }
  const facilityMask = isDeltaFacilities ? r.u8() : 0x1f;
  let obstacles;
  if (facilityMask & 1) {
    const oCount = r.u16();
    obstacles = new Array(oCount);
    for (let i = 0; i < oCount; i++) {
      const isPreset = r.u8() === 1;
      if (isPreset) {
        const idx = r.u8();
        const hp = r.i16();
        const maxHp = r.i16();
        const p = _terrain.OBSTACLE_PRESETS[idx];
        obstacles[i] = {
          ...p,
          hp,
          maxHp
        };
      } else {
        obstacles[i] = {
          id: r.str(),
          x: r.f32(),
          y: r.f32(),
          w: r.f32(),
          h: r.f32(),
          hp: r.i16(),
          maxHp: r.i16(),
          label: r.str(),
          color: r.str(),
          borderColor: r.str()
        };
      }
    }
    lastDecObstacles = obstacles.map(o => ({
      ...o
    }));
  } else {
    obstacles = lastDecObstacles.map(o => ({
      ...o
    }));
  }
  let capturePoints;
  if (facilityMask & 2) {
    const cpCount = r.u8();
    const isFastCp = r.u8() === 1;
    capturePoints = new Array(cpCount);
    for (let i = 0; i < cpCount; i++) {
      let id, code, name, x, y;
      if (isFastCp && staticDictCapturePoints && staticDictCapturePoints[i]) {
        const tpl = staticDictCapturePoints[i];
        id = tpl.id;
        code = tpl.code;
        name = tpl.name;
        x = tpl.x;
        y = tpl.y;
      } else {
        id = r.str();
        code = r.str();
        name = r.str();
        x = r.f32();
        y = r.f32();
      }
      const ownIdx = r.i8();
      const progress = r.u16() * 0.01;
      const capIdx = r.i8();
      capturePoints[i] = {
        id,
        code,
        name,
        x,
        y,
        ownerTeam: ownIdx >= 0 ? TEAMS[ownIdx] : null,
        progress,
        capturingTeam: capIdx >= 0 ? TEAMS[capIdx] : null
      };
    }
    if (!staticDictCapturePoints && capturePoints.length > 0) {
      staticDictCapturePoints = capturePoints.map(c => ({
        ...c
      }));
    }
    lastDecCapturePoints = capturePoints.map(c => ({
      ...c
    }));
  } else {
    capturePoints = lastDecCapturePoints.map(c => ({
      ...c
    }));
  }
  let ammoPacks;
  if (facilityMask & 4) {
    const amCount = r.u8();
    ammoPacks = new Array(amCount);
    for (let i = 0; i < amCount; i++) {
      const id = r.u16();
      const x = Math.round(uPosX(r.u16()));
      const y = Math.round(uPosY(r.u16()));
      const isKnown = r.u8() === 1;
      let area = '';
      if (isKnown) {
        area = staticDictAmmoSpots.get(x) ?? '';
      } else {
        area = r.str();
        staticDictAmmoSpots.set(x, area);
      }
      ammoPacks[i] = {
        id,
        x,
        y,
        area
      };
    }
    lastDecAmmoPacks = ammoPacks.map(a => ({
      ...a
    }));
  } else {
    ammoPacks = lastDecAmmoPacks.map(a => ({
      ...a
    }));
  }
  let supplyCrates;
  if (facilityMask & 8) {
    const scCount = r.u8();
    const isFastCrate = r.u8() === 1;
    supplyCrates = new Array(scCount);
    for (let i = 0; i < scCount; i++) {
      if (isFastCrate && staticDictSupplyCrates && staticDictSupplyCrates[i]) {
        const tpl = staticDictSupplyCrates[i];
        const id = r.u16();
        const weaponId = r.i8();
        const active = r.u8() !== 0;
        const respawnTimer = uTimerMs(r.u16());
        const w = weaponId >= 0 ? _weapons.WEAPONS[weaponId] : null;
        supplyCrates[i] = {
          ...tpl,
          id,
          weaponId,
          weaponName: w ? w.name : tpl.weaponName,
          color: w ? w.color : tpl.color,
          active,
          respawnTimer
        };
      } else {
        supplyCrates[i] = {
          id: r.u16(),
          x: r.f32(),
          y: r.f32(),
          area: r.str(),
          kind: r.u8() === 1 ? 'doll' : 'weapon',
          weaponId: r.i8(),
          weaponName: r.str(),
          color: r.str(),
          active: r.u8() !== 0,
          respawnTimer: uTimerMs(r.u16())
        };
      }
    }
    if (!staticDictSupplyCrates && supplyCrates.length > 0) {
      staticDictSupplyCrates = supplyCrates.map(c => ({
        ...c
      }));
    }
    lastDecSupplyCrates = supplyCrates.map(c => ({
      ...c
    }));
  } else {
    supplyCrates = lastDecSupplyCrates.map(c => ({
      ...c
    }));
  }
  let mortars;
  if (facilityMask & 16) {
    const mtCount = r.u8();
    const isFastMortar = r.u8() === 1;
    mortars = new Array(mtCount);
    for (let i = 0; i < mtCount; i++) {
      let id, name, x, y, power;
      if (isFastMortar && staticDictMortars && staticDictMortars[i]) {
        const tpl = staticDictMortars[i];
        id = tpl.id;
        name = tpl.name;
        x = tpl.x;
        y = tpl.y;
        power = tpl.power;
      } else {
        id = r.str();
        name = r.str();
        x = r.f32();
        y = r.f32();
        power = r.f32();
      }
      const angle = uAim(r.i16());
      const cooldown = uTimerMs(r.u16());
      const op = r.i16();
      mortars[i] = {
        id,
        name,
        x,
        y,
        angle,
        power,
        cooldown,
        operatorId: op >= 0 ? op : null
      };
    }
    if (!staticDictMortars && mortars.length > 0) {
      staticDictMortars = mortars.map(m => ({
        ...m
      }));
    }
    lastDecMortars = mortars.map(m => ({
      ...m
    }));
  } else {
    mortars = lastDecMortars.map(m => ({
      ...m
    }));
  }
  return {
    tick,
    seed,
    players,
    projectiles,
    grenades,
    landmines,
    airstrikes,
    obstacles,
    capturePoints,
    ammoPacks,
    supplyCrates,
    mortars,
    scores
  };
}
function encodePlayer(w, p) {
  w.ensure(48);
  w.u16(p.id);
  w.u16(qPosX(p.pos.x));
  w.u16(qPosY(p.pos.y));
  w.i16(qVel(p.vel.x));
  w.i16(qVel(p.vel.y));
  w.i16(qAim(p.aim));
  const teamIdx = TEAM_TO_IDX[p.team] ?? 3;
  const bitFlags = teamIdx & 3 | (p.alive ? 4 : 0) | (p.deployed ? 8 : 0) | (p.onGround ? 16 : 0) | (p.jetpack ? 32 : 0) | (p.reloading ? 64 : 0) | (p.doll ? 128 : 0);
  w.u8(bitFlags);
  const secIdx = Math.max(0, _weapons.SECONDARY_UNLOCK_ORDER.indexOf(p.secondary));
  const hasCustomSpawn = Boolean(p.selectedSpawnId && p.selectedSpawnId !== 'base');
  const wepAndSec = p.weaponIndex & 0x0f | (hasCustomSpawn ? 1 : 0) << 4 | (p.fragCharges & 0x07) << 5;
  w.u8(wepAndSec);
  if (hasCustomSpawn) w.str(p.selectedSpawnId);
  w.i16((0, _wrap.clamp)(Math.round(p.hp * 10), -32767, 32767));
  w.u16(p.maxHp);
  w.u16((0, _wrap.clamp)(Math.round(p.fuel * 1000), 0, 65535));
  w.u16(p.kills);
  w.u16(p.deaths);
  const dollAndSec = (0, _wrap.clamp)(p.dollCharges, 0, 7) & 0x07 | (secIdx & 0x07) << 3;
  w.u8(dollAndSec);
  w.u8((0, _wrap.clamp)(p.deathStreak ?? 0, 0, 255));
  if (encodedPlayerNames.get(p.id) === p.name) {
    w.u8(1);
  } else {
    encodedPlayerNames.set(p.id, p.name);
    w.u8(0);
    w.str(p.name);
  }
  w.ensure(64);
  const wi = p.weaponIndex;
  w.u16((0, _wrap.clamp)(Math.round((p.ammo[wi] ?? 0) * 100), 0, 65535));
  w.u16(p.reserveAmmo[wi] ?? 0);
  let otherAmmoModified = false;
  for (let i = 0; i < _weapons.WEAPONS.length; i++) {
    if (i === wi) continue;
    if (p.ammo[i] !== _weapons.WEAPONS[i].magSize || p.reserveAmmo[i] !== _weapons.WEAPONS[i].maxReserve) {
      otherAmmoModified = true;
      break;
    }
  }
  const timerMask = (otherAmmoModified ? 1 : 0) | (p.reloadTimer > 0 ? 2 : 0) | (p.fireCooldown > 0 ? 4 : 0) | (p.chargeTimer > 0 ? 8 : 0) | (p.secondaryCooldown > 0 ? 16 : 0) | (p.fragRechargeTimer > 0 ? 32 : 0) | (p.shieldTimer > 0 || p.shieldHp > 0 ? 64 : 0) | (p.respawnTimer > 0 || p.warpCooldown > 0 || p.mountedTowerId !== null || p.watchtowerTimer > 0 || (p.teleportTimer ?? 0) > 0 ? 128 : 0);
  w.u8(timerMask);
  if (timerMask & 1) {
    w.ensure(2 + p.ammo.length * 4);
    w.u8(p.ammo.length);
    for (let i = 0; i < p.ammo.length; i++) {
      w.u16((0, _wrap.clamp)(Math.round(p.ammo[i] * 100), 0, 65535));
      w.u16(p.reserveAmmo[i]);
    }
  }
  if (timerMask & 2) w.u16(qTimerMs(p.reloadTimer));
  if (timerMask & 4) w.u16(qTimerMs(p.fireCooldown));
  if (timerMask & 8) w.u16(qTimerMs(p.chargeTimer));
  if (timerMask & 16) w.u16(qTimerMs(p.secondaryCooldown));
  if (timerMask & 32) w.u16(qTimerMs(p.fragRechargeTimer));
  if (timerMask & 64) {
    w.u16((0, _wrap.clamp)(Math.round(p.shieldHp * 10), 0, 65535));
    w.u16(qTimerMs(p.shieldTimer));
  }
  if (timerMask & 128) {
    w.u16(qTimerMs(p.respawnTimer));
    w.u16(qTimerMs(p.warpCooldown));
    w.u16(qTimerMs(p.watchtowerTimer));
    w.str(p.mountedTowerId ?? '');
    const tpActive = (p.teleportTimer ?? 0) > 0 && p.teleportTarget ? 1 : 0;
    w.u8(tpActive);
    if (tpActive && p.teleportTarget) {
      w.u16(qTimerMs(p.teleportTimer ?? 0));
      w.u16(qPosX(p.teleportTarget.x));
      w.u16(qPosY(p.teleportTarget.y));
    }
  }
  if (p.doll) {
    w.ensure(32 + p.doll.ammo.length * 4);
    w.u16(qPosX(p.doll.pos.x));
    w.u16(qPosY(p.doll.pos.y));
    w.i16((0, _wrap.clamp)(Math.round(p.doll.hp * 10), -32767, 32767));
    w.u16((0, _wrap.clamp)(Math.round(p.doll.shieldHp * 10), 0, 65535));
    w.u16((0, _wrap.clamp)(Math.round(p.doll.fuel * 1000), 0, 65535));
    w.u8(p.doll.weaponIndex);
    w.u16(qTimerMs(p.doll.timer));
    w.u8(p.doll.ammo.length);
    for (let i = 0; i < p.doll.ammo.length; i++) {
      w.u16((0, _wrap.clamp)(Math.round(p.doll.ammo[i] * 100), 0, 65535));
      w.u16(p.doll.reserveAmmo[i]);
    }
  }
}
function decodePlayer(r) {
  const id = r.u16();
  const px = uPosX(r.u16());
  const py = uPosY(r.u16());
  const vx = uVel(r.i16());
  const vy = uVel(r.i16());
  const aim = uAim(r.i16());
  const bitFlags = r.u8();
  const wepAndSec = r.u8();
  const team = TEAMS[bitFlags & 3] ?? 'ffa';
  const alive = !!(bitFlags & 4);
  const deployed = !!(bitFlags & 8);
  const onGround = !!(bitFlags & 16);
  const jetpack = !!(bitFlags & 32);
  const reloading = !!(bitFlags & 64);
  const hasDoll = !!(bitFlags & 128);
  const weaponIndex = wepAndSec & 0x0f;
  const hasCustomSpawn = !!(wepAndSec & 0x10);
  const fragCharges = wepAndSec >> 5 & 0x07;
  const selectedSpawnId = hasCustomSpawn ? r.str() : 'base';
  const hp = r.i16() * 0.1;
  const maxHp = r.u16();
  const fuel = r.u16() * 0.001;
  const kills = r.u16();
  const deaths = r.u16();
  const dollAndSec = r.u8();
  const dollCharges = dollAndSec & 0x07;
  const secIdx = dollAndSec >> 3 & 0x07;
  const secondary = _weapons.SECONDARY_UNLOCK_ORDER[secIdx] ?? 'frag';
  const deathStreak = r.u8();
  const nameCached = r.u8() === 1;
  let name = '';
  if (nameCached) {
    name = decodedPlayerNames.get(id) ?? 'Player_' + id;
  } else {
    name = r.str();
    decodedPlayerNames.set(id, name);
  }
  const curAmmo = r.u16() * 0.01;
  const curReserve = r.u16();
  const ammo = _weapons.WEAPONS.map(w => w.magSize);
  const reserveAmmo = _weapons.WEAPONS.map(w => w.maxReserve);
  if (weaponIndex >= 0 && weaponIndex < ammo.length) {
    ammo[weaponIndex] = curAmmo;
    reserveAmmo[weaponIndex] = curReserve;
  }
  const timerMask = r.u8();
  if (timerMask & 1) {
    const len = r.u8();
    for (let i = 0; i < len; i++) {
      ammo[i] = r.u16() * 0.01;
      reserveAmmo[i] = r.u16();
    }
  }
  const reloadTimer = timerMask & 2 ? uTimerMs(r.u16()) : 0;
  const fireCooldown = timerMask & 4 ? uTimerMs(r.u16()) : 0;
  const chargeTimer = timerMask & 8 ? uTimerMs(r.u16()) : 0;
  const secondaryCooldown = timerMask & 16 ? uTimerMs(r.u16()) : 0;
  const fragRechargeTimer = timerMask & 32 ? uTimerMs(r.u16()) : 0;
  let shieldHp = 0;
  let shieldTimer = 0;
  if (timerMask & 64) {
    shieldHp = r.u16() * 0.1;
    shieldTimer = uTimerMs(r.u16());
  }
  let respawnTimer = 0;
  let warpCooldown = 0;
  let watchtowerTimer = 0;
  let mountedTowerId = null;
  let teleportTimer = 0;
  let teleportTarget = null;
  if (timerMask & 128) {
    respawnTimer = uTimerMs(r.u16());
    warpCooldown = uTimerMs(r.u16());
    watchtowerTimer = uTimerMs(r.u16());
    const mt = r.str();
    mountedTowerId = mt ? mt : null;
    const tpActive = r.u8();
    if (tpActive) {
      teleportTimer = uTimerMs(r.u16());
      teleportTarget = {
        x: uPosX(r.u16()),
        y: uPosY(r.u16())
      };
    }
  }
  let doll = null;
  if (hasDoll) {
    const dx = uPosX(r.u16());
    const dy = uPosY(r.u16());
    const dHp = r.i16() * 0.1;
    const dShield = r.u16() * 0.1;
    const dFuel = r.u16() * 0.001;
    const dWep = r.u8();
    const dTimer = uTimerMs(r.u16());
    const dLen = r.u8();
    const dAmmo = new Array(dLen);
    const dRes = new Array(dLen);
    for (let i = 0; i < dLen; i++) {
      dAmmo[i] = r.u16() * 0.01;
      dRes[i] = r.u16();
    }
    doll = {
      pos: {
        x: dx,
        y: dy
      },
      hp: dHp,
      shieldHp: dShield,
      fuel: dFuel,
      weaponIndex: dWep,
      ammo: dAmmo,
      reserveAmmo: dRes,
      timer: dTimer
    };
  }
  return {
    id,
    pos: {
      x: px,
      y: py
    },
    vel: {
      x: vx,
      y: vy
    },
    aim,
    team,
    name,
    hp,
    maxHp,
    alive,
    deployed,
    onGround,
    weaponIndex,
    ammo,
    reserveAmmo,
    reloading,
    reloadTimer,
    fireCooldown,
    chargeTimer,
    secondary,
    secondaryCooldown,
    fragCharges,
    fragRechargeTimer,
    jetpack,
    fuel,
    shieldHp,
    shieldTimer,
    watchtowerTimer,
    mountedTowerId,
    warpCooldown,
    teleportTimer,
    teleportTarget,
    doll,
    dollCharges,
    respawnTimer,
    kills,
    deaths,
    deathStreak,
    selectedSpawnId
  };
}
function encodeProjectile(w, pr) {
  w.ensure(24);
  w.u32(pr.id);
  w.u16(pr.owner);
  w.i8(pr.weaponId);
  const wep = pr.weaponId >= 0 ? _weapons.WEAPONS[pr.weaponId] : undefined;
  const expectedR = wep ? wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2 : -1;
  const isStandard = wep !== undefined && pr.damage === wep.damage && pr.headshotMult === wep.headshotMult && pr.terrainRadius === wep.terrainRadius && Math.abs(pr.r - expectedR) < 1e-4 && pr.hitTargets.length === 1 && pr.hitTargets[0] === pr.owner;
  const flags = (pr.explosive ? 1 : 0) | (pr.isGravityOrb ? 2 : 0) | (pr.pierceOnHeadshot ? 4 : 0) | (pr.pierceAll ? 8 : 0) | (pr.passWalls ? 16 : 0) | (pr.beam ? 32 : 0) | (pr.rocket ? 64 : 0) | (!isStandard ? 128 : 0);
  w.u8(flags);
  w.u16(qPosX(pr.pos.x));
  w.u16(qPosY(pr.pos.y));
  w.i16(qVel(pr.vel.x));
  w.i16(qVel(pr.vel.y));
  w.u16((0, _wrap.clamp)(Math.round(Math.min(60, pr.life) * 1000), 0, 65535));
  w.u8(pr.bounces);
  if (!isStandard) {
    w.ensure(36);
    w.f32(pr.r);
    w.f32(pr.damage);
    w.f32(pr.headshotMult);
    w.f32(pr.terrainRadius);
    w.f32(pr.gravityScale);
    w.f32(pr.dragPerSecond);
    w.f32(pr.curveRate);
    w.str(pr.weaponLabel);
    w.str(pr.color);
    w.ensure(2 + pr.hitTargets.length * 2);
    w.u8(pr.hitTargets.length);
    for (let i = 0; i < pr.hitTargets.length; i++) w.u16(pr.hitTargets[i]);
  }
}
function decodeProjectile(r) {
  const id = r.u32();
  const owner = r.u16();
  const weaponId = r.i8();
  const flags = r.u8();
  const px = uPosX(r.u16());
  const py = uPosY(r.u16());
  const vx = uVel(r.i16());
  const vy = uVel(r.i16());
  const lifeRaw = r.u16() * 0.001;
  const bounces = r.u8();
  const explosive = !!(flags & 1);
  const isGravityOrb = !!(flags & 2);
  const pierceOnHeadshot = !!(flags & 4);
  const pierceAll = !!(flags & 8);
  const passWalls = !!(flags & 16);
  const beam = !!(flags & 32);
  const rocket = !!(flags & 64);
  const hasCustom = !!(flags & 128);
  if (!hasCustom && weaponId >= 0 && _weapons.WEAPONS[weaponId]) {
    const wep = _weapons.WEAPONS[weaponId];
    const rad = wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2;
    const life = lifeRaw >= 59.9 ? wep.lifeSeconds ?? lifeRaw : lifeRaw;
    return {
      id,
      owner,
      pos: {
        x: px,
        y: py
      },
      vel: {
        x: vx,
        y: vy
      },
      life,
      r: rad,
      damage: wep.damage,
      headshotMult: wep.headshotMult,
      explosive,
      terrainRadius: wep.terrainRadius,
      gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0.0 : 0.04),
      pierceOnHeadshot,
      pierceAll,
      isGravityOrb,
      weaponId,
      curveRate: wep.curveRate ?? 0,
      weaponLabel: wep.shortName,
      color: wep.color,
      hitTargets: [owner],
      bounces,
      passWalls,
      beam,
      rocket,
      dragPerSecond: wep.dragPerSecond ?? 1
    };
  }
  const rad = r.f32();
  const damage = r.f32();
  const headshotMult = r.f32();
  const terrainRadius = r.f32();
  const gravityScale = r.f32();
  const dragPerSecond = r.f32();
  const curveRate = r.f32();
  const weaponLabel = r.str();
  const color = r.str();
  const htLen = r.u8();
  const hitTargets = new Array(htLen);
  for (let i = 0; i < htLen; i++) hitTargets[i] = r.u16();
  return {
    id,
    owner,
    pos: {
      x: px,
      y: py
    },
    vel: {
      x: vx,
      y: vy
    },
    life: lifeRaw,
    r: rad,
    damage,
    headshotMult,
    explosive,
    terrainRadius,
    gravityScale,
    pierceOnHeadshot,
    pierceAll,
    isGravityOrb,
    weaponId,
    curveRate,
    weaponLabel,
    color,
    hitTargets,
    bounces,
    passWalls,
    beam,
    rocket,
    dragPerSecond
  };
}
const EVENT_KINDS = ['hit', 'kill', 'explosion', 'obstacle_destroy', 'capture', 'supply_pickup', 'ammo_pickup', 'warp', 'shield', 'shield_break', 'doll_recall', 'mortar_fire', 'airstrike', 'airstrike_drop', 'laser', 'watchtower', 'headshot', 'pierce', 'projectile_spawn', 'projectile_bounce', 'projectile_destroy'];
const EVENT_KIND_TO_IDX = Object.fromEntries(EVENT_KINDS.map((k, i) => [k, i]));
function encodeWorldEvent(w, e) {
  w.ensure(20);
  const kIdx = EVENT_KIND_TO_IDX[e.kind] ?? 0;
  w.u8(kIdx);
  if (e.kind === 'laser' && e.segments) {
    w.u8(1);
    w.u16(qPosX(e.x ?? 0));
    w.u16(qPosY(e.y ?? 0));
    w.u16(qTimerMs(e.duration ?? 0.06));
    w.str(e.color ?? '#22d3ee');
    w.ensure(4 + e.segments.length * 8);
    w.u16(e.playerId ?? 0);
    w.str(e.weaponLabel ?? '高斯枪');
    w.ensure(2 + e.segments.length * 16);
    w.u8(e.segments.length);
    for (let i = 0; i < e.segments.length; i++) {
      const s = e.segments[i];
      w.u16(qPosX(s.x1));
      w.u16(qPosY(s.y1));
      w.u16(qPosX(s.x2));
      w.u16(qPosY(s.y2));
      w.i32(Math.round((s.dx ?? 0) * 16));
      w.i32(Math.round((s.dy ?? 0) * 16));
    }
    return;
  }
  if (e.kind === 'projectile_spawn' || e.kind === 'projectile_bounce') {
    w.u8(2);
    w.u32(e.projectileId ?? 0);
    w.u16(e.playerId ?? 0);
    w.i8(e.weaponId ?? -1);
    w.u16(qPosX(e.x ?? 0));
    w.u16(qPosY(e.y ?? 0));
    w.i16(qVel(e.vx ?? 0));
    w.i16(qVel(e.vy ?? 0));
    w.u8(e.bounces ?? 0);
    return;
  }
  if (e.kind === 'projectile_destroy') {
    w.u8(3);
    w.u32(e.projectileId ?? 0);
    return;
  }
  w.u8(0);
  w.str(JSON.stringify(e));
}
function decodeWorldEvent(r) {
  const kIdx = r.u8();
  const mode = r.u8();
  if (mode === 1) {
    const x = uPosX(r.u16());
    const y = uPosY(r.u16());
    const duration = uTimerMs(r.u16());
    const color = r.str();
    const playerId = r.u16();
    const weaponLabel = r.str();
    const segLen = r.u8();
    const segments = new Array(segLen);
    for (let i = 0; i < segLen; i++) {
      const x1 = uPosX(r.u16()),
        y1 = uPosY(r.u16()),
        x2 = uPosX(r.u16()),
        y2 = uPosY(r.u16());
      const dx = r.i32() / 16;
      const dy = r.i32() / 16;
      segments[i] = {
        x1,
        y1,
        x2,
        y2,
        dx,
        dy
      };
    }
    return {
      kind: 'laser',
      x,
      y,
      duration,
      color,
      playerId,
      weaponLabel,
      segments
    };
  }
  if (mode === 2) {
    const kind = EVENT_KINDS[kIdx] === 'projectile_bounce' ? 'projectile_bounce' : 'projectile_spawn';
    return {
      kind,
      projectileId: r.u32(),
      playerId: r.u16(),
      weaponId: r.i8(),
      x: uPosX(r.u16()),
      y: uPosY(r.u16()),
      vx: uVel(r.i16()),
      vy: uVel(r.i16()),
      bounces: r.u8()
    };
  }
  if (mode === 3) {
    return {
      kind: 'projectile_destroy',
      projectileId: r.u32()
    };
  }
  return JSON.parse(r.str());
}
function encodeClientMsgBinary(msg) {
  const w = sharedClientWriter;
  w.reset();
  w.ensure(64);
  w.u32(MAGIC_CLIENT);
  w.u32(msg.seq);
  w.f64(msg.ts);
  w.u8(msg.intents.length);
  for (let i = 0; i < msg.intents.length; i++) {
    w.ensure(32);
    const it = msg.intents[i];
    switch (it.t) {
      case 'move':
        w.u8(1);
        w.i8(it.dir);
        break;
      case 'jump':
        w.u8(2);
        break;
      case 'jetpack':
        w.u8(3);
        w.u8(it.on ? 1 : 0);
        break;
      case 'dive':
        w.u8(4);
        w.u8(it.on ? 1 : 0);
        break;
      case 'aim':
        w.u8(5);
        w.f32(it.angle);
        break;
      case 'fire':
        w.u8(6);
        w.u8(it.on ? 1 : 0);
        break;
      case 'reload':
        w.u8(7);
        break;
      case 'interact':
        w.u8(8);
        break;
      case 'secondary':
        w.u8(9);
        w.str(it.kind);
        w.f32(it.targetX);
        w.f32(it.targetY);
        break;
      case 'switchWeapon':
        w.u8(10);
        w.i8(it.index);
        break;
    }
  }
  return w.finish();
}
function decodeClientMsgBinary(bytes) {
  if (bytes.byteLength < 17) return null;
  const r = new ByteReader(bytes);
  if (r.u32() !== MAGIC_CLIENT) return null;
  const seq = r.u32();
  const ts = r.f64();
  const count = r.u8();
  const intents = new Array(count);
  for (let i = 0; i < count; i++) {
    const code = r.u8();
    switch (code) {
      case 1:
        intents[i] = {
          t: 'move',
          dir: r.i8()
        };
        break;
      case 2:
        intents[i] = {
          t: 'jump'
        };
        break;
      case 3:
        intents[i] = {
          t: 'jetpack',
          on: r.u8() !== 0
        };
        break;
      case 4:
        intents[i] = {
          t: 'dive',
          on: r.u8() !== 0
        };
        break;
      case 5:
        intents[i] = {
          t: 'aim',
          angle: r.f32()
        };
        break;
      case 6:
        intents[i] = {
          t: 'fire',
          on: r.u8() !== 0
        };
        break;
      case 7:
        intents[i] = {
          t: 'reload'
        };
        break;
      case 8:
        intents[i] = {
          t: 'interact'
        };
        break;
      case 9:
        intents[i] = {
          t: 'secondary',
          kind: r.str(),
          targetX: r.f32(),
          targetY: r.f32()
        };
        break;
      case 10:
        intents[i] = {
          t: 'switchWeapon',
          index: r.i8()
        };
        break;
      default:
        intents[i] = {
          t: 'move',
          dir: 0
        };
        break;
    }
  }
  return {
    seq,
    ts,
    intents
  };
}
function bytesToFrameString(bytes) {
  let out = BINARY_STR_PREFIX;
  const CHUNK = 4096;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}
function frameStringToBytes(str) {
  const pLen = BINARY_STR_PREFIX.length;
  const len = str.length - pLen;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = str.charCodeAt(i + pLen) & 0xff;
  }
  return out;
}
function filterSnapshotAOI(snap, centerPlayerId, radiusX = 2800, radiusY = 1800) {
  const viewer = snap.players.find(p => p.id === centerPlayerId);
  if (!viewer) return snap;
  const vx = viewer.pos.x;
  const vy = viewer.pos.y;
  return {
    ...snap,
    projectiles: snap.projectiles.filter(pr => pr.owner === centerPlayerId || Math.abs((0, _wrap.wrapDeltaX)(vx, pr.pos.x)) <= radiusX && Math.abs((0, _wrap.wrapDeltaY)(vy, pr.pos.y)) <= radiusY),
    grenades: snap.grenades.filter(g => g.owner === centerPlayerId || Math.abs((0, _wrap.wrapDeltaX)(vx, g.pos.x)) <= radiusX && Math.abs((0, _wrap.wrapDeltaY)(vy, g.pos.y)) <= radiusY)
  };
}
    },
    "src/net/transport/Kcp.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.KcpBlock = exports.IKCP_RTO_NDL = exports.IKCP_RTO_MIN = exports.IKCP_RTO_MAX = exports.IKCP_RTO_DEF = exports.IKCP_OVERHEAD = exports.IKCP_MTU_DEF = exports.IKCP_CMD_WINS = exports.IKCP_CMD_WASK = exports.IKCP_CMD_UNRELIABLE = exports.IKCP_CMD_PUSH = exports.IKCP_CMD_PONG = exports.IKCP_CMD_PING = exports.IKCP_CMD_ACK = exports.DEFAULT_KCP_CONV = void 0;
exports.isKcpPacket = isKcpPacket;
const IKCP_RTO_NDL = 30;
exports.IKCP_RTO_NDL = IKCP_RTO_NDL;
const IKCP_RTO_MIN = 100;
exports.IKCP_RTO_MIN = IKCP_RTO_MIN;
const IKCP_RTO_DEF = 200;
exports.IKCP_RTO_DEF = IKCP_RTO_DEF;
const IKCP_RTO_MAX = 60000;
exports.IKCP_RTO_MAX = IKCP_RTO_MAX;
const IKCP_CMD_PUSH = 81;
exports.IKCP_CMD_PUSH = IKCP_CMD_PUSH;
const IKCP_CMD_ACK = 82;
exports.IKCP_CMD_ACK = IKCP_CMD_ACK;
const IKCP_CMD_WASK = 83;
exports.IKCP_CMD_WASK = IKCP_CMD_WASK;
const IKCP_CMD_WINS = 84;
exports.IKCP_CMD_WINS = IKCP_CMD_WINS;
const IKCP_CMD_UNRELIABLE = 85;
exports.IKCP_CMD_UNRELIABLE = IKCP_CMD_UNRELIABLE;
const IKCP_CMD_PING = 86;
exports.IKCP_CMD_PING = IKCP_CMD_PING;
const IKCP_CMD_PONG = 87;
exports.IKCP_CMD_PONG = IKCP_CMD_PONG;
const IKCP_OVERHEAD = 24;
exports.IKCP_OVERHEAD = IKCP_OVERHEAD;
const IKCP_MTU_DEF = 1200;
exports.IKCP_MTU_DEF = IKCP_MTU_DEF;
const DEFAULT_KCP_CONV = 0x53424b43;
exports.DEFAULT_KCP_CONV = DEFAULT_KCP_CONV;
function timeDiff(later, earlier) {
  return (later | 0) - (earlier | 0);
}
class KcpBlock {
  conv;
  mtu;
  mss;
  sndUna = 0;
  sndNxt = 0;
  rcvNxt = 0;
  rxSrtt = 0;
  rxRttval = 0;
  rxRto = IKCP_RTO_DEF;
  rxMinrto = IKCP_RTO_NDL;
  sndWnd;
  rcvWnd;
  rmtWnd = 128;
  cwnd = 128;
  nodelay = 1;
  interval = 10;
  tsFlush = 0;
  fastresend = 2;
  nocwnd = 1;
  current = 0;
  sndQueue = [];
  rcvQueue = [];
  sndBuf = [];
  rcvBuf = [];
  ackList = [];
  unreliableQueue = [];
  output;
  txPackets = 0;
  rxPackets = 0;
  txBytes = 0;
  rxBytes = 0;
  fastRetransmits = 0;
  timeoutRetransmits = 0;
  constructor(conv = DEFAULT_KCP_CONV, output, opts = {}) {
    this.conv = conv >>> 0;
    this.output = output;
    this.mtu = Math.max(256, opts.mtu ?? IKCP_MTU_DEF);
    this.mss = this.mtu - IKCP_OVERHEAD;
    this.sndWnd = Math.max(16, opts.sndWnd ?? 128);
    this.rcvWnd = Math.max(16, opts.rcvWnd ?? 128);
    this.rmtWnd = this.rcvWnd;
    this.setNoDelay(opts.nodelay ?? 1, opts.interval ?? 10, opts.resend ?? 2, opts.nc ?? 1);
  }
  setNoDelay(nodelay, interval, resend, nc) {
    this.nodelay = nodelay;
    this.rxMinrto = nodelay > 0 ? IKCP_RTO_NDL : IKCP_RTO_MIN;
    this.interval = Math.max(5, Math.min(5000, interval));
    this.fastresend = Math.max(0, resend);
    this.nocwnd = nc;
  }
  send(payload) {
    if (payload.byteLength === 0) return -1;
    const count = payload.byteLength <= this.mss ? 1 : Math.ceil(payload.byteLength / this.mss);
    if (count > 255) return -2;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const size = Math.min(this.mss, payload.byteLength - offset);
      const slice = payload.subarray(offset, offset + size);
      const copy = new Uint8Array(size);
      copy.set(slice);
      this.sndQueue.push({
        conv: this.conv,
        cmd: IKCP_CMD_PUSH,
        frg: count - i - 1,
        wnd: 0,
        ts: 0,
        sn: 0,
        una: 0,
        data: copy,
        resendts: 0,
        rto: this.rxRto,
        fastack: 0,
        xmit: 0
      });
      offset += size;
    }
    return 0;
  }
  sendUnreliable(payload) {
    const pkt = new Uint8Array(IKCP_OVERHEAD + payload.byteLength);
    const view = new DataView(pkt.buffer);
    view.setUint32(0, this.conv, true);
    view.setUint8(4, IKCP_CMD_UNRELIABLE);
    view.setUint8(5, 0);
    view.setUint16(6, this.wndUnused(), true);
    view.setUint32(8, this.current >>> 0, true);
    view.setUint32(12, 0, true);
    view.setUint32(16, this.rcvNxt >>> 0, true);
    view.setUint32(20, payload.byteLength >>> 0, true);
    pkt.set(payload, IKCP_OVERHEAD);
    this.emitPacket(pkt);
  }
  sendPing(nowMs = this.current) {
    this.current = nowMs >>> 0;
    const pkt = new Uint8Array(IKCP_OVERHEAD);
    const view = new DataView(pkt.buffer);
    view.setUint32(0, this.conv, true);
    view.setUint8(4, IKCP_CMD_PING);
    view.setUint8(5, 0);
    view.setUint16(6, this.wndUnused(), true);
    view.setUint32(8, this.current >>> 0, true);
    view.setUint32(12, 0, true);
    view.setUint32(16, this.rcvNxt >>> 0, true);
    view.setUint32(20, 0, true);
    this.emitPacket(pkt);
  }
  recv() {
    if (this.unreliableQueue.length > 0) {
      return this.unreliableQueue.shift();
    }
    if (this.rcvQueue.length === 0) return null;
    const first = this.rcvQueue[0];
    if (first.frg === 0) {
      this.rcvQueue.shift();
      this.moveRcvBufToQueue();
      return first.data;
    }
    if (this.rcvQueue.length < first.frg + 1) {
      return null;
    }
    let totalLen = 0;
    const segCount = first.frg + 1;
    for (let i = 0; i < segCount; i++) {
      totalLen += this.rcvQueue[i].data.byteLength;
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < segCount; i++) {
      const seg = this.rcvQueue.shift();
      out.set(seg.data, offset);
      offset += seg.data.byteLength;
    }
    this.moveRcvBufToQueue();
    return out;
  }
  input(data, nowMs = this.current) {
    this.current = nowMs >>> 0;
    if (!data || data.byteLength < IKCP_OVERHEAD) return -1;
    this.rxPackets++;
    this.rxBytes += data.byteLength;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    let maxAck = -1;
    while (offset + IKCP_OVERHEAD <= data.byteLength) {
      const conv = view.getUint32(offset, true);
      if (conv !== this.conv) return -2;
      const cmd = view.getUint8(offset + 4);
      const frg = view.getUint8(offset + 5);
      const wnd = view.getUint16(offset + 6, true);
      const ts = view.getUint32(offset + 8, true);
      const sn = view.getUint32(offset + 12, true);
      const una = view.getUint32(offset + 16, true);
      const len = view.getUint32(offset + 20, true);
      offset += IKCP_OVERHEAD;
      if (offset + len > data.byteLength) return -3;
      this.rmtWnd = wnd;
      this.parseUna(una);
      this.shrinkBuf();
      if (cmd === IKCP_CMD_ACK) {
        const rtt = timeDiff(this.current, ts);
        if (rtt >= 0) this.updateAck(rtt);
        this.parseAck(sn);
        this.shrinkBuf();
        this.parseFastack(sn);
        if (maxAck < 0 || sn > maxAck) maxAck = sn;
      } else if (cmd === IKCP_CMD_PUSH) {
        if (sn < this.rcvNxt + this.rcvWnd) {
          this.ackList.push({
            sn,
            ts
          });
          if (sn >= this.rcvNxt) {
            const payload = new Uint8Array(len);
            payload.set(data.subarray(offset, offset + len));
            this.parseData({
              conv,
              cmd,
              frg,
              wnd,
              ts,
              sn,
              una,
              data: payload,
              resendts: 0,
              rto: 0,
              fastack: 0,
              xmit: 0
            });
          }
        }
      } else if (cmd === IKCP_CMD_UNRELIABLE) {
        const payload = new Uint8Array(len);
        payload.set(data.subarray(offset, offset + len));
        this.unreliableQueue.push(payload);
      } else if (cmd === IKCP_CMD_PING) {
        const pong = new Uint8Array(IKCP_OVERHEAD);
        const pv = new DataView(pong.buffer);
        pv.setUint32(0, this.conv, true);
        pv.setUint8(4, IKCP_CMD_PONG);
        pv.setUint8(5, 0);
        pv.setUint16(6, this.wndUnused(), true);
        pv.setUint32(8, ts, true);
        pv.setUint32(12, 0, true);
        pv.setUint32(16, this.rcvNxt >>> 0, true);
        pv.setUint32(20, 0, true);
        this.emitPacket(pong);
      } else if (cmd === IKCP_CMD_PONG) {
        const rtt = timeDiff(this.current, ts);
        if (rtt >= 0) this.updateAck(rtt);
      } else if (cmd !== IKCP_CMD_WASK && cmd !== IKCP_CMD_WINS) {
        return -4;
      }
      offset += len;
    }
    return 0;
  }
  update(currentMs) {
    this.current = currentMs >>> 0;
    if (this.tsFlush === 0) {
      this.tsFlush = this.current;
    }
    const slap = timeDiff(this.current, this.tsFlush);
    if (slap >= 10000 || slap < -10000) {
      this.tsFlush = this.current;
    } else if (slap >= 0) {
      this.tsFlush = this.tsFlush + this.interval >>> 0;
      if (timeDiff(this.current, this.tsFlush) >= 0) {
        this.tsFlush = this.current + this.interval >>> 0;
      }
      this.flush();
    }
  }
  flush(nowMs = this.current) {
    this.current = nowMs >>> 0;
    const wnd = this.wndUnused();
    const buffer = new Uint8Array(this.mtu * 2);
    const view = new DataView(buffer.buffer);
    let offset = 0;
    const flushBuffer = () => {
      if (offset > 0) {
        const out = buffer.slice(0, offset);
        this.emitPacket(out);
        offset = 0;
      }
    };
    const writeHeader = (cmd, frg, segWnd, ts, sn, una, len) => {
      view.setUint32(offset, this.conv, true);
      view.setUint8(offset + 4, cmd);
      view.setUint8(offset + 5, frg);
      view.setUint16(offset + 6, segWnd, true);
      view.setUint32(offset + 8, ts >>> 0, true);
      view.setUint32(12 + offset, sn >>> 0, true);
      view.setUint32(16 + offset, una >>> 0, true);
      view.setUint32(20 + offset, len >>> 0, true);
      offset += IKCP_OVERHEAD;
    };
    for (let i = 0; i < this.ackList.length; i++) {
      if (offset + IKCP_OVERHEAD > this.mtu) flushBuffer();
      const ack = this.ackList[i];
      writeHeader(IKCP_CMD_ACK, 0, wnd, ack.ts, ack.sn, this.rcvNxt, 0);
    }
    this.ackList.length = 0;
    const cwndLimit = this.nocwnd ? Math.min(this.sndWnd, this.rmtWnd) : Math.min(this.sndWnd, this.rmtWnd, this.cwnd);
    while (this.sndNxt < this.sndUna + cwndLimit && this.sndQueue.length > 0) {
      const seg = this.sndQueue.shift();
      seg.conv = this.conv;
      seg.cmd = IKCP_CMD_PUSH;
      seg.wnd = wnd;
      seg.ts = this.current;
      seg.sn = this.sndNxt++;
      seg.una = this.rcvNxt;
      seg.resendts = this.current;
      seg.rto = this.rxRto;
      seg.fastack = 0;
      seg.xmit = 0;
      this.sndBuf.push(seg);
    }
    const resent = this.fastresend > 0 ? this.fastresend : 0xffffffff;
    const rtomin = this.nodelay === 0 ? this.rxRto >>> 3 : 0;
    for (let i = 0; i < this.sndBuf.length; i++) {
      const seg = this.sndBuf[i];
      let needSend = false;
      if (seg.xmit === 0) {
        needSend = true;
        seg.xmit++;
        seg.rto = this.rxRto;
        seg.resendts = this.current + seg.rto + rtomin >>> 0;
      } else if (timeDiff(this.current, seg.resendts) >= 0) {
        needSend = true;
        seg.xmit++;
        this.timeoutRetransmits++;
        if (this.nodelay === 0) {
          seg.rto += Math.max(seg.rto, this.rxRto);
        } else {
          const step = this.nodelay < 2 ? seg.rto : this.rxRto;
          seg.rto += Math.floor(step / 2);
        }
        seg.resendts = this.current + seg.rto >>> 0;
      } else if (seg.fastack >= resent) {
        needSend = true;
        seg.xmit++;
        seg.fastack = 0;
        seg.resendts = this.current + seg.rto >>> 0;
        this.fastRetransmits++;
      }
      if (needSend) {
        seg.ts = this.current;
        seg.wnd = wnd;
        seg.una = this.rcvNxt;
        const needBytes = IKCP_OVERHEAD + seg.data.byteLength;
        if (offset + needBytes > this.mtu) flushBuffer();
        writeHeader(seg.cmd, seg.frg, seg.wnd, seg.ts, seg.sn, seg.una, seg.data.byteLength);
        buffer.set(seg.data, offset);
        offset += seg.data.byteLength;
      }
    }
    flushBuffer();
  }
  getStats() {
    return {
      conv: this.conv,
      srtt: this.rxSrtt,
      rttVar: this.rxRttval,
      rto: this.rxRto,
      txPackets: this.txPackets,
      rxPackets: this.rxPackets,
      txBytes: this.txBytes,
      rxBytes: this.rxBytes,
      fastRetransmits: this.fastRetransmits,
      timeoutRetransmits: this.timeoutRetransmits,
      inFlight: this.sndBuf.length
    };
  }
  emitPacket(pkt) {
    this.txPackets++;
    this.txBytes += pkt.byteLength;
    this.output(pkt);
  }
  wndUnused() {
    if (this.rcvQueue.length < this.rcvWnd) {
      return this.rcvWnd - this.rcvQueue.length;
    }
    return 0;
  }
  updateAck(rtt) {
    if (this.rxSrtt === 0) {
      this.rxSrtt = rtt;
      this.rxRttval = Math.max(1, rtt >> 1);
    } else {
      const delta = Math.abs(rtt - this.rxSrtt);
      this.rxRttval = 3 * this.rxRttval + delta >> 2;
      this.rxSrtt = Math.max(1, 7 * this.rxSrtt + rtt >> 3);
    }
    const rto = this.rxSrtt + Math.max(this.interval, 4 * this.rxRttval);
    this.rxRto = Math.max(this.rxMinrto, Math.min(IKCP_RTO_MAX, rto));
  }
  shrinkBuf() {
    this.sndUna = this.sndBuf.length > 0 ? this.sndBuf[0].sn : this.sndNxt;
  }
  parseAck(sn) {
    if (sn < this.sndUna || sn >= this.sndNxt) return;
    for (let i = 0; i < this.sndBuf.length; i++) {
      if (this.sndBuf[i].sn === sn) {
        this.sndBuf.splice(i, 1);
        break;
      }
      if (this.sndBuf[i].sn > sn) break;
    }
  }
  parseUna(una) {
    let removeCount = 0;
    while (removeCount < this.sndBuf.length && this.sndBuf[removeCount].sn < una) {
      removeCount++;
    }
    if (removeCount > 0) {
      this.sndBuf.splice(0, removeCount);
    }
  }
  parseFastack(sn) {
    if (sn < this.sndUna || sn >= this.sndNxt) return;
    for (let i = 0; i < this.sndBuf.length; i++) {
      const seg = this.sndBuf[i];
      if (seg.sn < sn) {
        seg.fastack++;
      } else {
        break;
      }
    }
  }
  parseData(newseg) {
    const sn = newseg.sn;
    if (sn >= this.rcvNxt + this.rcvWnd || sn < this.rcvNxt) return;
    let repeat = false;
    let insertIdx = this.rcvBuf.length;
    for (let i = this.rcvBuf.length - 1; i >= 0; i--) {
      const seg = this.rcvBuf[i];
      if (seg.sn === sn) {
        repeat = true;
        break;
      }
      if (sn > seg.sn) {
        insertIdx = i + 1;
        break;
      }
      insertIdx = i;
    }
    if (!repeat) {
      this.rcvBuf.splice(insertIdx, 0, newseg);
    }
    this.moveRcvBufToQueue();
  }
  moveRcvBufToQueue() {
    while (this.rcvBuf.length > 0) {
      const seg = this.rcvBuf[0];
      if (seg.sn === this.rcvNxt && this.rcvQueue.length < this.rcvWnd) {
        this.rcvBuf.shift();
        this.rcvQueue.push(seg);
        this.rcvNxt++;
      } else {
        break;
      }
    }
  }
}
exports.KcpBlock = KcpBlock;
function isKcpPacket(bytes, expectedConv = DEFAULT_KCP_CONV) {
  if (bytes.byteLength < IKCP_OVERHEAD) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const conv = view.getUint32(0, true);
  const cmd = view.getUint8(4);
  return conv === expectedConv >>> 0 && cmd >= IKCP_CMD_PUSH && cmd <= IKCP_CMD_PONG;
}
    },
    "src/net/transport/Peer.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.configureWebRtcUnreliableChannel = configureWebRtcUnreliableChannel;
exports.createPeerClient = createPeerClient;
exports.createPeerPair = createPeerPair;
exports.createPeerServer = createPeerServer;
exports.encodeClientWireFrame = encodeClientWireFrame;
exports.encodeServerWireFrame = encodeServerWireFrame;
var _BinaryCodec = __require("src/net/protocol/BinaryCodec.ts");
var _Kcp = __require("src/net/transport/Kcp.ts");
function encodeServerWireFrame(m, forceFull = false) {
  const isKeyframe = forceFull || Boolean(m.welcome) || Boolean(m.events && m.events.length > 0) || m.snap.tick % 30 === 0;
  return (0, _BinaryCodec.encodeServerMsgBinary)(m, {
    deltaFacilities: !isKeyframe
  });
}
function encodeClientWireFrame(m) {
  return (0, _BinaryCodec.encodeClientMsgBinary)(m);
}
function nowMs() {
  return typeof performance !== 'undefined' ? Math.floor(performance.now()) : Date.now();
}
function toUint8Array(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof raw === 'string' && raw.startsWith(_BinaryCodec.BINARY_STR_PREFIX)) {
    return (0, _BinaryCodec.frameStringToBytes)(raw);
  }
  return null;
}
function parseServerMsg(raw) {
  if (raw instanceof Uint8Array) return (0, _BinaryCodec.decodeServerMsgBinary)(raw);
  if (raw instanceof ArrayBuffer) return (0, _BinaryCodec.decodeServerMsgBinary)(new Uint8Array(raw));
  if (typeof raw === 'string') {
    if (raw.startsWith(_BinaryCodec.BINARY_STR_PREFIX)) {
      return (0, _BinaryCodec.decodeServerMsgBinary)((0, _BinaryCodec.frameStringToBytes)(raw));
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return null;
}
function parseClientMsg(raw) {
  if (raw instanceof Uint8Array) return (0, _BinaryCodec.decodeClientMsgBinary)(raw);
  if (raw instanceof ArrayBuffer) return (0, _BinaryCodec.decodeClientMsgBinary)(new Uint8Array(raw));
  if (typeof raw === 'string') {
    if (raw.startsWith(_BinaryCodec.BINARY_STR_PREFIX)) {
      return (0, _BinaryCodec.decodeClientMsgBinary)((0, _BinaryCodec.frameStringToBytes)(raw));
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return null;
}
function configureWebRtcUnreliableChannel(conn, onUnreliableFrame) {
  let customDc = null;
  const bindDc = dc => {
    dc.binaryType = 'arraybuffer';
    dc.onmessage = ev => {
      const bytes = toUint8Array(ev.data);
      if (bytes) onUnreliableFrame(bytes);
    };
  };
  if (conn.dataChannel) {
    try {
      conn.dataChannel.binaryType = 'arraybuffer';
    } catch {}
  }
  const alreadyUnreliableKcpChannel = Boolean(conn.dataChannel && conn.dataChannel.label === 'skyblast-kcp');
  const pc = conn.peerConnection;
  if (!alreadyUnreliableKcpChannel && pc && typeof pc.createDataChannel === 'function') {
    try {
      const prevOnDc = pc.ondatachannel;
      pc.ondatachannel = ev => {
        if (ev.channel && ev.channel.label === 'skyblast-kcp') {
          customDc = ev.channel;
          bindDc(customDc);
        } else if (prevOnDc) {
          prevOnDc.call(pc, ev);
        }
      };
      const created = pc.createDataChannel('skyblast-kcp', {
        ordered: false,
        maxRetransmits: 0
      });
      if (created.readyState === 'open') customDc = created;
      created.onopen = () => {
        customDc = created;
      };
      bindDc(created);
    } catch {}
  }
  return {
    sendDatagram(pkt) {
      if (customDc && customDc.readyState === 'open') {
        try {
          customDc.send(pkt.slice().buffer);
          return;
        } catch {}
      }
      conn.send(pkt);
    },
    isCustomDataChannel() {
      return alreadyUnreliableKcpChannel || customDc !== null && customDc.readyState === 'open';
    }
  };
}
function createPeerClient(conn, kcpOpts = {}) {
  let onServer = null;
  const conv = kcpOpts.conv ?? _Kcp.DEFAULT_KCP_CONV;
  const handleIncomingBytes = bytes => {
    if ((0, _Kcp.isKcpPacket)(bytes, conv)) {
      const t = nowMs();
      kcp.input(bytes, t);
      let payload;
      while ((payload = kcp.recv()) !== null) {
        const m = parseServerMsg(payload);
        if (m && 'snap' in m) onServer?.(m);
      }
      kcp.flush(t);
      return;
    }
    const m = parseServerMsg(bytes);
    if (m && 'snap' in m) onServer?.(m);
  };
  const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes);
  const kcp = new _Kcp.KcpBlock(conv, pkt => dcBridge.sendDatagram(pkt), {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
    ...kcpOpts
  });
  conn.on('data', raw => {
    const bytes = toUint8Array(raw);
    if (bytes) {
      handleIncomingBytes(bytes);
      return;
    }
    const m = parseServerMsg(raw);
    if (m && 'snap' in m) onServer?.(m);
  });
  return {
    kcp,
    send(m) {
      const t = nowMs();
      const wire = encodeClientWireFrame(m);
      kcp.send(wire);
      kcp.flush(t);
    },
    onServer(cb) {
      onServer = cb;
    },
    getKcpStats() {
      return kcp.getStats();
    },
    tickKcp(t = nowMs()) {
      kcp.update(t);
    }
  };
}
function createPeerServer(conn, kcpOpts = {}) {
  let onClient = null;
  const conv = kcpOpts.conv ?? _Kcp.DEFAULT_KCP_CONV;
  const handleIncomingBytes = bytes => {
    if ((0, _Kcp.isKcpPacket)(bytes, conv)) {
      const t = nowMs();
      kcp.input(bytes, t);
      let payload;
      while ((payload = kcp.recv()) !== null) {
        const m = parseClientMsg(payload);
        if (m && 'intents' in m) onClient?.(m);
      }
      kcp.flush(t);
      return;
    }
    const m = parseClientMsg(bytes);
    if (m && 'intents' in m) onClient?.(m);
  };
  const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes);
  const kcp = new _Kcp.KcpBlock(conv, pkt => dcBridge.sendDatagram(pkt), {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
    ...kcpOpts
  });
  conn.on('data', raw => {
    const bytes = toUint8Array(raw);
    if (bytes) {
      handleIncomingBytes(bytes);
      return;
    }
    const m = parseClientMsg(raw);
    if (m && 'intents' in m) onClient?.(m);
  });
  return {
    kcp,
    send(m) {
      const t = nowMs();
      const wire = encodeServerWireFrame(m);
      if (m.welcome || wire.byteLength <= kcp.mss * 32) {
        kcp.send(wire);
        kcp.flush(t);
      } else {
        kcp.sendUnreliable(wire);
      }
    },
    sendRawFrame(frame) {
      const t = nowMs();
      if (frame instanceof Uint8Array) {
        kcp.flush(t);
        kcp.sendUnreliable(frame);
      } else {
        conn.send(frame);
      }
    },
    onClient(cb) {
      onClient = cb;
    },
    getKcpStats() {
      return kcp.getStats();
    },
    tickKcp(t = nowMs()) {
      kcp.update(t);
    }
  };
}
function createPeerPair(hostConn, guestConn, kcpOpts = {}) {
  return {
    client: createPeerClient(guestConn, kcpOpts),
    server: createPeerServer(hostConn, kcpOpts)
  };
}
    },
    "src/net/ServerSim.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerSim = void 0;
exports.applyIntents = applyIntents;
var _Peer = __require("src/net/transport/Peer.ts");
var _BinaryCodec = __require("src/net/protocol/BinaryCodec.ts");
var _types = __require("src/core/types.ts");
class ServerSim {
  world;
  clients = [];
  events = [];
  pendingBroadcastEvents = [];
  syncEveryTicks;
  enableAOI;
  aoiRadiusX;
  aoiRadiusY;
  tickCounter = 0;
  constructor(world, opts = {}) {
    this.world = world;
    this.syncEveryTicks = Math.max(1, opts.syncEveryTicks ?? 1);
    this.enableAOI = opts.enableAOI ?? false;
    this.aoiRadiusX = opts.aoiRadiusX ?? 2800;
    this.aoiRadiusY = opts.aoiRadiusY ?? 1800;
  }
  accept(id, transport) {
    const client = {
      id,
      transport: transport,
      input: (0, _types.defaultWorldInput)(),
      lastAckSeq: 0
    };
    transport.onClient(msg => {
      if (typeof msg.seq === 'number' && msg.seq > client.lastAckSeq) {
        client.lastAckSeq = msg.seq;
      }
      client.input = applyIntents(client.input, msg.intents);
    });
    this.clients.push(client);
  }
  removeClient(id) {
    this.clients = this.clients.filter(c => c.id !== id);
  }
  step(dt) {
    this.tickCounter++;
    const inputs = new Map();
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i];
      inputs.set(c.id, c.input);
    }
    this.world.step(dt, inputs);
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i];
      c.input.jump = false;
      c.input.interact = false;
      c.input.secondary = null;
      c.input.switchWeapon = null;
      c.input.reload = false;
    }
    const events = this.world.drainEvents();
    if (events.length > 0) {
      this.events.push(...events);
      this.pendingBroadcastEvents.push(...events);
    }
    if (this.clients.length === 0) {
      this.pendingBroadcastEvents.length = 0;
      return;
    }
    if (this.tickCounter % this.syncEveryTicks !== 0) return;
    const snap = this.world.snapshot();
    const ackSeqs = {};
    for (let i = 0; i < this.clients.length; i++) {
      const c = this.clients[i];
      ackSeqs[c.id] = c.lastAckSeq;
    }
    snap.ackSeqs = ackSeqs;
    const outEvents = this.pendingBroadcastEvents.length > 0 ? [...this.pendingBroadcastEvents] : [];
    this.pendingBroadcastEvents.length = 0;
    if (!this.enableAOI) {
      const msg = {
        snap,
        events: outEvents
      };
      let sharedWireFrame = null;
      for (let i = 0; i < this.clients.length; i++) {
        const t = this.clients[i].transport;
        if (t.sendRawFrame) {
          if (sharedWireFrame === null) sharedWireFrame = (0, _Peer.encodeServerWireFrame)(msg);
          t.sendRawFrame(sharedWireFrame);
        } else {
          t.send(msg);
        }
      }
    } else {
      for (let i = 0; i < this.clients.length; i++) {
        const c = this.clients[i];
        const clientSnap = (0, _BinaryCodec.filterSnapshotAOI)(snap, c.id, this.aoiRadiusX, this.aoiRadiusY);
        c.transport.send({
          snap: clientSnap,
          events: outEvents
        });
      }
    }
  }
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
exports.ServerSim = ServerSim;
function applyIntents(cur, intents) {
  const n = {
    ...cur
  };
  for (let i = 0; i < intents.length; i++) {
    const it = intents[i];
    switch (it.t) {
      case 'move':
        n.move = it.dir;
        break;
      case 'jump':
        n.jump = true;
        break;
      case 'jetpack':
        n.jetpack = it.on;
        break;
      case 'dive':
        n.dive = it.on;
        break;
      case 'aim':
        n.aim = it.angle;
        break;
      case 'fire':
        n.fire = it.on;
        break;
      case 'reload':
        n.reload = true;
        break;
      case 'interact':
        n.interact = true;
        break;
      case 'secondary':
        n.secondary = {
          type: it.kind,
          targetX: it.targetX,
          targetY: it.targetY
        };
        break;
      case 'switchWeapon':
        n.switchWeapon = it.index;
        break;
    }
  }
  return n;
}
    },
    "src/web/controls.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Controls = void 0;
class Controls {
  keys = new Set();
  mouse = {
    x: 0,
    y: 0
  };
  mouseDown = false;
  playerWorld = {
    x: 0,
    y: 0
  };
  isTouch;
  tMoveX = 0;
  tAim = 0;
  tFire = false;
  tJump = false;
  tJetpack = false;
  tReload = false;
  canvas;
  logicalW;
  logicalH;
  constructor(canvas, logicalW, logicalH, cb = {}) {
    this.canvas = canvas;
    this.logicalW = logicalW;
    this.logicalH = logicalH;
    const forcedTouch = new URLSearchParams(location.search).get('touch') === '1';
    this.isTouch = forcedTouch || 'ontouchstart' in window;
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('mousemove', e => {
      this.mouse = this.toWorld(e.clientX, e.clientY);
    });
    window.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('touchstart', e => this.onTouch(e), {
      passive: false
    });
    canvas.addEventListener('touchmove', e => this.onTouch(e), {
      passive: false
    });
    canvas.addEventListener('touchend', e => this.onTouchEnd(e), {
      passive: false
    });
    canvas.addEventListener('touchcancel', e => this.onTouchEnd(e), {
      passive: false
    });
  }
  setPlayerScreen(x, y) {
    this.playerWorld = {
      x,
      y
    };
  }
  pressJump() {
    this.tJump = true;
  }
  setJetpack(on) {
    this.tJetpack = on;
  }
  pressReload() {
    this.tReload = true;
  }
  consumeMomentary() {
    this.tJump = false;
    this.tReload = false;
  }
  getState() {
    if (this.isTouch) {
      return {
        moveX: this.tMoveX,
        aimAngle: this.tAim,
        fire: this.tFire,
        jump: this.tJump,
        jetpack: this.tJetpack,
        reload: this.tReload
      };
    }
    const k = this.keys;
    let moveX = 0;
    if (k.has('a') || k.has('arrowleft')) moveX -= 1;
    if (k.has('d') || k.has('arrowright')) moveX += 1;
    const jetpack = k.has('w') || k.has(' ') || k.has('arrowup') || k.has('e');
    const aim = Math.atan2(this.mouse.y - this.playerWorld.y, this.mouse.x - this.playerWorld.x);
    return {
      moveX,
      aimAngle: aim,
      fire: this.mouseDown,
      jump: false,
      jetpack,
      reload: k.has('r')
    };
  }
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * this.logicalW,
      y: (clientY - r.top) / r.height * this.logicalH
    };
  }
  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e', 'r'].includes(k)) e.preventDefault();
    if (down) this.keys.add(k);else this.keys.delete(k);
  }
  onTouch(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const relX = t.clientX - r.left;
      if (relX < r.width / 2) {
        this.tMoveX = Math.max(-1, Math.min(1, (relX / (r.width / 2) - 0.5) * 2));
      } else {
        const w = this.toWorld(t.clientX, t.clientY);
        this.tAim = Math.atan2(w.y - this.playerWorld.y, w.x - this.playerWorld.x);
        this.tFire = true;
      }
    }
  }
  onTouchEnd(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const relX = t.clientX - r.left;
      if (relX >= r.width / 2) this.tFire = false;else this.tMoveX = 0;
    }
  }
}
exports.Controls = Controls;
    },
    "src/web/fullscreen.ts": function(module, exports, __require) {
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
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
    "src/web/main-proto.ts": function(module, exports, __require) {
"use strict";

var _world = __require("src/core/sim/world.ts");
var _types = __require("src/core/types.ts");
var _ServerSim = __require("src/net/ServerSim.ts");
var _physics = __require("src/core/sim/physics.ts");
var _wrap = __require("src/core/wrap.ts");
var _weapons = __require("src/core/weapons.ts");
var _controls = __require("src/web/controls.ts");
var _fullscreen = __require("src/web/fullscreen.ts");
const W = 960;
const H = 600;
const canvas = document.getElementById('game');
const vp = (0, _fullscreen.fitCanvas)(canvas, W, H);
const ctx = canvas.getContext('2d');
const controls = new _controls.Controls(canvas, W, H, {
  onFullscreen: _fullscreen.toggleFullscreen
});
const SEED = 20261106;
const world = new _world.World(SEED);
world.config.loadoutLock = false;
const server = new _ServerSim.ServerSim(world);
const player = world.addPlayer('YOU', 'red');
player.pos = {
  x: 1700,
  y: 1750
};
player.weaponIndex = 1;
const bots = [world.addPlayer('AI-1', 'blue'), world.addPlayer('AI-2', 'blue')];
bots[0].pos = {
  x: 2300,
  y: 1750
};
bots[1].pos = {
  x: 1200,
  y: 2200
};
let playerInput = (0, _types.defaultWorldInput)();
const botInputs = new Map();
const weaponKeyMap = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3
};
let wantSecondary = null;
let wantInteract = false;
let wantSwitch = null;
const secOrder = Object.keys(_weapons.SECONDARIES);
let secIndex = 0;
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (weaponKeyMap[k] !== undefined) wantSwitch = weaponKeyMap[k];
  if (k === 'g') wantSecondary = secOrder[secIndex];
  if (k === 't') secIndex = (secIndex + 1) % secOrder.length;
  if (k === 'e') wantInteract = true;
});
for (const id of ['btn-jump', 'btn-jet']) {
  document.getElementById(id)?.addEventListener('touchstart', e => {
    e.preventDefault();
    controls.setJetpack(true);
  });
  document.getElementById(id)?.addEventListener('touchend', () => controls.setJetpack(false));
}
document.getElementById('btn-reload')?.addEventListener('touchstart', e => {
  e.preventDefault();
  controls.pressReload();
});
function toIntents(t) {
  const out = [];
  let moveDir = 0;
  if (t.moveX > 0.2) moveDir = 1;else if (t.moveX < -0.2) moveDir = -1;
  out.push({
    t: 'move',
    dir: moveDir
  });
  out.push({
    t: 'aim',
    angle: t.aimAngle
  });
  out.push({
    t: 'fire',
    on: t.fire
  });
  out.push({
    t: 'jetpack',
    on: t.jetpack
  });
  if (t.reload) out.push({
    t: 'reload'
  });
  if (wantInteract) {
    out.push({
      t: 'interact'
    });
    wantInteract = false;
  }
  if (wantSecondary) {
    const tx = (0, _wrap.wrapX)(player.pos.x + Math.cos(t.aimAngle) * 240);
    const ty = (0, _wrap.wrapY)(player.pos.y + Math.sin(t.aimAngle) * 240);
    out.push({
      t: 'secondary',
      kind: wantSecondary,
      targetX: tx,
      targetY: ty
    });
    wantSecondary = null;
  }
  if (wantSwitch !== null) {
    out.push({
      t: 'switchWeapon',
      index: wantSwitch
    });
    wantSwitch = null;
  }
  return out;
}
function botInput(bot) {
  const enemies = [player, ...bots.filter(b => b !== bot)];
  let target = enemies[0];
  let best = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = (0, _wrap.wrapDist)(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y);
    if (d < best) {
      best = d;
      target = e;
    }
  }
  const dx = (0, _wrap.wrapDeltaX)(bot.pos.x, target.pos.x);
  const dy = (0, _wrap.wrapDeltaY)(bot.pos.y - 12, target.pos.y - 12);
  const aim = Math.atan2(dy, dx);
  let move = 0;
  if (Math.abs(dx) > 320) move = dx > 0 ? 1 : -1;else if (Math.abs(dx) < 160) move = dx > 0 ? -1 : 1;
  return {
    ...(0, _types.defaultWorldInput)(),
    move,
    aim,
    fire: world.tick % 10 < 4
  };
}
const cam = {
  x: player.pos.x,
  y: player.pos.y
};
function updateCamera() {
  const tx = cam.x + (0, _wrap.wrapDeltaX)(cam.x, player.pos.x) * 0.12;
  const ty = cam.y + (0, _wrap.wrapDeltaY)(cam.y, player.pos.y) * 0.12;
  cam.x = (0, _wrap.wrapX)(tx);
  cam.y = (0, _wrap.wrapY)(ty);
}
function screenOf(wx, wy) {
  const dx = (0, _wrap.wrapDeltaX)(cam.x, wx);
  const dy = (0, _wrap.wrapDeltaY)(cam.y, wy);
  return {
    x: W / 2 + dx,
    y: H / 2 + dy
  };
}
function render() {
  vp.applyTransform();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, W, H);
  for (const r of world.terrain.rects) {
    const p = screenOf(r.x + r.w / 2, r.y + r.h / 2);
    const left = p.x - r.w / 2;
    const top = p.y - r.h / 2;
    if (left > W + 40 || left + r.w < -40 || top > H + 40 || top + r.h < -40) continue;
    ctx.fillStyle = r.color;
    ctx.fillRect(left, top, r.w, r.h);
    if (r.borderColor) {
      ctx.strokeStyle = r.borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, r.w - 1, r.h - 1);
    }
  }
  for (const s of world.terrain.shadows) {
    const p = screenOf(s.x + s.w / 2, s.y + s.h / 2);
    if (p.x - s.w / 2 > W || p.x + s.w / 2 < 0 || p.y - s.h / 2 > H || p.y + s.h / 2 < 0) continue;
    ctx.fillStyle = `rgba(0,0,0,${s.alpha})`;
    ctx.fillRect(p.x - s.w / 2, p.y - s.h / 2, s.w, s.h);
  }
  for (const ob of world.obstacles) {
    const p = screenOf(ob.x + ob.w / 2, ob.y + ob.h / 2);
    const left = p.x - ob.w / 2,
      top = p.y - ob.h / 2;
    if (left > W + 40 || left + ob.w < -40 || top > H + 40 || top + ob.h < -40) continue;
    ctx.fillStyle = ob.color;
    ctx.fillRect(left, top, ob.w, ob.h);
    ctx.strokeStyle = ob.borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(left, top - 6, ob.w, 3);
    ctx.fillStyle = '#5ad37a';
    ctx.fillRect(left, top - 6, ob.w * (ob.hp / ob.maxHp), 3);
  }
  for (const cp of world.capturePoints) {
    const p = screenOf(cp.x, cp.y);
    if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
    const teamColor = cp.ownerTeam === 'red' ? '#f43f5e' : cp.ownerTeam === 'blue' ? '#0ea5e9' : cp.ownerTeam === 'green' ? '#10b981' : cp.ownerTeam === 'ffa' ? '#eab308' : '#94a3b8';
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`🚩${cp.code} ${Math.round(cp.progress)}%`, p.x, p.y - 64);
  }
  for (const a of world.ammoPacks) {
    const p = screenOf(a.x, a.y);
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
  }
  for (const c of world.supplyCrates) {
    if (!c.active) continue;
    const p = screenOf(c.x, c.y);
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
    ctx.fillStyle = c.color;
    ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
  }
  for (const m of world.mortars) {
    const p = screenOf(m.x, m.y);
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
    ctx.fillStyle = m.operatorId ? '#f97316' : '#64748b';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const m of world.landmines) {
    if (m.respawnTimer > 0) continue;
    const p = screenOf(m.pos.x, m.pos.y);
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
    ctx.fillStyle = m.triggered ? '#ef4444' : m.preset ? '#f59e0b' : '#fb7185';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const g of world.grenades) {
    const p = screenOf(g.pos.x, g.pos.y);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const st of world.airstrikes) {
    const p = screenOf(st.pos.x, st.pos.y);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 40, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const pr of world.projectiles) {
    const p = screenOf(pr.pos.x, pr.pos.y);
    if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue;
    ctx.fillStyle = pr.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pr.r, 0, Math.PI * 2);
    ctx.fill();
  }
  drawPlayer(player, '#4ade80', 'YOU');
  for (const b of bots) drawPlayer(b, '#f87171', b.name);
  const hud = [`❤ ${player.hp}/${player.maxHp}   ${_weapons.WEAPONS[player.weaponIndex].shortName} ${player.ammo[player.weaponIndex]}/${player.reserveAmmo[player.weaponIndex]}   🛡${player.shieldTimer > 0 ? player.shieldHp : '-'}`, `副武器: ${_weapons.SECONDARIES[secOrder[secIndex]].icon} ${_weapons.SECONDARIES[secOrder[secIndex]].name} [T切换 G使用]   🚩 ${world.capturePoints.map(c => `${c.code}:${Math.round(c.progress)}%`).join(' ')}`, `比分 R/B/G ${world.scores.red}/${world.scores.blue}/${world.scores.green}   pos=(${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)})   tick=${world.tick}`];
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(8, 8, 680, 62);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  hud.forEach((line, i) => ctx.fillText(line, 14, 24 + i * 18));
  const cross = screenOf(player.pos.x + Math.cos(player.aim) * 240, player.pos.y - 12 + Math.sin(player.aim) * 240);
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cross.x - 6, cross.y);
  ctx.lineTo(cross.x + 6, cross.y);
  ctx.moveTo(cross.x, cross.y - 6);
  ctx.lineTo(cross.x, cross.y + 6);
  ctx.stroke();
}
function drawPlayer(p, color, label) {
  const s = screenOf(p.pos.x, p.pos.y);
  ctx.fillStyle = p.alive ? color : '#475569';
  ctx.fillRect(s.x - 10, s.y - 26, 20, 42);
  ctx.beginPath();
  ctx.arc(s.x, s.y - 24, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 12);
  ctx.lineTo(s.x + Math.cos(p.aim) * 34, s.y - 12 + Math.sin(p.aim) * 34);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.fillRect(s.x - 18, s.y - 40, 36, 4);
  ctx.fillStyle = p.hp > 50 ? '#5ad37a' : p.hp > 25 ? '#e0b74d' : '#e05a5a';
  ctx.fillRect(s.x - 18, s.y - 40, 36 * Math.max(0, p.hp) / p.maxHp, 4);
  if (p.shieldTimer > 0) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y - 12, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${label} ${p.kills}/${p.deaths}`, s.x, s.y - 46);
}
let last = performance.now();
let acc = 0;
const FIXED = 1 / 60;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  let guard = 0;
  while (acc >= FIXED && guard < 5) {
    const t = controls.getState();
    controls.setPlayerScreen(W / 2, H / 2);
    playerInput = (0, _ServerSim.applyIntents)(playerInput, toIntents(t));
    botInputs.clear();
    for (const b of bots) botInputs.set(b.id, botInput(b));
    const inputs = new Map([[player.id, playerInput], ...botInputs]);
    world.step(FIXED, inputs);
    world.drainEvents();
    controls.consumeMomentary();
    acc -= FIXED;
    guard++;
  }
  updateCamera();
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__dbg = {
  world,
  controls,
  get player() {
    return player;
  },
  get bots() {
    return bots;
  },
  get camera() {
    return cam;
  }
};
const PARAM_KEY = 'pvp-physics-params-v2';
function persistParams(p) {
  try {
    localStorage.setItem(PARAM_KEY, JSON.stringify(p));
  } catch {}
}
function clearParams() {
  try {
    localStorage.removeItem(PARAM_KEY);
  } catch {}
}
;
(function loadSavedParams() {
  try {
    const raw = localStorage.getItem(PARAM_KEY);
    if (raw) (0, _physics.setPhysicsParams)(JSON.parse(raw));
  } catch {}
})();
window.__tune = {
  set: p => {
    const cur = (0, _physics.setPhysicsParams)(p);
    persistParams(cur);
    return cur;
  },
  get: () => (0, _physics.getPhysicsParams)(),
  reset: () => {
    const cur = (0, _physics.resetPhysicsParams)();
    clearParams();
    return cur;
  }
};
    },
  };
  const __cache = {};
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const mod = __cache[id] = { exports: {} };
    __modules[id](mod, mod.exports, __require);
    return mod.exports;
  }
  __require("src/web/main-proto.ts");
})();
