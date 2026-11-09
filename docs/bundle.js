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
  var CEILING_HOLE_X0 = 5600;
  var CEILING_HOLE_X1 = 7600;
  function defaultMapData() {
    const solids = [
      // 天花板左板（环形 x 0~5600）
      { x: 0, y: CEILING_TOP, w: CEILING_HOLE_X0, h: CEILING_THICK, kind: "platform" },
      // 天花板右板（环形 x 7600~13200）
      { x: CEILING_HOLE_X1, y: CEILING_TOP, w: WORLD_W - CEILING_HOLE_X1, h: CEILING_THICK, kind: "platform" },
      // 空口拱形方块落脚点：正方形 160×160，不可摧毁（block=实心地形），中间高两侧低、相邻一高一低
      ...ARCH_BLOCKS()
    ];
    return { name: "\u5929\u82B1\u677F\u7ADE\u6280\u573A", solids };
  }
  function ARCH_BLOCKS() {
    const SIDE = 160;
    const xs = [5700, 6e3, 6300, 6600, 6900, 7200, 7500];
    const tops = [2700, 2500, 2620, 2400, 2620, 2500, 2700];
    return xs.map((x, i) => ({ x: x - SIDE / 2, y: tops[i], w: SIDE, h: SIDE, kind: "block" }));
  }
  function sanitizeMapData(raw) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw;
    const solidsRaw = Array.isArray(o.solids) ? o.solids : [];
    const solids = [];
    for (const s of solidsRaw) {
      if (!s || typeof s !== "object") continue;
      const r = s;
      const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
      if (![x, y, w, h].every(Number.isFinite)) continue;
      if (w <= 0 || h <= 0) continue;
      const kind = r.kind === "platform" || r.kind === "block" ? r.kind : "cover";
      solids.push({ x, y, w, h, kind });
      if (solids.length >= 2e3) break;
    }
    if (solids.length === 0) return null;
    return { name: typeof o.name === "string" ? o.name : "\u81EA\u5B9A\u4E49\u5730\u56FE", solids };
  }

  // src/core/terrain.ts
  var TILE_SIZE = 20;
  var GRID_W = Math.floor(WORLD_W / TILE_SIZE);
  var GRID_H = Math.floor(WORLD_H / TILE_SIZE);
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
    /** 挖空（保留供未来扩展；当前平地地图未使用） */
    carveTunnel(x, y, w, h, label = "\u5730\u4E0B\u5730\u9053") {
      this.setGridRect(x, y, w, h, 0);
      this.rects.push({ x, y, w, h, color: "#090d16", borderColor: "#1e293b", kind: "tunnel_bg", label });
      this.shadows.push({ x, y, w, h, label, alpha: 0.76 });
    }
    build(customSolids) {
      this.grid.fill(0);
      this.rects.length = 0;
      this.shadows.length = 0;
      this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, "#1e293b", "#334155", "earth");
      if (customSolids) {
        for (const r of customSolids) {
          const style = r.kind === "platform" ? { color: "#334155", border: "#38bdf8", kind: "platform", label: "\u5E73\u53F0" } : r.kind === "block" ? { color: "#334155", border: "#a855f7", kind: "block", label: "\u65B9\u5757" } : { color: "#1f2937", border: "#f97316", kind: "cover", label: "\u65B9\u5F62\u63A9\u4F53" };
          this.addSolidBlock(r.x, r.y, r.w, r.h, style.color, style.border, style.kind, style.label);
        }
        return;
      }
      for (const r of defaultMapData().solids) {
        const style = r.kind === "platform" ? { color: "#334155", border: "#38bdf8", kind: "platform", label: "\u5E73\u53F0" } : r.kind === "block" ? { color: "#334155", border: "#a855f7", kind: "block", label: "\u65B9\u5757" } : { color: "#1f2937", border: "#f97316", kind: "cover", label: "\u8857\u533A\u5EFA\u7B51" };
        this.addSolidBlock(r.x, r.y, r.w, r.h, style.color, style.border, style.kind, style.label);
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
    { id: "obs_1", x: 1600, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_2", x: 3400, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_3", x: 4600, y: 240, w: 60, h: 80, hp: 240, label: "\u65B9\u5F62\u63A9\u4F53", color: "#78350f", borderColor: "#f59e0b" },
    { id: "obs_box_1", x: 5400, y: 238, w: 68, h: 70, hp: 170, label: "\u91CD\u88C5\u63A9\u4F53\u7BB1", color: "#365314", borderColor: "#84cc16" },
    { id: "obs_5", x: 7800, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#7c2d12", borderColor: "#fb923c" },
    { id: "obs_6", x: 11200, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_7", x: 12500, y: 240, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" }
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
  function formatWeaponAmmoText(w) {
    return w.pellets > 1 ? `${w.magSize}/${w.maxReserve}\u53D1(${w.pellets}\u4E38)` : `${w.magSize}/${w.maxReserve}\u53D1`;
  }
  function formatWeaponCardSubtitle(w) {
    const ammo = formatWeaponAmmoText(w);
    return w.traitDesc ? `${ammo} \xB7 ${w.traitDesc}` : ammo;
  }
  function formatSecondaryButtonTitle(s, withSupplyTag = false) {
    if (s.unlockStreak <= 0) return `${s.icon} ${s.name} [\u9ED8\u8BA4]`;
    if (s.id === "doll" && withSupplyTag) return `${s.icon} ${s.name} [\u8FDE\u6B7B${s.unlockStreak}/\u8865\u7ED9]`;
    return `${s.icon} ${s.name} [\u8FDE\u6B7B${s.unlockStreak}]`;
  }
  function formatSecondaryCardSubtitle(s, cfg = DEFAULT_CONFIG) {
    if (s.id === "frag") return `${cfg.fragMaxCharges} \u5145\u80FD\u81EA\u7136\u56DE\u590D\uFF08${cfg.fragRechargeSeconds}s/\u679A\uFF09`;
    if (s.id === "obstacle") return `${s.cd}s\u51B7\u5374 \xB7 \u65E0\u9650\u751F\u6210${cfg.obstacleDefaultHp}HP\u63A9\u4F53`;
    if (s.id === "shield") return `${cfg.shieldHp}HP \u62A4\u76FE \xB7 \u4F24\u5BB3\u4E0D\u6EA2\u51FA \xB7 \u78B0\u649E\u7BB1\u7565\u5927`;
    if (s.id === "teleport") return "\u8BFB\u6761\u540E\u76F4\u63A5\u51FA\u73B0\u5728\u53F3\u952E\u4F4D\u7F6E";
    if (s.id === "doll") return `\u8FDE\u6B7B${s.unlockStreak}\u89E3\u9501\u6216\u7279\u6B8A\u8865\u7ED9\u62FE\u53D6`;
    return s.desc ?? "";
  }

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
  var GROUND_STAND = 2740;
  var SPAWN_POINTS = [
    { x: 1100, y: GROUND_STAND, team: "red" },
    { x: 12100, y: GROUND_STAND, team: "blue" },
    { x: 3300, y: GROUND_STAND, team: "green" },
    { x: 9900, y: GROUND_STAND, team: "ffa" }
  ];
  var AMMO_SPOTS = [
    { x: 1300, y: GROUND_STAND, area: "\u897F\u533A\u5E73\u5730" },
    { x: 2100, y: GROUND_STAND, area: "\u897F\u533A\u5E73\u53F0\u4E0B" },
    { x: 2900, y: GROUND_STAND, area: "\u4E2D\u897F\u5E73\u5730" },
    { x: 4600, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u592E\u897F" },
    { x: 5400, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u7A7A\u53E3\u5DE6" },
    { x: 7800, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u7A7A\u53E3\u53F3" },
    { x: 10200, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E1C\u533A" }
  ];
  var SUPPLY_SPOTS = [
    { x: 1500, y: GROUND_STAND, area: "\u897F\u533A\u8865\u7ED9\u70B9" },
    { x: 3100, y: GROUND_STAND, area: "\u4E2D\u897F\u8865\u7ED9\u70B9" },
    { x: 4300, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u4E2D\u592E\u897F\u8865\u7ED9\u70B9" },
    { x: 5400, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u7A7A\u53E3\u5DE6\u8865\u7ED9\u70B9" },
    { x: 7800, y: CEILING_STAND, area: "\u5929\u82B1\u677F\xB7\u7A7A\u53E3\u53F3\u8865\u7ED9\u70B9" },
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
  var RANDOM_SPAWN_CANDIDATES = (() => {
    const out = [];
    for (let x = 400; x < WORLD_W; x += 620) out.push({ x, y: SURFACE_Y - 60 });
    for (const sp of SPAWN_POINTS) out.push({ x: sp.x, y: sp.y - 60 });
    return out;
  })();
  var JUMP_PADS = [
    { x: 1e3, y: 280, vx: 210, vy: -810 },
    { x: 4300, y: 280, vx: 180, vy: -870 },
    { x: 10400, y: 280, vx: -180, vy: -870 },
    { x: 13050, y: 280, vx: -210, vy: -810 }
  ];
  var CP_INITS = [
    { id: "cp_a", code: "A", name: "\u636E\u70B9A\xB7\u897F\u533A", x: 1720, y: CEILING_STAND, ownerTeam: "red" },
    { id: "cp_b", code: "B", name: "\u636E\u70B9B\xB7\u4E2D\u592E\u897F", x: 3900, y: CEILING_STAND, ownerTeam: null },
    { id: "cp_c", code: "C", name: "\u636E\u70B9C\xB7\u4E2D\u592E", x: 5400, y: CEILING_STAND, ownerTeam: "green" },
    { id: "cp_d", code: "D", name: "\u636E\u70B9D\xB7\u4E2D\u4E1C", x: 7800, y: CEILING_STAND, ownerTeam: null },
    { id: "cp_e", code: "E", name: "\u636E\u70B9E\xB7\u4E1C\u533A", x: 11420, y: CEILING_STAND, ownerTeam: "blue" }
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
    const base = SPAWN_POINTS.find((s) => s.team === p.team) ?? SPAWN_POINTS[3];
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
  function predictLocalPlayerStep(p, w, dt, terrain, obstacles = [], mortars = [], watchtowers = []) {
    if (!p.deployed || !p.alive || p.respawnTimer > 0) return;
    p.aim = w.aim;
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
    stepPlayerKinematic(p, w, dt, terrain, obstacles, void 0, void 0, mortars, watchtowers);
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
  function stepClientProjectilesDeadReckoning(projectiles, dt, terrain) {
    const g = getPhysicsParams().gravity;
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i];
      if (pr.life <= 0) continue;
      if (pr.dragPerSecond < 1) {
        const k = Math.pow(pr.dragPerSecond, dt);
        pr.vel.x *= k;
        pr.vel.y *= k;
      }
      pr.vel.y += g * pr.gravityScale * dt;
      pr.pos.x = wrapX(pr.pos.x + pr.vel.x * dt);
      pr.pos.y = wrapY(pr.pos.y + pr.vel.y * dt);
      pr.life -= dt;
      if (terrain && !pr.passWalls && pr.bounces <= 0 && terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
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
          cp.capturingTeam = t;
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
    // ── 子系统接口方法 ──
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
      if (this.config.randomSpawn) {
        const spot = RANDOM_SPAWN_CANDIDATES[this.rng.int(RANDOM_SPAWN_CANDIDATES.length)];
        sx = spot.x + this.rng.range(-60, 60);
        sy = spot.y;
      } else {
        const owned = this.capturePoints.filter((c) => c.ownerTeam === team && c.progress >= 100);
        const cp = owned.length > 0 ? owned[this.rng.int(owned.length)] : null;
        const base = SPAWN_POINTS.find((s) => s.team === team) ?? SPAWN_POINTS[3];
        sx = cp ? cp.x : base.x;
        sy = cp ? cp.y - 60 : base.y;
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
    // ── 主 step：按子系统顺序编排 ──────────────────────────────
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

  // src/core/balanceOverrides.ts
  var OVERRIDES_STORAGE_KEY = "skyblast_balance_overrides_v1";
  var BALANCE_KEY = OVERRIDES_STORAGE_KEY;
  var WEAPON_NUMERIC_KEYS = [
    "damage",
    "headshotMult",
    "pellets",
    "spread",
    "speed",
    "recoil",
    "magSize",
    "maxReserve",
    "reloadTime",
    "fireDelay",
    "terrainRadius",
    "gravityScale",
    "bounces",
    "dragPerSecond",
    "chargeSeconds",
    "damagePerSecond",
    "ammoPerSecond",
    "moveSpeedMult",
    "fuelMult",
    "ascendMult",
    "fovMult",
    "falloffStart",
    "falloffEnd",
    "falloffMin",
    "lifeSeconds",
    "farRange",
    "farDamage",
    "edgeDamage"
  ];
  var WEAPON_BOOL_KEYS = ["explosive", "pierceOnHeadshot", "pierceAll", "passWalls", "friendlyFire", "selfDamage"];
  var CONFIG_NUMERIC_KEYS = [
    "maxHp",
    "respawnDelay",
    "headRadius",
    "grenadeDamage",
    "grenadeRadius",
    "grenadeFuse",
    "fragMaxCharges",
    "fragRechargeSeconds",
    "dollMaxCharges",
    "dollDuration",
    "mortarDamage",
    "mortarRadius",
    "watchtowerDuration",
    "watchtowerFovMult"
  ];
  var CONFIG_BOOL_KEYS = ["randomSpawn", "loadoutLock", "grenadeFriendlyFire", "grenadeSelfDamage"];
  var num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  var clamp2 = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  var WEAPON_BOUNDS = {
    damage: [0, 2e3],
    headshotMult: [0.5, 10],
    pellets: [1, 32],
    spread: [0, 1.5],
    speed: [50, 1e4],
    recoil: [0, 5e3],
    magSize: [1, 500],
    maxReserve: [0, 2e3],
    reloadTime: [0.05, 30],
    fireDelay: [0, 10],
    terrainRadius: [0, 400],
    gravityScale: [0, 5],
    bounces: [0, 16],
    dragPerSecond: [0.05, 1],
    chargeSeconds: [0, 5],
    damagePerSecond: [0, 5e3],
    ammoPerSecond: [0.1, 200],
    moveSpeedMult: [0.1, 5],
    fuelMult: [0.1, 5],
    ascendMult: [0.1, 5],
    fovMult: [1, 2],
    falloffStart: [0, 5e3],
    falloffEnd: [1, 1e4],
    falloffMin: [0, 1],
    lifeSeconds: [0.05, 9999],
    farRange: [50, 1e4],
    farDamage: [0, 2e3],
    edgeDamage: [0, 2e3]
  };
  function sanitizeOverrides(raw) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const out = {};
    if (r.weapons && typeof r.weapons === "object") {
      const wOut = {};
      for (const [idStr, patch] of Object.entries(r.weapons)) {
        const id = Number(idStr);
        if (!Number.isInteger(id) || id < 0 || id >= WEAPONS.length) continue;
        if (!patch || typeof patch !== "object") continue;
        const p = patch;
        const clean = {};
        for (const k of WEAPON_NUMERIC_KEYS) {
          if (k in p) {
            const n = num(p[k]);
            if (n !== null) {
              const b = WEAPON_BOUNDS[k] ?? [-1e6, 1e6];
              clean[k] = clamp2(n, b[0], b[1]);
            }
          }
        }
        for (const k of WEAPON_BOOL_KEYS) {
          if (typeof p[k] === "boolean") clean[k] = p[k];
        }
        if (Object.keys(clean).length > 0) wOut[String(id)] = clean;
      }
      if (Object.keys(wOut).length > 0) out.weapons = wOut;
    }
    if (r.config && typeof r.config === "object") {
      const c = r.config;
      const clean = {};
      for (const k of CONFIG_NUMERIC_KEYS) {
        if (k in c) {
          const n = num(c[k]);
          if (n !== null) clean[k] = clamp2(n, 0, 1e4);
        }
      }
      for (const k of CONFIG_BOOL_KEYS) {
        if (typeof c[k] === "boolean") clean[k] = c[k];
      }
      if (Object.keys(clean).length > 0) out.config = clean;
    }
    if (r.physics && typeof r.physics === "object") {
      const ph = r.physics;
      const clean = {};
      for (const k of ["gravity", "moveSpeed", "jumpVelocity", "jetpackThrust", "jetpackMaxUp", "jetpackFuel"]) {
        if (k in ph) {
          const n = num(ph[k]);
          if (n !== null) clean[k] = clamp2(n, -5e3, 1e4);
        }
      }
      if (Object.keys(clean).length > 0) out.physics = clean;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  function applyWeaponOverrides(patches) {
    if (!patches) return;
    for (const [idStr, p] of Object.entries(patches)) {
      const w = WEAPONS[Number(idStr)];
      if (w && p) Object.assign(w, p);
    }
  }
  function applyConfigOverrides(target, patch) {
    if (!patch) return;
    Object.assign(target, patch);
  }
  var DEFAULT_WEAPONS_SNAPSHOT = WEAPONS.map((w) => ({ ...w }));
  var DEFAULT_CONFIG_SNAPSHOT = { ...DEFAULT_CONFIG };

  // src/web/effects.ts
  var MAX_PARTICLES = 400;
  var Effects = class {
    particles = [];
    overwriteCursor = 0;
    rnd() {
      return Math.random();
    }
    push(p) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles[this.overwriteCursor] = p;
        this.overwriteCursor = (this.overwriteCursor + 1) % MAX_PARTICLES;
      } else {
        this.particles.push(p);
      }
    }
    /** 爆炸：火球 + 火花 + 烟 */
    explosion(x, y, radius) {
      const n = Math.min(26, Math.round(radius / 6) + 8);
      for (let i = 0; i < n; i++) {
        const a = this.rnd() * Math.PI * 2;
        const spd = (0.6 + this.rnd() * 2.2) * (radius / 60);
        this.push({
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 0.6,
          life: 24 + this.rnd() * 22,
          maxLife: 46,
          size: 2 + this.rnd() * 4,
          color: this.rnd() > 0.4 ? "#fb923c" : this.rnd() > 0.5 ? "#fbbf24" : "#ef4444",
          gravity: 0.05,
          fade: true
        });
      }
      for (let i = 0; i < 8; i++) {
        this.push({
          x,
          y,
          vx: (this.rnd() - 0.5) * 0.6,
          vy: -0.4 - this.rnd() * 0.8,
          life: 30 + this.rnd() * 26,
          maxLife: 56,
          size: 5 + this.rnd() * 8,
          color: "rgba(120,130,150,0.55)",
          gravity: -0.01,
          fade: true
        });
      }
    }
    /** 障碍物破坏：碎块 */
    debris(x, y, w, h, color, border) {
      for (let i = 0; i < 14; i++) {
        this.push({
          x: x + (this.rnd() - 0.5) * w,
          y: y + (this.rnd() - 0.5) * h,
          vx: (this.rnd() - 0.5) * 4,
          vy: -1 - this.rnd() * 3,
          life: 26 + this.rnd() * 20,
          maxLife: 46,
          size: 2 + this.rnd() * 4,
          color: this.rnd() > 0.5 ? color : border,
          gravity: 0.22,
          fade: true
        });
      }
    }
    /** 拾取/补给：上升的星光 */
    sparkle(x, y, color = "#4ade80") {
      for (let i = 0; i < 10; i++) {
        this.push({
          x: x + (this.rnd() - 0.5) * 24,
          y,
          vx: (this.rnd() - 0.5) * 0.6,
          vy: -1 - this.rnd() * 1.4,
          life: 22 + this.rnd() * 18,
          maxLife: 40,
          size: 1.5 + this.rnd() * 2.5,
          color,
          gravity: -0.02,
          fade: true
        });
      }
    }
    /** 枪口火焰 */
    muzzle(x, y, color) {
      for (let i = 0; i < 4; i++) {
        this.push({
          x,
          y,
          vx: (this.rnd() - 0.5) * 1.2,
          vy: (this.rnd() - 0.5) * 1.2,
          life: 6 + this.rnd() * 6,
          maxLife: 12,
          size: 2 + this.rnd() * 3,
          color,
          gravity: 0,
          fade: true
        });
      }
    }
    /** 喷气尾焰 */
    jet(x, y) {
      this.push({
        x: x + (this.rnd() - 0.5) * 6,
        y: y + 8,
        vx: (this.rnd() - 0.5) * 0.5,
        vy: 1.4 + this.rnd() * 1.6,
        life: 8 + this.rnd() * 8,
        maxLife: 16,
        size: 2 + this.rnd() * 2.5,
        color: this.rnd() > 0.5 ? "#7dd3fc" : "#38bdf8",
        gravity: 0.02,
        fade: true
      });
    }
    /** 击杀：能量爆散 */
    killBurst(x, y, color) {
      for (let i = 0; i < 14; i++) {
        const a = this.rnd() * Math.PI * 2;
        const spd = 1 + this.rnd() * 3;
        this.push({
          x,
          y: y - 12,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 1,
          life: 18 + this.rnd() * 16,
          maxLife: 34,
          size: 2 + this.rnd() * 3,
          color,
          gravity: 0.08,
          fade: true
        });
      }
    }
    update(dt) {
      const k = dt * 60;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= k;
        if (p.life <= 0) {
          const last = this.particles.length - 1;
          if (i !== last) this.particles[i] = this.particles[last];
          this.particles.pop();
          if (this.overwriteCursor >= this.particles.length) this.overwriteCursor = 0;
          continue;
        }
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.vy += p.gravity * k;
        p.vx *= 0.99;
      }
    }
    /** 渲染：由调用方提供 世界→屏幕 的偏移函数（相机居中坐标系） */
    render(ctx2, screenOf, inView) {
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const s = screenOf(p.x, p.y);
        if (!inView(s.x, s.y)) continue;
        const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
        ctx2.globalAlpha = alpha;
        ctx2.fillStyle = p.color;
        ctx2.beginPath();
        ctx2.arc(s.x, s.y, p.size, 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.globalAlpha = 1;
    }
    clear() {
      this.particles.length = 0;
      this.overwriteCursor = 0;
    }
  };

  // src/web/app/context.ts
  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var camera = { x: 6600, y: 2380, fovFactor: 1 };
  var screenFx = { shake: 0 };
  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth || 1024;
    canvas.height = window.innerHeight || 640;
  }
  function loadCustomMap() {
    try {
      const raw = localStorage.getItem("pvp-custom-map");
      if (!raw) return void 0;
      return sanitizeMapData(JSON.parse(raw)) ?? void 0;
    } catch {
      return void 0;
    }
  }
  var customMap = loadCustomMap();
  function loadBalanceOverrides() {
    try {
      const raw = localStorage.getItem(BALANCE_KEY);
      if (!raw) return null;
      return sanitizeOverrides(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  var balanceOverrides = loadBalanceOverrides();
  applyWeaponOverrides(balanceOverrides?.weapons);
  if (balanceOverrides?.physics) setPhysicsParams({ ...getPhysicsParams(), ...balanceOverrides.physics });
  var world = new World(20261106, customMap);
  applyConfigOverrides(world.config, balanceOverrides?.config);
  var localPlayer = world.addPlayer("SkyHunter", "red");
  localPlayer.deployed = false;
  world.config.randomSpawn = true;
  var botNames = ["AlphaBot-7", "Valkyrie-AI", "Titan-09", "NovaStriker", "ZeroGrav-X", "OmegaHound", "Phantom-AI", "IronClad-8"];
  var botSecs = ["frag", "doll", "frag", "frag", "doll", "frag", "frag", "frag"];
  var bots = [];
  var pendingLoadout = { weaponIndex: 0, secondaryType: "frag", spawnPointId: "base" };
  var mode = { current: "ffa" };
  var keys = {};
  var mouse = { x: 0, y: 0, worldX: 6600, worldY: 2380, down: false };
  var touchState = {
    enabled: false,
    moveActive: false,
    moveId: -1,
    moveX: 0,
    moveY: 0,
    boostButtonDown: false,
    aimActive: false,
    aimId: -1,
    aimX: 0,
    aimY: 0
  };
  var inputQueue = { interact: false, secondary: null, reload: false };
  var effects = new Effects();
  var beams = [];
  var starRng = /* @__PURE__ */ (() => {
    let seed = 2654435769;
    return () => {
      seed = seed + 1831565813 | 0;
      let t = seed;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  })();
  var worldStars = (() => {
    const out = [];
    for (let i = 0; i < 640; i++) {
      out.push({ x: starRng() * WORLD_W, y: starRng() * WORLD_H, r: 0.6 + starRng() * 1.4, a: 0.2 + starRng() * 0.6 });
    }
    return out;
  })();
  var worldGlows = [
    { x: 6600, y: 1080, r: 620, c: "56,189,248", a: 0.09 },
    { x: 4150, y: 3560, r: 520, c: "16,185,129", a: 0.07 },
    { x: 10150, y: 3520, r: 520, c: "244,63,94", a: 0.07 }
  ];
  var FIXED = 1 / 60;

  // src/web/app/toast.ts
  function escapeHtml(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var toastTimer = 0;
  function showToast(msg) {
    const el = document.getElementById("toastBanner");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.add("hidden"), 3400);
  }
  var TEAM_LIGHT = { red: "#fda4af", blue: "#7dd3fc", green: "#6ee7b7", ffa: "#fde047" };
  function addKillFeed(killerName, killerTeam, victimName, victimTeam, weaponLabel, isHeadshot, isPierced) {
    const feed = document.getElementById("killFeedContainer");
    if (!feed) return;
    const item = document.createElement("div");
    item.className = "kill-item glass-panel px-3 py-1.5 rounded-xl border border-slate-700/90 shadow-lg flex items-center gap-2 text-xs";
    item.innerHTML = `
    <span class="font-extrabold" style="color:${TEAM_LIGHT[killerTeam] ?? "#fda4af"}">${escapeHtml(killerName)}</span>
    <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-200 border border-slate-700">${escapeHtml(weaponLabel)}</span>
    ${isHeadshot ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400 text-amber-300 text-[10px] font-extrabold">\u{1F3AF} \u7206\u5934</span>' : ""}
    ${isPierced ? '<span class="px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-400 text-purple-200 text-[10px] font-extrabold">\u26A1 \u7A7F\u900F</span>' : ""}
    <span class="font-extrabold" style="color:${TEAM_LIGHT[victimTeam] ?? "#7dd3fc"}">${escapeHtml(victimName)}</span>
  `;
    feed.prepend(item);
    while (feed.children.length > 6) feed.removeChild(feed.lastChild);
    window.setTimeout(() => item.remove(), 6500);
  }

  // src/web/app/hud.ts
  function syncLoadoutTextFromSingleSource() {
    document.querySelectorAll(".death-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      const wep = WEAPONS[slot];
      if (!wep) return;
      const divs = btn.querySelectorAll("div");
      if (divs[0]) divs[0].textContent = wep.shortName;
      if (divs[1]) divs[1].textContent = formatWeaponCardSubtitle(wep);
    });
    document.querySelectorAll(".lobby-wep-btn").forEach((btn, idx) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      const wep = WEAPONS[slot];
      if (!wep) return;
      const divs = btn.querySelectorAll("div");
      if (divs[0]) divs[0].textContent = `${idx + 1}. ${wep.shortName}`;
      if (divs[1]) divs[1].textContent = formatWeaponCardSubtitle(wep);
    });
    document.querySelectorAll(".death-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec") || "frag";
      const def = SECONDARIES[sec];
      if (!def) return;
      btn.textContent = formatSecondaryButtonTitle(def, true);
    });
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec") || "frag";
      const def = SECONDARIES[sec];
      if (!def) return;
      const divs = btn.querySelectorAll("div");
      if (divs[0]) divs[0].textContent = formatSecondaryButtonTitle(def, false);
      if (divs[1]) divs[1].textContent = formatSecondaryCardSubtitle(def, world.config);
    });
  }
  function updateHudWeaponButtons() {
    syncLoadoutTextFromSingleSource();
    const streak = localPlayer.deathStreak ?? 0;
    const dollCharges = localPlayer.dollCharges ?? 0;
    document.querySelectorAll(".death-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      btn.className = slot === pendingLoadout.weaponIndex ? "death-wep-btn px-2.5 py-2 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-left transition" : "death-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
    });
    document.querySelectorAll(".death-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec") || "frag";
      const unlocked = isSecondaryUnlocked(sec, streak, dollCharges);
      const isSelected = sec === pendingLoadout.secondaryType;
      btn.className = "death-sec-btn px-2.5 py-1.5 rounded-lg border text-xs transition " + (isSelected ? "border-2 border-rose-400 bg-rose-500/20 font-extrabold text-white" : unlocked ? "border-slate-600 bg-slate-900/90 font-semibold text-slate-200 hover:border-rose-400/60" : "border-slate-800 bg-slate-950/40 font-semibold text-slate-500 opacity-55 cursor-not-allowed");
      btn.disabled = !unlocked;
    });
    const streakNote = document.getElementById("deathSecNote");
    if (streakNote) {
      const highest = SECONDARIES[getHighestUnlockedSecondary(streak, dollCharges)] ?? SECONDARIES.frag;
      streakNote.textContent = `\u5F53\u524D\u8FDE\u6B7B ${streak} \u6B21 \xB7 \u5DF2\u89E3\u9501\u81F3\u3010${highest.icon} ${highest.name}\u3011\uFF08\u83B7\u5F97\u51FB\u6740\u91CD\u7F6E\u8FDE\u6B7B\uFF09`;
    }
    document.querySelectorAll(".lobby-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      btn.className = slot === pendingLoadout.weaponIndex ? "lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition" : "lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
    });
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec") || "frag";
      const unlocked = isSecondaryUnlocked(sec, streak, dollCharges);
      if (!unlocked) {
        btn.className = "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60";
      } else {
        btn.className = sec === pendingLoadout.secondaryType ? "lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition" : "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
      }
      ;
      btn.disabled = !unlocked;
    });
  }
  function updateSpawnPointButtonsUI() {
    const container = document.getElementById("spawnPointBtnGroup");
    if (!container) return;
    container.querySelectorAll(".spawn-select-btn").forEach((btn) => {
      const spId = btn.getAttribute("data-spawn") || "base";
      let unlocked = spId === "base";
      if (spId !== "base") {
        const cp = world.capturePoints.find((c) => c.id === spId);
        unlocked = Boolean(cp && (cp.ownerTeam === localPlayer.team || localPlayer.team === "ffa"));
      }
      const isSelected = pendingLoadout.spawnPointId === spId;
      if (!unlocked) btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/40 text-slate-600 text-[11px] font-semibold cursor-not-allowed";
      else if (isSelected) btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 text-[11px] font-extrabold";
      else btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-[11px] font-semibold hover:border-emerald-400/50";
    });
  }
  function tryChangePrimaryWeapon(slotIdx) {
    const wep = WEAPONS[slotIdx];
    if (!wep || wep.isSupplyOnly) return;
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast("\u{1F512} \u4E3B\u6B66\u5668\u5728\u91CD\u751F\u524D\u5DF2\u9009\u5B9A\u9501\u5B9A\uFF01\u9635\u4EA1\u91CD\u751F\u524D\u6216\u62FE\u53D6\u7A7A\u6295\u7279\u6B66\u65F6\u65B9\u53EF\u66F4\u6362");
      return;
    }
    pendingLoadout.weaponIndex = slotIdx;
    localPlayer.weaponIndex = slotIdx;
    localPlayer.lastPrimaryIndex = slotIdx;
    updateHudWeaponButtons();
  }
  function tryChangeSecondaryWeapon(secType) {
    const def = SECONDARIES[secType];
    if (!def) return;
    const streak = localPlayer.deathStreak ?? 0;
    const dollCharges = localPlayer.dollCharges ?? 0;
    const unlocked = isSecondaryUnlocked(secType, streak, dollCharges);
    if (!unlocked) {
      if (secType === "doll") {
        showToast(`\u{1F512} \u66FF\u8EAB\u4EBA\u5076\u9700\u8FDE\u7EED\u9635\u4EA1 ${def.unlockStreak} \u6B21\u89E3\u9501\uFF0C\u6216\u4ECE\u6218\u573A\u7279\u6B8A\u8865\u7ED9\u7BB1\u62FE\u53D6\u5145\u80FD\uFF01`);
      } else {
        showToast(`\u{1F512} \u3010${def.icon} ${def.name}\u3011\u9700\u8FDE\u7EED\u9635\u4EA1 ${def.unlockStreak} \u6B21\u89E3\u9501\uFF08\u5F53\u524D\u8FDE\u6B7B ${streak} \u6B21\uFF09`);
      }
      return;
    }
    if (secType === "doll" && localPlayer.deployed && localPlayer.respawnTimer <= 0 && dollCharges > 0) {
      localPlayer.secondary = secType;
      updateHudWeaponButtons();
      showToast(`\u{1F38E} \u5DF2\u5207\u6362\u66FF\u8EAB\u4EBA\u5076\uFF08\u5145\u80FD ${dollCharges}\uFF09`);
      return;
    }
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast("\u{1F512} \u526F\u6B66\u5668\u5728\u91CD\u751F\u524D\u5DF2\u9009\u5B9A\u9501\u5B9A\uFF01\u9635\u4EA1\u91CD\u751F\u524D\u53EF\u91CD\u65B0\u9009\u62E9");
      return;
    }
    pendingLoadout.secondaryType = secType;
    localPlayer.secondary = secType;
    updateHudWeaponButtons();
  }
  var TEAM_BADGE = {
    red: ["\u7EA2\u961F ALPHA", "bg-rose-500/20 text-rose-300 border border-rose-500/40"],
    blue: ["\u84DD\u961F BRAVO", "bg-sky-500/20 text-sky-300 border border-sky-500/40"],
    green: ["\u7EFF\u961F CHARLIE", "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"],
    ffa: ["\u6DF7\u6218 SOLO", "bg-amber-500/20 text-amber-300 border border-amber-500/40"]
  };
  function updateHudUI() {
    const nameEl = document.getElementById("hudPlayerName");
    if (nameEl) nameEl.textContent = localPlayer.name;
    const teamEl = document.getElementById("hudTeamBadge");
    if (teamEl) {
      const [label, cls] = TEAM_BADGE[localPlayer.team] ?? TEAM_BADGE.red;
      teamEl.textContent = label;
      teamEl.className = `px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`;
    }
    const topKdEl = document.getElementById("hudTopKdText");
    if (topKdEl) {
      const k = localPlayer.kills ?? 0;
      const d = localPlayer.deaths ?? 0;
      topKdEl.textContent = `${k}/${d}`;
    }
    const fovBadge = document.getElementById("hudSniperFovBadge");
    if (fovBadge) {
      const wepForFov = WEAPONS[localPlayer.weaponIndex];
      if (localPlayer.mountedTowerId) {
        fovBadge.textContent = "\u{1F5FC} \u77AD\u671B\u89C6\u91CE 200%\uFF08\u6309 E \u4E0B\u5854\uFF09";
        fovBadge.classList.remove("hidden");
      } else if ((wepForFov?.fovMult ?? 1) > 1.01) {
        const charge = (wepForFov?.chargeSeconds ?? 0) > 0 ? localPlayer.chargeTimer > 0 ? ` \xB7 \u84C4\u529B ${Math.min(100, Math.round(localPlayer.chargeTimer / (wepForFov?.chargeSeconds ?? 1) * 100))}%` : " \xB7 \u6309\u4E00\u4E0B\u8BFB\u6761" : "";
        fovBadge.textContent = `\u{1F52D} ${wepForFov.shortName} \u89C6\u91CE+30%${charge}`;
        fovBadge.classList.remove("hidden");
      } else fovBadge.classList.add("hidden");
    }
    const hpBar = document.getElementById("hudHpBar");
    if (hpBar) hpBar.style.width = clamp(localPlayer.hp / localPlayer.maxHp * 100, 0, 100) + "%";
    const shieldBar = document.getElementById("hudShieldBar");
    if (shieldBar) shieldBar.style.width = localPlayer.shieldTimer > 0 ? clamp(localPlayer.shieldHp / world.config.shieldHp * 100, 0, 100) + "%" : "0%";
    const hpText = document.getElementById("hudHpText");
    if (hpText) hpText.textContent = `${Math.max(0, Math.round(localPlayer.hp))} / ${localPlayer.maxHp}`;
    const fuelBar = document.getElementById("hudFuelBar");
    const fuelMaxNow = getPhysicsParams().jetpackFuel * (WEAPONS[localPlayer.weaponIndex]?.fuelMult ?? 1);
    if (fuelBar) fuelBar.style.width = clamp(localPlayer.fuel / Math.max(1e-3, fuelMaxNow) * 100, 0, 100) + "%";
    const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0];
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    const wNameEl = document.getElementById("currentWeaponName");
    if (wNameEl) wNameEl.textContent = mounted ? "\u{1F3AF} \u8FEB\u51FB\u70AE" : wep.name;
    const plateEl = document.getElementById("hudCurrentWeaponName");
    if (plateEl) plateEl.textContent = wep.shortName;
    const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag;
    const secChipEl = document.getElementById("hudSecondaryChipText");
    if (secChipEl) {
      if (localPlayer.secondary === "doll") {
        secChipEl.textContent = `\u{1F38E} \u66FF\u8EAB\u4EBA\u5076 [${localPlayer.dollCharges}]`;
      } else if (localPlayer.secondary === "frag") {
        secChipEl.textContent = `\u{1F4A3} \u624B\u69B4\u5F39 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`;
      } else if (localPlayer.secondary === "teleport" && (localPlayer.teleportTimer ?? 0) > 0) {
        secChipEl.textContent = `\u{1F300} Teleport [\u8BFB\u6761 ${localPlayer.teleportTimer.toFixed(1)}s]`;
      } else {
        const cdStr = localPlayer.secondaryCooldown > 0 ? ` [${localPlayer.secondaryCooldown.toFixed(1)}s]` : " [\u5C31\u7EEA]";
        secChipEl.textContent = `${secDef.icon} ${secDef.name}${cdStr}`;
      }
    }
    const curAmmo = Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0));
    const ammoEl = document.getElementById("currentAmmoText");
    const reserveEl = document.getElementById("reserveAmmoText");
    if (ammoEl) {
      ammoEl.textContent = mounted ? "\u221E" : String(curAmmo);
    }
    if (reserveEl) {
      reserveEl.textContent = mounted ? "" : String(localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0);
    }
    const ammoPipsEl = document.getElementById("hudAmmoPips");
    if (ammoPipsEl) {
      if (wep.shellReload && wep.magSize <= 12) {
        let html = "";
        for (let i = 0; i < wep.magSize; i++) {
          const filled = i < curAmmo;
          const isLoadingThis = localPlayer.reloading && i === curAmmo;
          html += `<span class="h-1.5 flex-1 rounded-xs transition-all duration-75 ${filled ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.7)]" : isLoadingThis ? "bg-cyan-400/80 animate-pulse" : "bg-slate-800"}"></span>`;
        }
        if (ammoPipsEl.getAttribute("data-sig") !== `shell:${curAmmo}:${localPlayer.reloading ? 1 : 0}:${wep.magSize}`) {
          ammoPipsEl.setAttribute("data-sig", `shell:${curAmmo}:${localPlayer.reloading ? 1 : 0}:${wep.magSize}`);
          ammoPipsEl.innerHTML = html;
        }
      } else {
        const pct = Math.round(clamp(curAmmo / Math.max(1, wep.magSize) * 100, 0, 100));
        const sig = `bar:${pct}`;
        if (ammoPipsEl.getAttribute("data-sig") !== sig) {
          ammoPipsEl.setAttribute("data-sig", sig);
          ammoPipsEl.innerHTML = `<span class="block h-1.5 w-full rounded-full bg-slate-800 overflow-hidden"><span class="block h-full bg-gradient-to-r from-amber-400 to-cyan-300 transition-all duration-75" style="width:${pct}%"></span></span>`;
        }
      }
    }
    const gOverlay = document.getElementById("grenadeCdOverlay");
    const gLabel = document.getElementById("hudGrenadeLabel");
    const gTitle = document.getElementById("hudSecondaryTitle");
    if (gTitle) {
      if (localPlayer.secondary === "doll") {
        gTitle.textContent = `[G/\u53F3\u952E] \u66FF\u8EAB\u4EBA\u5076`;
      } else if (localPlayer.secondary === "frag") {
        gTitle.textContent = `[G/\u53F3\u952E] \u624B\u69B4\u5F39`;
      } else {
        gTitle.textContent = `[G/\u53F3\u952E] ${secDef.name}`;
      }
    }
    if (gOverlay && gLabel) {
      if (localPlayer.secondary === "doll") {
        gOverlay.style.height = localPlayer.dollCharges > 0 ? "0%" : "100%";
        gLabel.textContent = localPlayer.dollCharges > 0 ? `\u{1F38E} \u5C31\u7EEA \xD7${localPlayer.dollCharges}` : "\u{1F38E} \u65E0\u5145\u80FD";
      } else if (localPlayer.secondary === "frag") {
        const need = localPlayer.fragCharges >= world.config.fragMaxCharges;
        if (need) {
          gOverlay.style.height = "0%";
          gLabel.textContent = `\u{1F4A3} \u5C31\u7EEA (${localPlayer.fragCharges}/${world.config.fragMaxCharges})`;
        } else {
          const pct = Math.min(100, localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds * 100);
          gOverlay.style.height = 100 - pct + "%";
          gLabel.textContent = `\u{1F4A3} ${(world.config.fragRechargeSeconds - localPlayer.fragRechargeTimer).toFixed(1)}s`;
        }
      } else if (localPlayer.secondary === "teleport" && (localPlayer.teleportTimer ?? 0) > 0) {
        const castTotal = Math.max(0.05, world.config.teleportCastTime ?? 0.35);
        const pct = clamp((1 - localPlayer.teleportTimer / castTotal) * 100, 0, 100);
        gOverlay.style.height = 100 - pct + "%";
        gLabel.textContent = `\u{1F300} \u8BFB\u6761 ${Math.round(pct)}%`;
      } else {
        if (localPlayer.secondaryCooldown <= 0) {
          gOverlay.style.height = "0%";
          gLabel.textContent = `${secDef.icon} \u5C31\u7EEA`;
        } else {
          const pct = clamp(localPlayer.secondaryCooldown / Math.max(0.1, secDef.cd) * 100, 0, 100);
          gOverlay.style.height = pct + "%";
          gLabel.textContent = `${secDef.icon} ${localPlayer.secondaryCooldown.toFixed(1)}s`;
        }
      }
    }
    const reloadWrap = document.getElementById("reloadProgressWrap");
    const reloadBar = document.getElementById("reloadProgressBar");
    const reloadLabel = document.getElementById("reloadProgressLabel");
    const reloadPctEl = document.getElementById("reloadProgressPct");
    const reloadDockBottomBar = document.getElementById("reloadDockBottomBar");
    if (reloadWrap && reloadBar) {
      if (localPlayer.reloading) {
        reloadWrap.classList.remove("invisible", "opacity-0", "translate-y-1");
        reloadWrap.classList.add("opacity-100", "translate-y-0");
        const wep2 = WEAPONS[localPlayer.weaponIndex];
        if (wep2.shellReload) {
          const perShell = wep2.reloadTime / Math.max(1, wep2.magSize);
          const pct = localPlayer.fireCooldown > 0 ? 0 : clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, perShell)), 0, 100);
          reloadBar.style.width = pct + "%";
          if (reloadDockBottomBar) reloadDockBottomBar.style.width = clamp((curAmmo + pct / 100) / Math.max(1, wep2.magSize) * 100, 0, 100) + "%";
          if (reloadLabel) reloadLabel.textContent = `\u9010\u53D1\u88C5\u586B ${curAmmo}/${wep2.magSize}`;
          if (reloadPctEl) reloadPctEl.textContent = localPlayer.fireCooldown > 0 ? "\u6CF5\u52A8" : `${Math.round(pct)}%`;
        } else {
          const pct = clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, wep2.reloadTime)), 0, 100);
          reloadBar.style.width = pct + "%";
          if (reloadDockBottomBar) reloadDockBottomBar.style.width = pct + "%";
          if (reloadLabel) reloadLabel.textContent = `\u6362\u5F39\u4E2D \xB7 ${wep2.shortName}`;
          if (reloadPctEl) reloadPctEl.textContent = `${Math.round(pct)}%`;
        }
      } else {
        reloadWrap.classList.add("invisible", "opacity-0", "translate-y-1");
        reloadWrap.classList.remove("opacity-100", "translate-y-0");
        if (reloadDockBottomBar) reloadDockBottomBar.style.width = "0%";
      }
    }
    const banner = document.getElementById("interactBanner");
    const bannerText = document.getElementById("interactBannerText");
    if (!banner || !bannerText) return;
    let promptMsg = null;
    if (!localPlayer.deployed) {
      promptMsg = "\u{1F3E0} \u5F85\u673A\u6574\u5907\u4E2D\uFF1A\u70B9\u51FB\u6B64\u5904\u6216\u300C\u7ACB\u5373\u8FDB\u5165\u6218\u573A\u300D\u90E8\u7F72\uFF1B\u53EF\u81EA\u7531\u66F4\u6362\u4E3B/\u526F\u6B66\u5668\u4E0E\u961F\u4F0D";
    } else if (localPlayer.respawnTimer > 0) {
      promptMsg = "";
    } else if (mounted) {
      promptMsg = "\u{1F3AF} \u8FEB\u51FB\u70AE\u64CD\u63A7\u4E2D\uFF1A\u79FB\u52A8\u9F20\u6807\u8C03\u8282\u843D\u70B9\uFF0C\u6309\u4F4F\u5F00\u706B\u53D1\u5C04 | \u6309 [E] \u6216\u70B9\u51FB\u6B64\u5904\u79BB\u5F00";
    } else {
      for (const m of world.mortars) {
        if (m.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, m.x, m.y) < 115) {
          promptMsg = `\u{1F525} \u6309 [E] \u6216\u70B9\u51FB\u6B64\u5904\u64CD\u63A7\u3010${m.name}\u3011`;
          break;
        }
      }
      if (localPlayer.mountedTowerId) {
        promptMsg = "\u{1F5FC} \u77AD\u671B\u5854\u4E0A\uFF08\u89C6\u91CE 200%\uFF09\uFF1A\u6309 [E] \u4E0B\u5854\uFF0C\u89C6\u91CE\u52A0\u6210\u7ACB\u5373\u6D88\u5931";
      }
      if (!promptMsg) {
        for (const tw of world.watchtowers) {
          if (tw.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, tw.x, tw.y) < 130) {
            promptMsg = `\u{1F5FC} \u6309 [E] \u767B\u4E0A\u3010${tw.name}\u3011\uFF08\u9501\u5B9A 200% \u89C6\u91CE\uFF0C\u4E0D\u80FD\u79FB\u52A8\uFF1B\u4E0B\u5854\u5373\u5931\u6548\uFF09`;
            break;
          }
        }
      }
      if (!promptMsg) {
        for (const wp of world.warpPortals) {
          if (wrapDist(localPlayer.pos.x, localPlayer.pos.y, wp.x, wp.y) < 90) {
            promptMsg = `\u{1F300} \u6309 [E] \u542F\u52A8\u3010${wp.name}\u3011\u91CF\u5B50\u4F20\u9001`;
            break;
          }
        }
      }
      if (!promptMsg) {
        const dollCrate = world.supplyCrates.find((c) => c.active && c.kind === "doll" && wrapDist(localPlayer.pos.x, localPlayer.pos.y, c.x, c.y) < 60);
        if (dollCrate) promptMsg = "\u{1F38E} \u9760\u8FD1\u7279\u6B8A\u8865\u7ED9\u7BB1\u81EA\u52A8\u62FE\u53D6\u66FF\u8EAB\u4EBA\u5076\u5145\u80FD";
      }
    }
    if (promptMsg) {
      banner.classList.remove("hidden");
      bannerText.textContent = promptMsg;
    } else banner.classList.add("hidden");
  }
  function updateScoreboardUI() {
    const r = document.getElementById("scoreRed");
    const b = document.getElementById("scoreBlue");
    const g = document.getElementById("scoreGreen");
    if (r) r.textContent = String(world.scores.red ?? 0);
    if (b) b.textContent = String(world.scores.blue ?? 0);
    if (g) g.textContent = String(world.scores.green ?? 0);
  }
  function updateTeamCountUI() {
    const counts = { red: 0, blue: 0, green: 0, ffa: 0 };
    for (const p of world.players) {
      if (counts[p.team] !== void 0) counts[p.team]++;
    }
    for (const key of ["Red", "Blue", "Green", "Ffa"]) {
      const el = document.getElementById("teamCount" + key);
      if (el) el.textContent = counts[key.toLowerCase()] + "\u4EBA";
    }
  }

  // src/net/protocol/BinaryCodec.ts
  var MAGIC_SERVER = 1396847187;
  var MAGIC_CLIENT = 1396847171;
  var BINARY_STR_PREFIX = "\0SB2:";
  var TEAMS = ["red", "blue", "green", "ffa"];
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
  function uPosX(q) {
    return q * INV_POS_X;
  }
  function qPosY(y) {
    return clamp(Math.round(wrapY(y) * POS_Y_SCALE), 0, 65535);
  }
  function uPosY(q) {
    return q * INV_POS_Y;
  }
  function qVel(v) {
    return clamp(Math.round(v * VEL_SCALE), -32767, 32767);
  }
  function uVel(q) {
    return q * INV_VEL;
  }
  function qAim(a) {
    return clamp(Math.round(a * AIM_SCALE), -32767, 32767);
  }
  function uAim(q) {
    return q * INV_AIM;
  }
  function qTimerMs(t) {
    return clamp(Math.round(Math.max(0, t) * 1e3), 0, 65535);
  }
  function uTimerMs(q) {
    return q * 1e-3;
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
  var ByteReader = class {
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
      if (len === 0) return "";
      const start = this.offset;
      const end = start + len;
      this.offset = end;
      if (len <= 64) {
        let ascii = "";
        for (let i = start; i < end; i++) {
          const c = this.buf[i];
          if (c > 127) return textDecoder.decode(this.buf.subarray(start, end));
          ascii += String.fromCharCode(c);
        }
        return ascii;
      }
      return textDecoder.decode(this.buf.subarray(start, end));
    }
  };
  var sharedServerWriter = new ByteWriter(32768);
  var sharedClientWriter = new ByteWriter(512);
  var staticDictCapturePoints = null;
  var staticDictSupplyCrates = null;
  var staticDictMortars = null;
  var staticDictAmmoSpots = /* @__PURE__ */ new Map();
  var encodedPlayerNames = /* @__PURE__ */ new Map();
  var decodedPlayerNames = /* @__PURE__ */ new Map();
  var lastEncObsSig = "";
  var lastEncCpSig = "";
  var lastEncAmmoSig = "";
  var lastEncCrateSig = "";
  var lastEncMortarSig = "";
  var lastDecObstacles = [];
  var lastDecCapturePoints = [];
  var lastDecAmmoPacks = [];
  var lastDecSupplyCrates = [];
  var lastDecMortars = [];
  var encodedBallisticProjs = /* @__PURE__ */ new Map();
  var decodedBallisticProjs = /* @__PURE__ */ new Map();
  var lastDecodedTick = 0;
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
  function decodeServerMsgBinary(bytes) {
    if (bytes.byteLength < 5) return null;
    const r = new ByteReader(bytes);
    const magic = r.u32();
    if (magic !== MAGIC_SERVER) return null;
    const hdrFlags = r.u8();
    const snap = decodeSnapshot(r, !!(hdrFlags & 16), !!(hdrFlags & 32));
    const out = { snap };
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
      out.welcome = { playerId, name, team };
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
        decodedBallisticProjs.set(pr.id & 65535, pr);
      }
    } else {
      const dtTicks = lastDecodedTick > 0 && tick > lastDecodedTick ? tick - lastDecodedTick : 1;
      const fullCount = r.u16();
      const freshProjs = new Array(fullCount);
      for (let i = 0; i < fullCount; i++) {
        const pr = decodeProjectile(r);
        freshProjs[i] = pr;
        decodedBallisticProjs.set(pr.id & 65535, pr);
      }
      const keptCount = r.u16();
      const keptProjs = [];
      for (let i = 0; i < keptCount; i++) {
        const shortId = r.u16();
        const cached = decodedBallisticProjs.get(shortId);
        if (cached) {
          stepClientProjectilesDeadReckoning([cached], 1 / 60 * dtTicks);
          keptProjs.push({
            ...cached,
            pos: { x: cached.pos.x, y: cached.pos.y },
            vel: { x: cached.vel.x, y: cached.vel.y },
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
        pos: { x: uPosX(r.u16()), y: uPosY(r.u16()) },
        vel: { x: uVel(r.i16()), y: uVel(r.i16()) },
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
        pos: { x: px, y: py },
        vel: { x: vx, y: vy },
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
        pos: { x: uPosX(r.u16()), y: uPosY(r.u16()) },
        timer: r.i16() * 1e-3,
        dropped: r.u8() !== 0
      };
    }
    const facilityMask = isDeltaFacilities ? r.u8() : 31;
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
          const p = OBSTACLE_PRESETS[idx];
          obstacles[i] = { ...p, hp, maxHp };
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
      lastDecObstacles = obstacles.map((o) => ({ ...o }));
    } else {
      obstacles = lastDecObstacles.map((o) => ({ ...o }));
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
        staticDictCapturePoints = capturePoints.map((c) => ({ ...c }));
      }
      lastDecCapturePoints = capturePoints.map((c) => ({ ...c }));
    } else {
      capturePoints = lastDecCapturePoints.map((c) => ({ ...c }));
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
        let area = "";
        if (isKnown) {
          area = staticDictAmmoSpots.get(x) ?? "";
        } else {
          area = r.str();
          staticDictAmmoSpots.set(x, area);
        }
        ammoPacks[i] = { id, x, y, area };
      }
      lastDecAmmoPacks = ammoPacks.map((a) => ({ ...a }));
    } else {
      ammoPacks = lastDecAmmoPacks.map((a) => ({ ...a }));
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
          const w = weaponId >= 0 ? WEAPONS[weaponId] : null;
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
            kind: r.u8() === 1 ? "doll" : "weapon",
            weaponId: r.i8(),
            weaponName: r.str(),
            color: r.str(),
            active: r.u8() !== 0,
            respawnTimer: uTimerMs(r.u16())
          };
        }
      }
      if (!staticDictSupplyCrates && supplyCrates.length > 0) {
        staticDictSupplyCrates = supplyCrates.map((c) => ({ ...c }));
      }
      lastDecSupplyCrates = supplyCrates.map((c) => ({ ...c }));
    } else {
      supplyCrates = lastDecSupplyCrates.map((c) => ({ ...c }));
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
        mortars[i] = { id, name, x, y, angle, power, cooldown, operatorId: op >= 0 ? op : null };
      }
      if (!staticDictMortars && mortars.length > 0) {
        staticDictMortars = mortars.map((m) => ({ ...m }));
      }
      lastDecMortars = mortars.map((m) => ({ ...m }));
    } else {
      mortars = lastDecMortars.map((m) => ({ ...m }));
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
  function decodePlayer(r) {
    const id = r.u16();
    const px = uPosX(r.u16());
    const py = uPosY(r.u16());
    const vx = uVel(r.i16());
    const vy = uVel(r.i16());
    const aim = uAim(r.i16());
    const bitFlags = r.u8();
    const wepAndSec = r.u8();
    const team = TEAMS[bitFlags & 3] ?? "ffa";
    const alive = !!(bitFlags & 4);
    const deployed = !!(bitFlags & 8);
    const onGround = !!(bitFlags & 16);
    const jetpack2 = !!(bitFlags & 32);
    const reloading = !!(bitFlags & 64);
    const hasDoll = !!(bitFlags & 128);
    const weaponIndex = wepAndSec & 15;
    const fragCharges = wepAndSec >> 5 & 7;
    const hp = r.i16() * 0.1;
    const maxHp = r.u16();
    const fuel = r.u16() * 1e-3;
    const kills = r.u16();
    const deaths = r.u16();
    const dollAndSec = r.u8();
    const dollCharges = dollAndSec & 7;
    const secIdx = dollAndSec >> 3 & 7;
    const secondary = SECONDARY_UNLOCK_ORDER[secIdx] ?? "frag";
    const deathStreak = r.u8();
    const nameCached = r.u8() === 1;
    let name = "";
    if (nameCached) {
      name = decodedPlayerNames.get(id) ?? "Player_" + id;
    } else {
      name = r.str();
      decodedPlayerNames.set(id, name);
    }
    const curAmmo = r.u16() * 0.01;
    const curReserve = r.u16();
    const ammo = WEAPONS.map((w) => w.magSize);
    const reserveAmmo = WEAPONS.map((w) => w.maxReserve);
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
        teleportTarget = { x: uPosX(r.u16()), y: uPosY(r.u16()) };
      }
    }
    let doll = null;
    if (hasDoll) {
      const dx = uPosX(r.u16());
      const dy = uPosY(r.u16());
      const dHp = r.i16() * 0.1;
      const dShield = r.u16() * 0.1;
      const dFuel = r.u16() * 1e-3;
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
        pos: { x: dx, y: dy },
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
      pos: { x: px, y: py },
      vel: { x: vx, y: vy },
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
      jetpack: jetpack2,
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
      deathStreak
    };
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
  function decodeProjectile(r) {
    const id = r.u32();
    const owner = r.u16();
    const weaponId = r.i8();
    const flags = r.u8();
    const px = uPosX(r.u16());
    const py = uPosY(r.u16());
    const vx = uVel(r.i16());
    const vy = uVel(r.i16());
    const lifeRaw = r.u16() * 1e-3;
    const bounces = r.u8();
    const explosive = !!(flags & 1);
    const isGravityOrb = !!(flags & 2);
    const pierceOnHeadshot = !!(flags & 4);
    const pierceAll = !!(flags & 8);
    const passWalls = !!(flags & 16);
    const beam = !!(flags & 32);
    const rocket = !!(flags & 64);
    const hasCustom = !!(flags & 128);
    if (!hasCustom && weaponId >= 0 && WEAPONS[weaponId]) {
      const wep = WEAPONS[weaponId];
      const rad2 = wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2;
      const life = lifeRaw >= 59.9 ? wep.lifeSeconds ?? lifeRaw : lifeRaw;
      return {
        id,
        owner,
        pos: { x: px, y: py },
        vel: { x: vx, y: vy },
        life,
        r: rad2,
        damage: wep.damage,
        headshotMult: wep.headshotMult,
        explosive,
        terrainRadius: wep.terrainRadius,
        gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0 : 0.04),
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
      pos: { x: px, y: py },
      vel: { x: vx, y: vy },
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
  function decodeWorldEvent(r) {
    const kIdx = r.u8();
    const mode3 = r.u8();
    if (mode3 === 1) {
      const x = uPosX(r.u16());
      const y = uPosY(r.u16());
      const duration = uTimerMs(r.u16());
      const color = r.str();
      const playerId = r.u16();
      const weaponLabel = r.str();
      const segLen = r.u8();
      const segments = new Array(segLen);
      for (let i = 0; i < segLen; i++) {
        const x1 = uPosX(r.u16()), y1 = uPosY(r.u16()), x2 = uPosX(r.u16()), y2 = uPosY(r.u16());
        const dx = r.i32() / 16;
        const dy = r.i32() / 16;
        segments[i] = { x1, y1, x2, y2, dx, dy };
      }
      return { kind: "laser", x, y, duration, color, playerId, weaponLabel, segments };
    }
    if (mode3 === 2) {
      const kind = EVENT_KINDS[kIdx] === "projectile_bounce" ? "projectile_bounce" : "projectile_spawn";
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
    if (mode3 === 3) {
      return {
        kind: "projectile_destroy",
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
        case "move":
          w.u8(1);
          w.i8(it.dir);
          break;
        case "jump":
          w.u8(2);
          break;
        case "jetpack":
          w.u8(3);
          w.u8(it.on ? 1 : 0);
          break;
        case "dive":
          w.u8(4);
          w.u8(it.on ? 1 : 0);
          break;
        case "aim":
          w.u8(5);
          w.f32(it.angle);
          break;
        case "fire":
          w.u8(6);
          w.u8(it.on ? 1 : 0);
          break;
        case "reload":
          w.u8(7);
          break;
        case "interact":
          w.u8(8);
          break;
        case "secondary":
          w.u8(9);
          w.str(it.kind);
          w.f32(it.targetX);
          w.f32(it.targetY);
          break;
        case "switchWeapon":
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
          intents[i] = { t: "move", dir: r.i8() };
          break;
        case 2:
          intents[i] = { t: "jump" };
          break;
        case 3:
          intents[i] = { t: "jetpack", on: r.u8() !== 0 };
          break;
        case 4:
          intents[i] = { t: "dive", on: r.u8() !== 0 };
          break;
        case 5:
          intents[i] = { t: "aim", angle: r.f32() };
          break;
        case 6:
          intents[i] = { t: "fire", on: r.u8() !== 0 };
          break;
        case 7:
          intents[i] = { t: "reload" };
          break;
        case 8:
          intents[i] = { t: "interact" };
          break;
        case 9:
          intents[i] = { t: "secondary", kind: r.str(), targetX: r.f32(), targetY: r.f32() };
          break;
        case 10:
          intents[i] = { t: "switchWeapon", index: r.i8() };
          break;
        default:
          intents[i] = { t: "move", dir: 0 };
          break;
      }
    }
    return { seq, ts, intents };
  }
  function frameStringToBytes(str) {
    const pLen = BINARY_STR_PREFIX.length;
    const len = str.length - pLen;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = str.charCodeAt(i + pLen) & 255;
    }
    return out;
  }

  // src/net/transport/Kcp.ts
  var IKCP_RTO_NDL = 30;
  var IKCP_RTO_MIN = 100;
  var IKCP_RTO_DEF = 200;
  var IKCP_RTO_MAX = 6e4;
  var IKCP_CMD_PUSH = 81;
  var IKCP_CMD_ACK = 82;
  var IKCP_CMD_WASK = 83;
  var IKCP_CMD_WINS = 84;
  var IKCP_CMD_UNRELIABLE = 85;
  var IKCP_CMD_PING = 86;
  var IKCP_CMD_PONG = 87;
  var IKCP_OVERHEAD = 24;
  var IKCP_MTU_DEF = 1200;
  var DEFAULT_KCP_CONV = 1396853571;
  function timeDiff(later, earlier) {
    return (later | 0) - (earlier | 0);
  }
  var KcpBlock = class {
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
    // 统计遥测
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
      this.setNoDelay(
        opts.nodelay ?? 1,
        opts.interval ?? 10,
        opts.resend ?? 2,
        opts.nc ?? 1
      );
    }
    /** 配置 KCP 极速参数（默认 nodelay=1, interval=10ms, resend=2, nc=1） */
    setNoDelay(nodelay, interval, resend, nc) {
      this.nodelay = nodelay;
      this.rxMinrto = nodelay > 0 ? IKCP_RTO_NDL : IKCP_RTO_MIN;
      this.interval = Math.max(5, Math.min(5e3, interval));
      this.fastresend = Math.max(0, resend);
      this.nocwnd = nc;
    }
    /** 发送可靠有序消息（支持自动按 MSS 分片与重组） */
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
    /** 发送低延迟不可靠直通帧（封装 24B KCP 头，顺带捎带最新 una，不进重传缓冲） */
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
    /** 发送心跳探测包以持续刷新 RTT */
    sendPing(nowMs2 = this.current) {
      this.current = nowMs2 >>> 0;
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
    /** 从接收队列提取一条完整应用层报文（自动处理分片重组与直通帧） */
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
    /** 输入底层 WebRTC DataChannel 收到的原始二进制数据包 */
    input(data, nowMs2 = this.current) {
      this.current = nowMs2 >>> 0;
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
            this.ackList.push({ sn, ts });
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
    /** KCP 定时时钟驱动（建议每 10ms 或每帧调用） */
    update(currentMs) {
      this.current = currentMs >>> 0;
      if (this.tsFlush === 0) {
        this.tsFlush = this.current;
      }
      const slap = timeDiff(this.current, this.tsFlush);
      if (slap >= 1e4 || slap < -1e4) {
        this.tsFlush = this.current;
      } else if (slap >= 0) {
        this.tsFlush = this.tsFlush + this.interval >>> 0;
        if (timeDiff(this.current, this.tsFlush) >= 0) {
          this.tsFlush = this.current + this.interval >>> 0;
        }
        this.flush();
      }
    }
    /** 立即冲刷发送队列、ACK 列表与超时/快速重传段（低延迟模式下每次 send 后可立即调用） */
    flush(nowMs2 = this.current) {
      this.current = nowMs2 >>> 0;
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
      const resent = this.fastresend > 0 ? this.fastresend : 4294967295;
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
  };
  function isKcpPacket(bytes, expectedConv = DEFAULT_KCP_CONV) {
    if (bytes.byteLength < IKCP_OVERHEAD) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const conv = view.getUint32(0, true);
    const cmd = view.getUint8(4);
    return conv === expectedConv >>> 0 && cmd >= IKCP_CMD_PUSH && cmd <= IKCP_CMD_PONG;
  }

  // src/net/transport/Peer.ts
  function encodeServerWireFrame(m) {
    return encodeServerMsgBinary(m);
  }
  function encodeClientWireFrame(m) {
    return encodeClientMsgBinary(m);
  }
  function nowMs() {
    return typeof performance !== "undefined" ? Math.floor(performance.now()) : Date.now();
  }
  function toUint8Array(raw) {
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (typeof raw === "string" && raw.startsWith(BINARY_STR_PREFIX)) {
      return frameStringToBytes(raw);
    }
    return null;
  }
  function parseServerMsg(raw) {
    if (raw instanceof Uint8Array) return decodeServerMsgBinary(raw);
    if (raw instanceof ArrayBuffer) return decodeServerMsgBinary(new Uint8Array(raw));
    if (typeof raw === "string") {
      if (raw.startsWith(BINARY_STR_PREFIX)) {
        return decodeServerMsgBinary(frameStringToBytes(raw));
      }
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  }
  function parseClientMsg(raw) {
    if (raw instanceof Uint8Array) return decodeClientMsgBinary(raw);
    if (raw instanceof ArrayBuffer) return decodeClientMsgBinary(new Uint8Array(raw));
    if (typeof raw === "string") {
      if (raw.startsWith(BINARY_STR_PREFIX)) {
        return decodeClientMsgBinary(frameStringToBytes(raw));
      }
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  }
  function configureWebRtcUnreliableChannel(conn, onUnreliableFrame) {
    let customDc = null;
    const bindDc = (dc) => {
      dc.binaryType = "arraybuffer";
      dc.onmessage = (ev) => {
        const bytes = toUint8Array(ev.data);
        if (bytes) onUnreliableFrame(bytes);
      };
    };
    if (conn.dataChannel) {
      try {
        conn.dataChannel.binaryType = "arraybuffer";
      } catch {
      }
    }
    const pc = conn.peerConnection;
    if (pc && typeof pc.createDataChannel === "function") {
      try {
        const prevOnDc = pc.ondatachannel;
        pc.ondatachannel = (ev) => {
          if (ev.channel && ev.channel.label === "skyblast-kcp") {
            customDc = ev.channel;
            bindDc(customDc);
          } else if (prevOnDc) {
            prevOnDc.call(pc, ev);
          }
        };
        const created = pc.createDataChannel("skyblast-kcp", {
          ordered: false,
          maxRetransmits: 0
        });
        if (created.readyState === "open") customDc = created;
        created.onopen = () => {
          customDc = created;
        };
        bindDc(created);
      } catch {
      }
    }
    return {
      sendDatagram(pkt) {
        if (customDc && customDc.readyState === "open") {
          try {
            customDc.send(pkt.slice().buffer);
            return;
          } catch {
          }
        }
        conn.send(pkt);
      },
      isCustomDataChannel() {
        return customDc !== null && customDc.readyState === "open";
      }
    };
  }
  function createPeerClient(conn, kcpOpts = {}) {
    let onServer = null;
    const conv = kcpOpts.conv ?? DEFAULT_KCP_CONV;
    const handleIncomingBytes = (bytes) => {
      if (isKcpPacket(bytes, conv)) {
        const t = nowMs();
        kcp.input(bytes, t);
        let payload;
        while ((payload = kcp.recv()) !== null) {
          const m2 = parseServerMsg(payload);
          if (m2 && "snap" in m2) onServer?.(m2);
        }
        kcp.flush(t);
        return;
      }
      const m = parseServerMsg(bytes);
      if (m && "snap" in m) onServer?.(m);
    };
    const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes);
    const kcp = new KcpBlock(conv, (pkt) => dcBridge.sendDatagram(pkt), {
      nodelay: 1,
      interval: 10,
      resend: 2,
      nc: 1,
      ...kcpOpts
    });
    conn.on("data", (raw) => {
      const bytes = toUint8Array(raw);
      if (bytes) {
        handleIncomingBytes(bytes);
        return;
      }
      const m = parseServerMsg(raw);
      if (m && "snap" in m) onServer?.(m);
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
    const conv = kcpOpts.conv ?? DEFAULT_KCP_CONV;
    const handleIncomingBytes = (bytes) => {
      if (isKcpPacket(bytes, conv)) {
        const t = nowMs();
        kcp.input(bytes, t);
        let payload;
        while ((payload = kcp.recv()) !== null) {
          const m2 = parseClientMsg(payload);
          if (m2 && "intents" in m2) onClient?.(m2);
        }
        kcp.flush(t);
        return;
      }
      const m = parseClientMsg(bytes);
      if (m && "intents" in m) onClient?.(m);
    };
    const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes);
    const kcp = new KcpBlock(conv, (pkt) => dcBridge.sendDatagram(pkt), {
      nodelay: 1,
      interval: 10,
      resend: 2,
      nc: 1,
      ...kcpOpts
    });
    conn.on("data", (raw) => {
      const bytes = toUint8Array(raw);
      if (bytes) {
        handleIncomingBytes(bytes);
        return;
      }
      const m = parseClientMsg(raw);
      if (m && "intents" in m) onClient?.(m);
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

  // src/net/ServerSim.ts
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

  // src/net/ClientSession.ts
  var MAX_PENDING_INPUTS = 128;
  var ClientSession = class {
    transport;
    playerId;
    // 联机时由服务器 welcome 下发；Loopback 测试直接构造
    seq = 0;
    cb = null;
    evCb = null;
    stateSync = null;
    currentInput = defaultWorldInput();
    pendingInputs = [];
    lastAckSeq = 0;
    lastSnapshot = null;
    lastEvents = [];
    constructor(transport, playerId, stateSync) {
      this.transport = transport;
      this.playerId = playerId;
      if (stateSync) this.bindStateSync(stateSync);
      transport.onServer((m) => {
        if (m.welcome) {
          this.playerId = m.welcome.playerId;
          if (this.stateSync) this.stateSync.setLocalPlayerId(this.playerId);
        }
        const ack = m.snap.ackSeqs?.[this.playerId];
        if (ack !== void 0 && ack > this.lastAckSeq) {
          this.lastAckSeq = ack;
          let dropCount = 0;
          while (dropCount < this.pendingInputs.length && this.pendingInputs[dropCount].seq <= ack) {
            dropCount++;
          }
          if (dropCount > 0) this.pendingInputs.splice(0, dropCount);
        }
        if (this.stateSync) {
          this.stateSync.push(m.snap, this.playerId, this.pendingInputs, m.events);
        }
        this.lastSnapshot = m.snap;
        this.lastEvents = m.events ?? [];
        this.cb?.(m.snap);
        this.evCb?.(this.lastEvents);
      });
    }
    /** 绑定 StateSync：开启本地玩家 0 延迟预测与收到快照后的自动回滚重放 */
    bindStateSync(sync) {
      this.stateSync = sync;
      if (this.playerId > 0) sync.setLocalPlayerId(this.playerId);
    }
    sendIntents(intents, dt = 1 / 60) {
      const seq = ++this.seq;
      this.currentInput = applyIntents(this.currentInput, intents);
      const frameInput = {
        ...this.currentInput,
        secondary: this.currentInput.secondary ? { ...this.currentInput.secondary } : null
      };
      const frame = { seq, dt, input: frameInput };
      if (this.pendingInputs.length >= MAX_PENDING_INPUTS) {
        this.pendingInputs.shift();
      }
      this.pendingInputs.push(frame);
      this.currentInput.jump = false;
      this.currentInput.interact = false;
      this.currentInput.secondary = null;
      this.currentInput.switchWeapon = null;
      this.currentInput.reload = false;
      if (this.stateSync && this.playerId > 0) {
        this.stateSync.applyLocalInput(frameInput, dt);
      }
      this.transport.send({ seq, ts: Date.now(), intents });
      return seq;
    }
    onSnapshot(cb) {
      this.cb = cb;
    }
    onEvents(cb) {
      this.evCb = cb;
    }
  };

  // src/net/StateSync.ts
  var WORLD_W2 = 13200;
  var WORLD_H3 = 4400;
  var SNAP_THRESHOLD = 120;
  var SMOOTH_THRESHOLD = 0.5;
  var StateSync = class {
    prev = null;
    cur = null;
    t = 0;
    localPlayerId = 0;
    terrain;
    predictedLocal = null;
    /** 视觉平滑纠错偏移量（当服务器重放位置与客户端当前预测位置存在轻微偏差时，平滑过渡避免跳帧） */
    reconcileOffset = { x: 0, y: 0 };
    /** 客户端通过事件化同步+本地推算维护的飞行弹丸表（支撑直线/抛物线弹丸事件化同步） */
    deadReckonedProjectiles = /* @__PURE__ */ new Map();
    enableProjectileDeadReckoning = false;
    constructor(terrain, localPlayerId = 0) {
      if (terrain) {
        this.terrain = terrain;
      } else {
        this.terrain = new Terrain();
        this.terrain.build();
      }
      this.localPlayerId = localPlayerId;
    }
    setLocalPlayerId(id) {
      this.localPlayerId = id;
    }
    setTerrain(terrain) {
      this.terrain = terrain;
    }
    setProjectileDeadReckoning(enabled) {
      this.enableProjectileDeadReckoning = enabled;
    }
    /** 客户端本地立即预测输入（无需等待 RTT 与插值缓冲，按下即响应） */
    applyLocalInput(input, dt = 1 / 60) {
      if (!this.predictedLocal && this.cur && this.localPlayerId > 0) {
        const found = this.cur.players.find((p) => p.id === this.localPlayerId);
        if (found) this.predictedLocal = clonePlayerState(found);
      }
      if (!this.predictedLocal) return null;
      predictLocalPlayerStep(
        this.predictedLocal,
        input,
        dt,
        this.terrain,
        this.cur?.obstacles ?? [],
        this.cur?.mortars ?? [],
        []
      );
      return this.predictedLocal;
    }
    /** 接收权威快照：若提供 localPlayerId 与未确认输入队列，则执行服务器回滚与重放（Server Reconciliation） */
    push(snap, localPlayerId = this.localPlayerId, pendingInputs, events) {
      if (localPlayerId > 0) this.localPlayerId = localPlayerId;
      this.prev = this.cur;
      this.cur = snap;
      this.t = 0;
      if (events && events.length > 0) {
        this.applyProjectileEvents(events);
      }
      if (this.enableProjectileDeadReckoning) {
        for (let i = 0; i < snap.projectiles.length; i++) {
          const pr = snap.projectiles[i];
          this.deadReckonedProjectiles.set(pr.id, {
            ...pr,
            pos: { x: pr.pos.x, y: pr.pos.y },
            vel: { x: pr.vel.x, y: pr.vel.y },
            hitTargets: [...pr.hitTargets]
          });
        }
      }
      if (this.localPlayerId > 0) {
        const authPlayer = snap.players.find((p) => p.id === this.localPlayerId);
        if (authPlayer) {
          const replayed = clonePlayerState(authPlayer);
          if (pendingInputs && pendingInputs.length > 0) {
            for (let i = 0; i < pendingInputs.length; i++) {
              const frame = pendingInputs[i];
              predictLocalPlayerStep(
                replayed,
                frame.input,
                frame.dt,
                this.terrain,
                snap.obstacles,
                snap.mortars,
                []
              );
            }
          }
          if (this.predictedLocal && authPlayer.alive && authPlayer.deployed && authPlayer.respawnTimer <= 0) {
            const prevVisX = wrapX(this.predictedLocal.pos.x + this.reconcileOffset.x);
            const prevVisY = wrapY(this.predictedLocal.pos.y + this.reconcileOffset.y);
            const errX = wrapDeltaX(replayed.pos.x, prevVisX);
            const errY = wrapDeltaY(replayed.pos.y, prevVisY);
            const errDist = Math.hypot(errX, errY);
            if (errDist > SNAP_THRESHOLD) {
              this.reconcileOffset.x = 0;
              this.reconcileOffset.y = 0;
            } else if (errDist >= SMOOTH_THRESHOLD) {
              this.reconcileOffset.x = errX;
              this.reconcileOffset.y = errY;
            } else {
              this.reconcileOffset.x = 0;
              this.reconcileOffset.y = 0;
            }
          } else {
            this.reconcileOffset.x = 0;
            this.reconcileOffset.y = 0;
          }
          this.predictedLocal = replayed;
        }
      }
    }
    /** 处理高频弹丸事件（发射/反弹/销毁），支撑客户端本地推算弹道 */
    applyProjectileEvents(events) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.kind === "projectile_spawn" && e.projectileId !== void 0) {
          const wid = e.weaponId ?? -1;
          const wep = wid >= 0 ? WEAPONS[wid] : void 0;
          const rad = e.radius ?? (wep ? wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2 : 4);
          this.deadReckonedProjectiles.set(e.projectileId, {
            id: e.projectileId,
            owner: e.playerId ?? 0,
            pos: { x: e.x ?? 0, y: e.y ?? 0 },
            vel: { x: e.vx ?? 0, y: e.vy ?? 0 },
            life: e.life ?? (wep?.lifeSeconds ?? 2.2),
            r: rad,
            damage: wep?.damage ?? 24,
            headshotMult: wep?.headshotMult ?? 1.5,
            explosive: !!wep?.explosive,
            terrainRadius: wep?.terrainRadius ?? 0,
            gravityScale: wep?.gravityScale ?? 0.04,
            pierceOnHeadshot: !!wep?.pierceOnHeadshot,
            pierceAll: !!wep?.pierceAll,
            isGravityOrb: !!wep?.isGravityOrb,
            weaponId: wid,
            curveRate: wep?.curveRate ?? 0,
            weaponLabel: e.weaponLabel ?? wep?.shortName ?? "\u5F39\u4E38",
            color: e.color ?? wep?.color ?? "#fbbf24",
            hitTargets: [e.playerId ?? 0],
            bounces: e.bounces ?? (wep?.bounces ?? 0),
            passWalls: !!wep?.passWalls,
            beam: !!wep?.beam,
            rocket: !!wep?.rocket,
            dragPerSecond: wep?.dragPerSecond ?? 1
          });
        } else if (e.kind === "projectile_bounce" && e.projectileId !== void 0) {
          const pr = this.deadReckonedProjectiles.get(e.projectileId);
          if (pr) {
            pr.pos.x = e.x ?? pr.pos.x;
            pr.pos.y = e.y ?? pr.pos.y;
            pr.vel.x = e.vx ?? pr.vel.x;
            pr.vel.y = e.vy ?? pr.vel.y;
            if (e.bounces !== void 0) pr.bounces = e.bounces;
          }
        } else if (e.kind === "projectile_destroy" && e.projectileId !== void 0) {
          this.deadReckonedProjectiles.delete(e.projectileId);
        }
      }
    }
    advance(dt, interval = 0.1) {
      this.t = Math.min(1, this.t + dt / interval);
      const decay = Math.pow(0.08, dt * 10);
      this.reconcileOffset.x *= decay;
      this.reconcileOffset.y *= decay;
      if (Math.abs(this.reconcileOffset.x) < 0.1) this.reconcileOffset.x = 0;
      if (Math.abs(this.reconcileOffset.y) < 0.1) this.reconcileOffset.y = 0;
      if (this.deadReckonedProjectiles.size > 0) {
        const list = Array.from(this.deadReckonedProjectiles.values());
        stepClientProjectilesDeadReckoning(list, dt, this.terrain);
        for (let i = 0; i < list.length; i++) {
          if (list[i].life <= 0) this.deadReckonedProjectiles.delete(list[i].id);
        }
      }
    }
    getPredictedLocalPlayer() {
      if (!this.predictedLocal) return null;
      return {
        ...this.predictedLocal,
        pos: {
          x: wrapX(this.predictedLocal.pos.x + this.reconcileOffset.x),
          y: wrapY(this.predictedLocal.pos.y + this.reconcileOffset.y)
        }
      };
    }
    getDeadReckonedProjectiles() {
      return Array.from(this.deadReckonedProjectiles.values());
    }
    interpolated() {
      if (!this.cur) return null;
      const base = !this.prev || this.t >= 1 ? this.cur : lerpSnap(this.prev, this.cur, this.t);
      if (this.localPlayerId <= 0 && !this.enableProjectileDeadReckoning) return base;
      let players = base.players;
      if (this.localPlayerId > 0 && this.predictedLocal) {
        const visLocal = this.getPredictedLocalPlayer();
        players = base.players.map((p) => p.id === this.localPlayerId ? visLocal : p);
      }
      const projectiles = this.enableProjectileDeadReckoning && this.deadReckonedProjectiles.size > 0 ? this.getDeadReckonedProjectiles() : base.projectiles;
      return {
        ...base,
        players,
        projectiles
      };
    }
  };
  function clonePlayerState(p) {
    return {
      ...p,
      pos: { x: p.pos.x, y: p.pos.y },
      vel: { x: p.vel.x, y: p.vel.y },
      ammo: [...p.ammo],
      reserveAmmo: [...p.reserveAmmo],
      doll: p.doll ? {
        ...p.doll,
        pos: { x: p.doll.pos.x, y: p.doll.pos.y },
        ammo: [...p.doll.ammo],
        reserveAmmo: [...p.doll.reserveAmmo]
      } : null
    };
  }
  function lerp(a, b, f) {
    return a + (b - a) * f;
  }
  function lerpWrap(a, b, f, W) {
    let dx = b - a;
    if (dx > W * 0.5) dx -= W;
    if (dx < -W * 0.5) dx += W;
    return ((a + dx * f) % W + W) % W;
  }
  var prevPlayerMap = /* @__PURE__ */ new Map();
  var prevProjMap = /* @__PURE__ */ new Map();
  var prevGrenMap = /* @__PURE__ */ new Map();
  var prevMineMap = /* @__PURE__ */ new Map();
  var prevAirMap = /* @__PURE__ */ new Map();
  function lerpSnap(a, b, f) {
    prevPlayerMap.clear();
    for (let i = 0; i < a.players.length; i++) prevPlayerMap.set(a.players[i].id, a.players[i]);
    prevProjMap.clear();
    for (let i = 0; i < a.projectiles.length; i++) prevProjMap.set(a.projectiles[i].id, a.projectiles[i]);
    prevGrenMap.clear();
    for (let i = 0; i < a.grenades.length; i++) prevGrenMap.set(a.grenades[i].id, a.grenades[i]);
    prevMineMap.clear();
    for (let i = 0; i < a.landmines.length; i++) prevMineMap.set(a.landmines[i].id, a.landmines[i]);
    prevAirMap.clear();
    for (let i = 0; i < a.airstrikes.length; i++) prevAirMap.set(a.airstrikes[i].id, a.airstrikes[i]);
    const players = b.players.map((pb) => {
      const pa = prevPlayerMap.get(pb.id);
      if (!pa) return pb;
      return {
        ...pb,
        pos: { x: lerpWrap(pa.pos.x, pb.pos.x, f, WORLD_W2), y: lerpWrap(pa.pos.y, pb.pos.y, f, WORLD_H3) },
        vel: { x: lerp(pa.vel.x, pb.vel.x, f), y: lerp(pa.vel.y, pb.vel.y, f) },
        doll: pb.doll
      };
    });
    const projectiles = b.projectiles.map((p) => {
      const pa = prevProjMap.get(p.id);
      if (!pa) return p;
      return { ...p, pos: { x: lerpWrap(pa.pos.x, p.pos.x, f, WORLD_W2), y: lerpWrap(pa.pos.y, p.pos.y, f, WORLD_H3) }, vel: { ...p.vel } };
    });
    const grenades = b.grenades.map((g) => {
      const ga = prevGrenMap.get(g.id);
      if (!ga) return g;
      return { ...g, pos: { x: lerpWrap(ga.pos.x, g.pos.x, f, WORLD_W2), y: lerpWrap(ga.pos.y, g.pos.y, f, WORLD_H3) }, vel: { ...g.vel } };
    });
    const landmines = b.landmines.map((m) => {
      const ma = prevMineMap.get(m.id);
      if (!ma) return m;
      return { ...m, pos: { x: lerpWrap(ma.pos.x, m.pos.x, f, WORLD_W2), y: lerpWrap(ma.pos.y, m.pos.y, f, WORLD_H3) }, vel: { ...m.vel } };
    });
    const airstrikes = b.airstrikes.map((s) => {
      const sa = prevAirMap.get(s.id);
      if (!sa) return s;
      return { ...s, pos: { x: lerpWrap(sa.pos.x, s.pos.x, f, WORLD_W2), y: lerpWrap(sa.pos.y, s.pos.y, f, WORLD_H3) } };
    });
    return {
      ...b,
      players,
      projectiles,
      grenades,
      landmines,
      airstrikes
    };
  }

  // src/input/InputMapper.ts
  var InputMapper = class {
    map(t) {
      const out = [];
      if (t.moveX !== 0) out.push({ t: "move", dir: Math.sign(t.moveX) });
      if (t.jump) out.push({ t: "jump" });
      out.push({ t: "jetpack", on: t.jetpack });
      if (t.dive) out.push({ t: "dive", on: true });
      out.push({ t: "aim", angle: t.aimAngle });
      out.push({ t: "fire", on: t.fire });
      if (t.reload) out.push({ t: "reload" });
      if (t.interact) out.push({ t: "interact" });
      if (t.secondary) out.push({ t: "secondary", kind: t.secondary.kind, targetX: t.secondary.targetX, targetY: t.secondary.targetY });
      if (t.switchWeapon !== null && t.switchWeapon !== void 0) out.push({ t: "switchWeapon", index: t.switchWeapon });
      return out;
    }
  };

  // src/web/sprites.ts
  var TEAM_PALETTE = {
    red: { color: "#f43f5e", light: "#fda4af", dark: "#881337", glow: "rgba(244,63,94,0.35)" },
    blue: { color: "#0ea5e9", light: "#7dd3fc", dark: "#0c4a6e", glow: "rgba(14,165,233,0.35)" },
    green: { color: "#10b981", light: "#6ee7b7", dark: "#064e3b", glow: "rgba(16,185,129,0.35)" },
    ffa: { color: "#eab308", light: "#fde047", dark: "#713f12", glow: "rgba(234,179,8,0.35)" }
  };
  function roundRect(ctx2, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + rr, y);
    ctx2.arcTo(x + w, y, x + w, y + h, rr);
    ctx2.arcTo(x + w, y + h, x, y + h, rr);
    ctx2.arcTo(x, y + h, x, y, rr);
    ctx2.arcTo(x, y, x + w, y, rr);
    ctx2.closePath();
  }
  function drawPlayerSprite(ctx2, p, dx, dy, opts) {
    const pal = TEAM_PALETTE[p.team] ?? TEAM_PALETTE.red;
    const wep = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
    const t = opts.tick;
    const facing = Math.cos(p.aim) >= 0 ? 1 : -1;
    const walkPhase = Math.sin(t * 0.35) * (opts.movingX !== 0 ? 1 : 0);
    const alive = p.alive && p.respawnTimer <= 0;
    ctx2.save();
    ctx2.translate(dx, dy);
    if (!alive) ctx2.globalAlpha = 0.45;
    const shadowGrad = ctx2.createRadialGradient(0, 18, 2, 0, 18, 16);
    shadowGrad.addColorStop(0, "rgba(0,0,0,0.45)");
    shadowGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx2.fillStyle = shadowGrad;
    ctx2.beginPath();
    ctx2.ellipse(0, 18, 16, 4.5, 0, 0, Math.PI * 2);
    ctx2.fill();
    const packX = facing > 0 ? -16 : 9;
    const nozzleX = facing > 0 ? -12.5 : 12.5;
    ctx2.fillStyle = "#1e293b";
    ctx2.strokeStyle = "#0f172a";
    ctx2.lineWidth = 1.5;
    roundRect(ctx2, packX, -12, 7.5, 16, 2.5);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "#475569";
    ctx2.fillRect(packX + 1, -10, 5.5, 3);
    ctx2.fillRect(packX + 1, -2, 5.5, 2);
    const fuelMax = Math.max(0.5, wep.fuelMult ?? 1);
    const fuelRatio = Math.max(0, Math.min(1, p.fuel / fuelMax));
    ctx2.fillStyle = "#090d16";
    ctx2.fillRect(packX + 2.2, -6, 3, 8);
    ctx2.fillStyle = fuelRatio > 0.3 ? "#38bdf8" : "#f97316";
    ctx2.fillRect(packX + 2.2, -6 + 8 * (1 - fuelRatio), 3, 8 * fuelRatio);
    ctx2.fillStyle = "#334155";
    ctx2.fillRect(nozzleX - 2.5, 3.5, 5, 3);
    if (opts.floating) {
      const flick = 0.78 + Math.sin(t * 0.95) * 0.22 + Math.cos(t * 1.7) * 0.1;
      const outerLen = 20 * flick;
      const outerGrad = ctx2.createLinearGradient(nozzleX, 6, nozzleX, 6 + outerLen);
      outerGrad.addColorStop(0, "rgba(56, 189, 248, 0.95)");
      outerGrad.addColorStop(0.55, "rgba(14, 165, 233, 0.65)");
      outerGrad.addColorStop(1, "rgba(2, 132, 199, 0)");
      ctx2.fillStyle = outerGrad;
      ctx2.beginPath();
      ctx2.moveTo(nozzleX - 4, 6);
      ctx2.lineTo(nozzleX + 4, 6);
      ctx2.lineTo(nozzleX + Math.sin(t * 1.3) * 1.5, 6 + outerLen);
      ctx2.closePath();
      ctx2.fill();
      const innerLen = 11 * flick;
      ctx2.fillStyle = "rgba(224, 242, 254, 0.92)";
      ctx2.beginPath();
      ctx2.moveTo(nozzleX - 2, 6);
      ctx2.lineTo(nozzleX + 2, 6);
      ctx2.lineTo(nozzleX, 6 + innerLen);
      ctx2.closePath();
      ctx2.fill();
    }
    const leftLegX = -9 + walkPhase * 3.2;
    const rightLegX = 3 - walkPhase * 3.2;
    ctx2.fillStyle = "#1e293b";
    roundRect(ctx2, leftLegX, 7, 6, 10, 1.5);
    ctx2.fill();
    roundRect(ctx2, rightLegX, 7, 6, 10, 1.5);
    ctx2.fill();
    ctx2.fillStyle = pal.dark;
    ctx2.fillRect(leftLegX + 0.5, 9, 5, 3);
    ctx2.fillRect(rightLegX + 0.5, 9, 5, 3);
    ctx2.fillStyle = "#0f172a";
    roundRect(ctx2, leftLegX - 0.5, 15.5, 7.5, 3.5, 1.2);
    ctx2.fill();
    roundRect(ctx2, rightLegX - 0.5, 15.5, 7.5, 3.5, 1.2);
    ctx2.fill();
    const bodyGrad = ctx2.createLinearGradient(0, -14, 0, 10);
    bodyGrad.addColorStop(0, pal.light);
    bodyGrad.addColorStop(0.4, pal.color);
    bodyGrad.addColorStop(1, pal.dark);
    ctx2.fillStyle = bodyGrad;
    ctx2.strokeStyle = "#090d16";
    ctx2.lineWidth = 2;
    roundRect(ctx2, -11, -14, 22, 23, 6);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "rgba(255,255,255,0.26)";
    roundRect(ctx2, -8, -11.5, 7, 7, 2);
    ctx2.fill();
    ctx2.fillStyle = wep.color;
    ctx2.beginPath();
    ctx2.arc(facing * 3, -5, 2.2, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = "rgba(255,255,255,0.75)";
    ctx2.lineWidth = 0.8;
    ctx2.stroke();
    ctx2.fillStyle = "#0f172a";
    ctx2.fillRect(-10.5, 4.5, 21, 3.5);
    ctx2.fillStyle = "#94a3b8";
    ctx2.fillRect(-2.5, 5, 5, 2.5);
    if (p.fragCharges > 0) {
      ctx2.fillStyle = "#22c55e";
      ctx2.beginPath();
      ctx2.arc(facing > 0 ? -6 : 6, 6.2, 2.2, 0, Math.PI * 2);
      ctx2.fill();
    }
    const helmGrad = ctx2.createRadialGradient(-2 * facing, -27, 1, 0, -24, 11);
    helmGrad.addColorStop(0, "#f1f5f9");
    helmGrad.addColorStop(0.55, "#cbd5e1");
    helmGrad.addColorStop(1, "#475569");
    ctx2.fillStyle = helmGrad;
    ctx2.strokeStyle = "#090d16";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.arc(0, -24, 10.2, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = pal.color;
    ctx2.beginPath();
    ctx2.arc(0, -24, 8.2, Math.PI * 1.15, Math.PI * 1.85);
    ctx2.fill();
    const antX = facing > 0 ? -6 : 6;
    ctx2.strokeStyle = "#94a3b8";
    ctx2.lineWidth = 1.4;
    ctx2.beginPath();
    ctx2.moveTo(antX, -28);
    ctx2.lineTo(antX - facing * 2, -35);
    ctx2.stroke();
    ctx2.fillStyle = pal.light;
    ctx2.beginPath();
    ctx2.arc(antX - facing * 2, -35, 1.3, 0, Math.PI * 2);
    ctx2.fill();
    const visorX = facing > 0 ? 1.5 : -9;
    const visorGrad = ctx2.createLinearGradient(visorX, -27, visorX + 7.5, -22);
    visorGrad.addColorStop(0, "#38bdf8");
    visorGrad.addColorStop(0.6, "#0284c7");
    visorGrad.addColorStop(1, "#0f172a");
    ctx2.fillStyle = visorGrad;
    roundRect(ctx2, visorX, -26.8, 7.5, 4.2, 1.5);
    ctx2.fill();
    ctx2.fillStyle = "rgba(255,255,255,0.85)";
    ctx2.fillRect(visorX + (facing > 0 ? 1.5 : 4), -26, 2.2, 1.2);
    if (!opts.mounted) {
      ctx2.save();
      ctx2.rotate(p.aim - (facing < 0 ? Math.PI : 0));
      const flip = facing < 0 ? -1 : 1;
      ctx2.scale(1, flip);
      const metalDark = "#0f172a";
      const metalMid = "#1e293b";
      const metalLight = "#475569";
      const accent = wep.color;
      switch (wep.id) {
        case 0: {
          ctx2.fillStyle = "#7c2d12";
          roundRect(ctx2, 2, -6, 8, 5, 1.5);
          ctx2.fill();
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 8, -9.5, 26, 6.5, 2);
          ctx2.fill();
          ctx2.fillStyle = metalLight;
          ctx2.fillRect(14, -9.5, 18, 2);
          ctx2.fillStyle = "#9a3412";
          roundRect(ctx2, 18, -4, 12, 4.2, 1.5);
          ctx2.fill();
          ctx2.strokeStyle = "#431407";
          ctx2.lineWidth = 1;
          for (let gx = 20; gx <= 28; gx += 2.5) {
            ctx2.beginPath();
            ctx2.moveTo(gx, -4);
            ctx2.lineTo(gx, 0);
            ctx2.stroke();
          }
          ctx2.fillStyle = accent;
          for (let sx = 10; sx <= 16; sx += 2.5) ctx2.fillRect(sx, -7.5, 1.6, 3);
          ctx2.fillStyle = metalDark;
          ctx2.fillRect(33, -9, 3, 5.5);
          break;
        }
        case 1: {
          ctx2.fillStyle = metalDark;
          roundRect(ctx2, 1, -7.5, 7, 5, 1.2);
          ctx2.fill();
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 7, -9.5, 25, 6.5, 2);
          ctx2.fill();
          ctx2.fillStyle = metalLight;
          ctx2.fillRect(31, -8, 7, 3);
          ctx2.fillStyle = metalDark;
          ctx2.fillRect(37, -8.8, 3, 4.6);
          ctx2.fillStyle = "#334155";
          ctx2.beginPath();
          ctx2.moveTo(14, -3);
          ctx2.lineTo(20, -3);
          ctx2.lineTo(22, 5.5);
          ctx2.lineTo(16, 5.5);
          ctx2.closePath();
          ctx2.fill();
          ctx2.fillStyle = metalDark;
          roundRect(ctx2, 11, -13, 7, 3.8, 1);
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(13, -12, 3, 1.8);
          ctx2.fillStyle = accent;
          ctx2.fillRect(9, -7.5, 18, 1.8);
          break;
        }
        case 2: {
          ctx2.fillStyle = metalDark;
          roundRect(ctx2, 0, -8, 9, 6, 1.5);
          ctx2.fill();
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 8, -9.5, 18, 6, 2);
          ctx2.fill();
          ctx2.fillStyle = "#334155";
          ctx2.fillRect(25, -8.2, 22, 3.2);
          ctx2.fillStyle = metalDark;
          ctx2.beginPath();
          ctx2.moveTo(46, -10.5);
          ctx2.lineTo(51, -8.5);
          ctx2.lineTo(51, -4.5);
          ctx2.lineTo(46, -2.5);
          ctx2.closePath();
          ctx2.fill();
          ctx2.fillStyle = metalDark;
          roundRect(ctx2, 11, -15.5, 16, 4.8, 1.5);
          ctx2.fill();
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 1.3;
          ctx2.strokeRect(11, -15.5, 16, 4.8);
          ctx2.fillStyle = accent;
          ctx2.fillRect(25, -14.8, 2, 3.4);
          if (p.chargeTimer > 0) {
            const cr = Math.min(1, p.chargeTimer / (wep.chargeSeconds ?? 0.6));
            ctx2.fillStyle = `rgba(192, 132, 252, ${0.35 + 0.6 * cr})`;
            ctx2.fillRect(9, -7.2, 36 * cr, 1.8);
          }
          break;
        }
        case 3: {
          ctx2.fillStyle = metalDark;
          ctx2.beginPath();
          ctx2.moveTo(-4, -12.5);
          ctx2.lineTo(4, -10);
          ctx2.lineTo(4, -2);
          ctx2.lineTo(-4, 0.5);
          ctx2.closePath();
          ctx2.fill();
          ctx2.fillStyle = "#1e293b";
          roundRect(ctx2, 3, -12, 27, 11, 4);
          ctx2.fill();
          ctx2.strokeStyle = "#0f172a";
          ctx2.lineWidth = 1.5;
          ctx2.stroke();
          ctx2.fillStyle = "#475569";
          ctx2.fillRect(10, -12, 3, 11);
          ctx2.fillRect(22, -12, 3, 11);
          ctx2.fillStyle = "#fbbf24";
          ctx2.fillRect(15, -11, 5, 2);
          ctx2.fillStyle = accent;
          ctx2.beginPath();
          ctx2.moveTo(29, -11);
          ctx2.lineTo(37, -6.5);
          ctx2.lineTo(29, -2);
          ctx2.closePath();
          ctx2.fill();
          break;
        }
        case 4: {
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 4, -10.5, 24, 9, 3);
          ctx2.fill();
          ctx2.fillStyle = "#334155";
          ctx2.fillRect(26, -10, 14, 2.5);
          ctx2.fillRect(26, -4.5, 14, 2.5);
          const coilPulse = 0.65 + 0.35 * Math.sin(t * 0.25);
          ctx2.fillStyle = `rgba(34, 211, 238, ${0.45 + 0.35 * coilPulse})`;
          ctx2.fillRect(8, -7.2, 31, 2.4);
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 1.8;
          for (let i = 0; i < 3; i++) {
            ctx2.beginPath();
            ctx2.arc(12 + i * 8, -6, 3.6, 0, Math.PI * 2);
            ctx2.stroke();
          }
          ctx2.fillStyle = "#a5f3fc";
          ctx2.beginPath();
          ctx2.arc(40, -6, 2.4, 0, Math.PI * 2);
          ctx2.fill();
          break;
        }
        case 5: {
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 4, -11.5, 22, 10, 3);
          ctx2.fill();
          ctx2.fillStyle = "#14532d";
          ctx2.strokeStyle = "#052e16";
          ctx2.lineWidth = 1.2;
          roundRect(ctx2, 11, -2, 10, 8, 2);
          ctx2.fill();
          ctx2.stroke();
          ctx2.fillStyle = accent;
          for (let bx = 13; bx <= 18; bx += 2) ctx2.fillRect(bx, -4, 1.4, 3);
          ctx2.fillStyle = "#64748b";
          ctx2.fillRect(25, -10.5, 13, 3);
          ctx2.fillStyle = "#334155";
          ctx2.fillRect(25, -6.5, 15, 2.8);
          ctx2.fillStyle = accent;
          ctx2.fillRect(39, -10.5, 2.5, 6.8);
          break;
        }
        case 6: {
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 5, -10, 20, 9, 4);
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(8, -7, 13, 3);
          ctx2.strokeStyle = "#94a3b8";
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          ctx2.arc(29, -5.5, 6.5, -Math.PI * 0.7, -Math.PI * 0.15);
          ctx2.stroke();
          ctx2.beginPath();
          ctx2.arc(29, -5.5, 6.5, Math.PI * 0.15, Math.PI * 0.7);
          ctx2.stroke();
          const orbPulse = 0.8 + 0.2 * Math.sin(t * 0.2);
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 1.8;
          ctx2.beginPath();
          ctx2.arc(31, -5.5, 4.5 * orbPulse, 0, Math.PI * 2);
          ctx2.stroke();
          ctx2.fillStyle = "#090414";
          ctx2.beginPath();
          ctx2.arc(31, -5.5, 2.8, 0, Math.PI * 2);
          ctx2.fill();
          break;
        }
        case 7: {
          ctx2.fillStyle = metalDark;
          ctx2.beginPath();
          ctx2.moveTo(7, -5);
          ctx2.lineTo(12, -5);
          ctx2.lineTo(10, 3);
          ctx2.lineTo(5.5, 3);
          ctx2.closePath();
          ctx2.fill();
          ctx2.fillStyle = metalLight;
          roundRect(ctx2, 6, -9.5, 16, 5, 1.5);
          ctx2.fill();
          ctx2.strokeStyle = metalDark;
          ctx2.lineWidth = 1.2;
          ctx2.stroke();
          ctx2.fillStyle = accent;
          ctx2.fillRect(8, -8.2, 10, 1.5);
          ctx2.fillRect(20, -10.5, 2, 1.5);
          ctx2.fillStyle = "#334155";
          ctx2.fillRect(15, -4.5, 5, 2.2);
          break;
        }
        case 8: {
          ctx2.fillStyle = metalMid;
          roundRect(ctx2, 6, -9.5, 21, 6.5, 2);
          ctx2.fill();
          ctx2.fillStyle = metalDark;
          roundRect(ctx2, 26, -8.5, 6, 4.2, 1.2);
          ctx2.fill();
          ctx2.fillStyle = metalDark;
          ctx2.fillRect(21, -3, 3.2, 5.5);
          ctx2.fillStyle = "#334155";
          ctx2.beginPath();
          ctx2.moveTo(13, -3);
          ctx2.lineTo(17, -3);
          ctx2.lineTo(19, 6.5);
          ctx2.lineTo(15, 6.5);
          ctx2.closePath();
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(8, -8, 16, 1.8);
          break;
        }
      }
      ctx2.restore();
    }
    if (p.shieldTimer > 0 && p.shieldHp > 0) {
      const r = 34 + Math.sin(t * 0.15) * 1.5;
      const sGrad = ctx2.createRadialGradient(0, -8, r * 0.4, 0, -8, r);
      sGrad.addColorStop(0, "rgba(56,189,248,0.04)");
      sGrad.addColorStop(0.75, "rgba(56,189,248,0.16)");
      sGrad.addColorStop(1, "rgba(125,211,252,0.42)");
      ctx2.fillStyle = sGrad;
      ctx2.strokeStyle = "rgba(56,189,248,0.92)";
      ctx2.lineWidth = 2.2;
      ctx2.beginPath();
      ctx2.arc(0, -8, r, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.stroke();
    }
    ctx2.restore();
  }
  function drawPlayerTag(ctx2, p, dx, dy, isLocal) {
    if (!p.alive || p.respawnTimer > 0) return;
    const pal = TEAM_PALETTE[p.team] ?? TEAM_PALETTE.red;
    const wep = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
    ctx2.save();
    ctx2.translate(dx, dy);
    ctx2.font = "bold 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = isLocal ? "#f8fafc" : pal.light;
    ctx2.fillText((isLocal ? "\u25B6 " : "") + p.name, 0, -46);
    const barW = 44;
    ctx2.fillStyle = "rgba(15,23,42,0.88)";
    roundRect(ctx2, -barW / 2 - 1, -43, barW + 2, 6, 2);
    ctx2.fill();
    const ratio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    ctx2.fillStyle = ratio > 0.4 ? pal.color : "#ef4444";
    if (ratio > 0) {
      roundRect(ctx2, -barW / 2, -42, barW * ratio, 4, 1.5);
      ctx2.fill();
    }
    if (p.shieldTimer > 0 && p.shieldHp > 0) {
      ctx2.fillStyle = "rgba(15,23,42,0.85)";
      ctx2.fillRect(-barW / 2, -36, barW, 3);
      ctx2.fillStyle = "#38bdf8";
      ctx2.fillRect(-barW / 2, -36, barW * Math.min(1, p.shieldHp / DEFAULT_CONFIG.shieldHp), 3);
    }
    ctx2.font = "9px Inter, system-ui, sans-serif";
    ctx2.fillStyle = "rgba(226,232,240,0.8)";
    ctx2.fillText(`${wep.shortName} ${Math.ceil(p.ammo[p.weaponIndex] ?? 0)}`, 0, -56);
    ctx2.restore();
  }
  function drawObstacleSprite(ctx2, ob, dx, dy) {
    const left = dx - ob.w / 2;
    const top = dy - ob.h / 2;
    const ratio = Math.max(0, Math.min(1, ob.hp / ob.maxHp));
    ctx2.save();
    ctx2.fillStyle = ob.color;
    roundRect(ctx2, left, top, ob.w, ob.h, 3);
    ctx2.fill();
    ctx2.fillStyle = "rgba(255,255,255,0.12)";
    ctx2.fillRect(left + 2, top + 2, ob.w - 4, 4);
    ctx2.fillStyle = "rgba(0,0,0,0.25)";
    ctx2.fillRect(left + 2, top + ob.h - 5, ob.w - 4, 3);
    if (ob.kind === "box") {
      ctx2.strokeStyle = "rgba(15,23,42,0.32)";
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      ctx2.moveTo(left + 5, top + 5);
      ctx2.lineTo(left + ob.w - 5, top + ob.h - 5);
      ctx2.moveTo(left + ob.w - 5, top + 5);
      ctx2.lineTo(left + 5, top + ob.h - 5);
      ctx2.stroke();
    } else {
      for (let y = top + 10; y < top + ob.h - 4; y += 11) {
        ctx2.fillStyle = "rgba(0,0,0,0.2)";
        ctx2.fillRect(left + 2, y, ob.w - 4, 1.5);
      }
    }
    ctx2.strokeStyle = ob.borderColor;
    ctx2.lineWidth = 2;
    roundRect(ctx2, left + 1, top + 1, ob.w - 2, ob.h - 2, 3);
    ctx2.stroke();
    ctx2.fillStyle = "rgba(226,232,240,0.45)";
    const pad = 4.5;
    for (const [rx, ry] of [
      [left + pad, top + pad],
      [left + ob.w - pad, top + pad],
      [left + pad, top + ob.h - pad],
      [left + ob.w - pad, top + ob.h - pad]
    ]) {
      ctx2.beginPath();
      ctx2.arc(rx, ry, 1.4, 0, Math.PI * 2);
      ctx2.fill();
    }
    if (ratio < 0.7) {
      ctx2.strokeStyle = "rgba(9,13,22,0.68)";
      ctx2.lineWidth = ratio < 0.35 ? 1.6 : 1.1;
      const cracks = ratio < 0.35 ? 4 : 2;
      for (let i = 0; i < cracks; i++) {
        ctx2.beginPath();
        let x = left + ob.w * (0.2 + 0.6 * (i * 37 % 10) / 10);
        let y = top + ob.h * 0.15;
        ctx2.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += (i % 2 === 0 ? 1 : -1) * 4;
          y += ob.h / 5;
          ctx2.lineTo(x, y);
        }
        ctx2.stroke();
      }
    }
    const barW = Math.max(40, ob.w);
    ctx2.fillStyle = "rgba(15,23,42,0.85)";
    ctx2.fillRect(dx - barW / 2, top - 10, barW, 5);
    ctx2.fillStyle = ratio > 0.5 ? "#22c55e" : ratio > 0.25 ? "#f59e0b" : "#ef4444";
    ctx2.fillRect(dx - barW / 2, top - 10, barW * ratio, 5);
    ctx2.restore();
  }
  function drawCrateSprite(ctx2, crate, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy - 18);
    const bob = Math.sin(tick * 0.08 + crate.x * 0.01) * 1.8;
    ctx2.translate(0, bob);
    if (crate.active) {
      const glow = ctx2.createRadialGradient(0, 14, 2, 0, 14, 26);
      glow.addColorStop(0, crate.kind === "doll" ? "rgba(244,114,182,0.35)" : "rgba(56,189,248,0.32)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx2.fillStyle = glow;
      ctx2.beginPath();
      ctx2.ellipse(0, 15, 24, 6, 0, 0, Math.PI * 2);
      ctx2.fill();
    }
    const grad = ctx2.createLinearGradient(0, -16, 0, 16);
    if (crate.kind === "doll") {
      grad.addColorStop(0, "#9d174d");
      grad.addColorStop(1, "#4a044e");
    } else {
      grad.addColorStop(0, "#1e3a8a");
      grad.addColorStop(1, "#0f172a");
    }
    ctx2.fillStyle = grad;
    ctx2.strokeStyle = crate.color;
    ctx2.lineWidth = 2.2;
    roundRect(ctx2, -18, -16, 36, 32, 5);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx2, -16, -14, 32, 9, 3);
    ctx2.fill();
    ctx2.fillStyle = "#090d16";
    roundRect(ctx2, -5, -4, 10, 10, 2);
    ctx2.fill();
    ctx2.fillStyle = crate.color;
    roundRect(ctx2, -3, -2, 6, 6, 1.5);
    ctx2.fill();
    ctx2.font = "bold 12px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = "#ffffff";
    ctx2.fillText(crate.kind === "doll" ? "\u{1F38E}" : "\u{1F381}", 0, 4);
    ctx2.font = "bold 10px Inter, system-ui, sans-serif";
    ctx2.fillStyle = crate.color;
    ctx2.fillText(crate.kind === "doll" ? "\u66FF\u8EAB\u4EBA\u5076" : crate.weaponName, 0, -22);
    if (!crate.active && crate.respawnTimer > 0) {
      ctx2.fillStyle = "rgba(148,163,184,0.75)";
      ctx2.font = "9px Inter, system-ui, sans-serif";
      ctx2.fillText(`${Math.ceil(crate.respawnTimer)}s`, 0, 24);
    }
    ctx2.restore();
  }
  function drawAmmoSprite(ctx2, pack, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy - 16 + Math.sin(tick * 0.09 + pack.x * 0.01) * 1.4);
    const grad = ctx2.createLinearGradient(0, -12, 0, 12);
    grad.addColorStop(0, "#166534");
    grad.addColorStop(1, "#052e16");
    ctx2.fillStyle = grad;
    ctx2.strokeStyle = "#4ade80";
    ctx2.lineWidth = 2;
    roundRect(ctx2, -15, -12, 30, 24, 3.5);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "rgba(255,255,255,0.12)";
    ctx2.fillRect(-13, -10, 26, 4);
    for (let i = 0; i < 3; i++) {
      const bx = -9 + i * 7;
      ctx2.fillStyle = "#fbbf24";
      ctx2.fillRect(bx, -2, 4, 7);
      ctx2.fillStyle = "#fde68a";
      ctx2.beginPath();
      ctx2.moveTo(bx, -2);
      ctx2.lineTo(bx + 2, -6);
      ctx2.lineTo(bx + 4, -2);
      ctx2.closePath();
      ctx2.fill();
    }
    ctx2.font = "bold 9px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = "#bbf7d0";
    ctx2.fillText("\u{1F4E6} \u5F39\u836F", 0, 20);
    ctx2.restore();
  }
  function drawMortarSprite(ctx2, m, dx, dy, _tick) {
    ctx2.save();
    ctx2.translate(dx, dy);
    ctx2.fillStyle = "#334155";
    ctx2.strokeStyle = "#0f172a";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.ellipse(0, 2, 22, 9, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "#1e293b";
    ctx2.beginPath();
    ctx2.arc(-14, 2, 7, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.beginPath();
    ctx2.arc(14, 2, 7, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#94a3b8";
    ctx2.beginPath();
    ctx2.arc(-14, 2, 2.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.beginPath();
    ctx2.arc(14, 2, 2.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.save();
    ctx2.translate(0, -10);
    ctx2.rotate(m.angle);
    const g = ctx2.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, "#94a3b8");
    g.addColorStop(0.5, "#475569");
    g.addColorStop(1, "#1e293b");
    ctx2.fillStyle = g;
    ctx2.strokeStyle = m.operatorId ? "#fde047" : "#f97316";
    ctx2.lineWidth = 2;
    roundRect(ctx2, 0, -7, 40, 14, 5);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "#0f172a";
    ctx2.fillRect(36, -8, 6, 16);
    ctx2.restore();
    ctx2.font = "bold 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = m.operatorId ? "#fde047" : "#fb923c";
    ctx2.fillText(m.operatorId ? "\u{1F3AF} \u64CD\u63A7\u4E2D [E \u79BB\u5F00]" : "\u{1F525} \u8FEB\u51FB\u70AE [E]", 0, -36);
    if (m.cooldown > 0) {
      ctx2.fillStyle = "rgba(148,163,184,0.6)";
      ctx2.font = "9px Inter, system-ui, sans-serif";
      ctx2.fillText(`\u88C5\u586B ${m.cooldown.toFixed(1)}s`, 0, -26);
    }
    ctx2.restore();
  }
  function drawTowerSprite(ctx2, tw, dx, dy, tick) {
    const h = 150;
    ctx2.save();
    ctx2.translate(dx, dy);
    ctx2.strokeStyle = "#a16207";
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.moveTo(-24, 0);
    ctx2.lineTo(-12, -h);
    ctx2.moveTo(24, 0);
    ctx2.lineTo(12, -h);
    ctx2.stroke();
    ctx2.lineWidth = 1.5;
    ctx2.strokeStyle = "rgba(202, 138, 4, 0.6)";
    for (let i = 0; i < 5; i++) {
      const y1 = -i * (h / 5);
      const y2 = -(i + 1) * (h / 5);
      const w1 = 24 - 12 * i / 5;
      const w2 = 24 - 12 * (i + 1) / 5;
      ctx2.beginPath();
      ctx2.moveTo(-w1, y1);
      ctx2.lineTo(w2, y2);
      ctx2.moveTo(w1, y1);
      ctx2.lineTo(-w2, y2);
      ctx2.stroke();
    }
    ctx2.fillStyle = "#422006";
    ctx2.fillRect(-16, -h - 12, 32, 8);
    ctx2.fillStyle = "#eab308";
    ctx2.fillRect(-6, -h - 26, 12, 14);
    const glow = 0.5 + Math.sin(tick * 0.08) * 0.3;
    ctx2.fillStyle = `rgba(250, 204, 21, ${glow})`;
    ctx2.beginPath();
    ctx2.arc(0, -h - 20, 10 + Math.sin(tick * 0.08) * 2, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.font = "bold 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    if (tw.operatorId !== null) {
      ctx2.fillStyle = "#67e8f9";
      ctx2.fillText(`\u{1F5FC} ${tw.name} \xB7 \u89C2\u6D4B\u4E2D 200%`, 0, -h - 34);
    } else {
      ctx2.fillStyle = "#fef08a";
      ctx2.fillText(`\u{1F5FC} ${tw.name} [E]`, 0, -h - 34);
    }
    ctx2.restore();
  }
  function drawWarpSprite(ctx2, wp, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy - 28);
    const pulse = 0.5 + Math.sin(tick * 0.1 + wp.x * 0.01) * 0.2;
    ctx2.strokeStyle = "rgba(6, 182, 212, 0.9)";
    ctx2.lineWidth = 3.5;
    ctx2.beginPath();
    ctx2.ellipse(0, 0, 22 + pulse * 3, 34 + pulse * 4, 0, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillStyle = `rgba(6, 182, 212, ${0.12 + pulse * 0.12})`;
    ctx2.fill();
    ctx2.save();
    ctx2.rotate(tick * 0.05);
    ctx2.strokeStyle = "rgba(103, 232, 249, 0.55)";
    ctx2.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx2.beginPath();
      ctx2.ellipse(0, 0, 8 + i * 4, 14 + i * 5, Math.PI / 3, 0, Math.PI * 1.4);
      ctx2.stroke();
    }
    ctx2.restore();
    ctx2.fillStyle = "#67e8f9";
    ctx2.font = "bold 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillText(`\u{1F300} ${wp.name} [E]`, 0, -48);
    ctx2.restore();
  }
  function drawFlagSprite(ctx2, cp, dx, dy, tick) {
    const pal = cp.ownerTeam ? TEAM_PALETTE[cp.ownerTeam] ?? TEAM_PALETTE.red : { color: "#94a3b8", light: "#cbd5e1", dark: "#475569", glow: "rgba(148,163,184,0.2)" };
    ctx2.save();
    ctx2.translate(dx, dy);
    ctx2.fillStyle = "#475569";
    roundRect(ctx2, -10, -4, 20, 6, 2);
    ctx2.fill();
    ctx2.strokeStyle = "#94a3b8";
    ctx2.lineWidth = 4;
    ctx2.beginPath();
    ctx2.moveTo(0, 0);
    ctx2.lineTo(0, -100);
    ctx2.stroke();
    const wave = Math.sin(tick * 0.07) * 8;
    const wave2 = Math.sin(tick * 0.07 + 1.2) * 4;
    ctx2.fillStyle = pal.color;
    ctx2.beginPath();
    ctx2.moveTo(0, -100);
    ctx2.bezierCurveTo(30, -96 + wave, 46, -88 + wave2, 58, -78 + wave * 0.6);
    ctx2.lineTo(58, -46 + wave * 0.6);
    ctx2.bezierCurveTo(40, -52 + wave2, 22, -54 + wave, 0, -58);
    ctx2.closePath();
    ctx2.fill();
    ctx2.strokeStyle = "rgba(255,255,255,0.5)";
    ctx2.lineWidth = 1.5;
    ctx2.stroke();
    ctx2.fillStyle = "#ffffff";
    ctx2.font = "bold 12px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillText(`\u{1F6A9} [${cp.code}] ${Math.round(cp.progress)}%`, 0, -112);
    ctx2.restore();
  }
  function drawMineSprite(ctx2, m, dx, dy, tick, triggerRadius) {
    ctx2.save();
    ctx2.translate(dx, dy);
    const blink = Math.floor(tick / 8) % 2 === 0;
    ctx2.strokeStyle = m.triggered ? "rgba(244,63,94,0.8)" : m.instant ? "rgba(56,189,248,0.35)" : "rgba(244,63,94,0.2)";
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    ctx2.arc(0, 0, triggerRadius, 0, Math.PI * 2);
    ctx2.stroke();
    const g = ctx2.createRadialGradient(-3, -6, 2, 0, 0, 12);
    g.addColorStop(0, m.instant ? "#38bdf8" : "#64748b");
    g.addColorStop(1, m.instant ? "#075985" : "#1e293b");
    ctx2.fillStyle = g;
    ctx2.beginPath();
    ctx2.arc(0, 0, 12, Math.PI, 0);
    ctx2.fill();
    ctx2.fillRect(-12, 0, 24, 4);
    ctx2.strokeStyle = "#0f172a";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.moveTo(-10, 4);
    ctx2.lineTo(-16, 10);
    ctx2.moveTo(10, 4);
    ctx2.lineTo(16, 10);
    ctx2.stroke();
    ctx2.fillStyle = blink ? m.triggered ? "#ef4444" : m.instant ? "#38bdf8" : "#fbbf24" : "#1e293b";
    ctx2.beginPath();
    ctx2.arc(0, -5, 3.2, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.restore();
  }
  function drawGrenadeSprite(ctx2, _g, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy);
    ctx2.rotate(tick * 0.2);
    const grad = ctx2.createRadialGradient(-2, -2, 1, 0, 0, 8);
    grad.addColorStop(0, "#86efac");
    grad.addColorStop(1, "#166534");
    ctx2.fillStyle = grad;
    ctx2.beginPath();
    ctx2.arc(0, 0, 7, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = "#0f172a";
    ctx2.lineWidth = 1.5;
    ctx2.stroke();
    ctx2.strokeStyle = "rgba(5,46,22,0.55)";
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(-6, 0);
    ctx2.lineTo(6, 0);
    ctx2.moveTo(0, -6);
    ctx2.lineTo(0, 6);
    ctx2.stroke();
    ctx2.fillStyle = "#fbbf24";
    ctx2.fillRect(-2, -10, 4, 4);
    ctx2.restore();
  }
  function drawAirstrikeSprite(ctx2, st, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy);
    const pulse = 0.5 + Math.sin(tick * 0.4) * 0.5;
    ctx2.strokeStyle = `rgba(239,68,68,${0.5 + pulse * 0.4})`;
    ctx2.lineWidth = 2.5;
    ctx2.beginPath();
    ctx2.arc(0, 0, 40, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.arc(0, 0, 18 + pulse * 6, 0, Math.PI * 2);
    ctx2.stroke();
    const beamGrad = ctx2.createLinearGradient(0, -400, 0, 0);
    beamGrad.addColorStop(0, "rgba(239,68,68,0)");
    beamGrad.addColorStop(1, `rgba(239,68,68,${0.35 + pulse * 0.2})`);
    ctx2.fillStyle = beamGrad;
    ctx2.fillRect(-8, -400, 16, 400);
    ctx2.fillStyle = "#fecaca";
    ctx2.font = "bold 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillText(`\u2708\uFE0F \u7A7A\u88AD ${st.timer.toFixed(1)}s`, 0, -52);
    ctx2.restore();
  }
  function drawProjectileSprite(ctx2, pr, dx, dy, tick) {
    if (pr.rocket) {
      const ang = Math.atan2(pr.vel.y, pr.vel.x);
      ctx2.save();
      ctx2.translate(dx, dy);
      ctx2.rotate(ang);
      const flame = 12 + Math.sin(tick * 1.4) * 5;
      const fg = ctx2.createLinearGradient(-14, 0, -14 - flame, 0);
      fg.addColorStop(0, "rgba(254, 243, 199, 0.95)");
      fg.addColorStop(0.45, "rgba(251, 191, 36, 0.85)");
      fg.addColorStop(0.8, "rgba(249, 115, 22, 0.55)");
      fg.addColorStop(1, "rgba(249, 115, 22, 0)");
      ctx2.fillStyle = fg;
      ctx2.beginPath();
      ctx2.moveTo(-12, -4.5);
      ctx2.lineTo(-12 - flame, 0);
      ctx2.lineTo(-12, 4.5);
      ctx2.closePath();
      ctx2.fill();
      const bodyGrad = ctx2.createLinearGradient(0, -6, 0, 6);
      bodyGrad.addColorStop(0, "#fda4af");
      bodyGrad.addColorStop(0.5, "#f43f5e");
      bodyGrad.addColorStop(1, "#9f1239");
      ctx2.fillStyle = bodyGrad;
      ctx2.strokeStyle = "#4c0519";
      ctx2.lineWidth = 1.5;
      roundRect(ctx2, -14, -5, 24, 10, 4);
      ctx2.fill();
      ctx2.stroke();
      ctx2.fillStyle = "#fde68a";
      ctx2.beginPath();
      ctx2.moveTo(10, -5);
      ctx2.lineTo(18, 0);
      ctx2.lineTo(10, 5);
      ctx2.closePath();
      ctx2.fill();
      ctx2.fillStyle = "#9f1239";
      ctx2.beginPath();
      ctx2.moveTo(-14, -5);
      ctx2.lineTo(-18, -9);
      ctx2.lineTo(-10, -5);
      ctx2.closePath();
      ctx2.fill();
      ctx2.beginPath();
      ctx2.moveTo(-14, 5);
      ctx2.lineTo(-18, 9);
      ctx2.lineTo(-10, 5);
      ctx2.closePath();
      ctx2.fill();
      ctx2.restore();
      return;
    }
    if (pr.beam) {
      const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1;
      const len = 150;
      const ex = dx - pr.vel.x / spd * len;
      const ey = dy - pr.vel.y / spd * len;
      ctx2.save();
      ctx2.globalAlpha = 0.9;
      ctx2.strokeStyle = pr.color || "#22d3ee";
      ctx2.lineWidth = 6;
      ctx2.lineCap = "round";
      ctx2.beginPath();
      ctx2.moveTo(ex, ey);
      ctx2.lineTo(dx, dy);
      ctx2.stroke();
      ctx2.globalAlpha = 1;
      ctx2.strokeStyle = "#ffffff";
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      ctx2.moveTo(ex, ey);
      ctx2.lineTo(dx, dy);
      ctx2.stroke();
      ctx2.globalAlpha = 0.5;
      ctx2.fillStyle = pr.color || "#22d3ee";
      ctx2.beginPath();
      ctx2.arc(dx, dy, 7, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
    } else if (pr.isGravityOrb) {
      ctx2.save();
      ctx2.translate(dx, dy);
      const grd = ctx2.createRadialGradient(0, 0, 2, 0, 0, 26);
      grd.addColorStop(0, "rgba(233,213,255,0.95)");
      grd.addColorStop(0.38, "rgba(168,85,247,0.62)");
      grd.addColorStop(1, "rgba(168,85,247,0)");
      ctx2.fillStyle = grd;
      ctx2.beginPath();
      ctx2.arc(0, 0, 26, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.save();
      ctx2.rotate(tick * 0.14);
      ctx2.strokeStyle = "rgba(216,180,254,0.8)";
      ctx2.lineWidth = 1.8;
      for (let i = 0; i < 2; i++) {
        ctx2.beginPath();
        ctx2.arc(0, 0, pr.r + 3.5, i * Math.PI, i * Math.PI + Math.PI * 0.65);
        ctx2.stroke();
      }
      ctx2.restore();
      ctx2.fillStyle = "#090414";
      ctx2.strokeStyle = "#e9d5ff";
      ctx2.lineWidth = 1.6;
      ctx2.beginPath();
      ctx2.arc(0, 0, pr.r * 0.72, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.stroke();
      ctx2.restore();
    } else {
      const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1;
      const isSniper = pr.weaponId === 2;
      const len = isSniper ? 28 : 15;
      const ex = dx - pr.vel.x / spd * len;
      const ey = dy - pr.vel.y / spd * len;
      ctx2.save();
      ctx2.strokeStyle = pr.color || "#fbbf24";
      ctx2.lineWidth = isSniper ? 3 : 2.2;
      ctx2.lineCap = "round";
      ctx2.beginPath();
      ctx2.moveTo(ex, ey);
      ctx2.lineTo(dx, dy);
      ctx2.stroke();
      ctx2.fillStyle = "#ffffff";
      ctx2.beginPath();
      ctx2.arc(dx, dy, Math.max(1.6, pr.r - 0.8), 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
    }
  }
  function drawDeco(ctx2, r, dx, dy, tick) {
    const left = dx - r.w / 2;
    const top = dy - r.h / 2;
    switch (r.kind) {
      case "deco_window_lit": {
        const flick = 0.75 + Math.sin(tick * 0.05 + r.x * 0.013) * 0.12;
        ctx2.save();
        ctx2.globalAlpha = 0.9;
        ctx2.fillStyle = r.color;
        ctx2.fillRect(left, top, r.w, r.h);
        ctx2.strokeStyle = "rgba(15,23,42,0.75)";
        ctx2.lineWidth = 2;
        ctx2.strokeRect(left, top, r.w, r.h);
        ctx2.beginPath();
        ctx2.moveTo(left + r.w / 2, top);
        ctx2.lineTo(left + r.w / 2, top + r.h);
        ctx2.moveTo(left, top + r.h / 2);
        ctx2.lineTo(left + r.w, top + r.h / 2);
        ctx2.stroke();
        const g = ctx2.createRadialGradient(left + r.w / 2, top + r.h / 2, 2, left + r.w / 2, top + r.h / 2, r.w * 1.8);
        g.addColorStop(0, `rgba(251, 191, 36, ${0.2 * flick})`);
        g.addColorStop(1, "rgba(251, 191, 36, 0)");
        ctx2.fillStyle = g;
        ctx2.fillRect(left - r.w, top - r.h, r.w * 3, r.h * 3);
        ctx2.restore();
        break;
      }
      case "deco_window_dark":
        ctx2.fillStyle = "#0b1220";
        ctx2.fillRect(left, top, r.w, r.h);
        ctx2.strokeStyle = "rgba(30,41,59,0.9)";
        ctx2.lineWidth = 2;
        ctx2.strokeRect(left, top, r.w, r.h);
        break;
      case "deco_lamp": {
        ctx2.save();
        ctx2.strokeStyle = "#475569";
        ctx2.lineWidth = 3;
        ctx2.beginPath();
        ctx2.moveTo(dx, top + r.h);
        ctx2.lineTo(dx, top + 10);
        ctx2.stroke();
        ctx2.fillStyle = "#1e293b";
        ctx2.fillRect(dx - 7, top, 14, 10);
        const g = ctx2.createRadialGradient(dx, top + 6, 2, dx, top + 6, 70);
        g.addColorStop(0, "rgba(251,191,36,0.22)");
        g.addColorStop(1, "rgba(251,191,36,0)");
        ctx2.fillStyle = g;
        ctx2.beginPath();
        ctx2.arc(dx, top + 6, 70, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.fillStyle = "#fde68a";
        ctx2.beginPath();
        ctx2.arc(dx, top + 6, 3.5, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();
        break;
      }
      case "deco_cable": {
        ctx2.save();
        ctx2.strokeStyle = "rgba(100,116,139,0.85)";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.moveTo(left, top);
        ctx2.quadraticCurveTo(left + r.w / 2, top + r.h * 1.6, left + r.w, top);
        ctx2.stroke();
        ctx2.fillStyle = "#94a3b8";
        ctx2.beginPath();
        ctx2.arc(left, top, 3, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.beginPath();
        ctx2.arc(left + r.w, top, 3, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();
        break;
      }
      case "deco_antenna": {
        ctx2.save();
        ctx2.strokeStyle = r.color;
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.moveTo(dx, top + r.h);
        ctx2.lineTo(dx, top + 6);
        ctx2.moveTo(dx - 10, top + 16);
        ctx2.lineTo(dx + 10, top + 16);
        ctx2.moveTo(dx - 7, top + 26);
        ctx2.lineTo(dx + 7, top + 26);
        ctx2.stroke();
        const on = Math.floor(tick / 40) % 2 === 0;
        ctx2.fillStyle = on ? "#ef4444" : "#7f1d1d";
        ctx2.beginPath();
        ctx2.arc(dx, top + 4, 3.5, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();
        break;
      }
      case "deco_vent": {
        ctx2.save();
        ctx2.strokeStyle = "#64748b";
        ctx2.lineWidth = 2;
        ctx2.strokeRect(left, top, r.w, r.h);
        ctx2.fillStyle = "rgba(148,163,184,0.35)";
        for (let i = 0; i < 3; i++) {
          const ph = (tick * 0.4 + i * 12) % 36 / 36;
          ctx2.globalAlpha = (1 - ph) * 0.5;
          ctx2.beginPath();
          ctx2.arc(dx, top - 6 - ph * 26, 5 + ph * 8, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.globalAlpha = 1;
        ctx2.restore();
        break;
      }
      case "deco_stripe": {
        ctx2.save();
        ctx2.beginPath();
        ctx2.rect(left, top, r.w, r.h);
        ctx2.clip();
        for (let x = left - r.h; x < left + r.w; x += 14) {
          ctx2.fillStyle = "rgba(245,158,11,0.55)";
          ctx2.beginPath();
          ctx2.moveTo(x, top + r.h);
          ctx2.lineTo(x + 7, top);
          ctx2.lineTo(x + 14, top);
          ctx2.lineTo(x + 7, top + r.h);
          ctx2.closePath();
          ctx2.fill();
        }
        ctx2.restore();
        break;
      }
      case "deco_barrel": {
        ctx2.save();
        const g = ctx2.createLinearGradient(left, 0, left + r.w, 0);
        g.addColorStop(0, "#92400e");
        g.addColorStop(0.5, "#f59e0b");
        g.addColorStop(1, "#78350f");
        ctx2.fillStyle = g;
        roundRect(ctx2, left, top, r.w, r.h, 3);
        ctx2.fill();
        ctx2.strokeStyle = "#451a03";
        ctx2.lineWidth = 1.5;
        ctx2.stroke();
        ctx2.fillStyle = "rgba(0,0,0,0.35)";
        ctx2.fillRect(left, top + 6, r.w, 2);
        ctx2.fillRect(left, top + r.h - 8, r.w, 2);
        ctx2.restore();
        break;
      }
      case "deco_pipe_run": {
        ctx2.save();
        const g = ctx2.createLinearGradient(0, top, 0, top + r.h);
        g.addColorStop(0, "#0891b2");
        g.addColorStop(0.5, "#22d3ee");
        g.addColorStop(1, "#0e7490");
        ctx2.fillStyle = g;
        roundRect(ctx2, left, top, r.w, r.h, 4);
        ctx2.fill();
        ctx2.fillStyle = "rgba(0,0,0,0.4)";
        for (let x = left + 40; x < left + r.w; x += 120) ctx2.fillRect(x, top - 2, 6, r.h + 4);
        ctx2.restore();
        break;
      }
      case "deco_ladder": {
        ctx2.save();
        ctx2.strokeStyle = "rgba(148,163,184,0.75)";
        ctx2.lineWidth = 2;
        const x1 = left + 2;
        const x2 = left + r.w - 2;
        ctx2.beginPath();
        ctx2.moveTo(x1, top);
        ctx2.lineTo(x1, top + r.h);
        ctx2.moveTo(x2, top);
        ctx2.lineTo(x2, top + r.h);
        ctx2.stroke();
        for (let y = top + 12; y < top + r.h; y += 22) {
          ctx2.beginPath();
          ctx2.moveTo(x1, y);
          ctx2.lineTo(x2, y);
          ctx2.stroke();
        }
        ctx2.restore();
        break;
      }
      case "deco_sign": {
        ctx2.save();
        ctx2.fillStyle = "rgba(15,23,42,0.9)";
        roundRect(ctx2, left, top, r.w, r.h, 4);
        ctx2.fill();
        ctx2.strokeStyle = r.color;
        ctx2.lineWidth = 2;
        ctx2.stroke();
        ctx2.fillStyle = r.color;
        ctx2.font = "bold 13px Inter, system-ui, sans-serif";
        ctx2.textAlign = "center";
        ctx2.textBaseline = "middle";
        ctx2.fillText(`\u{1F6A9} ${r.borderColor ?? ""}`, dx, top + r.h / 2 + 1);
        ctx2.restore();
        break;
      }
      case "deco_bracket": {
        ctx2.save();
        ctx2.strokeStyle = "rgba(34,211,238,0.6)";
        ctx2.lineWidth = 3;
        ctx2.beginPath();
        ctx2.moveTo(dx - 8, top + r.h);
        ctx2.lineTo(dx - 8, top);
        ctx2.lineTo(dx + 8, top);
        ctx2.lineTo(dx + 8, top + r.h);
        ctx2.stroke();
        ctx2.restore();
        break;
      }
      case "deco_vine": {
        ctx2.save();
        ctx2.strokeStyle = r.color;
        ctx2.lineWidth = 2.5;
        ctx2.beginPath();
        ctx2.moveTo(dx, top);
        const sway = Math.sin(tick * 0.04 + r.x * 0.02) * 4;
        ctx2.quadraticCurveTo(dx + sway, top + r.h * 0.6, dx + sway * 1.6, top + r.h);
        ctx2.stroke();
        ctx2.fillStyle = "rgba(74, 222, 128, 0.65)";
        for (let i = 1; i <= 3; i++) {
          const ly = top + r.h / 4 * i;
          const off = Math.sin(tick * 0.04 + r.x * 0.02 + i) * 3;
          ctx2.beginPath();
          ctx2.ellipse(dx + off, ly, 3.4, 5.2, off > 0 ? 0.6 : -0.6, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.restore();
        break;
      }
      case "deco_stalactite": {
        ctx2.save();
        ctx2.fillStyle = r.color;
        ctx2.beginPath();
        ctx2.moveTo(dx - r.w / 2, top);
        ctx2.lineTo(dx + r.w / 2, top);
        ctx2.lineTo(dx, top + r.h);
        ctx2.closePath();
        ctx2.fill();
        ctx2.fillStyle = "rgba(255,255,255,0.18)";
        ctx2.beginPath();
        ctx2.moveTo(dx - r.w / 4, top);
        ctx2.lineTo(dx, top);
        ctx2.lineTo(dx, top + r.h * 0.7);
        ctx2.closePath();
        ctx2.fill();
        ctx2.restore();
        break;
      }
      case "deco_moss": {
        ctx2.save();
        ctx2.fillStyle = r.color;
        ctx2.globalAlpha = 0.8;
        for (let i = 0; i < 4; i++) {
          ctx2.beginPath();
          ctx2.arc(left + r.w / 4 * (i + 0.5), top + r.h * 0.6 + Math.sin(i * 2.1) * 3, r.h * 0.35, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.restore();
        break;
      }
      case "deco_ruin_arch": {
        ctx2.save();
        ctx2.strokeStyle = r.color;
        ctx2.lineWidth = 8;
        ctx2.beginPath();
        ctx2.arc(dx, top + r.h, r.w / 2, Math.PI, 0);
        ctx2.stroke();
        ctx2.fillStyle = "rgba(15,23,42,0.55)";
        ctx2.beginPath();
        ctx2.arc(dx, top + r.h, r.w / 2 - 6, Math.PI, 0);
        ctx2.fill();
        ctx2.restore();
        break;
      }
      default:
        ctx2.fillStyle = r.color;
        ctx2.fillRect(left, top, r.w, r.h);
    }
  }
  function drawJumpPad(ctx2, x, y, tick) {
    const pulse = 0.65 + 0.35 * Math.sin(tick * 0.12 + x * 0.01);
    ctx2.save();
    const g = ctx2.createRadialGradient(x, y - 8, 3, x, y - 8, 46);
    g.addColorStop(0, `rgba(56, 189, 248, ${0.3 * pulse})`);
    g.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx2.fillStyle = g;
    ctx2.beginPath();
    ctx2.arc(x, y - 8, 46, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#0e7490";
    ctx2.strokeStyle = "#22d3ee";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.roundRect(x - 26, y - 12, 52, 12, 4);
    ctx2.fill();
    ctx2.stroke();
    const lift = Math.sin(tick * 0.12 + x * 0.01) * 3;
    ctx2.strokeStyle = `rgba(165, 243, 252, ${0.6 + 0.4 * pulse})`;
    ctx2.lineWidth = 3.5;
    ctx2.lineCap = "round";
    for (const dy of [0, 8]) {
      ctx2.beginPath();
      ctx2.moveTo(x - 12, y - 20 - dy + lift);
      ctx2.lineTo(x, y - 30 - dy + lift);
      ctx2.lineTo(x + 12, y - 20 - dy + lift);
      ctx2.stroke();
    }
    ctx2.font = "bold 10px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = "rgba(165, 243, 252, 0.9)";
    ctx2.fillText("\u5F39\u5C04", x, y + 12);
    ctx2.restore();
  }

  // src/web/app/events.ts
  var death = { info: null };
  function handleEvents(evs) {
    for (const e of evs) {
      if (e.kind === "kill") {
        const killer = e.killerId ?? e.attackerId;
        const killerP = killer !== void 0 ? world.players.find((p) => p.id === killer) : void 0;
        const victimP = e.victimId !== void 0 ? world.players.find((p) => p.id === e.victimId) : void 0;
        const kName = e.killerName ?? killerP?.name ?? "\u6218\u573A\u73AF\u5883";
        const kTeam = e.killerTeam ?? killerP?.team ?? "ffa";
        const vName = e.victimName ?? victimP?.name ?? "?";
        const vTeam = e.victimTeam ?? victimP?.team ?? "ffa";
        addKillFeed(kName, kTeam, vName, vTeam, e.weaponLabel ?? "", e.isHeadshot ?? e.headshot, e.isPierced);
        if (e.victimId === localPlayer.id) death.info = { killer: kName, weapon: e.weaponLabel ?? "" };
        if (e.x !== void 0 && e.y !== void 0) effects.killBurst(e.x, e.y, TEAM_PALETTE[vTeam]?.light ?? "#fda4af");
      } else if (e.kind === "explosion") {
        screenFx.shake = Math.max(screenFx.shake, Math.min(14, (e.radius ?? 60) * 0.15));
        if (e.x !== void 0 && e.y !== void 0) effects.explosion(e.x, e.y, e.radius ?? 60);
      } else if (e.kind === "obstacle_destroy") {
        if (e.x !== void 0 && e.y !== void 0) effects.debris(e.x, e.y, 50, 60, "#9a3412", "#f97316");
      } else if (e.kind === "capture") showToast(`\u{1F6A9} \u636E\u70B9 ${e.pointCode} \u88AB ${e.team} \u5360\u9886\uFF01`);
      else if (e.kind === "supply_pickup") {
        const picker = e.playerId !== void 0 ? world.players.find((p) => p.id === e.playerId) : void 0;
        const who = e.playerName ?? picker?.name;
        const isSelf = e.playerId !== void 0 && e.playerId === localPlayer.id;
        showToast(who ? `\u{1F4E6} ${isSelf ? "\u4F60" : who} \u62FE\u53D6\u4E86\u3010${e.weaponName}\u3011` : `\u{1F4E6} \u62FE\u53D6\u3010${e.weaponName}\u3011`);
        if (e.x !== void 0 && e.y !== void 0) effects.sparkle(e.x, e.y, "#a5f3fc");
      } else if (e.kind === "ammo_pickup") {
        if (e.x !== void 0 && e.y !== void 0) effects.sparkle(e.x, e.y, "#4ade80");
      } else if (e.kind === "doll_recall") {
        showToast("\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\u751F\u6548\uFF1A\u56DE\u5230\u951A\u70B9\u4F4D\u7F6E\u4E0E\u72B6\u6001\uFF01");
        if (e.x !== void 0 && e.y !== void 0) effects.sparkle(e.x, e.y, "#f472b6");
      } else if (e.kind === "shield_break") showToast("\u{1F4A5} \u62A4\u76FE\u7834\u788E\uFF01");
      else if (e.kind === "mortar_fire") {
        screenFx.shake = Math.max(screenFx.shake, 9);
        if (e.x !== void 0 && e.y !== void 0) effects.muzzle(e.x, e.y - 20, "#fde047");
      } else if (e.kind === "airstrike_drop") {
        if (e.x !== void 0 && e.y !== void 0) {
          effects.explosion(e.x, e.y, 120);
          screenFx.shake = Math.max(screenFx.shake, 12);
        }
      } else if (e.kind === "laser") {
        if (e.segments && e.segments.length > 0) {
          const dur = e.duration ?? 0.14;
          beams.push({ segments: e.segments, color: e.color ?? "#22d3ee", life: dur, maxLife: dur });
          if (beams.length > 24) beams.shift();
        }
        screenFx.shake = Math.max(screenFx.shake, 1.5);
      } else if (e.kind === "warp") showToast(`\u{1F300} ${e.weaponName ?? "\u4F20\u9001"}\uFF01`);
    }
  }

  // src/web/app/net.ts
  var netState = {
    role: "offline",
    roomId: "",
    peerCount: 0,
    clientSession: null,
    stateSync: null,
    hostGuests: /* @__PURE__ */ new Map(),
    clientTransport: null,
    mapper: new InputMapper(),
    cleanupFns: [],
    channelMode: "Unordered/UDP",
    lastPingMs: 0
  };
  function getGlobalPeer() {
    const w = window;
    return typeof w.Peer === "function" ? w.Peer : null;
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function updateNetStatusUI() {
    const dot = document.getElementById("netStatusDot");
    const txt = document.getElementById("netStatusText");
    const badge = document.getElementById("peerCountBadge");
    const rttBadge = document.getElementById("kcpRttBadge");
    const roleBadge = document.getElementById("peerRoleBadge");
    const leaveBtn = document.getElementById("peerLeaveBtn");
    let srtt = 0;
    let tx = 0;
    let rx = 0;
    let fast = 0;
    if (netState.role === "host") {
      for (const slot of netState.hostGuests.values()) {
        const st = slot.transport.getKcpStats?.();
        if (st) {
          if (st.srtt > 0) srtt = st.srtt;
          tx += st.txPackets;
          rx += st.rxPackets;
          fast += st.fastRetransmits;
        }
      }
    } else if (netState.role === "client" && netState.clientTransport) {
      const st = netState.clientTransport.getKcpStats?.();
      if (st) {
        srtt = st.srtt;
        tx = st.txPackets;
        rx = st.rxPackets;
        fast = st.fastRetransmits;
      }
    }
    if (netState.role === "offline") {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400";
      if (txt) txt.textContent = "\u672C\u5730\u6743\u5A01";
      if (badge) badge.textContent = `\u5355\u673A/${bots.length}AI`;
      if (rttBadge) rttBadge.classList.add("hidden");
      if (roleBadge) {
        roleBadge.textContent = "\u672C\u5730\u5355\u673A";
        roleBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700";
      }
      if (leaveBtn) leaveBtn.classList.add("hidden");
    } else if (netState.role === "host") {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-cyan-400 animate-pulse";
      if (txt) txt.textContent = `KCP\u623F\u4E3B(${netState.roomId})`;
      if (badge) badge.textContent = `${netState.peerCount + 1}\u4EBA\u5728\u7EBF`;
      if (rttBadge) {
        rttBadge.classList.remove("hidden");
        rttBadge.textContent = `KCP ${srtt || 1}ms`;
      }
      if (roleBadge) {
        roleBadge.textContent = `\u{1F451} KCP \u623F\u4E3B (${netState.peerCount} \u5BA2\u673A)`;
        roleBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/50";
      }
      if (leaveBtn) leaveBtn.classList.remove("hidden");
    } else {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-sky-400 animate-pulse";
      if (txt) txt.textContent = `KCP\u5BA2\u673A(${netState.roomId})`;
      if (badge) badge.textContent = "\u5DF2\u8FDEKCP";
      if (rttBadge) {
        rttBadge.classList.remove("hidden");
        rttBadge.textContent = `KCP ${srtt || 1}ms`;
      }
      if (roleBadge) {
        roleBadge.textContent = "\u{1F680} KCP \u5BA2\u673A\u5DF2\u8FDE\u63A5";
        roleBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/50";
      }
      if (leaveBtn) leaveBtn.classList.remove("hidden");
    }
    setText("kcpStatChannel", netState.channelMode);
    setText("kcpStatRtt", `${srtt || (netState.role === "offline" ? 0 : 1)} ms`);
    setText("kcpStatPkts", `${tx} / ${rx} (${fast})`);
  }
  function wrapRtcDataChannelAsPeerConn(dc, pc) {
    let onDataCb = null;
    let onCloseCb = null;
    dc.binaryType = "arraybuffer";
    dc.onmessage = (ev) => {
      onDataCb?.(ev.data);
    };
    dc.onclose = () => {
      onCloseCb?.();
    };
    return {
      dataChannel: dc,
      peerConnection: pc,
      reliable: false,
      serialization: "raw",
      send(data) {
        if (dc.readyState !== "open") return;
        try {
          if (data instanceof Uint8Array) {
            dc.send(data.slice().buffer);
          } else if (data instanceof ArrayBuffer) {
            dc.send(data);
          } else if (typeof data === "string") {
            dc.send(data);
          }
        } catch {
        }
      },
      on: ((event, cb) => {
        if (event === "data") onDataCb = cb;
        else if (event === "close") onCloseCb = cb;
      }),
      close() {
        try {
          dc.close();
        } catch {
        }
        try {
          pc?.close();
        } catch {
        }
      }
    };
  }
  function acceptIncomingKcpGuest(conn, label = "KCP-Guest") {
    const srvTransport = createPeerServer(conn, {
      nodelay: 1,
      interval: 10,
      resend: 2,
      nc: 1
    });
    const team = mode.current === "ffa" ? "ffa" : world.players.filter((p) => p.team === "blue").length <= world.players.filter((p) => p.team === "red").length ? "blue" : "red";
    const guestPlayer = world.addPlayer(label, team);
    guestPlayer.deployed = true;
    guestPlayer.alive = true;
    const slot = {
      playerId: guestPlayer.id,
      transport: srvTransport,
      input: defaultWorldInput(),
      lastAckSeq: 0
    };
    srvTransport.onClient((msg) => {
      if (typeof msg.seq === "number" && msg.seq > slot.lastAckSeq) {
        slot.lastAckSeq = msg.seq;
      }
      slot.input = applyIntents(slot.input, msg.intents);
    });
    netState.hostGuests.set(guestPlayer.id, slot);
    netState.peerCount = netState.hostGuests.size;
    srvTransport.send({
      snap: world.snapshot(),
      welcome: { playerId: guestPlayer.id, name: guestPlayer.name, team: guestPlayer.team }
    });
    srvTransport.kcp?.sendPing(performance.now());
    conn.on("close", () => {
      netState.hostGuests.delete(guestPlayer.id);
      world.players = world.players.filter((p) => p.id !== guestPlayer.id);
      netState.peerCount = netState.hostGuests.size;
      updateTeamCountUI();
      updateNetStatusUI();
      showToast(`\u{1F50C} \u5BA2\u673A ${guestPlayer.name} \u5DF2\u65AD\u5F00 KCP \u8FDE\u63A5`);
    });
    updateTeamCountUI();
    updateNetStatusUI();
    setText("peerStatusLog", `\u2705 \u5DF2\u63A5\u5165\u5BA2\u673A ${guestPlayer.name} (#${guestPlayer.id}) \xB7 WebRTC Unordered DataChannel + KCP (nodelay=1, interval=10ms)`);
    showToast(`\u26A1 \u5BA2\u673A ${guestPlayer.name} \u5DF2\u901A\u8FC7 WebRTC KCP \u63A5\u5165\u623F\u95F4\uFF01`);
    return guestPlayer.id;
  }
  function attachClientKcpSession(conn, roomId) {
    const cliTransport = createPeerClient(conn, {
      nodelay: 1,
      interval: 10,
      resend: 2,
      nc: 1
    });
    const sync = new StateSync(world.terrain, 0);
    const session = new ClientSession(cliTransport, 0, sync);
    netState.role = "client";
    netState.roomId = roomId;
    netState.clientTransport = cliTransport;
    netState.stateSync = sync;
    netState.clientSession = session;
    session.onSnapshot((snap) => {
      applyAuthoritativeSnapshotToClientWorld(snap);
    });
    session.onEvents((evs) => {
      if (evs && evs.length > 0) handleEvents(evs);
    });
    conn.on("close", () => {
      showToast("\u26A0\uFE0F \u4E0E\u623F\u4E3B\u7684 KCP \u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u5DF2\u5207\u56DE\u5355\u673A\u6743\u5A01\u6A21\u5F0F");
      leaveMultiplayerRoom();
    });
    updateNetStatusUI();
    setText("peerStatusLog", `\u{1F680} \u5DF2\u8FDE\u5165\u623F\u4E3B [${roomId}] \xB7 WebRTC KCP \u6781\u901F\u540C\u6B65\u6FC0\u6D3B\uFF080 RTT \u9884\u6D4B + KCP \u5FEB\u91CD\u4F20\uFF09`);
    showToast(`\u{1F680} \u5DF2\u901A\u8FC7 WebRTC KCP \u8FDE\u5165\u623F\u95F4 ${roomId}`);
  }
  function applyAuthoritativeSnapshotToClientWorld(snap) {
    const interp = netState.stateSync?.interpolated() ?? snap;
    world.tick = interp.tick;
    world.scores = { ...interp.scores };
    world.players = interp.players;
    world.projectiles = interp.projectiles;
    world.grenades = interp.grenades;
    world.landmines = interp.landmines;
    world.airstrikes = interp.airstrikes;
    world.obstacles = interp.obstacles;
    world.capturePoints = interp.capturePoints;
    world.ammoPacks = interp.ammoPacks;
    world.supplyCrates = interp.supplyCrates;
    world.mortars = interp.mortars;
    const myId = netState.clientSession?.playerId ?? localPlayer.id;
    const meInSnap = interp.players.find((p) => p.id === myId);
    if (meInSnap) {
      Object.assign(localPlayer, meInSnap);
    }
    updateScoreboardUI();
    updateHudUI();
  }
  function setupBroadcastChannelWebRtcHost(roomId) {
    if (typeof BroadcastChannel === "undefined" || typeof RTCPeerConnection === "undefined") return;
    const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`);
    const pcs = /* @__PURE__ */ new Map();
    bc.onmessage = async (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "join-offer" && msg.clientId && msg.sdp) {
        const pc = new RTCPeerConnection();
        pcs.set(msg.clientId, pc);
        pc.onicecandidate = (ice) => {
          if (ice.candidate) {
            bc.postMessage({ type: "host-ice", clientId: msg.clientId, candidate: ice.candidate.toJSON() });
          }
        };
        pc.ondatachannel = (dcEv) => {
          const dc = dcEv.channel;
          dc.onopen = () => {
            netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`;
            const wrapped = wrapRtcDataChannelAsPeerConn(dc, pc);
            acceptIncomingKcpGuest(wrapped, msg.playerName || "KCP-Ranger");
          };
        };
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        bc.postMessage({ type: "host-answer", clientId: msg.clientId, sdp: pc.localDescription?.toJSON() });
      } else if (msg.type === "client-ice" && msg.clientId && msg.candidate) {
        const pc = pcs.get(msg.clientId);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {
          }
        }
      }
    };
    netState.cleanupFns.push(() => {
      bc.close();
      for (const pc of pcs.values()) {
        try {
          pc.close();
        } catch {
        }
      }
      pcs.clear();
    });
  }
  function startHostRoom() {
    leaveMultiplayerRoom();
    const roomCode = "SB2-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    netState.role = "host";
    netState.roomId = roomCode;
    netState.channelMode = "WebRTC UDP+KCP";
    const idInput = document.getElementById("peerLocalIdInput");
    if (idInput) idInput.value = roomCode;
    setupBroadcastChannelWebRtcHost(roomCode);
    const PeerCtor = getGlobalPeer();
    if (PeerCtor) {
      try {
        const peer = new PeerCtor(roomCode, { debug: 0 });
        peer.on("open", (id) => {
          netState.roomId = id;
          if (idInput) idInput.value = id;
          setText("peerStatusLog", `\u{1F451} KCP \u623F\u95F4\u5DF2\u5C31\u7EEA [${id}] \xB7 \u7B49\u5F85\u5BA2\u673A\u901A\u8FC7 PeerJS / WebRTC KCP \u63A5\u5165`);
          updateNetStatusUI();
        });
        peer.on("connection", (conn) => {
          if (conn.on) {
            conn.on("open", () => {
              acceptIncomingKcpGuest(conn, "Peer-Agent");
            });
          } else {
            acceptIncomingKcpGuest(conn, "Peer-Agent");
          }
        });
        peer.on("error", () => {
          setText("peerStatusLog", `\u{1F451} KCP \u623F\u95F4 [${roomCode}] \u5DF2\u5728\u672C\u5730 WebRTC KCP \u901A\u9053\u5C31\u7EEA\uFF08\u53EF\u8DE8\u6807\u7B7E\u9875\u6216\u70B9\u51FB\u300C\u53CC\u7AEFKCP\u5B9E\u6D4B\u300D\u9A8C\u8BC1\uFF09`);
        });
        netState.cleanupFns.push(() => {
          try {
            peer.destroy();
          } catch {
          }
        });
      } catch {
      }
    }
    setText("peerStatusLog", `\u{1F451} KCP \u623F\u4E3B\u5DF2\u521B\u5EFA [${roomCode}] \xB7 WebRTC DataChannel (ordered:false, maxRetransmits:0) + KCP (nodelay=1)`);
    updateNetStatusUI();
    showToast(`\u{1F451} \u5DF2\u521B\u5EFA KCP \u623F\u95F4\uFF1A${roomCode}`);
  }
  async function joinHostRoom(rawRoomId) {
    const roomId = rawRoomId.trim();
    if (!roomId) {
      showToast("\u26A0\uFE0F \u8BF7\u5148\u8F93\u5165\u623F\u4E3B\u623F\u95F4\u7801 (Peer ID)");
      return;
    }
    leaveMultiplayerRoom();
    setText("peerStatusLog", `\u23F3 \u6B63\u5728\u5411\u623F\u95F4 [${roomId}] \u53D1\u8D77 WebRTC \u65E0\u5E8F\u4E0D\u53EF\u9760 DataChannel + KCP \u63E1\u624B...`);
    let connected = false;
    if (typeof BroadcastChannel !== "undefined" && typeof RTCPeerConnection !== "undefined") {
      const clientId = "cli-" + Math.random().toString(36).slice(2, 8);
      const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`);
      const pc = new RTCPeerConnection();
      const dc = pc.createDataChannel("skyblast-kcp", {
        ordered: false,
        maxRetransmits: 0
      });
      pc.onicecandidate = (ice) => {
        if (ice.candidate) {
          bc.postMessage({ type: "client-ice", clientId, candidate: ice.candidate.toJSON() });
        }
      };
      dc.onopen = () => {
        if (connected) return;
        connected = true;
        netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`;
        const wrapped = wrapRtcDataChannelAsPeerConn(dc, pc);
        attachClientKcpSession(wrapped, roomId);
      };
      bc.onmessage = async (ev) => {
        const msg = ev.data;
        if (!msg || msg.clientId !== clientId) return;
        if (msg.type === "host-answer" && msg.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === "host-ice" && msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {
          }
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      bc.postMessage({
        type: "join-offer",
        clientId,
        playerName: localPlayer.name,
        sdp: pc.localDescription?.toJSON()
      });
      netState.cleanupFns.push(() => {
        bc.close();
        try {
          dc.close();
        } catch {
        }
        try {
          pc.close();
        } catch {
        }
      });
    }
    const PeerCtor = getGlobalPeer();
    if (PeerCtor) {
      try {
        const peer = new PeerCtor(void 0, { debug: 0 });
        peer.on("open", () => {
          if (connected) return;
          const conn = peer.connect(roomId, {
            serialization: "raw",
            reliable: false
          });
          conn.on?.("open", () => {
            if (connected) return;
            connected = true;
            netState.channelMode = "PeerJS(reliable:false)+KCP";
            attachClientKcpSession(conn, roomId);
          });
        });
        netState.cleanupFns.push(() => {
          try {
            peer.destroy();
          } catch {
          }
        });
      } catch {
      }
    }
  }
  function leaveMultiplayerRoom() {
    for (const slot of netState.hostGuests.values()) {
      world.players = world.players.filter((p) => p.id !== slot.playerId);
    }
    for (const fn of netState.cleanupFns) {
      try {
        fn();
      } catch {
      }
    }
    netState.cleanupFns.length = 0;
    netState.hostGuests.clear();
    netState.clientTransport = null;
    netState.clientSession = null;
    netState.stateSync = null;
    netState.role = "offline";
    netState.roomId = "";
    netState.peerCount = 0;
    netState.channelMode = "Unordered/UDP";
    updateTeamCountUI();
    updateNetStatusUI();
    setText("peerStatusLog", "\u5DF2\u5207\u56DE\u672C\u5730\u5355\u673A\u6743\u5A01\u6A21\u5F0F\u3002\u968F\u65F6\u53EF\u521B\u5EFA\u6216\u52A0\u5165 WebRTC KCP \u8054\u673A\u623F\u95F4\u3002");
  }
  async function runDualWebRtcKcpSelfTest() {
    if (typeof RTCPeerConnection === "undefined") {
      showToast("\u26A0\uFE0F \u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 RTCPeerConnection");
      return;
    }
    if (netState.role !== "host") {
      startHostRoom();
    }
    const pcHost = new RTCPeerConnection();
    const pcGuest = new RTCPeerConnection();
    pcHost.onicecandidate = (e) => {
      if (e.candidate) pcGuest.addIceCandidate(e.candidate).catch(() => {
      });
    };
    pcGuest.onicecandidate = (e) => {
      if (e.candidate) pcHost.addIceCandidate(e.candidate).catch(() => {
      });
    };
    const guestDc = pcGuest.createDataChannel("skyblast-kcp", {
      ordered: false,
      maxRetransmits: 0
    });
    let guestPlayerId = 0;
    let guestClientSession = null;
    let guestClientTransport = null;
    pcHost.ondatachannel = (ev) => {
      const hostDc = ev.channel;
      hostDc.onopen = () => {
        netState.channelMode = `WebRTC UDP(ordered:${hostDc.ordered},rtx:${hostDc.maxRetransmits ?? 0})+KCP`;
        const hostConn = wrapRtcDataChannelAsPeerConn(hostDc, pcHost);
        guestPlayerId = acceptIncomingKcpGuest(hostConn, "KCP-Phantom");
      };
    };
    guestDc.onopen = () => {
      const guestConn = wrapRtcDataChannelAsPeerConn(guestDc, pcGuest);
      guestClientTransport = createPeerClient(guestConn, {
        nodelay: 1,
        interval: 10,
        resend: 2,
        nc: 1
      });
      const guestSync = new StateSync(world.terrain, 0);
      guestClientSession = new ClientSession(guestClientTransport, 0, guestSync);
    };
    const offer = await pcGuest.createOffer();
    await pcGuest.setLocalDescription(offer);
    await pcHost.setRemoteDescription(offer);
    const answer = await pcHost.createAnswer();
    await pcHost.setLocalDescription(answer);
    await pcGuest.setRemoteDescription(answer);
    const timer = window.setInterval(() => {
      if (!guestClientSession || guestPlayerId <= 0) return;
      const t = performance.now() * 1e-3;
      const moveX = Math.sin(t * 1.7) > 0 ? 1 : -1;
      const aimAngle = Math.atan2(
        localPlayer.pos.y - 2400,
        localPlayer.pos.x - 6600
      );
      guestClientSession.sendIntents(
        netState.mapper.map({
          moveX,
          aimAngle,
          fire: Math.floor(t * 4) % 3 === 0,
          jump: false,
          jetpack: Math.sin(t * 3) > 0.3,
          reload: false
        }),
        1 / 60
      );
      guestClientTransport?.tickKcp?.(performance.now());
    }, 33);
    netState.cleanupFns.push(() => {
      window.clearInterval(timer);
      try {
        guestDc.close();
      } catch {
      }
      try {
        pcGuest.close();
      } catch {
      }
      try {
        pcHost.close();
      } catch {
      }
    });
  }
  function stepNetworkFrame(dt, localInput, allInputs) {
    const now = performance.now();
    if (netState.role === "client" && netState.clientSession) {
      const intents = netState.mapper.map({
        moveX: localInput.move,
        aimAngle: localInput.aim,
        fire: localInput.fire,
        jump: localInput.jump,
        jetpack: localInput.jetpack,
        dive: localInput.dive,
        reload: localInput.reload,
        interact: localInput.interact,
        secondary: localInput.secondary ? { kind: localInput.secondary.type, targetX: localInput.secondary.targetX, targetY: localInput.secondary.targetY } : void 0,
        switchWeapon: localInput.switchWeapon ?? void 0
      });
      netState.clientSession.sendIntents(intents, dt);
      netState.clientTransport?.tickKcp?.(now);
      netState.stateSync?.advance(dt, 1 / 30);
      if (now - netState.lastPingMs > 400) {
        netState.lastPingMs = now;
        netState.clientTransport?.kcp?.sendPing(now);
        updateNetStatusUI();
      }
      return true;
    }
    if (netState.role === "host") {
      for (const slot of netState.hostGuests.values()) {
        allInputs.set(slot.playerId, {
          ...slot.input,
          secondary: slot.input.secondary ? { ...slot.input.secondary } : null
        });
        slot.input.jump = false;
        slot.input.interact = false;
        slot.input.secondary = null;
        slot.input.switchWeapon = null;
        slot.input.reload = false;
        slot.transport.tickKcp?.(now);
      }
      if (now - netState.lastPingMs > 400) {
        netState.lastPingMs = now;
        for (const slot of netState.hostGuests.values()) {
          slot.transport.kcp?.sendPing(now);
        }
        updateNetStatusUI();
      }
    }
    return false;
  }
  function broadcastHostKcpSnapshot(events) {
    if (netState.role !== "host" || netState.hostGuests.size === 0) return;
    const snap = world.snapshot();
    const ackSeqs = {};
    for (const slot of netState.hostGuests.values()) {
      ackSeqs[slot.playerId] = slot.lastAckSeq;
    }
    snap.ackSeqs = ackSeqs;
    const sharedFrame = encodeServerWireFrame({ snap, events });
    for (const slot of netState.hostGuests.values()) {
      if (slot.transport.sendRawFrame) {
        slot.transport.sendRawFrame(sharedFrame);
      } else {
        slot.transport.send({ snap, events });
      }
    }
  }

  // src/web/app/params.ts
  var paramState = { weaponIdx: 0 };
  function syncParamsToUI() {
    const setVal = (inId, vId, val, suf = "") => {
      const iEl = document.getElementById(inId);
      const vEl = document.getElementById(vId);
      if (iEl) iEl.value = String(val);
      if (vEl) vEl.textContent = val + suf;
    };
    const P2 = getPhysicsParams();
    setVal("paramGravity", "valGravity", P2.gravity);
    setVal("paramMoveSpeed", "valMoveSpeed", P2.moveSpeed);
    setVal("paramJetpackAccel", "valJetpackAccel", P2.jetpackAccel);
    setVal("paramJetpackMaxUp", "valJetpackMaxUp", P2.jetpackMaxUp);
    setVal("paramMaxHp", "valMaxHp", world.config.maxHp);
    setVal("paramHeadRadius", "valHeadRadius", world.config.headRadius);
    const w = WEAPONS[paramState.weaponIdx] ?? WEAPONS[0];
    setVal("paramWepDamage", "valWepDamage", w.damage);
    setVal("paramWepHeadshot", "valWepHeadshot", w.headshotMult, "x");
    setVal("paramWepSpeed", "valWepSpeed", w.speed);
    setVal("paramWepMag", "valWepMag", w.magSize);
    setVal("paramWepReload", "valWepReload", w.reloadTime, "s");
    setVal("paramGrenadeDmg", "valGrenadeDmg", world.config.grenadeDamage);
    setVal("paramGrenadeRadius", "valGrenadeRadius", world.config.grenadeRadius);
    setVal("paramMineDmg", "valMineDmg", world.config.mineDamage);
    setVal("paramMineRadius", "valMineRadius", world.config.mineTriggerRadius);
    setVal("paramMortarDmg", "valMortarDmg", world.config.mortarDamage);
    setVal("paramMortarRadius", "valMortarRadius", world.config.mortarRadius);
    setVal("paramRespawnDelay", "valRespawnDelay", world.config.respawnDelay, "s");
    setVal("paramDollMax", "valDollMax", world.config.dollMaxCharges);
    document.querySelectorAll(".param-wep-tab").forEach((btn) => {
      const idx = Number(btn.getAttribute("data-pwep") || 0);
      btn.className = idx === paramState.weaponIdx ? "param-wep-tab px-2 py-1 rounded bg-amber-500 text-slate-950 font-extrabold text-[11px]" : "param-wep-tab px-2 py-1 rounded bg-slate-950 text-slate-300 font-semibold text-[11px] border border-slate-700";
    });
  }
  function bindRangeParam(inputId, valId, suffix, applyFn) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener("input", () => {
      const v = Number(el.value);
      const vEl = document.getElementById(valId);
      if (vEl) vEl.textContent = v + suffix;
      applyFn(v);
    });
  }

  // src/web/input/device.ts
  function updateInputModeBadge(isTouchMode, isAuto) {
    const badge = document.getElementById("inputDeviceDetectBadge");
    if (!badge) return;
    const prefix = isAuto ? "\u5DF2\u81EA\u52A8\u8BC6\u522B" : "\u5DF2\u624B\u52A8\u5207\u6362";
    if (isTouchMode) {
      badge.textContent = `\u{1F4F1} ${prefix}\uFF1A\u624B\u673A/\u5E73\u677F\u89E6\u5C4F\u6A21\u5F0F (\u70B9\u51FB\u53EF\u5207\u952E\u9F20)`;
      badge.className = "px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35 transition";
    } else {
      badge.textContent = `\u{1F4BB} ${prefix}\uFF1APC \u952E\u9F20\u64CD\u63A7\u6A21\u5F0F (\u70B9\u51FB\u53EF\u5207\u89E6\u5C4F)`;
      badge.className = "px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition";
    }
  }
  function setTouchLayerVisible(visible, isAuto = false) {
    touchState.enabled = visible;
    const layer = document.getElementById("touchControlsLayer");
    if (layer) layer.classList.toggle("hidden", !visible);
    updateInputModeBadge(visible, isAuto);
  }
  function autoDetectDeviceInput() {
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const touchPoints = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setTouchLayerVisible(Boolean(coarse || touchPoints && window.innerWidth <= 1024), true);
  }

  // src/web/game/bots.ts
  function syncBotsCount(target) {
    while (bots.length > target) {
      const b = bots.pop();
      world.players = world.players.filter((p) => p.id !== b.id);
    }
    while (bots.length < target) {
      const idx = bots.length;
      let team;
      if (mode.current === "ffa") {
        team = "ffa";
      } else {
        team = idx % 2 === 0 ? "red" : "blue";
        if (team === localPlayer.team) team = team === "red" ? "blue" : "red";
      }
      const b = world.addPlayer(botNames[idx % botNames.length], team);
      b.weaponIndex = idx % 4;
      b.lastPrimaryIndex = idx % 4;
      b.secondary = botSecs[idx % botSecs.length];
      const cp = world.capturePoints[idx % world.capturePoints.length];
      b.pos = { x: wrapX(cp.x + (idx - 4) * 47), y: cp.y - 50 };
      bots.push(b);
    }
    bots.forEach((b, idx) => {
      if (mode.current === "ffa") {
        b.team = "ffa";
      } else {
        let team = idx % 2 === 0 ? "red" : "blue";
        if (team === localPlayer.team) team = team === "red" ? "blue" : "red";
        b.team = team;
      }
    });
    updateTeamCountUI();
  }
  function pickBotTarget(bot) {
    const enemies = [localPlayer, ...bots.filter((b) => b !== bot)].filter((e) => e.deployed && e.alive && e.respawnTimer <= 0 && (bot.team === "ffa" || e.team !== bot.team));
    let target = null;
    let best = Infinity;
    for (const e of enemies) {
      const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    return target;
  }
  function botInput(bot) {
    const w = defaultWorldInput();
    const target = pickBotTarget(bot);
    if (!target) return w;
    const dx = wrapDeltaX(bot.pos.x, target.pos.x);
    const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12);
    w.aim = Math.atan2(dy, dx);
    if (Math.abs(dx) > 340) w.move = dx > 0 ? 1 : -1;
    else if (Math.abs(dx) < 150) w.move = dx > 0 ? -1 : 1;
    w.fire = world.tick % 12 < 5 && Math.abs(dx) < 900;
    w.jetpack = target.pos.y + 80 < bot.pos.y;
    return w;
  }

  // src/web/game/loadout.ts
  function applyPendingLoadoutAndSpawn() {
    const want = Number(pendingLoadout.weaponIndex);
    const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0;
    localPlayer.weaponIndex = wIdx;
    localPlayer.lastPrimaryIndex = wIdx;
    const streak = localPlayer.deathStreak ?? 0;
    const wantSec = pendingLoadout.secondaryType;
    localPlayer.secondary = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0) ? wantSec : getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0);
    localPlayer.deployed = true;
    localPlayer.alive = true;
    world.deploy(localPlayer);
    updateHudWeaponButtons();
    const spLabel = world.config.randomSpawn ? "\u968F\u673A\u5B89\u5168\u70B9" : "\u961F\u4F0D\u4E3B\u57FA\u5730";
    showToast(`\u26A1 \u5DF2\u5728\u3010${spLabel}\u3011\u90E8\u7F72\uFF01\u914D\u88C5\u5DF2\u9501\u5B9A\uFF1A${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`);
  }

  // src/web/input/bindings.ts
  function bindAllEvents() {
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    window.addEventListener("keydown", (e) => {
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
      keys[e.code] = true;
      if (e.code === "KeyR") inputQueue.reload = true;
      else if (e.code === "KeyG" || e.code === "KeyQ") inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
      else if (e.code === "KeyE") inputQueue.interact = true;
      else if (e.code === "Digit1") tryChangePrimaryWeapon(0);
      else if (e.code === "Digit2") tryChangePrimaryWeapon(1);
      else if (e.code === "Digit3") tryChangePrimaryWeapon(2);
      else if (e.code === "Digit4") tryChangePrimaryWeapon(3);
      else if (e.code === "Digit5") tryChangePrimaryWeapon(7);
    });
    window.addEventListener("keyup", (e) => {
      keys[e.code] = false;
    });
    canvas?.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    canvas?.addEventListener("mousedown", (e) => {
      if (e.button === 0) mouse.down = true;
      else if (e.button === 2) inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    canvas?.addEventListener("mouseup", (e) => {
      if (e.button === 0) mouse.down = false;
    });
    canvas?.addEventListener("contextmenu", (e) => e.preventDefault());
    document.querySelectorAll(".lobby-wep-btn").forEach((btn) => btn.addEventListener("click", () => tryChangePrimaryWeapon(Number(btn.getAttribute("data-wep") || 0))));
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => btn.addEventListener("click", () => tryChangeSecondaryWeapon(btn.getAttribute("data-sec") || "frag")));
    document.querySelectorAll(".death-wep-btn").forEach((btn) => btn.addEventListener("click", () => {
      tryChangePrimaryWeapon(Number(btn.getAttribute("data-wep") || 0));
      updateHudWeaponButtons();
    }));
    document.querySelectorAll(".death-sec-btn").forEach((btn) => btn.addEventListener("click", () => {
      tryChangeSecondaryWeapon(btn.getAttribute("data-sec") || "frag");
      updateHudWeaponButtons();
    }));
    document.querySelectorAll(".spawn-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const spId = btn.getAttribute("data-spawn") || "base";
        if (spId !== "base") {
          const cp = world.capturePoints.find((c) => c.id === spId);
          if (!cp || cp.ownerTeam !== localPlayer.team && localPlayer.team !== "ffa") {
            showToast("\u26A0\uFE0F \u8BE5\u5360\u9886\u70B9\u5C1A\u672A\u88AB\u6211\u65B9\u961F\u4F0D\u5360\u9886\uFF0C\u6682\u4E0D\u53EF\u4F5C\u4E3A\u91CD\u751F\u70B9\uFF01");
            return;
          }
        }
        pendingLoadout.spawnPointId = spId;
        updateSpawnPointButtonsUI();
      });
    });
    document.querySelectorAll(".bot-count-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cnt = Number(btn.getAttribute("data-bots") || 0);
        syncBotsCount(cnt);
        updateNetStatusUI();
        document.querySelectorAll(".bot-count-btn").forEach((b) => {
          b.className = Number(b.getAttribute("data-bots")) === cnt ? "bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs" : "bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700";
        });
      });
    });
    document.getElementById("peerHostBtn")?.addEventListener("click", () => {
      startHostRoom();
    });
    document.getElementById("peerCopyIdBtn")?.addEventListener("click", () => {
      const inp = document.getElementById("peerLocalIdInput");
      const val = inp?.value?.trim() || "";
      if (!val) {
        showToast("\u26A0\uFE0F \u8BF7\u5148\u70B9\u51FB\u300C\u521B\u5EFA KCP \u623F\u95F4\u300D\u751F\u6210\u623F\u95F4\u7801");
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).catch(() => {
          });
        } else if (inp) {
          inp.select();
          document.execCommand("copy");
        }
      } catch {
        if (inp) {
          inp.select();
          try {
            document.execCommand("copy");
          } catch {
          }
        }
      }
      showToast(`\u{1F4CB} \u5DF2\u590D\u5236 KCP \u623F\u95F4\u7801\uFF1A${val}`);
    });
    document.getElementById("peerJoinBtn")?.addEventListener("click", () => {
      const inp = document.getElementById("peerRemoteIdInput");
      void joinHostRoom(inp?.value || "");
    });
    document.getElementById("peerLeaveBtn")?.addEventListener("click", () => {
      leaveMultiplayerRoom();
    });
    document.getElementById("peerLoopbackTestBtn")?.addEventListener("click", () => {
      void runDualWebRtcKcpSelfTest();
    });
    document.querySelectorAll(".param-wep-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        paramState.weaponIdx = Number(btn.getAttribute("data-pwep") || 0);
        syncParamsToUI();
      });
    });
    document.getElementById("hudReloadBtn")?.addEventListener("click", () => {
      inputQueue.reload = true;
    });
    document.getElementById("hudGrenadeBtn")?.addEventListener("click", () => {
      inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    document.getElementById("hudQuickMortarBtn")?.addEventListener("click", () => {
      inputQueue.interact = true;
    });
    document.getElementById("openEditorBtn")?.addEventListener("click", () => {
      window.open("./editor.html", "_blank");
    });
    document.getElementById("openAdminBtn")?.addEventListener("click", () => {
      window.open("./admin.html", "_blank");
    });
    document.getElementById("interactBannerBtn")?.addEventListener("click", () => {
      if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
        const lobby = document.getElementById("lobbyModal");
        lobby?.classList.remove("hidden");
        lobby?.classList.add("flex");
        updateSpawnPointButtonsUI();
      } else inputQueue.interact = true;
    });
    function applyTeamButtons() {
      document.querySelectorAll(".team-select-btn").forEach((b) => {
        const t = b.getAttribute("data-team");
        const enabled = mode.current === "2teams" ? t === "red" || t === "blue" : t === "ffa";
        const sel = t === localPlayer.team;
        b.disabled = !enabled;
        b.className = "team-select-btn px-3 py-2 rounded-xl text-left transition flex items-center justify-between " + (sel ? "border-2 border-indigo-400 bg-indigo-500/20 " : "border border-slate-700 bg-slate-950/60 ") + (enabled ? "" : "opacity-40 cursor-not-allowed");
      });
    }
    function applyMode(nextMode) {
      if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
        showToast("\u26A0\uFE0F \u5207\u6362\u5BF9\u6218\u6A21\u5F0F\u9700\u5728\u5F85\u673A/\u9635\u4EA1\u6574\u5907\u65F6\u8FDB\u884C");
        return;
      }
      mode.current = nextMode;
      document.querySelectorAll(".mode-btn").forEach((b) => {
        const sel = b.getAttribute("data-mode") === nextMode;
        b.className = "mode-btn px-3 py-2 rounded-xl text-left transition border " + (sel ? "border-2 border-emerald-400 bg-emerald-500/20" : "border border-slate-700 bg-slate-950/60 hover:border-slate-500");
      });
      if (nextMode === "ffa") localPlayer.team = "ffa";
      else if (localPlayer.team !== "blue") localPlayer.team = "red";
      syncBotsCount(bots.length);
      applyTeamButtons();
      updateTeamCountUI();
      showToast(nextMode === "ffa" ? "\u{1F7E1} \u81EA\u7531\u6DF7\u6218\uFF1A\u5168\u5458\u7686\u654C\uFF0C\u968F\u673A\u51FA\u751F\u70B9" : "\u2694\uFE0F \u53CC\u961F\u5BF9\u6297\uFF08\u7EA2\u961F vs \u84DD\u961F\uFF09\uFF1A\u968F\u673A\u51FA\u751F\u70B9");
    }
    document.querySelectorAll(".mode-btn").forEach((b) => {
      b.addEventListener("click", () => applyMode(b.getAttribute("data-mode") || "ffa"));
    });
    document.querySelectorAll(".team-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const chosen = btn.getAttribute("data-team") || "red";
        localPlayer.team = chosen;
        applyTeamButtons();
        updateTeamCountUI();
        updateSpawnPointButtonsUI();
      });
    });
    document.getElementById("playerNameInput")?.addEventListener("input", (e) => {
      localPlayer.name = e.target.value.trim() || "SkyHunter";
    });
    const lobbyModal = document.getElementById("lobbyModal");
    document.getElementById("openLobbyBtn")?.addEventListener("click", () => {
      lobbyModal?.classList.remove("hidden");
      lobbyModal?.classList.add("flex");
      updateSpawnPointButtonsUI();
    });
    document.getElementById("startBattleBtn")?.addEventListener("click", () => {
      if (!localPlayer.deployed || localPlayer.respawnTimer > 0) applyPendingLoadoutAndSpawn();
      lobbyModal?.classList.add("hidden");
      lobbyModal?.classList.remove("flex");
    });
    document.getElementById("inputDeviceDetectBadge")?.addEventListener("click", () => setTouchLayerVisible(!touchState.enabled, false));
    document.getElementById("toggleTouchBtn")?.addEventListener("click", () => setTouchLayerVisible(!touchState.enabled, false));
    document.getElementById("resetTerrainBtn")?.addEventListener("click", () => {
      world.resetMatch();
      showToast("\u5168\u56FE\u53EF\u7834\u574F\u969C\u788D\u7269\u3001\u5730\u96F7\u4E0E\u5F39\u836F\u8865\u7ED9\u5DF2\u5168\u90E8\u91CD\u7F6E");
    });
    const paramsModal = document.getElementById("paramsModal");
    const openParams = () => {
      paramsModal?.classList.remove("hidden");
      paramsModal?.classList.add("flex");
      syncParamsToUI();
    };
    const closeParams = () => {
      paramsModal?.classList.add("hidden");
      paramsModal?.classList.remove("flex");
    };
    document.getElementById("openParamsBtn")?.addEventListener("click", openParams);
    document.getElementById("lobbyOpenParamsBtn")?.addEventListener("click", openParams);
    document.getElementById("closeParamsBtn")?.addEventListener("click", closeParams);
    document.getElementById("resetParamsBtn")?.addEventListener("click", () => {
      resetPhysicsParams();
      world.config = { ...DEFAULT_CONFIG };
      syncParamsToUI();
      showToast("\u5DF2\u6062\u590D\u9ED8\u8BA4\u53C2\u6570");
    });
    bindRangeParam("paramGravity", "valGravity", "", (v) => setPhysicsParams({ gravity: v }));
    bindRangeParam("paramMoveSpeed", "valMoveSpeed", "", (v) => setPhysicsParams({ moveSpeed: v }));
    bindRangeParam("paramJetpackAccel", "valJetpackAccel", "", (v) => setPhysicsParams({ jetpackAccel: v }));
    bindRangeParam("paramJetpackMaxUp", "valJetpackMaxUp", "", (v) => setPhysicsParams({ jetpackMaxUp: v }));
    bindRangeParam("paramMaxHp", "valMaxHp", "", (v) => {
      world.config.maxHp = v;
      for (const p of world.players) {
        p.maxHp = v;
        if (p.hp > v) p.hp = v;
      }
    });
    bindRangeParam("paramHeadRadius", "valHeadRadius", "", (v) => {
      world.config.headRadius = v;
    });
    bindRangeParam("paramWepDamage", "valWepDamage", "", (v) => {
      WEAPONS[paramState.weaponIdx].damage = v;
    });
    bindRangeParam("paramWepHeadshot", "valWepHeadshot", "x", (v) => {
      WEAPONS[paramState.weaponIdx].headshotMult = v;
    });
    bindRangeParam("paramWepSpeed", "valWepSpeed", "", (v) => {
      WEAPONS[paramState.weaponIdx].speed = v;
    });
    bindRangeParam("paramWepMag", "valWepMag", "", (v) => {
      WEAPONS[paramState.weaponIdx].magSize = v;
    });
    bindRangeParam("paramWepReload", "valWepReload", "s", (v) => {
      WEAPONS[paramState.weaponIdx].reloadTime = v;
    });
    bindRangeParam("paramGrenadeDmg", "valGrenadeDmg", "", (v) => {
      world.config.grenadeDamage = v;
    });
    bindRangeParam("paramGrenadeRadius", "valGrenadeRadius", "", (v) => {
      world.config.grenadeRadius = v;
    });
    bindRangeParam("paramMineDmg", "valMineDmg", "", (v) => {
      world.config.mineDamage = v;
    });
    bindRangeParam("paramMineRadius", "valMineRadius", "", (v) => {
      world.config.mineTriggerRadius = v;
    });
    bindRangeParam("paramMortarDmg", "valMortarDmg", "", (v) => {
      world.config.mortarDamage = v;
    });
    bindRangeParam("paramMortarRadius", "valMortarRadius", "", (v) => {
      world.config.mortarRadius = v;
    });
    bindRangeParam("paramRespawnDelay", "valRespawnDelay", "s", (v) => {
      world.config.respawnDelay = v;
    });
    bindRangeParam("paramDollMax", "valDollMax", "", (v) => {
      world.config.dollMaxCharges = v;
    });
    function bindJoystick(zoneEl, stickEl, isAim) {
      if (!zoneEl || !stickEl) return;
      const maxDist = 46;
      const handleMove = (clientX, clientY) => {
        const rect = zoneEl.getBoundingClientRect();
        let dx = clientX - (rect.left + rect.width / 2);
        let dy = clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) {
          dx = dx / dist * maxDist;
          dy = dy / dist * maxDist;
        }
        stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
        if (isAim) {
          touchState.aimX = dx / maxDist;
          touchState.aimY = dy / maxDist;
        } else {
          touchState.moveX = dx / maxDist;
          touchState.moveY = dy / maxDist;
        }
      };
      zoneEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (!touchState.enabled) setTouchLayerVisible(true, true);
        const t = e.changedTouches[0];
        if (isAim) {
          touchState.aimActive = true;
          touchState.aimId = t.identifier;
        } else {
          touchState.moveActive = true;
          touchState.moveId = t.identifier;
        }
        handleMove(t.clientX, t.clientY);
      }, { passive: false });
      zoneEl.addEventListener("touchmove", (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          if (isAim && t.identifier === touchState.aimId || !isAim && t.identifier === touchState.moveId) handleMove(t.clientX, t.clientY);
        }
      }, { passive: false });
      const endTouch = (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (isAim && t.identifier === touchState.aimId) {
            touchState.aimActive = false;
            touchState.aimX = 0;
            touchState.aimY = 0;
            stickEl.style.transform = "translate(0px, 0px)";
          } else if (!isAim && t.identifier === touchState.moveId) {
            touchState.moveActive = false;
            touchState.moveX = 0;
            touchState.moveY = 0;
            stickEl.style.transform = "translate(0px, 0px)";
          }
        }
      };
      zoneEl.addEventListener("touchend", endTouch);
      zoneEl.addEventListener("touchcancel", endTouch);
    }
    bindJoystick(document.getElementById("touchMoveZone"), document.getElementById("touchMoveStick"), false);
    bindJoystick(document.getElementById("touchAimZone"), document.getElementById("touchAimStick"), true);
    applyTeamButtons();
    document.querySelectorAll(".mode-btn").forEach((b) => {
      const sel = b.getAttribute("data-mode") === mode.current;
      b.className = "mode-btn px-3 py-2 rounded-xl text-left transition border " + (sel ? "border-2 border-emerald-400 bg-emerald-500/20" : "border border-slate-700 bg-slate-950/60 hover:border-slate-500");
    });
    const boostBtn = document.getElementById("touchBoostBtn");
    boostBtn?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      touchState.boostButtonDown = true;
    }, { passive: false });
    boostBtn?.addEventListener("touchend", () => {
      touchState.boostButtonDown = false;
    });
    document.getElementById("touchGrenadeBtn")?.addEventListener("click", () => {
      inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    document.getElementById("touchReloadBtn")?.addEventListener("click", () => {
      inputQueue.reload = true;
    });
    document.getElementById("touchInteractBtn")?.addEventListener("click", () => {
      inputQueue.interact = true;
    });
    updateNetStatusUI();
  }

  // src/web/render/beamGeometry.ts
  function expandBeamSegments(segments, toScreen, halfW, halfH) {
    const out = [];
    const padX = halfW + 200;
    const padY = halfH + 200;
    for (const seg of segments) {
      const from = toScreen(seg.x1, seg.y1);
      const dx = seg.dx ?? wrapDeltaX(seg.x1, seg.x2);
      const dy = seg.dy ?? wrapDeltaY(seg.y1, seg.y2);
      out.push({ x1: from.x, y1: from.y, x2: from.x + dx, y2: from.y + dy });
      for (const ox of [-WORLD_W, 0, WORLD_W]) {
        for (const oy of [-WORLD_H, 0, WORLD_H]) {
          if (ox === 0 && oy === 0) continue;
          const x1 = from.x + ox;
          const y1 = from.y + oy;
          const x2 = x1 + dx;
          const y2 = y1 + dy;
          if (Math.max(x1, x2) < -padX || Math.min(x1, x2) > padX) continue;
          if (Math.max(y1, y2) < -padY || Math.min(y1, y2) > padY) continue;
          out.push({ x1, y1, x2, y2 });
        }
      }
    }
    return out;
  }

  // src/web/textures.ts
  function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 | 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var cache = /* @__PURE__ */ new Map();
  function makeTex(size, seed, paint) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const c = cv.getContext("2d");
    paint(c, mulberry32(seed));
    return cv;
  }
  function speckle(c, rnd, size, count, colors, rMin = 1, rMax = 3) {
    for (let i = 0; i < count; i++) {
      c.fillStyle = colors[Math.floor(rnd() * colors.length)];
      c.globalAlpha = 0.25 + rnd() * 0.5;
      const r = rMin + rnd() * (rMax - rMin);
      c.beginPath();
      c.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  function paintEarth(c, rnd) {
    const S = 96;
    c.fillStyle = "#1b2436";
    c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 10) {
      c.fillStyle = rnd() > 0.5 ? "rgba(51, 65, 85, 0.38)" : "rgba(15, 23, 42, 0.42)";
      c.fillRect(0, y + rnd() * 3, S, 2 + rnd() * 3);
    }
    speckle(c, rnd, S, 48, ["#243044", "#2c3a52", "#141c2b", "#334155", "#475569"], 1, 3.4);
    speckle(c, rnd, S, 10, ["#94a3b8"], 0.6, 1.4);
    for (let i = 0; i < 4; i++) {
      let x = rnd() * S;
      let y = rnd() * S;
      c.strokeStyle = "rgba(8, 12, 20, 0.7)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 26;
        y += (rnd() - 0.2) * 14;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  function paintBedrock(c, rnd) {
    const S = 96;
    c.fillStyle = "#0b111e";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 64, ["#080d16", "#131c2b", "#1c2738", "#263449"], 1, 4.2);
    c.strokeStyle = "rgba(56, 189, 248, 0.12)";
    c.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(rnd() * S, rnd() * S);
      c.lineTo(rnd() * S, rnd() * S);
      c.stroke();
    }
  }
  function paintBrick(c, rnd) {
    const S = 96;
    const rowH = 24;
    c.fillStyle = "#0b111c";
    c.fillRect(0, 0, S, S);
    for (let row = 0; row < Math.ceil(S / rowH); row++) {
      const off = row % 2 === 0 ? 0 : -18;
      for (let x = off; x < S; x += 36) {
        const shade = 0.88 + rnd() * 0.28;
        c.fillStyle = `rgb(${Math.round(44 * shade)},${Math.round(56 * shade)},${Math.round(74 * shade)})`;
        c.fillRect(x + 2, row * rowH + 2, 32, rowH - 4);
        c.fillStyle = "rgba(255,255,255,0.11)";
        c.fillRect(x + 2, row * rowH + 2, 32, 2);
        c.fillStyle = "rgba(0,0,0,0.28)";
        c.fillRect(x + 2, row * rowH + rowH - 4, 32, 2);
      }
    }
    speckle(c, rnd, S, 22, ["#1a2334", "#38465c"], 0.8, 2);
  }
  function paintConcrete(c, rnd) {
    const S = 96;
    c.fillStyle = "#3a4658";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 54, ["#334155", "#475569", "#2c3849", "#5a6b82"], 0.9, 2.5);
    c.strokeStyle = "rgba(15, 23, 42, 0.6)";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, S / 2);
    c.lineTo(S, S / 2);
    c.moveTo(S / 2, 0);
    c.lineTo(S / 2, S);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.fillRect(0, 0, S, 2);
    c.fillRect(0, S / 2 + 1, S, 1.5);
    for (const [bx, by] of [[10, 10], [S / 2 - 10, 10], [S / 2 + 10, S / 2 + 10], [S - 10, S / 2 + 10]]) {
      c.fillStyle = "rgba(15,23,42,0.65)";
      c.beginPath();
      c.arc(bx, by, 2, 0, Math.PI * 2);
      c.fill();
    }
  }
  function paintMetal(c, rnd) {
    const S = 96;
    const g = c.createLinearGradient(0, 0, S, 0);
    g.addColorStop(0, "#123f52");
    g.addColorStop(0.45, "#1e6b85");
    g.addColorStop(0.55, "#1e6b85");
    g.addColorStop(1, "#0e3545");
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) {
      c.strokeStyle = `rgba(255,255,255,${0.025 + rnd() * 0.055})`;
      c.lineWidth = 1;
      c.beginPath();
      const y = rnd() * S;
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
    c.strokeStyle = "rgba(8, 20, 28, 0.85)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 6);
    c.lineTo(S, 6);
    c.stroke();
    for (let x = 8; x < S; x += 16) {
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.beginPath();
      c.arc(x, 13.2, 2.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(165, 243, 252, 0.65)";
      c.beginPath();
      c.arc(x, 12, 2, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "rgba(34, 211, 238, 0.16)";
    c.fillRect(0, 0, S, 3);
  }
  function paintPipeInner(c, rnd) {
    const S = 96;
    c.fillStyle = "#0a1420";
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 20; i++) {
      c.strokeStyle = `rgba(56, 189, 248, ${0.03 + rnd() * 0.05})`;
      c.lineWidth = 1;
      c.beginPath();
      const y = rnd() * S;
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
    speckle(c, rnd, S, 12, ["#0f2233", "#123044"], 1, 2.4);
  }
  function paintTunnel(c, rnd) {
    const S = 96;
    c.fillStyle = "#070b12";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 34, ["#0c1119", "#101722", "#131b26"], 1.5, 4);
    c.strokeStyle = "rgba(90, 110, 130, 0.12)";
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      let x = rnd() * S;
      c.moveTo(x, 0);
      for (let y = 0; y < S; y += 12) {
        x += (rnd() - 0.5) * 10;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  function paintIsland(c, rnd) {
    const S = 96;
    c.fillStyle = "#2d394b";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 42, ["#25303d", "#3b4a5e", "#202a38", "#475569"], 1, 3.2);
    c.fillStyle = "#15803d";
    c.fillRect(0, 0, S, 8);
    c.fillStyle = "#4ade80";
    for (let x = 0; x < S; x += 3) {
      c.fillRect(x, 0, 2, 2 + rnd() * 4.5);
    }
    c.fillStyle = "rgba(10, 14, 22, 0.42)";
    for (let x = 0; x < S; x += 8) c.fillRect(x + rnd() * 3, S - 10, 2.2, 8);
  }
  function paintGrate(c, rnd) {
    const S = 96;
    c.fillStyle = "#1e2a38";
    c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(148, 163, 184, 0.4)";
    c.lineWidth = 2;
    for (let i = 0; i < S; i += 12) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, S);
      c.stroke();
    }
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.lineWidth = 1;
    for (let i = 6; i < S; i += 12) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, S);
      c.stroke();
    }
    speckle(c, rnd, S, 10, ["#2c3a4d"], 1, 2);
  }
  function paintPlate(c, rnd) {
    const S = 96;
    c.fillStyle = "#2b3747";
    c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(100, 116, 139, 0.42)";
    c.lineWidth = 1;
    for (let y = 0; y < S; y += 24) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
    for (let x = 0; x < S; x += 32) {
      c.strokeStyle = "rgba(15, 23, 42, 0.65)";
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, S);
      c.stroke();
      c.fillStyle = "rgba(186, 230, 253, 0.38)";
      c.beginPath();
      c.arc(x + 8, 12, 1.7, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(x + 8, S - 12, 1.7, 0, Math.PI * 2);
      c.fill();
    }
    speckle(c, rnd, S, 16, ["#364457", "#1e293b"], 1, 2);
  }
  function texKindOf(kind) {
    switch (kind) {
      case "earth":
        return "earth";
      case "bedrock":
        return "bedrock";
      case "wall":
        return "brick";
      case "building_roof":
      case "floor_slab":
      case "building_bg":
        return "concrete";
      case "pipe_wall":
        return "metal";
      case "pipe_bg":
        return "pipeInner";
      case "tunnel_bg":
        return "tunnel";
      case "sky_island":
        return "island";
      case "step":
        return "grate";
      case "bunker_floor":
        return "plate";
      case "bridge":
        return "metal";
      case "platform":
        return "island";
      case "ledge":
        return "concrete";
      case "cliff":
        return "brick";
      case "ruin_pillar":
      case "ruin_lintel":
        return "brick";
      case "cave_floor":
      case "cave_shelf":
        return "plate";
      case "container":
        return "plate";
      case "cover":
        return "brick";
      case "pillar":
        return "concrete";
      default:
        return "earth";
    }
  }
  function getTerrainPattern(ctx2, kind) {
    const key = texKindOf(kind);
    const hit = cache.get(key);
    if (hit) return hit;
    let cv;
    switch (key) {
      case "earth":
        cv = makeTex(96, 11, paintEarth);
        break;
      case "bedrock":
        cv = makeTex(96, 17, paintBedrock);
        break;
      case "brick":
        cv = makeTex(96, 23, paintBrick);
        break;
      case "concrete":
        cv = makeTex(96, 29, paintConcrete);
        break;
      case "metal":
        cv = makeTex(96, 37, paintMetal);
        break;
      case "pipeInner":
        cv = makeTex(96, 41, paintPipeInner);
        break;
      case "tunnel":
        cv = makeTex(96, 47, paintTunnel);
        break;
      case "island":
        cv = makeTex(96, 53, paintIsland);
        break;
      case "grate":
        cv = makeTex(96, 59, paintGrate);
        break;
      case "plate":
        cv = makeTex(96, 67, paintPlate);
        break;
      default:
        cv = makeTex(96, 11, paintEarth);
    }
    const pat = ctx2.createPattern(cv, "repeat");
    if (pat) cache.set(key, pat);
    return pat;
  }
  function syncTerrainPatterns(camX, camY) {
    const m = new DOMMatrix().translate(-camX, -camY);
    for (const pat of cache.values()) pat.setTransform(m);
  }

  // src/web/render/scene.ts
  function renderScene() {
    if (!ctx || !canvas) return;
    const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0];
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    const targetFov = localPlayer.mountedTowerId ? 2 : mounted ? 1 : wep.fovMult || 1;
    camera.fovFactor += (targetFov - camera.fovFactor) * 0.12;
    if (localPlayer.deployed) {
      const tx = localPlayer.pos.x;
      const ty = localPlayer.pos.y - 12;
      camera.x = wrapX(camera.x + wrapDeltaX(camera.x, tx) * 0.2);
      camera.y = wrapY(camera.y + wrapDeltaY(camera.y, ty) * 0.2);
    }
    let shakeX = 0, shakeY = 0;
    if (screenFx.shake > 0.2) {
      shakeX = (Math.random() - 0.5) * screenFx.shake * 2;
      shakeY = (Math.random() - 0.5) * screenFx.shake * 2;
      screenFx.shake *= 0.86;
    } else screenFx.shake = 0;
    const zoom = 1 / camera.fovFactor;
    const halfW = canvas.width * camera.fovFactor / 2 + 160;
    const halfH = canvas.height * camera.fovFactor / 2 + 160;
    ctx.save();
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    const depthT = clamp((camera.y - (SURFACE_Y - 1400)) / 1800, 0, 1);
    const topR = Math.round(5 + depthT * 4);
    const topB = Math.round(17 - depthT * 10);
    skyGrad.addColorStop(0, `rgb(${topR}, ${Math.round(8 + depthT * 4)}, ${topB + 4})`);
    skyGrad.addColorStop(0.55, `rgb(${Math.round(15 - depthT * 9)}, ${Math.round(23 - depthT * 12)}, ${Math.round(42 - depthT * 22)})`);
    skyGrad.addColorStop(1, `rgb(${Math.round(30 - depthT * 20)}, ${Math.round(27 - depthT * 17)}, ${Math.round(75 - depthT * 45)})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
    ctx.scale(zoom, zoom);
    const sx = (wx) => wrapDeltaX(camera.x, wx);
    const sy = (wy) => wrapDeltaY(camera.y, wy);
    const inView = (dx, dy, pad = 0) => dx > -halfW - pad && dx < halfW + pad && dy > -halfH - pad && dy < halfH + pad;
    for (const st of worldStars) {
      const px = sx(st.x);
      const py = sy(st.y);
      if (!inView(px, py)) continue;
      ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(world.tick * 0.02 + st.x * 0.05));
      ctx.fillStyle = "#dbeafe";
      ctx.beginPath();
      ctx.arc(px, py, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const gl of worldGlows) {
      const gx = sx(gl.x);
      const gy = sy(gl.y);
      if (!inView(gx, gy, gl.r)) continue;
      const grad = ctx.createRadialGradient(gx, gy, 10, gx, gy, gl.r);
      grad.addColorStop(0, `rgba(${gl.c}, ${gl.a})`);
      grad.addColorStop(1, `rgba(${gl.c}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gx, gy, gl.r, 0, Math.PI * 2);
      ctx.fill();
    }
    syncTerrainPatterns(camera.x, camera.y);
    for (const r of world.terrain.rects) {
      if (r.kind.startsWith("deco_")) continue;
      const cx0 = sx(r.x + r.w / 2);
      const cy0 = sy(r.y + r.h / 2);
      for (const ox of [-WORLD_W, 0, WORLD_W]) {
        for (const oy of [-WORLD_H, 0, WORLD_H]) {
          const cx = cx0 + ox;
          const cy = cy0 + oy;
          if (!inView(cx, cy, Math.max(r.w, r.h))) continue;
          const left = cx - r.w / 2;
          const top = cy - r.h / 2;
          const pat = getTerrainPattern(ctx, r.kind);
          ctx.fillStyle = pat ?? r.color;
          ctx.fillRect(left, top, r.w, r.h);
          if (r.kind !== "tunnel_bg" && r.kind !== "pipe_bg" && r.kind !== "building_bg") {
            ctx.fillStyle = "rgba(255,255,255,0.10)";
            ctx.fillRect(left, top, r.w, 2);
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            ctx.fillRect(left, top + r.h - 3, r.w, 3);
          }
          if (r.borderColor) {
            ctx.strokeStyle = r.borderColor;
            ctx.lineWidth = r.kind === "pipe_wall" ? 3 : 2;
            ctx.strokeRect(left + 1, top + 1, r.w - 2, r.h - 2);
          }
          if (r.label && (r.kind === "building_roof" || r.kind === "pipe_wall" || r.kind === "bridge")) {
            ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
            ctx.font = "bold 12px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(r.label, cx, top - 8);
          }
        }
      }
    }
    for (const pad of JUMP_PADS) {
      const px = sx(pad.x);
      const py = sy(pad.y);
      if (!inView(px, py, 60)) continue;
      drawJumpPad(ctx, px, py, world.tick);
    }
    for (const ob of world.obstacles) {
      const ox = sx(ob.x + ob.w / 2);
      const oy = sy(ob.y + ob.h / 2);
      if (!inView(ox, oy, Math.max(ob.w, ob.h))) continue;
      drawObstacleSprite(ctx, ob, ox, oy);
    }
    for (const cp of world.capturePoints) {
      const cx = sx(cp.x);
      const cy = sy(cp.y);
      if (!inView(cx, cy, 140)) continue;
      drawFlagSprite(ctx, cp, cx, cy, world.tick);
    }
    for (const wp of world.warpPortals) {
      const wx = sx(wp.x);
      const wy = sy(wp.y);
      if (!inView(wx, wy)) continue;
      drawWarpSprite(ctx, wp, wx, wy, world.tick);
    }
    for (const tw of world.watchtowers) {
      const tx = sx(tw.x);
      const ty = sy(tw.y);
      if (!inView(tx, ty, 200)) continue;
      drawTowerSprite(ctx, tw, tx, ty, world.tick);
    }
    for (const pack of world.ammoPacks) {
      const px = sx(pack.x);
      const py = sy(pack.y);
      if (!inView(px, py)) continue;
      drawAmmoSprite(ctx, pack, px, py, world.tick);
    }
    for (const crate of world.supplyCrates) {
      if (!crate.active) continue;
      const cx = sx(crate.x);
      const cy = sy(crate.y);
      if (!inView(cx, cy)) continue;
      drawCrateSprite(ctx, crate, cx, cy, world.tick);
    }
    for (const m of world.mortars) {
      const mx = sx(m.x);
      const my = sy(m.y);
      if (!inView(mx, my)) continue;
      drawMortarSprite(ctx, m, mx, my, world.tick);
    }
    for (const m of world.landmines) {
      if (m.respawnTimer > 0) continue;
      const mx = sx(m.pos.x);
      const my = sy(m.pos.y);
      if (!inView(mx, my)) continue;
      drawMineSprite(ctx, m, mx, my, world.tick, world.config.mineTriggerRadius);
    }
    for (const p of world.players) {
      if (p.respawnTimer > 0 || !p.deployed) continue;
      const pWep = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
      const pMounted = world.mortars.some((m) => m.operatorId === p.id);
      if (p.doll) {
        const dx = sx(p.doll.pos.x);
        const dy = sy(p.doll.pos.y);
        if (inView(dx, dy)) {
          ctx.save();
          ctx.translate(dx, dy);
          ctx.globalAlpha = 0.62;
          ctx.strokeStyle = "#f472b6";
          ctx.fillStyle = "rgba(244, 114, 182, 0.22)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-11, -12, 22, 28, 6);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -24, world.config.headRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#f472b6";
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`\u{1F38E} ${p.doll.timer.toFixed(1)}s`, 0, -44);
          ctx.restore();
        }
      }
      const px = sx(p.pos.x);
      const py = sy(p.pos.y);
      if (!inView(px, py)) continue;
      drawPlayerSprite(ctx, p, px, py, {
        tick: world.tick,
        isLocal: p.id === localPlayer.id,
        movingX: p.vel.x,
        floating: p.jetpack,
        mounted: pMounted
      });
      drawPlayerTag(ctx, p, px, py, p.id === localPlayer.id);
      if (p.reloading) {
        ctx.save();
        const barW = 42;
        const barH = 4;
        const bx = px - barW / 2;
        const by = py - 60;
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.beginPath();
        ctx.roundRect(bx - 1, by - 1, barW + 2, barH + 2, 2.5);
        ctx.fill();
        if (pWep.shellReload) {
          const curShells = Math.max(0, Math.floor(p.ammo[p.weaponIndex] ?? 0));
          const perShell = pWep.reloadTime / Math.max(1, pWep.magSize);
          const curShellPct = p.fireCooldown > 0 ? 0 : clamp(1 - p.reloadTimer / Math.max(1e-6, perShell), 0, 1);
          const segW = (barW - (pWep.magSize - 1) * 1.2) / pWep.magSize;
          for (let sIdx = 0; sIdx < pWep.magSize; sIdx++) {
            const segX = bx + sIdx * (segW + 1.2);
            ctx.fillStyle = sIdx < curShells ? "#fbbf24" : "rgba(51, 65, 85, 0.85)";
            ctx.fillRect(segX, by, segW, barH);
            if (sIdx === curShells && curShellPct > 0) {
              ctx.fillStyle = "#38bdf8";
              ctx.fillRect(segX, by, segW * curShellPct, barH);
            }
          }
        } else {
          const pct = clamp(1 - p.reloadTimer / Math.max(1e-6, pWep.reloadTime), 0, 1);
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.roundRect(bx, by, Math.max(2, barW * pct), barH, 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if ((p.teleportTimer ?? 0) > 0 && p.teleportTarget) {
        const castTotal = Math.max(0.1, world.config.teleportCastTime ?? 0.75);
        const pct = clamp(1 - p.teleportTimer / castTotal, 0, 1);
        const tx = sx(p.teleportTarget.x);
        const ty = sy(p.teleportTarget.y);
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(192, 132, 252, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py - 14);
        ctx.lineTo(tx, ty - 14);
        ctx.stroke();
        ctx.setLineDash([]);
        if (inView(tx, ty, 80)) {
          const pulse = 18 + Math.sin(world.tick * 0.35) * 4;
          ctx.strokeStyle = "#c084fc";
          ctx.fillStyle = "rgba(192, 132, 252, 0.18)";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(tx, ty - 12, pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = "#38bdf8";
          ctx.beginPath();
          ctx.arc(tx, ty - 12, pulse * (1 - pct * 0.65), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "#e9d5ff";
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("\u{1F300} \u4F20\u9001\u843D\u70B9", tx, ty - 36);
        }
        const barW = 58;
        const barH = 6;
        const bx = px - barW / 2;
        const by = py - 72;
        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(bx, by, barW, barH, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.roundRect(bx + 1, by + 1, Math.max(2, (barW - 2) * pct), barH - 2, 2);
        ctx.fill();
        ctx.fillStyle = "#f3e8ff";
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`\u{1F300} \u8BFB\u6761 ${Math.round(pct * 100)}%`, px, by - 4);
        ctx.restore();
      }
    }
    const mountedNow = world.mortars.find((m) => m.operatorId === localPlayer.id);
    if (mountedNow) {
      const mx = sx(mountedNow.x);
      const my = sy(mountedNow.y);
      const aimLen = 420;
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = "rgba(251, 146, 60, 0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(mountedNow.angle) * 30, my - 18 + Math.sin(mountedNow.angle) * 30);
      ctx.lineTo(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(251, 146, 60, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    {
      const mx = sx(mouse.worldX);
      const my = sy(mouse.worldY);
      if (mx > -halfW && mx < halfW && my > -halfH && my < halfH) {
        ctx.save();
        ctx.strokeStyle = mountedNow ? "rgba(251, 146, 60, 0.95)" : "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx - 9, my);
        ctx.lineTo(mx - 3, my);
        ctx.moveTo(mx + 3, my);
        ctx.lineTo(mx + 9, my);
        ctx.moveTo(mx, my - 9);
        ctx.lineTo(mx, my - 3);
        ctx.moveTo(mx, my + 3);
        ctx.lineTo(mx, my + 9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.stroke();
        const wepNow = WEAPONS[localPlayer.weaponIndex];
        const chargeNeed = wepNow?.chargeSeconds ?? 0;
        if (chargeNeed > 0 && localPlayer.chargeTimer > 0) {
          const t = Math.min(1, localPlayer.chargeTimer / chargeNeed);
          ctx.strokeStyle = `rgba(253, 224, 71, ${0.5 + 0.5 * t})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(mx, my, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
          ctx.stroke();
          if (t >= 1) {
            ctx.fillStyle = "rgba(253,224,71,0.9)";
            ctx.beginPath();
            ctx.arc(mx, my, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (localPlayer.reloading && wepNow) {
          const ringR = 15;
          ctx.strokeStyle = "rgba(15, 23, 42, 0.65)";
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.arc(mx, my, ringR, 0, Math.PI * 2);
          ctx.stroke();
          if (wepNow.shellReload) {
            const perShell = wepNow.reloadTime / Math.max(1, wepNow.magSize);
            const shellPct = localPlayer.fireCooldown > 0 ? 0 : clamp(1 - localPlayer.reloadTimer / Math.max(1e-6, perShell), 0, 1);
            const curAmmo = Math.max(0, Math.floor(localPlayer.ammo[localPlayer.weaponIndex] ?? 0));
            const totalPct = clamp((curAmmo + shellPct) / Math.max(1, wepNow.magSize), 0, 1);
            ctx.strokeStyle = "#fbbf24";
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.arc(mx, my, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * totalPct);
            ctx.stroke();
          } else {
            const pct = clamp(1 - localPlayer.reloadTimer / Math.max(1e-6, wepNow.reloadTime), 0, 1);
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.arc(mx, my, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    if (!localPlayer.mountedTowerId) {
      for (const sz of world.terrain.shadows) {
        const cx0 = sx(sz.x + sz.w / 2);
        const cy0 = sy(sz.y + sz.h / 2);
        for (const ox of [-WORLD_W, 0, WORLD_W]) {
          for (const oy of [-WORLD_H, 0, WORLD_H]) {
            const cx = cx0 + ox;
            const cy = cy0 + oy;
            if (!inView(cx, cy, Math.max(sz.w, sz.h))) continue;
            const inside = localPlayer.deployed && Math.abs(wrapDeltaX(localPlayer.pos.x, sz.x + sz.w / 2)) <= sz.w / 2 + 40 && Math.abs(wrapDeltaY(localPlayer.pos.y, sz.y + sz.h / 2)) <= sz.h / 2 + 40;
            ctx.fillStyle = inside ? "rgba(2, 6, 23, 0.22)" : `rgba(2, 6, 23, ${sz.alpha ?? 0.74})`;
            ctx.fillRect(cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h);
          }
        }
      }
    }
    for (const r of world.terrain.rects) {
      if (!r.kind.startsWith("deco_")) continue;
      const cx0 = sx(r.x + r.w / 2);
      const cy0 = sy(r.y + r.h / 2);
      for (const ox of [-WORLD_W, 0, WORLD_W]) {
        for (const oy of [-WORLD_H, 0, WORLD_H]) {
          const cx = cx0 + ox;
          const cy = cy0 + oy;
          if (!inView(cx, cy, Math.max(r.w, r.h) + 40)) continue;
          drawDeco(ctx, r, cx, cy, world.tick);
        }
      }
    }
    for (const g of world.grenades) {
      const gx = sx(g.pos.x);
      const gy = sy(g.pos.y);
      if (!inView(gx, gy)) continue;
      drawGrenadeSprite(ctx, g, gx, gy, world.tick);
    }
    for (const pr of world.projectiles) {
      const px = sx(pr.pos.x);
      const py = sy(pr.pos.y);
      if (!inView(px, py, 200)) continue;
      drawProjectileSprite(ctx, pr, px, py, world.tick);
    }
    for (const st of world.airstrikes) {
      const ax = sx(st.pos.x);
      const ay = sy(st.pos.y);
      if (!inView(ax, ay, 60)) continue;
      drawAirstrikeSprite(ctx, st, ax, ay, world.tick);
    }
    for (const b of beams) {
      const alpha = Math.max(0, b.life / b.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round";
      const polys = expandBeamSegments(b.segments, (wx, wy) => ({ x: sx(wx), y: sy(wy) }), halfW, halfH);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 9;
      ctx.globalAlpha = alpha * 0.35;
      for (const pl of polys) {
        ctx.beginPath();
        ctx.moveTo(pl.x1, pl.y1);
        ctx.lineTo(pl.x2, pl.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      for (const pl of polys) {
        ctx.beginPath();
        ctx.moveTo(pl.x1, pl.y1);
        ctx.lineTo(pl.x2, pl.y2);
        ctx.stroke();
      }
      ctx.restore();
    }
    effects.render(ctx, (x, y) => ({ x: sx(x), y: sy(y) }), (x, y) => inView(x, y));
    ctx.restore();
  }

  // src/web/game/loop.ts
  var playerInput = defaultWorldInput();
  var prevFireCooldown = 0;
  var wasDead = false;
  var lastFrame = performance.now();
  var acc = 0;
  function buildLocalInput() {
    const w = defaultWorldInput();
    const k = keys;
    let move = 0;
    if (k["KeyA"] || k["ArrowLeft"]) move = move - 1;
    if (k["KeyD"] || k["ArrowRight"]) move = move + 1;
    if (touchState.moveActive && Math.abs(touchState.moveX) > 0.22) move = touchState.moveX > 0 ? 1 : -1;
    w.move = move;
    w.jump = false;
    w.jetpack = Boolean(k["KeyW"] || k["Space"] || k["ArrowUp"] || touchState.boostButtonDown || touchState.moveActive && touchState.moveY < -0.35);
    w.dive = Boolean(k["KeyS"] || k["ArrowDown"] || touchState.moveActive && touchState.moveY > 0.45);
    const zoom = 1 / camera.fovFactor;
    const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom;
    const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom;
    mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) / zoom);
    mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) / zoom);
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    if (mounted) {
      const msx = canvas.width / 2 + wrapDeltaX(camera.x, mounted.x) * zoom;
      const msy = canvas.height / 2 + wrapDeltaY(camera.y, mounted.y - 18) * zoom;
      let a = Math.atan2(mouse.y - msy, mouse.x - msx);
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12;
      w.aim = a;
    } else if (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.15) {
      w.aim = Math.atan2(touchState.aimY, touchState.aimX);
    } else {
      w.aim = Math.atan2(mouse.y - (psy - 12 * zoom), mouse.x - psx);
    }
    w.fire = mouse.down || touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.45;
    w.interact = inputQueue.interact;
    w.reload = inputQueue.reload;
    if (inputQueue.secondary) w.secondary = { type: inputQueue.secondary.type, targetX: inputQueue.secondary.targetX, targetY: inputQueue.secondary.targetY };
    return w;
  }
  function onLocalDeath() {
    const cur = WEAPONS[localPlayer.weaponIndex];
    const lastIdx = localPlayer.lastPrimaryIndex ?? localPlayer.weaponIndex;
    const last = WEAPONS[lastIdx];
    pendingLoadout.weaponIndex = cur && !cur.isSupplyOnly ? localPlayer.weaponIndex : last && !last.isSupplyOnly ? lastIdx : 0;
    const streak = localPlayer.deathStreak ?? 0;
    const highestSec = getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0);
    pendingLoadout.secondaryType = highestSec;
    localPlayer.secondary = highestSec;
    updateHudWeaponButtons();
    renderDeathStats();
    const ds = document.getElementById("deathScreen");
    if (ds) {
      ds.classList.remove("hidden");
      ds.classList.add("flex");
    }
    const secDef = SECONDARIES[highestSec] ?? SECONDARIES.frag;
    if (streak > 0 && secDef.unlockStreak > 0) {
      showToast(`\u{1F480} \u8FDE\u6B7B ${streak} \u6B21\uFF1A\u526F\u624B\u5DF2\u89E3\u9501\u5E76\u9884\u9009\u3010${secDef.icon} ${secDef.name}\u3011`);
    } else {
      showToast("\u{1F480} \u5DF2\u9635\u4EA1\uFF1A\u67E5\u770B KD \u6218\u62A5\u5E76\u9009\u62E9\u91CD\u751F\u914D\u88C5");
    }
  }
  function onLocalRespawn() {
    const wantW = Number(pendingLoadout.weaponIndex);
    const next = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0;
    localPlayer.weaponIndex = next;
    localPlayer.lastPrimaryIndex = next;
    const streak = localPlayer.deathStreak ?? 0;
    const wantSec = pendingLoadout.secondaryType;
    const validSec = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0) ? wantSec : getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0);
    localPlayer.secondary = validSec;
    if (validSec === "doll" && streak >= SECONDARIES.doll.unlockStreak && localPlayer.dollCharges <= 0) {
      localPlayer.dollCharges = 1;
    }
    updateHudWeaponButtons();
    showToast(world.config.randomSpawn ? "\u{1F504} \u5DF2\u5728\u968F\u673A\u5B89\u5168\u70B9\u91CD\u751F" : "\u{1F504} \u5DF2\u5728\u961F\u4F0D\u57FA\u5730\u91CD\u751F");
  }
  function startGameLoop() {
    lastFrame = performance.now();
    requestAnimationFrame(function gameLoop(now) {
      const dt = Math.min(0.05, (now - lastFrame) / 1e3);
      lastFrame = now;
      acc += dt;
      let guard = 0;
      while (acc >= FIXED && guard < 5) {
        playerInput = buildLocalInput();
        inputQueue.interact = false;
        inputQueue.reload = false;
        inputQueue.secondary = null;
        const inputs = /* @__PURE__ */ new Map([[localPlayer.id, playerInput]]);
        for (const b of bots) inputs.set(b.id, botInput(b));
        const handledAsClient = stepNetworkFrame(FIXED, playerInput, inputs);
        if (!handledAsClient) {
          world.step(FIXED, inputs);
          const evs = world.drainEvents();
          handleEvents(evs);
          if (netState.role === "host") broadcastHostKcpSnapshot(evs);
        }
        const dead = localPlayer.respawnTimer > 0;
        if (dead && !wasDead) onLocalDeath();
        if (!dead && wasDead) {
          const ds = document.getElementById("deathScreen");
          if (ds) ds.classList.add("hidden");
          onLocalRespawn();
        }
        wasDead = dead;
        if (dead) {
          const cd = document.getElementById("deathCountdown");
          if (cd) cd.textContent = Math.max(0, localPlayer.respawnTimer).toFixed(1);
          const respBar = document.getElementById("deathRespawnProgressBar");
          if (respBar) {
            const totalDelay = Math.max(0.1, world.config.respawnDelay ?? 4);
            const pct = clamp((1 - localPlayer.respawnTimer / totalDelay) * 100, 0, 100);
            respBar.style.width = `${pct}%`;
          }
          const streakPill = document.getElementById("deathStreakPill");
          if (streakPill) {
            streakPill.textContent = `\u8FDE\u6B7B ${localPlayer.deathStreak ?? 0}`;
          }
          const kl = document.getElementById("deathKillerLine");
          if (kl) kl.textContent = death.info ? `\u88AB ${death.info.killer} \u4F7F\u7528\u3010${death.info.weapon}\u3011\u51FB\u5012` : "\u5DF2\u88AB\u51FB\u5012 \xB7 \u67E5\u770B\u5B9E\u65F6 KD \u6218\u62A5\u5E76\u9009\u62E9\u91CD\u751F\u914D\u88C5";
          renderDeathStats();
        }
        for (const p of world.players) {
          if (p.deployed && p.respawnTimer <= 0 && p.jetpack) {
            effects.jet(p.pos.x, p.pos.y);
          }
        }
        if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
          effects.muzzle(
            wrapX(localPlayer.pos.x + Math.cos(localPlayer.aim) * 26),
            localPlayer.pos.y - 12 + Math.sin(localPlayer.aim) * 26,
            WEAPONS[localPlayer.weaponIndex]?.color ?? "#fde047"
          );
        }
        prevFireCooldown = localPlayer.fireCooldown;
        effects.update(FIXED);
        for (let i = beams.length - 1; i >= 0; i--) {
          beams[i].life -= FIXED;
          if (beams[i].life <= 0) beams.splice(i, 1);
        }
        acc -= FIXED;
        guard++;
      }
      renderScene();
      updateHudUI();
      updateScoreboardUI();
      requestAnimationFrame(gameLoop);
    });
  }
  function renderDeathStats() {
    const me = localPlayer;
    const kills = me.kills ?? 0;
    const deaths = me.deaths ?? 0;
    const ratio = deaths === 0 ? kills : kills / deaths;
    const kEl = document.getElementById("deathKdKills");
    const dEl = document.getElementById("deathKdDeaths");
    const rEl = document.getElementById("deathKdRatio");
    if (kEl) kEl.textContent = String(kills);
    if (dEl) dEl.textContent = String(deaths);
    if (rEl) rEl.textContent = ratio.toFixed(2);
    const ranked = [...world.players].filter((p) => p.deployed || p.id === me.id).sort((a, b) => {
      const ka = a.kills ?? 0, kb = b.kills ?? 0;
      if (kb !== ka) return kb - ka;
      const da = a.deaths ?? 0, db = b.deaths ?? 0;
      if (da !== db) return da - db;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    const list = document.getElementById("deathRankList");
    if (list) {
      const top = ranked.slice(0, 10);
      const myRank = ranked.findIndex((p) => p.id === me.id) + 1;
      const maxKills = Math.max(1, ...ranked.map((p) => p.kills ?? 0));
      list.innerHTML = top.map((p, i) => {
        const isMe = p.id === me.id;
        const k = p.kills ?? 0;
        const d = p.deaths ?? 0;
        const kd = d === 0 ? k.toFixed(2) : (k / d).toFixed(2);
        const pct = Math.max(4, Math.round(k / maxKills * 100));
        const teamColor = p.team === "red" ? "text-rose-300" : p.team === "blue" ? "text-sky-300" : p.team === "green" ? "text-emerald-300" : "text-amber-200";
        const aliveDot = p.respawnTimer > 0 || !p.alive ? "\u{1F480}" : "\u{1F7E2}";
        return `
        <li class="relative flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${isMe ? "bg-sky-500/20 ring-1 ring-sky-400/50" : "bg-slate-900/60"}">
          <span class="absolute inset-y-0 left-0 rounded-lg bg-sky-400/10" style="width:${pct}%"></span>
          <span class="relative w-4 text-right font-mono font-bold text-slate-400 tabular-nums">${i + 1}</span>
          <span class="relative text-[9px]">${aliveDot}</span>
          <span class="relative flex-1 truncate font-bold ${teamColor}">${escapeHudText(p.name ?? "?")}${isMe ? " (\u4F60)" : ""}</span>
          <span class="relative w-6 text-right font-mono font-bold text-emerald-300 tabular-nums">${k}</span>
          <span class="relative w-6 text-right font-mono text-rose-300 tabular-nums">${d}</span>
          <span class="relative w-9 text-right font-mono font-bold text-amber-300 tabular-nums">${kd}</span>
        </li>`;
      }).join("");
      const selfLine = document.getElementById("deathRankSelfLine");
      const selfBar = document.getElementById("deathRankSelfBar");
      if (selfLine) selfLine.textContent = myRank > 0 ? `\u4F60\u7684\u6392\u540D\uFF1A#${myRank} / ${ranked.length} \xB7 \u5F53\u524D K/D ${ratio.toFixed(2)}` : "\u4F60\u7684\u6392\u540D \u2014";
      if (selfBar) selfBar.style.width = ranked.length > 0 ? `${Math.max(6, Math.round((ranked.length - myRank + 1) / ranked.length * 100))}%` : "0%";
    }
  }
  function escapeHudText(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  }

  // src/web/main-web.ts
  bindAllEvents();
  autoDetectDeviceInput();
  localPlayer.team = "ffa";
  syncBotsCount(4);
  updateHudWeaponButtons();
  updateSpawnPointButtonsUI();
  updateTeamCountUI();
  syncParamsToUI();
  startGameLoop();
  window.__dbg = {
    world,
    get player() {
      return localPlayer;
    },
    get bots() {
      return bots;
    },
    get camera() {
      return camera;
    },
    get pendingLoadout() {
      return pendingLoadout;
    },
    syncBotsCount,
    applyPendingLoadoutAndSpawn,
    render: () => {
      renderScene();
      updateHudUI();
      updateScoreboardUI();
      updateHudWeaponButtons();
    },
    get touch() {
      return touchState;
    },
    botTargets: () => bots.map((b) => ({ bot: b.name, team: b.team, target: pickBotTarget(b)?.name ?? null, targetTeam: pickBotTarget(b)?.team ?? null })),
    get beams() {
      return beams;
    },
    get mode() {
      return mode.current;
    },
    weapons: () => WEAPONS.map((w) => ({ id: w.id, name: w.name, damage: w.damage, fireDelay: w.fireDelay, moveSpeedMult: w.moveSpeedMult }))
  };
  window.__tune = {
    set: (p) => setPhysicsParams(p),
    get: () => getPhysicsParams(),
    reset: () => resetPhysicsParams()
  };
  (function loadSavedParams() {
    try {
      if (localStorage.getItem("pvp-balance-overrides-v1")) return;
      const raw = localStorage.getItem("pvp-physics-params-v2");
      if (raw) setPhysicsParams(JSON.parse(raw));
    } catch {
    }
  })();
})();
