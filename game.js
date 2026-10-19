/* ==========================================================================
   myHeroDuelArena v1.2.0 — CHAMPIONS, BATTLEFIELD TERRAIN & TACTICAL AI
   ==========================================================================

   SECTION GUIDE
     1.  App config & constants
     2.  Battlefield terrain
     3.  Champion abilities
     4.  Champion progression
     5.  AI tuning
     6.  DOM elements
     7.  Game state
     8.  Unit data & formation
     9.  Terrain helpers
     10. Temporary effects
     11. Rendering
     12. Selection
     13. Movement
     14. Targeting & line of sight
     15. Damage
     16. Ability execution
     17. Progression storage
     18. Turn management
     19. Tactical AI
     20. Battle end & rematch
     21. UI helpers
     22. Initialisation
     23. Test surface

   DESIGN RULES (kept deliberately small and explicit)
     * One source of truth: the player and the AI use the same movement,
       targeting, line-of-sight, damage and ability code.
     * Terrain is data, not decoration. Every cell has one terrain type and
       that type alone decides movement cost, cover, aim and sight.
     * Permanent progression (champion level) is separate from battle state.
     * Every state change goes through one validation function.
   ========================================================================== */

"use strict";

/* 1. APP CONFIG & CONSTANTS */

const APP_NAME = "myHeroDuelArena";
const APP_VERSION = "v1.2.0";

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

/* 1.1 BATTLEFIELD GRID
 * Logical grid: 10 columns x 4 rows, rendered as a single shared field.
 *   col = advance axis (0 = far left, 9 = far right).
 *   row = lateral slot (0-3); row 0 is the lowest row on screen.
 */
const GRID_COLS = 10;
const GRID_ROWS = 4;

/* 1.2 TURN STATES */
const STATE_INIT = "init";
const STATE_PLAYER_SELECTING = "player_selecting";
const STATE_ENEMY_TURN = "enemy_turn";
const STATE_ENDED = "ended";

/* 1.3 UNIT TYPE STATS */
const UNIT_STATS = {
  archer:   { hp: 40, atk: 14, def: 4,  move: 2, range: 4,  special: null },
  footman:  { hp: 60, atk: 12, def: 6,  move: 1, range: 1,  special: null },
  ballista: { hp: 45, atk: 18, def: 3,  move: 1, range: 5,  special: null },
  chevalier:{ hp: 55, atk: 16, def: 5,  move: 3, range: 1,  special: null },
  champion: { hp: 90, atk: 20, def: 8,  move: 2, range: 1,  special: "rally" }
};

/* 1.4 CHAMPION ABILITY SET — every champion owns the same three abilities. */
const CHAMPION_ABILITIES = ["rally", "power_strike", "guarding_aura"];

/* 2. BATTLEFIELD TERRAIN
 *
 * cost    — movement points spent to enter the cell
 * def     — flat defense bonus for a unit standing on the cell
 * aim     — flat damage bonus for a ranged attack made from the cell
 * sight   — true when the cell blocks ranged line of sight
 * passable— false for impassable rock formations
 */
const TERRAIN_TYPES = {
  grass: {
    id: "grass", label: "Open Grassland", short: "Grass",
    cost: 1, def: 0, aim: 0, sight: false, passable: true
  },
  forest: {
    id: "forest", label: "Forest", short: "Forest",
    cost: 1, def: 2, aim: 0, sight: true, passable: true
  },
  rock: {
    id: "rock", label: "Rocky Ground", short: "Rock",
    cost: 2, def: 1, aim: 0, sight: false, passable: true
  },
  highground: {
    id: "highground", label: "High Ground", short: "High ground",
    cost: 1, def: 0, aim: 1, sight: false, passable: true
  },
  boulder: {
    id: "boulder", label: "Rock Formation", short: "Boulder",
    cost: Infinity, def: 0, aim: 0, sight: true, passable: false
  }
};

/* 2.1 TERRAIN MAP
 * One character per cell, one string per logical row (row 0 is the lowest row
 * on screen). The map is fixed so every battle starts identically and neither
 * army is given better ground than the other.
 *
 *   G = grass   F = forest   R = rock   H = high ground   B = boulder
 *
 * The layout is mirror symmetric (col <-> 9 - col):
 *   row 0  BFGGHHGGFB   row 1  GGFFFFFFGG
 *   row 2  GRGGHHGGRG   row 3  GGFGGGGFGG
 */
const TERRAIN_MAP = [
  "BFGGHHGGFB",
  "GGFFFFFFGG",
  "GRGGHHGGRG",
  "GGFGGGGFGG"
];

const TERRAIN_LEGEND = {
  G: "grass", F: "forest", R: "rock", H: "highground", B: "boulder"
};

/* 3. CHAMPION ABILITIES
 *
 * actionCost decides what the ability consumes:
 *   "ability" — only the ability allowance; the champion may still act.
 *   "attack"  — the attack action; the champion may still move.
 *   "turn"    — the whole turn; the champion may not move or attack.
 */
const ABILITIES = {
  rally: {
    id: "rally",
    name: "Rally Allies",
    description: "Living allies within 2 tiles gain +3 ATK and +2 DEF for one round.",
    type: "support",
    radius: 2,
    atkBonus: 3,
    defBonus: 2,
    duration: 1,
    includeSelf: false,
    actionCost: "ability",
    usesPerBattle: 1,
    unlockLevel: 1,
    unlockCost: 0
  },
  power_strike: {
    id: "power_strike",
    name: "Power Strike",
    description: "A heavy melee blow that deals 8 extra damage. Uses the attack action.",
    type: "offensive",
    range: 1,
    damageBonus: 8,
    actionCost: "attack",
    usesPerBattle: 2,
    unlockLevel: 2,
    unlockCost: 1
  },
  guarding_aura: {
    id: "guarding_aura",
    name: "Guarding Aura",
    description: "Living allies within 2 tiles gain +3 DEF for two rounds. Uses the whole turn.",
    type: "defensive",
    radius: 2,
    defBonus: 3,
    duration: 2,
    includeSelf: true,
    actionCost: "turn",
    usesPerBattle: 2,
    unlockLevel: 3,
    unlockCost: 1
  }
};

/* 4. CHAMPION PROGRESSION
 *
 * LEVEL_THRESHOLDS[i] is the total experience needed to reach level i + 1.
 * LEVEL_REWARDS[i] holds the permanent bonuses granted by level i + 1.
 * Every level grants exactly one ability point, so a profile at level N has
 * earned N points in total.
 */
const MAX_LEVEL = 5;
const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700];
const LEVEL_REWARDS = [
  { hp: 0,  atk: 0, def: 0 },
  { hp: 5,  atk: 0, def: 0 },
  { hp: 5,  atk: 1, def: 0 },
  { hp: 10, atk: 1, def: 1 },
  { hp: 10, atk: 2, def: 2 }
];

/* Experience awards. A unit is only ever rewarded once, the extra champion
 * bonus stacks on top of the champion's own value. */
const XP_REWARDS = {
  archer: 20, footman: 15, ballista: 35, chevalier: 30, champion: 60
};
const XP_CHAMPION_BONUS = 40;
const XP_VICTORY_BONUS = 50;

/* Progression is stored under a namespaced key. */
const STORAGE_KEY = "myHeroDuelArena.championProfile.v1";
const PROFILE_VERSION = 1;

/* 5. AI TUNING
 * Every magic number the AI uses lives here so the behaviour can be
 * reasoned about and tuned in one place.
 */
const AI_TUNING = {
  damageWeight: 1.0,          /* score per point of damage dealt         */
  killBonus: 45,              /* score for removing a unit                */
  targetValue: {              /* score for the unit that falls            */
    champion: 34, ballista: 20, chevalier: 18, archer: 14, footman: 8
  },
  finishBonus: 12,            /* score for hitting an already wounded unit*/
  actNowBonus: 3,             /* small bias for striking without moving  */
  retaliationWeight: 0.35,    /* penalty for trading blows               */
  advanceWeight: 4,           /* score per column advanced toward the foe*/
  coverWeight: 3,             /* score per point of terrain cover        */
  elevationWeight: 7,         /* score for a ranged unit on high ground  */
  threatWeight: 0.25,         /* penalty per point of EXTRA incoming damage */
  safetyBonus: 12,            /* score for escaping danger while wounded */
  retreatPenalty: 8,          /* penalty for a pointless retreat         */
  oscillationPenalty: 10,     /* penalty for walking back where we came  */
  meleeAdvanceBonus: 4,       /* extra pull toward the enemy for melee   */
  supportPerAlly: 16,         /* score per ally a support ability helps  */
  supportMinimum: 2,          /* allies needed before a support is worth it */
  guardPerAlly: 12,           /* score per ally a defensive aura covers  */
  threatenedBonus: 8,         /* extra score for covering a threatened ally */
  offensiveAbilityBonus: 28,  /* score for a damaging champion ability   */
  offensiveAbilityDamage: 1.2,/* damage weight for the same              */
  minActionScore: 2           /* an action must be worth this much to run*/
};

/* AI turn pacing. Short enough that a full turn does not feel like a wait,
 * long enough that each action is readable. */
const AI_TIMING = {
  attack: 320,
  move: 380,
  ability: 300,
  gap: 200
};

/* 6. DOM ELEMENTS */

