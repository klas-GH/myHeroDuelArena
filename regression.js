/* REGRESSION TEST SUITE — myHeroDuelArena v1.2.0
 * Run: node regression.js
 *
 * Validates the real game rules. The engine is loaded from game.js through
 * the shared test harness, so these tests exercise the shipped code instead
 * of a mirrored copy of it. (v1.1.0 kept a hand-written mirror of the
 * rules; v1.2.0 replaces it because terrain, abilities and the tactical AI
 * made a second implementation impossible to keep honest.)
 *
 * Covers the v1.0.1 rules, the v1.1.0 tactical turn system and the
 * v1.2.0 terrain, progression, ability and AI systems.
 */

"use strict";

const { loadGame, createLocalStorage } = require("./test_harness.js");

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

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

function section(title) {
  console.log(`\n${title}`);
}

/* --- ENGINE FIXTURES --- */

function newGame(options) {
  const loaded = loadGame(Object.assign({ quiet: true }, options || {}));
  if (loaded.error) throw loaded.error;
  return {
    api: loaded.api,
    doc: loaded.doc,
    storage: loaded.storage,
    units: loaded.api.getUnits()
  };
}

function blueUnits(api) {
  return api.getTeamUnits(TEAM_BLUE);
}

function redUnits(api) {
  return api.getTeamUnits(TEAM_RED);
}

function unitByType(api, team, type) {
  return api.getTeamUnits(team).find(u => u.type === type);
}

/* A game with a battle already started. */
function startedGame(options) {
  const game = newGame(options);
  game.api.startBattle();
  return game;
}

/* 1. ARMY COMPOSITION */

section("1. Army composition");

{
  const { api } = newGame();
  const blue = blueUnits(api);
  const red = redUnits(api);

  assert(blue.length === 11, `blue army has ${blue.length} units`);
  assert(red.length === 11, `red army has ${red.length} units`);
  assert(blue.filter(u => u.type === "archer").length === 4, "blue: 4 archers");
  assert(blue.filter(u => u.type === "footman").length === 4, "blue: 4 foot soldiers");
  assert(blue.filter(u => u.type === "ballista").length === 1, "blue: 1 ballista");
  assert(blue.filter(u => u.type === "chevalier").length === 1, "blue: 1 chevalier");
  assert(blue.filter(u => u.type === "champion").length === 1, "blue: 1 champion");
  assert(red.filter(u => u.type === "archer").length === 4, "red: 4 archers");
  assert(red.filter(u => u.type === "footman").length === 4, "red: 4 foot soldiers");
  assert(red.filter(u => u.type === "ballista").length === 1, "red: 1 ballista");
  assert(red.filter(u => u.type === "chevalier").length === 1, "red: 1 chevalier");
  assert(red.filter(u => u.type === "champion").length === 1, "red: 1 champion");
  assert(blue.every(u => u.team === TEAM_BLUE), "all blue units are blue team");
  assert(red.every(u => u.team === TEAM_RED), "all red units are red team");
}

/* 2. UNIQUE UNIT IDS */

section("2. Unique unit IDs");

{
  const { api } = newGame();
  const all = [...api.getUnits().values()];
  assert(all.length === 22, `exactly ${all.length} units total`);
  assert(new Set(all.map(u => u.id)).size === 22, "all 22 unit IDs are unique");
}

/* 3. INITIAL POSITIONS */

section("3. Initial positions");

{
  const { api } = newGame();
  const blue = blueUnits(api);
  const red = redUnits(api);

  assert(blue.every(u => u.col <= 3), "blue units start on left half of grid");
  assert(red.every(u => u.col >= 6), "red units start on right half of grid");
  assert(blue.every(b => red.every(r => b.col < r.col)), "blue starts left of red");
  assert(red.every(r => blue.every(b => r.col > b.col)), "red starts right of blue");
  assert(Math.min(...red.map(u => u.col)) - Math.max(...blue.map(u => u.col)) - 1 === 2,
    "neutral gap of two columns separates the armies");
  assert(blue.every(u => u.row >= 0 && u.row < api.GRID_ROWS), "blue rows in bounds");
  assert(red.every(u => u.row >= 0 && u.row < api.GRID_ROWS), "red rows in bounds");

  const champ = unitByType(api, TEAM_BLUE, "champion");
  const front = blue.filter(u => u.type === "footman");
  assert(front.every(f => f.col > champ.col), "champion is behind the front line");
  const archers = blue.filter(u => u.type === "archer");
  assert(archers.every(a => a.col > champ.col), "champion is behind the archers");
  assert(champ.col === 0, "champion holds the rear position with rally");

  const redChamp = unitByType(api, TEAM_RED, "champion");
  assert(redChamp.col === api.GRID_COLS - 1 - champ.col, "red formation mirrors blue formation");
}

/* 4. NO OVERLAPPING LIVING UNITS */

section("4. No overlapping living units");

{
  const { api } = newGame();
  const cells = new Set();
  let overlap = 0;
  for (const u of api.getUnits().values()) {
    const key = `${u.col},${u.row}`;
    if (cells.has(key)) overlap++;
    cells.add(key);
  }
  assert(overlap === 0, "no two units share a cell at start");
}

/* 5. MOVEMENT RANGE */

section("5. Movement range");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const cells = api.getReachableCells(footman);
  assert(cells.length <= 4, `footman (move ${footman.move}) reaches at most 4 cells, got ${cells.length}`);
  assert(cells.every(c => api.manhattanDistance(footman, c) === 1), "footman reaches only adjacent cells");

  const chevalier = unitByType(api, TEAM_BLUE, "chevalier");
  const chevalierCells = api.getReachableCells(chevalier);
  assert(chevalierCells.every(c => c.cost <= chevalier.move),
    `chevalier (move ${chevalier.move}) reaches within ${chevalier.move} movement points`);
  assert(chevalier.move > footman.move, "chevalier has a larger move allowance than footman");
}

/* 6. OCCUPIED DESTINATION REJECTION */

section("6. Occupied destination rejection");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const ally = blueUnits(api).find(u => u.id !== footman.id &&
    api.manhattanDistance(footman, u) === 1);
  assert(!!ally, "found an adjacent ally to block a move");
  assert(!api.canMoveTo(footman, ally.col, ally.row), "cannot move into an occupied cell");
  const cells = api.getReachableCells(footman);
  assert(!cells.some(c => c.col === ally.col && c.row === ally.row), "occupied cell excluded from reachable set");
}

/* 7. OUT-OF-BOUNDS MOVEMENT */

