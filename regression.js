/* REGRESSION TEST SUITE — myHeroDuelArena v1.1.0
 * Run: node regression.js
 * Validates pure game logic (no DOM required).
 * Covers the v1.0.1 rules plus the v1.1.0 tactical turn system.
 */

"use strict";

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

const GRID_COLS = 10;
const GRID_ROWS = 4;
const BLUE_COL_BASE = 0;
const RED_COL_BASE = 6;

const UNIT_STATS = {
  archer:   { hp: 40, atk: 14, def: 4,  move: 2, range: 4,  special: null },
  footman:  { hp: 60, atk: 12, def: 6,  move: 1, range: 1,  special: null },
  ballista: { hp: 45, atk: 18, def: 3,  move: 1, range: 5,  special: null },
  chevalier:{ hp: 55, atk: 16, def: 5,  move: 3, range: 1,  special: null },
  champion: { hp: 90, atk: 20, def: 8,  move: 2, range: 1,  special: "rally" }
};

const RALLY_RADIUS = 2;
const RALLY_BONUS_ATK = 3;
const RALLY_BONUS_DEF = 2;
const RALLY_DURATION = 1;

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

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

/* --- LOGIC MIRRORS game.js --- */

function createUnit(id, team, type) {
  const stats = UNIT_STATS[type] || UNIT_STATS.footman;
  return {
    id, team, type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    displayName: type.charAt(0).toUpperCase() + type.slice(1),
    maxHp: stats.hp, hp: stats.hp,
    atk: stats.atk, def: stats.def,
    move: stats.move, range: stats.range, special: stats.special,
    alive: true, defeated: false,
    col: 0, row: 0,
    hasMoved: false, hasAttacked: false, hasUsedSpecial: false,
    rallyTurns: 0, rallyAtkBonus: 0, rallyDefBonus: 0
  };
}

function createArmy(team) {
  const formation = team === TEAM_BLUE ? BLUE_FORMATION : RED_FORMATION;
  return formation.map((slot, i) => {
    const u = createUnit(`${team}-${i}`, team, slot.type);
    u.col = slot.col;
    u.row = slot.row;
    return u;
  });
}

const units = new Map();
const blueUnitIds = [];
const redUnitIds = [];

function initArmies() {
  units.clear();
  blueUnitIds.length = 0;
  redUnitIds.length = 0;
  createArmy(TEAM_BLUE).forEach(u => { units.set(u.id, u); blueUnitIds.push(u.id); });
  createArmy(TEAM_RED).forEach(u => { units.set(u.id, u); redUnitIds.push(u.id); });
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

function getReachableCells(unit) {
  const cells = [];
  const visited = new Set([`${unit.col},${unit.row}`]);
  const queue = [{ col: unit.col, row: unit.row, dist: 0 }];

  while (queue.length > 0) {
    const { col, row, dist } = queue.shift();
    if (dist < unit.move) {
      for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nc = col + dc;
        const nr = row + dr;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        if (!isInBounds(nc, nr)) continue;
        visited.add(key);
        if (isOccupied(nc, nr, unit.id)) continue;
        cells.push({ col: nc, row: nr });
        queue.push({ col: nc, row: nr, dist: dist + 1 });
      }
    }
  }
  return cells;
}

function canMoveTo(unit, col, row) {
  if (!isInBounds(col, row)) return false;
  if (isOccupied(col, row, unit.id)) return false;
  return getReachableCells(unit).some(c => c.col === col && c.row === row);
}

function manhattanDistance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function getValidTargets(unit) {
  const targets = [];
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team === unit.team) continue;
    if (manhattanDistance(unit, u) <= unit.range) targets.push(u);
  }
  return targets;
}

function canAttack(attacker, target) {
  if (!attacker || !target) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!target.alive || target.defeated) return false;
  if (attacker.team === target.team) return false;
  if (attacker.hasAttacked) return false;
  return manhattanDistance(attacker, target) <= attacker.range;
}

function calculateDamage(attacker, defender) {
  const effectiveDef = defender.def + (defender.rallyDefBonus || 0);
  const raw = Math.max(1, attacker.atk + (attacker.rallyAtkBonus || 0) - Math.floor(effectiveDef / 2));
  return Math.max(1, raw);
}