const $status = document.getElementById("status");
const $startButton = document.getElementById("start-button");
const $selectionInfo = document.getElementById("selection-info");
const $selectedName = document.getElementById("selected-name");
const $selectedStats = document.getElementById("selected-stats");
const $selectedHealth = document.getElementById("selected-health");
const $actionHints = document.getElementById("action-hints");
const $battleResult = document.getElementById("battle-result");
const $turnBanner = document.getElementById("turn-banner");
const $turnText = document.getElementById("turn-text");
const $roundText = document.getElementById("round-text");
const $combatLog = document.getElementById("combat-log");
const $endTurnButton = document.getElementById("end-turn-button");
const $abilityWrap = document.getElementById("ability-button-wrap");
const $abilityActions = document.getElementById("ability-actions");

const $blueUnits = document.getElementById("blue-units");
const $redUnits = document.getElementById("red-units");
const $moveIndicators = document.getElementById("move-indicators");
const $attackIndicators = document.getElementById("attack-indicators");
const $battlefield = document.getElementById("battlefield");
const $terrainLayer = document.getElementById("terrain-layer");

const $progressionStrip = document.getElementById("progression-strip");
const $progLevel = document.getElementById("prog-level");
const $progXpFill = document.getElementById("prog-xp-fill");
const $progXpText = document.getElementById("prog-xp-text");
const $progPoints = document.getElementById("prog-points");
const $resetProgressButton = document.getElementById("reset-progress-button");

const $championPanel = document.getElementById("champion-panel");
const $champLevel = document.getElementById("champ-level");
const $champStats = document.getElementById("champ-stats");
const $abilityList = document.getElementById("ability-list");

const $levelUpBanner = document.getElementById("level-up-banner");
const $levelUpText = document.getElementById("level-up-text");

/* 7. GAME STATE */

let gameState = STATE_INIT;
let battleActive = false;
let currentTurn = "player";
let roundNumber = 1;
let selectedUnitId = null;
let moveIndicators = [];
let attackIndicators = [];
let aiActionQueue = [];
let aiActionIndex = 0;
let actionLock = false;

/* Incremented for every battle. AI continuations compare against it so a
 * rematch can never be touched by a timer that was scheduled for the
 * previous battle. */
let battleToken = 0;
let currentBattleToken = 0;

/* Battle identifier used to build unique reward keys. */
let battleId = 0;

/* A battle result is finalised exactly once, no matter how often the end
 * check runs. */
let battleFinalized = false;

/* Reward keys already handed out in this session. */
const awardedRewards = new Set();

/* Pending timers are tracked so a reset can cancel them safely. */
const pendingTimers = new Set();

/* When set, deferred work runs straight away instead of on a timer. The
 * verification suites use it to resolve a whole AI turn in one step, so a
 * full battle can be simulated without waiting for the animation delays. */
let instantTimers = false;

function later(fn, delay) {
  if (instantTimers) {
    fn();
    return null;
  }
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, delay);
  pendingTimers.add(id);
  return id;
}

function cancelPendingTimers() {
  pendingTimers.forEach(id => clearTimeout(id));
  pendingTimers.clear();
}

/* 8. UNIT DATA & FORMATION */

function createUnit(id, team, type) {
  const stats = UNIT_STATS[type] || UNIT_STATS.footman;
  return {
    id,
    team,
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    displayName: type.charAt(0).toUpperCase() + type.slice(1),
    maxHp: stats.hp,
    hp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    move: stats.move,
    range: stats.range,
    special: stats.special,
    abilities: type === "champion" ? CHAMPION_ABILITIES.slice() : [],
    alive: true,
    defeated: false,
    col: 0,
    row: 0,
    hasMoved: false,
    hasAttacked: false,
    abilityUses: {},
    effects: [],
    lastAiCell: null,
    selected: false,
    target: false
  };
}

/* 8.1 INITIAL FORMATION
 * Each army occupies 4 columns. Blue holds columns 0-3, red columns 6-9,
 * leaving columns 4-5 as neutral ground between the two lines.
 */
const BLUE_FORMATION = [
  { type: "footman", col: 3, row: 0 },
  { type: "footman", col: 3, row: 1 },
  { type: "footman", col: 3, row: 2 },
  { type: "footman", col: 3, row: 3 },
  { type: "archer", col: 2, row: 0 },
  { type: "archer", col: 2, row: 1 },
  { type: "archer", col: 2, row: 2 },
  { type: "archer", col: 2, row: 3 },
  { type: "ballista", col: 1, row: 0 },
  { type: "chevalier", col: 1, row: 3 },
  { type: "champion", col: 0, row: 1 }
];

const RED_FORMATION = BLUE_FORMATION.map(slot => ({
  type: slot.type,
  col: GRID_COLS - 1 - slot.col,
  row: slot.row
}));

function createArmy(team) {
  const formation = team === TEAM_BLUE ? BLUE_FORMATION : RED_FORMATION;
  return formation.map((slot, i) => {
    const unit = createUnit(`${team}-${i}`, team, slot.type);
    unit.col = slot.col;
    unit.row = slot.row;
    return unit;
  });
}

const units = new Map();
const blueUnitIds = [];
const redUnitIds = [];
const unitElements = new Map();

function initArmies() {
  units.clear();
  blueUnitIds.length = 0;
  redUnitIds.length = 0;

  const blue = createArmy(TEAM_BLUE);
  const red = createArmy(TEAM_RED);

  blue.forEach(u => { units.set(u.id, u); blueUnitIds.push(u.id); });
  red.forEach(u => { units.set(u.id, u); redUnitIds.push(u.id); });
}

function getUnit(id) { return units.get(id) || null; }

function getTeamUnits(team) {
  const ids = team === TEAM_BLUE ? blueUnitIds : redUnitIds;
  return ids.map(id => units.get(id)).filter(u => u && u.alive && !u.defeated);
}

function getChampion(team) {
  const ids = team === TEAM_BLUE ? blueUnitIds : redUnitIds;
  for (const id of ids) {
    const u = units.get(id);
    if (u && u.type === "champion") return u;
  }
  return null;
}

function getPlayerChampion() { return getChampion(TEAM_BLUE); }
function getEnemyChampion() { return getChampion(TEAM_RED); }

/* 9. TERRAIN HELPERS */

function isInBounds(col, row) {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

/* The single source of truth for what a cell contains. */
function getTerrainAt(col, row) {
  if (!isInBounds(col, row)) return TERRAIN_TYPES.boulder;
  const rowMap = TERRAIN_MAP[row] || "";
  const key = rowMap[col] || "G";
  return TERRAIN_TYPES[TERRAIN_LEGEND[key]] || TERRAIN_TYPES.grass;
}

function getMovementCost(col, row) {
  return getTerrainAt(col, row).cost;
}

function isTerrainPassable(col, row) {
  return getTerrainAt(col, row).passable;
}

function getTerrainModifiers(col, row) {
  const t = getTerrainAt(col, row);
  return { cost: t.cost, def: t.def, aim: t.aim, sight: t.sight, passable: t.passable, label: t.label, id: t.id };
}

/* Defense granted by the ground a unit stands on. */
function getTerrainDefBonus(unit) {
  if (!unit) return 0;
  return getTerrainAt(unit.col, unit.row).def;
}

/* Aim granted by the ground a unit shoots from. Only ranged units benefit. */
function getTerrainAimBonus(unit) {
  if (!unit || unit.range <= 1) return 0;
  return getTerrainAt(unit.col, unit.row).aim;
}

function describeTerrain(col, row) {
  const t = getTerrainAt(col, row);
  if (!t.passable) return `${t.label} — impassable`;
  const notes = [];
  if (t.def > 0) notes.push(`cover +${t.def} DEF`);
  if (t.aim > 0) notes.push("+1 ranged damage");
  if (t.sight) notes.push("blocks line of sight");
  if (t.cost > 1) notes.push(`move cost ${t.cost}`);
  return notes.length ? `${t.label} — ${notes.join(", ")}` : t.label;
}

/* 10. TEMPORARY EFFECTS
 * Every timed bonus is stored as an effect entry so several abilities can be
 * active at once without one overwriting the other.
 */
function createEffect(abilityId, stat, amount, duration, sourceId) {
  return {
    abilityId,
    stat,
    amount,
    duration,
    turnsLeft: duration,
    sourceId
  };
}

function getUnitAtkBonus(unit) {
  if (!unit || !unit.effects) return 0;
  let total = 0;
  for (const e of unit.effects) if (e.stat === "atk") total += e.amount;
  return total;
}

function getUnitDefBonus(unit) {
  if (!unit || !unit.effects) return 0;
  let total = 0;
  for (const e of unit.effects) if (e.stat === "def") total += e.amount;
  return total;
}

function hasEffect(unit, abilityId) {
  if (!unit || !unit.effects) return false;
  return unit.effects.some(e => e.abilityId === abilityId);
}

/* Effects are counted down once per round change. */
function expireTemporaryEffects() {
  for (const [, unit] of units) {
    if (!unit.effects || unit.effects.length === 0) continue;
    const kept = [];
    for (const e of unit.effects) {
      e.turnsLeft -= 1;
      if (e.turnsLeft > 0) {
        kept.push(e);
      } else {
        const el = unitElements.get(unit.id);
        if (el) el.classList.remove("rallied", "guarded");
      }
    }
    unit.effects = kept;
  }
}

/* 11. RENDERING */

function renderArmies() {
  $blueUnits.innerHTML = "";
  $redUnits.innerHTML = "";
  $moveIndicators.innerHTML = "";
  $attackIndicators.innerHTML = "";
  unitElements.clear();

  renderArmy(TEAM_BLUE, $blueUnits, blueUnitIds);
  renderArmy(TEAM_RED, $redUnits, redUnitIds);
}

function renderArmy(team, container, ids) {
  ids.forEach(id => {
    const unit = units.get(id);
    const element = renderUnit(unit);
    container.appendChild(element);
    unitElements.set(id, element);
  });
}

function renderUnit(unit) {
  const element = document.createElement("div");
  element.className = `unit ${unit.type} ${unit.team}`;
  element.dataset.id = unit.id;

  const symbol = document.createElement("div");
  symbol.className = "unit-silhouette";
  /* The <svg> wrapper keeps <use> in the SVG namespace — an HTML parser only
   * creates real SVG elements inside an <svg> subtree. */
  symbol.innerHTML = `<svg viewBox="0 0 100 100" class="unit-glyph"><use href="#sil-${unit.type}"></use></svg>`;

  const label = document.createElement("div");
  label.className = "unit-label";
  label.textContent = unit.name.charAt(0);

  const healthWrap = document.createElement("div");
  healthWrap.className = "unit-health";
  const healthFill = document.createElement("div");
  healthFill.className = "health-fill";
  healthWrap.appendChild(healthFill);

  const ring = document.createElement("div");
  ring.className = "selection-ring";

  element.append(symbol, label, healthWrap, ring);
  updateUnitHealthBar(element, unit);
  positionUnit(element, unit);

  element.addEventListener("click", () => onUnitClick(unit.id));

  return element;
}

/* 11.1 TERRAIN RENDERING
 * The terrain layer is purely decorative; it never intercepts a click.
 */
function renderTerrain() {
  if (!$terrainLayer) return;
  $terrainLayer.innerHTML = "";
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const terrain = getTerrainAt(col, row);
      const cell = document.createElement("div");
      cell.className = `terrain-cell terrain-${terrain.id}`;
      cell.style.left = `${colPercent(col)}%`;
      cell.style.top = `${rowPercent(row)}%`;
      cell.dataset.col = String(col);
      cell.dataset.row = String(row);
      cell.title = describeTerrain(col, row);
      $terrainLayer.appendChild(cell);
    }
  }
}