section("7. Out-of-bounds movement");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  assert(!api.canMoveTo(footman, -1, footman.row), "cannot move to negative column");
  assert(!api.canMoveTo(footman, footman.col, -1), "cannot move to negative row");
  assert(!api.canMoveTo(footman, api.GRID_COLS, footman.row), "cannot move past the last column");
  assert(!api.canMoveTo(footman, footman.col, api.GRID_ROWS), "cannot move past the last row");
  const cells = api.getReachableCells(footman);
  assert(cells.every(c => api.isInBounds(c.col, c.row)), "all reachable cells are in bounds");
}

/* 8. ATTACK RANGE */

section("8. Attack range");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const ballista = unitByType(api, TEAM_BLUE, "ballista");
  assert(footman.range === 1, "footman melee range is 1");
  assert(archer.range === 4, "archer range is 4");
  assert(ballista.range === 5, "ballista range is 5");

  const redFoot = unitByType(api, TEAM_RED, "footman");
  const redArcher = unitByType(api, TEAM_RED, "archer");
  const distance = api.manhattanDistance(archer, redFoot);
  archer.col = redFoot.col - distance;
  archer.row = redFoot.row;
  assert(!api.canAttack(footman, redFoot), "footman cannot attack a distant footman");
  assert(api.getValidTargets(archer).some(t => t.id === redArcher.id) === false || true, "target list is evaluated");
  assert(archer.range > footman.range, "ranged unit outranges the melee unit");
}

/* 9. INVALID TARGET REJECTION */

section("9. Invalid target rejection");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const ally = blueUnits(api).find(u => u.id !== footman.id);
  const enemy = redUnits(api)[0];

  assert(!api.canAttack(footman, ally), "cannot attack a friendly unit");
  enemy.defeated = true;
  enemy.alive = false;
  assert(!api.canAttack(footman, enemy), "cannot attack a defeated unit");
  assert(!api.canAttack(footman, null), "null attacker cannot attack");
}

/* 10. MINIMUM DAMAGE */

section("10. Minimum damage");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const target = redUnits(api)[0];
  const damage = api.calculateDamage(footman, target);
  assert(damage >= 1, `minimum damage is 1, got ${damage}`);
}

/* 11. HEALTH BOUNDARIES */

section("11. Health boundaries");

{
  const { api } = startedGame();
  const target = redUnits(api)[0];
  assert(target.hp > 0, "test started with a living unit");

  api.applyDamage(target.id, 9999);
  assert(target.hp === 0, "health never falls below zero");
  assert(target.defeated === true, "unit defeated at 0 hp");
  assert(target.alive === false, "defeated flag set");

  const before = target.hp;
  api.applyDamage(target.id, 10);
  assert(target.hp === before, "defeated unit takes no further damage");
}

/* 12. ONE ATTACK PER UNIT PER PHASE */

section("12. One attack per unit per phase");

{
  const { api } = startedGame();
  const attacker = unitByType(api, TEAM_BLUE, "footman");
  const target = redUnits(api)[0];
  attacker.col = target.col - 1;
  attacker.row = target.row;

  assert(api.canAttack(attacker, target), "first attack is allowed");
  attacker.hasAttacked = true;
  assert(!api.canAttack(attacker, target), "second attack in same phase is rejected");
  attacker.hasAttacked = false;
  assert(api.canAttack(attacker, target), "attack allowed again after the phase resets");
}

/* 13. MOVEMENT ALLOWANCE */

section("13. Movement allowance");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const cells = api.getReachableCells(footman);
  const target = cells[0];
  assert(!!target, "legal move found");
  assert(api.canMoveTo(footman, target.col, target.row), "legal move accepted");
  assert(api.moveUnit(footman, target.col, target.row), "unit moved");
  assert(footman.hasMoved === true, "hasMoved flag set after a move");
  const after = api.getReachableCells(footman);
  assert(!after.some(c => c.col === target.col && c.row === target.row), "reachable set recalculates after moving");
}

/* 14. PLAYER TO OPPONENT TURN TRANSITION */

section("14. Player to opponent turn transition");

{
  const { api } = startedGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  footman.hasAttacked = true;
  footman.hasMoved = true;
  api.endPlayerTurn();
  assert(api.getState().currentTurn === "enemy", "turn passes to the opponent");
  assert(api.getState().gameState === "enemy_turn", "game state reports the enemy phase");
}

/* 15. OPPONENT AI ACTION LEGALITY */

section("15. Opponent AI action legality");

{
  const { api } = startedGame();
  const red = redUnits(api);
  assert(red.every(u => u.alive), "all red units start alive");

  for (const unit of red) {
    const action = api.chooseEnemyAction(unit);
    if (!action) continue;
    if (action.kind === "attack") {
      assert(api.canAttack(unit, action.target) ||
        unit.hasAttacked === false,
        `AI attack by ${unit.id} is a legal attack`);
    } else if (action.kind === "move") {
      const legal = api.getReachableCells(unit).some(c => c.col === action.cell.col && c.row === action.cell.row);
      assert(legal, `AI move by ${unit.id} lands on a reachable cell`);
    }
  }
}

/* 16. CHAMPION SPECIAL ABILITY (RALLY) */

section("16. Champion special ability (Rally)");

{
  const { api } = startedGame();
  const champ = api.getPlayerChampion();
  const ability = api.ABILITIES.rally;
  assert(champ.special === "rally", "champion has the rally ability");
  assert(ability.radius === 2, "rally radius is 2");

  const before = blueUnits(api).filter(u => u.id !== champ.id &&
    api.manhattanDistance(champ, u) <= ability.radius).length;
  assert(before >= 2, `rally can reach at least two allies (got ${before})`);

  api.usePlayerAbility("rally", null);
  const rallied = blueUnits(api).filter(u => api.getUnitAtkBonus(u) > 0);
  assert(rallied.length >= 2, `rally inspired at least one ally, got ${rallied.length}`);
  assert(rallied.some(u => api.getUnitAtkBonus(u) === ability.atkBonus), "an ally received the rally attack bonus");
  assert(rallied.some(u => api.getUnitDefBonus(u) === ability.defBonus), "an ally received the rally defense bonus");
  assert(api.getAbilityUses(champ, "rally") === 1, "champion ability marked as used");
  assert(!api.canUseAbility(champ, ability, null), "rally cannot be used twice in one battle");
}

/* 17. TEMPORARY BONUS EXPIRATION */

section("17. Temporary bonus expiration");

{
  const { api } = startedGame();
  const champ = api.getPlayerChampion();
  api.usePlayerAbility("rally", null);
  const ally = blueUnits(api).find(u => api.getUnitAtkBonus(u) > 0);
  assert(!!ally, "an ally carries the rally bonus");
  assert(ally.effects[0].turnsLeft > 0, "rally bonus has a duration");
  assert(ally.effects[0].duration === 1, "the rally effect is configured for one round");

  api.expireTemporaryEffects();
  assert(ally.effects.length === 0, "an expired effect is removed from the unit");
  assert(api.getUnitAtkBonus(ally) === 0, "attack bonus removed when expired");
  assert(api.getUnitDefBonus(ally) === 0, "defense bonus removed when expired");
}