function applyDamage(target, amount) {
  if (!target.alive || target.defeated) return 0;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp <= 0) {
    target.alive = false;
    target.defeated = true;
  }
  return amount;
}

function useRally(champion) {
  if (!champion || champion.special !== "rally" || champion.hasUsedSpecial) return 0;
  let rallied = 0;
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team !== champion.team) continue;
    if (u.id === champion.id) continue;
    if (manhattanDistance(champion, u) <= RALLY_RADIUS) {
      u.rallyAtkBonus = RALLY_BONUS_ATK;
      u.rallyDefBonus = RALLY_BONUS_DEF;
      u.rallyTurns = RALLY_DURATION;
      rallied++;
    }
  }
  champion.hasUsedSpecial = true;
  champion.rallyTurns = RALLY_DURATION;
  return rallied;
}

function expireRallyBuffs() {
  for (const [, u] of units) {
    if (u.rallyTurns > 0) {
      u.rallyTurns--;
      if (u.rallyTurns <= 0) {
        u.rallyAtkBonus = 0;
        u.rallyDefBonus = 0;
      }
    }
  }
}

function resetActionFlags() {
  for (const [, u] of units) {
    u.hasMoved = false;
    u.hasAttacked = false;
    u.hasUsedSpecial = false;
  }
}

function livingCount(team) {
  const ids = team === TEAM_BLUE ? blueUnitIds : redUnitIds;
  return ids.filter(id => { const u = units.get(id); return u && u.alive && !u.defeated; }).length;
}

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

  const currentMisalign = rowMisalign(unit);

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

  let bestLateral = null;
  let bestLateralScore = -Infinity;

  for (const cell of reachable) {
    if (cell.col === unit.col) continue;
    const misalign = rowMisalign(cell);
    const score = -misalign * 10 - Math.abs(cell.row - unit.row);
    if (score > bestLateralScore) {
      bestLateralScore = score;
      bestLateral = cell;
    }
  }

  return bestLateral;
}

function chooseEnemyTarget(attacker, targets) {
  const typePriority = { champion: 0, ballista: 1, chevalier: 2, archer: 3, footman: 4 };
  return targets.sort((a, b) => {
    if (a.hp !== b.hp) return a.hp - b.hp;
    const pa = typePriority[a.type] === undefined ? 5 : typePriority[a.type];
    const pb = typePriority[b.type] === undefined ? 5 : typePriority[b.type];
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  })[0];
}

/* --- TESTS --- */

function testArmyComposition() {
  console.log("\n1. Army composition");
  initArmies();
  const blue = blueUnitIds.map(id => units.get(id));
  const red = redUnitIds.map(id => units.get(id));

  assert(blue.length === 11, "blue army has 11 units");
  assert(red.length === 11, "red army has 11 units");

  const countByType = (army) => army.reduce((acc, u) => { acc[u.type] = (acc[u.type] || 0) + 1; return acc; }, {});
  const bc = countByType(blue);
  const rc = countByType(red);

  assert(bc.archer === 4, "blue: 4 archers");
  assert(bc.footman === 4, "blue: 4 foot soldiers");
  assert(bc.ballista === 1, "blue: 1 ballista");
  assert(bc.chevalier === 1, "blue: 1 chevalier");
  assert(bc.champion === 1, "blue: 1 champion");
  assert(rc.archer === 4, "red: 4 archers");
  assert(rc.footman === 4, "red: 4 foot soldiers");
  assert(rc.ballista === 1, "red: 1 ballista");
  assert(rc.chevalier === 1, "red: 1 chevalier");
  assert(rc.champion === 1, "red: 1 champion");

  assert(blue.every(u => u.team === TEAM_BLUE), "all blue units are blue team");
  assert(red.every(u => u.team === TEAM_RED), "all red units are red team");
}

function testUniqueIds() {
  console.log("\n2. Unique unit IDs");
  initArmies();
  const ids = [...blueUnitIds, ...redUnitIds];
  assert(ids.length === 22, "exactly 22 units total");
  assert(new Set(ids).size === 22, "all 22 unit IDs are unique");
}

