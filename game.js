/* 1.1.0 TACTICAL COMBAT ENGINE */

/* 1. APP CONFIG & STATE */
"use strict";

const APP_NAME = "myHeroDuelArena";
const APP_VERSION = "v1.1.0";

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

/* 1.1 BATTLEFIELD GRID
 * Logical grid: 10 columns x 4 rows, rendered as a single shared field.
 *   col = advance axis (0 = far left, 9 = far right).
 *         Blue advances right, red advances left.
 *   row = lateral slot (0-3, stacked vertically on screen).
 *
 * Azure Legion occupies columns 0-3, Crimson Legion columns 6-9.
 * Columns 4-5 form the neutral centre gap between the two lines.
 */
const GRID_COLS = 10;
const GRID_ROWS = 4;
const BLUE_COL_BASE = 0;
const RED_COL_BASE = 6;

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

/* 1.5 CHAMPION ABILITY */
const RALLY_RADIUS = 2;
const RALLY_BONUS_ATK = 3;
const RALLY_BONUS_DEF = 2;
const RALLY_DURATION = 1;

/* 2. DOM ELEMENTS */
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
const $rallyButton = document.getElementById("rally-button");
const $abilityWrap = document.getElementById("ability-button-wrap");

const $blueUnits = document.getElementById("blue-units");
const $redUnits = document.getElementById("red-units");
const $moveIndicators = document.getElementById("move-indicators");
const $attackIndicators = document.getElementById("attack-indicators");
const $battlefield = document.getElementById("battlefield");

/* 3. GAME STATE */
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

const units = new Map();
const blueUnitIds = [];
const redUnitIds = [];
const unitElements = new Map();

/* Pending timers are tracked so a reset can cancel them safely. */
const pendingTimers = new Set();

function later(fn, delay) {
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

/* 4. UNIT DATA */
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
    alive: true,
    defeated: false,
    col: 0,
    row: 0,
    hasMoved: false,
    hasAttacked: false,
    hasUsedSpecial: false,
    rallyTurns: 0,
    rallyAtkBonus: 0,
    rallyDefBonus: 0,
    selected: false,
    target: false
  };
}

/* 4.1 INITIAL FORMATION
 * Grid semantics:
 *   col = advance axis (0 = far left, 9 = far right).
 *         Blue advances right, red advances left.
 *   row = lateral slot (0-3, stacked vertically on screen).
 *
 * Each army occupies 4 columns. Blue holds columns 0-3, red columns 6-9,
 * leaving columns 4-5 as neutral ground between the two lines.
 *
 * Ranks (from the front, nearest the enemy, toward the rear):
 *   Rank 0  — four foot soldiers (front line)
 *   Rank 1  — four archers (second line)
 *   Rank 2  — ballista and chevalier on the outer flanks
 *   Rank 3  — champion (rear)
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

function initArmies() {
  units.clear();
  blueUnitIds.length = 0;
  redUnitIds.length = 0;

  const blue = createArmy(TEAM_BLUE);
  const red = createArmy(TEAM_RED);

  blue.forEach(u => { units.set(u.id, u); blueUnitIds.push(u.id); });
  red.forEach(u => { units.set(u.id, u); redUnitIds.push(u.id); });
}

/* 5. RENDERING */
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

/* 5.2 POSITION MAPPING
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

/* 6. SELECTION */
function clearSelection() {
  selectedUnitId = null;
  units.forEach(u => { u.selected = false; u.target = false; });
  unitElements.forEach(el => {
    el.classList.remove("selected", "target");
    el.querySelector(".selection-ring")?.classList.remove("selection-ring-active");
  });
  clearMoveIndicators();
  clearAttackIndicators();
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $actionHints.textContent = "";
}

function selectUnit(id) {
  const unit = units.get(id);
  if (!unit || !unit.alive || unit.defeated) return;

  clearSelection();
  selectedUnitId = id;
  unit.selected = true;

  const el = unitElements.get(id);
  if (el) {
    el.classList.add("selected");
    el.querySelector(".selection-ring")?.classList.add("selection-ring-active");
  }

  $selectionInfo.classList.remove("hidden");
  $selectedName.textContent = unit.displayName;
  $selectedStats.textContent = `ATK ${unit.atk} | DEF ${unit.def} | RNG ${unit.range}`;
  $selectedHealth.style.width = "100%";

  const hints = [];
  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    if (!unit.hasMoved) hints.push("Can move");
    if (!unit.hasAttacked) hints.push("Can attack");
    if (unit.special === "rally" && !unit.hasUsedSpecial) hints.push("Can Rally");
    if (unit.hasMoved && unit.hasAttacked) hints.push("No actions left");
    if (hints.length === 0) hints.push("No actions available");
  }
  $actionHints.textContent = hints.join(" · ");

  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    if (unit.special === "rally" && !unit.hasUsedSpecial) {
      $abilityWrap.classList.remove("hidden");
    }
    showMoveIndicators(unit);
    showAttackIndicators(unit);
  }

  updateBattleStatus();
}