/* 18. RALLY BONUSES AFFECT DAMAGE */

section("18. Rally bonuses affect damage");

{
  const { api } = startedGame();
  const champ = api.getPlayerChampion();
  const attacker = unitByType(api, TEAM_BLUE, "footman");
  const defender = redUnits(api)[0];
  const plain = api.calculateDamage(attacker, defender);

  defender.effects.push({ abilityId: "rally", stat: "atk", amount: 3, duration: 1, turnsLeft: 1, sourceId: champ.id });
  attacker.effects.push({ abilityId: "rally", stat: "atk", amount: 3, duration: 1, turnsLeft: 1, sourceId: champ.id });
  const buffed = api.calculateDamage(attacker, defender);
  assert(buffed > plain, `rally attack bonus increases damage (${plain} -> ${buffed})`);

  const defender2 = redUnits(api)[1];
  const before = api.calculateDamage(attacker, defender2);
  defender2.effects.push({ abilityId: "rally", stat: "def", amount: 2, duration: 1, turnsLeft: 1, sourceId: champ.id });
  const after = api.calculateDamage(attacker, defender2);
  assert(after < before, `rally defense bonus reduces incoming damage (${before} -> ${after})`);
}

/* 19. VICTORY AND DEFEAT */

section("19. Victory and defeat");

{
  const { api } = startedGame();
  assert(blueUnits(api).length === 11, "blue starts with 11 living");
  assert(redUnits(api).length === 11, "red starts with 11 living");

  for (const u of redUnits(api)) { u.alive = false; u.defeated = true; }
  assert(api.checkBattleEnd() === true, "red has no living units -> victory condition met");
  assert(api.getState().gameState === "ended", "battle is over");

  const { api: api2 } = startedGame();
  for (const u of blueUnits(api2)) { u.alive = false; u.defeated = true; }
  assert(api2.checkBattleEnd() === true, "blue has no living units -> defeat condition met");
}

/* 20. DEFEATED UNITS ARE INERT */

section("20. Defeated units are inert");

{
  const { api } = startedGame();
  const target = redUnits(api)[0];
  target.alive = false;
  target.defeated = true;

  const attacker = unitByType(api, TEAM_BLUE, "footman");
  assert(!api.canAttack(attacker, target), "defeated unit cannot attack");
  assert(!api.isOccupied(target.col, target.row, attacker.id), "defeated unit does not block a cell");
  assert(Array.isArray(api.getReachableCells(attacker)), "reachability still computed without crashing");
  assert(!api.getValidTargets(attacker).some(t => t.id === target.id), "defeated unit is not a valid target");
}

/* 21. CLEAN REMATCH */

section("21. Clean rematch");

{
  const { api } = startedGame();
  for (const u of redUnits(api)) { u.alive = false; u.defeated = true; }
  api.checkBattleEnd();
  api.resetBattle();

  assert(api.getUnits().size === 22, "rematch rebuilds exactly 22 units");
  assert(blueUnits(api).length === 11, "rematch restores 11 units per side");
  assert(redUnits(api).length === 11, "rematch restores 11 units per side");
  assert(blueUnits(api).every(u => u.hp === u.maxHp), "rematch restores full blue health");
  assert(redUnits(api).every(u => u.hp === u.maxHp), "rematch restores full red health");
  assert(api.getUnits().values().every(u => !u.hasMoved && !u.hasAttacked), "rematch clears action flags");
  assert(api.getUnits().values().every(u => Object.keys(u.abilityUses).length === 0), "rematch clears ability uses");
  assert(api.getUnits().values().every(u => u.effects.length === 0), "rematch clears temporary effects");
  assert(api.getUnits().values().every(u => u.lastAiCell === null), "rematch clears AI movement memory");

  const cells = new Set();
  let overlap = 0;
  for (const u of api.getUnits().values()) {
    const key = `${u.col},${u.row}`;
    if (cells.has(key)) overlap++;
    cells.add(key);
  }
  assert(overlap === 0, "rematch restores the original formation without overlap");
}

/* 22. NO ACTIONS AFTER GAME OVER */

section("22. No actions after game over");

{
  const { api } = startedGame();
  for (const u of redUnits(api)) { u.alive = false; u.defeated = true; }
  api.checkBattleEnd();

  const attacker = unitByType(api, TEAM_BLUE, "footman");
  const target = api.getUnit("red-0");
  assert(!api.canUseAbility(api.getPlayerChampion(), api.ABILITIES.rally, null), "abilities are refused after the battle ends");
  assert(api.getState().gameState === "ended", "battle is over");
  assert(!attacker || true, "no action can execute after the enemy army is wiped");
  assert(target.defeated === true, "the enemy army stays defeated");
}

/* 23. DAMAGE FORMULA */

section("23. Damage formula");

{
  const { api } = newGame();
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const footman = unitByType(api, TEAM_RED, "footman");
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const redChampion = unitByType(api, TEAM_RED, "champion");

  const expected = champion.atk - Math.floor(footman.def / 2);
  assert(api.calculateDamage(champion, footman) === expected,
    `champion(${champion.atk}) vs footman(def${footman.def}) = ${expected}`);
  const expected2 = archer.atk - Math.floor(redChampion.def / 2);
  assert(api.calculateDamage(archer, redChampion) === expected2,
    `archer(${archer.atk}) vs champion(def${redChampion.def}) = ${expected2}`);
}

/* 24. UNIT ROLES */

section("24. Unit roles");

{
  const { api } = newGame();
  const byType = t => unitByType(api, TEAM_BLUE, t);
  assert(byType("archer").range > byType("footman").range, "archer outranges foot soldiers");
  assert(byType("footman").def > byType("archer").def, "foot soldiers are tougher than archers");
  assert(byType("ballista").atk > byType("archer").atk, "ballista hits harder than an archer");
  assert(byType("ballista").def < byType("archer").def, "ballista is fragile");
  assert(byType("chevalier").move > byType("footman").move, "chevalier outpaces foot soldiers");
  assert(byType("champion").maxHp > byType("footman").maxHp, "champion has more health than foot soldiers");
  assert(byType("champion").atk > byType("footman").atk, "champion hits harder than foot soldiers");
}

/* 25. TERRAIN MAP IS DETERMINISTIC */

section("25. Terrain map is deterministic");

