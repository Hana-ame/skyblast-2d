"use strict";
(() => {
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
      reloadTime: 1.5,
      fireDelay: 0.58,
      shellReloadFireDelayMult: 1.5,
      terrainRadius: 12,
      // 满匣 0.58s；边装边打 0.87s（更慢）
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
  var RECOIL_DECAY = 7;
  var RECOIL_INTEGRAL = (1 - Math.exp(-RECOIL_DECAY * (1 / 60))) / RECOIL_DECAY;

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
  var clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
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
              clean[k] = clamp(n, b[0], b[1]);
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
          if (n !== null) clean[k] = clamp(n, 0, 1e4);
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
          if (n !== null) clean[k] = clamp(n, -5e3, 1e4);
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

  // src/web/main-admin.ts
  var app = document.getElementById("app");
  var statusEl = document.getElementById("status");
  var jsonBox = document.getElementById("jsonBox");
  var baseWeapons = JSON.parse(JSON.stringify(WEAPONS));
  var baseConfig = { ...DEFAULT_CONFIG };
  var basePhysics = { ...getPhysicsParams() };
  var saved = null;
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    if (raw) saved = sanitizeOverrides(JSON.parse(raw));
  } catch {
  }
  if (saved?.weapons) applyWeaponOverrides(saved.weapons);
  var configView = { ...DEFAULT_CONFIG };
  applyConfigOverrides(configView, saved?.config);
  var physicsView = { ...basePhysics, ...saved?.physics ?? {} };
  setPhysicsParams(physicsView);
  var numInput = (value, step = "any", onInput) => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = step;
    el.value = String(value);
    el.addEventListener("input", () => {
      const n = Number(el.value);
      if (Number.isFinite(n)) onInput(n);
    });
    return el;
  };
  function field(labelText, input) {
    const row = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, input);
    return row;
  }
  var weaponsSection = document.createElement("section");
  var h2w = document.createElement("h2");
  h2w.textContent = `\u6B66\u5668\u6570\u503C\uFF08${WEAPONS.length} \u628A\uFF09`;
  weaponsSection.append(h2w);
  var grid = document.createElement("div");
  grid.className = "wep-grid";
  WEAPONS.forEach((wep, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = `${wep.id}. ${wep.name}${wep.isSupplyOnly ? "\uFF08\u8865\u7ED9\uFF09" : ""}`;
    card.append(title);
    const fields = document.createElement("div");
    fields.className = "fields";
    for (const key of WEAPON_NUMERIC_KEYS) {
      const v = wep[key];
      if (v === void 0) continue;
      fields.append(field(String(key), numInput(v, "any", (n) => {
        wep[key] = n;
      })));
    }
    for (const key of WEAPON_BOOL_KEYS) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!wep[key];
      cb.addEventListener("change", () => {
        wep[key] = cb.checked;
      });
      fields.append(field(String(key), cb));
    }
    card.append(fields);
    grid.append(card);
    void idx;
  });
  weaponsSection.append(grid);
  app.append(weaponsSection);
  var configSection = document.createElement("section");
  var h2c = document.createElement("h2");
  h2c.textContent = "\u5168\u5C40\u914D\u7F6E";
  configSection.append(h2c);
  var cfields = document.createElement("div");
  cfields.className = "fields";
  for (const key of CONFIG_NUMERIC_KEYS) {
    const v = configView[key];
    if (v === void 0) continue;
    cfields.append(field(String(key), numInput(v, "any", (n) => {
      configView[key] = n;
    })));
  }
  for (const key of CONFIG_BOOL_KEYS) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!configView[key];
    cb.addEventListener("change", () => {
      configView[key] = cb.checked;
    });
    cfields.append(field(String(key), cb));
  }
  configSection.append(cfields);
  app.append(configSection);
  var physSection = document.createElement("section");
  var h2p = document.createElement("h2");
  h2p.textContent = "\u7269\u7406\u53C2\u6570";
  physSection.append(h2p);
  var pfields = document.createElement("div");
  pfields.className = "fields";
  for (const key of Object.keys(basePhysics)) {
    pfields.append(field(key, numInput(physicsView[key], "any", (n) => {
      physicsView[key] = n;
      setPhysicsParams(physicsView);
    })));
  }
  physSection.append(pfields);
  app.append(physSection);
  function buildOverrides() {
    const out = {};
    const weapons = {};
    WEAPONS.forEach((wep, idx) => {
      const base = baseWeapons[idx];
      const patch = {};
      for (const key of WEAPON_NUMERIC_KEYS) {
        const cur = wep[key];
        if (cur === void 0) continue;
        if (cur !== base[key]) patch[key] = cur;
      }
      for (const key of WEAPON_BOOL_KEYS) {
        const cur = !!wep[key];
        if (cur !== !!base[key]) patch[key] = cur;
      }
      if (Object.keys(patch).length > 0) weapons[String(wep.id)] = patch;
    });
    if (Object.keys(weapons).length > 0) out.weapons = weapons;
    const cfg = {};
    for (const key of CONFIG_NUMERIC_KEYS) {
      const cur = configView[key];
      if (cur !== void 0 && cur !== baseConfig[key]) cfg[key] = cur;
    }
    for (const key of CONFIG_BOOL_KEYS) {
      if (!!configView[key] !== !!baseConfig[key]) cfg[key] = !!configView[key];
    }
    if (Object.keys(cfg).length > 0) out.config = cfg;
    const phys = {};
    for (const key of Object.keys(basePhysics)) {
      const baseVal = basePhysics[key];
      if (physicsView[key] !== baseVal) phys[key] = physicsView[key];
    }
    if (Object.keys(phys).length > 0) out.physics = phys;
    return out;
  }
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }
  function save() {
    const ov = buildOverrides();
    const hasAny = !!ov.weapons || !!ov.config || !!ov.physics;
    if (hasAny) localStorage.setItem(BALANCE_KEY, JSON.stringify(ov));
    else localStorage.removeItem(BALANCE_KEY);
    setStatus(hasAny ? "\u5DF2\u4FDD\u5B58\u8986\u76D6\uFF08\u4E0B\u6B21\u542F\u52A8\u6E38\u620F\u751F\u6548\uFF09" : "\u4E0E\u9ED8\u8BA4\u503C\u4E00\u81F4\uFF0C\u5DF2\u6E05\u9664\u8986\u76D6");
    return hasAny ? ov : null;
  }
  document.getElementById("btnSave")?.addEventListener("click", () => {
    save();
  });
  document.getElementById("btnApply")?.addEventListener("click", () => {
    save();
    window.location.href = "./index.html";
  });
  document.getElementById("btnGame")?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
  document.getElementById("btnReset")?.addEventListener("click", () => {
    localStorage.removeItem(BALANCE_KEY);
    localStorage.removeItem("pvp-physics-params-v2");
    setStatus("\u5DF2\u6062\u590D\u9ED8\u8BA4\uFF0C\u6B63\u5728\u5237\u65B0\u2026");
    window.location.reload();
  });
  document.getElementById("btnExport")?.addEventListener("click", () => {
    const ov = buildOverrides();
    jsonBox.style.display = "block";
    jsonBox.value = JSON.stringify(ov, null, 2);
    jsonBox.focus();
    jsonBox.select();
    setStatus("\u5DF2\u751F\u6210\u8986\u76D6 JSON\uFF08\u53EF\u76F4\u63A5\u590D\u5236\uFF09");
  });
  document.getElementById("btnImport")?.addEventListener("click", () => {
    jsonBox.style.display = "block";
    const raw = jsonBox.value.trim();
    if (!raw) {
      setStatus("\u8BF7\u5148\u628A JSON \u7C98\u8D34\u5230\u4E0B\u65B9\u6587\u672C\u6846\uFF0C\u518D\u70B9\u4E00\u6B21\u5BFC\u5165");
      return;
    }
    try {
      const ov = sanitizeOverrides(JSON.parse(raw));
      if (!ov) {
        setStatus("JSON \u65E0\u6548\uFF08\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u8986\u76D6\uFF09");
        return;
      }
      localStorage.setItem(BALANCE_KEY, JSON.stringify(ov));
      setStatus("\u5DF2\u5BFC\u5165\u8986\u76D6\uFF0C\u6B63\u5728\u5237\u65B0\u2026");
      window.location.reload();
    } catch {
      setStatus("JSON \u89E3\u6790\u5931\u8D25");
    }
  });
})();
