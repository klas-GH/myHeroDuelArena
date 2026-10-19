/* 1. APP CONFIG & STATE */

"use strict";

const APP_NAME = "myHeroDuelArena";
const APP_VERSION = "v1.0.1";

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

const STATE_INIT = "init";
const STATE_READY = "ready";
const STATE_PLAYER_SELECTING = "player_selecting";
const STATE_PLAYER_TARGETING = "player_targeting";
const STATE_ATTACKING = "attacking";
const STATE_COUNTERATTACKING = "counterattacking";
const STATE_ENDED = "ended";

const UNIT_COST = {
  archer: 1,
  footman: 1,
  ballista: 1,
  chevalier: 1,
  champion: 1
};

const UNIT_STATS = {
  archer: { hp: 40, atk: 14, def: 4 },
  footman: { hp: 60, atk: 12, def: 6 },
  ballista: { hp: 45, atk: 18, def: 3 },
  chevalier: { hp: 55, atk: 16, def: 5 },
  champion: { hp: 90, atk: 20, def: 8 }
};

const FORMATION_ORDER = [
  "footman", "footman", "archer", "archer",
  "ballista", "chevalier",
  "archer", "archer",
  "footman", "footman",
  "champion"
];

/* 2. DOM ELEMENTS */

const $arena = document.getElementById("arena");
const $status = document.getElementById("status");
const $startButton = document.getElementById("start-button");
const $selectionInfo = document.getElementById("selection-info");
const $selectedName = document.getElementById("selected-name");
const $selectedHealth = document.getElementById("selected-health");
const $battleResult = document.getElementById("battle-result");

const $blueUnits = document.getElementById("blue-units");
const $redUnits = document.getElementById("red-units");

/* 3. GAME STATE */

let gameState = STATE_INIT;
let battleActive = false;
let roundNumber = 0;
let selectedUnitId = null;
let pendingAttackerId = null;
let pendingTargetId = null;
let attackLock = false;

const units = new Map(); // id -> unit object
const blueUnitIds = [];
const redUnitIds = [];
const unitElements = new Map(); // id -> DOM element

/* 4. UNIT DATA */

function createUnit(id, team, type, index) {
  const stats = UNIT_STATS[type] || UNIT_STATS.footman;
  const position = index;

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
    alive: true,
    position,
    defeated: false,
    selected: false,
    target: false
  };
}

function createArmy(team, sideIndex) {
  const army = [];
  FORMATION_ORDER.forEach((type, index) => {
    const id = `${team}-${index}`;
    army.push(createUnit(id, team, type, index));
  });
  return army;
}

function initArmies() {
  units.clear();
  blueUnitIds.length = 0;
  redUnitIds.length = 0;

  const blue = createArmy(TEAM_BLUE, 0);
  const red = createArmy(TEAM_RED, 1);

  blue.forEach(u => {
    units.set(u.id, u);
    blueUnitIds.push(u.id);
  });

  red.forEach(u => {
    units.set(u.id, u);
    redUnitIds.push(u.id);
  });
}

/* 5. RENDER ARMIES & UNITS */

function renderArmies() {
  $blueUnits.innerHTML = "";
  $redUnits.innerHTML = "";
  unitElements.clear();

  renderArmy(TEAM_BLUE, $blueUnits, blueUnitIds);
  renderArmy(TEAM_RED, $redUnits, redUnitIds);
}

function renderArmy(team, container, ids) {
  ids.forEach((id, index) => {
    const unit = units.get(id);
    const element = renderUnit(unit, index);
    container.appendChild(element);
    unitElements.set(id, element);
  });
}

function renderUnit(unit, index) {
  const element = document.createElement("div");
  element.className = `unit ${unit.type} ${unit.team}`;
  element.dataset.id = unit.id;
  element.style.left = `${unit.position * 48 + 10}px`;
  element.style.bottom = "10px";

  const symbol = document.createElement("div");
  symbol.className = "unit-silhouette";
  symbol.innerHTML = `<use href="#sil-${unit.type}"></use>`;

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

  element.addEventListener("click", () => onUnitClick(unit.id));

  return element;
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
    if (unit) {
      updateUnitHealthBar(element, unit);
    }
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
  $selectionInfo.classList.add("hidden");
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
  $selectedHealth.style.width = "100%";
  updateBattleStatus();
}