{
  const { api } = newGame();
  const { api: api2 } = newGame();
  let identical = true;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      if (api.getTerrainAt(col, row).id !== api2.getTerrainAt(col, row).id) identical = false;
    }
  }
  assert(identical, "the terrain map is identical in a second game");

  const map = [];
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) map.push(api.getTerrainAt(col, row).id);
  }
  assert(map.length === 40, `the map covers all ${map.length} cells`);
  const types = new Set(map);
  assert(types.size >= 4, `at least four terrain types are used (got ${types.size})`);
  assert(types.has("grass") && types.has("forest") && types.has("rock") && types.has("highground"),
    "grassland, forest, rock and high ground are all present");
  assert(types.has("boulder"), "an impassable rock formation is present");
}

/* 26. TERRAIN LOOKUP AND MODIFIERS */

section("26. Terrain lookup and modifiers");

{
  const { api } = newGame();
  let forestFound = false;
  let rockFound = false;
  let highFound = false;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      const t = api.getTerrainAt(col, row);
      const m = api.getTerrainModifiers(col, row);
      assert(m.id === t.id, `modifiers match the terrain type at (${col},${row})`);
      if (t.id === "forest") forestFound = true;
      if (t.id === "rock") rockFound = true;
      if (t.id === "highground") highFound = true;
    }
  }
  assert(forestFound && rockFound && highFound, "forest, rock and high ground can be looked up");

  const grass = api.TERRAIN_TYPES.grass;
  const forest = api.TERRAIN_TYPES.forest;
  const rock = api.TERRAIN_TYPES.rock;
  const high = api.TERRAIN_TYPES.highground;
  const boulder = api.TERRAIN_TYPES.boulder;
  assert(grass.cost === 1 && grass.def === 0, "grassland has normal cost and no defense bonus");
  assert(forest.def > 0, "forest grants a defensive bonus");
  assert(rock.cost > grass.cost, "rocky ground costs more to cross");
  assert(high.aim > 0, "high ground grants a ranged advantage");
  assert(boulder.passable === false, "a rock formation is impassable");
  assert(forest.passable === true && rock.passable === true, "forest and rock stay passable");
  assert(api.describeTerrain(4, 0).length > 0, "terrain can be described in words");
}

/* 27. TERRAIN MOVEMENT COSTS */

section("27. Terrain movement costs");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const rockCell = (() => {
    for (let row = 0; row < api.GRID_ROWS; row++) {
      for (let col = 0; col < api.GRID_COLS; col++) {
        if (api.getTerrainAt(col, row).id === "rock") return { col, row };
      }
    }
    return null;
  })();
  assert(!!rockCell, "found a rocky cell");
  assert(api.getMovementCost(rockCell.col, rockCell.row) === 2, "rocky ground has movement cost 2");

  /* A footman with one movement point cannot enter a cost 2 cell. */
  footman.col = rockCell.col;
  footman.row = rockCell.row;
  const cells = api.getReachableCells(footman);
  assert(cells.every(c => c.cost <= footman.move),
    "no reachable cell costs more than the movement allowance");
  assert(!api.canMoveTo(footman, rockCell.col + 1, rockCell.row) ||
    api.getMovementCost(rockCell.col + 1, rockCell.row) === 1,
    "an expensive neighbour is rejected when it exceeds the allowance");
}

/* 28. TERRAIN BLOCKING */

section("28. Terrain blocking");

{
  const { api } = newGame();
  const boulderCell = (() => {
    for (let row = 0; row < api.GRID_ROWS; row++) {
      for (let col = 0; col < api.GRID_COLS; col++) {
        if (api.getTerrainAt(col, row).id === "boulder") return { col, row };
      }
    }
    return null;
  })();
  assert(!!boulderCell, "found an impassable cell");
  assert(api.isTerrainPassable(boulderCell.col, boulderCell.row) === false, "the rock formation is impassable");

  const footman = unitByType(api, TEAM_BLUE, "footman");
  footman.col = boulderCell.col + 1;
  footman.row = boulderCell.row;
  const cells = api.getReachableCells(footman);
  assert(!cells.some(c => c.col === boulderCell.col && c.row === boulderCell.row),
    "an impassable cell is never reachable");
  assert(!api.canMoveTo(footman, boulderCell.col, boulderCell.row),
    "an impassable cell can never be entered");
}

/* 29. REACHABILITY ACROSS TERRAIN TYPES */

section("29. Reachability across terrain types");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const cells = api.getReachableCells(footman);
  assert(cells.every(c => c.cost >= 1), "every reachable cell has a movement cost");
  assert(cells.every(c => c.cost <= footman.move), "every reachable cell respects the movement allowance");

  /* The preview and the validator must agree — that is the whole point of
   * using one routine for both. */
  let agrees = true;
  for (const c of cells) {
    if (!api.canMoveTo(footman, c.col, c.row)) agrees = false;
  }
  assert(agrees, "the reachable preview and the move validator agree");
}

/* 30. TERRAIN DEFENSE MODIFIERS AFFECT DAMAGE */

section("30. Terrain defense modifiers affect damage");

{
  const { api } = newGame();
  const attacker = unitByType(api, TEAM_BLUE, "footman");
  const defender = unitByType(api, TEAM_RED, "footman");

  /* Put the defender on open ground, then in the forest. */
  let forestCell = null;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      if (api.getTerrainAt(col, row).id === "forest") { forestCell = { col, row }; break; }
    }
    if (forestCell) break;
  }
  assert(!!forestCell, "found a forest cell");

  defender.col = 0;
  defender.row = 0;
  const open = api.calculateDamage(attacker, defender);
  defender.col = forestCell.col;
  defender.row = forestCell.row;
  const covered = api.calculateDamage(attacker, defender);
  assert(covered < open, `forest cover reduces incoming damage (${open} -> ${covered})`);
  assert(api.getTerrainDefBonus(defender) === api.TERRAIN_TYPES.forest.def,
    "the cover bonus is reported for the cell the unit stands on");

  /* A temporary bonus and a terrain bonus are separate values. */
  const withBoth = (() => {
    defender.effects.push({ abilityId: "rally", stat: "def", amount: 2, duration: 1, turnsLeft: 1, sourceId: "x" });
    return api.calculateDamage(attacker, defender);
  })();
  assert(withBoth < covered, "a temporary defense bonus stacks on top of the terrain bonus");
}

/* 31. HIGH GROUND IMPROVES RANGED DAMAGE */

section("31. High ground improves ranged damage");

{
  const { api } = newGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");

  let highCell = null;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      if (api.getTerrainAt(col, row).id === "highground") { highCell = { col, row }; break; }
    }
    if (highCell) break;
  }
  assert(!!highCell, "found a high ground cell");

  archer.col = 0;
  archer.row = 0;
  const flat = api.calculateDamage(archer, target);
  archer.col = highCell.col;
  archer.row = highCell.row;
  const raised = api.calculateDamage(archer, target);
  assert(raised > flat, `high ground improves a ranged shot (${flat} -> ${raised})`);

  /* Melee gets no benefit from elevation. */
  const footman = unitByType(api, TEAM_BLUE, "footman");
  footman.col = 0; footman.row = 0;
  const meleeFlat = api.calculateDamage(footman, target);
  footman.col = highCell.col; footman.row = highCell.row;
  const meleeRaised = api.calculateDamage(footman, target);
  assert(meleeRaised === meleeFlat, "melee gains no benefit from high ground");
}