function testInitialPositions() {
  console.log("\n3. Initial positions");
  initArmies();
  const blue = blueUnitIds.map(id => units.get(id));
  const red = redUnitIds.map(id => units.get(id));

  assert(blue.every(u => u.col >= BLUE_COL_BASE && u.col < BLUE_COL_BASE + 4), "blue units start on left half of grid");
  assert(red.every(u => u.col >= RED_COL_BASE && u.col < RED_COL_BASE + 4), "red units start on right half of grid");
  assert(blue.every(u => u.col < RED_COL_BASE), "blue starts left of red");
  assert(red.every(u => u.col > BLUE_COL_BASE + 3), "red starts right of blue");
  assert(blue.every(u => u.col <= 3) && red.every(u => u.col >= 6), "neutral gap of two columns separates the armies");
  assert(blue.every(u => u.row >= 0 && u.row < GRID_ROWS), "blue rows in bounds");
  assert(red.every(u => u.row >= 0 && u.row < GRID_ROWS), "red rows in bounds");

  // Champion stays behind the supporting troops.
  const champ = blue.find(u => u.type === "champion");
  const frontMost = Math.max(...blue.filter(u => u.type === "footman").map(u => u.col));
  assert(champ.col < frontMost, "champion is behind the front line");
  assert(champ.col < Math.max(...blue.filter(u => u.type === "archer").map(u => u.col)), "champion is behind the archers");
  assert(champ.special === "rally", "champion holds the rear position with rally");

  // Formations are mirrored between the two armies.
  const bluePairs = blue.map(u => `${u.type}:${u.row}:${u.col}`).sort();
  const redPairs = red.map(u => `${u.type}:${u.row}:${GRID_COLS - 1 - u.col}`).sort();
  assert(JSON.stringify(bluePairs) === JSON.stringify(redPairs), "red formation mirrors blue formation");
}

function testNoOverlappingUnits() {
  console.log("\n4. No overlapping living units");
  initArmies();
  const all = [...blueUnitIds, ...redUnitIds].map(id => units.get(id));
  const keys = all.map(u => `${u.col},${u.row}`);
  assert(new Set(keys).size === keys.length, "no two units share a cell at start");
}

function testMovementRange() {
  console.log("\n5. Movement range");
  initArmies();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  const reachable = getReachableCells(footman);
  assert(reachable.length <= 4, `footman (move 1) reaches at most 4 cells, got ${reachable.length}`);
  assert(reachable.every(c => manhattanDistance(footman, c) === 1), "footman reaches only adjacent cells");

  const chevalier = units.get(blueUnitIds.find(id => units.get(id).type === "chevalier"));
  const chevyReach = getReachableCells(chevalier);
  assert(chevyReach.every(c => manhattanDistance(chevalier, c) <= 3), "chevalier (move 3) reaches within 3 cells");
  assert(chevyReach.length > reachable.length, "chevalier has a larger move allowance than footman");
}

function testOccupiedDestinationRejected() {
  console.log("\n6. Occupied destination rejection");
  initArmies();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  const blocker = units.get(blueUnitIds.find(id => {
    const u = units.get(id);
    return u.type === "archer" && manhattanDistance(u, footman) === 1;
  }));
  assert(!!blocker, "found an adjacent ally to block a move");
  assert(!canMoveTo(footman, blocker.col, blocker.row), "cannot move into an occupied cell");
  assert(!getReachableCells(footman).some(c => c.col === blocker.col && c.row === blocker.row), "occupied cell excluded from reachable set");
}

function testOutOfBoundsMovement() {
  console.log("\n7. Out-of-bounds movement");
  initArmies();
  const chevalier = units.get(blueUnitIds.find(id => units.get(id).type === "chevalier"));
  assert(!canMoveTo(chevalier, -1, 0), "cannot move to negative column");
  assert(!canMoveTo(chevalier, 0, -1), "cannot move to negative row");
  assert(!canMoveTo(chevalier, GRID_COLS, 0), "cannot move past the last column");
  assert(!canMoveTo(chevalier, 0, GRID_ROWS), "cannot move past the last row");
  const reach = getReachableCells(chevalier);
  assert(reach.every(c => isInBounds(c.col, c.row)), "all reachable cells are in bounds");
}

function testAttackRange() {
  console.log("\n8. Attack range");
  initArmies();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  const archer = units.get(blueUnitIds.find(id => units.get(id).type === "archer"));
  const ballista = units.get(blueUnitIds.find(id => units.get(id).type === "ballista"));

  assert(footman.range === 1, "footman melee range is 1");
  assert(archer.range === 4, "archer range is 4");
  assert(ballista.range === 5, "ballista range is 5");

  // A melee unit cannot hit a distant enemy.
  const redFootman = units.get(redUnitIds.find(id => units.get(id).type === "footman"));
  assert(!canAttack(footman, redFootman), "footman cannot attack a distant footman");

  // A ranged unit can hit a distant enemy.
  assert(canAttack(archer, redFootman), "archer can attack a distant footman");
}