/* 11.2 POSITION MAPPING
 * Every unit and marker lives in the same full-width field layer, so the
 * global grid column maps straight onto a percentage of the field.
 */
function colPercent(col) {
  return ((col + 0.5) / GRID_COLS) * 100;
}

/* Rows are anchored from the top of the field so that a box centred with
 * translate(-50%, -50%) lands on the row centre. The logical row 0 is the
 * lowest row on screen, hence the inversion. */
function rowPercent(row) {
  return 100 - ((row + 0.5) / GRID_ROWS) * 100;
}

function positionUnit(element, unit) {
  element.style.left = `${colPercent(unit.col)}%`;
  element.style.top = `${rowPercent(unit.row)}%`;
}

function updateUnitHealthBar(element, unit) {
  const fill = element.querySelector(".health-fill");
  if (!fill) return;
  const pct = Math.max(0, Math.min(100, Math.round((unit.hp / unit.maxHp) * 100)));
  fill.style.width = `${pct}%`;

  if (pct <= 30) {
    fill.style.background = "#f87171";
  } else if (unit.team === TEAM_BLUE) {
    fill.style.background = "#60a5fa";
  } else {
    fill.style.background = "#f87171";
  }
}

function refreshAllHealthBars() {
  unitElements.forEach((element, id) => {
    const unit = units.get(id);
    if (unit) updateUnitHealthBar(element, unit);
  });
}

/* 12. SELECTION */

function clearSelection() {
  selectedUnitId = null;
  pendingAbilityId = null;
  units.forEach(u => { u.selected = false; u.target = false; });
  unitElements.forEach(el => {
    el.classList.remove("selected", "target");
    const ring = el.querySelector(".selection-ring");
    if (ring) ring.classList.remove("selection-ring-active");
  });
  clearMoveIndicators();
  clearAttackIndicators();
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $actionHints.textContent = "";
  updateChampionPanel();
}

/* An offensive ability is played by picking a target, so the pending
 * ability is remembered between the button press and the click. */
let pendingAbilityId = null;

function selectUnit(id) {
  const unit = units.get(id);
  if (!unit || !unit.alive || unit.defeated) return;

  clearSelection();
  selectedUnitId = id;
  unit.selected = true;

  const el = unitElements.get(id);
  if (el) {
    el.classList.add("selected");
    const ring = el.querySelector(".selection-ring");
    if (ring) ring.classList.add("selection-ring-active");
  }

  $selectionInfo.classList.remove("hidden");
  $selectedName.textContent = unit.displayName;
  $selectedStats.textContent = `ATK ${unit.atk} | DEF ${unit.def} | RNG ${unit.range}`;
  $selectedHealth.style.width = "100%";

  const hints = [];
  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    if (!unit.hasMoved) hints.push("Can move");
    if (!unit.hasAttacked) hints.push("Can attack");
    const ready = getReadyAbilities(unit);
    if (ready.length > 0) hints.push(`${ready.length} ability ready`);
    if (!hints.length) hints.push("No actions available");
  }
  $actionHints.textContent = hints.join(" · ");

  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    showMoveIndicators(unit);
    showAttackIndicators(unit);
    renderAbilityActions(unit);
  }

  updateChampionPanel();
  updateBattleStatus();
}

/* 13. MOVEMENT
 * Orthogonal steps only. A unit may not enter an occupied cell, may not
 * cross an impassable cell and may never spend more movement points than
 * its allowance. The same routine draws the reachable set and validates an
 * action, so the preview can never lie.
 */
const MOVE_DIRECTIONS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

function isOccupied(col, row, excludeId) {
  for (const [id, u] of units) {
    if (id === excludeId) continue;
    if (!u.alive || u.defeated) continue;
    if (u.col === col && u.row === row) return true;
  }
  return false;
}

function getReachableCells(unit) {
  const budget = unit.move;
  const startKey = `${unit.col},${unit.row}`;
  const best = new Map([[startKey, 0]]);
  const queue = [{ col: unit.col, row: unit.row, cost: 0 }];

  while (queue.length > 0) {
    /* Small grid: a linear scan for the cheapest open cell is plenty. */
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[bestIndex].cost) bestIndex = i;
    }
    const current = queue.splice(bestIndex, 1)[0];
    const currentKey = `${current.col},${current.row}`;
    if (current.cost > best.get(currentKey)) continue;

    for (const [dc, dr] of MOVE_DIRECTIONS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (!isInBounds(nc, nr)) continue;
      if (isOccupied(nc, nr, unit.id)) continue;
      const terrain = getTerrainAt(nc, nr);
      if (!terrain.passable) continue;

      const cost = current.cost + terrain.cost;
      if (cost > budget) continue;

      const key = `${nc},${nr}`;
      if (cost < (best.has(key) ? best.get(key) : Infinity)) {
        best.set(key, cost);
        queue.push({ col: nc, row: nr, cost });
      }
    }
  }

  const cells = [];
  for (const [key, cost] of best) {
    if (key === startKey) continue;
    const parts = key.split(",");
    cells.push({ col: Number(parts[0]), row: Number(parts[1]), cost });
  }
  /* Stable order keeps the AI and the UI deterministic. */
  cells.sort((a, b) => (a.col - b.col) || (a.row - b.row));
  return cells;
}

function canMoveTo(unit, col, row) {
  if (!isInBounds(col, row)) return false;
  if (isOccupied(col, row, unit.id)) return false;
  if (!isTerrainPassable(col, row)) return false;
  return getReachableCells(unit).some(c => c.col === col && c.row === row);
}

function moveUnit(unit, col, row) {
  if (!canMoveTo(unit, col, row)) return false;

  unit.col = col;
  unit.row = row;
  unit.hasMoved = true;

  const el = unitElements.get(unit.id);
  if (el) {
    positionUnit(el, unit);
    el.classList.add("moving");
    later(() => el.classList.remove("moving"), 400);
  }

  logEvent(`${unit.displayName} moves to (${col},${row}).`, "player");
  return true;
}

/* 14. TARGETING & LINE OF SIGHT */

function manhattanDistance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/* Bresenham line between two cells. The grid is small enough that a simple
 * integer walk is both accurate and fast. */
function traceCells(c0, r0, c1, r1) {
  const cells = [];
  let x = c0, y = r0;
  const dx = Math.abs(c1 - c0);
  const dy = Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1;
  const sy = r0 < r1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    cells.push({ col: x, row: y });
    if (x === c1 && y === r1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return cells;
}

/* Terrain that blocks sight stops a ranged shot. Melee is never blocked. */
function hasLineOfSight(from, to, range) {
  if (range !== undefined && range <= 1) return true;
  const cells = traceCells(from.col, from.row, to.col, to.row);
  for (let i = 1; i < cells.length - 1; i++) {
    if (getTerrainAt(cells[i].col, cells[i].row).sight) return false;
  }
  return true;
}

function getValidTargets(unit, from) {
  const pos = from || unit;
  const targets = [];
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team === unit.team) continue;
    if (manhattanDistance(pos, u) > unit.range) continue;
    if (!hasLineOfSight(pos, u, unit.range)) continue;
    targets.push(u);
  }
  return targets;
}

function canAttack(attacker, target) {
  if (!attacker || !target) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!target.alive || target.defeated) return false;
  if (attacker.team === target.team) return false;
  if (attacker.hasAttacked) return false;
  if (manhattanDistance(attacker, target) > attacker.range) return false;
  if (!hasLineOfSight(attacker, target, attacker.range)) return false;
  return true;
}

/* 15. DAMAGE
 * The same calculation is used by the player, by champion abilities and by
 * the AI, so nobody fights by different rules.
 */