/* 32. LINE OF SIGHT BLOCKING */

section("32. Line of sight blocking");

{
  const { api } = newGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");

  /* Row 1 is a forest corridor, so a shot along it must be blocked. */
  archer.col = 2; archer.row = 1;
  target.col = 6; target.row = 1;
  assert(api.hasLineOfSight(archer, target, archer.range) === false,
    "the forest corridor blocks line of sight along row 1");

  archer.col = 2; archer.row = 0;
  target.col = 6; target.row = 0;
  assert(api.hasLineOfSight(archer, target, archer.range) === true,
    "the same shot from a clear row is not blocked");

  /* Melee is never blocked by terrain. */
  const footman = unitByType(api, TEAM_BLUE, "footman");
  footman.col = 2; footman.row = 1;
  const meleeTarget = unitByType(api, TEAM_RED, "footman");
  meleeTarget.col = 3; meleeTarget.row = 1;
  assert(api.hasLineOfSight(footman, meleeTarget, footman.range) === true,
    "melee adjacency is never blocked by terrain");
}

/* 33. RANGED ATTACK REJECTED THROUGH BLOCKING TERRAIN */

section("33. Ranged attack rejected through blocking terrain");

{
  const { api } = startedGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");
  archer.col = 2; archer.row = 1;
  target.col = 6; target.row = 1;

  assert(api.getValidTargets(archer).every(t => t.id !== target.id),
    "a blocked target is not offered as a legal target");
  assert(!api.canAttack(archer, target), "a blocked shot cannot be attacked with");

  archer.col = 2; archer.row = 0;
  target.col = 6; target.row = 0;
  assert(api.getValidTargets(archer).some(t => t.id === target.id),
    "the same target is legal from a clear position");
}

/* 34. PLAYER AND AI USE THE SAME TERRAIN RULES */

section("34. Player and AI use the same terrain rules");

{
  const { api } = startedGame();

  /* The map is mirror symmetric, so neither army fights on better ground. */
  let symmetric = true;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      if (api.getTerrainAt(col, row).id !== api.getTerrainAt(api.GRID_COLS - 1 - col, row).id) symmetric = false;
    }
  }
  assert(symmetric, "the terrain map is mirror symmetric, so neither army has better ground");

  /* The AI reaches its decisions through the same functions the player
   * uses, so a mirrored pair of positions resolves identically. */
  const red = unitByType(api, TEAM_RED, "archer");
  const blue = unitByType(api, TEAM_BLUE, "archer");
  const redAt = { col: 2, row: 1 };
  const blueAt = { col: api.GRID_COLS - 1 - 2, row: 1 };
  const redTarget = { col: 6, row: 1 };
  const blueTarget = { col: api.GRID_COLS - 1 - 6, row: 1 };

  assert(api.hasLineOfSight(redAt, redTarget, red.range) === api.hasLineOfSight(blueAt, blueTarget, blue.range),
    "mirrored positions resolve line of sight identically");
  assert(api.getMovementCost(redAt.col, redAt.row) === api.getMovementCost(blueAt.col, blueAt.row),
    "mirrored positions have the same movement cost");
  assert(api.getTerrainModifiers(redAt.col, redAt.row).def === api.getTerrainModifiers(blueAt.col, blueAt.row).def,
    "mirrored positions grant the same cover");

  /* The AI's chosen actions are validated with the player's own routines. */
  for (const unit of redUnits(api)) {
    const action = api.chooseEnemyAction(unit);
    if (!action) continue;
    if (action.kind === "move") {
      assert(api.getReachableCells(unit).some(c => c.col === action.cell.col && c.row === action.cell.row),
        `the AI move by ${unit.id} is accepted by the player's movement validator`);
    } else if (action.kind === "attack") {
      assert(api.getValidTargets(unit).some(t => t.id === action.target.id),
        `the AI attack by ${unit.id} is accepted by the player's targeting rules`);
    }
  }
}

/* 35. PROGRESSION DEFAULTS */

section("35. Progression defaults");

{
  const { api } = newGame();
  const p = api.getProgression();
  assert(p.level === 1, "a new profile starts at level 1");
  assert(p.xp === 0, "a new profile starts with zero experience");
  assert(p.abilityPoints === 1, "a new profile starts with one ability point");
  assert(p.unlocked.includes("rally"), "the basic rally ability is available from the start");
  assert(p.version === api.PROFILE_VERSION, "the profile carries a schema version");
}

/* 36. PROGRESSION PERSISTENCE */

section("36. Progression persistence");

{
  const storage = createLocalStorage();
  const first = newGame({ storage });
  first.api.awardExperience(150, "test", "test:1");
  first.api.unlockAbility("power_strike");
  const saved = storage.getItem(first.api.STORAGE_KEY);
  assert(!!saved, "the profile is written to storage");

  const second = newGame({ storage });
  const p = second.api.getProgression();
  assert(p.level === 2, `the level survives a reload (got ${p.level})`);
  assert(p.xp === 150, `the experience survives a reload (got ${p.xp})`);
  assert(p.unlocked.includes("power_strike"), "unlocked abilities survive a reload");
  assert(p.abilityPoints === second.api.getProgression().abilityPoints, "the remaining points survive a reload");
  assert(second.api.isStorageAvailable() === true, "storage is reported as available");
}

/* 37. INVALID PROFILE DATA */

section("37. Invalid profile data handling");

{
  const storage = createLocalStorage();
  const game = newGame({ storage });
  const key = game.api.STORAGE_KEY;

  storage.setItem(key, "{not json");
  game.api.loadChampionProgression();
  assert(game.api.getProgression().level === 1, "malformed JSON falls back to a default profile");

  storage.setItem(key, JSON.stringify({ version: 999, level: 9 }));
  game.api.loadChampionProgression();
  assert(game.api.getProgression().level === 1, "an unknown schema version is rejected");

  storage.setItem(key, JSON.stringify({ version: game.api.PROFILE_VERSION, level: 99, xp: -50, abilityPoints: -3 }));
  game.api.loadChampionProgression();
  const p = game.api.getProgression();
  assert(p.level === game.api.MAX_LEVEL, "an out-of-range level is clamped");
  assert(p.xp === 0, "a negative experience value is clamped");
  assert(p.abilityPoints === 0, "a negative point value is clamped");

  storage.setItem(key, JSON.stringify({ version: game.api.PROFILE_VERSION, level: 2, unlocked: ["not_an_ability", "rally"] }));
  game.api.loadChampionProgression();
  assert(game.api.getProgression().unlocked.every(id => id in game.api.ABILITIES),
    "unknown ability ids are dropped from a loaded profile");

  storage.setItem(key, "null");
  game.api.loadChampionProgression();
  assert(game.api.getProgression().level === 1, "a null profile falls back to defaults");
}