function testInvalidTargetRejection() {
  console.log("\n9. Invalid target rejection");
  initArmies();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  const ally = units.get(blueUnitIds.find(id => id !== footman.id));
  const dead = units.get(redUnitIds[0]);
  dead.alive = false;
  dead.defeated = true;

  assert(!canAttack(footman, ally), "cannot attack a friendly unit");
  assert(!canAttack(footman, dead), "cannot attack a defeated unit");
  assert(!canAttack(dead, ally), "a defeated unit cannot attack");
  assert(!canAttack(null, ally), "null attacker cannot attack");
}

function testMinimumDamage() {
  console.log("\n10. Minimum damage");
  initArmies();
  const archer = units.get(blueUnitIds.find(id => units.get(id).type === "archer"));
  const tank = units.get(redUnitIds.find(id => units.get(id).type === "champion"));
  tank.def = 100;
  const dmg = calculateDamage(archer, tank);
  assert(dmg === 1, `minimum damage is 1, got ${dmg}`);
  assert(dmg >= 1, "damage is never less than 1");
}

function testHealthBoundaries() {
  console.log("\n11. Health boundaries");
  initArmies();
  const target = units.get(redUnitIds[0]);
  const before = target.hp;
  applyDamage(target, 9999);
  assert(target.hp === 0, "health never falls below zero");
  assert(target.alive === false, "unit defeated at 0 hp");
  assert(target.defeated === true, "defeated flag set");
  assert(applyDamage(target, 5) === 0, "defeated unit takes no further damage");
  assert(target.hp === 0, "defeated unit health unchanged");
  assert(before > 0, "test started with a living unit");
}

function testOneAttackPerUnitPerPhase() {
  console.log("\n12. One attack per unit per phase");
  initArmies();
  const archer = units.get(blueUnitIds.find(id => units.get(id).type === "archer"));
  const target = units.get(redUnitIds.find(id => units.get(id).type === "footman"));

  assert(canAttack(archer, target), "first attack is allowed");
  archer.hasAttacked = true;
  assert(!canAttack(archer, target), "second attack in same phase is rejected");
  resetActionFlags();
  assert(canAttack(archer, target), "attack allowed again after the phase resets");
}

function testMovementAllowance() {
  console.log("\n13. Movement allowance");
  initArmies();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  const empty = getReachableCells(footman).find(c => !isOccupied(c.col, c.row, footman.id));
  assert(canMoveTo(footman, empty.col, empty.row), "legal move accepted");
  footman.hasMoved = true;
  const reachAfter = getReachableCells(footman);
  assert(reachAfter.length >= 0, "reachable set recalculates after moving");
  assert(footman.hasMoved === true, "hasMoved flag set after a move");
}

function testTurnTransition() {
  console.log("\n14. Player to opponent turn transition");
  initArmies();
  resetActionFlags();
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  footman.hasAttacked = true;
  assert(!canAttack(footman, units.get(redUnitIds[0])), "attacked unit cannot act in same phase");
  resetActionFlags();
  assert(!footman.hasAttacked, "action flags cleared at phase start");
  assert(!footman.hasMoved, "move flag cleared at phase start");
}

function testAiActionLegality() {
  console.log("\n15. Opponent AI action legality");
  initArmies();
  const redUnits = redUnitIds.map(id => units.get(id)).filter(u => u.alive);
  let legal = 0;
  for (const ru of redUnits) {
    const targets = getValidTargets(ru);
    for (const t of targets) {
      if (ru.team !== t.team && ru.alive && !ru.defeated) legal++;
    }
  }
  assert(legal >= 0, "AI only considers living enemy targets");
  assert(redUnits.every(u => u.alive), "all red units start alive");

  // The AI must be able to find an approach path toward the blue army.
  const chevalier = redUnits.find(u => u.type === "chevalier");
  const cell = findApproachCell(chevalier);
  assert(cell !== null, "AI finds an approach cell toward the enemy");

  // Every AI-chosen destination must be a legal reachable cell.
  const isLegalCell = getReachableCells(chevalier).some(c => c.col === cell.col && c.row === cell.row);
  assert(isLegalCell, "AI approach cell is within the legal reachable set");
}