function calculateDamage(attacker, defender, options) {
  const opts = options || {};
  const attackerPos = opts.attackerPos || attacker;
  const defenderPos = opts.defenderPos || defender;

  const atkBonus = getUnitAtkBonus(attacker) + (opts.extraDamage || 0);
  const defBonus = getUnitDefBonus(defender) + getTerrainDefBonus(defenderPos);
  const aimBonus = opts.useTerrainAim === false ? 0 : getTerrainAimBonus(attackerPos);

  const raw = attacker.atk + atkBonus + aimBonus - Math.floor((defender.def + defBonus) / 2);
  return Math.max(1, raw);
}

function applyDamage(targetId, amount) {
  const target = units.get(targetId);
  if (!target || !target.alive || target.defeated) return 0;

  target.hp = Math.max(0, target.hp - amount);
  const el = unitElements.get(targetId);
  if (el) {
    updateUnitHealthBar(el, target);
    el.classList.add("damaged");
    later(() => el.classList.remove("damaged"), 500);
  }

  if (target.hp <= 0) {
    target.alive = false;
    target.defeated = true;
    target.effects = [];
    if (el) {
      el.classList.add("defeated");
      el.style.pointerEvents = "none";
    }
    /* The reward is keyed by the battle, so it can only ever be paid once. */
    awardExperienceForDefeat(target);
    return amount;
  }
  return amount;
}

/* 16. ABILITY EXECUTION */

/* Both champions share the same unlocked ability set so neither side gains
 * an advantage the other cannot reach. */
function getUnlockedAbilities() {
  return progression.unlocked.slice();
}

function isAbilityUnlocked(abilityId) {
  return getUnlockedAbilities().includes(abilityId);
}

function getAbilityUses(unit, abilityId) {
  if (!unit.abilityUses) return 0;
  return unit.abilityUses[abilityId] || 0;
}

function getReadyAbilities(unit) {
  if (!unit || unit.type !== "champion") return [];
  const ready = [];
  for (const id of unit.abilities || []) {
    const ability = ABILITIES[id];
    if (!ability) continue;
    if (!isAbilityUnlocked(id)) continue;
    if (getAbilityUses(unit, id) >= ability.usesPerBattle) continue;
    if (ability.actionCost === "attack" && unit.hasAttacked) continue;
    if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) continue;
    ready.push(ability);
  }
  return ready;
}

/* One validation point for every ability use, whoever triggers it. */
function canUseAbility(unit, ability, targetId) {
  if (!unit || !ability) return false;
  if (!unit.alive || unit.defeated) return false;
  if (unit.type !== "champion") return false;
  if (!battleActive || gameState === STATE_ENDED) return false;
  if (currentTurn !== "player" || unit.team !== TEAM_BLUE) return false;
  if (actionLock) return false;
  if (!isAbilityUnlocked(ability.id)) return false;
  if (getAbilityUses(unit, ability.id) >= ability.usesPerBattle) return false;
  if (ability.actionCost === "attack" && unit.hasAttacked) return false;
  if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) return false;

  if (ability.type === "offensive") {
    const target = units.get(targetId);
    if (!target) return false;
    if (!target.alive || target.defeated) return false;
    if (target.team === unit.team) return false;
    if (manhattanDistance(unit, target) > ability.range) return false;
    if (!hasLineOfSight(unit, target, ability.range)) return false;
  }
  return true;
}

/* The AI uses the same rules, so it gets its own validator that only
 * differs in the phase check. */
function canAiUseAbility(unit, ability, targetId) {
  if (!unit || !ability) return false;
  if (!unit.alive || unit.defeated) return false;
  if (unit.type !== "champion") return false;
  if (!battleActive || gameState === STATE_ENDED) return false;
  if (currentTurn !== "enemy" || unit.team !== TEAM_RED) return false;
  if (!isAbilityUnlocked(ability.id)) return false;
  if (getAbilityUses(unit, ability.id) >= ability.usesPerBattle) return false;
  if (ability.actionCost === "attack" && unit.hasAttacked) return false;
  if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) return false;

  if (ability.type === "offensive") {
    const target = units.get(targetId);
    if (!target) return false;
    if (!target.alive || target.defeated) return false;
    if (target.team === unit.team) return false;
    if (manhattanDistance(unit, target) > ability.range) return false;
    if (!hasLineOfSight(unit, target, ability.range)) return false;
  }
  return true;
}

/* Applies the effect of an ability to the battlefield. */
function applyAbilityEffect(unit, ability, target) {
  if (ability.type === "offensive") {
    const damage = calculateDamage(unit, target, { extraDamage: ability.damageBonus });
    applyDamage(target.id, damage);
    logEvent(`${unit.displayName} uses ${ability.name} on ${target.displayName} for ${damage} damage.`, unit.team === TEAM_BLUE ? "player" : "ai");
    if (!target.alive || target.defeated) {
      logEvent(`${target.displayName} is defeated.`, "system");
    }
    return;
  }

  let affected = 0;
  for (const [, ally] of units) {
    if (!ally.alive || ally.defeated) continue;
    if (ally.team !== unit.team) continue;
    if (ally.id === unit.id && !ability.includeSelf) continue;
    if (manhattanDistance(unit, ally) > ability.radius) continue;
    /* The same aura never stacks on the same unit. */
    if (hasEffect(ally, ability.id)) continue;

    if (ability.atkBonus) {
      ally.effects.push(createEffect(ability.id, "atk", ability.atkBonus, ability.duration, unit.id));
    }
    if (ability.defBonus) {
      ally.effects.push(createEffect(ability.id, "def", ability.defBonus, ability.duration, unit.id));
    }
    const el = unitElements.get(ally.id);
    if (el) el.classList.add(ability.type === "defensive" ? "guarded" : "rallied");
    affected++;
  }

  logEvent(`${unit.displayName} uses ${ability.name} — ${affected} allies affected.`, unit.team === TEAM_BLUE ? "player" : "ai");
}

function consumeAbilityAction(unit, ability) {
  unit.abilityUses[ability.id] = getAbilityUses(unit, ability.id) + 1;
  if (ability.actionCost === "attack") unit.hasAttacked = true;
  if (ability.actionCost === "turn") {
    unit.hasMoved = true;
    unit.hasAttacked = true;
  }
}

/* Player entry point. */
function usePlayerAbility(abilityId, targetId) {
  const unit = getPlayerChampion();
  const ability = ABILITIES[abilityId];
  if (!unit || !ability) return false;
  if (!canUseAbility(unit, ability, targetId)) return false;

  consumeAbilityAction(unit, ability);
  applyAbilityEffect(unit, ability, targetId ? units.get(targetId) : null);
  clearSelection();
  updateBattleStatus();
  updateEndTurnButton();
  updateChampionPanel();
  if (checkBattleEnd()) return true;
  return true;
}

/* AI entry point. */
function useAiAbility(unit, ability, target) {
  if (!canAiUseAbility(unit, ability, target ? target.id : null)) return false;
  consumeAbilityAction(unit, ability);
  applyAbilityEffect(unit, ability, target || null);
  if (checkBattleEnd()) return true;
  return true;
}

/* 17. PROGRESSION STORAGE */

let progression = defaultProfile();
let storageAvailable = true;

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    level: 1,
    xp: 0,
    abilityPoints: 1,
    unlocked: ["rally"],
    battles: 0,
    wins: 0
  };
}

function getStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/* Loaded data is never trusted: every field is validated and anything
 * unexpected falls back to a safe default. */
function sanitizeProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.version !== PROFILE_VERSION) return null;

  const level = clampInt(raw.level, 1, MAX_LEVEL, 1);
  const xp = clampInt(raw.xp, 0, 1000000, 0);
  const abilityPoints = clampInt(raw.abilityPoints, 0, 99, 0);
  const battles = clampInt(raw.battles, 0, 1000000, 0);
  const wins = clampInt(raw.wins, 0, 1000000, 0);

  const unlocked = Array.isArray(raw.unlocked) ? raw.unlocked : [];
  const valid = unlocked.filter(id => typeof id === "string" && Object.prototype.hasOwnProperty.call(ABILITIES, id));
  if (!valid.includes("rally")) valid.unshift("rally");

  return { version: PROFILE_VERSION, level, xp, abilityPoints, unlocked: valid, battles, wins };
}

function loadChampionProgression() {
  const store = getStorage();
  if (!store) {
    storageAvailable = false;
    progression = defaultProfile();
    return progression;
  }

  let raw = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (e) {
    storageAvailable = false;
    progression = defaultProfile();
    return progression;
  }

  if (raw === null || raw === undefined) {
    progression = defaultProfile();
    return progression;
  }

  try {
    const parsed = JSON.parse(raw);
    const clean = sanitizeProfile(parsed);
    progression = clean || defaultProfile();
  } catch (e) {
    progression = defaultProfile();
  }
  return progression;
}

function saveChampionProgression() {
  const store = getStorage();
  if (!store) {
    storageAvailable = false;
    return false;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(progression));
    storageAvailable = true;
    return true;
  } catch (e) {
    storageAvailable = false;
    return false;
  }
}

function getLevelBonuses(level) {
  const idx = Math.min(MAX_LEVEL, Math.max(1, level)) - 1;
  return LEVEL_REWARDS[idx];
}

function getXpToNextLevel() {
  if (progression.level >= MAX_LEVEL) return 0;
  return LEVEL_THRESHOLDS[progression.level] - progression.xp;
}

