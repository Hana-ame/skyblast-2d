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
    build() {
      this.grid.fill(0);
      this.rects.length = 0;
      this.shadows.length = 0;
      this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, "#1e293b", "#334155", "earth");
      const covers = [
        { x: 800, y: SURFACE_Y - 100, w: 120, h: 100, c: "#f43f5e" },
        { x: 2600, y: SURFACE_Y - 80, w: 100, h: 80, c: "#38bdf8" },
        { x: 4600, y: SURFACE_Y - 120, w: 140, h: 120, c: "#f97316" },
        { x: 5800, y: SURFACE_Y - 90, w: 120, h: 90, c: "#10b981" },
        { x: 7800, y: SURFACE_Y - 80, w: 100, h: 80, c: "#a855f7" },
        { x: 10600, y: SURFACE_Y - 110, w: 130, h: 110, c: "#0ea5e9" },
        { x: 12800, y: SURFACE_Y - 90, w: 110, h: 90, c: "#eab308" }
      ];
      for (const c of covers) this.addSolidBlock(c.x, c.y, c.w, c.h, "#1f2937", c.c, "cover", "\u65B9\u5F62\u63A9\u4F53");
      const platformY = SURFACE_Y - 260;
      const platforms = [
        { x: 2200, w: 300, c: "#38bdf8" },
        { x: 3800, w: 260, c: "#10b981" },
        { x: 5400, w: 300, c: "#f97316" },
        { x: 7600, w: 280, c: "#a855f7" },
        { x: 9600, w: 300, c: "#38bdf8" },
        { x: 11800, w: 280, c: "#0ea5e9" }
      ];
      for (const pl of platforms) this.addSolidBlock(pl.x, platformY, pl.w, 22, "#334155", pl.c, "platform", "\u5E73\u53F0");
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
    { id: "obs_1", x: 1600, y: 2720, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_2", x: 3400, y: 2720, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_3", x: 4900, y: 2720, w: 60, h: 80, hp: 240, label: "\u65B9\u5F62\u63A9\u4F53", color: "#78350f", borderColor: "#f59e0b" },
    { id: "obs_box_1", x: 6420, y: 2730, w: 68, h: 70, hp: 170, label: "\u91CD\u88C5\u63A9\u4F53\u7BB1", color: "#365314", borderColor: "#84cc16" },
    { id: "obs_5", x: 9200, y: 2720, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#7c2d12", borderColor: "#fb923c" },
    { id: "obs_6", x: 11200, y: 2720, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_7", x: 12500, y: 2720, w: 60, h: 80, hp: 260, label: "\u65B9\u5F62\u63A9\u4F53", color: "#9a3412", borderColor: "#f97316" }
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
      color: "#fb7185"
    },
    {
      id: 4,
      name: "\u6FC0\u5149",
      shortName: "\u6FC0\u5149",
      isSupplyOnly: true,
      damage: 50,
      headshotMult: 2,
      pellets: 1,
      spread: 0,
      speed: 3e3,
      recoil: 0,
      magSize: 24,
      maxReserve: 48,
      // 24 / 6每秒 = 连续 4 秒（弹量/2）
      reloadTime: 2,
      fireDelay: 0,
      terrainRadius: 18,
      explosive: false,
      laser: true,
      pierceAll: true,
      pierceOnHeadshot: true,
      bounces: 3,
      beam: true,
      damagePerSecond: 240,
      ammoPerSecond: 6,
      moveSpeedMult: 0.95,
      fuelMult: 1,
      fovMult: 1.3,
      color: "#22d3ee"
      // 伤害 ×2
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
  var SPAWN_POINTS = [
    { x: 1100, y: 2740, team: "red" },
    { x: 12100, y: 2740, team: "blue" },
    { x: 6600, y: 1460, team: "green" },
    { x: 6600, y: 2380, team: "ffa" }
  ];
  var AMMO_SPOTS = [
    { x: 1300, y: 2760, area: "\u897F\u533A\u5E73\u5730" },
    { x: 2100, y: 2760, area: "\u897F\u533A\u5E73\u53F0\u4E0B" },
    { x: 2900, y: 2760, area: "\u4E2D\u897F\u5E73\u5730" },
    { x: 4900, y: 2760, area: "\u4E2D\u592E\u897F\u5E73\u5730" },
    { x: 6300, y: 2760, area: "\u4E2D\u592E\u5E73\u5730" },
    { x: 8100, y: 2760, area: "\u4E2D\u4E1C\u5E73\u5730" },
    { x: 10200, y: 2760, area: "\u4E1C\u533A\u5E73\u5730" }
  ];
  var SUPPLY_SPOTS = [
    { x: 1500, y: 2760, area: "\u897F\u533A\u8865\u7ED9\u70B9" },
    { x: 3100, y: 2760, area: "\u4E2D\u897F\u8865\u7ED9\u70B9" },
    { x: 4300, y: 2760, area: "\u4E2D\u592E\u897F\u8865\u7ED9\u70B9" },
    { x: 5100, y: 2760, area: "\u4E2D\u592E\u8865\u7ED9\u70B9" },
    { x: 8300, y: 2760, area: "\u4E2D\u4E1C\u8865\u7ED9\u70B9" },
    { x: 10300, y: 2760, area: "\u4E1C\u533A\u8865\u7ED9\u70B9" }
  ];
  var DOLL_SUPPLY_SPOTS = [
    { x: 4800, y: 2760, area: "\u4E2D\u592E\u897F\u7279\u6B8A\u8865\u7ED9\u70B9" },
    { x: 8560, y: 2760, area: "\u4E1C\u533A\u7279\u6B8A\u8865\u7ED9\u70B9" }
  ];
  var MORTARS_INIT = [
    { id: "mortar_left", name: "\u897F\u533A\u8FEB\u51FB\u70AE", x: 920, y: 2740, angle: -Math.PI * 0.28, power: 24 },
    { id: "mortar_mid_w", name: "\u4E2D\u592E\u897F\u8FEB\u51FB\u70AE", x: 3300, y: 2740, angle: -Math.PI * 0.3, power: 23 },
    { id: "mortar_center", name: "\u4E2D\u592E\u8FEB\u51FB\u70AE", x: 6e3, y: 2740, angle: -Math.PI * 0.35, power: 24.5 },
    { id: "mortar_mid_e", name: "\u4E2D\u592E\u4E1C\u8FEB\u51FB\u70AE", x: 8620, y: 2740, angle: -Math.PI * 0.7, power: 23 },
    { id: "mortar_right", name: "\u4E1C\u533A\u8FEB\u51FB\u70AE", x: 12260, y: 2740, angle: -Math.PI * 0.72, power: 24 }
  ];
  var MINE_PRESETS = [
    { x: 1720, y: 2760 },
    { x: 4150, y: 2760 },
    { x: 6600, y: 2760 },
    { x: 9e3, y: 2760 },
    { x: 11420, y: 2760 },
    { x: 5400, y: 2760 }
  ];
  var WATCHTOWERS = [
    { id: "tower_1", name: "\u897F\u90E8\u77AD\u671B\u5854", x: 3700, y: 2760, operatorId: null },
    { id: "tower_2", name: "\u4E2D\u897F\u77AD\u671B\u5854", x: 7e3, y: 2760, operatorId: null },
    { id: "tower_3", name: "\u4E2D\u592E\u4E1C\u77AD\u671B\u5854", x: 8800, y: 2760, operatorId: null },
    { id: "tower_4", name: "\u4E1C\u90E8\u77AD\u671B\u5854", x: 11900, y: 2760, operatorId: null }
  ];
  var WARP_PORTALS = [
    { id: "warp_1", name: "W1 \u897F\u533A\u4F20\u9001\u95E8", x: 880, y: 2740, targetId: "warp_2", color: "#06b6d4" },
    { id: "warp_2", name: "W2 \u4E2D\u897F\u4F20\u9001\u95E8", x: 3150, y: 2740, targetId: "warp_1", color: "#06b6d4" },
    { id: "warp_3", name: "W3 \u4E2D\u592E\u4F20\u9001\u95E8", x: 4700, y: 2740, targetId: "warp_4", color: "#a855f7" },
    { id: "warp_4", name: "W4 \u4E2D\u4E1C\u4F20\u9001\u95E8", x: 9550, y: 2740, targetId: "warp_3", color: "#a855f7" },
    { id: "warp_5", name: "W5 \u4E2D\u592E\u4E1C\u4F20\u9001\u95E8", x: 6900, y: 2740, targetId: "warp_6", color: "#10b981" },
    { id: "warp_6", name: "W6 \u4E1C\u533A\u4F20\u9001\u95E8", x: 12280, y: 2740, targetId: "warp_5", color: "#10b981" }
  ];
  var RANDOM_SPAWN_CANDIDATES = (() => {
    const out = [];
    for (let x = 400; x < WORLD_W; x += 620) out.push({ x, y: SURFACE_Y - 60 });
    for (const px of [2200, 3800, 5400, 7600, 9600, 11800]) out.push({ x: px + 150, y: SURFACE_Y - 300 });
    for (const sp of SPAWN_POINTS) out.push({ x: sp.x, y: sp.y - 60 });
    for (const cx of [1720, 4150, 6600, 9e3, 11420]) out.push({ x: cx, y: 2740 });
    return out;
  })();
  var JUMP_PADS = [
    // 全部位于可站立地表：远离竖井洞、台地内部与出生点（此前 2 个在竖井里、1 个埋在台地内，且完全没渲染 → "莫名弹起"）
    { x: 1e3, y: 2800, vx: 210, vy: -810 },
    { x: 4300, y: 2800, vx: 180, vy: -870 },
    { x: 8450, y: 2800, vx: -180, vy: -870 },
    { x: 13050, y: 2800, vx: -210, vy: -810 }
  ];
  var CP_INITS = [
    { id: "cp_a", code: "A", name: "\u636E\u70B9A\xB7\u897F\u533A", x: 1720, y: 2740, ownerTeam: "red" },
    { id: "cp_b", code: "B", name: "\u636E\u70B9B\xB7\u4E2D\u592E\u897F", x: 4150, y: 2740, ownerTeam: null },
    { id: "cp_c", code: "C", name: "\u636E\u70B9C\xB7\u4E2D\u592E", x: 6600, y: 2740, ownerTeam: "green" },
    { id: "cp_d", code: "D", name: "\u636E\u70B9D\xB7\u4E2D\u4E1C", x: 9e3, y: 2740, ownerTeam: null },
    { id: "cp_e", code: "E", name: "\u636E\u70B9E\xB7\u4E1C\u533A", x: 11420, y: 2740, ownerTeam: "blue" }
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
    constructor(seed = 12345) {
      this.seed = seed;
      this.rng = new Rng(seed);
      this.terrain.build();
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
        p.vel.x -= Math.cos(p.aim) * wep.recoil * 0.56;
        p.vel.y -= Math.sin(p.aim) * wep.recoil * 0.65;
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
    /** 持续光束：按住开火时每 tick 沿准星射线结算（反射 bounces 次），按 DPS 扣血、按 ammoPerSecond 耗弹 */
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
      const hitPlayer = /* @__PURE__ */ new Set([p.id]);
      const hitObstacle = /* @__PURE__ */ new Set();
      let x = wrapX(p.pos.x + Math.cos(p.aim) * 24);
      let y = p.pos.y - 12 + Math.sin(p.aim) * 24;
      let dx = Math.cos(p.aim);
      let dy = Math.sin(p.aim);
      const maxSegLen = 1800;
      const step = 10;
      const bounces = wep.bounces ?? 0;
      for (let b = 0; b <= bounces; b++) {
        let travelled = 0;
        let hitWall = false;
        while (travelled < maxSegLen) {
          const nx = wrapX(x + dx * step);
          const ny = wrapY(y + dy * step);
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue;
            if (t.id !== p.id && t.team === p.team && p.team !== "ffa") continue;
            const hx = wrapDeltaX(t.pos.x, nx);
            const hy = wrapDeltaY(t.pos.y - 24, ny);
            const isHead = Math.hypot(hx, hy) <= this.config.headRadius + 3;
            const bx = Math.abs(wrapDeltaX(t.pos.x, nx));
            const by = wrapDeltaY(t.pos.y, ny);
            if (isHead || bx <= 14 && by >= -12 && by <= 18) {
              hitPlayer.add(t.id);
              const mult = isHead ? wep.headshotMult : 1;
              this.damage(t, dps * mult * dt, void 0, isHead, false, p.id, p.team, wep.shortName);
            }
          }
          const ob = this.obstacleAt(nx, ny);
          if (ob && !hitObstacle.has(ob.id)) {
            hitObstacle.add(ob.id);
            this.damageObstacle(ob, dps * dt, void 0);
          }
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
          x = nx;
          y = ny;
          travelled += step;
        }
        const seg = { x1: 0, y1: 0, x2: x, y2: y };
        if (segments.length > 0) {
          const prev = segments[segments.length - 1];
          seg.x1 = prev.x2;
          seg.y1 = prev.y2;
        } else {
          seg.x1 = wrapX(p.pos.x + Math.cos(p.aim) * 24);
          seg.y1 = p.pos.y - 12 + Math.sin(p.aim) * 24;
        }
        segments.push(seg);
        if (!hitWall) break;
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
    // 子步进（≤8px/步）：高速弹（激光 3000px/s=50px/帧）不会穿过 20px 墙砖；
    // 引力弹 passWalls=true 忽略原始地形；激光撞墙反弹（bounces 次，每次反弹重置命中列表）。
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
          let absorbed = false;
          for (const orb of this.projectiles) {
            if (!orb.isGravityOrb || orb.life <= 0) continue;
            const dx2 = wrapDeltaX(pr.pos.x, orb.pos.x);
            const dy2 = wrapDeltaY(pr.pos.y, orb.pos.y);
            const d = Math.hypot(dx2, dy2);
            const FIELD = 360;
            const ABSORB = 46;
            if (d <= ABSORB) {
              absorbed = true;
              break;
            }
            if (d > FIELD) continue;
            const falloff = 1 - d / FIELD;
            const cur = Math.atan2(pr.vel.y, pr.vel.x);
            const want = Math.atan2(dy2, dx2);
            let delta = want - cur;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const bend = Math.sign(delta) * Math.min(Math.abs(delta), 7 * falloff * dt);
            const cosB = Math.cos(bend);
            const sinB = Math.sin(bend);
            const vx = pr.vel.x;
            pr.vel.x = vx * cosB - pr.vel.y * sinB;
            pr.vel.y = vx * sinB + pr.vel.y * cosB;
          }
          if (absorbed) {
            pr.life = 0;
            continue;
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
            if (t.id !== pr.owner && t.team === this.ownerTeamOf(pr.owner) && t.team !== "ffa") continue;
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
        if (!isTeammate) {
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

  // src/net/ServerSim.ts
  var ServerSim = class {
    world;
    clients = [];
    events = [];
    constructor(world2) {
      this.world = world2;
    }
    accept(id, transport) {
      const client = { id, transport, input: defaultWorldInput() };
      transport.onClient((msg) => {
        client.input = applyIntents(client.input, msg.intents);
      });
      this.clients.push(client);
    }
    step(dt) {
      const inputs = /* @__PURE__ */ new Map();
      for (const c of this.clients) inputs.set(c.id, c.input);
      this.world.step(dt, inputs);
      for (const c of this.clients) {
        c.input.jump = false;
        c.input.interact = false;
        c.input.secondary = null;
        c.input.switchWeapon = null;
        c.input.reload = false;
      }
      const events = this.world.drainEvents();
      this.events.push(...events);
      const snap = this.world.snapshot();
      const msg = { snap, events };
      for (const c of this.clients) c.transport.send(msg);
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
    for (const it of intents) {
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
    let move2 = 0;
    if (Math.abs(dx) > 320) move2 = dx > 0 ? 1 : -1;
    else if (Math.abs(dx) < 160) move2 = dx > 0 ? -1 : 1;
    return {
      ...defaultWorldInput(),
      move: move2,
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