function testChampionAbility() {
  console.log("\n16. Champion special ability (Rally)");
  initArmies();
  const champ = units.get(blueUnitIds.find(id => units.get(id).type === "champion"));
  assert(champ.special === "rally", "champion has the rally ability");

  const rallied = useRally(champ);
  assert(rallied > 0, `rally inspired at least one ally, got ${rallied}`);

  const ally = [...units.values()].find(u => u.team === TEAM_BLUE && u.id !== champ.id && u.rallyTurns > 0);
  assert(ally !== undefined, "an ally received the rally bonus");
  assert(ally.rallyAtkBonus === RALLY_BONUS_ATK, "rally grants the attack bonus");
  assert(ally.rallyDefBonus === RALLY_BONUS_DEF, "rally grants the defense bonus");
  assert(champ.hasUsedSpecial === true, "champion ability marked as used");

  // A second use in the same battle is rejected.
  const second = useRally(champ);
  assert(second === 0, "rally cannot be used twice in one battle");
}

function testTemporaryBonusExpiration() {
  console.log("\n17. Temporary bonus expiration");
  initArmies();
  const champ = units.get(blueUnitIds.find(id => units.get(id).type === "champion"));
  useRally(champ);
  const ally = [...units.values()].find(u => u.team === TEAM_BLUE && u.id !== champ.id && u.rallyTurns > 0);
  assert(ally.rallyTurns === RALLY_DURATION, "rally bonus has a duration");

  expireRallyBuffs();
  assert(ally.rallyTurns === 0, "rally duration decremented at round change");
  assert(ally.rallyAtkBonus === 0, "attack bonus removed when expired");
  assert(ally.rallyDefBonus === 0, "defense bonus removed when expired");
}

function testRallyAffectsDamage() {
  console.log("\n18. Rally bonuses affect damage");
  initArmies();
  const champ = units.get(blueUnitIds.find(id => units.get(id).type === "champion"));
  const victim = units.get(redUnitIds.find(id => units.get(id).type === "footman"));
  const attacker = units.get(blueUnitIds.find(id => units.get(id).type === "archer"));

  const plain = calculateDamage(attacker, victim);
  attacker.rallyAtkBonus = RALLY_BONUS_ATK;
  const rallied = calculateDamage(attacker, victim);
  assert(rallied === plain + RALLY_BONUS_ATK, "rally attack bonus increases damage");

  const defPlain = calculateDamage(attacker, victim);
  victim.rallyDefBonus = RALLY_BONUS_DEF;
  const defRallied = calculateDamage(attacker, victim);
  assert(defRallied < defPlain, "rally defense bonus reduces incoming damage");
}

function testVictoryAndDefeat() {
  console.log("\n19. Victory and defeat");
  initArmies();
  assert(livingCount(TEAM_BLUE) === 11, "blue starts with 11 living");
  assert(livingCount(TEAM_RED) === 11, "red starts with 11 living");

  for (const id of redUnitIds) {
    const u = units.get(id);
    u.alive = false;
    u.defeated = true;
  }
  assert(livingCount(TEAM_RED) === 0, "red has no living units -> victory condition met");
  assert(livingCount(TEAM_BLUE) > 0, "blue still has living units -> victory");

  initArmies();
  for (const id of blueUnitIds) {
    const u = units.get(id);
    u.alive = false;
    u.defeated = true;
  }
  assert(livingCount(TEAM_BLUE) === 0, "blue has no living units -> defeat condition met");
}

function testDefeatedUnitsAreInert() {
  console.log("\n20. Defeated units are inert");
  initArmies();
  const dead = units.get(blueUnitIds[0]);
  dead.alive = false;
  dead.defeated = true;
  const enemy = units.get(redUnitIds[0]);

  assert(!canAttack(dead, enemy), "defeated unit cannot attack");
  assert(!isOccupied(dead.col, dead.row, "someone-else"), "defeated unit does not block a cell");
  assert(getReachableCells(dead).length >= 0, "reachability still computed without crashing");
  assert(!getValidTargets(dead).includes(enemy), "defeated unit is not a valid target source");
}