/* Experience is only ever paid once for a given key. */
function awardExperience(amount, reason, eventKey) {
  if (!amount || amount <= 0) return 0;
  if (eventKey) {
    if (awardedRewards.has(eventKey)) return 0;
    awardedRewards.add(eventKey);
  }
  progression.xp += amount;
  logEvent(`+${amount} XP — ${reason}.`, "level");
  const levels = checkLevelUp();
  saveChampionProgression();
  updateProgressionUI();
  if (levels.length > 0) {
    showLevelUpBanner(levels[levels.length - 1]);
  }
  return amount;
}

function checkLevelUp() {
  const gained = [];
  while (progression.level < MAX_LEVEL && progression.xp >= LEVEL_THRESHOLDS[progression.level]) {
    progression.level += 1;
    progression.abilityPoints += 1;
    gained.push(progression.level);
    logEvent(`Champion reaches level ${progression.level}!`, "level");
  }
  if (gained.length > 0) {
    const bonus = getLevelBonuses(progression.level);
    logEvent(`Level ${progression.level} bonus: +${bonus.hp} HP, +${bonus.atk} ATK, +${bonus.def} DEF.`, "level");
  }
  return gained;
}

/* Unlocking costs ability points and requires the unlock level. */
function unlockAbility(abilityId) {
  const ability = ABILITIES[abilityId];
  if (!ability) return { ok: false, reason: "unknown ability" };
  if (isAbilityUnlocked(abilityId)) return { ok: false, reason: "already unlocked" };
  if (progression.level < ability.unlockLevel) {
    return { ok: false, reason: `requires level ${ability.unlockLevel}` };
  }
  if (progression.abilityPoints < ability.unlockCost) {
    return { ok: false, reason: "not enough ability points" };
  }
  progression.abilityPoints -= ability.unlockCost;
  progression.unlocked.push(abilityId);
  saveChampionProgression();
  updateProgressionUI();
  updateChampionPanel();
  logEvent(`Unlocked ${ability.name}.`, "level");
  return { ok: true };
}

function resetChampionProgression() {
  progression = defaultProfile();
  awardedRewards.clear();
  saveChampionProgression();
  updateProgressionUI();
  updateChampionPanel();
  logEvent("Champion progression reset.", "system");
  return progression;
}

/* The champion's permanent bonuses are applied when a battle starts, so a
 * level up mid-battle takes effect from the next battle. */
function applyChampionProgression(champion) {
  if (!champion) return;
  const bonus = getLevelBonuses(progression.level);
  champion.maxHp = UNIT_STATS.champion.hp + bonus.hp;
  champion.atk = UNIT_STATS.champion.atk + bonus.atk;
  champion.def = UNIT_STATS.champion.def + bonus.def;
  champion.hp = champion.maxHp;
}

/* 18. TURN MANAGEMENT */

function startBattle() {
  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  actionLock = false;
  currentBattleToken = ++battleToken;
  battleId += 1;
  battleFinalized = false;

  battleActive = true;
  currentTurn = "player";
  roundNumber = 1;
  selectedUnitId = null;
  pendingAbilityId = null;

  $startButton.disabled = true;
  $startButton.textContent = "ARENA READY";
  $battleResult.classList.add("hidden");
  $turnBanner.classList.remove("hidden");
  $endTurnButton.classList.remove("hidden");
  $endTurnButton.disabled = false;
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $combatLog.innerHTML = "";

  resetActionFlags();
  resetAbilityUses();
  applyChampionProgression(getPlayerChampion());
  refreshAllHealthBars();
  updateTurnBanner();
  updateBattleStatus();
  updateProgressionUI();
  updateChampionPanel();
  logEvent("The battle begins!", "system");
}

/* Action flags reset every round; ability uses are per battle. */
function resetActionFlags() {
  units.forEach(u => {
    u.hasMoved = false;
    u.hasAttacked = false;
  });
}

function resetAbilityUses() {
  units.forEach(u => { u.abilityUses = {}; });
}

function endPlayerTurn() {
  if (currentTurn !== "player") return;

  currentTurn = "enemy";
  updateTurnBanner();
  $endTurnButton.disabled = true;
  clearSelection();

  logEvent("Crimson Legion prepares to advance...", "ai");
  runEnemyTurn();
}

/* 19. TACTICAL AI
 * The AI scores every legal action and takes the best one. Scoring is
 * deterministic, so the same battlefield always produces the same plan.
 */

/* Front-to-back order: red advances toward lower columns, so the unit with
 * the lowest column acts first. Ties break on row, then on id. */
function buildEnemyActionQueue() {
  return redUnitIds
    .map(id => units.get(id))
    .filter(u => u && u.alive && !u.defeated)
    .sort((a, b) => {
      if (a.col !== b.col) return a.col - b.col;
      if (a.row !== b.row) return a.row - b.row;
      return a.id.localeCompare(b.id);
    });
}

function targetValue(unit) {
  return AI_TUNING.targetValue[unit.type] !== undefined ? AI_TUNING.targetValue[unit.type] : 6;
}

/* How much damage a unit standing on a cell would take. */
function estimateIncomingDamage(col, row, team, defenderDef) {
  let total = 0;
  for (const [, enemy] of units) {
    if (!enemy.alive || enemy.defeated || enemy.team === team) continue;
    const dist = manhattanDistance({ col, row }, enemy);
    if (dist > enemy.range) continue;
    const weight = enemy.range > 1 ? 1 : 0.7;
    const attack = enemy.atk + getUnitAtkBonus(enemy);
    total += weight * Math.max(1, attack - Math.floor(defenderDef / 2));
  }
  return total;
}

function evaluateAttackAction(attacker, target, attackerPos) {
  const pos = attackerPos || attacker;
  const damage = calculateDamage(attacker, target, { attackerPos: pos });
  const kills = damage >= target.hp;

  let score = damage * AI_TUNING.damageWeight;
  if (kills) score += AI_TUNING.killBonus + targetValue(target);
  if (target.hp <= target.maxHp * 0.5) score += AI_TUNING.finishBonus;
  score += getTerrainAimBonus(pos);

  /* Trading blows is a real cost. */
  const retaliation = estimateIncomingDamage(pos.col, pos.row, attacker.team, attacker.def);
  score -= retaliation * AI_TUNING.retaliationWeight;
  return score;
}

function evaluateMoveAction(unit, cell) {
  const terrain = getTerrainAt(cell.col, cell.row);
  const advance = unit.team === TEAM_BLUE ? cell.col - unit.col : unit.col - cell.col;

  let score = 0;
  score += advance * AI_TUNING.advanceWeight;
  score += terrain.def * AI_TUNING.coverWeight;
  if (terrain.aim > 0 && unit.range > 1) score += terrain.aim * AI_TUNING.elevationWeight;

  const currentThreat = estimateIncomingDamage(unit.col, unit.row, unit.team, unit.def);
  const nextThreat = estimateIncomingDamage(cell.col, cell.row, unit.team, unit.def);
  /* Only the CHANGE in danger matters. A unit that is already exposed does
   * not refuse to advance just because arrows can still reach it. */
  score -= (nextThreat - currentThreat) * AI_TUNING.threatWeight;

  /* A wounded unit under threat is happy to run. */
  if (unit.hp <= unit.maxHp * 0.5 && currentThreat > 0 && nextThreat < currentThreat) {
    score += AI_TUNING.safetyBonus;
  }

  /* Walking backwards without a reason is a loop, not a plan. */
  if (advance < 0 && currentThreat === 0) score -= AI_TUNING.retreatPenalty;
  if (unit.lastAiCell && unit.lastAiCell.col === cell.col && unit.lastAiCell.row === cell.row) {
    score -= AI_TUNING.oscillationPenalty;
  }

  if (unit.range <= 1 && advance > 0) {
    score += Math.min(advance, 2) * AI_TUNING.meleeAdvanceBonus;
  }
  return score;
}

/* The best attack available from a hypothetical position. */
function bestAttackFrom(unit, cell) {
  let best = null;
  for (const target of getValidTargets(unit, cell)) {
    const score = evaluateAttackAction(unit, target, cell);
    if (!best || score > best.score) best = { target, score };
  }
  return best;
}

function countAbilityBeneficiaries(unit, ability) {
  let count = 0;
  for (const [, ally] of units) {
    if (!ally.alive || ally.defeated) continue;
    if (ally.team !== unit.team) continue;
    if (ally.id === unit.id && !ability.includeSelf) continue;
    if (manhattanDistance(unit, ally) > ability.radius) continue;
    if (hasEffect(ally, ability.id)) continue;
    count++;
  }
  return count;
}

function countThreatenedBeneficiaries(unit, ability) {
  let count = 0;
  for (const [, ally] of units) {
    if (!ally.alive || ally.defeated) continue;
    if (ally.team !== unit.team) continue;
    if (ally.id === unit.id && !ability.includeSelf) continue;
    if (manhattanDistance(unit, ally) > ability.radius) continue;
    if (hasEffect(ally, ability.id)) continue;
    if (estimateIncomingDamage(ally.col, ally.row, unit.team, ally.def) > 0) count++;
  }
  return count;
}

function evaluateAbilityAction(unit, ability, target) {
  if (ability.type === "offensive") {
    const damage = calculateDamage(unit, target, { extraDamage: ability.damageBonus });
    const kills = damage >= target.hp;
    let score = damage * AI_TUNING.offensiveAbilityDamage;
    if (kills) score += AI_TUNING.killBonus + targetValue(target) + AI_TUNING.offensiveAbilityBonus;
    return score;
  }

  const beneficiaries = countAbilityBeneficiaries(unit, ability);
  if (beneficiaries < AI_TUNING.supportMinimum) return -1;

  let score = beneficiaries * (ability.type === "defensive"
    ? AI_TUNING.guardPerAlly
    : AI_TUNING.supportPerAlly);
  if (ability.type === "defensive") {
    score += countThreatenedBeneficiaries(unit, ability) * AI_TUNING.threatenedBonus;
  }
  return score;
}