function deselectUnit() {
  clearSelection();
}

/* 7. COMBAT VALIDATION & DAMAGE */

function canAttack(attackerId, targetId) {
  if (!battleActive || gameState !== STATE_PLAYER_TARGETING) return false;
  if (attackLock) return false;

  const attacker = units.get(attackerId);
  const target = units.get(targetId);

  if (!attacker || !target) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!target.alive || target.defeated) return false;
  if (attacker.team === target.team) return false;

  return true;
}

function calculateDamage(attacker, defender) {
  const raw = Math.max(1, attacker.atk - Math.floor(defender.def / 2));
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
    setTimeout(() => el.classList.remove("damaged"), 500);
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

/* 8. COMBAT FLOW */

function startBattle() {
  battleActive = true;
  gameState = STATE_PLAYER_SELECTING;
  roundNumber = 1;
  selectedUnitId = null;
  pendingAttackerId = null;
  pendingTargetId = null;

  $startButton.disabled = true;
  $startButton.textContent = "ARENA READY";
  $battleResult.classList.add("hidden");
  $selectionInfo.classList.add("hidden");

  refreshAllHealthBars();
  updateBattleStatus();
}

function resetBattle() {
  battleActive = false;
  gameState = STATE_INIT;
  roundNumber = 0;
  selectedUnitId = null;
  pendingAttackerId = null;
  pendingTargetId = null;
  attackLock = false;

  initArmies();
  renderArmies();

  $startButton.disabled = false;
  $startButton.textContent = "ENTER THE ARENA";
  $battleResult.classList.add("hidden");
  $selectionInfo.classList.add("hidden");

  $status.textContent = "THE ARMIES AWAIT YOUR COMMAND";
}

function onUnitClick(id) {
  const unit = units.get(id);
  if (!unit) return;

  if (gameState === STATE_PLAYER_SELECTING) {
    if (unit.team === TEAM_BLUE && unit.alive && !unit.defeated) {
      selectUnit(id);
      gameState = STATE_PLAYER_TARGETING;
      updateBattleStatus();
    }
    return;
  }

  if (gameState === STATE_PLAYER_TARGETING) {
    if (selectedUnitId === id) {
      deselectUnit();
      gameState = STATE_PLAYER_SELECTING;
      updateBattleStatus();
      return;
    }

    if (canAttack(selectedUnitId, id)) {
      pendingAttackerId = selectedUnitId;
      pendingTargetId = id;

      const target = units.get(id);
      if (target) {
        target.target = true;
        const el = unitElements.get(id);
        if (el) el.classList.add("target");
      }

      executeAttack();
    }
    return;
  }
}

function executeAttack() {
  if (attackLock) return;
  attackLock = true;

  const attacker = units.get(pendingAttackerId);
  const target = units.get(pendingTargetId);

  if (!attacker || !target || !attacker.alive || attacker.defeated || !target.alive || target.defeated) {
    attackLock = false;
    resetSelectionAfterAttack();
    return;
  }

  gameState = STATE_ATTACKING;

  const attackerEl = unitElements.get(pendingAttackerId);
  const targetEl = unitElements.get(pendingTargetId);

  if (attackerEl) attackerEl.classList.add("attacking");

  setTimeout(() => {
    if (attackerEl) attackerEl.classList.remove("attacking");

    const damage = calculateDamage(attacker, target);
    applyDamage(pendingTargetId, damage);

    updateBattleStatus(`${attacker.displayName} strikes ${target.displayName} for ${damage} damage.`);

    if (!target.alive || target.defeated) {
      updateBattleStatus(`${target.displayName} has been defeated.`);
    }

    setTimeout(() => {
      if (checkBattleEnd()) {
        attackLock = false;
        return;
      }

      handleCounterattack();
    }, 900);
  }, 550);
}

function handleCounterattack() {
  gameState = STATE_COUNTERATTACKING;

  const livingBlue = blueUnitIds.filter(id => {
    const u = units.get(id);
    return u && u.alive && !u.defeated;
  });

  if (livingBlue.length === 0) {
    attackLock = false;
    checkBattleEnd();
    return;
  }

  // AI: attack the lowest-health eligible blue unit
  livingBlue.sort((a, b) => units.get(a).hp - units.get(b).hp);
  const victimId = livingBlue[0];
  const victim = units.get(victimId);

  const redAttackers = redUnitIds.filter(id => {
    const u = units.get(id);
    return u && u.alive && !u.defeated;
  });

  if (redAttackers.length === 0) {
    attackLock = false;
    checkBattleEnd();
    return;
  }

  const attackerId = redAttackers[0];
  const attacker = units.get(attackerId);

  pendingAttackerId = attackerId;
  pendingTargetId = victimId;

  updateBattleStatus(`${attacker.displayName} counterattacks ${victim.displayName}.`);

  const attackerEl = unitElements.get(attackerId);
  if (attackerEl) attackerEl.classList.add("attacking");

  setTimeout(() => {
    if (attackerEl) attackerEl.classList.remove("attacking");

    const damage = calculateDamage(attacker, victim);
    applyDamage(pendingTargetId, damage);

    updateBattleStatus(`${victim.displayName} takes ${damage} damage.`);

    setTimeout(() => {
      attackLock = false;
      gameState = STATE_PLAYER_SELECTING;
      selectedUnitId = null;
      $selectionInfo.classList.add("hidden");
      updateBattleStatus();
      checkBattleEnd();
    }, 700);
  }, 600);
}

function resetSelectionAfterAttack() {
  pendingAttackerId = null;
  pendingTargetId = null;
  units.forEach(u => { u.target = false; });
  unitElements.forEach(el => el.classList.remove("target"));
  clearSelection();
  gameState = STATE_PLAYER_SELECTING;
  attackLock = false;
  updateBattleStatus();
}

function checkBattleEnd() {
  const livingBlue = blueUnitIds.some(id => { const u = units.get(id); return u && u.alive && !u.defeated; });
  const livingRed = redUnitIds.some(id => { const u = units.get(id); return u && u.alive && !u.defeated; });

  if (!livingBlue || !livingRed) {
    battleActive = false;
    gameState = STATE_ENDED;
    attackLock = false;
    clearSelection();

    if (!livingRed && livingBlue) {
      $battleResult.textContent = "VICTORY — AZURE LEGION PREVAILS";
      $battleResult.className = "battle-result victory";
      $status.textContent = "VICTORY!";
    } else if (!livingBlue && livingRed) {
      $battleResult.textContent = "DEFEAT — CRIMSON LEGION PREVAILS";
      $battleResult.className = "battle-result defeat";
      $status.textContent = "DEFEAT...";
    } else {
      $battleResult.textContent = "BATTLE ENDED — NO SURVIVORS";
      $battleResult.className = "battle-result";
      $status.textContent = "BATTLE ENDED";
    }

    $battleResult.classList.remove("hidden");
    $startButton.disabled = false;
    $startButton.textContent = "REMATCH";
    return true;
  }

  return false;
}

function updateBattleStatus(custom) {
  if (custom) {
    $status.textContent = custom;
    return;
  }

  if (!battleActive) {
    $status.textContent = "THE ARMIES AWAIT YOUR COMMAND";
    return;
  }

  switch (gameState) {
    case STATE_PLAYER_SELECTING:
      $status.textContent = "SELECT A BLUE UNIT TO ATTACK";
      break;
    case STATE_PLAYER_TARGETING:
      $status.textContent = "SELECT A RED TARGET";
      break;
    case STATE_ATTACKING:
    case STATE_COUNTERATTACKING:
      $status.textContent = "COMBAT IN PROGRESS";
      break;
    case STATE_ENDED:
      $status.textContent = "BATTLE ENDED";
      break;
    default:
      $status.textContent = "ARENA READY";
  }
}

/* 9. INITIALIZATION */

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