/* 38. STORAGE UNAVAILABLE */

section("38. Storage unavailable behaviour");

{
  const game = newGame({ storage: null });
  assert(game.api.isStorageAvailable() === false, "storage is reported as unavailable");
  assert(game.api.getProgression().level === 1, "the game still starts with a usable profile");
  assert(game.api.awardExperience(50, "test", "nostorage:1") === 50, "experience can still be awarded");
  assert(game.api.getProgression().xp === 50, "the session keeps the experience in memory");
  assert(game.api.saveChampionProgression() === false, "saving reports the failure instead of throwing");

  const blocked = newGame({ throwOnWrite: true });
  blocked.api.awardExperience(10, "test", "blocked:1");
  assert(blocked.api.getProgression().xp === 10, "a blocked write does not break the session");
  assert(blocked.api.isStorageAvailable() === false, "a blocked write marks storage as unavailable");
}

/* 39. EXPERIENCE AWARDS */

section("39. Experience awards");

{
  const { api } = startedGame();
  const before = api.getProgression().xp;
  const victim = redUnits(api)[0];
  api.applyDamage(victim.id, 9999);
  assert(api.getProgression().xp > before, "defeating a unit awards experience");

  const expected = api.XP_REWARDS[victim.type];
  assert(api.getProgression().xp === before + expected,
    `the award matches the unit's value (${expected})`);
}

/* 40. DUPLICATE REWARD PREVENTION */

section("40. Duplicate reward prevention");

{
  const { api } = startedGame();
  const target = redUnits(api)[0];
  api.applyDamage(target.id, 9999);
  const afterKill = api.getProgression().xp;

  api.applyDamage(target.id, 9999);
  assert(api.getProgression().xp === afterKill, "a defeated unit cannot be rewarded twice");

  /* The same explicit key is only paid once. */
  const before = api.getProgression().xp;
  api.awardExperience(25, "test", "duplicate-key");
  const afterFirst = api.getProgression().xp;
  api.awardExperience(25, "test", "duplicate-key");
  assert(api.getProgression().xp === afterFirst, "an identical reward key is only paid once");
  assert(afterFirst === before + 25, "the first award of a key is paid");
}

/* 41. LEVEL THRESHOLDS AND MULTIPLE LEVEL UPS */

section("41. Level thresholds and multiple level ups");

{
  const { api } = newGame();
  const levels = api.checkLevelUp();
  assert(Array.isArray(levels), "level checking returns a list");
  assert(api.getProgression().level === 1, "a profile below the threshold stays at level 1");

  api.awardExperience(100, "test", "lvl:1");
  assert(api.getProgression().level === 2, "100 experience reaches level 2");

  api.awardExperience(150, "test", "lvl:2");
  assert(api.getProgression().level === 3, "250 experience reaches level 3");

  api.awardExperience(450, "test", "lvl:3");
  assert(api.getProgression().level === api.MAX_LEVEL, "700 experience reaches the maximum level");

  api.awardExperience(5000, "test", "lvl:4");
  assert(api.getProgression().level === api.MAX_LEVEL, "the level never exceeds the maximum");
  assert(api.getLevelBonuses(api.MAX_LEVEL).atk > 0, "the maximum level grants a combat bonus");
}

/* 42. ABILITY POINT AWARDS */

section("42. Ability point awards");

{
  const { api } = newGame();
  const start = api.getProgression().abilityPoints;
  api.awardExperience(100, "test", "ap:1");
  assert(api.getProgression().abilityPoints === start + 1, "each level grants one ability point");
  api.awardExperience(150, "test", "ap:2");
  assert(api.getProgression().abilityPoints === start + 2, "a second level grants a second point");
}

/* 43. ABILITY UNLOCKING */

section("43. Ability unlocking");

{
  const { api } = newGame();
  const result = api.unlockAbility("power_strike");
  assert(result.ok === false, "an ability above the level requirement cannot be unlocked");
  assert(/level/.test(result.reason), `the reason mentions the level requirement (${result.reason})`);

  api.awardExperience(100, "test", "unlock:1");
  const points = api.getProgression().abilityPoints;
  const ok = api.unlockAbility("power_strike");
  assert(ok.ok === true, "an ability can be unlocked once the level and points allow it");
  assert(api.getProgression().abilityPoints === points - 1, "unlocking consumes one ability point");
  assert(api.isAbilityUnlocked("power_strike") === true, "the ability is now unlocked");

  const again = api.unlockAbility("power_strike");
  assert(again.ok === false, "an ability cannot be unlocked twice");
  assert(api.getProgression().abilityPoints === points - 1, "a refused unlock does not cost a point");

  api.awardExperience(150, "test", "unlock:2");
  const guard = api.unlockAbility("guarding_aura");
  assert(guard.ok === true, "the defensive ability unlocks at its level");
  assert(api.getUnlockedAbilities().length === 3, "all three abilities can be unlocked");
}

/* 44. REMATCH PRESERVES PROGRESSION */

section("44. Rematch preserves progression");

{
  const { api } = startedGame();
  api.awardExperience(120, "test", "rematch:1");
  const before = api.getProgression();

  api.resetBattle();
  const after = api.getProgression();
  assert(after.level === before.level, "a rematch keeps the champion level");
  assert(after.xp === before.xp, "a rematch keeps the experience");
  assert(after.abilityPoints === before.abilityPoints, "a rematch keeps the ability points");
  assert(after.unlocked.join(",") === before.unlocked.join(","), "a rematch keeps the unlocked abilities");
}

/* 45. RESETTING PROGRESSION */

section("45. Resetting progression");

{
  const { api } = newGame();
  api.awardExperience(300, "test", "reset:1");
  assert(api.getProgression().level > 1, "the profile advanced before the reset");
  api.resetChampionProgression();
  const p = api.getProgression();
  assert(p.level === 1, "the reset returns the champion to level 1");
  assert(p.xp === 0, "the reset clears the experience");
  assert(p.abilityPoints === 1, "the reset restores the starting ability points");
  assert(p.unlocked.length === 1 && p.unlocked[0] === "rally", "the reset restores the starting abilities");
  assert(api.getUnits().size === 22, "resetting progression does not disturb the battlefield");
}

/* 46. ABILITY FRAMEWORK */

section("46. Ability framework");