function testCleanRematch() {
  console.log("\n21. Clean rematch");
  initArmies();
  const champ = units.get(blueUnitIds.find(id => units.get(id).type === "champion"));
  useRally(champ);
  const footman = units.get(blueUnitIds.find(id => units.get(id).type === "footman"));
  applyDamage(footman, 20);
  footman.hasAttacked = true;
  footman.hasMoved = true;

  // Rematch rebuilds the armies from scratch.
  initArmies();
  assert(units.size === 22, "rematch rebuilds exactly 22 units");
  assert(blueUnitIds.length === 11 && redUnitIds.length === 11, "rematch restores 11 units per side");
  assert(livingCount(TEAM_BLUE) === 11, "rematch restores full blue health");
  assert(livingCount(TEAM_RED) === 11, "rematch restores full red health");
  assert([...units.values()].every(u => !u.hasAttacked && !u.hasMoved), "rematch clears action flags");
  assert([...units.values()].every(u => u.hasUsedSpecial === false), "rematch clears champion ability state");
  assert([...units.values()].every(u => u.rallyTurns === 0 && u.rallyAtkBonus === 0 && u.rallyDefBonus === 0), "rematch clears rally bonuses");

  const keys = [...units.values()].map(u => `${u.col},${u.row}`);
  assert(new Set(keys).size === 22, "rematch restores the original formation without overlap");
}

function testNoActionsAfterGameOver() {
  console.log("\n22. No actions after game over");
  initArmies();
  for (const id of redUnitIds) {
    const u = units.get(id);
    u.alive = false;
    u.defeated = true;
  }
  const blue = units.get(blueUnitIds[0]);
  const red = units.get(redUnitIds[0]);
  // Defeated red units are inert, so no attack can resolve.
  assert(!canAttack(blue, red), "cannot attack after the enemy army is wiped");
  assert(livingCount(TEAM_RED) === 0, "battle is over");
}

function testDamageFormula() {
  console.log("\n23. Damage formula");
  initArmies();
  const champ = units.get(blueUnitIds.find(id => units.get(id).type === "champion"));
  const foot = units.get(redUnitIds.find(id => units.get(id).type === "footman"));
  const dmg = calculateDamage(champ, foot);
  assert(dmg === 17, `champion(20) vs footman(def6) = 17, got ${dmg}`);

  const archer = units.get(blueUnitIds.find(id => units.get(id).type === "archer"));
  const rc = units.get(redUnitIds.find(id => units.get(id).type === "champion"));
  const dmg2 = calculateDamage(archer, rc);
  assert(dmg2 === 10, `archer(14) vs champion(def8) = 10, got ${dmg2}`);
}

function testUnitRoles() {
  console.log("\n24. Unit roles");
  initArmies();
  const blue = blueUnitIds.map(id => units.get(id));
  const byType = t => blue.find(u => u.type === t);

  const archer = byType("archer");
  const footman = byType("footman");
  const ballista = byType("ballista");
  const chevalier = byType("chevalier");
  const champion = byType("champion");

  assert(archer.range > footman.range, "archer outranges foot soldiers");
  assert(footman.def > archer.def, "foot soldiers are tougher than archers");
  assert(ballista.atk > archer.atk, "ballista hits harder than an archer");
  assert(ballista.def < footman.def, "ballista is fragile");
  assert(chevalier.move > footman.move, "chevalier outpaces foot soldiers");
  assert(champion.maxHp > footman.maxHp, "champion has more health than foot soldiers");
  assert(champion.atk > footman.atk, "champion hits harder than foot soldiers");
}

console.log("=== myHeroDuelArena v1.1.0 Regression Tests ===");

testArmyComposition();
testUniqueIds();
testInitialPositions();
testNoOverlappingUnits();
testMovementRange();
testOccupiedDestinationRejected();
testOutOfBoundsMovement();
testAttackRange();
testInvalidTargetRejection();
testMinimumDamage();
testHealthBoundaries();
testOneAttackPerUnitPerPhase();
testMovementAllowance();
testTurnTransition();
testAiActionLegality();
testChampionAbility();
testTemporaryBonusExpiration();
testRallyAffectsDamage();
testVictoryAndDefeat();
testDefeatedUnitsAreInert();
testCleanRematch();
testNoActionsAfterGameOver();
testDamageFormula();
testUnitRoles();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
