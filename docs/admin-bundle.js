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
  var WEAPON_BOOL_KEYS = ["explosive", "pierceOnHeadshot", "pierceAll", "passWalls"];
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
  var CONFIG_BOOL_KEYS = ["randomSpawn", "loadoutLock"];
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