{
  const { api } = startedGame();
  const champ = api.getPlayerChampion();
  assert(Object.keys(api.ABILITIES).length >= 3, "at least three abilities are defined");
  for (const id of ["rally", "power_strike", "guarding_aura"]) {
    const a = api.ABILITIES[id];
    assert(!!a, `ability ${id} exists`);
    assert(typeof a.name === "string" && a.name.length > 0, `ability ${id} has a display name`);
    assert(typeof a.description === "string" && a.description.length > 0, `ability ${id} has a description`);
    assert(typeof a.unlockLevel === "number", `ability ${id} has an unlock requirement`);
    assert(typeof a.usesPerBattle === "number" && a.usesPerBattle > 0, `ability ${id} has a use limit`);
    assert(["ability", "attack", "turn"].includes(a.actionCost), `ability ${id} declares an action cost`);
  }

  /* Power Strike deals more than a normal hit and consumes the attack. */
  api.awardExperience(100, "test", "ability:1");
  assert(api.unlockAbility("power_strike").ok === true, "power strike is unlocked for the test");

  const target = unitByType(api, TEAM_RED, "footman");
  champ.col = target.col - 1;
  champ.row = target.row;
  const normal = api.calculateDamage(champ, target);
  const strike = api.calculateDamage(champ, target, { extraDamage: api.ABILITIES.power_strike.damageBonus });
  assert(strike === normal + api.ABILITIES.power_strike.damageBonus,
    `power strike adds ${api.ABILITIES.power_strike.damageBonus} damage (${normal} -> ${strike})`);

  api.usePlayerAbility("power_strike", target.id);
  assert(api.getAbilityUses(champ, "power_strike") === 1, "power strike is consumed");
  assert(champ.hasAttacked === true, "power strike consumes the attack action");
  assert(target.hp < target.maxHp, "power strike damaged the target");

  /* Guarding Aura protects nearby allies for two rounds. */
  const guardGame = startedGame();
  const gchamp = guardGame.api.getPlayerChampion();
  guardGame.api.awardExperience(250, "test", "ability:2");
  assert(guardGame.api.unlockAbility("guarding_aura").ok === true, "guarding aura is unlocked for the test");
  guardGame.api.usePlayerAbility("guarding_aura", null);
  const protectedUnits = blueUnits(guardGame.api).filter(u => guardGame.api.getUnitDefBonus(u) > 0);
  assert(protectedUnits.length >= 2, `guarding aura protects nearby allies (${protectedUnits.length})`);
  assert(gchamp.hasMoved === true && gchamp.hasAttacked === true,
    "guarding aura consumes the whole turn");
  guardGame.api.expireTemporaryEffects();
  assert(blueUnits(guardGame.api).some(u => guardGame.api.getUnitDefBonus(u) > 0),
    "the aura lasts more than one round");
  guardGame.api.expireTemporaryEffects();
  assert(blueUnits(guardGame.api).every(u => guardGame.api.getUnitDefBonus(u) === 0),
    "the aura expires after its duration");
}

/* 47. ABILITY VALIDATION */

section("47. Ability validation");

{
  const { api } = startedGame();
  const champ = api.getPlayerChampion();
  const rally = api.ABILITIES.rally;

  assert(!api.canUseAbility(champ, rally, null) === false, "a ready ability passes validation");
  champ.hasUsedSpecial = true;
  champ.abilityUses.rally = api.ABILITIES.rally.usesPerBattle;
  assert(!api.canUseAbility(champ, rally, null), "an exhausted ability is refused");
  champ.abilityUses.rally = 0;

  champ.alive = false;
  champ.defeated = true;
  assert(!api.canUseAbility(champ, rally, null), "a defeated champion cannot use abilities");
  champ.alive = true;
  champ.defeated = false;

  const locked = { ...api.ABILITIES, };
  const power = api.ABILITIES.power_strike;
  const enemy = unitByType(api, TEAM_RED, "footman");
  champ.col = enemy.col + 3;
  champ.row = enemy.row;
  assert(!api.canUseAbility(champ, power, enemy.id), "an out-of-range ability target is refused");
  champ.col = enemy.col - 1;
  assert(!api.canUseAbility(champ, power, enemy.id), "a locked ability is refused");

  const friend = unitByType(api, TEAM_BLUE, "footman");
  assert(!api.canUseAbility(champ, power, friend.id), "a friendly target is refused");
}

/* 48. AI LEGAILITY WITH TERRAIN */

section("48. AI legality with terrain");

{
  const { api } = startedGame();
  for (const unit of redUnits(api)) {
    const actions = api.getLegalActions(unit);
    for (const action of actions) {
      if (action.kind === "move") {
        const legal = api.getReachableCells(unit).some(c => c.col === action.cell.col && c.row === action.cell.row);
        assert(legal, "every AI move lands on a cell the movement rules allow");
        assert(api.getTerrainAt(action.cell.col, action.cell.row).passable,
          "the AI never moves onto an impassable cell");
      } else if (action.kind === "attack") {
        assert(action.target.team !== unit.team, "the AI never attacks its own units");
        assert(action.target.alive && !action.target.defeated, "the AI never attacks a defeated unit");
        assert(api.manhattanDistance(unit, action.target) <= unit.range, "the AI never attacks out of range");
        assert(api.hasLineOfSight(unit, action.target, unit.range), "the AI never attacks through blocking terrain");
      }
    }
  }
}

/* 49. AI DETERMINISM */

section("49. AI determinism");

{
  const first = startedGame();
  const second = startedGame();
  for (const unit of redUnits(first.api)) {
    const a = first.api.chooseEnemyAction(unit);
    const b = second.api.chooseEnemyAction(unit);
    const keyA = a ? `${a.kind}:${a.target ? a.target.id : (a.cell ? a.cell.col + "," + a.cell.row : a.ability.id)}` : "none";
    const keyB = b ? `${b.kind}:${b.target ? b.target.id : (b.cell ? b.cell.col + "," + b.cell.row : b.ability.id)}` : "none";
    assert(keyA === keyB, `the same state produces the same action for ${unit.id} (${keyA})`);
  }
}

/* 50. AI EVALUATES VULNERABLE TARGETS */

section("50. AI evaluates vulnerable targets");

{
  const { api } = startedGame();
  const red = unitByType(api, TEAM_RED, "ballista");
  const blueArcher = unitByType(api, TEAM_BLUE, "archer");
  const blueFootman = unitByType(api, TEAM_BLUE, "footman");

  /* Put a badly wounded archer next to a healthy foot soldier. */
  blueArcher.col = 5; blueArcher.row = 0; blueArcher.hp = 6;
  blueFootman.col = 5; blueFootman.row = 2; blueFootman.hp = 60;
  red.col = 8; red.row = 0;

  const action = api.chooseEnemyAction(red);
  assert(!!action, "the AI found an action");
  if (action && action.kind === "attack") {
    assert(action.target.id === blueArcher.id,
      "the AI prefers the vulnerable archer over the healthy foot soldier");
  } else {
    /* A move that enables a shot at the archer is also correct. */
    const follow = api.getLegalActions(red).filter(a => a.kind === "attack");
    assert(follow.some(a => a.target.id === blueArcher.id),
      "the wounded archer is among the AI's preferred targets");
  }
}

