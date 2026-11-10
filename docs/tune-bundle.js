"use strict";
(() => {
  // src/core/sim/physics.ts
  var defaults = {
    mass: 1.3,
    // 用户调优值：稍重
    gravity: 1250,
    moveSpeed: 300,
    // 水平极速（无惯性：按下即达，松开即停）
    jumpImpulse: 490,
    // 用户调优值
    maxFall: 1200,
    jetpackAccel: 4200,
    // 更快响应：净加速 (4200-1250)/1.3 ≈ 2269/s → 约 0.12s 到升空极速（原 3000≈0.21s）
    jetpackMaxUp: 280,
    // 用户调优值：升空速度上限（短促小跳手感）
    jetpackFuel: 1,
    // 飞行槽 = 原值 0.5 的两倍：满能量可喷 2s（drain 0.5）
    jetpackDrain: 0.5,
    // 每秒消耗半槽
    jetpackRecharge: 0.7
    // 落地回充：约 1.43s 回满（空中不回充）
  };
  var P = { ...defaults };
  function getPhysicsParams() {
    return { ...P };
  }
  function setPhysicsParams(overrides) {
    P = { ...P, ...overrides };
    return { ...P };
  }
  function resetPhysicsParams() {
    P = { ...defaults };
    return { ...P };
  }
  function applyGravity(v, dt, mult = 1) {
    v.y += P.gravity / P.mass * mult * dt;
    const cap = mult > 1 ? P.maxFall * 1.6 : P.maxFall;
    if (v.y > cap) v.y = cap;
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
  var RECOIL_SCALE = 0.56;
  var RECOIL_DECAY = 7;
  var RECOIL_EPSILON = 4;
  function recoilDelta(recoil, aim) {
    return { x: -Math.cos(aim) * recoil * RECOIL_SCALE, y: -Math.sin(aim) * recoil * RECOIL_SCALE };
  }
  var RECOIL_INTEGRAL = (1 - Math.exp(-RECOIL_DECAY * (1 / 60))) / RECOIL_DECAY;
  var RECOIL_DISPLACEMENT_FACTOR = RECOIL_INTEGRAL;
  function stepRecoilVel(rv, dt) {
    const k = Math.exp(-RECOIL_DECAY * dt);
    rv.x *= k;
    rv.y *= k;
    if (Math.hypot(rv.x, rv.y) < RECOIL_EPSILON) {
      rv.x = 0;
      rv.y = 0;
    }
  }

  // src/core/wrap.ts
  var WORLD_W = 13200;
  var WORLD_H = 4400;
  var SURFACE_Y = 2800;
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

  // src/core/map.ts
  var CEILING_TOP = 280;
  var CEILING_THICK = 80;
  var WALL_THICK = 60;
  var MAIN_DECK_TOP = 1760;
  var MAIN_DECK_THICK = 40;
  var ARCH_CENTER_TOP = 680;
  var UNIFIED_EDGE_HIGHLIGHT = "#38bdf8";
  function defaultMapData() {
    const solids = [
      // ── 1. 四面封闭边界（顶部完整无入口天花板 + 左右全高封闭墙；底部由世界内置 SURFACE_Y=2800 封闭） ──
      { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: "platform" },
      { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" },
      { x: WORLD_W - WALL_THICK, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" },
      // ── 2. 天空拱形浮空方块群（有上有下高低交错，正中 x=6600 放置复活点与旗帜） ──
      ...SKY_ARCH_BLOCKS(),
      // ── 3. 中层地表主平台（y=1760，出生点所在平面）+ 左翼高掩体柱 ──
      // 左翼出生台与主平台（x=500..680 留 180px 狭窄竖井通往地下地道）
      { x: WALL_THICK, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: "platform" },
      { x: 680, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: "platform" },
      // 左翼出生点旁高耸掩体柱（对应设计图左侧出生点旁高框）
      { x: 740, y: 1440, w: 120, h: 320, kind: "cover" },
      // 右翼主平台与出生台（x=12520..12700 留 180px 狭窄竖井通往地下地道）
      { x: 8e3, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: "platform" },
      { x: 12700, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: "platform" },
      // ── 4. 地下区域（y > 1760）：全部采用实心岩体围合成狭窄地道（高 120~160px，竖井宽 160~260px） ──
      ...UNDERGROUND_NARROW_TUNNEL_SOLIDS()
    ];
    return { name: "\u5C01\u95ED\u62F1\u9876\xB7\u5730\u4E0B\u72ED\u9053\u7ADE\u6280\u573A", solids };
  }
  function SKY_ARCH_BLOCKS() {
    return [
      // 左侧阶梯上升段
      { x: 1200, y: 1280, w: 200, h: 360, kind: "block" },
      { x: 1680, y: 1080, w: 420, h: 240, kind: "block" },
      { x: 2740, y: 700, w: 720, h: 220, kind: "block" },
      // 拱顶左峰（高）
      { x: 3940, y: 560, w: 880, h: 220, kind: "block" },
      // 左中交错块（下沉，体现“有上有下”）
      { x: 5220, y: 760, w: 560, h: 220, kind: "block" },
      // 正中央主方块（x=6200..7000，中心 x=6600，顶面 y=680：放置正中旗帜与复活点）
      { x: 6200, y: ARCH_CENTER_TOP, w: 800, h: 220, kind: "block" },
      // 拱顶右峰（高，体现“有上有下”）
      { x: 7420, y: 560, w: 720, h: 220, kind: "block" },
      // 右中交错块（下沉）
      { x: 8580, y: 740, w: 720, h: 240, kind: "block" },
      // 右侧阶梯下降段
      { x: 9700, y: 920, w: 580, h: 260, kind: "block" },
      { x: 10680, y: 1080, w: 440, h: 280, kind: "block" },
      { x: 11480, y: 1240, w: 200, h: 360, kind: "block" },
      { x: 12020, y: 1320, w: 200, h: 340, kind: "block" }
    ];
  }
  function UNDERGROUND_NARROW_TUNNEL_SOLIDS() {
    return [
      // ── A. 左右浅层狭道顶部悬挂掩体块（对应设计图主平台横线下方的掩体块） ──
      { x: 1800, y: 1800, w: 260, h: 60, kind: "cover" },
      { x: 3e3, y: 1800, w: 260, h: 70, kind: "cover" },
      { x: 4100, y: 1800, w: 220, h: 60, kind: "cover" },
      { x: 9e3, y: 1800, w: 180, h: 60, kind: "cover" },
      { x: 1e4, y: 1800, w: 240, h: 60, kind: "cover" },
      { x: 11100, y: 1800, w: 340, h: 70, kind: "block" },
      // ── B. 左右两侧地下实心岩层（围合出左侧 x=500..680 与右侧 x=12520..12700 的 L 型狭窄地道） ──
      // 左端外侧全高地下实心墙（x=60..500, y=1800..2660，底部预留 y=2660..2800 底层贯通狭道）
      { x: WALL_THICK, y: 1800, w: 440, h: 860, kind: "block" },
      // 左侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=1280..1440 联络竖井）
      { x: 680, y: 2040, w: 600, h: 320, kind: "block" },
      { x: 1440, y: 2040, w: 1060, h: 320, kind: "block" },
      // 左侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
      { x: 680, y: 2500, w: 1820, h: 160, kind: "block" },
      // 右端外侧全高地下实心墙（x=12700..13140, y=1800..2660）
      { x: 12700, y: 1800, w: 440, h: 860, kind: "block" },
      // 右侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=11760..11920 联络竖井）
      { x: 10700, y: 2040, w: 1060, h: 320, kind: "block" },
      { x: 11920, y: 2040, w: 600, h: 320, kind: "block" },
      // 右侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
      { x: 10700, y: 2500, w: 1820, h: 160, kind: "block" },
      // ── C. 中央地下顶盖与中央下沉狭窄井道（y=1800..2160） ──
      // 左中顶盖岩层（x=2500..5200, y=2040..2160，厚 120px，上方为浅层狭道，下方为 y=2160..2280 地下上层狭道）
      { x: 2500, y: 2040, w: 2700, h: 120, kind: "platform" },
      // 右中顶盖岩层（x=8000..10700, y=2040..2160，厚 120px）
      { x: 8e3, y: 2040, w: 2700, h: 120, kind: "platform" },
      // 中央咽喉区左肩巨石（x=5380..6260, y=1800..2160，留出 x=5200..5380 宽 180px 的西侧下沉竖井）
      { x: 5380, y: 1800, w: 880, h: 360, kind: "block" },
      // 中央咽喉区右肩巨石（留出 x=6260..6660 中央竖井、x=7020..7360 东侧竖井及 x=7820..8000 边缘竖井）
      { x: 6660, y: 1800, w: 360, h: 360, kind: "block" },
      { x: 7360, y: 1800, w: 460, h: 360, kind: "block" },
      // ── D. 中央地下迷宫核心岩体群（围合出上 y=2160..2280、中 y=2380..2500、下 y=2660..2800 三层狭窄横道与多条狭窄竖井） ──
      // 1. 左侧竖直巨岩（左留 x=2500..2660 竖井，右留 x=3220..3380 竖井）
      { x: 2660, y: 2280, w: 560, h: 380, kind: "block" },
      // 2. 左中上层横岩（上留 y=2160..2280 狭道，下留 y=2380..2500 狭道）
      { x: 3380, y: 2280, w: 2240, h: 100, kind: "block" },
      // 3. 左中下层横岩（上留 y=2380..2500 狭道，下留 y=2660..2800 底层狭道）
      { x: 3380, y: 2500, w: 2240, h: 160, kind: "block" },
      // 4. 正中竖直巨柱（左留 x=5620..5820 竖井，右留 x=6380..6640 核心中央竖井）
      { x: 5820, y: 2280, w: 560, h: 380, kind: "block" },
      // 5. 右中上层横岩（预留 x=7020..7180 狭窄竖井供垂直机动与射击）
      { x: 6640, y: 2280, w: 380, h: 100, kind: "block" },
      { x: 7180, y: 2280, w: 1920, h: 100, kind: "block" },
      // 6. 右中下层横岩（预留 x=7020..7180 狭窄竖井）
      { x: 6640, y: 2500, w: 380, h: 160, kind: "block" },
      { x: 7180, y: 2500, w: 1920, h: 160, kind: "block" },
      // 7. 右侧竖直巨岩（左留 x=9100..9260 竖井，右留 x=10540..10700 竖井）
      { x: 9260, y: 2280, w: 1280, h: 380, kind: "block" }
    ];
  }

  // src/core/terrain.ts
  var TILE_SIZE = 20;
  var GRID_W = Math.floor(WORLD_W / TILE_SIZE);
  var GRID_H = Math.floor(WORLD_H / TILE_SIZE);
  var UNIFIED_FILL = "#1e293b";
  var UNIFIED_BORDER = UNIFIED_EDGE_HIGHLIGHT;
  var Terrain = class {
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
    addSolidBlock(x, y, w, h, color, borderColor, kind, label = "") {
      this.setGridRect(x, y, w, h, 2);
      this.rects.push({ x, y, w, h, color, borderColor, kind, label });
    }
    /** 装饰图元：只进渲染列表、不写碰撞网格 */
    addDeco(x, y, w, h, kind, color, borderColor = "") {
      this.rects.push({ x, y, w, h, color, borderColor, kind, label: "" });
    }
    /** 挖空（保留供扩展） */
    carveTunnel(x, y, w, h, label = "\u5730\u4E0B\u5730\u9053") {
      this.setGridRect(x, y, w, h, 0);
      this.rects.push({ x, y, w, h, color: "#090d16", borderColor: UNIFIED_BORDER, kind: "tunnel_bg", label });
      this.shadows.push({ x, y, w, h, label, alpha: 0.76 });
    }
    build(customSolids) {
      this.grid.fill(0);
      this.rects.length = 0;
      this.shadows.length = 0;
      this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, UNIFIED_FILL, UNIFIED_BORDER, "earth");
      const list = customSolids ?? defaultMapData().solids;
      for (const r of list) {
        const label = r.kind === "platform" ? "\u5E73\u53F0" : r.kind === "block" ? "\u65B9\u5757" : "\u63A9\u4F53";
        this.addSolidBlock(r.x, r.y, r.w, r.h, UNIFIED_FILL, UNIFIED_BORDER, r.kind, label);
      }
    }
    /** 点是否被原始地形挡住（双轴环形 x/y） */
    isSolidAt(x, y) {
      const wx = wrapX(x);
      const wy = wrapY(y);
      const gx = Math.floor(wx / TILE_SIZE);
      const gy = Math.floor(wy / TILE_SIZE);
      const gyy = (gy % GRID_H + GRID_H) % GRID_H;
      if (gx >= 0 && gx < GRID_W && gyy >= 0 && gyy < GRID_H) {
        if (this.grid[gyy * GRID_W + gx] !== 0) return true;
      }
      return false;
    }
  };
  var OBSTACLE_PRESETS = [
    { id: "obs_1", x: 1600, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_2", x: 3400, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_3", x: 4600, y: 240, w: 60, h: 80, hp: 240, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_box_1", x: 5400, y: 238, w: 68, h: 70, hp: 170, label: "\u91CD\u88C5\u63A9\u4F53\u7BB1", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_5", x: 7800, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_6", x: 11200, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER },
    { id: "obs_7", x: 12500, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#1e293b", borderColor: UNIFIED_BORDER }
  ];

  // src/core/rng.ts
  var Rng = class {
    s;
    constructor(seed) {
      this.s = seed >>> 0 || 2654435769;
    }
    /** [0,1) 均匀分布 */
    next() {
      this.s = this.s + 1831565813 | 0;
      let t = this.s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    /** [min,max) 浮点 */
    range(min, max) {
      return min + this.next() * (max - min);
    }
    /** [0,n) 整数（均匀，无取模偏置） */
    int(n) {
      return Math.floor(this.next() * n);
    }
    /** 从数组均匀取一个 */
    pick(arr) {
      return arr[this.int(arr.length)];
    }
  };

  // src/core/weapons.ts
  var WEAPONS = [
    {
      id: 0,
      name: "\u9730\u5F39\u67AA",
      shortName: "\u9730\u5F39",
      isSupplyOnly: false,
      damage: 24,
      headshotMult: 1,
      pellets: 8,
      spread: 0.24,
      grazeDamageMin: 20,
      shellReload: true,
      // 伤害=手枪弹；每颗弹丸独立擦边；逐发装填
      speed: 1e3,
      recoil: 1560,
      magSize: 8,
      maxReserve: 72,
      // 后坐力 ×2
      // 满匣射击间隔 0.42s（原 0.58s）；「边装边打」保持原 0.87s 不变 → 倍率 0.87/0.42≈2.0714
      reloadTime: 1.5,
      fireDelay: 0.42,
      shellReloadFireDelayMult: 2.0714285714285716,
      terrainRadius: 12,
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 1.08,
      fuelMult: 1.05,
      fovMult: 1,
      color: "#fbbf24",
      falloffStart: 200,
      falloffEnd: 700,
      falloffMin: 0.45,
      // 霰弹随距离衰减（中距仍可用）
      traitDesc: "\u8FD1\u8DDD\u9AD8\u4F24 \xB7 \u5168\u4E2D\u81F4\u6B7B"
    },
    {
      id: 1,
      name: "\u7A81\u51FB\u6B65\u67AA",
      shortName: "\u7A81\u51FB\u6B65\u67AA",
      isSupplyOnly: false,
      damage: 37,
      headshotMult: 2.2,
      pellets: 1,
      spread: 0.045,
      grazeDamageMin: 30,
      // 命中主体 37；擦边按几何质量线性降到 30（大多数命中 33~34）
      speed: 1500,
      recoil: 84,
      magSize: 30,
      maxReserve: 90,
      // 30/90
      reloadTime: 1.7,
      fireDelay: 0.12,
      terrainRadius: 8,
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 1,
      fuelMult: 1,
      fovMult: 1,
      color: "#38bdf8",
      traitDesc: "\u7A33\u5B9A\u8FDE\u53D1 \xB7 \u5747\u8861\u4E3B\u529B"
    },
    {
      id: 2,
      name: "\u72D9\u51FB\u6B65\u67AA",
      shortName: "\u72D9",
      isSupplyOnly: false,
      damage: 137,
      headshotMult: 2.5,
      pellets: 1,
      spread: 3e-3,
      speed: 4e3,
      recoil: 390,
      magSize: 3,
      maxReserve: 15,
      reloadTime: 2.8,
      fireDelay: 0.95,
      chargeSeconds: 0.5,
      terrainRadius: 16,
      // 按下后读条 0.5s 自动发射
      explosive: false,
      laser: true,
      pierceOnHeadshot: true,
      lifeSeconds: 999,
      moveSpeedMult: 0.6,
      fuelMult: 0.6,
      fovMult: 1.3,
      color: "#c084fc",
      // 狙击擦边分级：正中（穿心）= 137，越靠碰撞箱边缘越低，最低 99。
      // edgeDamage 保留=99，作为「边缘命中上限」（连续分级的最低档即 99）。
      edgeDamage: 99,
      grazeDamageMin: 99,
      farRange: 900,
      farDamage: 99,
      // 超过 900px 额外衰减到 99（远距离不再必杀）
      traitDesc: "\u65E0\u9650\u5C04\u7A0B \xB7 \u547D\u4E2D\u5373\u6B7B"
    },
    {
      id: 3,
      name: "\u706B\u7BAD\u7B52",
      shortName: "\u706B\u7BAD\u7B52",
      isSupplyOnly: false,
      damage: 160,
      headshotMult: 1.5,
      pellets: 1,
      spread: 0,
      blastFalloffExponent: 1.8,
      // 伤害 115→160；爆炸范围不变(124)，衰减更陡
      speed: 780,
      recoil: 420,
      magSize: 1,
      maxReserve: 20,
      // 弹速 ×1.5（520→780）；1 发/弹匣，共 20 个弹匣；换弹 2s
      reloadTime: 2,
      fireDelay: 0,
      terrainRadius: 124,
      // 射击间隔 = 0（节奏由 2s 换弹决定）
      explosive: true,
      gravityScale: 0,
      lifeSeconds: 999,
      rocket: true,
      pierceOnHeadshot: false,
      moveSpeedMult: 1,
      fuelMult: 1,
      ascendMult: 1,
      fovMult: 1,
      color: "#fb7185",
      // 移速/飞行容量/升空速度全部 1×
      friendlyFire: true,
      selfDamage: true,
      // 火箭筒：爆炸友伤/自伤
      traitDesc: "\u76F4\u7EBF\u6162\u901F \xB7 \u78B0\u5230\u7206\u70B8"
    },
    {
      id: 4,
      name: "\u9AD8\u65AF\u67AA",
      shortName: "\u9AD8\u65AF\u67AA",
      isSupplyOnly: true,
      damage: 25,
      headshotMult: 2,
      pellets: 1,
      spread: 0,
      speed: 3e3,
      recoil: 0,
      magSize: 24,
      maxReserve: 48,
      // 24 / 6每秒 = 连续 4 秒
      reloadTime: 3,
      fireDelay: 0,
      terrainRadius: 18,
      // 换弹 3s（平衡性补丁：减半）
      explosive: false,
      laser: true,
      pierceAll: true,
      pierceOnHeadshot: true,
      bounces: 2,
      beam: true,
      friendlyFire: true,
      selfDamage: true,
      // 高斯：全部段可打到友军/自己
      damagePerSecond: 90,
      ammoPerSecond: 6,
      moveSpeedMult: 0.95,
      fuelMult: 1,
      fovMult: 1,
      color: "#22d3ee",
      traitDesc: "\u5373\u65F6\u5149\u675F \xB7 \u53CD\u5C042\u6B21 \xB7 \u5168\u6BB5\u81EA\u4F24"
    },
    {
      id: 5,
      name: "M249",
      shortName: "M249",
      isSupplyOnly: true,
      damage: 37,
      headshotMult: 1.8,
      pellets: 1,
      spread: 0.11,
      grazeDamageMin: 30,
      // 与突击步枪同步（37，擦边降到 30）
      speed: 1300,
      recoil: 66,
      magSize: 120,
      maxReserve: 240,
      reloadTime: 3,
      fireDelay: 0.06,
      terrainRadius: 8,
      // M249 伤害=突击(37，同步擦边分级)，高射速补给枪
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 0.78,
      fuelMult: 0.7,
      fovMult: 1.3,
      color: "#f97316",
      traitDesc: "\u91CD\u578B\u673A\u67AA \xB7 \u706B\u529B\u538B\u5236"
    },
    {
      id: 6,
      name: "\u5F15\u529B\u67AA",
      shortName: "\u5F15\u529B\u67AA",
      isSupplyOnly: true,
      damage: 24,
      headshotMult: 1.6,
      pellets: 1,
      spread: 0.01,
      // 伤害降低（=手枪）
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
      // 引力枪：爆炸友伤/自伤
      pierceOnHeadshot: false,
      moveSpeedMult: 0.86,
      fuelMult: 0.8,
      fovMult: 1,
      color: "#a855f7",
      // 引力场弯曲其他子弹
      falloffStart: 200,
      falloffEnd: 700,
      falloffMin: 0.12,
      // 射程与霰弹类似（200→700），远端衰减更狠
      traitDesc: "\u7A7F\u5899\u5F15\u529B\u573A \xB7 \u5F2F\u6298\u5F39\u9053"
    },
    {
      id: 7,
      name: "\u624B\u67AA",
      shortName: "\u624B\u67AA",
      isSupplyOnly: false,
      damage: 24,
      headshotMult: 2,
      pellets: 1,
      spread: 0.09,
      grazeDamageMin: 20,
      speed: 1e3,
      recoil: 60,
      magSize: 12,
      maxReserve: 60,
      reloadTime: 0.9,
      fireDelay: 0.17,
      terrainRadius: 6,
      explosive: false,
      gravityScale: 0.03,
      pierceOnHeadshot: false,
      moveSpeedMult: 1.5,
      fuelMult: 2,
      ascendMult: 1.25,
      fovMult: 1,
      color: "#fde047",
      // 移速1.5/飞行容量2.0/升空速度1.25
      traitDesc: "\u79FB\u901F\u6700\u5FEB \xB7 \u53CC\u500D\u98DE\u884C"
    },
    {
      id: 8,
      name: "\u51B2\u950B\u67AA",
      shortName: "\u51B2\u950B\u67AA",
      isSupplyOnly: false,
      damage: 24,
      headshotMult: 1.8,
      pellets: 1,
      spread: 0.24,
      grazeDamageMin: 20,
      // 伤害 = 手枪；极高射速用大散布/弹匣平衡
      speed: 1e3,
      recoil: 48,
      magSize: 30,
      maxReserve: 150,
      // 30/150
      reloadTime: 1.2,
      fireDelay: 0.05,
      terrainRadius: 8,
      // 射速极高；换弹 1.2s
      explosive: false,
      gravityScale: 0.04,
      pierceOnHeadshot: false,
      moveSpeedMult: 1.25,
      fuelMult: 1,
      fovMult: 1,
      color: "#4ade80",
      traitDesc: "\u6781\u9AD8\u5C04\u901F \xB7 \u673A\u52A8\u538B\u5236"
    }
  ];
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
  var SECONDARY_UNLOCK_ORDER = [
    "frag",
    "obstacle",
    "shield",
    "teleport",
    "doll"
  ];
  var SECONDARIES = {
    frag: {
      id: "frag",
      name: "\u624B\u69B4\u5F39",
      icon: "\u{1F4A3}",
      cd: 0.8,
      unlockStreak: 0,
      desc: "1 \u5145\u80FD\u81EA\u7136\u56DE\u590D\uFF086s/\u679A\uFF09"
    },
    obstacle: {
      id: "obstacle",
      name: "\u969C\u788D\u7269",
      icon: "\u{1F9F1}",
      cd: 10,
      unlockStreak: 1,
      supplyOnly: true,
      desc: "10s\u51B7\u5374 \xB7 \u65E0\u9650\u751F\u6210240HP\u63A9\u4F53"
    },
    shield: {
      id: "shield",
      name: "\u62A4\u76FE",
      icon: "\u{1F6E1}\uFE0F",
      cd: 10,
      unlockStreak: 2,
      supplyOnly: true,
      desc: "100HP \u62A4\u76FE \xB7 \u4F24\u5BB3\u4E0D\u6EA2\u51FA \xB7 \u78B0\u649E\u7BB1\u7565\u5927"
    },
    teleport: {
      id: "teleport",
      name: "Teleport",
      icon: "\u{1F300}",
      cd: 10,
      unlockStreak: 3,
      supplyOnly: true,
      desc: "\u8BFB\u6761\u540E\u76F4\u63A5\u51FA\u73B0\u5728\u53F3\u952E\u4F4D\u7F6E"
    },
    doll: {
      id: "doll",
      name: "\u66FF\u8EAB\u4EBA\u5076",
      icon: "\u{1F38E}",
      cd: 24,
      unlockStreak: 4,
      supplyOnly: true,
      desc: "\u8FDE\u6B7B4\u89E3\u9501\u6216\u7279\u6B8A\u8865\u7ED9\u62FE\u53D6"
    }
  };
  function isSecondaryUnlocked(secId, deathStreak, dollCharges = 0) {
    const def = SECONDARIES[secId];
    if (!def) return false;
    if (secId === "doll" && dollCharges > 0) return true;
    return (deathStreak ?? 0) >= def.unlockStreak;
  }
  function getHighestUnlockedSecondary(deathStreak, dollCharges = 0) {
    const s = Math.max(0, Math.floor(deathStreak ?? 0));
    for (let i = SECONDARY_UNLOCK_ORDER.length - 1; i >= 0; i--) {
      const id = SECONDARY_UNLOCK_ORDER[i];
      if (s >= SECONDARIES[id].unlockStreak) return id;
    }
    if (dollCharges > 0) return "doll";
    return "frag";
  }
  var DEFAULT_CONFIG = {
    maxHp: 100,
    headRadius: 13,
    shieldHp: 100,
    shieldDuration: 5,
    dollDuration: 10,
    obstacleDefaultHp: 240,
    teleportCastTime: 0.35,
    grenadeDamage: 520,
    // 一发致死：最远衰减(0.2)也有 104 伤害
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
    pistolHeadshotMult: 2,
    captureRadius: 135,
    captureRate: 28,
    ammoPackInterval: 7,
    ammoPackMaxActive: 8,
    supplyRespawnTime: 22,
    watchtowerDuration: 20,
    watchtowerFovMult: 1.65,
    respawnDelay: 4,
    loadoutLock: true,
    randomSpawn: false,
    grenadeFriendlyFire: true,
    grenadeSelfDamage: true,
    fragMaxCharges: 1,
    fragRechargeSeconds: 6,
    dollMaxCharges: 2
  };

  // src/core/types.ts
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

  // src/core/sim/landmarks.ts
  var BODY_HALF_W = 10;
  var BODY_TOP = 26;
  var BODY_BOTTOM = 16;
  var CEILING_STAND = 264;
  var MAIN_DECK_STAND = MAIN_DECK_TOP - 16;
  var CENTER_RESPAWN_X = 6600;
  var CENTER_RESPAWN_Y = ARCH_CENTER_TOP - 16;
  var FFA_SPAWN_POINTS = [
    { x: 1180, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u897F\u7FFC\u5E73\u53F0" },
    { x: 2400, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E2D\u897F\u5E73\u53F0" },
    { x: 3100, y: 700 - 16, team: "ffa", label: "FFA\xB7\u897F\u62F1\u6D6E\u5C9B" },
    { x: 4380, y: 560 - 16, team: "ffa", label: "FFA\xB7\u5DE6\u5CF0\u62F1\u5C9B" },
    { x: 4500, y: 2500 - 16, team: "ffa", label: "FFA\xB7\u897F\u533A\u5730\u9053" },
    { x: 5500, y: 760 - 16, team: "ffa", label: "FFA\xB7\u4E2D\u897F\u62F1\u5C9B" },
    { x: 7780, y: 560 - 16, team: "ffa", label: "FFA\xB7\u53F3\u5CF0\u62F1\u5C9B" },
    { x: 8500, y: 2500 - 16, team: "ffa", label: "FFA\xB7\u4E1C\u533A\u5730\u9053" },
    { x: 9990, y: 920 - 16, team: "ffa", label: "FFA\xB7\u4E1C\u62F1\u6D6E\u5C9B" },
    { x: 10800, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E2D\u4E1C\u5E73\u53F0" },
    { x: 12020, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E1C\u7FFC\u5E73\u53F0" }
  ];
  var SPAWN_POINTS = [
    { x: 260, y: MAIN_DECK_STAND, team: "red" },
    { x: 12940, y: MAIN_DECK_STAND, team: "blue" },
    { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, team: "green" },
    ...FFA_SPAWN_POINTS.map(({ x, y, team }) => ({ x, y, team }))
  ];
  var AMMO_SPOTS = [
    { x: 4950, y: MAIN_DECK_STAND, area: "\u4E2D\u5FC3\u897F\xB7\u4E3B\u5E73\u53F0\u5185\u4FA7\u5F39\u836F\u70B9" },
    { x: 5500, y: 760 - 16, area: "\u4E2D\u5FC3\u897F\xB7\u62F1\u6865\u5F39\u836F\u70B9" },
    { x: 6320, y: CENTER_RESPAWN_Y, area: "\u6B63\u4E2D\u62F1\u9876\xB7\u897F\u4FA7\u5F39\u836F\u70B9" },
    { x: 6880, y: CENTER_RESPAWN_Y, area: "\u6B63\u4E2D\u62F1\u9876\xB7\u4E1C\u4FA7\u5F39\u836F\u70B9" },
    { x: 7780, y: 560 - 16, area: "\u4E2D\u5FC3\u4E1C\xB7\u62F1\u6865\u5F39\u836F\u70B9" },
    { x: 8250, y: MAIN_DECK_STAND, area: "\u4E2D\u5FC3\u4E1C\xB7\u4E3B\u5E73\u53F0\u5185\u4FA7\u5F39\u836F\u70B9" },
    { x: 6500, y: 2800 - 16, area: "\u5730\u4E0B\u4E2D\u592E\u72ED\u9053\xB7\u6838\u5FC3\u5F39\u836F\u70B9" }
  ];
  var SUPPLY_SPOTS = [
    { x: 1500, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u897F\u533A\u8865\u7ED9\u70B9" },
    { x: 3100, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u897F\u8865\u7ED9\u70B9" },
    { x: 4300, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u592E\u897F\u8865\u7ED9\u70B9" },
    { x: 5400, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u533A\u5DE6\u8865\u7ED9\u70B9" },
    { x: 7800, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u533A\u53F3\u8865\u7ED9\u70B9" },
    { x: 10300, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E1C\u533A\u8865\u7ED9\u70B9" }
  ];
  var DOLL_SUPPLY_SPOTS = [
    { x: 4600, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u592E\u897F\u7279\u6B8A\u8865\u7ED9\u70B9" },
    { x: 8560, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E1C\u533A\u7279\u6B8A\u8865\u7ED9\u70B9" }
  ];
  var MORTARS_INIT = [
    { id: "mortar_left", name: "\u897F\u533A\u8FEB\u51FB\u70AE", x: 920, y: CEILING_STAND, angle: -Math.PI * 0.28, power: 24 },
    { id: "mortar_mid_w", name: "\u4E2D\u592E\u897F\u8FEB\u51FB\u70AE", x: 3300, y: CEILING_STAND, angle: -Math.PI * 0.3, power: 23 },
    { id: "mortar_center", name: "\u4E2D\u592E\u8FEB\u51FB\u70AE", x: 5400, y: CEILING_STAND, angle: -Math.PI * 0.35, power: 24.5 },
    { id: "mortar_mid_e", name: "\u4E2D\u592E\u4E1C\u8FEB\u51FB\u70AE", x: 7800, y: CEILING_STAND, angle: -Math.PI * 0.7, power: 23 },
    { id: "mortar_right", name: "\u4E1C\u533A\u8FEB\u51FB\u70AE", x: 12260, y: CEILING_STAND, angle: -Math.PI * 0.72, power: 24 }
  ];
  var MINE_PRESETS = [
    { x: 1720, y: CEILING_STAND },
    { x: 3900, y: CEILING_STAND },
    { x: 5400, y: CEILING_STAND },
    { x: 7800, y: CEILING_STAND },
    { x: 10200, y: CEILING_STAND },
    { x: 11420, y: CEILING_STAND }
  ];
  var WATCHTOWERS = [
    { id: "tower_1", name: "\u897F\u90E8\u77AD\u671B\u5854", x: 3700, y: CEILING_STAND, operatorId: null },
    { id: "tower_2", name: "\u4E2D\u897F\u77AD\u671B\u5854", x: 5400, y: CEILING_STAND, operatorId: null },
    { id: "tower_3", name: "\u4E2D\u592E\u4E1C\u77AD\u671B\u5854", x: 7800, y: CEILING_STAND, operatorId: null },
    { id: "tower_4", name: "\u4E1C\u90E8\u77AD\u671B\u5854", x: 11900, y: CEILING_STAND, operatorId: null }
  ];
  var WARP_PORTALS = [
    { id: "warp_1", name: "W1 \u897F\u533A\u4F20\u9001\u95E8", x: 880, y: CEILING_STAND, targetId: "warp_2", color: "#06b6d4" },
    { id: "warp_2", name: "W2 \u4E2D\u897F\u4F20\u9001\u95E8", x: 3150, y: CEILING_STAND, targetId: "warp_1", color: "#06b6d4" },
    { id: "warp_3", name: "W3 \u4E2D\u592E\u4F20\u9001\u95E8", x: 4700, y: CEILING_STAND, targetId: "warp_4", color: "#a855f7" },
    { id: "warp_4", name: "W4 \u4E2D\u4E1C\u4F20\u9001\u95E8", x: 1e4, y: CEILING_STAND, targetId: "warp_3", color: "#a855f7" },
    { id: "warp_5", name: "W5 \u4E2D\u592E\u4E1C\u4F20\u9001\u95E8", x: 5400, y: CEILING_STAND, targetId: "warp_6", color: "#10b981" },
    { id: "warp_6", name: "W6 \u4E1C\u533A\u4F20\u9001\u95E8", x: 12280, y: CEILING_STAND, targetId: "warp_5", color: "#10b981" }
  ];
  var RANDOM_SPAWN_CANDIDATES = [
    { x: 1180, y: MAIN_DECK_STAND - 20 },
    { x: 2400, y: MAIN_DECK_STAND - 20 },
    { x: 3600, y: MAIN_DECK_STAND - 20 },
    { x: 4700, y: MAIN_DECK_STAND - 20 },
    { x: 3100, y: 700 - 36 },
    { x: 4380, y: 560 - 36 },
    { x: 5500, y: 760 - 36 },
    { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y - 24 },
    { x: 7780, y: 560 - 36 },
    { x: 8940, y: 740 - 36 },
    { x: 9990, y: 920 - 36 },
    { x: 8500, y: MAIN_DECK_STAND - 20 },
    { x: 9600, y: MAIN_DECK_STAND - 20 },
    { x: 10800, y: MAIN_DECK_STAND - 20 },
    { x: 12020, y: MAIN_DECK_STAND - 20 },
    { x: 4500, y: 2500 - 24 },
    { x: 6500, y: 2800 - 24 },
    { x: 8500, y: 2500 - 24 }
  ];
  var JUMP_PADS = [
    { x: 1e3, y: 280, vx: 210, vy: -810 },
    { x: 4300, y: 280, vx: 180, vy: -870 },
    { x: 10400, y: 280, vx: -180, vy: -870 },
    { x: 13050, y: 280, vx: -210, vy: -810 }
  ];
  var CP_INITS = [
    { id: "cp_a", code: "A", name: "\u636E\u70B9A\xB7\u897F\u533A", x: 1720, y: CEILING_STAND, ownerTeam: null },
    { id: "cp_b", code: "B", name: "\u636E\u70B9B\xB7\u4E2D\u592E\u897F", x: 3900, y: CEILING_STAND, ownerTeam: null },
    { id: "cp_c", code: "C", name: "\u6B63\u4E2D\u590D\u6D3B\u70B9", x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, ownerTeam: null },
    { id: "cp_d", code: "D", name: "\u636E\u70B9D\xB7\u4E2D\u4E1C", x: 7800, y: CEILING_STAND, ownerTeam: null },
    { id: "cp_e", code: "E", name: "\u636E\u70B9E\xB7\u4E1C\u533A", x: 11420, y: CEILING_STAND, ownerTeam: null }
  ];

  // src/core/sim/spatial.ts
  var BUCKET_SIZE = 200;
  var INV_BUCKET_SIZE = 1 / BUCKET_SIZE;
  var NUM_BUCKETS = Math.ceil(WORLD_W / BUCKET_SIZE);
  var PLAYER_BROAD_PAD = 48;
  var OBSTACLE_BROAD_PAD = 16;
  function bucketIdx(wx) {
    const b = wx * INV_BUCKET_SIZE | 0;
    return b >= 0 && b < NUM_BUCKETS ? b : (b % NUM_BUCKETS + NUM_BUCKETS) % NUM_BUCKETS;
  }
  function obstacleAtBucket(list, wx, y, pad = 0) {
    for (let i = 0; i < list.length; i++) {
      const ob = list[i];
      if (ob.hp <= 0) continue;
      if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad) {
        const dy = wrapDeltaY(ob.y, y);
        if (dy >= -pad && dy <= ob.h + pad) return ob;
      }
    }
    return null;
  }
  function findObstacleAt(obstacles, obstacleBroadBuckets, x, y, pad = 0) {
    const wx = wrapX(x);
    if (obstacleBroadBuckets && pad <= OBSTACLE_BROAD_PAD) {
      const list = obstacleBroadBuckets[bucketIdx(wx)];
      return list ? obstacleAtBucket(list, wx, y, pad) : null;
    }
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      if (ob.hp <= 0) continue;
      const dy = wrapDeltaY(ob.y, y);
      if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob;
    }
    return null;
  }
  function lineBlockedByTerrain(terrain, obstacles, obstacleBroadBuckets, x1, y1, x2, y2, rawDx, rawDy) {
    const dx = rawDx ?? wrapDeltaX(x1, x2);
    const dy = rawDy ?? wrapDeltaY(y1, y2);
    const dist = Math.hypot(dx, dy);
    if (dist <= 1) return false;
    const steps = Math.max(1, Math.ceil(dist / 4));
    const tGrid = terrain.grid;
    const invSteps = 1 / steps;
    for (let k = 1; k < steps; k++) {
      const f = k * invSteps;
      const px = wrapX(x1 + dx * f);
      const py = wrapY(y1 + dy * f);
      if (tGrid[(py / 20 | 0) * GRID_W + (px / 20 | 0)] !== 0) return true;
      if (findObstacleAt(obstacles, obstacleBroadBuckets, px, py)) return true;
    }
    return false;
  }
  function truncateSegmentToFree(terrain, x1, y1, _x2, _y2, rawDx, rawDy) {
    const dx = rawDx ?? wrapDeltaX(x1, _x2);
    const dy = rawDy ?? wrapDeltaY(y1, _y2);
    const len = Math.hypot(dx, dy);
    if (len <= 1e-6) return { x: x1, y: y1, dx: 0, dy: 0, shortened: false };
    const steps = Math.max(1, Math.ceil(len / 3));
    let lastX = x1;
    let lastY = y1;
    let lastDx = 0;
    let lastDy = 0;
    for (let k = 1; k <= steps; k++) {
      const curDx = dx * k / steps;
      const curDy = dy * k / steps;
      const px = wrapX(x1 + curDx);
      const py = wrapY(y1 + curDy);
      if (terrain.isSolidAt(px, py)) {
        return { x: lastX, y: lastY, dx: lastDx, dy: lastDy, shortened: true };
      }
      lastX = px;
      lastY = py;
      lastDx = curDx;
      lastDy = curDy;
    }
    return { x: wrapX(x1 + dx), y: wrapY(y1 + dy), dx, dy, shortened: false };
  }
  function checkBodyOverlapsAt(terrain, obstacles, x, y, obstacleBroadBuckets) {
    const wx = wrapX(x);
    const halfW = 10;
    const tGrid = terrain.grid;
    const gx0 = Math.floor((wx - halfW) / TILE_SIZE);
    const gx1 = Math.floor((wx + halfW) / TILE_SIZE);
    const gy0 = Math.floor(wrapY(y - 30) / TILE_SIZE);
    const gy1 = Math.floor(wrapY(y + 16) / TILE_SIZE);
    for (let gx = gx0; gx <= gx1; gx++) {
      const gxx = gx >= 0 && gx < GRID_W ? gx : (gx % GRID_W + GRID_W) % GRID_W;
      for (let gy = gy0; gy <= gy1; gy++) {
        const gyy = gy >= 0 && gy < GRID_H ? gy : (gy % GRID_H + GRID_H) % GRID_H;
        if (tGrid[gyy * GRID_W + gxx] === 0) continue;
        const cellX = gxx * TILE_SIZE + TILE_SIZE / 2;
        const cellY = gyy * TILE_SIZE + TILE_SIZE / 2;
        const lx = wrapDeltaX(wx, cellX);
        const ly = wrapDeltaY(y, cellY);
        const tileL = lx - TILE_SIZE / 2;
        const tileR = lx + TILE_SIZE / 2;
        const tileT = ly - TILE_SIZE / 2;
        const tileB = ly + TILE_SIZE / 2;
        if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
      }
    }
    const obList = obstacleBroadBuckets ? obstacleBroadBuckets[bucketIdx(wx)] : obstacles;
    if (obList) {
      for (let i = 0; i < obList.length; i++) {
        const ob = obList[i];
        if (ob.hp <= 0) continue;
        const dx = wrapDeltaX(wx, ob.x + ob.w / 2);
        const dy = wrapDeltaY(y, ob.y + ob.h / 2);
        const tileL = dx - ob.w / 2;
        const tileR = dx + ob.w / 2;
        const tileT = dy - ob.h / 2;
        const tileB = dy + ob.h / 2;
        if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
      }
    }
    return false;
  }

  // src/core/sim/playerPhysics.ts
  function bodiesOverlap(ax, ay, bx, by) {
    if (ay + 16 <= by - 30 || ay - 30 >= by + 16) return false;
    return Math.abs(wrapDeltaX(ax, bx)) < 20;
  }
  function playerHitsPoint(playerBroadBuckets, x, y, selfId) {
    const list = playerBroadBuckets[bucketIdx(x)];
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (other.id === selfId) continue;
      if (!other.deployed || !other.alive || other.respawnTimer > 0) continue;
      if (y <= other.pos.y - 30 || y >= other.pos.y + 16) continue;
      if (Math.abs(wrapDeltaX(x, other.pos.x)) <= 10) return true;
    }
    return false;
  }
  function playerBlockingAt(playerBroadBuckets, x, y, selfId) {
    const list = playerBroadBuckets[bucketIdx(x)];
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
    const nx = wrapX(other.pos.x + dir * amount);
    if (terrain.isSolidAt(nx, other.pos.y - 6)) return;
    if (terrain.isSolidAt(nx, other.pos.y + 15)) return;
    if (findObstacleAt(obstacles, obstacleBroadBuckets, nx, other.pos.y)) return;
    const list = playerBroadBuckets[bucketIdx(nx)];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.id === other.id) continue;
        if (!t.deployed || !t.alive || t.respawnTimer > 0) continue;
        if (bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) return;
      }
    }
    other.pos.x = nx;
  }
  function torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, x, y) {
    const wx = wrapX(x);
    const pts = [
      [wx - 10, y - 4],
      [wx + 10, y - 4],
      [wx, y - 6],
      [wx - 10, y - 26],
      [wx + 10, y - 26],
      [wx, y - 30]
    ];
    for (const [px, py] of pts) {
      if (terrain.isSolidAt(px, py)) return true;
      if (findObstacleAt(obstacles, obstacleBroadBuckets, px, py)) return true;
    }
    return false;
  }
  function ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p) {
    if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, p.pos.x, p.pos.y)) return false;
    for (let r = 24; r <= 320; r += 24) {
      for (let a = 0; a < 16; a++) {
        const ang = a * Math.PI / 8;
        const x = wrapX(p.pos.x + Math.cos(ang) * r);
        const y = wrapY(p.pos.y + Math.sin(ang) * r);
        if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, x, y)) {
          p.pos = { x, y };
          p.vel = { x: 0, y: 0 };
          return true;
        }
      }
    }
    const base = SPAWN_POINTS.find((s) => s.team === p.team) ?? SPAWN_POINTS[0];
    p.pos = { x: wrapX(base.x), y: base.y };
    p.vel = { x: 0, y: 0 };
    return true;
  }
  function resolvePenetration(terrain, obstacles, obstacleBroadBuckets, p) {
    const halfW = 10;
    let moved = false;
    for (let iter = 0; iter < 6; iter++) {
      if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, p.pos.y, obstacleBroadBuckets)) break;
      const wx = wrapX(p.pos.x);
      const pick = { v: null };
      let bestLen = Infinity;
      const consider = (tileL, tileR, tileT, tileB) => {
        if (!(tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16)) return;
        const cand = [
          { dx: tileL - halfW, dy: 0 },
          { dx: tileR + halfW, dy: 0 },
          { dx: 0, dy: tileB + 30 },
          { dx: 0, dy: tileT - 16 }
        ];
        for (const c of cand) {
          const len = Math.abs(c.dx) + Math.abs(c.dy);
          if (len < bestLen) {
            bestLen = len;
            pick.v = c;
          }
        }
      };
      const gx0 = Math.floor((wx - halfW) / TILE_SIZE);
      const gx1 = Math.floor((wx + halfW) / TILE_SIZE);
      const gy0 = Math.floor(wrapY(p.pos.y - 30) / TILE_SIZE);
      const gy1 = Math.floor(wrapY(p.pos.y + 16) / TILE_SIZE);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const cellX = wrapX(gx * TILE_SIZE) + TILE_SIZE / 2;
          const cellY = wrapY(gy * TILE_SIZE) + TILE_SIZE / 2;
          if (!terrain.isSolidAt(cellX, cellY)) continue;
          const lx = wrapDeltaX(wx, cellX);
          const ly = wrapDeltaY(p.pos.y, cellY);
          consider(lx - TILE_SIZE / 2, lx + TILE_SIZE / 2, ly - TILE_SIZE / 2, ly + TILE_SIZE / 2);
        }
      }
      for (const ob of obstacles) {
        if (ob.hp <= 0) continue;
        const lx = wrapDeltaX(wx, ob.x + ob.w / 2);
        const ly = wrapDeltaY(p.pos.y, ob.y + ob.h / 2);
        consider(lx - ob.w / 2, lx + ob.w / 2, ly - ob.h / 2, ly + ob.h / 2);
      }
      if (pick.v) {
        p.pos.x = wrapX(p.pos.x + pick.v.dx);
        p.pos.y = wrapY(p.pos.y + pick.v.dy);
        moved = true;
      } else {
        ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p);
        moved = true;
        break;
      }
    }
    return moved;
  }
  function hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, x, y) {
    const wx = wrapX(x);
    const wy = wrapY(y);
    if (tGrid[(wy / 20 | 0) * GRID_W + (wx / 20 | 0)] !== 0) return true;
    if (findObstacleAt(obstacles, obstacleBroadBuckets, wx, y) !== null) return true;
    if (playerBroadBuckets) return playerHitsPoint(playerBroadBuckets, wx, y, selfId);
    return false;
  }
  function hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy) {
    return hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - BODY_HALF_W, cy + BODY_BOTTOM) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + BODY_HALF_W, cy + BODY_BOTTOM) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy + BODY_BOTTOM) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - BODY_HALF_W, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + BODY_HALF_W, cy) || hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy - BODY_TOP);
  }
  function stepPlayerKinematic(p, w, dt, terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, mortars, watchtowers) {
    if (!p.alive || p.respawnTimer > 0) return;
    for (let i = 0; i < mortars.length; i++) {
      const mm = mortars[i];
      if (mm.operatorId === p.id) {
        p.pos = { x: mm.x, y: mm.y - 16 };
        p.vel = { x: 0, y: 0 };
        return;
      }
    }
    if (p.mountedTowerId) {
      for (let i = 0; i < watchtowers.length; i++) {
        const tw = watchtowers[i];
        if (tw.id === p.mountedTowerId) {
          p.pos = { x: tw.x, y: tw.y - 150 + 12 };
          p.vel = { x: 0, y: 0 };
          p.onGround = false;
          return;
        }
      }
    }
    applyGravity(p.vel, dt, 1);
    if (p.onGround && p.vel.y >= -20) {
      for (let i = 0; i < JUMP_PADS.length; i++) {
        const pad = JUMP_PADS[i];
        if (Math.abs(p.pos.y - pad.y) >= 34) continue;
        const d = wrapDist(p.pos.x, p.pos.y, pad.x, pad.y);
        if (d < 34) {
          p.vel.x += pad.vx;
          p.vel.y = pad.vy;
          p.onGround = false;
        }
      }
    }
    const tGrid = terrain.grid;
    if (!p.recoilVel) p.recoilVel = { x: 0, y: 0 };
    const rv = p.recoilVel;
    const nx = wrapX(p.pos.x + p.vel.x * dt + rv.x * RECOIL_DISPLACEMENT_FACTOR);
    if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, p.pos.y)) {
      p.pos.x = nx;
    } else if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, p.pos.y - 10)) {
      p.pos.x = nx;
      p.pos.y -= 10;
    } else {
      if (playerBroadBuckets) {
        const blocker = playerBlockingAt(playerBroadBuckets, nx, p.pos.y, p.id);
        if (blocker) {
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, blocker, Math.sign(nx - p.pos.x), 1.4);
        }
      }
      p.vel.x = 0;
      rv.x = 0;
    }
    const vyTotal = p.vel.y + rv.y;
    const nyRaw = p.pos.y + p.vel.y * dt + rv.y * RECOIL_DISPLACEMENT_FACTOR;
    const ny = wrapY(nyRaw);
    if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, p.pos.x, ny)) {
      p.pos.y = ny;
      p.onGround = false;
    } else {
      p.onGround = vyTotal > 0;
      p.vel.y = 0;
      rv.y = 0;
    }
    p.pos.x = wrapX(p.pos.x);
    p.pos.y = wrapY(p.pos.y);
    stepRecoilVel(rv, dt);
  }
  function separateOverlappingPlayers(players, playerBroadBuckets, terrain, obstacles, obstacleBroadBuckets) {
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      if (!a.deployed || !a.alive || a.respawnTimer > 0) continue;
      const candidates = playerBroadBuckets[bucketIdx(a.pos.x)];
      if (!candidates) continue;
      let nudged = 0;
      for (let k = 0; k < candidates.length; k++) {
        const b = candidates[k];
        if (b.id <= a.id) continue;
        if (!b.deployed || !b.alive || b.respawnTimer > 0) continue;
        if (!bodiesOverlap(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue;
        const dx = Math.abs(wrapDeltaX(a.pos.x, b.pos.x));
        const ox = 20 - dx;
        const top = Math.max(a.pos.y - 30, b.pos.y - 30);
        const bottom = Math.min(a.pos.y + 16, b.pos.y + 16);
        const oy = bottom - top;
        if (oy > 0 && (ox <= 20 && dx <= 8 || oy <= ox)) {
          const upper = a.pos.y <= b.pos.y ? a : b;
          const upY = wrapY(upper.pos.y - oy);
          if (!terrain.isSolidAt(upper.pos.x, upY - 26)) upper.pos.y = upY;
        } else {
          const dir = Math.sign(wrapDeltaX(a.pos.x, b.pos.x)) || 1;
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, b, dir, 0.6);
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, a, -dir, 0.6);
        }
        if (++nudged >= 3) break;
      }
    }
  }

  // src/core/sim/projectiles.ts
  var SHIELD_HITBOX_PAD = 8;
  function createProjectile(id, owner, x, y, vx, vy, opts) {
    return {
      id,
      owner: owner.id,
      pos: { x: wrapX(x), y },
      vel: { x: vx, y: vy },
      spawnX: wrapX(x),
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
  function calcProjectileFalloff(ctx2, pr, hitX, hitY) {
    if (pr.weaponId < 0) return 1;
    const wep = WEAPONS[pr.weaponId];
    if (!wep) return 1;
    const d = wrapDist(pr.spawnX ?? pr.pos.x, pr.spawnY ?? pr.pos.y, hitX, hitY);
    return weaponFalloff(wep, d, ctx2.config.falloffExponent);
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
    const TOP = -12, BOTTOM = 18;
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
    if (rawDy > 40 + shieldPad && rawDy < WORLD_H - (40 + shieldPad)) return null;
    const hx = wrapDeltaX(t.pos.x, px);
    const maxHalfX = 18 + shieldPad;
    if (hx > maxHalfX || hx < -maxHalfX) return null;
    const hy = wrapDeltaY(t.pos.y - 24, py);
    const effHeadR = baseHeadR + shieldPad;
    const isHead = hx * hx + hy * hy <= effHeadR * effHeadR;
    const bx = Math.abs(hx);
    const by = wrapDeltaY(t.pos.y, py);
    if (isHead || bx <= BODY_HALF_W + 1 + shieldPad && by >= -12 - shieldPad && by <= BODY_BOTTOM - 1 + shieldPad) {
      return { isHead };
    }
    return null;
  }
  function updateContinuousBeam(ctx2, p, wep, dt) {
    if (p.respawnTimer > 0 || !p.alive) return;
    const wi = p.weaponIndex;
    if (p.reloading) return;
    if (p.ammo[wi] <= 0) {
      ctx2.startReload(p);
      return;
    }
    const dps = wep.damagePerSecond ?? wep.damage * 3;
    const aps = wep.ammoPerSecond ?? 6;
    p.ammo[wi] = Math.max(0, p.ammo[wi] - aps * dt);
    if (p.ammo[wi] <= 0 && (p.reserveAmmo[wi] || 0) > 0) ctx2.startReload(p);
    const segments = [];
    const hitPlayer = /* @__PURE__ */ new Set();
    const hitObstacle = /* @__PURE__ */ new Set();
    let dx = Math.cos(p.aim);
    let dy = Math.sin(p.aim);
    let x = 0;
    let y = 0;
    let originOk = false;
    for (let ahead = 4; ahead <= 24; ahead += 4) {
      const cx = wrapX(p.pos.x + dx * ahead);
      const cy = wrapY(p.pos.y - 12 + dy * ahead);
      if (ctx2.terrain.isSolidAt(cx, cy) || findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, cx, cy)) break;
      if (ahead > 4) {
        const nxProbe = wrapX(cx + dx * 4);
        const nyProbe = wrapY(cy + dy * 4);
        if (ctx2.terrain.isSolidAt(nxProbe, nyProbe) || findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, nxProbe, nyProbe)) break;
      }
      x = cx;
      y = cy;
      originOk = true;
    }
    if (!originOk) return;
    const step = 4;
    let bouncesLeft = wep.bounces ?? 2;
    const headR = ctx2.config.headRadius + 3;
    const tGrid = ctx2.terrain.grid;
    const obstacleBroadBuckets = ctx2.obstacleBroadBuckets;
    const playerBroadBuckets = ctx2.playerBroadBuckets;
    const obstacles = ctx2.obstacles;
    let hasReflectedOrWrapped = false;
    let exitedSelf = !isPointInPlayerBeamHitbox(p, x, y, headR);
    const checkPlayersAt = (px, py, segStartX2, segStartY2, dirX, dirY, distFromSegStart) => {
      if (!exitedSelf && !isPointInPlayerBeamHitbox(p, px, py, headR)) {
        exitedSelf = true;
      }
      const bIdx = bucketIdx(px);
      const pList = playerBroadBuckets[bIdx];
      if (!pList || pList.length === 0) return;
      for (let pi = 0; pi < pList.length; pi++) {
        const t = pList[pi];
        if (t.id === p.id) {
          if (!wep.selfDamage || !hasReflectedOrWrapped || !exitedSelf) continue;
        } else if (t.team === p.team && p.team !== "ffa" && !wep.friendlyFire) {
          continue;
        }
        if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue;
        const hitInfo = isPointInPlayerBeamHitbox(t, px, py, headR);
        if (!hitInfo) continue;
        if (lineBlockedByTerrain(
          ctx2.terrain,
          obstacles,
          obstacleBroadBuckets,
          segStartX2,
          segStartY2,
          t.pos.x,
          t.pos.y - 12,
          dirX * distFromSegStart,
          dirY * distFromSegStart
        )) continue;
        hitPlayer.add(t.id);
        const mult = hitInfo.isHead ? wep.headshotMult : 1;
        ctx2.damagePlayer(t, dps * mult * dt, void 0, hitInfo.isHead, false, p.id, p.team, wep.shortName);
      }
    };
    const pushBeamSegment = (x1, y1, x2, y2, rawDx, rawDy) => {
      if (Math.hypot(rawDx, rawDy) <= 1e-6) return null;
      const cut = truncateSegmentToFree(ctx2.terrain, x1, y1, x2, y2, rawDx, rawDy);
      segments.push({ x1, y1, x2: cut.x, y2: cut.y, dx: cut.dx, dy: cut.dy });
      return cut;
    };
    let segStartX = x;
    let segStartY = y;
    let travelled = 0;
    let stepsCount = 0;
    const maxTotalSegments = Math.max(16, (wep.bounces ?? 2) + 2);
    const maxSingleSegLen = Math.ceil(Math.hypot(WORLD_W, WORLD_H)) + 32;
    const maxTotalSteps = Math.ceil(maxSingleSegLen * 8 / step);
    while (segments.length < maxTotalSegments && stepsCount < maxTotalSteps) {
      stepsCount++;
      const dirX = dx;
      const dirY = dy;
      const rawNx = x + dirX * step;
      const rawNy = y + dirY * step;
      const crossedSeam = rawNx < 0 || rawNx >= WORLD_W || rawNy < 0 || rawNy >= WORLD_H;
      const nx = wrapX(rawNx);
      const ny = wrapY(rawNy);
      if (crossedSeam) {
        const gxAfter = nx / 20 | 0;
        const gyAfter = ny / 20 | 0;
        const nextIsTerrain = tGrid[gyAfter * GRID_W + gxAfter] !== 0;
        const nextObsList = obstacleBroadBuckets[bucketIdx(nx)];
        const nextOb = !nextIsTerrain && nextObsList && nextObsList.length > 0 ? obstacleAtBucket(nextObsList, nx, ny, 0) : null;
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
          checkPlayersAt(nx, ny, segStartX, segStartY, dirX, dirY, 0);
          continue;
        }
        if (bouncesLeft <= 0) {
          if (travelled > 0) {
            pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
          }
          break;
        }
      }
      const gx = nx / 20 | 0;
      const gy = ny / 20 | 0;
      if (tGrid[gy * GRID_W + gx] !== 0) {
        if (travelled > 0) {
          const cut = pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled);
          if (cut && cut.shortened) {
            x = cut.x;
            y = cut.y;
          }
        }
        if (bouncesLeft <= 0) break;
        bouncesLeft--;
        const prevGx = x / 20 | 0;
        const prevGy = y / 20 | 0;
        const hitX = tGrid[prevGy * GRID_W + gx] !== 0;
        const hitY = tGrid[gy * GRID_W + prevGx] !== 0;
        if (hitX) dx = -dx;
        if (hitY) dy = -dy;
        if (!hitX && !hitY) {
          dx = -dx;
          dy = -dy;
        }
        if (ctx2.terrain.isSolidAt(wrapX(x + dx * step), wrapY(y + dy * step))) break;
        hasReflectedOrWrapped = true;
        exitedSelf = true;
        segStartX = x;
        segStartY = y;
        travelled = 0;
        continue;
      }
      const bIdx = bucketIdx(nx);
      const obsList = obstacleBroadBuckets[bIdx];
      if (obsList && obsList.length > 0) {
        const ob = obstacleAtBucket(obsList, nx, ny, 0);
        if (ob) {
          const hitX = obstacleAtBucket([ob], nx, y, 0) !== null;
          const hitY = obstacleAtBucket([ob], x, ny, 0) !== null;
          if (!hitObstacle.has(ob.id)) {
            hitObstacle.add(ob.id);
            ctx2.damageObstacle(ob, dps * dt, void 0);
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
      checkPlayersAt(nx, ny, segStartX, segStartY, dirX, dirY, travelled);
    }
    ctx2.events.push({
      kind: "laser",
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
      const dx = wrapDeltaX(p.pos.x, pr.pos.x);
      if (dx > RANGE || dx < -RANGE) continue;
      const dy = wrapDeltaY(p.pos.y - 12, pr.pos.y);
      if (dy > RANGE || dy < -RANGE) continue;
      const d = Math.hypot(dx, dy);
      if (d > RANGE || d < 8) continue;
      const strength = MAX_PULL * (MIN_RATIO + (1 - MIN_RATIO) * (1 - d / RANGE));
      vx += dx / d * strength;
      vy += dy / d * strength;
    }
    if (vx === 0 && vy === 0) return;
    const tryX = wrapX(p.pos.x + vx * dt);
    if (!checkBodyOverlapsAt(terrain, obstacles, tryX, p.pos.y, obstacleBroadBuckets)) p.pos.x = tryX;
    const tryY = wrapY(p.pos.y + vy * dt);
    if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, tryY, obstacleBroadBuckets)) p.pos.y = tryY;
  }
  function stepProjectilesSubsystem(ctx2, dt) {
    ctx2.activeGravityOrbs.length = 0;
    let writeIdx = 0;
    for (let i = 0; i < ctx2.projectiles.length; i++) {
      const pr = ctx2.projectiles[i];
      if (pr.damage > 0 && pr.life > 0) {
        ctx2.projectiles[writeIdx++] = pr;
        if (pr.isGravityOrb && pr.life > 0) ctx2.activeGravityOrbs.push(pr);
      } else {
        ctx2.events.push({ kind: "projectile_destroy", projectileId: pr.id });
      }
    }
    ctx2.projectiles.length = writeIdx;
    const g = getPhysicsParams().gravity;
    const SUBSTEP_PX = 8;
    const tGrid = ctx2.terrain.grid;
    const playerBroadBuckets = ctx2.playerBroadBuckets;
    const obstacleBroadBuckets = ctx2.obstacleBroadBuckets;
    const hasOrbs = ctx2.activeGravityOrbs.length > 0;
    for (let pi = 0; pi < ctx2.projectiles.length; pi++) {
      const pr = ctx2.projectiles[pi];
      if (pr.life <= 0) continue;
      if (pr.dragPerSecond < 1) {
        const k = Math.pow(pr.dragPerSecond, dt);
        pr.vel.x *= k;
        pr.vel.y *= k;
      }
      if (hasOrbs && !pr.isGravityOrb && !pr.beam) {
        const FIELD = 360;
        for (let oi = 0; oi < ctx2.activeGravityOrbs.length; oi++) {
          const orb = ctx2.activeGravityOrbs[oi];
          if (orb.life <= 0) continue;
          const dx2 = wrapDeltaX(pr.pos.x, orb.pos.x);
          if (dx2 > FIELD || dx2 < -FIELD) continue;
          const dy2 = wrapDeltaY(pr.pos.y, orb.pos.y);
          if (dy2 > FIELD || dy2 < -FIELD) continue;
          const d = Math.hypot(dx2, dy2);
          if (d > FIELD) continue;
          const falloff = 1 - d / FIELD;
          const cur = Math.atan2(pr.vel.y, pr.vel.x);
          const want = Math.atan2(dy2, dx2);
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
      const ownerTeam = ctx2.ownerTeamOf(pr.owner);
      const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
      const allowFF = !!wep?.friendlyFire;
      const allowSelf = !!wep?.selfDamage;
      const headHitR = ctx2.config.headRadius + pr.r;
      const bodyHalfX = BODY_HALF_W + pr.r * 0.6;
      for (let step = 0; step < steps; step++) {
        const prevX = pr.pos.x;
        const prevY = pr.pos.y;
        let nx = prevX + sx;
        if (nx >= WORLD_W) nx -= WORLD_W;
        else if (nx < 0) nx += WORLD_W;
        let ny = prevY + sy;
        if (ny >= WORLD_H) ny -= WORLD_H;
        else if (ny < 0) ny += WORLD_H;
        pr.pos.x = nx;
        pr.pos.y = ny;
        const bIdx = nx * INV_BUCKET_SIZE | 0;
        let hit = false;
        const pList = playerBroadBuckets[bIdx];
        if (pList && pList.length > 0) {
          for (let ti = 0; ti < pList.length; ti++) {
            const t = pList[ti];
            if (t.id !== pr.owner && t.team === ownerTeam && t.team !== "ffa" && !allowFF) continue;
            if (t.id === pr.owner && !allowSelf) continue;
            if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
            const shieldPad = t.shieldTimer > 0 && t.shieldHp > 0 ? SHIELD_HITBOX_PAD : 0;
            const rawDy = Math.abs(t.pos.y - ny);
            if (rawDy > 42 + shieldPad && rawDy < WORLD_H - (42 + shieldPad)) continue;
            if (pr.hitTargets.includes(t.id)) continue;
            const tHeadHitR = headHitR + shieldPad;
            const tHeadHitRSq = tHeadHitR * tHeadHitR;
            const tBodyHalfX = bodyHalfX + shieldPad;
            const dxHead = wrapDeltaX(t.pos.x, nx);
            const dxBody = Math.abs(dxHead);
            if (dxBody > Math.max(tHeadHitR, tBodyHalfX)) continue;
            const dyHead = wrapDeltaY(t.pos.y - 24, ny);
            const isRealHead = dxHead * dxHead + dyHead * dyHead <= headHitR * headHitR;
            if (isRealHead) {
              pr.hitTargets.push(t.id);
              const piercing = pr.pierceOnHeadshot || pr.pierceAll;
              if (pr.explosive) {
                ctx2.explode(nx, ny, pr.terrainRadius, pr.damage * pr.headshotMult * calcProjectileFalloff(ctx2, pr, nx, ny), 960, pr);
                hit = true;
              } else {
                ctx2.damagePlayer(t, Math.round(pr.damage * pr.headshotMult * calcProjectileFalloff(ctx2, pr, t.pos.x, t.pos.y - 24)), pr, true, piercing);
                t.vel.x += pr.vel.x * 0.12;
                t.vel.y += pr.vel.y * 0.12 - 72;
                if (!piercing) hit = true;
              }
              if (hit) break;
              continue;
            }
            const dyBody = wrapDeltaY(t.pos.y, ny);
            const hitShieldHead = shieldPad > 0 && dxHead * dxHead + dyHead * dyHead <= tHeadHitRSq;
            const hitBodyBox = dxBody <= tBodyHalfX && dyBody >= -12 - shieldPad && dyBody <= BODY_BOTTOM - 1 + shieldPad;
            if (hitShieldHead || hitBodyBox) {
              pr.hitTargets.push(t.id);
              if (pr.explosive) {
                ctx2.explode(nx, ny, pr.terrainRadius, pr.damage * calcProjectileFalloff(ctx2, pr, nx, ny), 900, pr);
                hit = true;
              } else {
                let dmg = Math.round(pr.damage);
                if (wep?.grazeDamageMin !== void 0) {
                  const q = projectileBodyHitQuality(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX);
                  dmg = Math.round(wep.grazeDamageMin + (pr.damage - wep.grazeDamageMin) * q);
                } else if (wep?.edgeDamage !== void 0 && isProjectileBodyEdgeHit(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)) {
                  dmg = Math.min(dmg, wep.edgeDamage);
                }
                if (wep?.farRange !== void 0) {
                  const owner = ctx2.playerById.get(pr.owner) ?? ctx2.players.find((x) => x.id === pr.owner);
                  if (owner) {
                    const dShot = wrapDist(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12);
                    if (dShot > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg);
                  }
                }
                dmg = Math.round(dmg * calcProjectileFalloff(ctx2, pr, t.pos.x, t.pos.y - 12));
                ctx2.damagePlayer(t, dmg, pr, false, false);
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
          const ob = obstacleAtBucket(obsList, nx, ny, pr.r);
          if (ob) {
            if (pr.explosive) {
              ctx2.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr);
              dead = true;
            } else {
              ctx2.damageObstacle(ob, pr.damage, pr);
              if (!pr.pierceAll) dead = true;
            }
            if (dead) break;
          }
        }
        const gx = nx / 20 | 0;
        const gy = ny / 20 | 0;
        if (tGrid[gy * GRID_W + gx] !== 0) {
          if (pr.passWalls) continue;
          if (pr.explosive) {
            ctx2.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr);
            dead = true;
            break;
          }
          if (pr.bounces > 0) {
            const hitX = ctx2.terrain.isSolidAt(nx, prevY);
            const hitY = ctx2.terrain.isSolidAt(prevX, ny);
            pr.pos = { x: prevX, y: prevY };
            if (hitX) pr.vel.x = -pr.vel.x;
            if (hitY) pr.vel.y = -pr.vel.y;
            if (!hitX && !hitY) {
              pr.vel.x = -pr.vel.x;
              pr.vel.y = -pr.vel.y;
            }
            pr.bounces--;
            pr.hitTargets = [pr.owner];
            ctx2.events.push({
              kind: "projectile_bounce",
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
        ctx2.events.push({ kind: "projectile_destroy", projectileId: pr.id });
        pr.life = 0;
      }
    }
  }

  // src/core/sim/throwables.ts
  function stepPlayerTeleport(ctx2, p, dt) {
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
    const curMortar = ctx2.mortars.find((m) => m.operatorId === p.id);
    if (curMortar) curMortar.operatorId = null;
    if (p.mountedTowerId) {
      const tw = ctx2.watchtowers.find((t) => t.id === p.mountedTowerId);
      if (tw) tw.operatorId = null;
      p.mountedTowerId = null;
      p.watchtowerTimer = 0;
    }
    p.pos = { x: wrapX(target.x), y: clamp(target.y, 40, 4360) };
    if (p.vel.y > 0) p.vel.y = 0;
    resolvePenetration(ctx2.terrain, ctx2.obstacles, ctx2.obstacleBroadBuckets, p);
    ensureFreePosition(ctx2.terrain, ctx2.obstacles, ctx2.obstacleBroadBuckets, p);
    ctx2.events.push({ kind: "warp", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "Teleport" });
  }
  function useSecondaryInWorld(ctx2, p, s) {
    if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return;
    const def = SECONDARIES[s.type];
    if (!def) return;
    if (s.type === "frag") {
      if (p.fragCharges <= 0) return;
      p.fragCharges--;
      p.secondaryCooldown = Math.max(p.secondaryCooldown, 0.8);
      const throwSpeed = 760;
      ctx2.grenades.push({
        id: ctx2.nextGrenadeId(),
        owner: p.id,
        pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
        vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
        fuse: ctx2.config.grenadeFuse,
        bounces: 0
      });
      return;
    }
    if (s.type === "doll") {
      if (p.dollCharges <= 0) return;
      p.dollCharges--;
      p.secondaryCooldown = def.cd;
      p.doll = {
        pos: { x: p.pos.x, y: p.pos.y },
        hp: p.hp,
        shieldHp: p.shieldHp,
        fuel: p.fuel,
        weaponIndex: p.weaponIndex,
        ammo: [...p.ammo],
        reserveAmmo: [...p.reserveAmmo],
        timer: ctx2.config.dollDuration
      };
      ctx2.events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "anchor" });
      return;
    }
    if ((p.deathStreak ?? 0) < def.unlockStreak && p.secondary !== s.type) return;
    if (s.type === "obstacle") {
      p.secondaryCooldown = def.cd;
      const w = 56;
      const h = 76;
      const dist = 76;
      const cx = wrapX(p.pos.x + Math.cos(p.aim) * dist);
      const cy = Math.max(80, Math.min(4300 - h, p.pos.y - 16 + Math.sin(p.aim) * dist));
      const ox = wrapX(cx - w / 2);
      let oy = cy - h / 2;
      for (let sStep = 0; sStep < 24; sStep++) {
        if (ctx2.terrain.isSolidAt(wrapX(ox + w / 2), oy + h - 1) && !ctx2.terrain.isSolidAt(wrapX(ox + w / 2), oy - 2)) {
          oy -= 2;
        } else break;
      }
      const obKind = "box";
      const ob = {
        id: `p_obs_${p.id}_${ctx2.nextObstacleSeq()}`,
        x: ox,
        y: oy,
        w,
        h,
        hp: ctx2.config.obstacleDefaultHp,
        maxHp: ctx2.config.obstacleDefaultHp,
        kind: obKind,
        color: "#334155",
        borderColor: "#38bdf8",
        label: "\u6218\u672F\u63A9\u4F53"
      };
      ctx2.obstacles.push(ob);
      ctx2.rebuildSpatial();
      if (checkBodyOverlapsAt(ctx2.terrain, ctx2.obstacles, p.pos.x, p.pos.y, ctx2.obstacleBroadBuckets)) {
        resolvePenetration(ctx2.terrain, ctx2.obstacles, ctx2.obstacleBroadBuckets, p);
        ensureFreePosition(ctx2.terrain, ctx2.obstacles, ctx2.obstacleBroadBuckets, p);
      }
      return;
    }
    if (s.type === "shield") {
      if (p.shieldTimer > 0 && p.shieldHp > 0) return;
      p.secondaryCooldown = def.cd;
      p.shieldHp = ctx2.config.shieldHp;
      p.shieldTimer = ctx2.config.shieldDuration;
      ctx2.events.push({ kind: "shield", x: p.pos.x, y: p.pos.y, playerId: p.id });
      return;
    }
    if (s.type === "teleport") {
      if (p.teleportTimer && p.teleportTimer > 0) return;
      p.secondaryCooldown = def.cd;
      let tx = wrapX(p.pos.x + Math.cos(p.aim) * 280);
      let ty = clamp(p.pos.y + Math.sin(p.aim) * 280, 40, 4360);
      if (Number.isFinite(s.targetX) && Number.isFinite(s.targetY) && (s.targetX !== 0 || s.targetY !== 0)) {
        tx = wrapX(s.targetX);
        ty = clamp(s.targetY, 40, 4360);
      }
      const castTime = ctx2.config.teleportCastTime ?? 0.35;
      p.teleportTimer = Math.max(0.05, castTime);
      p.teleportTarget = { x: tx, y: ty };
      return;
    }
  }
  function damageObstacleInWorld(ctx2, ob, dmg) {
    if (ob.hp <= 0 || dmg <= 0) return;
    ob.hp = Math.max(0, ob.hp - Math.round(dmg));
    if (ob.hp <= 0) {
      const idx = ctx2.obstacles.findIndex((o) => o.id === ob.id);
      if (idx >= 0) ctx2.obstacles.splice(idx, 1);
      ctx2.events.push({ kind: "explosion", x: ob.x, y: ob.y, radius: 28 });
      ctx2.events.push({ kind: "obstacle_destroy", obstacleId: ob.id, x: ob.x, y: ob.y });
    }
  }
  function damagePlayerInWorld(ctx2, t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
    if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return;
    const atkId = attackerId ?? pr?.owner ?? 0;
    const atkTeam = attackerTeam ?? ctx2.ownerTeamOf(atkId);
    const label = weaponLabel ?? pr?.weaponLabel ?? "\u672A\u77E5";
    if (t.shieldTimer > 0 && t.shieldHp > 0) {
      const absorbed = Math.min(t.shieldHp, amount);
      t.shieldHp = Math.max(0, t.shieldHp - amount);
      ctx2.events.push({
        kind: "hit",
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
      ctx2.onHitCount();
      if (t.shieldHp <= 0) {
        t.shieldHp = 0;
        t.shieldTimer = 0;
        ctx2.events.push({ kind: "shield", x: t.pos.x, y: t.pos.y, playerId: t.id });
        ctx2.events.push({ kind: "shield_break", x: t.pos.x, y: t.pos.y, playerId: t.id });
      }
      return;
    }
    t.hp -= amount;
    ctx2.events.push({
      kind: "hit",
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
    ctx2.onHitCount();
    if (t.hp > 0) return;
    if (t.doll && t.doll.timer > 0) {
      ctx2.recallDoll(t, "doll_recall");
      return;
    }
    t.hp = 0;
    t.alive = false;
    t.deaths++;
    t.deathStreak = (t.deathStreak ?? 0) + 1;
    t.secondary = getHighestUnlockedSecondary(t.deathStreak, t.dollCharges);
    t.respawnTimer = ctx2.config.respawnDelay;
    t.shieldHp = 0;
    t.shieldTimer = 0;
    t.watchtowerTimer = 0;
    t.teleportTimer = 0;
    t.teleportTarget = null;
    const mk = ctx2.mortars.find((m) => m.operatorId === t.id);
    if (mk) mk.operatorId = null;
    const killer = ctx2.playerById.get(atkId) ?? ctx2.players.find((x) => x.id === atkId);
    if (killer && atkId !== t.id) {
      killer.kills++;
      killer.deathStreak = 0;
      if (ctx2.scores[atkTeam] !== void 0) ctx2.scores[atkTeam]++;
    }
    ctx2.events.push({
      kind: "kill",
      attackerId: atkId,
      victimId: t.id,
      weaponLabel: label,
      headshot: isHead,
      killerId: atkId,
      killerName: killer?.name ?? "\u6218\u573A\u73AF\u5883",
      killerTeam: atkTeam,
      victimName: t.name,
      victimTeam: t.team,
      isHeadshot: isHead,
      isPierced,
      x: t.pos.x,
      y: t.pos.y
    });
  }
  function explodeInWorld(ctx2, cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
    const wCx = wrapX(cx);
    ctx2.events.push({ kind: "explosion", x: wCx, y: cy, radius });
    for (const ob of [...ctx2.obstacles]) {
      const dx = wrapDeltaX(wCx, ob.x + ob.w / 2);
      const dOb = wrapDeltaY(ob.y, cy);
      const nearY = clamp(dOb, 0, ob.h);
      const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY);
      if (dist <= radius * 1.25) damageObstacleInWorld(ctx2, ob, maxDamage * (1 - dist / (radius * 1.25)) + 30);
    }
    const hitR = radius * 1.35;
    const atkId = ownerId ?? pr?.owner ?? 0;
    const atkTeam = ownerTeam ?? ctx2.ownerTeamOf(atkId);
    const label = weaponLabel ?? pr?.weaponLabel ?? "\u7206\u70B8";
    const isGrenade = label === "\u624B\u69B4\u5F39";
    const srcWep = pr && pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
    const ffAllowed = isGrenade ? ctx2.config.grenadeFriendlyFire : srcWep ? srcWep.friendlyFire ?? false : false;
    const selfAllowed = isGrenade ? ctx2.config.grenadeSelfDamage : srcWep ? srcWep.selfDamage ?? false : true;
    let blastExp = srcWep?.blastFalloffExponent ?? 1;
    if (!srcWep && label) {
      const byLabel = WEAPONS.find((w) => w.shortName === label || w.name === label);
      if (byLabel?.blastFalloffExponent) blastExp = byLabel.blastFalloffExponent;
    }
    for (const t of ctx2.players) {
      if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
      const dx = wrapDeltaX(wCx, t.pos.x);
      if (Math.abs(dx) > hitR) continue;
      const dy = wrapDeltaY(cy, t.pos.y - 12);
      if (Math.abs(dy) > hitR) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > hitR) continue;
      const tNorm = Math.min(1, dist / hitR);
      const falloff = Math.max(0.2, 1 - Math.pow(tNorm, blastExp));
      const nx = dist > 0.1 ? dx / dist : 0;
      const ny = dist > 0.1 ? dy / dist : -1;
      const sign = implosion ? -0.85 : 1;
      t.vel.x += nx * knockback * falloff * sign;
      t.vel.y += (ny * knockback - 210) * falloff * sign;
      const isSelf = t.id === atkId;
      const isTeammate = !isSelf && t.team === atkTeam && t.team !== "ffa";
      if (isTeammate && !ffAllowed) continue;
      if (isSelf && !selfAllowed) continue;
      const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1));
      const headDist = Math.hypot(dx, wrapDeltaY(cy, t.pos.y - 26));
      const isHead = headDist < ctx2.config.headRadius * 1.6 && dist < radius * 0.6;
      damagePlayerInWorld(ctx2, t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label);
    }
  }
  function stepExplosionsAndThrowables(ctx2, dt) {
    const g0 = 1250;
    for (const g of ctx2.grenades) {
      g.vel.y += g0 * 0.88 * dt;
      g.vel.x *= 0.995;
      const nx = wrapX(g.pos.x + g.vel.x * dt);
      if (ctx2.terrain.isSolidAt(nx, g.pos.y) || findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, nx, g.pos.y)) g.vel.x *= -0.55;
      else g.pos.x = nx;
      const ny = g.pos.y + g.vel.y * dt;
      if (ctx2.terrain.isSolidAt(g.pos.x, ny) || findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, g.pos.x, ny)) {
        g.vel.y *= -0.45;
        g.vel.x *= 0.78;
        if (Math.abs(g.vel.y) < 72) {
          g.vel.y = 0;
          g.vel.x *= 0.88;
          if (Math.abs(g.vel.x) < 8) g.vel.x = 0;
        }
      } else g.pos.y = wrapY(ny);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        explodeInWorld(ctx2, g.pos.x, g.pos.y, ctx2.config.grenadeRadius, ctx2.config.grenadeDamage, 16 * 60, void 0, g.owner, void 0, "\u624B\u69B4\u5F39");
        g.fuse = 0;
      }
    }
    for (let i = ctx2.landmines.length - 1; i >= 0; i--) {
      const m = ctx2.landmines[i];
      if (m.respawnTimer > 0) {
        m.respawnTimer -= dt;
        if (m.respawnTimer <= 0) {
          m.armed = true;
          m.triggered = false;
          m.fuse = 0;
          m.vel = { x: 0, y: 0 };
        }
        continue;
      }
      if (!ctx2.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, m.pos.x, m.pos.y + 8)) {
        m.vel.y += g0 * 0.86 * dt;
        const nx = wrapX(m.pos.x + m.vel.x * dt);
        if (!ctx2.terrain.isSolidAt(nx, m.pos.y) && !findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, nx, m.pos.y)) m.pos.x = nx;
        else m.vel.x = -m.vel.x * 0.35;
        const ny = m.pos.y + m.vel.y * dt;
        if (!ctx2.terrain.isSolidAt(m.pos.x, ny + 8) && !findObstacleAt(ctx2.obstacles, ctx2.obstacleBroadBuckets, m.pos.x, ny + 8)) m.pos.y = wrapY(ny);
        else {
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
        const list = ctx2.playerBroadBuckets[bucketIdx(m.pos.x)];
        for (let ti = 0; ti < list.length; ti++) {
          const t = list[ti];
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue;
          if (t.team === ctx2.ownerTeamOf(m.owner) && t.team !== "ffa") continue;
          if (wrapDist(m.pos.x, m.pos.y, t.pos.x, t.pos.y - 10) <= 26) {
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
        for (const t of ctx2.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
          if (!m.preset && t.id === m.owner) continue;
          if (wrapDist(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= ctx2.config.mineTriggerRadius) {
            m.triggered = true;
            m.fuse = m.instant ? 0.02 : 0.45;
            break;
          }
        }
      } else {
        m.fuse -= dt;
        if (m.fuse <= 0) {
          const label = m.instant ? "\u26A1\u77AC\u53D1\u5730\u96F7" : "\u{1F6A8}\u611F\u5E94\u5730\u96F7";
          explodeInWorld(ctx2, m.pos.x, m.pos.y, m.preset ? 82 : 104, m.preset ? ctx2.config.mineDamage : Math.round(ctx2.config.mineDamage * 1.25), 19 * 60, void 0, m.owner === 0 ? void 0 : m.owner, void 0, label);
          if (m.preset) m.respawnTimer = ctx2.config.mineRespawnTime;
          else ctx2.landmines.splice(i, 1);
        }
      }
    }
    for (let i = ctx2.airstrikes.length - 1; i >= 0; i--) {
      const st = ctx2.airstrikes[i];
      st.timer -= dt;
      if (st.timer <= 0) {
        ctx2.events.push({ kind: "airstrike", x: st.pos.x, y: st.pos.y });
        ctx2.events.push({ kind: "airstrike_drop", x: st.pos.x, y: st.pos.y });
        const src = ctx2.playerById.get(st.owner) ?? ctx2.players.find((p) => p.id === st.owner);
        for (let b = -2; b <= 2; b++) {
          const airPr = createProjectile(
            ctx2.nextProjId(),
            src ?? { id: st.owner, pos: st.pos, vel: { x: 0, y: 0 }, aim: 0, team: "ffa", name: "\u7A7A\u88AD" },
            st.pos.x + b * 44,
            st.pos.y - 420 - Math.abs(b) * 28,
            ctx2.rng.range(-30, 30),
            900 + ctx2.rng.range(0, 120),
            {
              damage: ctx2.config.airstrikeDamage,
              headshotMult: 1.5,
              terrainRadius: ctx2.config.airstrikeRadius,
              explosive: true,
              gravityScale: 0.5,
              weaponLabel: "\u2708\uFE0F\u5B9A\u70B9\u7A7A\u88AD",
              color: "#f43f5e",
              r: 7,
              life: 160 / 60
            }
          );
          ctx2.projectiles.push(airPr);
          ctx2.events.push({
            kind: "projectile_spawn",
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
        ctx2.airstrikes.splice(i, 1);
      }
    }
  }

  // src/core/sim/interactables.ts
  function isCapturePointSelectable(cp, team) {
    if (!cp) return false;
    if (cp.ownerTeam === null || cp.progress < 100) return false;
    return cp.ownerTeam === team || team === "ffa";
  }
  function recallDollState(events, p) {
    if (!p.doll) return;
    const d = p.doll;
    p.doll = null;
    p.pos = { x: wrapX(d.pos.x), y: d.pos.y };
    p.vel = { x: 0, y: 0 };
    p.hp = Math.max(1, d.hp);
    p.shieldHp = d.shieldHp;
    p.fuel = d.fuel;
    p.weaponIndex = d.weaponIndex;
    if (WEAPONS[d.weaponIndex] && !WEAPONS[d.weaponIndex].isSupplyOnly) p.lastPrimaryIndex = d.weaponIndex;
    p.ammo = [...d.ammo];
    p.reserveAmmo = [...d.reserveAmmo];
    p.respawnTimer = 0;
    p.alive = true;
    events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id });
  }
  function handlePlayerInteract(ctx2, p) {
    if (p.respawnTimer > 0 || !p.alive) return;
    const cur = ctx2.mortars.find((m) => m.operatorId === p.id);
    if (cur) {
      cur.operatorId = null;
      p.vel.y = -270;
      return;
    }
    for (const m of ctx2.mortars) {
      if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
        m.operatorId = p.id;
        p.pos = { x: m.x, y: m.y - 16 };
        p.vel = { x: 0, y: 0 };
        return;
      }
    }
    if (p.mountedTowerId) {
      const tw = ctx2.watchtowers.find((t) => t.id === p.mountedTowerId);
      if (tw) tw.operatorId = null;
      p.mountedTowerId = null;
      p.watchtowerTimer = 0;
      p.vel = { x: 0, y: -160 };
      ctx2.events.push({ kind: "warp", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "\u79BB\u5F00\u77AD\u671B\u5854" });
      return;
    }
    for (const tw of ctx2.watchtowers) {
      if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
        tw.operatorId = p.id;
        p.mountedTowerId = tw.id;
        p.pos = { x: tw.x, y: tw.y - 150 + 12 };
        p.vel = { x: 0, y: 0 };
        p.onGround = false;
        ctx2.events.push({ kind: "warp", x: tw.x, y: tw.y, playerId: p.id, weaponName: `\u767B\u4E0A${tw.name}\uFF08\u89C6\u91CE 200%\uFF09` });
        return;
      }
    }
    for (const wp of ctx2.warpPortals) {
      if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
        const dest = ctx2.warpPortals.find((w) => w.id === wp.targetId);
        if (!dest) continue;
        p.pos = { x: dest.x, y: dest.y - 60 };
        p.vel = { x: 0, y: 0 };
        p.warpCooldown = 2.5;
        ctx2.events.push({ kind: "warp", x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name });
        return;
      }
    }
    const nearCaptured = ctx2.capturePoints.find(
      (cp) => isCapturePointSelectable(cp, p.team) && wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < Math.max(150, ctx2.config.captureRadius + 40)
    );
    const targetCp = nearCaptured ?? ctx2.capturePoints.find((cp) => isCapturePointSelectable(cp, p.team));
    if (targetCp) {
      p.selectedSpawnId = targetCp.id;
      ctx2.events.push({
        kind: "warp",
        x: targetCp.x,
        y: targetCp.y,
        playerId: p.id,
        pointCode: targetCp.code,
        weaponName: `\u5DF2\u9009\u4E2D\u3010${targetCp.name}\u3011\u4F5C\u4E3A\u590D\u6D3B\u70B9`
      });
    }
  }
  function spawnSingleAmmoPack(ctx2) {
    if (ctx2.ammoPacks.length >= ctx2.config.ammoPackMaxActive) return;
    const available = [];
    for (let i = 0; i < AMMO_SPOTS.length; i++) {
      if (!ctx2.ammoPacks.some((a) => a.x === AMMO_SPOTS[i].x)) available.push(i);
    }
    if (available.length === 0) return;
    const spot = AMMO_SPOTS[ctx2.rng.pick(available)];
    ctx2.ammoPacks.push({ id: ctx2.nextAmmoId(), x: spot.x, y: spot.y, area: spot.area });
  }
  function stepMapInteractables(ctx2, dt) {
    const capR = ctx2.config.captureRadius;
    for (const cp of ctx2.capturePoints) {
      const presence = {};
      for (let i = 0; i < ctx2.players.length; i++) {
        const p = ctx2.players[i];
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
        if (Math.abs(wrapDeltaX(p.pos.x, cp.x)) >= capR) continue;
        if (Math.abs(p.pos.y - cp.y) >= capR) continue;
        if (wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < capR) {
          presence[p.team] = (presence[p.team] || 0) + 1;
        }
      }
      const teams = Object.keys(presence);
      if (teams.length === 1) {
        const t = teams[0];
        if (cp.ownerTeam !== t) {
          if (cp.capturingTeam !== t) {
            cp.capturingTeam = t;
            if (cp.ownerTeam !== null) cp.progress = 0;
          }
          cp.progress += ctx2.config.captureRate * dt * (presence[t] || 0);
          if (cp.progress >= 100) {
            cp.progress = 100;
            cp.ownerTeam = t;
            ctx2.events.push({ kind: "capture", pointCode: cp.code, team: t, x: cp.x, y: cp.y });
          }
        }
      }
    }
    for (const m of ctx2.mortars) {
      if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt);
    }
    for (const crate of ctx2.supplyCrates) {
      if (!crate.active && crate.respawnTimer > 0) {
        crate.respawnTimer -= dt;
        if (crate.respawnTimer <= 0) crate.active = true;
      }
      if (!crate.active) continue;
      for (let i = 0; i < ctx2.players.length; i++) {
        const p = ctx2.players[i];
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
        if (Math.abs(wrapDeltaX(p.pos.x, crate.x)) >= 56 || Math.abs(p.pos.y - crate.y) >= 56) continue;
        if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
          crate.active = false;
          crate.respawnTimer = ctx2.config.supplyRespawnTime;
          if (crate.kind === "doll") {
            p.dollCharges = Math.min(ctx2.config.dollMaxCharges, p.dollCharges + 1);
          } else {
            p.weaponIndex = crate.weaponId;
            p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1));
            p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize;
            p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve;
          }
          ctx2.events.push({
            kind: "supply_pickup",
            playerId: p.id,
            playerName: p.name,
            // 事件自带名字：客机即使反查不到也能正确显示
            weaponId: crate.kind === "doll" ? -1 : crate.weaponId,
            weaponName: crate.weaponName,
            x: crate.x,
            y: crate.y
          });
          break;
        }
      }
    }
    let timer = ctx2.getAmmoTimer() + dt;
    if (timer >= ctx2.config.ammoPackInterval) {
      timer = 0;
      spawnSingleAmmoPack(ctx2);
    }
    ctx2.setAmmoTimer(timer);
    for (let i = ctx2.ammoPacks.length - 1; i >= 0; i--) {
      const pack = ctx2.ammoPacks[i];
      for (let pi = 0; pi < ctx2.players.length; pi++) {
        const p = ctx2.players[pi];
        if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
        if (Math.abs(wrapDeltaX(p.pos.x, pack.x)) >= 52 || Math.abs(p.pos.y - pack.y) >= 52) continue;
        if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
          const wep = WEAPONS[p.weaponIndex];
          p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve);
          ctx2.ammoPacks.splice(i, 1);
          ctx2.events.push({ kind: "ammo_pickup", playerId: p.id, x: pack.x, y: pack.y });
          break;
        }
      }
    }
  }

  // src/core/sim/world.ts
  var World = class {
    terrain = new Terrain();
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
    watchtowers = WATCHTOWERS.map((t) => ({ ...t }));
    warpPortals = WARP_PORTALS;
    scores = { red: 0, blue: 0, green: 0, ffa: 0 };
    events = [];
    config = { ...DEFAULT_CONFIG };
    rng;
    seed;
    tick = 0;
    hits = 0;
    pid = 1;
    prj = 1;
    gren = 1;
    obsSeq = 1;
    mineSeq = 1;
    ammo = 1;
    crate = 1;
    ammoSpawnTimer = 0;
    stuckTicks = /* @__PURE__ */ new Map();
    playerBroadBuckets = Array.from({ length: NUM_BUCKETS }, () => []);
    obstacleBroadBuckets = Array.from({ length: NUM_BUCKETS }, () => []);
    playerById = /* @__PURE__ */ new Map();
    activeGravityOrbs = [];
    constructor(seed = 12345, map) {
      this.seed = seed;
      this.rng = new Rng(seed);
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
      return (this.playerById.get(id) ?? this.players.find((p) => p.id === id))?.team ?? "ffa";
    }
    recallDoll(p) {
      recallDollState(this.events, p);
    }
    damagePlayer(t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
      damagePlayerInWorld(this, t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel);
    }
    damageObstacle(ob, dmg) {
      damageObstacleInWorld(this, ob, dmg);
    }
    explode(cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
      explodeInWorld(this, cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion);
    }
    startReload(p) {
      const wep = WEAPONS[p.weaponIndex];
      if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return;
      if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return;
      p.reloading = true;
      p.reloadTimer = wep.shellReload ? wep.reloadTime / Math.max(1, wep.magSize) : wep.reloadTime;
    }
    rebuildSpatialBuckets() {
      for (let i = 0; i < NUM_BUCKETS; i++) {
        this.playerBroadBuckets[i].length = 0;
        this.obstacleBroadBuckets[i].length = 0;
      }
      this.playerById.clear();
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        this.playerById.set(p.id, p);
        if (!p.deployed || !p.alive || p.respawnTimer > 0) continue;
        const wx = wrapX(p.pos.x);
        const b0 = bucketIdx(wrapX(wx - PLAYER_BROAD_PAD));
        const b1 = bucketIdx(wrapX(wx + PLAYER_BROAD_PAD));
        this.playerBroadBuckets[b0].push(p);
        if (b1 !== b0) this.playerBroadBuckets[b1].push(p);
      }
      for (let i = 0; i < this.obstacles.length; i++) {
        const ob = this.obstacles[i];
        if (ob.hp <= 0) continue;
        const startX = ob.x - OBSTACLE_BROAD_PAD;
        const endX = ob.x + ob.w + OBSTACLE_BROAD_PAD;
        const steps = Math.ceil((endX - startX) * INV_BUCKET_SIZE) + 1;
        let prevB = -1;
        for (let s = 0; s <= steps; s++) {
          const px = Math.min(endX, startX + s * BUCKET_SIZE);
          const b = bucketIdx(wrapX(px));
          if (b !== prevB) {
            if (!this.obstacleBroadBuckets[b].includes(ob)) this.obstacleBroadBuckets[b].push(ob);
            prevB = b;
          }
        }
      }
    }
    rebuildPlayerBucketsOnly() {
      for (let i = 0; i < NUM_BUCKETS; i++) this.playerBroadBuckets[i].length = 0;
      this.playerById.clear();
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        this.playerById.set(p.id, p);
        if (!p.deployed || !p.alive || p.respawnTimer > 0) continue;
        const wx = wrapX(p.pos.x);
        const b0 = bucketIdx(wrapX(wx - PLAYER_BROAD_PAD));
        const b1 = bucketIdx(wrapX(wx + PLAYER_BROAD_PAD));
        this.playerBroadBuckets[b0].push(p);
        if (b1 !== b0) this.playerBroadBuckets[b1].push(p);
      }
    }
    resetMatch() {
      this.obsSeq = 1;
      this.mineSeq = 1;
      this.obstacles = OBSTACLE_PRESETS.map((o) => ({ ...o, maxHp: o.hp }));
      this.capturePoints = CP_INITS.map((c) => ({ ...c, progress: c.ownerTeam ? 100 : 0, capturingTeam: null }));
      this.mortars = MORTARS_INIT.map((m) => ({ ...m, cooldown: 0, operatorId: null }));
      this.watchtowers = WATCHTOWERS.map((t) => ({ ...t, operatorId: null }));
      this.landmines = MINE_PRESETS.map((m, i) => ({
        id: -(i + 1),
        owner: 0,
        pos: { x: m.x, y: m.y },
        vel: { x: 0, y: 0 },
        armed: true,
        armTimer: 0,
        triggered: false,
        fuse: 0,
        instant: false,
        directHit: false,
        preset: true,
        respawnTimer: 0
      }));
      this.supplyCrates = [
        ...SUPPLY_SPOTS.map((spot, idx) => {
          const w = WEAPONS[4 + idx % 3];
          return {
            id: this.crate++,
            x: spot.x,
            y: spot.y,
            area: spot.area,
            kind: "weapon",
            weaponId: w.id,
            weaponName: w.name,
            color: w.color,
            active: true,
            respawnTimer: 0
          };
        }),
        ...DOLL_SUPPLY_SPOTS.map((spot) => ({
          id: this.crate++,
          x: spot.x,
          y: spot.y,
          area: spot.area,
          kind: "doll",
          weaponId: -1,
          weaponName: "\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\uFF08\u7279\u6B8A\u8865\u7ED9\uFF09",
          color: "#f472b6",
          active: true,
          respawnTimer: 0
        }))
      ];
      this.ammoPacks = [];
      for (let i = 0; i < this.config.ammoPackMaxActive; i++) spawnSingleAmmoPack(this);
      this.projectiles = [];
      this.grenades = [];
      this.airstrikes = [];
      this.ammoSpawnTimer = 0;
      this.scores = { red: 0, blue: 0, green: 0, ffa: 0 };
      for (const p of this.players) p.selectedSpawnId = "base";
      this.rebuildSpatialBuckets();
    }
    addPlayer(name = "Player", team = "ffa") {
      const p = {
        id: this.pid++,
        pos: { x: 6600, y: 2380 },
        vel: { x: 0, y: 0 },
        aim: 0,
        team,
        name,
        hp: this.config.maxHp,
        maxHp: this.config.maxHp,
        alive: true,
        deployed: true,
        onGround: true,
        selectedSpawnId: "base",
        weaponIndex: 1,
        lastPrimaryIndex: 1,
        ammo: WEAPONS.map((w) => w.magSize),
        reserveAmmo: WEAPONS.map((w) => w.maxReserve),
        reloading: false,
        reloadTimer: 0,
        fireCooldown: 0,
        chargeTimer: 0,
        secondary: "frag",
        secondaryCooldown: 0,
        fragCharges: DEFAULT_CONFIG.fragMaxCharges,
        fragRechargeTimer: 0,
        jetpack: false,
        fuel: getPhysicsParams().jetpackFuel,
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
      const cur = WEAPONS[p.weaponIndex];
      const lastIdx = p.lastPrimaryIndex ?? p.weaponIndex;
      if (!cur || cur.isSupplyOnly) {
        const fallback = WEAPONS[lastIdx] && !WEAPONS[lastIdx].isSupplyOnly ? lastIdx : 0;
        p.weaponIndex = fallback;
        p.lastPrimaryIndex = fallback;
      } else {
        p.lastPrimaryIndex = p.weaponIndex;
      }
      let sx, sy;
      const wantedCp = p.selectedSpawnId && p.selectedSpawnId !== "base" ? this.capturePoints.find((c) => c.id === p.selectedSpawnId && isCapturePointSelectable(c, team)) : null;
      if (wantedCp) {
        sx = wantedCp.x;
        sy = wantedCp.y;
      } else if (this.config.randomSpawn) {
        const spot = RANDOM_SPAWN_CANDIDATES[this.rng.int(RANDOM_SPAWN_CANDIDATES.length)];
        sx = spot.x + this.rng.range(-45, 45);
        sy = spot.y;
      } else if (team === "ffa") {
        const spot = FFA_SPAWN_POINTS[this.rng.int(FFA_SPAWN_POINTS.length)];
        sx = spot.x;
        sy = spot.y;
      } else {
        if (team === "red" || team === "blue" || team === "green") this.rng.int(1);
        const base = SPAWN_POINTS.find((s) => s.team === team) ?? SPAWN_POINTS[0];
        sx = base.x;
        sy = base.y;
      }
      p.pos = { x: wrapX(sx + this.rng.range(-45, 45)), y: sy };
      p.vel = { x: 0, y: 0 };
      p.hp = this.config.maxHp;
      p.ammo = WEAPONS.map((w) => w.magSize);
      p.reserveAmmo = WEAPONS.map((w) => w.maxReserve);
      p.fragCharges = this.config.fragMaxCharges;
      p.fragRechargeTimer = 0;
      p.fuel = getPhysicsParams().jetpackFuel * (WEAPONS[p.weaponIndex]?.fuelMult ?? 1);
      p.shieldHp = 0;
      p.shieldTimer = 0;
      p.watchtowerTimer = 0;
      p.mountedTowerId = null;
      p.warpCooldown = 0;
      p.teleportTimer = 0;
      p.teleportTarget = null;
      const streak = p.deathStreak ?? 0;
      p.doll = null;
      p.dollCharges = streak >= SECONDARIES.doll.unlockStreak ? 1 : 0;
      if (!SECONDARIES[p.secondary] || !isSecondaryUnlocked(p.secondary, streak, p.dollCharges)) {
        p.secondary = getHighestUnlockedSecondary(streak, p.dollCharges);
      }
      p.reloading = false;
      p.fireCooldown = 0;
      p.chargeTimer = 0;
      p.chargeAim = void 0;
      p.secondaryCooldown = 0;
      p.deployed = true;
      p.alive = true;
      p.respawnTimer = 0;
      resolvePenetration(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
      ensureFreePosition(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
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
        const w = inputs.get(p.id) ?? defaultWorldInput();
        this.applyPlayerInput(p, w, dt);
        if (p.deployed) {
          stepPlayerKinematic(
            p,
            w,
            dt,
            this.terrain,
            this.obstacles,
            this.obstacleBroadBuckets,
            this.playerBroadBuckets,
            this.mortars,
            this.watchtowers
          );
          if (p.alive && p.respawnTimer <= 0 && this.activeGravityOrbs.length > 0) {
            applyGravityOrbPull(this.terrain, this.obstacles, this.activeGravityOrbs, p, dt, this.obstacleBroadBuckets);
          }
        }
        if (p.deployed && p.alive) {
          if (this.bodyOverlapsAt(p.pos.x, p.pos.y)) {
            const fixed = resolvePenetration(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
            if (fixed) {
              p.vel.x = 0;
              p.vel.y = 0;
            }
            const n = (this.stuckTicks.get(p.id) ?? 0) + 1;
            this.stuckTicks.set(p.id, n);
            if (n >= 20) {
              ensureFreePosition(this.terrain, this.obstacles, this.obstacleBroadBuckets, p);
              this.stuckTicks.set(p.id, 0);
            }
          } else {
            this.stuckTicks.set(p.id, 0);
          }
        }
      }
      this.rebuildPlayerBucketsOnly();
      separateOverlappingPlayers(this.players, this.playerBroadBuckets, this.terrain, this.obstacles, this.obstacleBroadBuckets);
      this.rebuildPlayerBucketsOnly();
      stepProjectilesSubsystem(this, dt);
      stepExplosionsAndThrowables(this, dt);
      stepMapInteractables(this, dt);
      let pw = 0;
      for (let i = 0; i < this.projectiles.length; i++) {
        const pr = this.projectiles[i];
        if (pr.life > 0 && pr.damage > 0) {
          this.projectiles[pw++] = pr;
        } else if (!this.events.some((e) => e.kind === "projectile_destroy" && e.projectileId === pr.id)) {
          this.events.push({ kind: "projectile_destroy", projectileId: pr.id });
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
      return checkBodyOverlapsAt(this.terrain, this.obstacles, x, y, this.obstacleBroadBuckets);
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
        const wep = WEAPONS[w.switchWeapon];
        const canSwitch = !this.config.loadoutLock || p.respawnTimer > 0 || !p.deployed;
        if (wep && !wep.isSupplyOnly && canSwitch) {
          p.weaponIndex = wep.id;
          p.lastPrimaryIndex = wep.id;
          p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1));
          p.reloading = false;
          p.reloadTimer = 0;
          p.fireCooldown = Math.max(p.fireCooldown, 0.3);
        }
      }
      const charging = p.chargeTimer > 0 && p.chargeAim !== void 0;
      p.aim = charging ? p.chargeAim : w.aim;
      const wepCur = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
      if (p.mountedTowerId) {
        p.vel.x = 0;
        p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1));
      } else {
        p.vel.x = w.move * getPhysicsParams().moveSpeed * (wepCur.moveSpeedMult ?? 1);
      }
      if (w.jump && p.onGround) jump(p.vel);
      const fuelMax = getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1);
      const fuel = Math.min(p.fuel, fuelMax);
      const canJet = !p.mountedTowerId && w.jetpack && fuel > 0;
      if (canJet) jetpack(p.vel, dt, wepCur.ascendMult ?? 1);
      p.jetpack = canJet;
      p.fuel = updateJetpackFuel(fuel, w.jetpack, !!p.onGround, dt, fuelMax);
      if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);
      if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt);
      if (p.fragCharges < this.config.fragMaxCharges) {
        p.fragRechargeTimer += dt;
        if (p.fragRechargeTimer >= this.config.fragRechargeSeconds) {
          p.fragRechargeTimer -= this.config.fragRechargeSeconds;
          p.fragCharges = Math.min(this.config.fragMaxCharges, p.fragCharges + 1);
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
      stepPlayerTeleport(this, p, dt);
      if (w.fire && wepCur.shellReload && p.reloading && p.ammo[p.weaponIndex] > 0) {
        p.reloading = false;
        p.reloadTimer = 0;
      }
      if (p.reloading) {
        if (!wepCur.shellReload || p.fireCooldown <= 0) {
          p.reloadTimer -= dt;
        }
        if (p.reloadTimer <= 0) {
          const wep = WEAPONS[p.weaponIndex];
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
        if (p.doll.timer <= 0) recallDollState(this.events, p);
      }
      const mountedNow = this.mortars.find((m) => m.operatorId === p.id);
      if (mountedNow) {
        let a = p.aim;
        if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12;
        mountedNow.angle = a;
      }
      if (w.interact) handlePlayerInteract(this, p);
      if (w.secondary) useSecondaryInWorld(this, p, w.secondary);
      const wepNow = WEAPONS[p.weaponIndex];
      if (wepNow?.beam) {
        if (w.fire) updateContinuousBeam(this, p, wepNow, dt);
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
          p.chargeTimer += dt;
          if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
            this.fire(p);
            p.chargeTimer = 0;
            p.chargeAim = void 0;
          }
        }
      } else if (w.fire) {
        this.fire(p);
      }
      p.prevFireHeld = w.fire;
    }
    fire(p) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const m = this.mortars.find((mm) => mm.operatorId === p.id);
      if (m) {
        if (m.cooldown <= 0) {
          m.cooldown = this.config.mortarCooldown;
          const mortarPr = createProjectile(
            this.prj++,
            p,
            m.x + Math.cos(m.angle) * 34,
            m.y - 18 + Math.sin(m.angle) * 34,
            Math.cos(m.angle) * m.power * 60,
            Math.sin(m.angle) * m.power * 60,
            { damage: this.config.mortarDamage, headshotMult: 1.5, terrainRadius: this.config.mortarRadius, explosive: true, gravityScale: 0.68, weaponLabel: "\u516C\u5171\u8FEB\u51FB\u70AE", color: "#f97316", r: 7.5, life: 175 / 60 }
          );
          this.projectiles.push(mortarPr);
          this.events.push({
            kind: "projectile_spawn",
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
          this.events.push({ kind: "mortar_fire", x: m.x, y: m.y, playerId: p.id });
        }
        return;
      }
      const wep = WEAPONS[p.weaponIndex];
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
        const rk = recoilDelta(wep.recoil, p.aim);
        if (!p.recoilVel) p.recoilVel = { x: 0, y: 0 };
        p.recoilVel.x = rk.x;
        p.recoilVel.y = rk.y;
      }
      const mx = wrapX(p.pos.x + Math.cos(p.aim) * 24);
      const my = p.pos.y - 12 + Math.sin(p.aim) * 24;
      for (let i = 0; i < wep.pellets; i++) {
        const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2);
        const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1);
        const pr = createProjectile(this.prj++, p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
          damage: wep.damage,
          headshotMult: wep.headshotMult,
          terrainRadius: wep.terrainRadius,
          explosive: wep.explosive,
          gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0 : 0.04),
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
          kind: "projectile_spawn",
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
        players: this.players.map((p) => ({
          ...p,
          pos: { x: p.pos.x, y: p.pos.y },
          vel: { x: p.vel.x, y: p.vel.y },
          ammo: [...p.ammo],
          reserveAmmo: [...p.reserveAmmo],
          teleportTarget: p.teleportTarget ? { x: p.teleportTarget.x, y: p.teleportTarget.y } : null,
          doll: p.doll ? { ...p.doll, pos: { x: p.doll.pos.x, y: p.doll.pos.y }, ammo: [...p.doll.ammo], reserveAmmo: [...p.doll.reserveAmmo] } : null
        })),
        projectiles: this.projectiles.map((pr) => ({ ...pr, pos: { x: pr.pos.x, y: pr.pos.y }, vel: { x: pr.vel.x, y: pr.vel.y }, hitTargets: [...pr.hitTargets] })),
        grenades: this.grenades.map((g) => ({ ...g, pos: { x: g.pos.x, y: g.pos.y }, vel: { x: g.vel.x, y: g.vel.y } })),
        landmines: this.landmines.map((m) => ({ ...m, pos: { x: m.pos.x, y: m.pos.y }, vel: { x: m.vel.x, y: m.vel.y } })),
        airstrikes: this.airstrikes.map((a) => ({ ...a, pos: { x: a.pos.x, y: a.pos.y } })),
        obstacles: this.obstacles.map((o) => ({ ...o })),
        capturePoints: this.capturePoints.map((c) => ({ ...c })),
        ammoPacks: this.ammoPacks.map((a) => ({ ...a })),
        supplyCrates: this.supplyCrates.map((c) => ({ ...c })),
        mortars: this.mortars.map((m) => ({ ...m })),
        scores: { ...this.scores }
      };
    }
  };

  // src/net/protocol/BinaryCodec.ts
  var MAGIC_SERVER = 1396847187;
  var TEAM_TO_IDX = { red: 0, blue: 1, green: 2, ffa: 3 };
  var POS_X_SCALE = 4;
  var INV_POS_X = 1 / POS_X_SCALE;
  var POS_Y_SCALE = 12;
  var INV_POS_Y = 1 / POS_Y_SCALE;
  var VEL_SCALE = 6;
  var INV_VEL = 1 / VEL_SCALE;
  var AIM_SCALE = 1e4;
  var INV_AIM = 1 / AIM_SCALE;
  function qPosX(x) {
    return clamp(Math.round(wrapX(x) * POS_X_SCALE), 0, 65535);
  }
  function qPosY(y) {
    return clamp(Math.round(wrapY(y) * POS_Y_SCALE), 0, 65535);
  }
  function qVel(v) {
    return clamp(Math.round(v * VEL_SCALE), -32767, 32767);
  }
  function qAim(a) {
    return clamp(Math.round(a * AIM_SCALE), -32767, 32767);
  }
  function qTimerMs(t) {
    return clamp(Math.round(Math.max(0, t) * 1e3), 0, 65535);
  }
  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();
  var ByteWriter = class {
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
      this.buf[this.offset++] = v & 255;
    }
    i8(v) {
      this.view.setInt8(this.offset++, v);
    }
    u16(v) {
      this.view.setUint16(this.offset, v & 65535, true);
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
          if (s.charCodeAt(i) > 127) {
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
  };
  var sharedServerWriter = new ByteWriter(32768);
  var sharedClientWriter = new ByteWriter(512);
  var staticDictCapturePoints = null;
  var staticDictSupplyCrates = null;
  var staticDictMortars = null;
  var staticDictAmmoSpots = /* @__PURE__ */ new Map();
  var encodedPlayerNames = /* @__PURE__ */ new Map();
  var lastEncObsSig = "";
  var lastEncCpSig = "";
  var lastEncAmmoSig = "";
  var lastEncCrateSig = "";
  var lastEncMortarSig = "";
  var encodedBallisticProjs = /* @__PURE__ */ new Map();
  function encodeServerMsgBinary(msg, opts = {}) {
    const w = sharedServerWriter;
    w.reset();
    w.ensure(64);
    w.u32(MAGIC_SERVER);
    const hasEvents = !!(msg.events && msg.events.length > 0);
    const hasWelcome = !!msg.welcome;
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
      const hasGravityOrb = s.projectiles.some((pr) => pr.isGravityOrb && pr.life > 0);
      const fullSend = [];
      const deadReckonedIds = [];
      const currentAliveIds = /* @__PURE__ */ new Set();
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
        w.u16(deadReckonedIds[i] & 65535);
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
      w.i16(Math.round(a.timer * 1e3));
      w.u8(a.dropped ? 1 : 0);
    }
    let facilityMask = 31;
    if (opts.deltaFacilities) {
      const obsSig = s.obstacles.map((o) => `${o.id}:${o.hp}`).join("|");
      const cpSig = s.capturePoints.map((c) => `${c.ownerTeam}:${Math.round(c.progress)}:${c.capturingTeam}`).join("|");
      const ammoSig = s.ammoPacks.map((a) => a.id).join("|");
      const crateSig = s.supplyCrates.map((c) => `${c.id}:${c.active ? 1 : 0}:${c.weaponId}`).join("|");
      const mortarSig = s.mortars.map((m) => `${m.operatorId}:${qAim(m.angle)}:${m.cooldown > 0 ? 1 : 0}`).join("|");
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
        const presetIdx = OBSTACLE_PRESETS.findIndex((p) => p.id === ob.id);
        if (presetIdx >= 0 && OBSTACLE_PRESETS[presetIdx].x === ob.x && OBSTACLE_PRESETS[presetIdx].y === ob.y) {
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
        staticDictCapturePoints = s.capturePoints.map((c) => ({ ...c }));
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
        w.u16(clamp(Math.round(cp.progress * 100), 0, 1e4));
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
        staticDictSupplyCrates = s.supplyCrates.map((c) => ({ ...c }));
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
          w.u8(c.kind === "doll" ? 1 : 0);
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
        staticDictMortars = s.mortars.map((m) => ({ ...m }));
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
    const secIdx = Math.max(0, SECONDARY_UNLOCK_ORDER.indexOf(p.secondary));
    const wepAndSec = p.weaponIndex & 15 | (secIdx & 1) << 4 | (p.fragCharges & 7) << 5;
    w.u8(wepAndSec);
    w.i16(clamp(Math.round(p.hp * 10), -32767, 32767));
    w.u16(p.maxHp);
    w.u16(clamp(Math.round(p.fuel * 1e3), 0, 65535));
    w.u16(p.kills);
    w.u16(p.deaths);
    const dollAndSec = clamp(p.dollCharges, 0, 7) & 7 | (secIdx & 7) << 3;
    w.u8(dollAndSec);
    w.u8(clamp(p.deathStreak ?? 0, 0, 255));
    if (encodedPlayerNames.get(p.id) === p.name) {
      w.u8(1);
    } else {
      encodedPlayerNames.set(p.id, p.name);
      w.u8(0);
      w.str(p.name);
    }
    w.ensure(64);
    const wi = p.weaponIndex;
    w.u16(clamp(Math.round((p.ammo[wi] ?? 0) * 100), 0, 65535));
    w.u16(p.reserveAmmo[wi] ?? 0);
    let otherAmmoModified = false;
    for (let i = 0; i < WEAPONS.length; i++) {
      if (i === wi) continue;
      if (p.ammo[i] !== WEAPONS[i].magSize || p.reserveAmmo[i] !== WEAPONS[i].maxReserve) {
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
        w.u16(clamp(Math.round(p.ammo[i] * 100), 0, 65535));
        w.u16(p.reserveAmmo[i]);
      }
    }
    if (timerMask & 2) w.u16(qTimerMs(p.reloadTimer));
    if (timerMask & 4) w.u16(qTimerMs(p.fireCooldown));
    if (timerMask & 8) w.u16(qTimerMs(p.chargeTimer));
    if (timerMask & 16) w.u16(qTimerMs(p.secondaryCooldown));
    if (timerMask & 32) w.u16(qTimerMs(p.fragRechargeTimer));
    if (timerMask & 64) {
      w.u16(clamp(Math.round(p.shieldHp * 10), 0, 65535));
      w.u16(qTimerMs(p.shieldTimer));
    }
    if (timerMask & 128) {
      w.u16(qTimerMs(p.respawnTimer));
      w.u16(qTimerMs(p.warpCooldown));
      w.u16(qTimerMs(p.watchtowerTimer));
      w.str(p.mountedTowerId ?? "");
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
      w.i16(clamp(Math.round(p.doll.hp * 10), -32767, 32767));
      w.u16(clamp(Math.round(p.doll.shieldHp * 10), 0, 65535));
      w.u16(clamp(Math.round(p.doll.fuel * 1e3), 0, 65535));
      w.u8(p.doll.weaponIndex);
      w.u16(qTimerMs(p.doll.timer));
      w.u8(p.doll.ammo.length);
      for (let i = 0; i < p.doll.ammo.length; i++) {
        w.u16(clamp(Math.round(p.doll.ammo[i] * 100), 0, 65535));
        w.u16(p.doll.reserveAmmo[i]);
      }
    }
  }
  function encodeProjectile(w, pr) {
    w.ensure(24);
    w.u32(pr.id);
    w.u16(pr.owner);
    w.i8(pr.weaponId);
    const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
    const expectedR = wep ? wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2 : -1;
    const isStandard = wep !== void 0 && pr.damage === wep.damage && pr.headshotMult === wep.headshotMult && pr.terrainRadius === wep.terrainRadius && Math.abs(pr.r - expectedR) < 1e-4 && pr.hitTargets.length === 1 && pr.hitTargets[0] === pr.owner;
    const flags = (pr.explosive ? 1 : 0) | (pr.isGravityOrb ? 2 : 0) | (pr.pierceOnHeadshot ? 4 : 0) | (pr.pierceAll ? 8 : 0) | (pr.passWalls ? 16 : 0) | (pr.beam ? 32 : 0) | (pr.rocket ? 64 : 0) | (!isStandard ? 128 : 0);
    w.u8(flags);
    w.u16(qPosX(pr.pos.x));
    w.u16(qPosY(pr.pos.y));
    w.i16(qVel(pr.vel.x));
    w.i16(qVel(pr.vel.y));
    w.u16(clamp(Math.round(Math.min(60, pr.life) * 1e3), 0, 65535));
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
  var EVENT_KINDS = [
    "hit",
    "kill",
    "explosion",
    "obstacle_destroy",
    "capture",
    "supply_pickup",
    "ammo_pickup",
    "warp",
    "shield",
    "shield_break",
    "doll_recall",
    "mortar_fire",
    "airstrike",
    "airstrike_drop",
    "laser",
    "watchtower",
    "headshot",
    "pierce",
    "projectile_spawn",
    "projectile_bounce",
    "projectile_destroy"
  ];
  var EVENT_KIND_TO_IDX = Object.fromEntries(EVENT_KINDS.map((k, i) => [k, i]));
  function encodeWorldEvent(w, e) {
    w.ensure(20);
    const kIdx = EVENT_KIND_TO_IDX[e.kind] ?? 0;
    w.u8(kIdx);
    if (e.kind === "laser" && e.segments) {
      w.u8(1);
      w.u16(qPosX(e.x ?? 0));
      w.u16(qPosY(e.y ?? 0));
      w.u16(qTimerMs(e.duration ?? 0.06));
      w.str(e.color ?? "#22d3ee");
      w.ensure(4 + e.segments.length * 8);
      w.u16(e.playerId ?? 0);
      w.str(e.weaponLabel ?? "\u9AD8\u65AF\u67AA");
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
    if (e.kind === "projectile_spawn" || e.kind === "projectile_bounce") {
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
    if (e.kind === "projectile_destroy") {
      w.u8(3);
      w.u32(e.projectileId ?? 0);
      return;
    }
    w.u8(0);
    w.str(JSON.stringify(e));
  }
  function filterSnapshotAOI(snap, centerPlayerId, radiusX = 2800, radiusY = 1800) {
    const viewer = snap.players.find((p) => p.id === centerPlayerId);
    if (!viewer) return snap;
    const vx = viewer.pos.x;
    const vy = viewer.pos.y;
    return {
      ...snap,
      projectiles: snap.projectiles.filter(
        (pr) => pr.owner === centerPlayerId || Math.abs(wrapDeltaX(vx, pr.pos.x)) <= radiusX && Math.abs(wrapDeltaY(vy, pr.pos.y)) <= radiusY
      ),
      grenades: snap.grenades.filter(
        (g) => g.owner === centerPlayerId || Math.abs(wrapDeltaX(vx, g.pos.x)) <= radiusX && Math.abs(wrapDeltaY(vy, g.pos.y)) <= radiusY
      )
    };
  }

  // src/net/transport/Peer.ts
  function encodeServerWireFrame(m) {
    return encodeServerMsgBinary(m);
  }

  // src/net/ServerSim.ts
  var ServerSim = class {
    world;
    clients = [];
    events = [];
    pendingBroadcastEvents = [];
    syncEveryTicks;
    enableAOI;
    aoiRadiusX;
    aoiRadiusY;
    tickCounter = 0;
    constructor(world2, opts = {}) {
      this.world = world2;
      this.syncEveryTicks = Math.max(1, opts.syncEveryTicks ?? 1);
      this.enableAOI = opts.enableAOI ?? false;
      this.aoiRadiusX = opts.aoiRadiusX ?? 2800;
      this.aoiRadiusY = opts.aoiRadiusY ?? 1800;
    }
    accept(id, transport) {
      const client = { id, transport, input: defaultWorldInput(), lastAckSeq: 0 };
      transport.onClient((msg) => {
        if (typeof msg.seq === "number" && msg.seq > client.lastAckSeq) {
          client.lastAckSeq = msg.seq;
        }
        client.input = applyIntents(client.input, msg.intents);
      });
      this.clients.push(client);
    }
    removeClient(id) {
      this.clients = this.clients.filter((c) => c.id !== id);
    }
    step(dt) {
      this.tickCounter++;
      const inputs = /* @__PURE__ */ new Map();
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
        const msg = { snap, events: outEvents };
        let sharedWireFrame = null;
        for (let i = 0; i < this.clients.length; i++) {
          const t = this.clients[i].transport;
          if (t.sendRawFrame) {
            if (sharedWireFrame === null) sharedWireFrame = encodeServerWireFrame(msg);
            t.sendRawFrame(sharedWireFrame);
          } else {
            t.send(msg);
          }
        }
      } else {
        for (let i = 0; i < this.clients.length; i++) {
          const c = this.clients[i];
          const clientSnap = filterSnapshotAOI(snap, c.id, this.aoiRadiusX, this.aoiRadiusY);
          c.transport.send({ snap: clientSnap, events: outEvents });
        }
      }
    }
    /** 取走累计事件（net/ui 层订阅 killfeed/音效用） */
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
  };
  function applyIntents(cur, intents) {
    const n = { ...cur };
    for (let i = 0; i < intents.length; i++) {
      const it = intents[i];
      switch (it.t) {
        case "move":
          n.move = it.dir;
          break;
        case "jump":
          n.jump = true;
          break;
        case "jetpack":
          n.jetpack = it.on;
          break;
        case "dive":
          n.dive = it.on;
          break;
        case "aim":
          n.aim = it.angle;
          break;
        case "fire":
          n.fire = it.on;
          break;
        case "reload":
          n.reload = true;
          break;
        case "interact":
          n.interact = true;
          break;
        case "secondary":
          n.secondary = { type: it.kind, targetX: it.targetX, targetY: it.targetY };
          break;
        case "switchWeapon":
          n.switchWeapon = it.index;
          break;
      }
    }
    return n;
  }

  // src/web/controls.ts
  var Controls = class {
    keys = /* @__PURE__ */ new Set();
    mouse = { x: 0, y: 0 };
    mouseDown = false;
    playerWorld = { x: 0, y: 0 };
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
    constructor(canvas2, logicalW, logicalH, cb = {}) {
      this.canvas = canvas2;
      this.logicalW = logicalW;
      this.logicalH = logicalH;
      const forcedTouch = new URLSearchParams(location.search).get("touch") === "1";
      this.isTouch = forcedTouch || "ontouchstart" in window;
      window.addEventListener("keydown", (e) => this.onKey(e, true));
      window.addEventListener("keyup", (e) => this.onKey(e, false));
      window.addEventListener("mousemove", (e) => {
        this.mouse = this.toWorld(e.clientX, e.clientY);
      });
      window.addEventListener("mousedown", (e) => {
        if (e.button === 0) this.mouseDown = true;
      });
      window.addEventListener("mouseup", (e) => {
        if (e.button === 0) this.mouseDown = false;
      });
      canvas2.addEventListener("touchstart", (e) => this.onTouch(e), { passive: false });
      canvas2.addEventListener("touchmove", (e) => this.onTouch(e), { passive: false });
      canvas2.addEventListener("touchend", (e) => this.onTouchEnd(e), { passive: false });
      canvas2.addEventListener("touchcancel", (e) => this.onTouchEnd(e), { passive: false });
    }
    /** 玩家逻辑世界坐标（供瞄准角计算） */
    setPlayerScreen(x, y) {
      this.playerWorld = { x, y };
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
        return { moveX: this.tMoveX, aimAngle: this.tAim, fire: this.tFire, jump: this.tJump, jetpack: this.tJetpack, reload: this.tReload };
      }
      const k = this.keys;
      let moveX = 0;
      if (k.has("a") || k.has("arrowleft")) moveX -= 1;
      if (k.has("d") || k.has("arrowright")) moveX += 1;
      const jetpack2 = k.has("w") || k.has(" ") || k.has("arrowup") || k.has("e");
      const aim = Math.atan2(this.mouse.y - this.playerWorld.y, this.mouse.x - this.playerWorld.x);
      return {
        moveX,
        aimAngle: aim,
        fire: this.mouseDown,
        jump: false,
        jetpack: jetpack2,
        reload: k.has("r")
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
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright", "e", "r"].includes(k)) e.preventDefault();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
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
        if (relX >= r.width / 2) this.tFire = false;
        else this.tMoveX = 0;
      }
    }
  };

  // src/web/fullscreen.ts
  function isFullscreen() {
    const d = document;
    return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
  }
  function toggleFullscreen() {
    const el = document.documentElement;
    const d = document;
    if (isFullscreen()) {
      ;
      d.exitFullscreen?.() ?? d.webkitExitFullscreen?.();
    } else {
      ;
      el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
    }
  }
  function fitCanvas(canvas2, logicalW, logicalH) {
    const ctx2 = canvas2.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas2.width = Math.max(1, Math.round(logicalW * dpr));
      canvas2.height = Math.max(1, Math.round(logicalH * dpr));
      canvas2.style.width = "100%";
      canvas2.style.height = "100%";
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    document.body.style.touchAction = "none";
    document.body.style.overflow = "hidden";
    return {
      toWorld: (clientX, clientY) => {
        const rect = canvas2.getBoundingClientRect();
        return {
          x: (clientX - rect.left) / rect.width * logicalW,
          y: (clientY - rect.top) / rect.height * logicalH
        };
      },
      applyTransform: () => {
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
  }

  // src/web/main-proto.ts
  var W = 960;
  var H = 600;
  var canvas = document.getElementById("game");
  var vp = fitCanvas(canvas, W, H);
  var ctx = canvas.getContext("2d");
  var controls = new Controls(canvas, W, H, { onFullscreen: toggleFullscreen });
  var SEED = 20261106;
  var world = new World(SEED);
  world.config.loadoutLock = false;
  var server = new ServerSim(world);
  var player = world.addPlayer("YOU", "red");
  player.pos = { x: 1700, y: 1750 };
  player.weaponIndex = 1;
  var bots = [world.addPlayer("AI-1", "blue"), world.addPlayer("AI-2", "blue")];
  bots[0].pos = { x: 2300, y: 1750 };
  bots[1].pos = { x: 1200, y: 2200 };
  var playerInput = defaultWorldInput();
  var botInputs = /* @__PURE__ */ new Map();
  var weaponKeyMap = { "1": 0, "2": 1, "3": 2, "4": 3 };
  var wantSecondary = null;
  var wantInteract = false;
  var wantSwitch = null;
  var secOrder = Object.keys(SECONDARIES);
  var secIndex = 0;
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (weaponKeyMap[k] !== void 0) wantSwitch = weaponKeyMap[k];
    if (k === "g") wantSecondary = secOrder[secIndex];
    if (k === "t") secIndex = (secIndex + 1) % secOrder.length;
    if (k === "e") wantInteract = true;
  });
  for (const id of ["btn-jump", "btn-jet"]) {
    document.getElementById(id)?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      controls.setJetpack(true);
    });
    document.getElementById(id)?.addEventListener("touchend", () => controls.setJetpack(false));
  }
  document.getElementById("btn-reload")?.addEventListener("touchstart", (e) => {
    e.preventDefault();
    controls.pressReload();
  });
  function toIntents(t) {
    const out = [];
    let moveDir = 0;
    if (t.moveX > 0.2) moveDir = 1;
    else if (t.moveX < -0.2) moveDir = -1;
    out.push({ t: "move", dir: moveDir });
    out.push({ t: "aim", angle: t.aimAngle });
    out.push({ t: "fire", on: t.fire });
    out.push({ t: "jetpack", on: t.jetpack });
    if (t.reload) out.push({ t: "reload" });
    if (wantInteract) {
      out.push({ t: "interact" });
      wantInteract = false;
    }
    if (wantSecondary) {
      const tx = wrapX(player.pos.x + Math.cos(t.aimAngle) * 240);
      const ty = wrapY(player.pos.y + Math.sin(t.aimAngle) * 240);
      out.push({ t: "secondary", kind: wantSecondary, targetX: tx, targetY: ty });
      wantSecondary = null;
    }
    if (wantSwitch !== null) {
      out.push({ t: "switchWeapon", index: wantSwitch });
      wantSwitch = null;
    }
    return out;
  }
  function botInput(bot) {
    const enemies = [player, ...bots.filter((b) => b !== bot)];
    let target = enemies[0];
    let best = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    const dx = wrapDeltaX(bot.pos.x, target.pos.x);
    const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12);
    const aim = Math.atan2(dy, dx);
    let move = 0;
    if (Math.abs(dx) > 320) move = dx > 0 ? 1 : -1;
    else if (Math.abs(dx) < 160) move = dx > 0 ? -1 : 1;
    return {
      ...defaultWorldInput(),
      move,
      aim,
      fire: world.tick % 10 < 4
    };
  }
  var cam = { x: player.pos.x, y: player.pos.y };
  function updateCamera() {
    const tx = cam.x + wrapDeltaX(cam.x, player.pos.x) * 0.12;
    const ty = cam.y + wrapDeltaY(cam.y, player.pos.y) * 0.12;
    cam.x = wrapX(tx);
    cam.y = wrapY(ty);
  }
  function screenOf(wx, wy) {
    const dx = wrapDeltaX(cam.x, wx);
    const dy = wrapDeltaY(cam.y, wy);
    return { x: W / 2 + dx, y: H / 2 + dy };
  }
  function render() {
    vp.applyTransform();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b0f16";
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
      const left = p.x - ob.w / 2, top = p.y - ob.h / 2;
      if (left > W + 40 || left + ob.w < -40 || top > H + 40 || top + ob.h < -40) continue;
      ctx.fillStyle = ob.color;
      ctx.fillRect(left, top, ob.w, ob.h);
      ctx.strokeStyle = ob.borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2);
      ctx.fillStyle = "#000";
      ctx.fillRect(left, top - 6, ob.w, 3);
      ctx.fillStyle = "#5ad37a";
      ctx.fillRect(left, top - 6, ob.w * (ob.hp / ob.maxHp), 3);
    }
    for (const cp of world.capturePoints) {
      const p = screenOf(cp.x, cp.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
      const teamColor = cp.ownerTeam === "red" ? "#f43f5e" : cp.ownerTeam === "blue" ? "#0ea5e9" : cp.ownerTeam === "green" ? "#10b981" : cp.ownerTeam === "ffa" ? "#eab308" : "#94a3b8";
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`\u{1F6A9}${cp.code} ${Math.round(cp.progress)}%`, p.x, p.y - 64);
    }
    for (const a of world.ammoPacks) {
      const p = screenOf(a.x, a.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
    }
    for (const c of world.supplyCrates) {
      if (!c.active) continue;
      const p = screenOf(c.x, c.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = c.color;
      ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
    }
    for (const m of world.mortars) {
      const p = screenOf(m.x, m.y);
      if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
      ctx.fillStyle = m.operatorId ? "#f97316" : "#64748b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of world.landmines) {
      if (m.respawnTimer > 0) continue;
      const p = screenOf(m.pos.x, m.pos.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = m.triggered ? "#ef4444" : m.preset ? "#f59e0b" : "#fb7185";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const g of world.grenades) {
      const p = screenOf(g.pos.x, g.pos.y);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const st of world.airstrikes) {
      const p = screenOf(st.pos.x, st.pos.y);
      ctx.strokeStyle = "#ef4444";
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
    drawPlayer(player, "#4ade80", "YOU");
    for (const b of bots) drawPlayer(b, "#f87171", b.name);
    const hud = [
      `\u2764 ${player.hp}/${player.maxHp}   ${WEAPONS[player.weaponIndex].shortName} ${player.ammo[player.weaponIndex]}/${player.reserveAmmo[player.weaponIndex]}   \u{1F6E1}${player.shieldTimer > 0 ? player.shieldHp : "-"}`,
      `\u526F\u6B66\u5668: ${SECONDARIES[secOrder[secIndex]].icon} ${SECONDARIES[secOrder[secIndex]].name} [T\u5207\u6362 G\u4F7F\u7528]   \u{1F6A9} ${world.capturePoints.map((c) => `${c.code}:${Math.round(c.progress)}%`).join(" ")}`,
      `\u6BD4\u5206 R/B/G ${world.scores.red}/${world.scores.blue}/${world.scores.green}   pos=(${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)})   tick=${world.tick}`
    ];
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(8, 8, 680, 62);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    hud.forEach((line, i) => ctx.fillText(line, 14, 24 + i * 18));
    const cross = screenOf(player.pos.x + Math.cos(player.aim) * 240, player.pos.y - 12 + Math.sin(player.aim) * 240);
    ctx.strokeStyle = "rgba(255,255,255,.5)";
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
    ctx.fillStyle = p.alive ? color : "#475569";
    ctx.fillRect(s.x - 10, s.y - 26, 20, 42);
    ctx.beginPath();
    ctx.arc(s.x, s.y - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 12);
    ctx.lineTo(s.x + Math.cos(p.aim) * 34, s.y - 12 + Math.sin(p.aim) * 34);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.fillRect(s.x - 18, s.y - 40, 36, 4);
    ctx.fillStyle = p.hp > 50 ? "#5ad37a" : p.hp > 25 ? "#e0b74d" : "#e05a5a";
    ctx.fillRect(s.x - 18, s.y - 40, 36 * Math.max(0, p.hp) / p.maxHp, 4);
    if (p.shieldTimer > 0) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 12, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${label} ${p.kills}/${p.deaths}`, s.x, s.y - 46);
  }
  var last = performance.now();
  var acc = 0;
  var FIXED = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1e3);
    last = now;
    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      const t = controls.getState();
      controls.setPlayerScreen(W / 2, H / 2);
      playerInput = applyIntents(playerInput, toIntents(t));
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
  var PARAM_KEY = "pvp-physics-params-v2";
  function persistParams(p) {
    try {
      localStorage.setItem(PARAM_KEY, JSON.stringify(p));
    } catch {
    }
  }
  function clearParams() {
    try {
      localStorage.removeItem(PARAM_KEY);
    } catch {
    }
  }
  (function loadSavedParams() {
    try {
      const raw = localStorage.getItem(PARAM_KEY);
      if (raw) setPhysicsParams(JSON.parse(raw));
    } catch {
    }
  })();
  window.__tune = {
    set: (p) => {
      const cur = setPhysicsParams(p);
      persistParams(cur);
      return cur;
    },
    get: () => getPhysicsParams(),
    reset: () => {
      const cur = resetPhysicsParams();
      clearParams();
      return cur;
    }
  };
})();