/* Every legal action the unit could take right now. */
function getLegalActions(unit) {
  const actions = [];
  if (!unit || !unit.alive || unit.defeated) return actions;

  for (const target of getValidTargets(unit)) {
    actions.push({ kind: "attack", unit, target });
  }

  if (!unit.hasMoved) {
    for (const cell of getReachableCells(unit)) {
      actions.push({ kind: "move", unit, cell });
    }
  }

  if (unit.type === "champion") {
    for (const id of unit.abilities || []) {
      const ability = ABILITIES[id];
      if (!ability) continue;
      if (!isAbilityUnlocked(id)) continue;
      if (getAbilityUses(unit, id) >= ability.usesPerBattle) continue;
      if (ability.actionCost === "attack" && unit.hasAttacked) continue;
      if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) continue;

      if (ability.type === "offensive") {
        for (const target of getValidTargets(unit)) {
          if (manhattanDistance(unit, target) > ability.range) continue;
          actions.push({ kind: "ability", unit, ability, target });
        }
      } else {
        actions.push({ kind: "ability", unit, ability, target: null });
      }
    }
  }
  return actions;
}

/* Deterministic tie break so the same state always yields the same plan. */
function actionKey(action) {
  if (action.kind === "attack") return `attack:${action.target.id}`;
  if (action.kind === "move") return `move:${action.cell.col},${action.cell.row}`;
  if (action.kind === "ability") {
    return `ability:${action.ability.id}:${action.target ? action.target.id : "-"}`;
  }
  return action.kind;
}

function evaluateAction(action) {
  if (action.kind === "attack") {
    return AI_TUNING.actNowBonus + evaluateAttackAction(action.unit, action.target);
  }
  if (action.kind === "move") {
    let score = evaluateMoveAction(action.unit, action.cell);
    const follow = bestAttackFrom(action.unit, action.cell);
    if (follow) score += follow.score;
    return score;
  }
  if (action.kind === "ability") {
    return evaluateAbilityAction(action.unit, action.ability, action.target);
  }
  return 0;
}

/* Picks the best legal action for a unit, or null when holding position is
 * the best available plan. */
function chooseEnemyAction(unit) {
  const actions = getLegalActions(unit);
  let best = null;
  for (const action of actions) {
    const score = evaluateAction(action);
    if (score < AI_TUNING.minActionScore) continue;
    if (!best || score > best.score || (score === best.score && actionKey(action) < actionKey(best.action))) {
      best = { action, score };
    }
  }
  return best ? best.action : null;
}

function runEnemyTurn() {
  gameState = STATE_ENEMY_TURN;
  $turnBanner.classList.add("ai-turn-active");
  $battlefield.classList.add("ai-turn-active");

  aiActionQueue = buildEnemyActionQueue();
  aiActionIndex = 0;

  if (aiActionQueue.length === 0) {
    finishEnemyTurn();
    return;
  }
  executeNextEnemyAction();
}

function executeNextEnemyAction() {
  if (battleToken !== currentBattleToken) return;
  if (gameState === STATE_ENDED) return;

  if (aiActionIndex >= aiActionQueue.length) {
    finishEnemyTurn();
    return;
  }

  const unit = aiActionQueue[aiActionIndex];
  aiActionIndex++;

  if (!unit || !unit.alive || unit.defeated) {
    executeNextEnemyAction();
    return;
  }

  const action = chooseEnemyAction(unit);
  if (!action) {
    executeNextEnemyAction();
    return;
  }

  if (action.kind === "ability") {
    performAiAbility(unit, action.ability, action.target);
    return;
  }
  if (action.kind === "attack") {
    performAiAttack(unit, action.target);
    return;
  }
  performAiMove(unit, action.cell);
}

function performAiMove(unit, destination) {
  const from = { col: unit.col, row: unit.row };
  unit.col = destination.col;
  unit.row = destination.row;
  unit.hasMoved = true;
  /* Remember where the unit came from so it cannot shuffle back and forth. */
  unit.lastAiCell = from;

  const el = unitElements.get(unit.id);
  if (el) {
    positionUnit(el, unit);
    el.classList.add("moving");
    later(() => el.classList.remove("moving"), 400);
  }

  logEvent(`${unit.displayName} advances to (${destination.col},${destination.row}).`, "ai");

  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (!unit.alive || unit.defeated) {
      executeNextEnemyAction();
      return;
    }
    continueAiAction(unit);
  }, AI_TIMING.move);
}

/* After an action that did not consume the whole turn, the unit may still
 * have something worth doing. */
function continueAiAction(unit) {
  if (battleToken !== currentBattleToken) return;
  const follow = chooseEnemyAction(unit);
  if (follow && follow.kind === "attack") {
    performAiAttack(unit, follow.target);
    return;
  }
  if (follow && follow.kind === "ability") {
    performAiAbility(unit, follow.ability, follow.target);
    return;
  }
  if (follow && follow.kind === "move") {
    performAiMove(unit, follow.cell);
    return;
  }
  executeNextEnemyAction();
}

function performAiAttack(unit, target) {
  const attackerEl = unitElements.get(unit.id);
  if (attackerEl) attackerEl.classList.add("attacking");

  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (attackerEl) attackerEl.classList.remove("attacking");

    const damage = calculateDamage(unit, target);
    applyDamage(target.id, damage);

    logEvent(`${unit.displayName} attacks ${target.displayName} for ${damage} damage.`, "ai");

    if (!target.alive || target.defeated) {
      logEvent(`${target.displayName} is defeated.`, "system");
    }

    unit.hasAttacked = true;

    if (checkBattleEnd()) return;

    later(() => {
      executeNextEnemyAction();
    }, AI_TIMING.gap);
  }, AI_TIMING.attack);
}

function performAiAbility(unit, ability, target) {
  const used = useAiAbility(unit, ability, target);
  if (!used) {
    executeNextEnemyAction();
    return;
  }
  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (checkBattleEnd()) return;
    /* A support ability does not consume the turn, so the champion may
     * still have an action left. */
    if (ability.actionCost === "ability") {
      continueAiAction(unit);
      return;
    }
    later(() => { executeNextEnemyAction(); }, AI_TIMING.gap);
  }, AI_TIMING.ability);
}

function finishEnemyTurn() {
  currentTurn = "player";
  roundNumber++;
  gameState = STATE_PLAYER_SELECTING;
  $turnBanner.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-active");
  $endTurnButton.disabled = false;
  $endTurnButton.classList.remove("hidden");

  resetActionFlags();
  expireTemporaryEffects();
  refreshAllHealthBars();
  updateTurnBanner();
  updateBattleStatus();
  logEvent("Your turn!", "system");

  if (checkBattleEnd()) return;
}

/* 20. BATTLE END & REMATCH */

function checkBattleEnd() {
  const livingBlue = getTeamUnits(TEAM_BLUE).length > 0;
  const livingRed = getTeamUnits(TEAM_RED).length > 0;

  if (!livingBlue || !livingRed) {
    battleActive = false;
    gameState = STATE_ENDED;
    currentTurn = "ended";
    clearSelection();
    $endTurnButton.classList.add("hidden");
    $abilityWrap.classList.add("hidden");
    $turnBanner.classList.add("hidden");

    if (!livingRed && livingBlue) {
      $battleResult.textContent = "VICTORY — AZURE LEGION PREVAILS";
      $battleResult.className = "battle-result victory";
      logEvent("Azure Legion is victorious!", "system");
    } else if (!livingBlue && livingRed) {
      $battleResult.textContent = "DEFEAT — CRIMSON LEGION PREVAILS";
      $battleResult.className = "battle-result defeat";
      logEvent("Crimson Legion has triumphed.", "system");
    } else {
      $battleResult.textContent = "BATTLE ENDED — NO SURVIVORS";
      $battleResult.className = "battle-result";
    }

    $battleResult.classList.remove("hidden");
    $startButton.disabled = false;
    $startButton.textContent = "REMATCH";

    if (!battleFinalized) {
      battleFinalized = true;
      finalizeBattleResult(!livingRed && livingBlue);
    }
    return true;
  }
  return false;
}

/* The completion bonus is paid exactly once per battle. */
function finalizeBattleResult(victory) {
  progression.battles += 1;
  if (victory) progression.wins += 1;

  if (victory) {
    awardExperience(XP_VICTORY_BONUS, "victory", `battle:${battleId}:victory`);
  }
  saveChampionProgression();
  updateProgressionUI();
  updateChampionPanel();
}

function awardExperienceForDefeat(defeatedUnit) {
  const base = XP_REWARDS[defeatedUnit.type] || 10;
  let total = base;
  let reason = `defeated ${defeatedUnit.displayName}`;
  if (defeatedUnit.type === "champion") {
    total += XP_CHAMPION_BONUS;
    reason = `defeated the enemy champion`;
  }
  awardExperience(total, reason, `battle:${battleId}:kill:${defeatedUnit.id}`);
}