/* 7. MOVEMENT
 * Orthogonal steps only. A unit may not enter an occupied cell and may not
 * pass through one, so blocked cells are never expanded during the search.
 */
function getReachableCells(unit) {
  const cells = [];
  const visited = new Set();
  const startKey = `${unit.col},${unit.row}`;
  const queue = [{ col: unit.col, row: unit.row, dist: 0 }];
  visited.add(startKey);

  while (queue.length > 0) {
    const { col, row, dist } = queue.shift();

    if (dist < unit.move) {
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dc, dr] of dirs) {
        const nc = col + dc;
        const nr = row + dr;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        if (!isInBounds(nc, nr)) continue;
        visited.add(key);
        // Occupied cells are recorded as visited but never expanded.
        if (isOccupied(nc, nr, unit.id)) continue;
        cells.push({ col: nc, row: nr });
        queue.push({ col: nc, row: nr, dist: dist + 1 });
      }
    }
  }
  return cells;
}

function isInBounds(col, row) {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

function isOccupied(col, row, excludeId) {
  for (const [id, u] of units) {
    if (id === excludeId) continue;
    if (!u.alive || u.defeated) continue;
    if (u.col === col && u.row === row) return true;
  }
  return false;
}

function canMoveTo(unit, col, row) {
  if (!isInBounds(col, row)) return false;
  if (isOccupied(col, row, unit.id)) return false;
  const reachable = getReachableCells(unit);
  return reachable.some(c => c.col === col && c.row === row);
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

/* 8. ATTACK TARGETING */
function getValidTargets(unit) {
  const targets = [];
  for (const [id, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team === unit.team) continue;

    const dist = manhattanDistance(unit, u);
    if (dist <= unit.range) {
      targets.push(u);
    }
  }
  return targets;
}

function manhattanDistance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function canAttack(attacker, target) {
  if (!attacker || !target) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!target.alive || target.defeated) return false;
  if (attacker.team === target.team) return false;
  if (attacker.hasAttacked) return false;
  const dist = manhattanDistance(attacker, target);
  return dist <= attacker.range;
}

/* 9. DAMAGE CALCULATION */
function calculateDamage(attacker, defender) {
  const effectiveDef = defender.def + (defender.rallyDefBonus || 0);
  const raw = Math.max(1, attacker.atk + (attacker.rallyAtkBonus || 0) - Math.floor(effectiveDef / 2));
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
    const el2 = unitElements.get(targetId);
    if (el2) {
      el2.classList.add("defeated");
      el2.style.pointerEvents = "none";
    }
    return amount;
  }
  return amount;
}

/* 10. COMBAT EXECUTION
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
    if (attackerEl) attackerEl.classList.remove("attacking");

    const damage = calculateDamage(attacker, target);
    applyDamage(targetId, damage);

    logEvent(`${attacker.displayName} attacks ${target.displayName} for ${damage} damage.`, "player");

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

/* 11. CHAMPION ABILITY — RALLY
 * The champion inspires nearby living allies, granting a temporary attack and
 * defense bonus. The bonus lasts RALLY_DURATION rounds and then expires
 * automatically. The champion may use Rally once per battle.
 */
function useRally() {
  const championId = selectedUnitId;
  if (!championId) return;

  const champion = units.get(championId);
  if (!champion || champion.special !== "rally" || champion.hasUsedSpecial) return;
  if (!champion.alive || champion.defeated) return;

  let rallied = 0;
  for (const [id, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team !== champion.team) continue;
    if (u.id === champion.id) continue;

    const dist = manhattanDistance(champion, u);
    if (dist <= RALLY_RADIUS) {
      u.rallyAtkBonus = RALLY_BONUS_ATK;
      u.rallyDefBonus = RALLY_BONUS_DEF;
      u.rallyTurns = RALLY_DURATION;
      const el = unitElements.get(id);
      if (el) el.classList.add("rallied");
      rallied++;
    }
  }

  champion.hasUsedSpecial = true;
  champion.rallyAtkBonus = 0;
  champion.rallyDefBonus = 0;
  champion.rallyTurns = RALLY_DURATION;

  const el = unitElements.get(championId);
  if (el) el.classList.add("rallied");

  logEvent(`${champion.displayName} uses Rally — ${rallied} allies inspired.`, "system");
  clearSelection();
  updateBattleStatus();
  updateEndTurnButton();
}

