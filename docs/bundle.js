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
    v.y = Math.max(-P.jetpackMaxUp * ascendMult, v.y - P.jetpackAccel * ascendMult / P.mass * dt);
  }
  function updateJetpackFuel(fuel, active, onGround, dt, maxFuel = P.jetpackFuel) {
    const next = active ? fuel - P.jetpackDrain * dt : onGround ? fuel + P.jetpackRecharge * dt : fuel;
    return Math.min(maxFuel, Math.max(0, next));
  }
  var RECOIL_SCALE = 0.56;
  function recoilDelta(recoil, aim) {
    return { x: -Math.cos(aim) * recoil * RECOIL_SCALE, y: -Math.sin(aim) * recoil * RECOIL_SCALE };
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
      // 伤害=手枪弹
      speed: 1e3,
      recoil: 1560,
      magSize: 8,
      maxReserve: 72,
      // 后坐力 ×2
      reloadTime: 1.5,
      fireDelay: 0.72,
      terrainRadius: 12,
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 1.08,
      fuelMult: 1.05,
      fovMult: 1,
      color: "#fbbf24",
      falloffStart: 200,
      falloffEnd: 700,
      falloffMin: 0.45
      // 霰弹随距离衰减（中距仍可用）
    },
    {
      id: 1,
      name: "\u7A81\u51FB\u6B65\u67AA",
      shortName: "\u7A81\u51FB\u6B65\u67AA",
      isSupplyOnly: false,
      damage: 33,
      headshotMult: 2.2,
      pellets: 1,
      spread: 0.045,
      speed: 1500,
      recoil: 84,
      magSize: 28,
      maxReserve: 140,
      reloadTime: 1.7,
      fireDelay: 0.12,
      terrainRadius: 8,
      // 伤害 46（用户要求 ×2），射速保持原值
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 1,
      fuelMult: 1,
      fovMult: 1,
      color: "#38bdf8"
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
      farRange: 800,
      farDamage: 99
      // 超过视距的非爆头命中只造成 99（留 1 血）
    },
    {
      id: 3,
      name: "\u706B\u7BAD\u7B52",
      shortName: "\u706B\u7BAD\u7B52",
      isSupplyOnly: false,
      damage: 115,
      headshotMult: 1.5,
      pellets: 1,
      spread: 0,
      speed: 520,
      recoil: 420,
      magSize: 1,
      maxReserve: 20,
      // 1 发/弹匣，共 20 个弹匣；换弹 2s
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
      selfDamage: true
      // 火箭筒：爆炸友伤/自伤
    },
    {
      id: 4,
      name: "\u9AD8\u65AF\u67AA",
      shortName: "\u9AD8\u65AF\u67AA",
      isSupplyOnly: true,
      damage: 50,
      headshotMult: 2,
      pellets: 1,
      spread: 0,
      speed: 3e3,
      recoil: 0,
      magSize: 12,
      maxReserve: 48,
      // 12 / 6每秒 = 连续 2 秒
      reloadTime: 4,
      fireDelay: 0,
      terrainRadius: 18,
      // 换弹时间 ×2
      explosive: false,
      laser: true,
      pierceAll: true,
      pierceOnHeadshot: true,
      bounces: 3,
      beam: true,
      friendlyFire: true,
      selfDamage: true,
      // 高斯：反射光束可打到友军/自己
      damagePerSecond: 180,
      ammoPerSecond: 6,
      moveSpeedMult: 0.95,
      fuelMult: 1,
      fovMult: 1,
      color: "#22d3ee"
      // 伤害下调（240→180）；视野正常
    },
    {
      id: 5,
      name: "M249",
      shortName: "M249",
      isSupplyOnly: true,
      damage: 33,
      headshotMult: 1.8,
      pellets: 1,
      spread: 0.11,
      speed: 1300,
      recoil: 66,
      magSize: 120,
      maxReserve: 240,
      reloadTime: 3,
      fireDelay: 0.06,
      terrainRadius: 8,
      // M249 伤害=突击(33)，高射速补给枪
      explosive: false,
      pierceOnHeadshot: false,
      moveSpeedMult: 0.78,
      fuelMult: 0.7,
      fovMult: 1.3,
      color: "#f97316"
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
      falloffMin: 0.12
      // 射程与霰弹类似（200→700），远端衰减更狠
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
      color: "#fde047"
      // 移速1.5/飞行容量2.0/升空速度1.25
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
      // 伤害 = 手枪；极高射速用大散布/弹匣平衡
      speed: 1e3,
      recoil: 48,
      magSize: 30,
      maxReserve: 150,
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
      color: "#4ade80"
    }
  ];
  function weaponFalloff(wep, dist) {
    const start = wep.falloffStart ?? 0;
    const end = wep.falloffEnd ?? 0;
    const min = wep.falloffMin ?? 1;
    if (end <= start) return 1;
    if (dist <= start) return 1;
    if (dist >= end) return min;
    const t = (dist - start) / (end - start);
    return 1 - (1 - min) * t;
  }
  var SECONDARIES = {
    frag: { id: "frag", name: "\u624B\u69B4\u5F39", icon: "\u{1F4A3}", cd: 0.8 },
    doll: { id: "doll", name: "\u66FF\u8EAB\u4EBA\u5076", icon: "\u{1F38E}", cd: 24, supplyOnly: true }
  };
  var DEFAULT_CONFIG = {
    maxHp: 100,
    headRadius: 13,
    shieldHp: 130,
    shieldDuration: 5,
    dollDuration: 10,
    obstacleDefaultHp: 240,
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
    return { move: 0, jump: false, jetpack: false, dive: false, aim: 0, fire: false, reload: false, secondary: null, interact: false, switchWeapon: null };
  }

  // src/core/sim/world.ts
  var BODY_HALF_W = 10;
  var BODY_TOP = 26;
  var BODY_BOTTOM = 16;
  var CEILING_STAND = 264;
  var GROUND_STAND = 2740;
  var SPAWN_POINTS = [
    { x: 1100, y: GROUND_STAND, team: "red" },
    // 左出生点留地面
    { x: 12100, y: GROUND_STAND, team: "blue" },
    // 右出生点留地面
    // 用户：天花板上方**不准放重生点**（FFA 和 TEAM 都不许）→ green/ffa 出生点也放地面
    { x: 3300, y: GROUND_STAND, team: "green" },
    // 绿出生→地面（西侧平地，空口方块区外）
    { x: 9900, y: GROUND_STAND, team: "ffa" }
    // FFA出生→地面（东侧平地，空口方块区外）
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
    // 全部搬到天花板顶面（y=280 站立面）：跳远道具，与迫击炮/瞭望塔一起上屋顶
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
    // 每 tick 收集，net/ui 层取走（drainEvents）
    config = { ...DEFAULT_CONFIG };
    rng;
    seed;
    tick = 0;
    hits = 0;
    pid = 1;
    prj = 1;
    gren = 1;
    mine = 1;
    air = 1;
    ammo = 1;
    crate = 1;
    spawnIndex = 0;
    ammoSpawnTimer = 0;
    usedAmmoSpots = /* @__PURE__ */ new Set();
    constructor(seed = 12345, map) {
      this.seed = seed;
      this.rng = new Rng(seed);
      this.terrain.build(map?.solids);
      this.resetMatch();
    }
    /** 全场重置（对局开始/地形重置按钮） */
    resetMatch() {
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
      this.usedAmmoSpots.clear();
      for (let i = 0; i < this.config.ammoPackMaxActive; i++) this.spawnAmmoPack();
      this.projectiles = [];
      this.grenades = [];
      this.airstrikes = [];
      this.ammoSpawnTimer = 0;
      this.scores = { red: 0, blue: 0, green: 0, ffa: 0 };
    }
    // ── 玩家管理 ──────────────────────────────────────────────
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
        doll: null,
        dollCharges: 0,
        respawnTimer: 0,
        kills: 0,
        deaths: 0
      };
      this.respawnAt(p, team);
      this.players.push(p);
      return p;
    }
    /** 部署/重生入口（供组合根/UI 调用；随机出生或占点出生统一走 respawnAt） */
    deploy(p) {
      this.respawnAt(p, p.team);
    }
    /** 出生点：按队伍；优先已占领点（占点重生机制） */
    respawnAt(p, team) {
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
      p.doll = null;
      p.dollCharges = 0;
      p.reloading = false;
      p.fireCooldown = 0;
      p.chargeTimer = 0;
      p.secondaryCooldown = 0;
      p.deployed = true;
      p.alive = true;
      p.respawnTimer = 0;
      this.resolvePenetration(p);
      this.ensureFreePosition(p);
    }
    // ── 主 step ──────────────────────────────────────────────
    step(dt, inputs) {
      this.tick++;
      this.events.length = 0;
      for (const p of this.players) {
        const w = inputs.get(p.id) ?? defaultWorldInput();
        this.apply(p, w, dt);
        if (p.deployed) this.physics(p, w, dt);
        if (p.deployed && p.alive) {
          if (this.bodyOverlapsAt(p.pos.x, p.pos.y)) {
            const fixed = this.resolvePenetration(p);
            if (fixed) {
              p.vel.x = 0;
              p.vel.y = 0;
            }
            const n = (this.stuckTicks.get(p.id) ?? 0) + 1;
            this.stuckTicks.set(p.id, n);
            if (n >= 20) {
              this.ensureFreePosition(p);
              this.stuckTicks.set(p.id, 0);
            }
          } else {
            this.stuckTicks.set(p.id, 0);
          }
        }
      }
      this.separatePlayers();
      this.stepProjectiles(dt);
      this.stepGrenades(dt);
      this.stepLandmines(dt);
      this.stepAirstrikes(dt);
      this.stepObstaclesOnly();
      this.stepCapturePoints(dt);
      this.stepMortars(dt);
      this.stepSupplyCrates(dt);
      this.tickAmmoSpawner(dt);
      this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
      this.grenades = this.grenades.filter((g) => g.fuse > 0);
    }
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
    // ── 输入应用（武器/副武器/交互） ────────────────────────────
    apply(p, w, dt) {
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
          p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1));
          p.reloading = false;
          p.fireCooldown = Math.max(p.fireCooldown, 0.3);
        }
      }
      p.aim = w.aim;
      const wepCur = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
      if (p.mountedTowerId) {
        p.vel.x = 0;
        p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1));
      } else {
        p.vel.x = w.move * getPhysicsParams().moveSpeed * (wepCur.moveSpeedMult ?? 1);
      }
      if (w.jump && this.onGround(p)) jump(p.vel);
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
        if (p.doll.timer <= 0) this.recallDoll(p, "doll_recall");
      }
      const mountedNow = this.mortars.find((m) => m.operatorId === p.id);
      if (mountedNow) {
        let a = p.aim;
        if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12;
        mountedNow.angle = a;
      }
      if (w.interact) this.interact(p);
      if (w.secondary) this.useSecondary(p, w.secondary, dt);
      const wepNow = WEAPONS[p.weaponIndex];
      if (wepNow?.beam) {
        if (w.fire) this.updateContinuousBeam(p, wepNow, dt);
        p.chargeTimer = 0;
      } else if ((wepNow?.chargeSeconds ?? 0) > 0) {
        if (w.fire) p.chargeTimer = Math.max(p.chargeTimer, 1e-4);
        if (p.chargeTimer > 0) {
          p.chargeTimer += dt;
          if (p.chargeTimer >= (wepNow?.chargeSeconds ?? 0)) {
            this.fire(p);
            p.chargeTimer = 0;
          }
        }
      } else if (w.fire) {
        this.fire(p);
      }
    }
    // ── 开火 ──────────────────────────────────────────────
    fire(p) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const m = this.mortars.find((mm) => mm.operatorId === p.id);
      if (m) {
        if (m.cooldown <= 0) {
          m.cooldown = this.config.mortarCooldown;
          this.projectiles.push(this.makeProjectile(
            p,
            m.x + Math.cos(m.angle) * 34,
            m.y - 18 + Math.sin(m.angle) * 34,
            Math.cos(m.angle) * m.power * 60,
            Math.sin(m.angle) * m.power * 60,
            { damage: this.config.mortarDamage, headshotMult: 1.5, terrainRadius: this.config.mortarRadius, explosive: true, gravityScale: 0.68, weaponLabel: "\u516C\u5171\u8FEB\u51FB\u70AE", color: "#f97316", r: 7.5, life: 175 / 60 }
          ));
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
        p.vel.x += rk.x;
        p.vel.y += rk.y;
      }
      const mx = wrapX(p.pos.x + Math.cos(p.aim) * 24);
      const my = p.pos.y - 12 + Math.sin(p.aim) * 24;
      for (let i = 0; i < wep.pellets; i++) {
        const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2);
        const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1);
        this.projectiles.push(this.makeProjectile(p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
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
        }));
      }
    }
    /** 距离衰减：按「发射者→命中点」最短环形距离计算武器 falloff 倍率 */
    projectileFalloff(pr, hx, hy) {
      if (pr.weaponId < 0) return 1;
      const wep = WEAPONS[pr.weaponId];
      if (!wep || wep.falloffStart === void 0) return 1;
      const owner = this.players.find((x) => x.id === pr.owner);
      if (!owner) return 1;
      const dist = wrapDist(owner.pos.x, owner.pos.y - 12, hx, hy);
      return weaponFalloff(wep, dist);
    }
    /** 两点之间是否被「原始地形 或 可破坏掩体」挡住（光束视线判定；4px 采样、端点不计） */
    lineBlockedByTerrain(x1, y1, x2, y2) {
      const dx = wrapDeltaX(x1, x2);
      const dy = wrapDeltaY(y1, y2);
      const dist = Math.hypot(dx, dy);
      if (dist <= 1) return false;
      const steps = Math.max(1, Math.ceil(dist / 4));
      for (let k = 1; k < steps; k++) {
        const px = wrapX(x1 + dx * k / steps);
        const py = wrapY(y1 + dy * k / steps);
        if (this.terrain.isSolidAt(px, py)) return true;
        if (this.obstacleAt(px, py)) return true;
      }
      return false;
    }
    /** 把一段光束截断到「最后一个空点」：保证任何被绘制/判定使用的线段都不穿过实体。
     *  反射在墙角/贴墙时可能把端点算到墙体另一侧，这里统一兜底（4px 采样）。 */
    truncateSegmentToFree(x1, y1, x2, y2) {
      const dx = wrapDeltaX(x1, x2);
      const dy = wrapDeltaY(y1, y2);
      const len = Math.hypot(dx, dy);
      if (len <= 1e-6) return { x: x1, y: y1, shortened: false };
      const steps = Math.max(1, Math.ceil(len / 3));
      let lastFree = { x: x1, y: y1 };
      for (let k = 1; k <= steps; k++) {
        const px = wrapX(x1 + dx * k / steps);
        const py = wrapY(y1 + dy * k / steps);
        if (this.terrain.isSolidAt(px, py)) return { ...lastFree, shortened: true };
        lastFree = { x: px, y: py };
      }
      return { x: x2, y: y2, shortened: false };
    }
    /** 持续光束（高斯枪）：按住开火时每 tick 沿准星射线结算（反射 bounces 次），按 DPS 扣血、按 ammoPerSecond 耗弹 */
    updateContinuousBeam(p, wep, dt) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const wi = p.weaponIndex;
      if (p.reloading) return;
      if (p.ammo[wi] <= 0) {
        this.startReload(p);
        return;
      }
      const dps = wep.damagePerSecond ?? wep.damage * 3;
      const aps = wep.ammoPerSecond ?? 4;
      p.ammo[wi] = Math.max(0, p.ammo[wi] - aps * dt);
      if (p.ammo[wi] <= 0 && (p.reserveAmmo[wi] || 0) > 0) this.startReload(p);
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
        if (this.terrain.isSolidAt(cx, cy) || this.obstacleAt(cx, cy)) break;
        x = cx;
        y = cy;
        originOk = true;
      }
      if (!originOk) return;
      const originX = x;
      const originY = y;
      const maxSegLen = 14e3;
      const step = 4;
      const bounces = wep.bounces ?? 0;
      const MAX_TOTAL = 24e3;
      let totalTravelled = 0;
      for (let b = 0; b <= bounces; b++) {
        let travelled = 0;
        let hitWall = false;
        let blockedByObstacle = false;
        const segStartX = x;
        const segStartY = y;
        while (travelled < maxSegLen && totalTravelled < MAX_TOTAL) {
          const nx = wrapX(x + dx * step);
          const ny = wrapY(y + dy * step);
          if (this.terrain.isSolidAt(nx, ny)) {
            hitWall = true;
            const hitX = this.terrain.isSolidAt(nx, y);
            const hitY = this.terrain.isSolidAt(x, ny);
            if (hitX) dx = -dx;
            if (hitY) dy = -dy;
            if (!hitX && !hitY) {
              dx = -dx;
              dy = -dy;
            }
            break;
          }
          const ob = this.obstacleAt(nx, ny);
          if (ob) {
            if (!hitObstacle.has(ob.id)) {
              hitObstacle.add(ob.id);
              this.damageObstacle(ob, dps * dt, void 0);
            }
            x = nx;
            y = ny;
            blockedByObstacle = true;
            break;
          }
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue;
            if (t.id === p.id && b === 0) continue;
            if (t.id === p.id && !wep.selfDamage) continue;
            if (t.id !== p.id && t.team === p.team && p.team !== "ffa" && !wep.friendlyFire) continue;
            const hx = wrapDeltaX(t.pos.x, nx);
            const hy = wrapDeltaY(t.pos.y - 24, ny);
            const isHead = Math.hypot(hx, hy) <= this.config.headRadius + 3;
            const bx = Math.abs(wrapDeltaX(t.pos.x, nx));
            const by = wrapDeltaY(t.pos.y, ny);
            if (isHead || bx <= 14 && by >= -12 && by <= 18) {
              if (this.lineBlockedByTerrain(segStartX, segStartY, t.pos.x, t.pos.y - 12)) continue;
              hitPlayer.add(t.id);
              const mult = isHead ? wep.headshotMult : 1;
              this.damage(t, dps * mult * dt, void 0, isHead, false, p.id, p.team, wep.shortName);
            }
          }
          x = nx;
          y = ny;
          travelled += step;
          totalTravelled += step;
        }
        if (hitWall && this.terrain.isSolidAt(wrapX(x + dx * step), wrapY(y + dy * step))) {
          hitWall = false;
        }
        const seg = { x1: 0, y1: 0, x2: x, y2: y };
        if (segments.length > 0) {
          const prev = segments[segments.length - 1];
          seg.x1 = prev.x2;
          seg.y1 = prev.y2;
        } else {
          seg.x1 = originX;
          seg.y1 = originY;
        }
        const cut = this.truncateSegmentToFree(seg.x1, seg.y1, seg.x2, seg.y2);
        seg.x2 = cut.x;
        seg.y2 = cut.y;
        segments.push(seg);
        if (cut.shortened) break;
        if (blockedByObstacle || !hitWall) break;
      }
      this.events.push({
        kind: "laser",
        x: p.pos.x,
        y: p.pos.y,
        segments,
        duration: 0.06,
        // 每 tick 刷新一次 → 视觉上是连续光束
        color: wep.color,
        playerId: p.id,
        weaponLabel: wep.shortName
      });
    }
    makeProjectile(p, x, y, vx, vy, o) {
      return {
        id: this.prj++,
        owner: p.id,
        pos: { x: wrapX(x), y: wrapY(y) },
        vel: { x: vx, y: vy },
        life: o.life,
        r: o.r,
        damage: o.damage,
        headshotMult: o.headshotMult,
        explosive: o.explosive,
        terrainRadius: o.terrainRadius,
        gravityScale: o.gravityScale ?? 0.04,
        pierceOnHeadshot: !!o.pierceOnHeadshot,
        pierceAll: !!o.pierceAll,
        isGravityOrb: !!o.isGravityOrb,
        bounces: o.bounces ?? 0,
        passWalls: !!o.passWalls,
        beam: !!o.beam,
        rocket: !!o.rocket,
        dragPerSecond: o.dragPerSecond ?? 1,
        weaponId: o.weaponId ?? -1,
        curveRate: o.curveRate ?? 0,
        weaponLabel: o.weaponLabel,
        color: o.color,
        hitTargets: [p.id]
        // 发射者自身永远跳过
      };
    }
    startReload(p) {
      const wep = WEAPONS[p.weaponIndex];
      if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return;
      if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return;
      p.reloading = true;
      p.reloadTimer = wep.reloadTime;
    }
    // ── 副武器（8 种，v2 逻辑移植；全部服务器权威结算） ──────────────
    useSecondary(p, s, _dt) {
      if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return;
      const def = SECONDARIES[s.type];
      if (!def) return;
      const tx = wrapX(s.targetX);
      const ty = s.targetY;
      if (s.type === "frag") {
        if (p.fragCharges <= 0) return;
        p.fragCharges--;
        p.secondaryCooldown = Math.max(p.secondaryCooldown, 0.8);
        const throwSpeed = 760;
        this.grenades.push({
          id: this.gren++,
          owner: p.id,
          pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
          vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
          fuse: this.config.grenadeFuse,
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
          timer: this.config.dollDuration
        };
        this.events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "anchor" });
        return;
      }
    }
    // ── 交互（E 键） ──────────────────────────────────────────
    /** 替身人偶回溯（死亡触发 或 10s 到期触发） */
    recallDoll(p, _ev) {
      if (!p.doll) return;
      const d = p.doll;
      p.doll = null;
      p.pos = { x: wrapX(d.pos.x), y: d.pos.y };
      p.vel = { x: 0, y: 0 };
      p.hp = Math.max(1, d.hp);
      p.shieldHp = d.shieldHp;
      p.fuel = d.fuel;
      p.weaponIndex = d.weaponIndex;
      p.ammo = [...d.ammo];
      p.reserveAmmo = [...d.reserveAmmo];
      p.respawnTimer = 0;
      p.alive = true;
      this.events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id });
    }
    interact(p) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const cur = this.mortars.find((m) => m.operatorId === p.id);
      if (cur) {
        cur.operatorId = null;
        p.vel.y = -270;
        return;
      }
      for (const m of this.mortars) {
        if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
          m.operatorId = p.id;
          p.pos = { x: m.x, y: m.y - 16 };
          p.vel = { x: 0, y: 0 };
          return;
        }
      }
      if (p.mountedTowerId) {
        const tw = this.watchtowers.find((t) => t.id === p.mountedTowerId);
        if (tw) tw.operatorId = null;
        p.mountedTowerId = null;
        p.watchtowerTimer = 0;
        p.vel = { x: 0, y: -160 };
        this.events.push({ kind: "warp", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "\u79BB\u5F00\u77AD\u671B\u5854" });
        return;
      }
      for (const tw of this.watchtowers) {
        if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
          tw.operatorId = p.id;
          p.mountedTowerId = tw.id;
          p.pos = { x: tw.x, y: tw.y - 150 + 12 };
          p.vel = { x: 0, y: 0 };
          p.onGround = false;
          this.events.push({ kind: "warp", x: tw.x, y: tw.y, playerId: p.id, weaponName: `\u767B\u4E0A${tw.name}\uFF08\u89C6\u91CE 200%\uFF09` });
          return;
        }
      }
      for (const wp of this.warpPortals) {
        if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
          const dest = this.warpPortals.find((w) => w.id === wp.targetId);
          if (!dest) continue;
          p.pos = { x: dest.x, y: dest.y - 60 };
          p.vel = { x: 0, y: 0 };
          p.warpCooldown = 2.5;
          this.events.push({ kind: "warp", x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name });
          return;
        }
      }
    }
    // ── 物理 ──────────────────────────────────────────────
    physics(p, w, dt) {
      if (!p.alive || p.respawnTimer > 0) return;
      const m = this.mortars.find((mm) => mm.operatorId === p.id);
      if (m) {
        p.pos = { x: m.x, y: m.y - 16 };
        p.vel = { x: 0, y: 0 };
        return;
      }
      if (p.mountedTowerId) {
        const tw = this.watchtowers.find((t) => t.id === p.mountedTowerId);
        if (tw) {
          p.pos = { x: tw.x, y: tw.y - 150 + 12 };
          p.vel = { x: 0, y: 0 };
          p.onGround = false;
          return;
        }
      }
      applyGravity(p.vel, dt, w.dive ? 1.55 : 1);
      for (const pad of JUMP_PADS) {
        const d = wrapDist(p.pos.x, p.pos.y, pad.x, pad.y);
        if (d < 34 && p.onGround && p.vel.y >= -20) {
          p.vel.x += pad.vx;
          p.vel.y = pad.vy;
          p.onGround = false;
        }
      }
      const hitBody = (x, y) => {
        const wx = wrapX(x);
        if (this.terrain.isSolidAt(wx, y)) return true;
        if (this.obstacleAt(wx, y) !== null) return true;
        return this.playerHitsPoint(wx, y, p.id);
      };
      const pts = (cx, cy) => hitBody(cx - BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx + BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx, cy + BODY_BOTTOM) || hitBody(cx - BODY_HALF_W, cy) || hitBody(cx + BODY_HALF_W, cy) || hitBody(cx, cy - BODY_TOP);
      const nx = wrapX(p.pos.x + p.vel.x * dt);
      if (!pts(nx, p.pos.y)) p.pos.x = nx;
      else if (!pts(nx, p.pos.y - 10)) {
        p.pos.x = nx;
        p.pos.y -= 10;
      } else {
        const blocker = this.playerBlockingAt(nx, p.pos.y, p.id);
        if (blocker) this.tryNudge(blocker, Math.sign(nx - p.pos.x), 1.4);
        p.vel.x = 0;
      }
      const nyRaw = p.pos.y + p.vel.y * dt;
      const ny = wrapY(nyRaw);
      if (!pts(p.pos.x, ny)) {
        p.pos.y = ny;
        p.onGround = false;
      } else {
        p.onGround = p.vel.y > 0;
        p.vel.y = 0;
      }
      p.pos.x = wrapX(p.pos.x);
      p.pos.y = wrapY(p.pos.y);
      this.applyGravityOrbPull(p, dt);
    }
    onGround(p) {
      return !!p.onGround;
    }
    /** 躯干/头是否嵌在实体里（站立在地面上不算——只查躯干以上） */
    torsoBlockedAt(x, y) {
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
        if (this.terrain.isSolidAt(px, py)) return true;
        if (this.obstacleAt(px, py)) return true;
      }
      return false;
    }
    /** 把玩家挪到最近的安全位置（出生/被结构挤压/死角兜底） */
    ensureFreePosition(p) {
      if (!this.torsoBlockedAt(p.pos.x, p.pos.y)) return false;
      for (let r = 24; r <= 320; r += 24) {
        for (let a = 0; a < 16; a++) {
          const ang = a * Math.PI / 8;
          const x = wrapX(p.pos.x + Math.cos(ang) * r);
          const y = wrapY(p.pos.y + Math.sin(ang) * r);
          if (!this.torsoBlockedAt(x, y)) {
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
    // 卡死计数器：身体嵌实体超时自动推出（防窄缝/结构挤压永久卡住）
    stuckTicks = /* @__PURE__ */ new Map();
    /** 身体 AABB（脚底锚点）：宽±10，高 -30..+16 */
    /** 两个玩家身体 AABB 是否相交（宽 20，高 -30..+16，脚底锚点） */
    bodiesOverlap(ax, ay, bx, by) {
      const dx = Math.abs(wrapDeltaX(ax, bx));
      if (dx >= 20) return false;
      return ay + 16 > by - 30 && ay - 30 < by + 16;
    }
    /** 单个点是否落在其他玩家身体 AABB 内（用于 6 采样点碰撞；不能把采样点当整具身体） */
    playerHitsPoint(x, y, selfId) {
      for (const other of this.players) {
        if (other.id === selfId) continue;
        if (!other.deployed || !other.alive || other.respawnTimer > 0) continue;
        if (Math.abs(wrapDeltaX(x, other.pos.x)) > 10) continue;
        if (y > other.pos.y - 30 && y < other.pos.y + 16) return true;
      }
      return false;
    }
    /** 找指定位置与玩家 selfId 身体相交的其他玩家（用于玩家间碰撞） */
    playerBlockingAt(x, y, selfId) {
      for (const other of this.players) {
        if (other.id === selfId) continue;
        if (!other.deployed || !other.alive || other.respawnTimer > 0) continue;
        if (this.bodiesOverlap(x, y, other.pos.x, other.pos.y)) return other;
      }
      return null;
    }
    /** 轻推另一个玩家（"顶着人"：被挡住时把对方朝同方向推一点，仍需避让地形/障碍/其他人） */
    tryNudge(other, dir, amount) {
      if (dir === 0) return;
      const nx = wrapX(other.pos.x + dir * amount);
      if (this.terrain.isSolidAt(nx, other.pos.y - 6)) return;
      if (this.terrain.isSolidAt(nx, other.pos.y + 15)) return;
      if (this.obstacleAt(nx, other.pos.y)) return;
      for (const t of this.players) {
        if (t.id === other.id) continue;
        if (!t.deployed || !t.alive || t.respawnTimer > 0) continue;
        if (this.bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) return;
      }
      other.pos.x = nx;
    }
    bodyOverlapsAt(x, y) {
      const wx = wrapX(x);
      const halfW = 10;
      const gx0 = Math.floor((wx - halfW) / TILE_SIZE);
      const gx1 = Math.floor((wx + halfW) / TILE_SIZE);
      const gy0 = Math.floor(wrapY(y - 30) / TILE_SIZE);
      const gy1 = Math.floor(wrapY(y + 16) / TILE_SIZE);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const cellX = wrapX(gx * TILE_SIZE) + TILE_SIZE / 2;
          const cellY = wrapY(gy * TILE_SIZE) + TILE_SIZE / 2;
          const lx = wrapDeltaX(wx, cellX);
          const ly = wrapDeltaY(y, cellY);
          if (Math.abs(lx) <= halfW + TILE_SIZE / 2 && ly <= 16 + TILE_SIZE / 2 && ly >= -30 - TILE_SIZE / 2) {
            const cell = this.terrain.isSolidAt(cellX, cellY);
            if (cell) {
              const tileL = lx - TILE_SIZE / 2;
              const tileR = lx + TILE_SIZE / 2;
              const tileT = ly - TILE_SIZE / 2;
              const tileB = ly + TILE_SIZE / 2;
              if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
            }
          }
        }
      }
      for (const ob of this.obstacles) {
        if (ob.hp <= 0) continue;
        const dx = wrapDeltaX(wx, ob.x + ob.w / 2);
        const dy = wrapDeltaY(y, ob.y + ob.h / 2);
        const tileL = dx - ob.w / 2;
        const tileR = dx + ob.w / 2;
        const tileT = dy - ob.h / 2;
        const tileB = dy + ob.h / 2;
        if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true;
      }
      return false;
    }
    /** 最小轴推出（穿模解算）：把玩家从任何嵌入的实体里沿最小穿透方向推出；返回是否推过 */
    resolvePenetration(p) {
      const halfW = 10;
      let moved = false;
      for (let iter = 0; iter < 6; iter++) {
        if (!this.bodyOverlapsAt(p.pos.x, p.pos.y)) break;
        const wx = wrapX(p.pos.x);
        const pick = { v: null };
        let bestLen = Infinity;
        const consider = (tileL, tileR, tileT, tileB) => {
          if (!(tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16)) return;
          const cand = [
            { dx: tileL - halfW, dy: 0 },
            // 向左
            { dx: tileR + halfW, dy: 0 },
            // 向右
            { dx: 0, dy: tileB + 30 },
            // 向下（放到 tile 底部之下）
            { dx: 0, dy: tileT - 16 }
            // 向上（放到 tile 顶部之上）
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
            if (!this.terrain.isSolidAt(cellX, cellY)) continue;
            const lx = wrapDeltaX(wx, cellX);
            const ly = wrapDeltaY(p.pos.y, cellY);
            consider(lx - TILE_SIZE / 2, lx + TILE_SIZE / 2, ly - TILE_SIZE / 2, ly + TILE_SIZE / 2);
          }
        }
        for (const ob of this.obstacles) {
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
          this.ensureFreePosition(p);
          moved = true;
          break;
        }
      }
      return moved;
    }
    // ── 弹道 ──────────────────────────────────────────────
    // 子步进（≤8px/步）：高速弹（高斯枪 3000px/s=50px/帧）不会穿过 20px 墙砖；
    // 引力弹 passWalls=true 忽略原始地形；光束撞墙反弹（bounces 次，每次反弹重置命中列表）。
    stepProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        if (this.projectiles[i].damage <= 0) this.projectiles.splice(i, 1);
      }
      const g = getPhysicsParams().gravity;
      const SUBSTEP_PX = 8;
      for (const pr of this.projectiles) {
        if (pr.life <= 0) continue;
        if (pr.dragPerSecond < 1) {
          const k = Math.pow(pr.dragPerSecond, dt);
          pr.vel.x *= k;
          pr.vel.y *= k;
        }
        if (!pr.isGravityOrb && !pr.beam) {
          for (const orb of this.projectiles) {
            if (!orb.isGravityOrb || orb.life <= 0) continue;
            const dx2 = wrapDeltaX(pr.pos.x, orb.pos.x);
            const dy2 = wrapDeltaY(pr.pos.y, orb.pos.y);
            const d = Math.hypot(dx2, dy2);
            const FIELD = 360;
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
        for (let step = 0; step < steps; step++) {
          const prevX = pr.pos.x;
          const prevY = pr.pos.y;
          pr.pos.x = wrapX(pr.pos.x + sx);
          pr.pos.y = wrapY(pr.pos.y + sy);
          let hit = false;
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue;
            if (t.id !== pr.owner && t.team === this.ownerTeamOf(pr.owner) && t.team !== "ffa") {
              const wepFF = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
              if (!wepFF?.friendlyFire) continue;
            }
            if (t.id === pr.owner && !(pr.weaponId >= 0 && WEAPONS[pr.weaponId]?.selfDamage)) continue;
            const dxHead = wrapDeltaX(t.pos.x, pr.pos.x);
            const dyHead = wrapDeltaY(t.pos.y - 24, pr.pos.y);
            if (Math.hypot(dxHead, dyHead) <= this.config.headRadius + pr.r) {
              pr.hitTargets.push(t.id);
              const piercing = pr.pierceOnHeadshot || pr.pierceAll;
              if (pr.explosive) {
                this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * pr.headshotMult * this.projectileFalloff(pr, pr.pos.x, pr.pos.y), 960, pr);
                hit = true;
              } else {
                this.damage(t, Math.round(pr.damage * pr.headshotMult * this.projectileFalloff(pr, t.pos.x, t.pos.y - 24)), pr, true, piercing);
                t.vel.x += pr.vel.x * 0.12;
                t.vel.y += pr.vel.y * 0.12 - 72;
                if (!piercing) hit = true;
              }
              if (hit) break;
              continue;
            }
            const dxBody = Math.abs(wrapDeltaX(t.pos.x, pr.pos.x));
            const dyBody = wrapDeltaY(t.pos.y, pr.pos.y);
            if (dxBody <= 13 + pr.r && dyBody >= -12 && dyBody <= 18) {
              pr.hitTargets.push(t.id);
              if (pr.explosive) {
                this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * this.projectileFalloff(pr, pr.pos.x, pr.pos.y), 900, pr);
                hit = true;
              } else {
                let dmg = Math.round(pr.damage);
                const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
                if (wep?.farRange && pr.weaponId === 2) {
                  const owner = this.players.find((x) => x.id === pr.owner);
                  if (owner) {
                    const dist2 = wrapDist(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12);
                    if (dist2 > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg);
                  }
                }
                dmg = Math.round(dmg * this.projectileFalloff(pr, t.pos.x, t.pos.y - 12));
                this.damage(t, dmg, pr, false, false);
                t.vel.x += pr.vel.x * 0.09;
                t.vel.y += pr.vel.y * 0.09;
                if (!pr.pierceAll) hit = true;
              }
              if (hit) break;
            }
          }
          if (hit) {
            dead = true;
            break;
          }
          const ob = this.obstacleAt(pr.pos.x, pr.pos.y, pr.r);
          if (ob) {
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
              dead = true;
            } else {
              this.damageObstacle(ob, pr.damage, pr);
              if (!pr.pierceAll) dead = true;
            }
            if (dead) break;
          }
          if (this.terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
            if (pr.passWalls) continue;
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
              dead = true;
              break;
            }
            if (pr.bounces > 0) {
              const hitX = this.terrain.isSolidAt(pr.pos.x, prevY);
              const hitY = this.terrain.isSolidAt(prevX, pr.pos.y);
              pr.pos = { x: prevX, y: prevY };
              if (hitX) pr.vel.x = -pr.vel.x;
              if (hitY) pr.vel.y = -pr.vel.y;
              if (!hitX && !hitY) {
                pr.vel.x = -pr.vel.x;
                pr.vel.y = -pr.vel.y;
              }
              pr.bounces--;
              pr.hitTargets = [pr.owner];
              break;
            }
            dead = true;
            break;
          }
        }
        if (dead) pr.life = 0;
      }
    }
    /** 引力弹持续牵引（位移式）：把附近玩家朝弹体位置拉，碰撞安全；最大 240px/s < 常规移动 300 → 可抵抗 */
    applyGravityOrbPull(p, dt) {
      const RANGE = 260;
      const MAX_PULL = 240;
      const MIN_RATIO = 0.35;
      let vx = 0;
      let vy = 0;
      for (const pr of this.projectiles) {
        if (!pr.isGravityOrb || pr.life <= 0) continue;
        const dx = wrapDeltaX(p.pos.x, pr.pos.x);
        const dy = wrapDeltaY(p.pos.y - 12, pr.pos.y);
        const d = Math.hypot(dx, dy);
        if (d > RANGE || d < 8) continue;
        const strength = MAX_PULL * (MIN_RATIO + (1 - MIN_RATIO) * (1 - d / RANGE));
        vx += dx / d * strength;
        vy += dy / d * strength;
      }
      if (vx === 0 && vy === 0) return;
      const tryX = wrapX(p.pos.x + vx * dt);
      if (!this.bodyOverlapsAt(tryX, p.pos.y)) p.pos.x = tryX;
      const tryY = wrapY(p.pos.y + vy * dt);
      if (!this.bodyOverlapsAt(p.pos.x, tryY)) p.pos.y = tryY;
    }
    ownerTeamOf(id) {
      return this.players.find((p) => p.id === id)?.team ?? "ffa";
    }
    // ── 爆炸（对障碍物/玩家/含引力内爆） ──────────────────────
    explode(cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
      const wCx = wrapX(cx);
      this.events.push({ kind: "explosion", x: wCx, y: cy, radius });
      for (const ob of [...this.obstacles]) {
        const dx = wrapDeltaX(wCx, ob.x + ob.w / 2);
        const dOb = wrapDeltaY(ob.y, cy);
        const nearY = clamp(dOb, 0, ob.h);
        const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY);
        if (dist <= radius * 1.25) this.damageObstacle(ob, maxDamage * (1 - dist / (radius * 1.25)) + 30, pr);
      }
      const hitR = radius * 1.35;
      const atkId = ownerId ?? pr?.owner ?? 0;
      const atkTeam = ownerTeam ?? this.ownerTeamOf(atkId);
      const label = weaponLabel ?? pr?.weaponLabel ?? "\u7206\u70B8";
      for (const t of this.players) {
        if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
        const dx = wrapDeltaX(wCx, t.pos.x);
        const dy = wrapDeltaY(cy, t.pos.y - 12);
        const dist = Math.hypot(dx, dy);
        if (dist > hitR) continue;
        const falloff = Math.max(0.2, 1 - dist / hitR);
        const nx = dist > 0.1 ? dx / dist : 0;
        const ny = dist > 0.1 ? dy / dist : -1;
        const sign = implosion ? -0.85 : 1;
        t.vel.x += nx * knockback * falloff * sign;
        t.vel.y += (ny * knockback - 210) * falloff * sign;
        const isSelf = t.id === atkId;
        const isTeammate = !isSelf && t.team === atkTeam && t.team !== "ffa";
        const isGrenade = label === "\u624B\u69B4\u5F39";
        const srcWep = pr && pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : void 0;
        const ffAllowed = isGrenade ? this.config.grenadeFriendlyFire : srcWep ? srcWep.friendlyFire ?? false : false;
        const selfAllowed = isGrenade ? this.config.grenadeSelfDamage : srcWep ? srcWep.selfDamage ?? false : true;
        if (isTeammate && !ffAllowed) continue;
        if (isSelf && !selfAllowed) continue;
        {
          const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1));
          const headDist = Math.hypot(dx, wrapDeltaY(cy, t.pos.y - 26));
          const isHead = headDist < this.config.headRadius * 1.6 && dist < radius * 0.6;
          this.damage(t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label);
        }
      }
    }
    damage(t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
      if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return;
      const atkId = attackerId ?? pr?.owner ?? 0;
      const atkTeam = attackerTeam ?? this.ownerTeamOf(atkId);
      const label = weaponLabel ?? pr?.weaponLabel ?? "\u672A\u77E5";
      let remaining = amount;
      if (t.shieldTimer > 0 && t.shieldHp > 0) {
        const absorbed = Math.min(t.shieldHp, remaining);
        t.shieldHp -= absorbed;
        remaining -= absorbed;
        if (t.shieldHp <= 0) {
          t.shieldHp = 0;
          t.shieldTimer = 0;
          this.events.push({ kind: "shield_break", x: t.pos.x, y: t.pos.y, playerId: t.id });
        }
        if (remaining <= 0) return;
      }
      t.hp -= remaining;
      if (isHead) this.events.push({ kind: "headshot", x: t.pos.x, y: t.pos.y, victimId: t.id, playerId: atkId, isPierced });
      this.hits++;
      if (t.hp > 0) return;
      if (t.doll && t.doll.timer > 0) {
        this.recallDoll(t, "doll_recall");
        return;
      }
      t.hp = 0;
      t.deaths++;
      t.respawnTimer = this.config.respawnDelay;
      t.shieldHp = 0;
      t.shieldTimer = 0;
      t.watchtowerTimer = 0;
      const mk = this.mortars.find((m) => m.operatorId === t.id);
      if (mk) mk.operatorId = null;
      const killer = this.players.find((x) => x.id === atkId);
      if (killer && atkId !== t.id) {
        killer.kills++;
        if (this.scores[atkTeam] !== void 0) this.scores[atkTeam]++;
      }
      this.events.push({
        kind: "kill",
        killerId: atkId,
        victimId: t.id,
        killerName: killer?.name ?? "\u6218\u573A\u73AF\u5883",
        killerTeam: atkTeam,
        victimName: t.name,
        victimTeam: t.team,
        weaponLabel: label,
        isHeadshot: isHead,
        isPierced,
        x: t.pos.x,
        y: t.pos.y
      });
    }
    damageObstacle(ob, dmg, pr) {
      if (ob.hp <= 0 || dmg <= 0) return;
      ob.hp = Math.max(0, ob.hp - Math.round(dmg));
      if (ob.hp <= 0) {
        this.obstacles = this.obstacles.filter((o) => o.id !== ob.id);
        this.events.push({ kind: "obstacle_destroy", obstacleId: ob.id, x: ob.x, y: ob.y });
      }
    }
    obstacleAt(x, y, pad = 0) {
      const wx = wrapX(x);
      for (const ob of this.obstacles) {
        if (ob.hp <= 0) continue;
        const dy = wrapDeltaY(ob.y, y);
        if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob;
      }
      return null;
    }
    // ── 手雷 ──────────────────────────────────────────────
    stepGrenades(dt) {
      const g0 = 1250;
      for (const g of this.grenades) {
        g.vel.y += g0 * 0.88 * dt;
        g.vel.x *= 0.995;
        const nx = wrapX(g.pos.x + g.vel.x * dt);
        if (this.terrain.isSolidAt(nx, g.pos.y) || this.obstacleAt(nx, g.pos.y)) g.vel.x *= -0.55;
        else g.pos.x = nx;
        const ny = g.pos.y + g.vel.y * dt;
        if (this.terrain.isSolidAt(g.pos.x, ny) || this.obstacleAt(g.pos.x, ny)) {
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
          this.explode(g.pos.x, g.pos.y, this.config.grenadeRadius, this.config.grenadeDamage, 16 * 60, void 0, g.owner, void 0, "\u624B\u69B4\u5F39");
          g.fuse = 0;
        }
      }
    }
    // ── 地雷（受重力 + 直击 + 瞬发 + 定时必爆 + 预设重生） ──────────
    stepLandmines(dt) {
      const g0 = 1250;
      for (let i = this.landmines.length - 1; i >= 0; i--) {
        const m = this.landmines[i];
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
        if (!this.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !this.obstacleAt(m.pos.x, m.pos.y + 8)) {
          m.vel.y += g0 * 0.86 * dt;
          const nx = wrapX(m.pos.x + m.vel.x * dt);
          if (!this.terrain.isSolidAt(nx, m.pos.y) && !this.obstacleAt(nx, m.pos.y)) m.pos.x = nx;
          else m.vel.x = -m.vel.x * 0.35;
          const ny = m.pos.y + m.vel.y * dt;
          if (!this.terrain.isSolidAt(m.pos.x, ny + 8) && !this.obstacleAt(m.pos.x, ny + 8)) m.pos.y = wrapY(ny);
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
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue;
            if (t.team === this.ownerTeamOf(m.owner) && t.team !== "ffa") continue;
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
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
            if (!m.preset && t.id === m.owner) continue;
            if (wrapDist(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= this.config.mineTriggerRadius) {
              m.triggered = true;
              m.fuse = m.instant ? 0.02 : 0.45;
              break;
            }
          }
        } else {
          m.fuse -= dt;
          if (m.fuse <= 0) {
            const label = m.instant ? "\u26A1\u77AC\u53D1\u5730\u96F7" : "\u{1F6A8}\u611F\u5E94\u5730\u96F7";
            const ownTeam = m.owner === 0 ? "ffa" : this.ownerTeamOf(m.owner);
            this.explode(m.pos.x, m.pos.y, 82, this.config.mineDamage, 19 * 60, void 0, m.owner === 0 ? void 0 : m.owner, void 0, label);
            if (m.preset) m.respawnTimer = this.config.mineRespawnTime;
            else this.landmines.splice(i, 1);
          }
        }
      }
    }
    // ── 空袭 ──────────────────────────────────────────────
    stepAirstrikes(dt) {
      for (let i = this.airstrikes.length - 1; i >= 0; i--) {
        const st = this.airstrikes[i];
        st.timer -= dt;
        if (st.timer <= 0 && !st.dropped) {
          st.dropped = true;
          this.events.push({ kind: "airstrike_drop", x: st.pos.x, y: st.pos.y });
          const src = this.players.find((p) => p.id === st.owner);
          for (let b = -2; b <= 2; b++) {
            this.projectiles.push(this.makeProjectile(
              src ?? { id: st.owner, pos: st.pos, vel: { x: 0, y: 0 }, aim: 0, team: "ffa", name: "\u7A7A\u88AD" },
              st.pos.x + b * 44,
              st.pos.y - 420 - Math.abs(b) * 28,
              this.rng.range(-30, 30),
              900 + this.rng.range(0, 120),
              {
                damage: this.config.airstrikeDamage,
                headshotMult: 1.5,
                terrainRadius: this.config.airstrikeRadius,
                explosive: true,
                gravityScale: 0.5,
                weaponLabel: "\u2708\uFE0F\u5B9A\u70B9\u7A7A\u88AD",
                color: "#f43f5e",
                r: 7,
                life: 160 / 60
              }
            ));
          }
        }
        if (st.timer <= -0.6) this.airstrikes.splice(i, 1);
      }
    }
    // ── 占点 ──────────────────────────────────────────────
    stepCapturePoints(dt) {
      for (const cp of this.capturePoints) {
        const presence = {};
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < this.config.captureRadius) {
            presence[p.team] = (presence[p.team] || 0) + 1;
          }
        }
        const teams = Object.keys(presence);
        if (teams.length === 1) {
          const t = teams[0];
          if (cp.ownerTeam !== t) {
            cp.capturingTeam = t;
            cp.progress += this.config.captureRate * dt * (presence[t] || 0);
            if (cp.progress >= 100) {
              cp.progress = 100;
              cp.ownerTeam = t;
              this.events.push({ kind: "capture", pointCode: cp.code, team: t, x: cp.x, y: cp.y });
            }
          }
        }
      }
    }
    // ── 迫击炮冷却 ──────────────────────────────────────────
    stepMortars(dt) {
      for (const m of this.mortars) {
        if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt);
      }
    }
    // ── 补给箱 ──────────────────────────────────────────────
    stepSupplyCrates(dt) {
      for (const crate of this.supplyCrates) {
        if (!crate.active && crate.respawnTimer > 0) {
          crate.respawnTimer -= dt;
          if (crate.respawnTimer <= 0) crate.active = true;
        }
        if (!crate.active) continue;
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
            crate.active = false;
            crate.respawnTimer = this.config.supplyRespawnTime;
            if (crate.kind === "doll") {
              p.dollCharges = Math.min(this.config.dollMaxCharges, p.dollCharges + 1);
            } else {
              p.weaponIndex = crate.weaponId;
              p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1));
              p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize;
              p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve;
            }
            this.events.push({ kind: "supply_pickup", playerId: p.id, weaponName: crate.weaponName, x: crate.x, y: crate.y });
            break;
          }
        }
      }
    }
    // ── 弹药点（随机刷新走 Rng） ──────────────────────────────
    spawnAmmoPack() {
      if (this.ammoPacks.length >= this.config.ammoPackMaxActive) return;
      const available = [];
      for (let i = 0; i < AMMO_SPOTS.length; i++) {
        if (!this.ammoPacks.some((a) => a.x === AMMO_SPOTS[i].x)) available.push(i);
      }
      if (available.length === 0) return;
      const spot = AMMO_SPOTS[this.rng.pick(available)];
      this.ammoPacks.push({ id: this.ammo++, x: spot.x, y: spot.y, area: spot.area });
    }
    tickAmmoSpawner(dt) {
      this.ammoSpawnTimer += dt;
      if (this.ammoSpawnTimer >= this.config.ammoPackInterval) {
        this.ammoSpawnTimer = 0;
        this.spawnAmmoPack();
      }
      for (let i = this.ammoPacks.length - 1; i >= 0; i--) {
        const pack = this.ammoPacks[i];
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
            const wep = WEAPONS[p.weaponIndex];
            p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve);
            this.ammoPacks.splice(i, 1);
            this.events.push({ kind: "ammo_pickup", playerId: p.id, x: pack.x, y: pack.y });
            break;
          }
        }
      }
    }
    /** 玩家重叠分离：两两检查，沿 x 各推 0.5px（受地形/障碍/其他人限制），避免叠人卡死 */
    separatePlayers() {
      const list = this.players.filter((p) => p.deployed && p.alive && p.respawnTimer <= 0);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (!this.bodiesOverlap(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue;
          const dx = Math.abs(wrapDeltaX(a.pos.x, b.pos.x));
          const ox = 20 - dx;
          const top = Math.max(a.pos.y - 30, b.pos.y - 30);
          const bottom = Math.min(a.pos.y + 16, b.pos.y + 16);
          const oy = bottom - top;
          if (oy > 0 && (ox <= 20 && dx <= 8 || oy <= ox)) {
            const upper = a.pos.y <= b.pos.y ? a : b;
            const upY = wrapY(upper.pos.y - oy);
            if (!this.terrain.isSolidAt(upper.pos.x, upY - 26)) upper.pos.y = upY;
          } else {
            const dir = Math.sign(wrapDeltaX(a.pos.x, b.pos.x)) || 1;
            this.tryNudge(b, dir, 0.6);
            this.tryNudge(a, -dir, 0.6);
          }
        }
      }
    }
    stepObstaclesOnly() {
    }
    // ── 快照 ──────────────────────────────────────────────
    snapshot() {
      return {
        tick: this.tick,
        seed: this.seed,
        players: this.players.map((p) => ({
          ...p,
          pos: { ...p.pos },
          vel: { ...p.vel },
          ammo: [...p.ammo],
          reserveAmmo: [...p.reserveAmmo],
          doll: p.doll ? { ...p.doll, pos: { ...p.doll.pos }, ammo: [...p.doll.ammo], reserveAmmo: [...p.doll.reserveAmmo] } : null
        })),
        projectiles: this.projectiles.map((pr) => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel }, hitTargets: [...pr.hitTargets] })),
        grenades: this.grenades.map((g) => ({ ...g, pos: { ...g.pos }, vel: { ...g.vel } })),
        landmines: this.landmines.map((m) => ({ ...m, pos: { ...m.pos }, vel: { ...m.vel } })),
        airstrikes: this.airstrikes.map((a) => ({ ...a, pos: { ...a.pos } })),
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
  var BALANCE_KEY = "pvp-balance-overrides-v1";
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
    "farDamage"
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
  function sanitizeOverrides(raw) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw;
    const out = {};
    if (o.weapons && typeof o.weapons === "object") {
      const weapons = {};
      for (const [k, v] of Object.entries(o.weapons)) {
        const id = Number(k);
        if (!Number.isInteger(id) || id < 0 || id >= WEAPONS.length) continue;
        if (!v || typeof v !== "object") continue;
        const patch = {};
        for (const key of WEAPON_NUMERIC_KEYS) {
          const n = num(v[key]);
          if (n === null) continue;
          if (key === "damage" || key === "damagePerSecond") patch[key] = Math.max(0, Math.min(5e3, n));
          else if (key === "magSize") patch[key] = Math.max(1, Math.min(500, Math.round(n)));
          else if (key === "maxReserve") patch[key] = Math.max(0, Math.min(2e3, Math.round(n)));
          else if (key === "pellets") patch[key] = Math.max(1, Math.min(30, Math.round(n)));
          else if (key === "reloadTime" || key === "fireDelay" || key === "chargeSeconds") patch[key] = Math.max(0, Math.min(20, n));
          else if (key === "moveSpeedMult" || key === "fuelMult" || key === "ascendMult" || key === "fovMult") patch[key] = Math.max(0, Math.min(5, n));
          else patch[key] = n;
        }
        for (const key of WEAPON_BOOL_KEYS) {
          const b = v[key];
          if (typeof b === "boolean") patch[key] = b;
        }
        if (Object.keys(patch).length > 0) weapons[String(id)] = patch;
      }
      if (Object.keys(weapons).length > 0) out.weapons = weapons;
    }
    if (o.config && typeof o.config === "object") {
      const config = {};
      for (const key of CONFIG_NUMERIC_KEYS) {
        const n = num(o.config[key]);
        if (n !== null) config[key] = n;
      }
      for (const key of CONFIG_BOOL_KEYS) {
        const b = o.config[key];
        if (typeof b === "boolean") config[key] = b;
      }
      if (Object.keys(config).length > 0) out.config = config;
    }
    if (o.physics && typeof o.physics === "object") {
      const physics = {};
      for (const [k, v] of Object.entries(o.physics)) {
        const n = num(v);
        if (n !== null) physics[k] = n;
      }
      if (Object.keys(physics).length > 0) out.physics = physics;
    }
    if (!out.weapons && !out.config && !out.physics) return null;
    return out;
  }
  function applyWeaponOverrides(ov) {
    if (!ov) return;
    for (const [k, patch] of Object.entries(ov)) {
      const id = Number(k);
      const wep = WEAPONS[id];
      if (!wep || !patch) continue;
      Object.assign(wep, patch);
    }
  }
  function applyConfigOverrides(config, ov) {
    if (!ov) return;
    Object.assign(config, ov);
  }

  // src/web/effects.ts
  var Effects = class {
    particles = [];
    rnd() {
      return Math.random();
    }
    push(p) {
      if (this.particles.length > 400) this.particles.shift();
      this.particles.push(p);
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
          this.particles.splice(i, 1);
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
      for (const p of this.particles) {
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
  function updateHudWeaponButtons() {
    document.querySelectorAll(".death-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      btn.className = slot === pendingLoadout.weaponIndex ? "death-wep-btn px-2.5 py-2 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-left transition" : "death-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
    });
    document.querySelectorAll(".death-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec");
      const def = sec ? SECONDARIES[sec] : void 0;
      const noCharge = sec === "doll" && localPlayer.dollCharges <= 0;
      btn.className = "death-sec-btn px-2.5 py-1.5 rounded-lg border text-xs " + (sec === pendingLoadout.secondaryType ? "border-rose-400 bg-rose-500/20 font-extrabold text-white" : "border-slate-700 bg-slate-950/60 font-semibold text-slate-400") + (noCharge || def?.supplyOnly && sec === "doll" ? " opacity-60 cursor-not-allowed" : "");
      btn.disabled = sec === "doll" && localPlayer.dollCharges <= 0;
    });
    document.querySelectorAll(".lobby-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      btn.className = slot === pendingLoadout.weaponIndex ? "lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition" : "lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
    });
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec");
      const def = sec ? SECONDARIES[sec] : void 0;
      if (def?.supplyOnly) {
        btn.className = "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60";
      } else {
        btn.className = sec === pendingLoadout.secondaryType ? "lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition" : "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
      }
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
    updateHudWeaponButtons();
  }
  function tryChangeSecondaryWeapon(secType) {
    const def = SECONDARIES[secType];
    if (!def) return;
    if (def?.supplyOnly) {
      if (localPlayer.dollCharges <= 0) {
        showToast("\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\u53EA\u80FD\u4ECE\u6218\u573A\u7279\u6B8A\u8865\u7ED9\u7BB1\u83B7\u5F97\u5145\u80FD\uFF01");
        return;
      }
      localPlayer.secondary = secType;
      updateHudWeaponButtons();
      showToast(`\u{1F38E} \u5DF2\u5207\u6362\u66FF\u8EAB\u4EBA\u5076\uFF08\u5145\u80FD ${localPlayer.dollCharges}\uFF09`);
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
    const secChipEl = document.getElementById("hudSecondaryChipText");
    if (secChipEl) {
      secChipEl.textContent = localPlayer.secondary === "doll" ? `\u{1F38E} \u66FF\u8EAB\u4EBA\u5076 [${localPlayer.dollCharges}]` : `\u{1F4A3} \u624B\u69B4\u5F39 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`;
    }
    const ammoEl = document.getElementById("currentAmmoText");
    if (ammoEl) ammoEl.textContent = mounted ? "\u221E" : `${Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))} / ${localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0}`;
    const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag;
    const gOverlay = document.getElementById("grenadeCdOverlay");
    const gLabel = document.getElementById("hudGrenadeLabel");
    const gTitle = document.getElementById("hudSecondaryTitle");
    const isDoll = localPlayer.secondary === "doll";
    if (gTitle) gTitle.textContent = isDoll ? `[G/\u53F3\u952E] \u66FF\u8EAB\u4EBA\u5076 [\u5145\u80FD${localPlayer.dollCharges}]` : `[G/\u53F3\u952E] \u624B\u69B4\u5F39 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`;
    if (gOverlay && gLabel) {
      if (isDoll) {
        gOverlay.style.height = localPlayer.dollCharges > 0 ? "0%" : "100%";
        gLabel.textContent = localPlayer.dollCharges > 0 ? "\u{1F38E} \u5C31\u7EEA" : "\u{1F38E} \u65E0\u5145\u80FD";
      } else {
        const need = localPlayer.fragCharges >= world.config.fragMaxCharges;
        if (need) {
          gOverlay.style.height = "0%";
          gLabel.textContent = "\u{1F4A3} \u5C31\u7EEA";
        } else {
          const pct = Math.min(100, localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds * 100);
          gOverlay.style.height = pct + "%";
          gLabel.textContent = `\u{1F4A3} ${localPlayer.fragCharges}/${world.config.fragMaxCharges} \u56DE\u590D\u4E2D`;
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
    localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : "frag";
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
    red: { color: "#f43f5e", light: "#fda4af", dark: "#9f1239" },
    blue: { color: "#0ea5e9", light: "#7dd3fc", dark: "#075985" },
    green: { color: "#10b981", light: "#6ee7b7", dark: "#065f46" },
    ffa: { color: "#eab308", light: "#fde047", dark: "#854d0e" }
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
    ctx2.fillStyle = "rgba(0,0,0,0.35)";
    ctx2.beginPath();
    ctx2.ellipse(0, 18, 14, 4, 0, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#1e293b";
    ctx2.fillRect(-9 + walkPhase * 3, 8, 6, 10);
    ctx2.fillRect(3 - walkPhase * 3, 8, 6, 10);
    ctx2.fillStyle = "#0f172a";
    ctx2.fillRect(-9 + walkPhase * 3, 16, 7, 3);
    ctx2.fillRect(2 - walkPhase * 3, 16, 7, 3);
    const bodyGrad = ctx2.createLinearGradient(0, -14, 0, 10);
    bodyGrad.addColorStop(0, pal.light);
    bodyGrad.addColorStop(0.45, pal.color);
    bodyGrad.addColorStop(1, pal.dark);
    ctx2.fillStyle = bodyGrad;
    ctx2.strokeStyle = "#0b1220";
    ctx2.lineWidth = 2;
    roundRect(ctx2, -11, -14, 22, 24, 6);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(ctx2, -7, -11, 6, 8, 2);
    ctx2.fill();
    ctx2.fillStyle = "rgba(255,255,255,0.85)";
    ctx2.fillRect(4, -6, 4, 4);
    ctx2.fillStyle = "#334155";
    roundRect(ctx2, facing > 0 ? -15 : 8, -10, 7, 14, 2);
    ctx2.fill();
    ctx2.fillStyle = "#64748b";
    ctx2.fillRect(facing > 0 ? -14 : 9, -8, 5, 3);
    if (opts.floating) {
      const flick = 0.7 + Math.sin(t * 0.9) * 0.3 + Math.random() * 0.15;
      const fx = facing > 0 ? -15 : 15;
      const grad = ctx2.createLinearGradient(fx, 6, fx, 6 + 16 * flick);
      grad.addColorStop(0, "rgba(125, 211, 252, 0.95)");
      grad.addColorStop(0.5, "rgba(56, 189, 248, 0.7)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx2.fillStyle = grad;
      ctx2.beginPath();
      ctx2.moveTo(fx - 3, 4);
      ctx2.lineTo(fx + 3, 4);
      ctx2.lineTo(fx + (Math.random() - 0.5) * 2, 4 + 18 * flick);
      ctx2.closePath();
      ctx2.fill();
    }
    ctx2.fillStyle = "#cbd5e1";
    ctx2.strokeStyle = "#0b1220";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.arc(0, -24, 10, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = pal.dark;
    ctx2.beginPath();
    ctx2.arc(0, -24, 8, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#0ea5e9";
    ctx2.fillRect(facing > 0 ? 2 : -8, -26, 6, 3);
    ctx2.fillStyle = "rgba(255,255,255,0.8)";
    ctx2.fillRect(facing > 0 ? 3 : -7, -26, 2, 1);
    if (!opts.mounted) {
      ctx2.save();
      ctx2.rotate(p.aim - (facing < 0 ? Math.PI : 0));
      const flip = facing < 0 ? -1 : 1;
      ctx2.scale(1, flip);
      const metal = "#1e293b";
      const accent = wep.color;
      switch (wep.id) {
        case 0:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -9, 26, 7, 2);
          ctx2.fill();
          ctx2.fillStyle = "#7c2d12";
          roundRect(ctx2, 20, -4, 12, 4, 1);
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(10, -8, 8, 2);
          break;
        case 1:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -9, 30, 6, 2);
          ctx2.fill();
          ctx2.fillStyle = "#334155";
          roundRect(ctx2, 12, -4, 7, 8, 2);
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(8, -8, 14, 2);
          break;
        case 2:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -9, 42, 5, 2);
          ctx2.fill();
          ctx2.fillStyle = "#0f172a";
          roundRect(ctx2, 14, -15, 14, 5, 2);
          ctx2.fill();
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 1.5;
          ctx2.strokeRect(14, -15, 14, 5);
          break;
        case 3:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -12, 24, 11, 5);
          ctx2.fill();
          ctx2.fillStyle = accent;
          ctx2.fillRect(30, -11, 6, 9);
          break;
        case 4:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -9, 28, 8, 3);
          ctx2.fill();
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            ctx2.beginPath();
            ctx2.arc(12 + i * 8, -5, 3.4, 0, Math.PI * 2);
            ctx2.stroke();
          }
          ctx2.fillStyle = "rgba(34,211,238,0.35)";
          ctx2.beginPath();
          ctx2.moveTo(36, -5);
          ctx2.lineTo(52, -5);
          ctx2.strokeStyle = "rgba(34,211,238,0.55)";
          ctx2.stroke();
          break;
        case 5:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -12, 22, 13, 4);
          ctx2.fill();
          ctx2.fillStyle = "#64748b";
          for (let i = 0; i < 3; i++) ctx2.fillRect(26, -11 + i * 4, 10, 2.4);
          break;
        case 6:
          ctx2.fillStyle = metal;
          roundRect(ctx2, 6, -10, 20, 9, 4);
          ctx2.fill();
          ctx2.strokeStyle = accent;
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          ctx2.arc(30, -5.5, 6, 0, Math.PI * 2);
          ctx2.stroke();
          ctx2.fillStyle = "rgba(168,85,247,0.35)";
          ctx2.beginPath();
          ctx2.arc(30, -5.5, 4, 0, Math.PI * 2);
          ctx2.fill();
          break;
      }
      ctx2.restore();
    }
    if (p.shieldTimer > 0 && p.shieldHp > 0) {
      ctx2.strokeStyle = "rgba(56,189,248,0.9)";
      ctx2.fillStyle = "rgba(56,189,248,0.14)";
      ctx2.lineWidth = 2.5;
      ctx2.beginPath();
      ctx2.arc(0, -8, 30 + Math.sin(t * 0.15) * 1.5, 0, Math.PI * 2);
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
    ctx2.fillStyle = "rgba(15,23,42,0.85)";
    ctx2.fillRect(-barW / 2, -42, barW, 5);
    const ratio = Math.max(0, p.hp) / p.maxHp;
    ctx2.fillStyle = ratio > 0.4 ? p.team === "red" ? "#f43f5e" : p.team === "blue" ? "#0ea5e9" : p.team === "green" ? "#10b981" : "#eab308" : "#ef4444";
    ctx2.fillRect(-barW / 2, -42, barW * ratio, 5);
    if (p.shieldTimer > 0 && p.shieldHp > 0) {
      ctx2.fillStyle = "rgba(15,23,42,0.85)";
      ctx2.fillRect(-barW / 2, -36, barW, 3);
      ctx2.fillStyle = "#38bdf8";
      ctx2.fillRect(-barW / 2, -36, barW * Math.min(1, p.shieldHp / 130), 3);
    }
    ctx2.font = "9px Inter, system-ui, sans-serif";
    ctx2.fillStyle = "rgba(226,232,240,0.75)";
    ctx2.fillText(`${wep.shortName} ${p.ammo[p.weaponIndex] ?? 0}`, 0, -50);
    ctx2.restore();
  }
  function drawObstacleSprite(ctx2, ob, dx, dy) {
    const left = dx - ob.w / 2;
    const top = dy - ob.h / 2;
    ctx2.save();
    ctx2.fillStyle = ob.color;
    ctx2.fillRect(left, top, ob.w, ob.h);
    const ratio = ob.hp / ob.maxHp;
    ctx2.strokeStyle = ob.borderColor;
    ctx2.lineWidth = 2;
    ctx2.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2);
    ctx2.fillStyle = "rgba(255,255,255,0.08)";
    ctx2.fillRect(left + 2, top + 2, ob.w - 4, 3);
    for (let y = top + 10; y < top + ob.h - 4; y += 12) {
      ctx2.fillStyle = "rgba(0,0,0,0.18)";
      ctx2.fillRect(left + 2, y, ob.w - 4, 1);
    }
    if (ratio < 0.66) {
      ctx2.strokeStyle = "rgba(0,0,0,0.55)";
      ctx2.lineWidth = 1;
      const cracks = ratio < 0.33 ? 4 : 2;
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
    const bob = Math.sin(tick * 0.08 + crate.x * 0.01) * 1.5;
    ctx2.translate(0, bob);
    const grad = ctx2.createLinearGradient(0, -16, 0, 16);
    if (crate.kind === "doll") {
      grad.addColorStop(0, "#831843");
      grad.addColorStop(1, "#4a1d3a");
    } else {
      grad.addColorStop(0, "#312e81");
      grad.addColorStop(1, "#1e1b4b");
    }
    ctx2.fillStyle = grad;
    ctx2.strokeStyle = crate.color;
    ctx2.lineWidth = 2.5;
    roundRect(ctx2, -18, -16, 36, 32, 5);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx2, -16, -14, 32, 10, 3);
    ctx2.fill();
    ctx2.fillStyle = crate.color;
    ctx2.fillRect(-3, -3, 6, 8);
    ctx2.font = "bold 12px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = crate.color;
    ctx2.fillText(crate.kind === "doll" ? "\u{1F38E}" : "\u{1F381}", 0, 3);
    ctx2.font = "bold 10px Inter, system-ui, sans-serif";
    ctx2.fillStyle = crate.color;
    ctx2.fillText(crate.kind === "doll" ? "\u66FF\u8EAB\u4EBA\u5076" : crate.weaponName, 0, -22);
    if (!crate.active && crate.respawnTimer > 0) {
      ctx2.fillStyle = "rgba(148,163,184,0.7)";
      ctx2.font = "9px Inter, system-ui, sans-serif";
      ctx2.fillText(`${Math.ceil(crate.respawnTimer)}s`, 0, 24);
    }
    ctx2.restore();
  }
  function drawAmmoSprite(ctx2, pack, dx, dy, tick) {
    ctx2.save();
    ctx2.translate(dx, dy - 16 + Math.sin(tick * 0.09 + pack.x * 0.01) * 1.2);
    ctx2.fillStyle = "#14532d";
    ctx2.strokeStyle = "#4ade80";
    ctx2.lineWidth = 2;
    roundRect(ctx2, -14, -12, 28, 24, 3);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = "#86efac";
    for (let i = 0; i < 3; i++) ctx2.fillRect(-10 + i * 7, -8, 4, 6);
    ctx2.font = "bold 9px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillStyle = "#bbf7d0";
    ctx2.fillText("\u{1F4E6} \u5F39\u836F", 0, 20);
    ctx2.restore();
  }
  function drawMortarSprite(ctx2, m, dx, dy, tick) {
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
    ctx2.save();
    ctx2.translate(0, -10);
    ctx2.rotate(m.angle);
    const g = ctx2.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, "#64748b");
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
    const pal = cp.ownerTeam ? TEAM_PALETTE[cp.ownerTeam] ?? TEAM_PALETTE.red : { color: "#94a3b8", light: "#cbd5e1", dark: "#475569" };
    ctx2.save();
    ctx2.translate(dx, dy);
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
  function drawGrenadeSprite(ctx2, g, dx, dy, tick) {
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
      const flame = 10 + Math.sin(tick * 1.4) * 5;
      const fg = ctx2.createLinearGradient(-14, 0, -14 - flame, 0);
      fg.addColorStop(0, "rgba(251, 191, 36, 0.9)");
      fg.addColorStop(0.6, "rgba(249, 115, 22, 0.6)");
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
      const grd = ctx2.createRadialGradient(dx, dy, 2, dx, dy, 24);
      grd.addColorStop(0, "rgba(216,180,254,0.95)");
      grd.addColorStop(0.4, "rgba(168,85,247,0.6)");
      grd.addColorStop(1, "rgba(168,85,247,0)");
      ctx2.fillStyle = grd;
      ctx2.beginPath();
      ctx2.arc(dx, dy, 24, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.fillStyle = "#e9d5ff";
      ctx2.beginPath();
      ctx2.arc(dx, dy, pr.r, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.restore();
    } else {
      const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1;
      const len = 14;
      const ex = dx - pr.vel.x / spd * len;
      const ey = dy - pr.vel.y / spd * len;
      ctx2.save();
      ctx2.strokeStyle = pr.color || "#fbbf24";
      ctx2.lineWidth = 2;
      ctx2.lineCap = "round";
      ctx2.beginPath();
      ctx2.moveTo(ex, ey);
      ctx2.lineTo(dx, dy);
      ctx2.stroke();
      ctx2.fillStyle = "#fff7d6";
      ctx2.beginPath();
      ctx2.arc(dx, dy, Math.max(1.5, pr.r - 1), 0, Math.PI * 2);
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
        addKillFeed(e.killerName ?? "?", e.killerTeam ?? "ffa", e.victimName ?? "?", e.victimTeam ?? "ffa", e.weaponLabel ?? "", e.isHeadshot, e.isPierced);
        if (e.victimId === localPlayer.id) death.info = { killer: e.killerName ?? "\u6218\u573A\u73AF\u5883", weapon: e.weaponLabel ?? "" };
        if (e.x !== void 0 && e.y !== void 0) effects.killBurst(e.x, e.y, TEAM_PALETTE[e.victimTeam ?? "red"]?.light ?? "#fda4af");
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
    for (const seg of segments) {
      const from = toScreen(seg.x1, seg.y1);
      const dx = wrapDeltaX(seg.x1, seg.x2);
      const dy = wrapDeltaY(seg.y1, seg.y2);
      out.push({ x1: from.x, y1: from.y, x2: from.x + dx, y2: from.y + dy });
      for (const ox of [-WORLD_W, WORLD_W]) {
        if (from.x + ox < -halfW - 200 || from.x + ox > halfW + 200) continue;
        out.push({ x1: from.x + ox, y1: from.y, x2: from.x + dx + ox, y2: from.y + dy });
      }
      for (const oy of [-WORLD_H, WORLD_H]) {
        if (from.y + oy < -halfH - 200 || from.y + oy > halfH + 200) continue;
        out.push({ x1: from.x, y1: from.y + oy, x2: from.x + dx, y2: from.y + dy + oy });
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
    for (let y = 0; y < S; y += 12) {
      c.fillStyle = rnd() > 0.5 ? "rgba(51, 65, 85, 0.35)" : "rgba(15, 23, 42, 0.35)";
      c.fillRect(0, y + rnd() * 4, S, 2 + rnd() * 3);
    }
    speckle(c, rnd, S, 40, ["#243044", "#2c3a52", "#141c2b", "#334155"], 1, 3.2);
    c.strokeStyle = "rgba(10, 14, 22, 0.6)";
    c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = rnd() * S;
      let y = rnd() * S;
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
    c.fillStyle = "#0c1320";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 55, ["#0a1019", "#131c2b", "#1c2738"], 1, 4);
    c.strokeStyle = "rgba(40, 52, 70, 0.5)";
    c.lineWidth = 1.5;
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
    c.fillStyle = "#0d1420";
    c.fillRect(0, 0, S, S);
    for (let row = 0; row < Math.ceil(S / rowH); row++) {
      const off = row % 2 === 0 ? 0 : -18;
      for (let x = off; x < S; x += 36) {
        const shade = 0.9 + rnd() * 0.25;
        c.fillStyle = `rgb(${Math.round(42 * shade)},${Math.round(54 * shade)},${Math.round(70 * shade)})`;
        c.fillRect(x + 2, row * rowH + 2, 32, rowH - 4);
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.fillRect(x + 2, row * rowH + 2, 32, 2);
      }
    }
    speckle(c, rnd, S, 18, ["#1a2334", "#38465c"], 1, 2.2);
  }
  function paintConcrete(c, rnd) {
    const S = 96;
    c.fillStyle = "#3a4658";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 48, ["#334155", "#475569", "#2c3849", "#5a6b82"], 1, 2.6);
    c.strokeStyle = "rgba(15, 23, 42, 0.55)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, S / 2);
    c.lineTo(S, S / 2);
    c.moveTo(S / 2, 0);
    c.lineTo(S / 2, S);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.06)";
    c.fillRect(0, 0, S, 2);
  }
  function paintMetal(c, rnd) {
    const S = 96;
    const g = c.createLinearGradient(0, 0, S, 0);
    g.addColorStop(0, "#123f52");
    g.addColorStop(0.45, "#1a6076");
    g.addColorStop(0.55, "#1a6076");
    g.addColorStop(1, "#0e3545");
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
      c.lineWidth = 1;
      c.beginPath();
      const y = rnd() * S;
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
    c.strokeStyle = "rgba(8, 20, 28, 0.8)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 6);
    c.lineTo(S, 6);
    c.stroke();
    for (let x = 8; x < S; x += 16) {
      c.fillStyle = "rgba(120, 210, 235, 0.55)";
      c.beginPath();
      c.arc(x, 12, 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(0,0,0,0.4)";
      c.beginPath();
      c.arc(x, 13, 2, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "rgba(34, 211, 238, 0.12)";
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
    c.fillStyle = "#2e3a4c";
    c.fillRect(0, 0, S, S);
    speckle(c, rnd, S, 36, ["#27323f", "#3c4a5e", "#222c3a"], 1, 3);
    c.fillStyle = "#1f7a3d";
    c.fillRect(0, 0, S, 7);
    c.fillStyle = "rgba(74, 222, 128, 0.55)";
    for (let x = 0; x < S; x += 4) {
      c.fillRect(x, 0, 2, 2 + rnd() * 3);
    }
    c.fillStyle = "rgba(10, 14, 22, 0.35)";
    for (let x = 0; x < S; x += 9) c.fillRect(x + rnd() * 4, S - 10, 2, 8);
  }
  function paintGrate(c, rnd) {
    const S = 96;
    c.fillStyle = "#1e2a38";
    c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(120, 140, 165, 0.35)";
    c.lineWidth = 2;
    for (let i = 0; i < S; i += 12) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, S);
      c.stroke();
    }
    c.strokeStyle = "rgba(0,0,0,0.5)";
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
    c.strokeStyle = "rgba(100, 116, 139, 0.4)";
    c.lineWidth = 1;
    for (let y = 0; y < S; y += 24) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(S, y);
      c.stroke();
    }
    for (let x = 0; x < S; x += 32) {
      c.strokeStyle = "rgba(15, 23, 42, 0.6)";
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, S);
      c.stroke();
      c.fillStyle = "rgba(148, 163, 184, 0.35)";
      c.beginPath();
      c.arc(x + 8, 12, 1.6, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(x + 8, S - 12, 1.6, 0, Math.PI * 2);
      c.fill();
    }
    speckle(c, rnd, S, 14, ["#364457"], 1, 2);
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
        cv = makeTex(96, 23, paintBedrock);
        break;
      case "brick":
        cv = makeTex(96, 31, paintBrick);
        break;
      case "concrete":
        cv = makeTex(96, 41, paintConcrete);
        break;
      case "metal":
        cv = makeTex(96, 53, paintMetal);
        break;
      case "pipeInner":
        cv = makeTex(96, 61, paintPipeInner);
        break;
      case "tunnel":
        cv = makeTex(96, 71, paintTunnel);
        break;
      case "island":
        cv = makeTex(96, 83, paintIsland);
        break;
      case "grate":
        cv = makeTex(96, 97, paintGrate);
        break;
      case "plate":
        cv = makeTex(96, 103, paintPlate);
        break;
      default:
        cv = makeTex(96, 107, paintEarth);
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
  var lastFrame = performance.now();
  var acc = 0;
  var wasDead = false;
  function buildLocalInput() {
    const w = defaultWorldInput();
    if (!localPlayer.deployed) return w;
    if (localPlayer.respawnTimer > 0) {
      if (inputQueue.interact) {
        inputQueue.interact = false;
        return w;
      }
      return w;
    }
    const left = !!(keys["KeyA"] || keys["ArrowLeft"]);
    const right = !!(keys["KeyD"] || keys["ArrowRight"]);
    let move2 = left === right ? 0 : left ? -1 : 1;
    if (touchState.moveActive && Math.abs(touchState.moveX) > 0.18) move2 = touchState.moveX > 0 ? 1 : -1;
    w.move = localPlayer.mountedTowerId ? 0 : move2;
    w.jetpack = !!(keys["KeyW"] || keys["Space"] || keys["ArrowUp"]) || touchState.boostButtonDown || touchState.moveActive && touchState.moveY < -0.32;
    w.dive = !!(keys["KeyS"] || keys["ArrowDown"]) || touchState.moveActive && touchState.moveY > 0.45;
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    const zoom = 1 / camera.fovFactor;
    const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom;
    const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom;
    if (mounted) {
      w.aim = Math.atan2(mouse.y - psy, mouse.x - psx);
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
    pendingLoadout.weaponIndex = WEAPONS[localPlayer.weaponIndex] && !WEAPONS[localPlayer.weaponIndex].isSupplyOnly ? localPlayer.weaponIndex : 0;
    pendingLoadout.secondaryType = localPlayer.secondary === "doll" ? "frag" : localPlayer.secondary;
    updateHudWeaponButtons();
    const ds = document.getElementById("deathScreen");
    if (ds) ds.classList.remove("hidden");
    showToast("\u{1F480} \u5DF2\u9635\u4EA1\uFF1A\u5728\u6B7B\u4EA1\u754C\u9762\u9009\u62E9\u91CD\u751F\u914D\u88C5");
  }
  function onLocalRespawn() {
    const wantW = Number(pendingLoadout.weaponIndex);
    localPlayer.weaponIndex = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0;
    localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : "frag";
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
        if (!dead && wasDead) onLocalRespawn();
        wasDead = dead;
        const deathEl = document.getElementById("deathScreen");
        if (deathEl) {
          deathEl.classList.toggle("hidden", !dead);
          deathEl.classList.toggle("flex", dead);
          if (dead) {
            const cd = document.getElementById("deathCountdown");
            if (cd) cd.textContent = localPlayer.respawnTimer.toFixed(1);
            const kl = document.getElementById("deathKillerLine");
            if (kl) kl.textContent = death.info ? `\u88AB ${death.info.killer}${death.info.weapon ? ` \u7684 ${death.info.weapon}` : ""} \u51FB\u6740` : "\u7B49\u5F85\u91CD\u751F\u2026";
          }
        }
        effects.update(FIXED);
        for (let i = beams.length - 1; i >= 0; i--) {
          beams[i].life -= FIXED;
          if (beams[i].life <= 0) beams.splice(i, 1);
        }
        if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
          if (localPlayer.jetpack) {
            const back = Math.cos(localPlayer.aim) >= 0 ? -1 : 1;
            effects.jet(localPlayer.pos.x + back * 14, localPlayer.pos.y + 6);
          }
          if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
            const w = WEAPONS[localPlayer.weaponIndex];
            effects.muzzle(
              localPlayer.pos.x + Math.cos(localPlayer.aim) * 26,
              localPlayer.pos.y - 12 + Math.sin(localPlayer.aim) * 26,
              w?.color ?? "#fbbf24"
            );
          }
        }
        prevFireCooldown = localPlayer.fireCooldown;
        acc -= FIXED;
        guard++;
      }
      mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) * camera.fovFactor);
      mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) * camera.fovFactor);
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
