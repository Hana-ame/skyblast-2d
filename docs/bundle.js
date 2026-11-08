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
      // 伤害=手枪弹；每颗弹丸独立擦边分级（24→20）
      speed: 1e3,
      recoil: 1560,
      magSize: 8,
      maxReserve: 72,
      // 后坐力 ×2
      reloadTime: 1.5,
      fireDelay: 0.58,
      terrainRadius: 12,
      // 射速略微提升（0.72 -> 0.58s）
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
      damage: 100,
      headshotMult: 2.5,
      pellets: 1,
      spread: 3e-3,
      speed: 4e3,
      recoil: 390,
      magSize: 3,
      maxReserve: 15,
      reloadTime: 2.8,
      fireDelay: 0.95,
      chargeSeconds: 0.6,
      terrainRadius: 16,
      explosive: false,
      laser: true,
      pierceOnHeadshot: true,
      lifeSeconds: 999,
      moveSpeedMult: 0.6,
      fuelMult: 0.6,
      fovMult: 1.3,
      color: "#c084fc",
      edgeDamage: 99,
      // 狙击特例：命中身体主体 100（一击必杀）；只有打中碰撞箱边缘才 99（留 1 血）。不做连续分级。
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
      moveSpeedMult: 0.7,
      fuelMult: 0.7,
      ascendMult: 0.7,
      fovMult: 1,
      color: "#fb7185",
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
      reloadTime: 2.2,
      fireDelay: 0.05,
      terrainRadius: 8,
      // 射速极高
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
    const off = Math.max(offY, offX);
    const centered = 1 - off * 0.5;
    const raw = fullness * 0.7 + centered * 0.3;
    let q;
    if (raw <= 0.6) q = raw / 0.6 * 0.3;
    else if (raw <= 0.9) q = 0.3 + (raw - 0.6) / 0.3 * 0.2;
    else q = 0.5 + (raw - 0.9) / 0.1 * 0.5;
    return Math.max(0, Math.min(1, q));
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
    if (isHead || bx <= 14 + shieldPad && by >= -12 - shieldPad && by <= 18 + shieldPad) {
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
      const bodyHalfX = 13 + pr.r;
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
            const hitBodyBox = dxBody <= tBodyHalfX && dyBody >= -12 - shieldPad && dyBody <= 18 + shieldPad;
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
                  if (wep.edgeDamage !== void 0) dmg = Math.min(dmg, wep.edgeDamage);
                } else if (wep?.edgeDamage !== void 0 && isProjectileBodyEdgeHit(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)) {
                  dmg = Math.min(dmg, wep.edgeDamage);
                } else if (wep?.farRange && pr.weaponId === 2) {
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
          ctx2.events.push({ kind: "supply_pickup", playerId: p.id, weaponName: crate.weaponName, x: crate.x, y: crate.y });
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
      p.reloadTimer = wep.reloadTime;
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
      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          p.reloading = false;
          const wep = WEAPONS[p.weaponIndex];
          const needed = wep.magSize - p.ammo[p.weaponIndex];
          const avail = p.reserveAmmo[p.weaponIndex] || 0;
          const transfer = Math.min(needed, avail);
          p.ammo[p.weaponIndex] += transfer;
          p.reserveAmmo[p.weaponIndex] = avail - transfer;
        }
      }
      if (w.reload) this.startReload(p);
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
        if (w.fire) {
          if (p.chargeTimer <= 0) p.chargeAim = p.aim;
          p.chargeTimer = Math.max(p.chargeTimer, 1e-4);
        }
        if (p.chargeTimer > 0) {
          p.chargeTimer += dt;
          if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
            this.fire(p);
            p.chargeTimer = 0;
            p.chargeAim = void 0;
          } else if (!w.fire) {
            p.chargeTimer = 0;
            p.chargeAim = void 0;
          }
        }
      } else if (w.fire) {
        this.fire(p);
      }
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
      if (p.reloading || p.fireCooldown > 0) return;
      if (p.ammo[p.weaponIndex] <= 0) {
        if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p);
        return;
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
    const fovBadge = document.getElementById("hudSniperFovBadge");
    if (fovBadge) {
      const wepForFov = WEAPONS[localPlayer.weaponIndex];
      if (localPlayer.mountedTowerId) {
        fovBadge.textContent = "\u{1F5FC} \u77AD\u671B\u89C6\u91CE 200%\uFF08\u6309 E \u4E0B\u5854\uFF09";
        fovBadge.classList.remove("hidden");
      } else if ((wepForFov?.fovMult ?? 1) > 1.01) {
        const charge = (wepForFov?.chargeSeconds ?? 0) > 0 ? localPlayer.chargeTimer > 0 ? ` \xB7 \u84C4\u529B ${Math.min(100, Math.round(localPlayer.chargeTimer / (wepForFov?.chargeSeconds ?? 1) * 100))}%` : " \xB7 \u6309\u4F4F\u84C4\u529B" : "";
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
    if (wNameEl) wNameEl.textContent = mounted ? "\u{1F3AF} \u516C\u5171\u8FEB\u51FB\u70AE\u64CD\u63A7\u4E2D" : `${wep.name} ${localPlayer.deployed ? "\u{1F512}" : ""}`;
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
    const ammoEl = document.getElementById("currentAmmoText");
    if (ammoEl) ammoEl.textContent = mounted ? "\u221E" : `${Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))} / ${localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0}`;
    const gOverlay = document.getElementById("grenadeCdOverlay");
    const gLabel = document.getElementById("hudGrenadeLabel");
    const gTitle = document.getElementById("hudSecondaryTitle");
    if (gTitle) {
      if (localPlayer.secondary === "doll") {
        gTitle.textContent = `[G/\u53F3\u952E] \u66FF\u8EAB\u4EBA\u5076 [\u5145\u80FD${localPlayer.dollCharges}]`;
      } else if (localPlayer.secondary === "frag") {
        gTitle.textContent = `[G/\u53F3\u952E] \u624B\u69B4\u5F39 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`;
      } else {
        gTitle.textContent = `[G/\u53F3\u952E] ${secDef.name}`;
      }
    }
    if (gOverlay && gLabel) {
      if (localPlayer.secondary === "doll") {
        gOverlay.style.height = localPlayer.dollCharges > 0 ? "0%" : "100%";
        gLabel.textContent = localPlayer.dollCharges > 0 ? "\u{1F38E} \u5C31\u7EEA" : "\u{1F38E} \u65E0\u5145\u80FD";
      } else if (localPlayer.secondary === "frag") {
        const need = localPlayer.fragCharges >= world.config.fragMaxCharges;
        if (need) {
          gOverlay.style.height = "0%";
          gLabel.textContent = "\u{1F4A3} \u5C31\u7EEA";
        } else {
          const pct = Math.min(100, localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds * 100);
          gOverlay.style.height = pct + "%";
          gLabel.textContent = `\u{1F4A3} ${localPlayer.fragCharges}/${world.config.fragMaxCharges} \u56DE\u590D\u4E2D`;
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
    if (reloadWrap && reloadBar) {
      if (localPlayer.reloading) {
        reloadWrap.classList.remove("hidden");
        reloadWrap.classList.add("flex");
        const wep2 = WEAPONS[localPlayer.weaponIndex];
        reloadBar.style.width = clamp(100 * (1 - localPlayer.reloadTimer / wep2.reloadTime), 0, 100) + "%";
      } else {
        reloadWrap.classList.add("hidden");
        reloadWrap.classList.remove("flex");
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
        document.querySelectorAll(".bot-count-btn").forEach((b) => {
          b.className = Number(b.getAttribute("data-bots")) === cnt ? "bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs" : "bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700";
        });
      });
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
  }

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
        showToast(`\u{1F4E6} \u62FE\u53D6\u3010${e.weaponName}\u3011`);
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
      const w = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
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
        ctx.strokeStyle = mountedNow ? "rgba(251, 146, 60, 0.95)" : "rgba(255, 255, 255, 0.8)";
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
    const ds = document.getElementById("deathScreen");
    if (ds) ds.classList.remove("hidden");
    const secDef = SECONDARIES[highestSec] ?? SECONDARIES.frag;
    if (streak > 0 && secDef.unlockStreak > 0) {
      showToast(`\u{1F480} \u8FDE\u6B7B ${streak} \u6B21\uFF1A\u526F\u624B\u5DF2\u89E3\u9501\u5E76\u9884\u9009\u3010${secDef.icon} ${secDef.name}\u3011`);
    } else {
      showToast("\u{1F480} \u5DF2\u9635\u4EA1\uFF1A\u5728\u6B7B\u4EA1\u754C\u9762\u9009\u62E9\u91CD\u751F\u914D\u88C5");
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
        world.step(FIXED, inputs);
        handleEvents(world.drainEvents());
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
          const kl = document.getElementById("deathKillerLine");
          if (kl) kl.textContent = death.info ? `\u88AB ${death.info.killer} \u4F7F\u7528\u3010${death.info.weapon}\u3011\u51FB\u5012` : "\u5DF2\u88AB\u51FB\u5012 \xB7 \u8BF7\u9009\u62E9\u91CD\u751F\u914D\u88C5";
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