/* 12. TURN MANAGEMENT */
function startBattle() {
  battleActive = true;
  currentTurn = "player";
  roundNumber = 1;
  selectedUnitId = null;

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
  expireRallyBuffs();
  refreshAllHealthBars();
  updateTurnBanner();
  updateBattleStatus();
  logEvent("The battle begins!", "system");
}

function resetActionFlags() {
  units.forEach(u => {
    u.hasMoved = false;
    u.hasAttacked = false;
    u.hasUsedSpecial = false;
  });
}

/* Rally bonuses last RALLY_DURATION rounds, then expire at the round change. */
function expireRallyBuffs() {
  units.forEach(u => {
    if (u.rallyTurns > 0) {
      u.rallyTurns--;
      if (u.rallyTurns <= 0) {
        u.rallyAtkBonus = 0;
        u.rallyDefBonus = 0;
        const el = unitElements.get(u.id);
        if (el) el.classList.remove("rallied");
      }
    }
  });
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

/* 12.1 ENEMY TURN
 * The AI processes each living red unit in a deterministic order. Units at the
 * front are handled first so that the cells they vacate become available for
 * the units behind them. For each unit the AI attacks when a target is in
 * range, and otherwise advances toward the nearest enemy.
 */
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

function chooseEnemyTarget(attacker, targets) {
  // Prefer lowest-health targets; tie-break by type priority for determinism.
  const typePriority = { champion: 0, ballista: 1, chevalier: 2, archer: 3, footman: 4 };
  return targets.sort((a, b) => {
    if (a.hp !== b.hp) return a.hp - b.hp;
    const pa = typePriority[a.type] === undefined ? 5 : typePriority[a.type];
    const pb = typePriority[b.type] === undefined ? 5 : typePriority[b.type];
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  })[0];
}

function executeNextEnemyAction() {
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

  const targets = getValidTargets(unit);

  if (targets.length > 0) {
    const target = chooseEnemyTarget(unit, targets);
    performAiAttack(unit, target);
    return;
  }

  // No target in range — advance toward the nearest blue unit.
  const destination = findApproachCell(unit);
  if (destination) {
    performAiMove(unit, destination);
    return;
  }

  executeNextEnemyAction();
}

/* Choose the reachable cell that advances the unit toward the enemy.
 *
 * Blue advances toward higher columns, red toward lower columns. The AI
 * prefers a cell that gains advance distance; when the lane straight ahead
 * is blocked by an ally it shuffles sideways to line itself up instead.
 * Returns null when no reachable cell improves the unit's position.
 */
function findApproachCell(unit) {
  const enemies = (unit.team === TEAM_BLUE ? redUnitIds : blueUnitIds)
    .map(id => units.get(id))
    .filter(u => u && u.alive && !u.defeated);

  if (enemies.length === 0) return null;

  const reachable = getReachableCells(unit);
  if (reachable.length === 0) return null;

  const advance = (from, to) =>
    unit.team === TEAM_BLUE ? to.col - from.col : from.col - to.col;

  const rowMisalign = (cell) => {
    let min = Infinity;
    for (const e of enemies) {
      const d = Math.abs(cell.row - e.row);
      if (d < min) min = d;
    }
    return min;
  };

  const currentAdvance = advance(unit, unit);
  const currentMisalign = rowMisalign(unit);

  // Pass 1: any cell that advances toward the enemy.
  let best = null;
  let bestGain = 0;
  let bestMisalign = currentMisalign;

  for (const cell of reachable) {
    const gain = advance(unit, cell);
    if (gain <= 0) continue;
    const misalign = rowMisalign(cell);
    if (gain > bestGain || (gain === bestGain && misalign < bestMisalign)) {
      best = cell;
      bestGain = gain;
      bestMisalign = misalign;
    }
  }

  if (best) return best;

  // Pass 2: the lane straight ahead is blocked by an ally. Slide sideways
  // to a cell that lines the unit up with a reachable enemy.
  let bestLateral = null;
  let bestLateralScore = -Infinity;

  for (const cell of reachable) {
    if (cell.col === unit.col) continue;
    const misalign = rowMisalign(cell);
    // Prefer lateral cells that are closer to an enemy row, then nearer rows.
    const score = -misalign * 10 - Math.abs(cell.row - unit.row);
    if (score > bestLateralScore) {
      bestLateralScore = score;
      bestLateral = cell;
    }
  }

  return bestLateral;
}

function performAiMove(unit, destination) {
  unit.col = destination.col;
  unit.row = destination.row;
  unit.hasMoved = true;

  const el = unitElements.get(unit.id);
  if (el) {
    positionUnit(el, unit);
    el.classList.add("moving");
    later(() => el.classList.remove("moving"), 400);
  }

  logEvent(`${unit.displayName} advances to (${destination.col},${destination.row}).`, "ai");

  later(() => {
    // After moving, the unit may now be able to strike.
    const targets = getValidTargets(unit);
    if (targets.length > 0) {
      const target = chooseEnemyTarget(unit, targets);
      performAiAttack(unit, target);
    } else {
      executeNextEnemyAction();
    }
  }, 700);
}

function performAiAttack(unit, target) {
  const attackerEl = unitElements.get(unit.id);
  if (attackerEl) attackerEl.classList.add("attacking");

  later(() => {
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
    }, 600);
  }, 550);
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
  expireRallyBuffs();
  refreshAllHealthBars();
  updateTurnBanner();
  updateBattleStatus();
  logEvent("Your turn!", "system");

  if (checkBattleEnd()) return;
}