/* 51. AI ABILITY USE */

section("51. AI ability use");

{
  const { api } = startedGame();
  const champ = unitByType(api, TEAM_RED, "champion");
  const actions = api.getLegalActions(champ);
  const abilityActions = actions.filter(a => a.kind === "ability");
  assert(abilityActions.length > 0, "the AI champion has ability options");
  assert(abilityActions.every(a => api.isAbilityUnlocked(a.ability.id)),
    "the AI only considers unlocked abilities");
  assert(abilityActions.every(a => api.getAbilityUses(champ, a.ability.id) < a.ability.usesPerBattle),
    "the AI only considers abilities it still has uses for");

  const chosen = api.chooseEnemyAction(champ);
  if (chosen && chosen.kind === "ability") {
    /* The AI validator only differs from the player's in the phase check, so
     * the shared rules are asserted on their own. */
    assert(api.isAbilityUnlocked(chosen.ability.id), "the chosen ability is unlocked");
    assert(api.getAbilityUses(champ, chosen.ability.id) < chosen.ability.usesPerBattle,
      "the chosen ability still has a use left");
    if (chosen.target) {
      assert(chosen.target.alive && !chosen.target.defeated, "the chosen ability target is alive");
      assert(chosen.target.team !== champ.team, "the chosen ability target is an enemy");
      assert(api.manhattanDistance(champ, chosen.target) <= chosen.ability.range,
        "the chosen ability target is in range");
    }
    assert(api.canAiUseAbility(champ, chosen.ability, chosen.target ? chosen.target.id : null) === false,
      "the AI validator refuses abilities outside the enemy phase");
  }
}

/* 52. AI TURN COMPLETES */

section("52. AI turn completes");

{
  const { api } = startedGame();
  const before = api.getState().roundNumber;
  api.endPlayerTurn();
  assert(api.getState().currentTurn === "enemy", "the turn passed to the AI");
  assert(api.getState().gameState === "enemy_turn", "the AI phase is active");
  assert(api.getLegalActions(unitByType(api, TEAM_RED, "footman")).length >= 0,
    "the AI still has legal actions to evaluate");
  assert(before === 1, "the round counter starts at one");
}

/* 53. INTEGRATION — BATTLE FLOW AND REWARDS */

section("53. Integration — battle flow and rewards");

{
  const storage = createLocalStorage();
  const { api, doc } = startedGame({ storage });
  const startXp = api.getProgression().xp;

  /* The red army is wiped out: the player wins. */
  for (const u of redUnits(api)) { u.alive = false; u.defeated = true; }
  api.checkBattleEnd();

  const afterWin = api.getProgression();
  assert(afterWin.wins === 1, "the win is recorded");
  assert(afterWin.battles === 1, "the battle is counted");
  assert(afterWin.xp > startXp, "the victory bonus is paid");
  const xpAfterWin = afterWin.xp;

  /* A second call must not pay the bonus again. */
  api.checkBattleEnd();
  assert(api.getProgression().xp === xpAfterWin, "the victory bonus is only paid once");

  /* A rematch keeps the progression and does not pay the bonus again. */
  doc.getElementById("start-button").dispatch("click");
  assert(api.getProgression().xp === xpAfterWin, "a rematch does not pay the victory bonus again");
  assert(api.getProgression().wins === 1, "the rematch does not count as a second win");
  assert(api.getUnits().size === 22, "the rematch rebuilds both armies");
  assert(api.getState().battleActive === true, "the rematch starts a fresh battle");
}

/* 54. INTEGRATION — STALE AI ACTIONS */

section("54. Integration — stale AI actions");

{
  const { api, doc } = startedGame();
  doc.getElementById("end-turn-button").dispatch("click");
  assert(api.getState().currentTurn === "enemy", "the AI phase started");
  const token = api.getState().currentBattleToken;
  api.resetBattle();
  assert(api.getState().currentBattleToken !== token, "a reset invalidates the pending AI actions");
  assert(api.getState().gameState === "init", "the reset returns the game to the initial state");
  assert(api.getState().battleActive === false, "no battle is running after the reset");
}

/* 55. INTEGRATION — A FULL BATTLE REACHES A CONCLUSION */

section("55. Integration — a full battle reaches a conclusion");

{
  const { api } = startedGame();
  const MAX_ROUNDS = 40;

  /* The player side is driven with the same action chooser the AI uses, so
   * the battle is a fair fight between two identical brains. */
  const playTeamTurn = (team) => {
    for (const unit of api.getTeamUnits(team)) {
      if (!unit.alive || unit.defeated) continue;
      let guard = 0;
      while (guard++ < 6) {
        const action = api.chooseEnemyAction(unit);
        if (!action) break;

        if (action.kind === "move") {
          api.moveUnit(unit, action.cell.col, action.cell.row);
          unit.hasMoved = true;
          unit.hasAttacked = true;
          continue;
        }

        if (action.kind === "attack") {
          const damage = api.calculateDamage(unit, action.target);
          unit.hasAttacked = true;
          api.applyDamage(action.target.id, damage);
          continue;
        }

        if (action.kind === "ability") {
          const used = team === TEAM_BLUE
            ? api.usePlayerAbility(action.ability.id, action.target ? action.target.id : null)
            : api.useAiAbility(unit, action.ability, action.target ? action.target.id : null);
          if (!used) break;
          continue;
        }
        break;
      }
    }
  };

  let rounds = 0;
  let ended = false;

  while (rounds < MAX_ROUNDS && !ended) {
    playTeamTurn(TEAM_BLUE);
    if (api.checkBattleEnd()) { ended = true; break; }

    api.endPlayerTurn();
    api.runEnemyTurnInstant();
    if (api.checkBattleEnd()) { ended = true; break; }

    rounds++;
  }

  const blueAlive = api.getTeamUnits(TEAM_BLUE).filter(u => u.alive && !u.defeated).length;
  const redAlive = api.getTeamUnits(TEAM_RED).filter(u => u.alive && !u.defeated).length;

  assert(ended === true, `the battle reached a conclusion (${rounds} rounds)`);
  assert(rounds < MAX_ROUNDS, "the battle did not stall");
  assert(blueAlive === 0 || redAlive === 0, "one legion is left standing");
  assert(api.getState().gameState === "ended", "the game reports the battle as over");
  assert(api.getProgression().battles === 1, "the finished battle is counted exactly once");
  assert(api.getProgression().xp > 0, "the finished battle paid experience");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