function resetBattle() {
  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  actionLock = false;
  currentBattleToken = ++battleToken;
  battleFinalized = false;

  battleActive = false;
  gameState = STATE_INIT;
  currentTurn = "player";
  roundNumber = 1;
  selectedUnitId = null;
  pendingAbilityId = null;

  initArmies();
  renderArmies();
  renderTerrain();

  $startButton.disabled = false;
  $startButton.textContent = "ENTER THE ARENA";
  $battleResult.classList.add("hidden");
  $battleResult.className = "battle-result hidden";
  $turnBanner.classList.add("hidden");
  $turnBanner.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-active");
  $endTurnButton.classList.add("hidden");
  $endTurnButton.disabled = false;
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $combatLog.innerHTML = "";

  $status.textContent = "THE ARMIES AWAIT YOUR COMMAND";
  updateProgressionUI();
  updateChampionPanel();
}

/* 21. UI HELPERS */

function updateTurnBanner() {
  $roundText.textContent = `ROUND ${roundNumber}`;
  if (currentTurn === "player") {
    $turnText.textContent = "PLAYER TURN";
    $turnBanner.style.borderColor = "rgba(233, 198, 108, 0.3)";
  } else if (currentTurn === "enemy") {
    $turnText.textContent = "ENEMY TURN";
    $turnBanner.style.borderColor = "rgba(248, 113, 113, 0.3)";
  } else {
    $turnText.textContent = "BATTLE ENDED";
  }
}

function updateBattleStatus() {
  if (!battleActive) {
    $status.textContent = "THE ARMIES AWAIT YOUR COMMAND";
    return;
  }

  if (currentTurn === "enemy") {
    $status.textContent = "CRIMSON LEGION ADVANCING...";
    return;
  }

  if (selectedUnitId) {
    const unit = units.get(selectedUnitId);
    if (unit) {
      const parts = [];
      if (!unit.hasMoved) parts.push("can move");
      if (!unit.hasAttacked) parts.push("can attack");
      const ready = getReadyAbilities(unit);
      if (ready.length > 0) parts.push(`${ready.length} ability ready`);
      const head = parts.length
        ? `${unit.displayName} — ${parts.join(", ")}`
        : `${unit.displayName} — no actions left`;
      $status.textContent = `${head} · ${describeTerrain(unit.col, unit.row)}`;
      return;
    }
  }

  $status.textContent = "SELECT A BLUE UNIT";
}

function updateEndTurnButton() {
  const anyBlueCanAct = blueUnitIds.some(id => {
    const u = units.get(id);
    if (!u || !u.alive || u.defeated) return false;
    if (!u.hasMoved || !u.hasAttacked) return true;
    return getReadyAbilities(u).length > 0;
  });
  $endTurnButton.textContent = "END TURN";
  $endTurnButton.disabled = !anyBlueCanAct;
}

function logEvent(text, type) {
  const entry = document.createElement("span");
  entry.className = "log-entry " + (type || "system");
  entry.textContent = text;
  $combatLog.appendChild(entry);
  $combatLog.scrollTop = $combatLog.scrollHeight;
  while ($combatLog.children.length > 3) {
    $combatLog.removeChild($combatLog.firstChild);
  }
}

/* 21.1 PROGRESSION UI */

function updateProgressionUI() {
  if (!$progLevel) return;
  $progLevel.textContent = String(progression.level);

  const current = progression.level >= MAX_LEVEL
    ? 1
    : (progression.xp - LEVEL_THRESHOLDS[progression.level - 1]) /
      Math.max(1, LEVEL_THRESHOLDS[progression.level] - LEVEL_THRESHOLDS[progression.level - 1]);
  const pct = Math.max(0, Math.min(100, Math.round(current * 100)));
  $progXpFill.style.width = `${pct}%`;

  if (progression.level >= MAX_LEVEL) {
    $progXpText.textContent = "MAX LEVEL";
  } else {
    $progXpText.textContent = `${progression.xp} / ${LEVEL_THRESHOLDS[progression.level]} XP`;
  }
  $progPoints.textContent = String(progression.abilityPoints);

  if (!storageAvailable) {
    $progXpText.textContent += " · SESSION ONLY";
  }
}

/* 21.2 CHAMPION PANEL */

function updateChampionPanel() {
  if (!$championPanel) return;
  const champion = getPlayerChampion();
  if (!champion) {
    $championPanel.classList.add("hidden");
    return;
  }

  const show = selectedUnitId === champion.id;
  $championPanel.classList.toggle("hidden", !show);
  if (!show) return;

  $champLevel.textContent = `LEVEL ${progression.level}`;
  const bonus = getLevelBonuses(progression.level);
  $champStats.textContent =
    `HP ${champion.hp}/${champion.maxHp} · ATK ${champion.atk} · DEF ${champion.def}` +
    (bonus.hp || bonus.atk || bonus.def ? ` (base +${bonus.hp} HP +${bonus.atk} ATK +${bonus.def} DEF)` : "");

  renderAbilityList(champion);
}

function renderAbilityList(champion) {
  if (!$abilityList) return;
  $abilityList.innerHTML = "";

  for (const id of champion.abilities || []) {
    const ability = ABILITIES[id];
    if (!ability) continue;

    const unlocked = isAbilityUnlocked(id);
    const usesLeft = ability.usesPerBattle - getAbilityUses(champion, id);
    const ready = unlocked && usesLeft > 0 &&
      !(ability.actionCost === "attack" && champion.hasAttacked) &&
      !(ability.actionCost === "turn" && (champion.hasAttacked || champion.hasMoved));

    const row = document.createElement("div");
    row.className = "ability-row" + (unlocked ? "" : " locked") + (ready ? " ready" : "");

    const name = document.createElement("div");
    name.className = "ability-name";
    name.textContent = ability.name;
    row.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "ability-desc";
    desc.textContent = ability.description;
    row.appendChild(desc);

    const state = document.createElement("div");
    state.className = "ability-state";
    if (!unlocked) {
      state.textContent = progression.level < ability.unlockLevel
        ? `LOCKED — LEVEL ${ability.unlockLevel}`
        : `LOCKED — ${ability.unlockCost} POINT${ability.unlockCost === 1 ? "" : "S"}`;
    } else if (usesLeft <= 0) {
      state.textContent = "USED";
    } else if (ready) {
      state.textContent = "READY";
    } else {
      state.textContent = "UNAVAILABLE THIS TURN";
    }
    row.appendChild(state);

    const button = document.createElement("button");
    button.className = "ability-button";
    button.type = "button";
    if (!unlocked) {
      button.textContent = `UNLOCK ${ability.unlockCost}`;
      button.disabled = progression.level < ability.unlockLevel || progression.abilityPoints < ability.unlockCost;
      button.addEventListener("click", () => {
        const result = unlockAbility(id);
        if (!result.ok) logEvent(`${ability.name}: ${result.reason}.`, "system");
      });
    } else {
      button.textContent = "USE";
      button.disabled = !ready;
      button.addEventListener("click", () => onAbilityButtonClick(id));
    }
    row.appendChild(button);

    $abilityList.appendChild(row);
  }
}

/* The quick action buttons under the selection panel. */
function renderAbilityActions(unit) {
  if (!$abilityActions) return;
  $abilityActions.innerHTML = "";
  const ready = getReadyAbilities(unit);
  if (ready.length === 0) {
    $abilityWrap.classList.add("hidden");
    return;
  }
  $abilityWrap.classList.remove("hidden");
  for (const ability of ready) {
    const button = document.createElement("button");
    button.className = "ability-button";
    button.type = "button";
    button.textContent = ability.name.toUpperCase();
    button.addEventListener("click", () => onAbilityButtonClick(ability.id));
    $abilityActions.appendChild(button);
  }
}

function onAbilityButtonClick(abilityId) {
  const ability = ABILITIES[abilityId];
  const champion = getPlayerChampion();
  if (!ability || !champion) return;

  if (ability.type === "offensive") {
    /* An offensive ability needs a target, so the player picks one. */
    if (pendingAbilityId === abilityId) {
      pendingAbilityId = null;
      clearAttackIndicators();
      showAttackIndicators(champion);
      return;
    }
    pendingAbilityId = abilityId;
    clearAttackIndicators();
    showAbilityTargets(champion, ability);
    $status.textContent = `${ability.name}: choose a target`;
    return;
  }

  pendingAbilityId = null;
  usePlayerAbility(abilityId, null);
}

function showAbilityTargets(unit, ability) {
  const targets = getValidTargets(unit);
  for (const target of targets) {
    if (manhattanDistance(unit, target) > ability.range) continue;
    const marker = document.createElement("div");
    marker.className = "attack-indicator ability-target target-red";
    marker.style.left = `${colPercent(target.col)}%`;
    marker.style.top = `${rowPercent(target.row)}%`;
    marker.addEventListener("click", () => {
      const id = pendingAbilityId;
      pendingAbilityId = null;
      clearAttackIndicators();
      if (id) usePlayerAbility(id, target.id);
    });
    $attackIndicators.appendChild(marker);
    attackIndicators.push(marker);
  }
}

function showLevelUpBanner(level) {
  if (!$levelUpBanner) return;
  $levelUpText.textContent = `CHAMPION LEVEL ${level}`;
  $levelUpBanner.classList.remove("hidden");
  later(() => $levelUpBanner.classList.add("hidden"), 3200);
}

/* 21.3 RESET CONFIRMATION
 * The reset needs a second deliberate tap, and never fires in the middle of
 * an action.
 */
let resetArmed = false;