/* 13. BATTLE END & REMATCH */
function checkBattleEnd() {
  const livingBlue = blueUnitIds.some(id => { const u = units.get(id); return u && u.alive && !u.defeated; });
  const livingRed = redUnitIds.some(id => { const u = units.get(id); return u && u.alive && !u.defeated; });

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
    return true;
  }

  return false;
}

function resetBattle() {
  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  actionLock = false;

  battleActive = false;
  gameState = STATE_INIT;
  currentTurn = "player";
  roundNumber = 1;
  selectedUnitId = null;

  initArmies();
  renderArmies();

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
}

/* 14. UI HELPERS */
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
      if (unit.special === "rally" && !unit.hasUsedSpecial) parts.push("can Rally");
      if (parts.length === 0) $status.textContent = `${unit.displayName} — no actions left`;
      else $status.textContent = `${unit.displayName} — ${parts.join(", ")}`;
      return;
    }
  }

  $status.textContent = "SELECT A BLUE UNIT";
}

function updateEndTurnButton() {
  const anyBlueCanAct = blueUnitIds.some(id => {
    const u = units.get(id);
    return u && u.alive && !u.defeated && (!u.hasMoved || !u.hasAttacked || (u.special === "rally" && !u.hasUsedSpecial));
  });
  if (anyBlueCanAct) {
    $endTurnButton.textContent = "END TURN";
    $endTurnButton.disabled = false;
  } else {
    $endTurnButton.textContent = "END TURN";
    $endTurnButton.disabled = true;
  }
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

/* 15. INDICATORS */
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
    placeMarker(marker, cell.col, cell.row);
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
    placeMarker(marker, target.col, target.row);
    marker.addEventListener("click", () => onAttackClick(unit.id, target.id));
    $attackIndicators.appendChild(marker);
    attackIndicators.push(marker);
  }
}

/* 16. INTERACTION HANDLERS */
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

  if (canAttack(attacker, unit)) {
    onAttackClick(selectedUnitId, id);
  } else {
    const dist = manhattanDistance(attacker, unit);
    logEvent(`${unit.displayName} is out of range (${dist} > ${attacker.range}).`, "system");
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
  }
}

function onAttackClick(attackerId, targetId) {
  if (!battleActive || currentTurn !== "player" || actionLock) return;

  const attacker = units.get(attackerId);
  const target = units.get(targetId);
  if (!attacker || !target) return;

  if (!canAttack(attacker, target)) {
    logEvent("Cannot attack — target out of range or already attacked.", "system");
    return;
  }
  executeAttack(attackerId, targetId);
}

/* 17. INITIALIZATION */
function initGame() {
  initArmies();
  renderArmies();

  $startButton.addEventListener("click", () => {
    if (battleActive && gameState === STATE_ENDED) {
      resetBattle();
    } else {
      startBattle();
    }
  });

  $endTurnButton.addEventListener("click", () => {
    if (currentTurn === "player" && !checkBattleEnd()) {
      endPlayerTurn();
    }
  });

  $rallyButton.addEventListener("click", () => {
    if (selectedUnitId) {
      useRally();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (battleActive && gameState === STATE_ENDED) {
        resetBattle();
      } else {
        startBattle();
      }
    }
  });

  console.log(`${APP_NAME} ${APP_VERSION} initialized.`);
}

initGame();