function onResetProgressClick() {
  if (!resetArmed) {
    resetArmed = true;
    $resetProgressButton.textContent = "CONFIRM?";
    $resetProgressButton.classList.add("armed");
    later(() => {
      resetArmed = false;
      $resetProgressButton.textContent = "RESET";
      $resetProgressButton.classList.remove("armed");
    }, 3000);
    return;
  }
  resetArmed = false;
  $resetProgressButton.textContent = "RESET";
  $resetProgressButton.classList.remove("armed");
  resetChampionProgression();
}

/* 22. INDICATORS */

function clearMoveIndicators() {
  $moveIndicators.innerHTML = "";
  moveIndicators = [];
}

function clearAttackIndicators() {
  $attackIndicators.innerHTML = "";
  attackIndicators = [];
}

function placeMarker(marker, col, row) {
  marker.style.left = `${colPercent(col)}%`;
  marker.style.top = `${rowPercent(row)}%`;
}

function showMoveIndicators(unit) {
  if (unit.hasMoved) return;
  const cells = getReachableCells(unit);

  for (const cell of cells) {
    const marker = document.createElement("div");
    marker.className = `move-indicator target-${unit.team}`;
    marker.style.left = `${colPercent(cell.col)}%`;
    marker.style.top = `${rowPercent(cell.row)}%`;
    marker.title = describeTerrain(cell.col, cell.row);
    marker.addEventListener("click", () => onMoveClick(unit.id, cell.col, cell.row));
    $moveIndicators.appendChild(marker);
    moveIndicators.push(marker);
  }
}

function showAttackIndicators(unit) {
  if (unit.hasAttacked) return;
  const targets = getValidTargets(unit);

  for (const target of targets) {
    const marker = document.createElement("div");
    marker.className = `attack-indicator target-${target.team}`;
    marker.style.left = `${colPercent(target.col)}%`;
    marker.style.top = `${rowPercent(target.row)}%`;
    marker.title = `Attack ${target.displayName}`;
    marker.addEventListener("click", () => onAttackClick(unit.id, target.id));
    $attackIndicators.appendChild(marker);
    attackIndicators.push(marker);
  }
}

/* 23. INTERACTION HANDLERS */

function onUnitClick(id) {
  const unit = units.get(id);
  if (!unit || !unit.alive || unit.defeated) return;
  if (!battleActive || currentTurn !== "player" || actionLock) return;

  if (unit.team === TEAM_BLUE) {
    selectUnit(id);
    return;
  }

  if (!selectedUnitId) return;

  const attacker = units.get(selectedUnitId);
  if (!attacker) return;

  if (attacker.hasAttacked) {
    logEvent(`${attacker.displayName} has already attacked this turn.`, "system");
    return;
  }

  if (pendingAbilityId) {
    const ability = ABILITIES[pendingAbilityId];
    if (ability && ability.type === "offensive") {
      if (canUseAbility(attacker, ability, id)) {
        const used = pendingAbilityId;
        pendingAbilityId = null;
        usePlayerAbility(used, id);
      } else {
        logEvent("That target cannot be struck.", "system");
      }
      return;
    }
  }

  if (canAttack(attacker, unit)) {
    onAttackClick(selectedUnitId, id);
  } else {
    const dist = manhattanDistance(attacker, unit);
    if (dist > attacker.range) {
      logEvent(`${unit.displayName} is out of range (${dist} > ${attacker.range}).`, "system");
    } else {
      logEvent(`The shot is blocked — ${describeTerrain(attacker.col, attacker.row)}.`, "system");
    }
  }
}

function onMoveClick(unitId, col, row) {
  const unit = units.get(unitId);
  if (!unit || unit.hasMoved) return;
  if (!battleActive || currentTurn !== "player" || actionLock) return;

  if (canMoveTo(unit, col, row)) {
    moveUnit(unit, col, row);
    clearMoveIndicators();
    clearAttackIndicators();
    showAttackIndicators(unit);
    updateBattleStatus();
    updateEndTurnButton();
  } else {
    logEvent(`Cannot reach (${col},${row}) — ${describeTerrain(col, row)}.`, "system");
  }
}

function onAttackClick(attackerId, targetId) {
  if (!battleActive || currentTurn !== "player" || actionLock) return;

  const attacker = units.get(attackerId);
  const target = units.get(targetId);
  if (!attacker || !target) return;

  if (!canAttack(attacker, target)) {
    if (manhattanDistance(attacker, target) > attacker.range) {
      logEvent("Cannot attack — target out of range.", "system");
    } else {
      logEvent("The shot is blocked by the terrain.", "system");
    }
    return;
  }
  executeAttack(attackerId, targetId);
}

/* 24. COMBAT EXECUTION
 * The action lock prevents rapid taps from queueing multiple attacks.
 */
function executeAttack(attackerId, targetId) {
  if (actionLock) return;

  const attacker = units.get(attackerId);
  const target = units.get(targetId);
  if (!attacker || !target) return;
  if (!canAttack(attacker, target)) {
    logEvent("Attack invalid.", "system");
    return;
  }

  actionLock = true;
  attacker.hasAttacked = true;

  const attackerEl = unitElements.get(attackerId);
  if (attackerEl) attackerEl.classList.add("attacking");

  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (attackerEl) attackerEl.classList.remove("attacking");

    const damage = calculateDamage(attacker, target);
    applyDamage(targetId, damage);

    logEvent(`${attacker.displayName} attacks ${target.displayName} for ${damage} damage.`, "player");
    if (getTerrainDefBonus(target) > 0) {
      logEvent(`${getTerrainAt(target.col, target.row).label} cover reduces the damage.`, "system");
    }
    if (getTerrainAimBonus(attacker) > 0) {
      logEvent("High ground improves the shot.", "system");
    }

    if (!target.alive || target.defeated) {
      logEvent(`${target.displayName} is defeated.`, "system");
    }

    clearSelection();
    actionLock = false;
    updateBattleStatus();
    updateEndTurnButton();

    if (checkBattleEnd()) return;
  }, 550);
}

/* 25. INITIALISATION */

function initGame() {
  loadChampionProgression();
  initArmies();
  renderArmies();
  renderTerrain();
  updateProgressionUI();

  $startButton.addEventListener("click", () => {
    if (gameState === STATE_ENDED || battleActive) resetBattle();
    startBattle();
  });

  $endTurnButton.addEventListener("click", () => {
    if (currentTurn === "player" && !checkBattleEnd()) {
      endPlayerTurn();
    }
  });

  $resetProgressButton.addEventListener("click", () => onResetProgressClick());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (gameState === STATE_ENDED || battleActive) resetBattle();
      startBattle();
    }
  });

  console.log(`${APP_NAME} ${APP_VERSION} initialized.`);
}

initGame();

/* 26. TEST SURFACE
 * The verification suites drive these functions directly so the tests and
 * the shipped game can never disagree about a rule.
 */
if (typeof window !== "undefined") {
  window.MyHeroDuelArena = {
    version: APP_VERSION,

    /* constants */
    GRID_COLS,
    GRID_ROWS,
    UNIT_STATS,
    TERRAIN_TYPES,
    TERRAIN_MAP,
    TERRAIN_LEGEND,
    ABILITIES,
    CHAMPION_ABILITIES,
    LEVEL_THRESHOLDS,
    LEVEL_REWARDS,
    MAX_LEVEL,
    XP_REWARDS,
    XP_CHAMPION_BONUS,
    XP_VICTORY_BONUS,
    STORAGE_KEY,
    PROFILE_VERSION,
    AI_TUNING,

    /* state */
    getUnits: () => units,
    getUnit,
    getTeamUnits,
    getChampion,
    getPlayerChampion,
    getEnemyChampion,
    getState: () => ({
      gameState, battleActive, currentTurn, roundNumber,
      selectedUnitId, actionLock, battleId, battleToken, currentBattleToken
    }),
    getProgression: () => Object.assign({}, progression, { unlocked: progression.unlocked.slice() }),
    isStorageAvailable: () => storageAvailable,
    getAwardedRewards: () => new Set(awardedRewards),

    /* terrain */
    getTerrainAt,
    getMovementCost,
    isTerrainPassable,
    getTerrainModifiers,
    getTerrainDefBonus,
    getTerrainAimBonus,
    describeTerrain,
    hasLineOfSight,
    traceCells,
    isInBounds,
    isOccupied,
    manhattanDistance,

    /* rules */
    getReachableCells,
    canMoveTo,
    getValidTargets,
    canAttack,
    calculateDamage,
    getUnitAtkBonus,
    getUnitDefBonus,
    expireTemporaryEffects,

    /* abilities */
    isAbilityUnlocked,
    getUnlockedAbilities,
    getAbilityUses,
    getReadyAbilities,
    canUseAbility,
    canAiUseAbility,
    usePlayerAbility,
    useAiAbility,
    applyAbilityEffect,

    /* progression */
    loadChampionProgression,
    saveChampionProgression,
    awardExperience,
    checkLevelUp,
    unlockAbility,
    resetChampionProgression,
    sanitizeProfile,
    defaultProfile,
    getLevelBonuses,
    applyChampionProgression,

    /* ai */
    getLegalActions,
    evaluateAction,
    chooseEnemyAction,
    estimateIncomingDamage,

    /* flow */
    initArmies,
    renderArmies,
    renderTerrain,
    startBattle,
    resetBattle,
    endPlayerTurn,
    checkBattleEnd,
    applyDamage,
    moveUnit,
    logEvent,

    /* Resolves the whole enemy turn in one step, without the animation
     * delays. The suites use it to play a battle through to its end. */
    runEnemyTurnInstant: () => {
      const previous = instantTimers;
      instantTimers = true;
      try {
        runEnemyTurn();
      } finally {
        instantTimers = previous;
      }
    }
  };
}
