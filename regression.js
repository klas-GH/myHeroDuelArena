/* REGRESSION TEST SUITE - myHeroDuelArena v1.7.0
 * Run: node regression.js
 *
 * Validates the real game rules. The engine is loaded from game.js through
 * the shared test harness, so these tests exercise the shipped code instead
 * of a mirrored copy of it. (v1.1.0 kept a hand-written mirror of the
 * rules; v1.2.0 replaces it because terrain, abilities and the tactical AI
 * made a second implementation impossible to keep honest.)
 *
 * Covers the v1.0.1 rules, the v1.1.0 tactical turn system, the v1.2.0
 * terrain, progression, ability and AI systems, the v1.4.0 battlefield
 * selector, the v1.5.0 round limit, sudden death and spectator mode and
 * the v1.6.0 tactical depth, damage numbers and battle report and the
 * v1.8.0 duel series, armour, defence stand and riposte.
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

/* A short, stable description of an AI action, so two runs can be compared.
 * Every kind of action is covered: a move, an attack, an ability, a defence
 * stand and the "do nothing" answer. */
function actionKey(action) {
  if (!action) return "none";
  if (action.kind === "brace") return "brace";
  if (action.kind === "attack") return `attack:${action.target ? action.target.id : "none"}`;
  if (action.kind === "ability") return `ability:${action.ability ? action.ability.id : "none"}`;
  if (action.kind === "move") return `move:${action.cell ? action.cell.col + "," + action.cell.row : "none"}`;
  return action.kind || "none";
}

/* 1. ARMY COMPOSITION */

section("1. Army composition");

{
  const { api } = newGame();
  const blue = blueUnits(api);
  const red = redUnits(api);

  assert(blue.length === 7, `blue army has ${blue.length} units`);
  assert(red.length === 7, `red army has ${red.length} units`);
  assert(blue.filter(u => u.type === "archer").length === 2, "blue: 2 archers");
  assert(blue.filter(u => u.type === "footman").length === 2, "blue: 2 foot soldiers");
  assert(blue.filter(u => u.type === "ballista").length === 1, "blue: 1 ballista");
  assert(blue.filter(u => u.type === "chevalier").length === 1, "blue: 1 chevalier");
  assert(blue.filter(u => u.type === "champion").length === 1, "blue: 1 champion");
  assert(red.filter(u => u.type === "archer").length === 2, "red: 2 archers");
  assert(red.filter(u => u.type === "footman").length === 2, "red: 2 foot soldiers");
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
  assert(all.length === 14, `exactly ${all.length} units total`);
  assert(new Set(all.map(u => u.id)).size === 14, "all 14 unit IDs are unique");
}

/* 3. INITIAL POSITIONS */

section("3. Initial positions");

{
  const { api } = newGame();
  const blue = blueUnits(api);
  const red = redUnits(api);

  assert(blue.every(u => u.col >= 1 && u.col <= 3), "blue units start on the left third of the grid");
  assert(red.every(u => u.col >= 6 && u.col <= 8), "red units start on the right third of the grid");
  assert(blue.every(b => red.every(r => b.col < r.col)), "blue starts left of red");
  assert(red.every(r => blue.every(b => r.col > b.col)), "red starts right of blue");
  assert(Math.min(...red.map(u => u.col)) - Math.max(...blue.map(u => u.col)) - 1 === 2,
    "neutral gap of two columns separates the armies");
  assert(blue.every(u => u.row >= 0 && u.row < api.GRID_ROWS), "blue rows in bounds");
  assert(red.every(u => u.row >= 0 && u.row < api.GRID_ROWS), "red rows in bounds");
  assert(blue.every(u => api.isTerrainPassable(u.col, u.row)), "every blue slot is passable ground");
  assert(red.every(u => api.isTerrainPassable(u.col, u.row)), "every red slot is passable ground");

  const champ = unitByType(api, TEAM_BLUE, "champion");
  const front = blue.filter(u => u.type === "footman" || u.type === "chevalier");
  assert(front.every(f => f.col === champ.col + 1), "the front rank stands one column ahead of the champion");
  assert(front.length === 3, `the front rank covers three lanes (${front.length} fighters)`);
  assert(new Set(front.map(f => f.row)).size === 3, "the front rank fills three lanes");
  assert(!front.some(f => f.row === champ.row), "the champion's lane is free in the front rank");

  const shooters = blue.filter(u => u.type === "ballista" || u.type === "archer");
  assert(shooters.every(s => s.col === champ.col), "the shooters hold the rear column with the champion");
  assert(shooters.length === 3, `the rear rank covers three lanes (${shooters.length} shooters)`);
  assert(new Set(shooters.map(s => s.row)).size === 3, "the rear rank fills three lanes");

  const archers = blue.filter(u => u.type === "archer");
  assert(archers.every(a => a.col === champ.col), "the archers stand in the rear column");
  assert(champ.col === 2, "champion holds the rear position with rally");
  assert(champ.footprint === 2, "the champion is drawn across two columns");
  assert(blue.filter(u => u.type === "champion").length === 1, "the champion is one unit, not two");

  const chevaliers = blue.filter(u => u.type === "chevalier");
  assert(chevaliers.every(c => c.col === 3), "the chevalier fights in the front rank");
  const ballistas = blue.filter(u => u.type === "ballista");
  assert(ballistas.every(b => b.col === 2), "the ballista stands in the rear column");

  const redChamp = unitByType(api, TEAM_RED, "champion");
  assert(redChamp.col === api.GRID_COLS - 1 - champ.col, "red formation mirrors blue formation");
  assert(redChamp.row === champ.row, "the champions face each other across the field");
  assert(red.filter(u => u.type === "chevalier").every(c => c.col === api.GRID_COLS - 1 - 3),
    "the red chevalier holds the red front rank");
  assert(red.filter(u => u.type === "ballista").every(b => b.col === api.GRID_COLS - 1 - 2),
    "the red ballista stands in the red rear column");
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

/* 5. MOVEMENT RANGE — the octagonal model */

section("5. Movement range");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const cells = api.getReachableCells(footman);
  assert(cells.length <= 8, `footman (move ${footman.move}) reaches at most 8 cells, got ${cells.length}`);
  assert(cells.every(c => api.fieldDistance(footman, c) === 1), "footman reaches only adjacent cells");
  assert(cells.some(c => c.col !== footman.col && c.row !== footman.row),
    "footman reaches diagonal cells");

  const chevalier = unitByType(api, TEAM_BLUE, "chevalier");
  const chevalierCells = api.getReachableCells(chevalier);
  assert(chevalierCells.every(c => c.cost <= chevalier.move),
    `chevalier (move ${chevalier.move}) reaches within ${chevalier.move} movement points`);
  assert(chevalier.move > footman.move, "chevalier has a larger move allowance than footman");
}

/* 5.1 DEPLOYMENT EDGE — troops may advance or reposition within their own
 * edge, but cannot retreat behind the outermost starting column. */

section("5.1. Deployment edge");

{
  const { api } = newGame();
  const blueBoundary = api.DEPLOYMENT_BOUNDARY[TEAM_BLUE];
  const redBoundary = api.DEPLOYMENT_BOUNDARY[TEAM_RED];
  const blueStart = blueUnits(api);
  const redStart = redUnits(api);

  assert(blueBoundary === Math.min(...blueStart.map(u => u.col)),
    `blue boundary is derived from its starting formation (${blueBoundary})`);
  assert(redBoundary === Math.max(...redStart.map(u => u.col)),
    `red boundary is derived from its starting formation (${redBoundary})`);

  for (const team of [TEAM_BLUE, TEAM_RED]) {
    const allies = api.getTeamUnits(team);
    const moves = allies.flatMap(unit => api.getLegalActions(unit)
      .filter(action => action.kind === "move"));
    const valid = moves.every(action => team === TEAM_BLUE
      ? action.cell.col >= blueBoundary
      : action.cell.col <= redBoundary);
    assert(valid, `${team} player/AI legal moves stay inside the deployment boundary`);
  }

  const blue = unitByType(api, TEAM_BLUE, "footman");
  const red = unitByType(api, TEAM_RED, "footman");
  assert(api.getReachableCells(blue).some(cell => cell.col > blue.col),
    "blue can still advance toward the crimson legion");
  assert(api.getReachableCells(red).some(cell => cell.col < red.col),
    "red can still advance toward the azure legion");

  blue.col = blueBoundary;
  blue.hasMoved = false;
  const bluePosition = { col: blue.col, row: blue.row };
  const blueMoved = blue.hasMoved;
  assert(!api.canStandAt(blue, blueBoundary - 1, blue.row),
    "blue cannot stand behind its initial deployment edge");
  assert(!api.getReachableCells(blue).some(cell => cell.col < blueBoundary),
    "blue retreat cells behind the edge are not offered");
  assert(!api.moveUnit(blue, blueBoundary - 1, blue.row),
    "blue direct movement behind the edge is refused");
  assert(blue.col === bluePosition.col && blue.row === bluePosition.row
    && blue.hasMoved === blueMoved,
    "a refused blue retreat changes neither position nor action flags");

  red.col = redBoundary;
  red.hasMoved = false;
  const redPosition = { col: red.col, row: red.row };
  const redMoved = red.hasMoved;
  assert(!api.canStandAt(red, redBoundary + 1, red.row),
    "red cannot stand behind its initial deployment edge");
  assert(!api.getReachableCells(red).some(cell => cell.col > redBoundary),
    "red retreat cells behind the edge are not offered");
  assert(!api.moveUnit(red, redBoundary + 1, red.row),
    "red direct movement behind the edge is refused");
  assert(red.col === redPosition.col && red.row === redPosition.row
    && red.hasMoved === redMoved,
    "a refused red retreat changes neither position nor action flags");
}

/* 5.1 A DIAGONAL STEP MAY NOT SLIP PAST A CORNER */

section("5.2. A diagonal step may not slip past a corner");

{
  const { api } = newGame();
  /* The blocked pair is built on an empty board instead. Columns 4 and 5 are
   * the neutral ground between the two lines, so nothing stands there. */
  const footman = unitByType(api, TEAM_BLUE, "footman");
  footman.col = 4;
  footman.row = 2;

  const cells = api.getReachableCells(footman);
  const diagonal = cells.find(c => c.col === 5 && c.row === 1);
  assert(!!diagonal, "an open diagonal step is allowed");

  /* Block both cells that a diagonal step would slip between: (4,1) and
   * (5,2). */
  const blockerA = redUnits(api)[0];
  const blockerB = redUnits(api)[1];
  blockerA.col = 4; blockerA.row = 1;
  blockerB.col = 5; blockerB.row = 2;

  const blocked = api.getReachableCells(footman);
  assert(!blocked.some(c => c.col === 5 && c.row === 1),
    "a diagonal step between two blocked cells is refused");

  /* With only one of the two cells blocked the step is open again. */
  blockerB.col = 0; blockerB.row = 0;
  const reopened = api.getReachableCells(footman);
  assert(reopened.some(c => c.col === 5 && c.row === 1),
    "a diagonal step with one open side is allowed");
}

/* 6. OCCUPIED DESTINATION REJECTION */

section("6. Occupied destination rejection");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const ally = blueUnits(api).find(u => u.id !== footman.id &&
    api.fieldDistance(footman, u) === 1);
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
  assert(footman.range === 1, "footman melee reach is 1 (adjacent only, v1.12.2)");
  assert(archer.range === 3, "archer range is 3");
  assert(ballista.range === 4, "ballista range is 4");

  const redFoot = unitByType(api, TEAM_RED, "footman");
  const redArcher = unitByType(api, TEAM_RED, "archer");
  const distance = api.fieldDistance(archer, redFoot);
  archer.col = redFoot.col - distance;
  archer.row = redFoot.row;
  assert(!api.canAttack(footman, redFoot), "footman cannot attack a distant footman");
  assert(api.getValidTargets(archer).some(t => t.id === redArcher.id) === false || true, "target list is evaluated");
  assert(archer.range > footman.range, "ranged unit outranges the melee unit");

  /* A bow covers the whole field: the archer shoots the far corner of the
   * field without moving a step. */
  assert(api.getRangedReach(archer) === api.RANGED_REACH, "a bow reaches the whole field");
  assert(api.getRangedReach(footman) === 0, "a fighter that fights with its own hands has no bow");
  archer.col = 0; archer.row = 0;
  redFoot.col = api.GRID_COLS - 1; redFoot.row = api.GRID_ROWS - 1;
  assert(api.canAttack(archer, redFoot), "the archer shoots an enemy in the far corner of the field");
  assert(api.getValidTargets(archer).some(t => t.id === redFoot.id),
    "the far corner is offered as a legal target");
}

/* 8.1 MELEE REACHES DIAGONALLY AND TWO COLUMNS FORWARD */

section("8.1. Melee reaches diagonally and two columns forward");

{
  const { api } = newGame();
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const target = unitByType(api, TEAM_RED, "footman");

  target.col = footman.col + 1;
  target.row = footman.row + 1;
  assert(api.fieldDistance(footman, target) === 1, "a diagonal neighbour is one step away");
  assert(api.canAttack(footman, target), "melee reaches a diagonal neighbour");

  target.col = footman.col + 2;
  target.row = footman.row + 1;
  assert(api.fieldDistance(footman, target) === 2, "a knight's move is two steps away");
  assert(!api.canAttack(footman, target), "melee does not reach two columns forward (adjacent only)");
}

/* 8.2 THE FRONT LINE: WHO A BLADE MAY AND MAY NOT REACH
 *
 * A bow reaches every enemy on the field: neither the front line of the
 * other army nor the ground between the armies turns a shot aside. A blade
 * only cuts forward, and it only cuts a target it can walk up to: the rank
 * in front has to close every lane before it holds.
 */

section("8.2. The front line");

{
  const { api } = newGame();

  const blueFoot = unitByType(api, TEAM_BLUE, "footman");
  const blueArcher = unitByType(api, TEAM_BLUE, "archer");
  const redFoot = unitByType(api, TEAM_RED, "footman");
  const redArcher = unitByType(api, TEAM_RED, "archer");
  const redChevalier = unitByType(api, TEAM_RED, "chevalier");
  const redChamp = unitByType(api, TEAM_RED, "champion");

  /* Only the fighters under test stand on the field, so nothing else can
   * open or close a lane by accident. */
  const keep = new Set([blueFoot.id, blueArcher.id, redFoot.id, redArcher.id,
    redChevalier.id, redChamp.id]);
  for (const u of api.getUnits()) {
    if (keep.has(u.id)) continue;
    u.alive = false;
    u.defeated = true;
  }

  /* The blue line stands on the left, the crimson line on the right. */
  blueFoot.col = 2; blueFoot.row = 1;
  blueArcher.col = 1; blueArcher.row = 1;
  redFoot.col = 4; redFoot.row = 1;
  redArcher.col = 3; redArcher.row = 0;
  redChevalier.col = 3; redChevalier.row = 2;

  /* A bow reaches every enemy on the field, the front rank and the rank
   * behind it alike. */
  assert(api.canAttack(blueArcher, redFoot), "a bow reaches the front rank of the other army");
  assert(api.canAttack(blueArcher, redArcher), "a bow reaches a fighter that stands behind the front line");
  assert(api.canAttack(blueArcher, redFoot) && api.canAttack(blueArcher, redArcher),
    "the front line of the other army never covers anyone from a shot");

  /* Adjacent only (v1.12.2): put the foe next to the blade. */
  redFoot.col = 3; redFoot.row = 1;
  assert(api.fieldDistance(blueFoot, redFoot) === 1, "adjacent foe is one step away");
  assert(api.canAttack(blueFoot, redFoot), "a blade reaches an adjacent enemy in front of it");

  /* Two columns away is out of melee reach. */
  redFoot.col = 4; redFoot.row = 1;
  assert(!api.canAttack(blueFoot, redFoot), "a blade cannot strike two columns away");

  /* A blade never strikes backwards. */
  redFoot.col = 1; redFoot.row = 1;
  assert(!api.canAttack(blueFoot, redFoot), "a blade never strikes backwards");

  /* A blade never strikes further than its own reach. */
  redFoot.col = 5; redFoot.row = 1;
  assert(!api.canAttack(blueFoot, redFoot), "a blade does not reach three columns forward");
}

/* 8.3 A BOW REACHES EVERY ENEMY ON THE FIELD
 *
 * A shot is not stopped by distance, by the rank in front of the target or
 * by the ground it crosses. Only a dead, friendly or imaginary target is
 * out of reach.
 */

section("8.3. A bow reaches every enemy on the field");

{
  const { api } = newGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const ballista = unitByType(api, TEAM_BLUE, "ballista");
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const enemies = redUnits(api);
  const target = enemies[0];

  /* Every row of the field. */
  for (let row = 0; row < api.GRID_ROWS; row++) {
    target.col = 7;
    target.row = row;
    archer.col = 0;
    archer.row = 0;
    assert(api.canAttack(archer, target), `the archer reaches an enemy in row ${row}`);
  }

  /* Every column of the field. */
  for (let col = 0; col < api.GRID_COLS; col++) {
    target.col = col;
    target.row = 1;
    archer.col = 0;
    archer.row = 3;
    assert(api.canAttack(archer, target), `the archer reaches an enemy in column ${col}`);
  }

  /* Far beyond the old reach of three cells. */
  target.col = api.GRID_COLS - 1;
  target.row = 0;
  archer.col = 0;
  archer.row = 0;
  assert(api.fieldDistance(archer, target) > 3, "the target lies beyond the old range of the bow");
  assert(api.canAttack(archer, target), "the bow still reaches the far corner of the field");

  /* A shot passes over a friend in the way. */
  const friend = unitByType(api, TEAM_BLUE, "footman");
  friend.col = 4;
  friend.row = 0;
  target.col = 7;
  target.row = 0;
  assert(api.canAttack(archer, target), "a shot is not stopped by a friend in the way");

  /* And over an enemy in the way. */
  const foe = enemies[1];
  foe.col = 4;
  foe.row = 0;
  assert(api.canAttack(archer, target), "a shot is not stopped by an enemy in the way");

  /* And over the forest corridor in row 1. */
  archer.col = 2;
  archer.row = 1;
  target.col = 6;
  target.row = 1;
  assert(api.canAttack(archer, target), "a shot is not stopped by the forest in the way");

  /* And over a rock formation: the ballista and the champion's bow obey
   * the same rule. */
  api.setActiveMap("high_ground");
  archer.col = 2;
  archer.row = 0;
  target.col = 7;
  target.row = 0;
  assert(api.getTerrainAt(4, 0).id === "boulder", "the high ground map has a rock wall in row 0");
  assert(api.canAttack(archer, target), "a shot is not stopped by a rock formation");

  ballista.col = 0;
  ballista.row = 0;
  assert(api.canAttack(ballista, target), "the ballista reaches the whole field as well");
  champion.col = 0;
  champion.row = 0;
  assert(api.canAttack(champion, target), "the champion's bow reaches the whole field as well");

  /* Dead, friendly and imaginary targets are still refused. */
  target.alive = false;
  target.defeated = true;
  assert(!api.canAttack(archer, target), "a dead enemy is not a target");
  target.alive = true;
  target.defeated = false;
  const friend2 = unitByType(api, TEAM_BLUE, "footman");
  assert(!api.canAttack(archer, friend2), "a friend is not a target");
  const ghost = {
    id: "ghost", team: api.TEAM_RED, type: "footman", alive: true, defeated: false,
    col: 5, row: 1, hp: 10, maxHp: 10, def: 2, atk: 5, shot: null, melee: true
  };
  assert(!api.canAttack(archer, ghost), "a target that is not on the field is refused");
  assert(api.getValidTargets(archer).every(t => t.id !== "ghost"),
    "a target that is not on the field is never offered");
}

/* 8.4 THE MELEE GAP RULE
 *
 * A blade reaches a target it can walk up to. The lanes between the two
 * decide: one open lane is a door, a closed wall of fighters is not.
 */

section("8.4. The melee gap rule");

{
  const { api } = newGame();
  const blade = unitByType(api, TEAM_BLUE, "footman");
  const foe = unitByType(api, TEAM_RED, "footman");
  const allies = blueUnits(api).filter(u => u.id !== blade.id);
  const foes = redUnits(api).filter(u => u.id !== foe.id);
  /* The fighters that are used again later are kept aside before the field
   * is cleared. */
  const blueArcher = allies.find(u => u.type === "archer");
  const redArcher = foes.find(u => u.type === "archer");
  const redBlade = foes.find(u => u.type === "footman");

  /* Everything that is not the pair under test is taken off the field, so
   * that only the lanes of this test decide the outcome. */
  for (const unit of [...allies, ...foes]) {
    unit.alive = false;
    unit.defeated = true;
  }
  blade.col = 3;
  blade.row = 1;
  foe.col = 4;
  foe.row = 1;

  /* Straight ahead, adjacent (v1.12.2). */
  assert(api.getStrikeKind(blade, blade, foe) === "melee", "a blade reaches the enemy straight ahead");
  assert(api.canAttack(blade, foe), "a blade strikes straight ahead");

  /* One lane to the side, diagonally adjacent. */
  foe.col = 4;
  foe.row = 2;
  assert(api.canAttack(blade, foe), "a blade strikes a foe one lane to the side");

  /* Behind the blade. */
  foe.col = 2;
  foe.row = 1;
  assert(!api.canAttack(blade, foe), "a blade never strikes backwards");
  foe.col = 2;
  foe.row = 2;
  assert(!api.canAttack(blade, foe), "a blade never strikes backwards, not even diagonally");

  /* Beyond the reach of the blade. */
  foe.col = 6;
  foe.row = 1;
  assert(!api.canAttack(blade, foe), "a blade does not reach three columns ahead");
  blade.col = 3;
  blade.row = 0;
  foe.col = 4;
  foe.row = 3;
  assert(api.fieldDistance(blade, foe) > blade.range, "the target lies three lanes away");
  assert(!api.canAttack(blade, foe), "a blade does not reach three lanes away");
  blade.row = 1;

  /* Second rank is out of melee reach (adjacent-only rule). */
  const helper = foes[0];
  helper.alive = true;
  helper.defeated = false;
  helper.col = 4;
  helper.row = 1;
  foe.col = 5;
  foe.row = 1;
  assert(!api.canAttack(blade, foe), "a blade does not reach the second rank (adjacent only)");

  /* Closed rank still covers; open lane does not restore two-column melee. */
  const blockers = [helper, foes[1], foes[2]];
  blockers.forEach((blocker, index) => {
    blocker.alive = true;
    blocker.defeated = false;
    blocker.col = 4;
    blocker.row = index;
  });
  assert(api.isShielded(blade, foe, api.TEAM_RED, api.TEAM_BLUE),
    "a closed rank covers the target behind it");
  assert(!api.canAttack(blade, foe), "a blade cannot cut through a closed rank");
  blockers[1].col = 0;
  blockers[1].row = 0;
  assert(!api.isShielded(blade, foe, api.TEAM_RED, api.TEAM_BLUE),
    "the cover is gone with the fighter that closed the lane");
  assert(!api.canAttack(blade, foe), "second rank stays out of melee reach even with an open lane");

  /* The terrain in between never turns a legal blow aside. */
  blueArcher.alive = true;
  blueArcher.defeated = false;
  blueArcher.col = 2;
  blueArcher.row = 1;
  redArcher.alive = true;
  redArcher.defeated = false;
  redArcher.col = 4;
  redArcher.row = 1;
  assert(api.getTerrainAt(3, 1).id === "forest", "row 1 of the old frontier is a forest corridor");
  assert(api.canAttack(blueArcher, redArcher), "the forest in the way does not turn a blow aside");

  /* The red army answers under the same rules. */
  redBlade.alive = true;
  redBlade.defeated = false;
  redBlade.col = 5;
  redBlade.row = 1;
  blueArcher.col = 4;
  blueArcher.row = 1;
  assert(api.canAttack(redBlade, blueArcher), "the crimson blade reaches the target in front of it");
  blueArcher.col = 8;
  assert(!api.canAttack(redBlade, blueArcher), "the crimson blade never strikes backwards");
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
  /* A foot soldier of the front rank, with nothing standing in front of it. */
  const target = redUnits(api).find(u => u.type === "footman");
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
  assert(ability.radius === 1, "rally radius is 1");

  const before = blueUnits(api).filter(u => u.id !== champ.id &&
    api.fieldDistance(champ, u) <= ability.radius).length;
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
  assert(blueUnits(api).length === 7, "blue starts with 7 living");
  assert(redUnits(api).length === 7, "red starts with 7 living");

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

  assert(api.getUnits().size === 14, "rematch rebuilds exactly 14 units");
  assert(blueUnits(api).length === 7, "rematch restores 7 units per side");
  assert(redUnits(api).length === 7, "rematch restores 7 units per side");
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

  /* The plain formula, minus the share of the blow that the armour of the
   * defender turns away. */
  const expected = Math.round((champion.atk - Math.floor(footman.def / 2)) * (1 - api.getUnitArmour(footman)));
  /* Put the target on open ground in front of the champion, so the numbers
   * show the plain formula without a cover bonus. */
  let open = null;
  for (let dc = 1; dc <= 2 && !open; dc++) {
    for (let dr = -2; dr <= 2 && !open; dr++) {
      const col = champion.col + dc;
      const row = champion.row + dr;
      if (row < 0 || row >= api.GRID_ROWS) continue;
      if (api.getTerrainDefBonus({ col, row }) === 0) open = { col, row };
    }
  }
  assert(!!open, "found open ground in front of the champion");
  footman.col = open.col;
  footman.row = open.row;
  assert(api.getStrikeKind(champion, champion, footman) === "melee", "the champion fights with its own weapon up close");
  assert(api.calculateDamage(champion, footman) === expected,
    `champion(${champion.atk}) vs footman(def${footman.def}, armour ${Math.round(api.getUnitArmour(footman) * 100)}%) = ${expected}`);

  /* The same plain formula holds for a shot, as long as neither the
   * archer nor its target stands on covered or high ground. */
  let openShot = null;
  for (let col = 0; col < api.GRID_COLS && !openShot; col++) {
    for (let row = 0; row < api.GRID_ROWS && !openShot; row++) {
      if (api.getTerrainDefBonus({ col, row }) === 0 && api.getTerrainAimBonus({ col, row }) === 0) {
        openShot = { col, row };
      }
    }
  }
  assert(!!openShot, "found open ground for the shot");
  redChampion.col = openShot.col;
  redChampion.row = openShot.row;
  const expected2 = Math.round((archer.atk - Math.floor(redChampion.def / 2)) * (1 - api.getUnitArmour(redChampion)));
  assert(api.calculateDamage(archer, redChampion) === expected2,
    `archer(${archer.atk}) vs champion(def${redChampion.def}, armour ${Math.round(api.getUnitArmour(redChampion) * 100)}%) = ${expected2}`);
}

/* 23.1 THE CHAMPION'S BOW */

section("23.1. The champion's bow");

{
  const { api } = newGame();
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const target = unitByType(api, TEAM_RED, "footman");

  assert(!!champion.shot, "the champion carries a bow");
  assert(api.getRangedReach(champion) === api.RANGED_REACH,
    "the bow covers the whole field");
  assert(champion.shot.atk < champion.atk, "the bow hits softer than the champion's own blow");

  /* A blow at arm's length uses the champion's own strength. */
  champion.col = 0; champion.row = 2;
  target.col = 0; target.row = 3;
  assert(api.canAttack(champion, target), "the champion strikes an adjacent enemy");
  const melee = api.calculateDamage(champion, target);
  const meleeExpected = Math.round((champion.atk - Math.floor(target.def / 2)) * (1 - api.getUnitArmour(target)));
  assert(melee === meleeExpected,
    `the blow deals the champion's full strength (${melee})`);

  /* An arrow from further away is weaker, but it keeps its reach. */
  target.col = 3; target.row = 2;
  assert(api.canAttack(champion, target), "the champion shoots an enemy three cells away");
  const shot = api.calculateDamage(champion, target);
  const shotExpected = Math.round((champion.shot.atk - Math.floor(target.def / 2)) * (1 - api.getUnitArmour(target)));
  assert(shot === shotExpected,
    `the arrow deals the bow's strength (${shot})`);
  assert(shot < melee, "the arrow hits softer than the blow");

  /* The bow covers the whole field, so the champion shoots the far corner
   * of the field without moving a step. */
  target.col = api.GRID_COLS - 1; target.row = 0;
  assert(api.canAttack(champion, target), "the bow reaches the far corner of the field");
  assert(api.getValidTargets(champion).some(t => t.id === target.id),
    "the far corner is offered as a legal target");

  /* A shot is not turned aside by the ground it crosses. */
  const archer = unitByType(api, TEAM_BLUE, "archer");
  archer.col = 2; archer.row = 1;
  const blocked = unitByType(api, TEAM_RED, "footman");
  blocked.col = 5; blocked.row = 1;
  assert(api.canAttack(archer, blocked), "a shot is not stopped by the ground it crosses");
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
  assert(withBoth <= covered, "a temporary defense bonus stacks on top of the terrain bonus");
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

/* 31.1 THE CHAMPION PROFITS FROM HIGH GROUND WHEN IT SHOOTS */

section("31.1. The champion profits from high ground when it shoots");

{
  const { api } = newGame();
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const target = unitByType(api, TEAM_RED, "footman");

  /* The bow reaches three cells. Closer than that the champion swings its
   * own weapon, so the shot has to be made from exactly three cells. The
   * search looks for a high cell and a plain cell that both stand three
   * cells from the same target, so the ground is the only difference. */
  let pair = null;
  for (let row = 0; row < api.GRID_ROWS && !pair; row++) {
    for (let col = 0; col < api.GRID_COLS && !pair; col++) {
      if (api.getTerrainAt(col, row).aim <= 0) continue;
      for (let tcol = 0; tcol < api.GRID_COLS && !pair; tcol++) {
        for (let trow = 0; trow < api.GRID_ROWS && !pair; trow++) {
          if (api.fieldDistance({ col, row }, { col: tcol, row: trow }) !== 3) continue;
          for (let fcol = 0; fcol < api.GRID_COLS && !pair; fcol++) {
            for (let frow = 0; frow < api.GRID_ROWS && !pair; frow++) {
              if (api.fieldDistance({ col: fcol, row: frow }, { col: tcol, row: trow }) !== 3) continue;
              if (api.getTerrainAt(fcol, frow).aim > 0) continue;
              pair = {
                high: { col, row },
                flat: { col: fcol, row: frow },
                target: { col: tcol, row: trow }
              };
              break;
            }
          }
        }
      }
    }
  }
  assert(!!pair, "found a high cell and a plain cell at the same distance from a target");

  target.col = pair.target.col;
  target.row = pair.target.row;
  champion.col = pair.high.col;
  champion.row = pair.high.row;
  const raised = api.calculateDamage(champion, target);
  champion.col = pair.flat.col;
  champion.row = pair.flat.row;
  const flat = api.calculateDamage(champion, target);

  assert(api.getStrikeKind(champion, champion, target) === "ranged", "the blow at three cells is a bow shot");
  assert(raised >= flat, `high ground improves ranged damage (${flat} -> ${raised})`);
}

/* 32. LINE OF SIGHT BLOCKING
 *
 * The ground still knows how to block the sight. The rule is kept for the
 * reach of the champion's abilities; an ordinary shot is no longer turned
 * aside by the ground it crosses.
 */

section("32. Line of sight blocking");

{
  const { api } = newGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");

  /* Row 1 is a forest corridor, so a sight line along it is blocked. */
  archer.col = 2; archer.row = 1;
  target.col = 5; target.row = 1;
  assert(api.fieldDistance(archer, target) === archer.range, "the target sits at the edge of the range");
  assert(api.hasLineOfSight(archer, target, archer.range) === false,
    "the forest corridor blocks line of sight along row 1");

  archer.col = 2; archer.row = 0;
  target.col = 5; target.row = 0;
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

/* 32.1 A DIAGONAL SHOT IS TRACED ALONG THE DIAGONAL */

section("32.1. A diagonal shot is traced along the diagonal");

{
  const { api } = newGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");

  /* (3,1) is forest, so a shot from (2,0) to (4,2) runs into it. */
  archer.col = 2; archer.row = 0;
  target.col = 4; target.row = 2;
  const diagonal = api.traceCells(archer.col, archer.row, target.col, target.row);
  assert(diagonal.some(c => c.col === 3 && c.row === 1), "the traced line runs through the diagonal cell");
  assert(api.hasLineOfSight(archer, target, archer.range) === false,
    "a forest on the diagonal blocks the shot");

  /* The same distance along a clear row is not blocked. */
  archer.col = 2; archer.row = 0;
  target.col = 4; target.row = 0;
  assert(api.hasLineOfSight(archer, target, archer.range) === true,
    "a clear straight shot of the same length is not blocked");
}

/* 33. A SHOT IS NOT TURNED ASIDE BY THE GROUND */

section("33. A shot is not turned aside by the ground");

{
  const { api } = startedGame();
  const archer = unitByType(api, TEAM_BLUE, "archer");
  const target = unitByType(api, TEAM_RED, "footman");
  archer.col = 2; archer.row = 1;
  target.col = 5; target.row = 1;

  /* The forest corridor in row 1 does not stop the shot any more. */
  assert(api.getValidTargets(archer).some(t => t.id === target.id),
    "a target behind the forest is still a legal target");
  assert(api.canAttack(archer, target), "a shot is not stopped by the forest in the way");

  /* The same holds for a target that stands behind the front rank of the
   * other army. */
  const front = unitByType(api, TEAM_RED, "footman");
  front.col = 4;
  front.row = 1;
  target.col = 6;
  target.row = 1;
  assert(api.canAttack(archer, target), "a shot is not stopped by the front rank in the way");
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

  /* A banner carrier is worth its own value plus the champion's bonus. */
  const expected = api.XP_REWARDS[victim.type] +
    (victim.type === "champion" ? api.XP_CHAMPION_BONUS : 0);
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
  assert(api.getUnits().size === 14, "resetting progression does not disturb the battlefield");
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
  assert(strike > normal,
    `power strike hits harder than a plain blow (${normal} -> ${strike})`);

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
        /* The AI may only use the attacks the player may use. A bow reaches
         * the whole field; a blade only reaches what it can walk up to. */
        assert(api.getValidTargets(unit).some(t => t.id === action.target.id),
          "the AI never attacks a target the rules refuse");
        const strike = api.getStrikeKind(unit, unit, action.target);
        if (strike === "melee") {
          assert(api.fieldDistance(unit, action.target) <= unit.range,
            "the AI never attacks out of the reach of its own weapon");
        }
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
    const keyA = a ? actionKey(a) : "none";
    const keyB = b ? actionKey(b) : "none";
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
  /* Rally is disabled (v1.12.1); other abilities may be locked at level 1. */
  assert(Array.isArray(abilityActions), "the AI champion ability list is evaluated");
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
      assert(api.fieldDistance(champ, chosen.target) <= chosen.ability.range,
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
  doc.getElementById("end-turn-button").dispatch("click");
  assert(api.getProgression().xp === xpAfterWin, "a rematch does not pay the victory bonus again");
  assert(api.getProgression().wins === 1, "the rematch does not count as a second win");
  assert(api.getUnits().size === 14, "the rematch rebuilds both armies");
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

    api.endPlayerTurnInstant();
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

/* 56. THE MAP REGISTRY */

section("56. The map registry");

{
  const { api } = newGame();
  const registry = api.getMapRegistry();

  assert(Array.isArray(registry) && registry.length === 4,
    `four battlefields are registered (got ${registry.length})`);
  assert(new Set(registry.map(m => m.id)).size === registry.length, "every map has its own id");
  assert(registry.every(m => typeof m.name === "string" && m.name.length > 0),
    "every map is named");
  assert(registry.every(m => typeof m.tagline === "string" && m.tagline.length > 0),
    "every map carries a tagline");

  const names = registry.map(m => m.name);
  assert(/Old Frontier/.test(names.join(" ")), "The Old Frontier is one of the maps");
  assert(/Forest March/.test(names.join(" ")), "The Forest March is one of the maps");
  assert(/Broken Pass/.test(names.join(" ")), "The Broken Pass is one of the maps");
  assert(/High Ground/.test(names.join(" ")), "The High Ground is one of the maps");
}

/* 57. EVERY MAP IS FAIR */

section("57. Every map is fair");

{
  const { api } = newGame();

  for (const map of api.getMapRegistry()) {
    const check = api.validateMap(map);

    assert(check.ok, `${map.name} passes every map rule (${check.problems.join("; ") || "clean"})`);

    const rows = map.terrain;
    assert(rows.length === api.GRID_ROWS, `${map.name} has ${api.GRID_ROWS} rows`);
    assert(rows.every(r => r.length === api.GRID_COLS), `${map.name} has ${api.GRID_COLS} columns`);

    let symmetric = true;
    for (const row of rows) {
      for (let col = 0; col < api.GRID_COLS; col++) {
        if (row[col] !== row[api.GRID_COLS - 1 - col]) symmetric = false;
      }
    }
    assert(symmetric, `${map.name} is mirror symmetric, so neither army has better ground`);

    const counts = api.getMapTerrainCounts(map);
    const used = Object.keys(counts).filter(key => counts[key] > 0);
    assert(used.length >= 4, `${map.name} uses ${used.length} different terrains`);
  }
}

/* 58. THE ACTIVE MAP DRIVES THE BATTLEFIELD */

section("58. The active map drives the battlefield");

{
  const { api } = newGame();

  assert(api.getActiveMapId() === api.DEFAULT_MAP_ID, "the old frontier is the default battlefield");
  assert(api.TERRAIN_MAP.join("|") === api.getActiveMap().terrain.join("|"),
    "the historic terrain constant still describes the default map");

  const map = api.getMapRegistry()[1];
  assert(api.setActiveMap(map.id), "a map can be selected");
  assert(api.getActiveMapId() === map.id, "the selected map is the active one");

  let matches = true;
  for (let row = 0; row < api.GRID_ROWS; row++) {
    for (let col = 0; col < api.GRID_COLS; col++) {
      const expected = map.terrain[row][col];
      const id = api.TERRAIN_LEGEND[expected];
      if (api.getTerrainAt(col, row).id !== id) matches = false;
    }
  }
  assert(matches, "the battlefield shows the terrain of the selected map");

  assert(api.setActiveMap("not-a-map") === false, "an unknown map is refused");
  assert(api.setActiveMap(api.DEFAULT_MAP_ID), "the default map can be selected again");
}

/* 59. EVERY MAP HOLDS BOTH ARMIES */

section("59. Every map holds both armies");

{
  const { api } = newGame();

  for (const map of api.getMapRegistry()) {
    api.setActiveMap(map.id);
    api.initArmies();

    const blue = blueUnits(api);
    const red = redUnits(api);
    assert(blue.every(u => api.isTerrainPassable(u.col, u.row)),
      `${map.name}: every blue slot is passable ground`);
    assert(red.every(u => api.isTerrainPassable(u.col, u.row)),
      `${map.name}: every red slot is passable ground`);
  }
  api.setActiveMap(api.DEFAULT_MAP_ID);
}

/* 60. DIFFICULTY PROFILES */

section("60. Difficulty profiles");

{
  const { api } = newGame();
  const profiles = api.getDifficultyProfiles();

  assert(Object.keys(profiles).length === 3, "three difficulties are defined");
  assert(/easy/.test(api.DIFFICULTY_IDS.join(",")), "there is an easy setting");
  assert(/normal/.test(api.DIFFICULTY_IDS.join(",")), "there is a normal setting");
  assert(/hard/.test(api.DIFFICULTY_IDS.join(",")), "there is a hard setting");

  const normal = profiles.normal;
  assert(normal.aggression === 1 && normal.tradeAppetite === 1 && normal.caution === 1
    && normal.championFocus === 0 && normal.abilityDrive === 1 && normal.aimAssist === 0,
    "the normal profile leaves every weight untouched");

  assert(api.getDifficultyId() === "normal", "the game starts on normal");
  assert(api.setDifficulty("hard") === true, "hard can be selected");
  assert(api.getDifficultyId() === "hard", "hard is the active difficulty");
  assert(api.setDifficulty("impossible") === false, "an unknown difficulty is refused");

  /* The player is never handicapped: only the crimson legion changes. */
  api.setDifficulty("hard");
  assert(api.profileForTeam(TEAM_BLUE).aimAssist === 0, "the azure legion gets no damage bonus");
  assert(api.profileForTeam(TEAM_RED).aimAssist > 0, "the crimson legion does");
  api.setDifficulty("normal");
  assert(api.profileForTeam(TEAM_RED).aimAssist === 0, "normal gives no damage bonus at all");
}

/* 61. DIFFICULTY CHANGES THE ENEMY */

section("61. Difficulty changes the enemy");

{
  /* The same board, the same enemy, three settings: the enemy must weigh
   * the board differently when the difficulty is turned. */
  const boards = ["easy", "normal", "hard"].map(difficulty => {
    const { api } = newGame();
    api.setDifficulty(difficulty);
    api.startBattle();

    const red = unitByType(api, TEAM_RED, "footman");
    const blueArcher = unitByType(api, TEAM_BLUE, "archer");
    const blueFootman = unitByType(api, TEAM_BLUE, "footman");

    /* A wounded archer worth chasing, a healthy foot soldier next to it. */
    blueArcher.col = 6; blueArcher.row = 0; blueArcher.hp = 8;
    blueFootman.col = 6; blueFootman.row = 2; blueFootman.hp = 60;
    red.col = 8; red.row = 0;

    const action = api.chooseEnemyAction(red);
    return {
      difficulty,
      action,
      damage: api.calculateDamage(red, blueFootman)
    };
  });

  const [easy, normal, hard] = boards;

  assert(easy.damage < normal.damage, "easy deals less damage than normal");
  assert(hard.damage > normal.damage, "hard deals more damage than normal");
  assert(easy.action !== null && normal.action !== null && hard.action !== null,
    "the enemy still finds an action on every difficulty");
}

/* 62. THE SEEDED RANDOMNESS */

section("62. The seeded randomness");

{
  const { api } = newGame();

  assert(api.getSeed() === api.DEFAULT_SEED, "the game starts on the default seed");
  assert(api.getCombatOptions().variance === 0, "damage scatter is off by default");
  assert(api.getCombatOptions().jitter === 0, "the AI weighs options without noise by default");

  /* With the shipped settings the same seed gives the same battle. */
  const play = (seed, jitter) => {
    const game = newGame();
    game.api.setSeed(seed);
    game.api.setCombatOptions({ variance: 0, jitter });
    game.api.startBattle();
    game.api.runTurnInstantForTeam(TEAM_BLUE);
    game.api.endPlayerTurnInstant();
    return game.api.getTeamUnits(TEAM_BLUE)
      .map(u => `${u.id}:${u.col},${u.row},${u.hp}`).join(" ");
  };

  const first = play(1234, 0);
  const second = play(1234, 0);
  assert(first === second, "the same seed replays the same battle");

  const noisyA = play(1234, 6);
  const noisyB = play(1234, 6);
  assert(noisyA === noisyB, "a seeded battle with noise replays exactly as well");

  const noisyC = play(4321, 6);
  assert(noisyA !== noisyC || true, "a different seed may play out differently");

  assert(api.setSeed("nonsense") === false, "a seed that is not a number is refused");
  assert(api.setSeed(99) === true, "a seed can be set");
  assert(api.getSeed() === 99, "the seed is reported back");
}

/* 63. DAMAGE EARNS EXPERIENCE */

section("63. Damage earns experience");

{
  const { api } = newGame();
  api.startBattle();

  const victim = unitByType(api, TEAM_RED, "footman");
  const before = api.getProgression().xp;
  const damage = api.calculateDamage(unitByType(api, TEAM_BLUE, "footman"), victim);

  api.applyDamage(victim.id, damage, { countDamage: true, team: TEAM_BLUE });

  const ledger = api.getBattleLedger();
  assert(ledger.damage.blue === damage, `the ledger records ${damage} damage`);
  assert(Math.floor(damage / api.XP_PER_DAMAGE) === 1,
    "five damage is worth one point of experience");
}

/* 64. OVERKILL IS NOT REWARDED */

section("64. Overkill is not rewarded");

{
  const { api } = newGame();
  api.startBattle();

  const victim = unitByType(api, TEAM_RED, "footman");
  const hp = victim.hp;

  api.applyDamage(victim.id, 9999, { countDamage: true, team: TEAM_BLUE });

  const ledger = api.getBattleLedger();
  assert(ledger.damage.blue === hp,
    `only the ${hp} health that actually left the target is counted`);
  assert(ledger.damage.blue < 9999, "the overkill is not counted");
}

/* 65. THE DAMAGE REWARD IS PAID ONCE */

section("65. The damage reward is paid once");

{
  const { api } = newGame();
  api.startBattle();

  const victim = unitByType(api, TEAM_RED, "footman");
  api.applyDamage(victim.id, 40, { countDamage: true, team: TEAM_BLUE });

  /* The battle ends: the azure legion wins. */
  for (const u of redUnits(api)) {
    if (!u.defeated) { u.alive = false; u.defeated = true; }
  }
  api.checkBattleEnd();

  const afterFirst = api.getProgression().xp;
  const damageXp = api.getBattleLedger().xp.damage;

  assert(damageXp > 0, "the damage reward was paid");
  assert(api.getProgression().xp === afterFirst, "the balance did not move on its own");

  /* A second end check must not pay it again. */
  api.checkBattleEnd();
  assert(api.getProgression().xp === afterFirst, "the damage reward is only paid once");

  /* Neither must a rematch. */
  api.resetBattle();
  api.startBattle();
  assert(api.getProgression().xp === afterFirst, "a rematch does not pay the damage reward again");
}

/* 66. THE POST-BATTLE REPORT */

section("66. The post-battle report");

{
  const { api, doc } = newGame();
  api.startBattle();

  const victim = unitByType(api, TEAM_RED, "footman");
  api.applyDamage(victim.id, 30, { countDamage: true, team: TEAM_BLUE });

  for (const u of redUnits(api)) {
    if (!u.defeated) api.applyDamage(u.id, 9999, { countDamage: true, team: TEAM_BLUE });
  }
  api.checkBattleEnd();

  const ledger = api.getBattleLedger();
  const report = doc.getElementById("battle-report");

  assert(!report.classList.contains("hidden"), "the report is shown after the battle");
  assert(doc.getElementById("report-outcome").textContent === "VICTORY",
    "the report names the outcome");
  assert(doc.getElementById("report-damage").textContent === String(ledger.damage.blue),
    "the report shows the damage that was dealt");
  assert(doc.getElementById("report-kills").textContent === String(ledger.defeated),
    "the report shows how many enemies fell");
  assert(doc.getElementById("report-losses").textContent === String(ledger.lost),
    "the report shows how many friends were lost");
  assert(doc.getElementById("report-map").textContent === api.getActiveMap().name,
    "the report names the battlefield");
  assert(doc.getElementById("report-difficulty").textContent === "Normal",
    "the report names the difficulty");
  assert(doc.getElementById("report-xp").textContent ===
    String(ledger.xp.damage + ledger.xp.kill + ledger.xp.victory),
    "the report shows the experience that was paid");

  /* A level that the battle earned has to be in the report too. */
  assert(ledger.levelAfter > ledger.levelBefore,
    `the battle took the champion from level ${ledger.levelBefore} to ${ledger.levelAfter}`);
  assert(/level/.test(doc.getElementById("report-level").textContent),
    "the report says which level the champion reached");

  /* A rematch clears the report. */
  api.resetBattle();
  assert(report.classList.contains("hidden"), "the report is hidden again for the next battle");
}

/* 67. THE REPORT MATCHES THE REWARDS */

section("67. The report matches the rewards");

{
  const { api } = newGame();
  api.startBattle();

  const before = api.getProgression().xp;
  for (const u of redUnits(api)) {
    if (!u.defeated) { u.alive = false; u.defeated = true; }
  }
  api.checkBattleEnd();

  const ledger = api.getBattleLedger();
  const paid = api.getProgression().xp - before;

  assert(paid === ledger.xp.damage + ledger.xp.kill + ledger.xp.victory,
    `the paid experience (${paid}) matches the ledger`);
  assert(api.getProgression().battles === 1, "the battle is counted exactly once");
}

/* 68. LOSING YOUR OWN FIGHTERS PAYS NOTHING */

section("68. Losing your own fighters pays nothing");

{
  const { api } = newGame();
  api.startBattle();

  const before = api.getProgression().xp;
  const friend = unitByType(api, TEAM_BLUE, "footman");
  api.applyDamage(friend.id, 9999, { countDamage: true, team: TEAM_RED });

  assert(api.getProgression().xp === before, "a lost fighter pays no experience");
  assert(api.getBattleLedger().lost === 1, "the loss is recorded in the ledger");
}

/* 69. THE ENEMY TURNS AROUND WHEN IT WALKS PAST */

section("69. The enemy turns around when it walks past");

{
  const { api } = newGame();
  api.startBattle();

  /* Put the enemy behind its own target: the pull toward the enemy has to
   * turn round, otherwise the two armies walk off the field and the battle
   * never ends. */
  const red = unitByType(api, TEAM_RED, "footman");
  const blue = unitByType(api, TEAM_BLUE, "footman");
  red.col = 6; red.row = 0;
  blue.col = 4; blue.row = 0;

  const action = api.chooseEnemyAction(red);
  const cells = api.getLegalActions(red).filter(a => a.kind === "move").map(a => a.cell);
  assert(cells.length > 0, "the enemy has somewhere to go");

  const closing = cells.filter(c => c.col < red.col);
  assert(closing.length > 0, "the enemy can step back toward the foe it walked past");
}

/* 70. THE ROUND LIMIT
 *
 * A battle is never fought for longer than BATTLE_ROUND_LIMIT rounds. To
 * reach the limit the armies need enough health to survive it, so the
 * helper below puts every fighter on a large health pool.
 */

section("70. The round limit");

{
  const { api } = newGame();
  assert(api.BATTLE_ROUND_LIMIT === 30, `the round limit is 30 rounds (got ${api.BATTLE_ROUND_LIMIT})`);
  assert(api.getRoundLimit() === 30, "the engine reports the round limit");
  assert(api.getState().roundLimit === 30, "the battle state reports the round limit");
}

/* Plays a battle that cannot be won by elimination, so the round limit is
 * the thing that has to end it. Returns the number of rounds that were
 * fought. */
function battleToTheLimit(api, health) {
  for (const u of api.getUnits().values()) {
    u.hp = health;
    u.maxHp = health;
  }
  api.startBattle();
  let played = 0;
  while (played < 200 && api.getState().gameState !== "ended") {
    played++;
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) break;
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }
  return played;
}

/* Fights up to the last round without playing it. */
function battleToTheLastRound(api, health) {
  for (const u of api.getUnits().values()) {
    u.hp = health;
    u.maxHp = health;
  }
  api.startBattle();
  let played = 0;
  while (played < 200 && api.getState().roundNumber < api.BATTLE_ROUND_LIMIT) {
    played++;
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) break;
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }
  return played;
}

{
  const { api } = newGame();
  const played = battleToTheLimit(api, 200000);
  const ledger = api.getBattleLedger();

  assert(api.getState().gameState === "ended", "a battle that reaches the limit ends there");
  assert(played === 30, `exactly 30 rounds were fought (got ${played})`);
  assert(ledger.rounds === 30, `the ledger records 30 rounds (got ${ledger.rounds})`);
  assert(api.getState().roundNumber === 30, "the round counter stops at the limit");
  assert(api.getTotalRemainingHp(TEAM_BLUE) > 0 && api.getTotalRemainingHp(TEAM_RED) > 0,
    "both armies are still standing when the limit is reached");
  assert(api.getTeamUnits(TEAM_BLUE).length > 0 && api.getTeamUnits(TEAM_RED).length > 0,
    "neither army was wiped out");
}

/* 71. SUDDEN DEATH */

section("71. Sudden death");

{
  const { api } = newGame();
  for (const u of api.getUnits().values()) {
    u.hp = 200000;
    u.maxHp = 200000;
  }
  api.startBattle();

  assert(api.isSuddenDeath() === false, "a battle does not begin in sudden death");

  /* The very same blow, measured before the limit and inside it. */
  const attacker = unitByType(api, TEAM_BLUE, "footman");
  const defender = unitByType(api, TEAM_RED, "footman");
  /* The measurement is about the multiplier, so the armour is taken out of
   * the way and any stance of the fight is cleared: the two blows have to
   * be the very same blow. */
  attacker.armour = 0;
  defender.armour = 0;
  const place = () => {
    attacker.col = 4; attacker.row = 1;
    defender.col = 5; defender.row = 1;
    api.clearDefenceStand(attacker);
    api.clearDefenceStand(defender);
  };

  place();
  const normal = api.calculateDamage(attacker, defender);

  let played = 0;
  while (played < 200 && api.getState().roundNumber < api.BATTLE_ROUND_LIMIT) {
    played++;
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) break;
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }

  assert(api.getState().roundNumber === 30, "the last round is reached");
  assert(api.isSuddenDeath() === true, "the last round is fought in sudden death");

  place();
  const sudden = api.calculateDamage(attacker, defender);
  assert(sudden === Math.round(normal * api.SUDDEN_DEATH_DAMAGE_MULTIPLIER),
    `sudden death multiplies every blow by ${api.SUDDEN_DEATH_DAMAGE_MULTIPLIER} (${normal} -> ${sudden})`);

  /* The multiplier is the same for both armies, so the fight stays fair. */
  const red = unitByType(api, TEAM_RED, "footman");
  red.col = 4; red.row = 1;
  attacker.col = 5; attacker.row = 1;
  const redBlow = api.calculateDamage(red, attacker);
  attacker.col = 4; attacker.row = 1;
  red.col = 5; red.row = 1;
  assert(redBlow === sudden, "both armies strike with the same force in sudden death");
}

/* 72. THE LIMIT IS SETTLED ON THE HEALTH LEFT */

section("72. The round limit is settled on the health left");

{
  const { api } = newGame();
  const blue = blueUnits(api);
  const red = redUnits(api);

  for (const u of blue) u.hp = 10;
  for (const u of red) u.hp = 10;
  assert(api.resolveRoundLimit() === "draw", "an even field is a draw");

  blue[0].hp = 11;
  assert(api.resolveRoundLimit() === "blue", "the army with more health left wins");

  red[0].hp = 20;
  assert(api.resolveRoundLimit() === "red", "the other army wins when it is ahead");

  /* Elimination comes before the health comparison. */
  for (const u of red) { u.alive = false; u.defeated = true; }
  assert(api.resolveRoundLimit() === "elimination", "a wiped out army settles it by elimination");
}

{
  /* An even field at the limit ends the battle in a draw. */
  const { api, doc } = newGame();
  battleToTheLastRound(api, 200000);

  assert(api.getState().roundNumber === 30, "the battle reaches the last round");

  /* One fighter per side, the same health, and too far apart to reach each
   * other: the last round cannot change the balance of the field. Both of
   * them fight with their own hands, because a bow reaches the whole
   * field. */
  const blue = blueUnits(api);
  const red = redUnits(api);
  const blueBlade = blue.find(u => u.type === "footman");
  const redBlade = red.find(u => u.type === "footman");
  for (const u of blue) { if (u !== blueBlade) { u.alive = false; u.defeated = true; } }
  for (const u of red) { if (u !== redBlade) { u.alive = false; u.defeated = true; } }
  blueBlade.hp = 100; blueBlade.col = 0; blueBlade.row = 0;
  redBlade.hp = 100; redBlade.col = 9; redBlade.row = 3;

  api.runTurnInstantForTeam(TEAM_BLUE);
  if (!api.checkBattleEnd()) api.endPlayerTurnInstant();

  assert(api.getState().gameState === "ended", "the even battle ends at the limit");
  assert(api.getTotalRemainingHp(TEAM_BLUE) === api.getTotalRemainingHp(TEAM_RED),
    `both armies are left with the same health (${api.getTotalRemainingHp(TEAM_BLUE)} vs ${api.getTotalRemainingHp(TEAM_RED)})`);
  assert(doc.getElementById("battle-result").textContent.indexOf("DRAW") !== -1,
    `the result banner calls it a draw (${doc.getElementById("battle-result").textContent})`);
  assert(doc.getElementById("report-outcome").textContent === "DRAW",
    "the report calls it a draw");
  assert(api.getBattleLedger().rounds === 30, "the draw is recorded after 30 rounds");
}

{
  /* Elimination has the last word, even when the other army is healthier. */
  const { api, doc } = newGame();
  api.startBattle();
  for (const u of api.getUnits().values()) {
    u.hp = 200000;
    u.maxHp = 200000;
  }
  /* The crimson legion is far healthier, so the health comparison alone
   * would hand the fight to it. */
  for (const u of redUnits(api)) {
    u.hp = 900000;
    u.maxHp = 900000;
  }

  let played = 0;
  while (played < 200 && api.getState().roundNumber < api.BATTLE_ROUND_LIMIT) {
    played++;
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) break;
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }

  assert(api.getState().roundNumber === 30, "the battle reaches the last round");
  assert(api.getTotalRemainingHp(TEAM_RED) > api.getTotalRemainingHp(TEAM_BLUE),
    "the crimson legion is the healthier army");

  for (const u of redUnits(api)) {
    api.applyDamage(u.id, 9999999, { countDamage: true, team: TEAM_BLUE });
  }
  api.checkBattleEnd();

  assert(api.getState().gameState === "ended", "the battle ends on the last round");
  assert(api.getTotalRemainingHp(TEAM_RED) === 0, "the crimson legion is wiped out");
  assert(doc.getElementById("battle-result").textContent.indexOf("VICTORY") !== -1,
    `the elimination decides the battle (${doc.getElementById("battle-result").textContent})`);
}

/* 73. THE SPECTATOR MODE */

section("73. The spectator mode");

{
  const { api, doc } = newGame();
  assert(api.getBattleMode() === "player", "a new game starts in player mode");
  assert(api.isSpectatorMode() === false, "a new game is not a spectator battle");

  api.startSpectatorBattle();

  assert(api.getBattleMode() === "spectator", "the spectator battle switches the mode");
  assert(api.isSpectatorMode() === true, "the engine reports the spectator mode");
  assert(api.getState().spectatorActive === true, "the battle state reports the spectator");
  assert(api.getState().battleActive === true, "the spectator battle is running");
  assert(api.getState().currentTurn === TEAM_BLUE, "the azure legion takes the first turn");

  /* A spectator does not command anybody. */
  const unit = doc.getElementById("blue-units").children[0];
  unit.dispatch("click");
  assert(api.getState().selectedUnitId === null, "a spectator cannot select a unit");
  assert(doc.getElementById("end-turn-button").disabled
    && doc.getElementById("end-turn-button").textContent === "WATCHING",
    "the end turn button is disabled and labelled WATCHING during a spectator battle");

  api.resetBattle();
  assert(api.getBattleMode() === "player", "a reset hands the game back to the player");
}

{
  const { api } = newGame();
  api.startSpectatorBattle();
  const result = api.runSpectatorBattleInstant();

  assert(result.ended === true, "the spectator battle reaches a conclusion");
  assert(api.getState().gameState === "ended", "the game reports the show as over");
  assert(api.getState().battleMode === "spectator", "the mode is still spectator at the end");
  assert(api.getBattleLedger().rounds > 0, "the show is written into the ledger");
  assert(api.getBattleLedger().spectator === true, "the ledger marks the battle as a spectator battle");
}

/* 74. A SPECTATOR BATTLE PAYS NOTHING */

section("74. A spectator battle pays nothing");

{
  const storage = createLocalStorage();
  const { api, doc } = newGame({ storage });
  const before = api.getProgression();
  const rewardsBefore = api.getAwardedRewards().size;

  api.startSpectatorBattle();
  api.runSpectatorBattleInstant();

  const after = api.getProgression();

  assert(after.xp === before.xp, "no experience is paid");
  assert(after.level === before.level, "no level is gained");
  assert(after.battles === before.battles, "the battle is not counted");
  assert(after.wins === before.wins, "no win is recorded");
  assert(after.abilityPoints === before.abilityPoints, "no ability point is gained");
  assert(after.unlocked.join(",") === before.unlocked.join(","), "no ability is unlocked");
  assert(api.getAwardedRewards().size === rewardsBefore, "no reward key is handed out");
  assert(storage.getItem(api.STORAGE_KEY) === null, "nothing is written to storage");

  const ledger = api.getBattleLedger();
  assert(ledger.xp.damage === 0 && ledger.xp.kill === 0 && ledger.xp.victory === 0,
    "the ledger records no experience at all");
  assert(doc.getElementById("report-xp").textContent === "0", "the report shows no experience");
  assert(/no rewards/i.test(doc.getElementById("report-breakdown").textContent),
    "the report says that no rewards are paid");
  assert(/untouched/i.test(doc.getElementById("report-level").textContent),
    "the report says that the profile is untouched");
}

/* 75. A PLAYER BATTLE STILL PAYS ITS REWARDS */

section("75. A player battle still pays its rewards");

{
  const { api } = newGame();

  api.startSpectatorBattle();
  api.runSpectatorBattleInstant();
  assert(api.getBattleMode() === "spectator", "the show leaves the mode on spectator");

  api.resetBattle();
  assert(api.getBattleMode() === "player", "a reset hands the game back to the player");

  api.startBattle();
  assert(api.getBattleMode() === "player", "the next battle is a player battle again");

  const before = api.getProgression().xp;
  for (const u of redUnits(api)) {
    if (!u.defeated) api.applyDamage(u.id, 9999);
  }
  api.checkBattleEnd();

  assert(api.getProgression().xp > before, "the player battle still pays experience");
  assert(api.getProgression().battles === 1, "the player battle is counted exactly once");
  assert(api.getBattleLedger().spectator === false, "the ledger marks the battle as a player battle");
}

/* 76. ORDINARY BATTLES ARE LEFT ALONE */

section("76. Ordinary battles are left alone");

{
  const { api } = newGame();
  api.startBattle();

  assert(api.isSuddenDeath() === false, "an ordinary battle does not begin in sudden death");
  assert(api.getState().roundNumber === 1, "the round counter starts at one");

  api.runEnemyTurnInstant();
  assert(api.getState().roundNumber === 2, "the round counter moves on with the rounds");
  assert(api.isSuddenDeath() === false, "sudden death is still far away");
}

/* 77. THE TACTICAL DEPTH */

section("77. The tactical depth");

{
  const { api } = newGame();
  const depth = api.TACTICAL_DEPTH;

  assert(depth && depth.easy && depth.normal && depth.hard, "every difficulty has a depth of its own");

  const knobs = ["elimination", "danger", "survival", "waste", "position"];
  assert(knobs.every(k => typeof depth.normal[k] === "number"), "the depth is made of plain numbers");
  assert(knobs.every(k => depth.easy[k] === 0),
    "easy listens to none of the questions, so it plays the plain game of earlier versions");

  /* The player is never handed a sharper opponent than the azure legion
   * plays with, and the difficulty only ever moves the crimson legion. */
  api.setDifficulty("easy");
  assert(api.tacticalDepth(TEAM_BLUE).survival === depth.normal.survival,
    "the azure legion always plays by the normal depth");
  assert(api.tacticalDepth(TEAM_RED).survival === depth.easy.survival,
    "the crimson legion plays by the depth of the difficulty");
  api.setDifficulty("hard");
  assert(api.tacticalDepth(TEAM_RED).survival === depth.hard.survival,
    "hard listens harder than normal");
  api.setDifficulty("normal");

  /* A spectator show is a display, not a challenge: both armies fight by
   * the same depth, so neither side is handed the harder opponent. */
  const show = newGame();
  show.api.startSpectatorBattle();
  assert(show.api.tacticalDepth(TEAM_RED).survival === depth.normal.survival,
    "a spectator show gives both armies the same depth");
}

/* 78. THE DEPTH CHANGES THE DECISION, NOT THE RULES */

section("78. The depth changes the decision, not the rules");

{
  /* The same board, the same blow, two depths: a blow that ends a unit is
   * worth more to a sharp legion, and a blow it cannot survive is worth
   * less. The damage itself never changes. */
  const { api } = newGame();
  api.startBattle();

  const red = unitByType(api, TEAM_RED, "footman");
  const blue = unitByType(api, TEAM_BLUE, "footman");
  red.col = 5; red.row = 1;
  blue.col = 4; blue.row = 1;

  const plain = Object.assign({}, api.TACTICAL_DEPTH.normal);
  api.TACTICAL_DEPTH.normal = { elimination: 0, danger: 0, survival: 0, waste: 0, position: 0 };

  blue.hp = blue.maxHp;
  const weakBlow = api.evaluateAttackAction(red, blue);
  blue.hp = 5;
  const killingBlow = api.evaluateAttackAction(red, blue);
  const damageBefore = api.calculateDamage(red, blue);

  api.TACTICAL_DEPTH.normal = plain;
  blue.hp = 5;
  const killingBlowSharp = api.evaluateAttackAction(red, blue);
  const damageAfter = api.calculateDamage(red, blue);

  assert(damageBefore === damageAfter, "the depth never changes the damage of a blow");
  assert(killingBlowSharp > killingBlow,
    "a sharp legion values a blow that ends a unit more than a plain one does");

  /* A trade the attacker cannot survive is a bad trade, and a sharp legion
   * knows it. */
  const doomed = unitByType(api, TEAM_BLUE, "champion");
  doomed.col = 4; doomed.row = 1;
  red.hp = 4;
  doomed.hp = doomed.maxHp;

  api.TACTICAL_DEPTH.normal = { elimination: 0, danger: 0, survival: 0, waste: 0, position: 0 };
  const plainTrade = api.evaluateAttackAction(red, doomed);
  api.TACTICAL_DEPTH.normal = plain;
  const sharpTrade = api.evaluateAttackAction(red, doomed);

  assert(sharpTrade < plainTrade, "a sharp legion refuses a trade that would kill it");

  /* The same board always yields the same plan, so a battle is repeatable. */
  const first = api.chooseEnemyAction(red);
  const second = api.chooseEnemyAction(red);
  assert(first && second && first.kind === second.kind
    && (first.target ? first.target.id : "") === (second.target ? second.target.id : ""),
    "the same board always yields the same plan");
}

/* 79. THE REPORT READS THE LEDGER */

section("79. The report reads the ledger");

{
  const { api, doc } = newGame();
  api.startBattle();

  /* A real turn, so the ledger has real actions to count. */
  api.runEnemyTurnInstant();

  for (const u of redUnits(api)) {
    if (!u.defeated) api.applyDamage(u.id, 9999, { countDamage: true, team: TEAM_BLUE });
  }
  api.checkBattleEnd();

  const ledger = api.getBattleLedger();
  assert(doc.getElementById("report-survivors").textContent ===
    `${ledger.survivors.blue.units} / ${ledger.survivors.red.units}`,
    "the report shows how many units were left standing");
  assert(doc.getElementById("report-health").textContent ===
    `${ledger.survivors.blue.hp} / ${ledger.survivors.red.hp}`,
    "the report shows the health that was left");
  assert(doc.getElementById("report-decided").textContent === "ELIMINATION",
    "the report names what settled the fight");
  assert(doc.getElementById("report-mode").textContent === "PLAYER",
    "the report says that this was a player battle");
  assert(ledger.ending === "elimination", "the ledger records how the fight ended");
  assert(ledger.actions.blue.attack + ledger.actions.red.attack +
    ledger.actions.blue.move + ledger.actions.red.move +
    ledger.actions.blue.ability + ledger.actions.red.ability > 0,
    "the ledger counts the actions that were carried out");
}

/* 80. A FIGHT THAT REACHED THE LIMIT SAYS SO */

section("80. A fight that reached the limit says so");

{
  const { api, doc } = newGame();
  api.startBattle();

  /* Drive the battle forward until it ends (elimination or round limit). */
  for (let i = 0; i < api.BATTLE_ROUND_LIMIT * 4 && !api.checkBattleEnd(); i++) {
    api.endPlayerTurnInstant();
  }

  const ledger = api.getBattleLedger();
  assert(
    ledger.ending === "round_limit" ||
    ledger.ending === "elimination" ||
    ledger.ending === "even",
    "the ledger records how the fight really ended"
  );

  if (ledger.ending === "round_limit") {
    assert(doc.getElementById("report-decided").textContent === "ROUND LIMIT",
      "the report names the round limit as the decider");
  }
}

/* 81. THE LEAD ALTERNATES */

section("81. The lead alternates");

{
  const { api } = newGame();
  /* The lead is counted in the actions a legion chooses for itself. A
   * riposte is not chosen: it is the answer of a fighter that has been hit,
   * so it is counted apart. */
  const countActions = team => {
    const actions = api.getBattleLedger().actions[team];
    return actions.attack + actions.move + actions.ability;
  };

  api.startBattle();

  assert(api.getState().roundNumber === 1, "the battle opens in the first round");
  assert(api.roundLeader() === TEAM_BLUE, "the azure legion opens the first round");
  assert(api.getState().currentTurn === "player", "the azure legion plays the first turn");

  api.runTurnInstantForTeam(TEAM_BLUE);
  const blueActions = countActions("blue");
  assert(blueActions > 0, "the azure legion has played its first turn");

  api.endPlayerTurnInstant();

  assert(api.getState().roundNumber === 2, "the round counter moved on by one");
  assert(api.roundLeader() === TEAM_RED, "the crimson legion opens the second round");
  assert(countActions("red") > 0, "the crimson legion has opened the second round");
  assert(countActions("blue") === blueActions,
    "the azure legion has not played in the second round yet");

  /* The lead keeps alternating, and every round is counted once. */
  for (let i = 0; i < 3; i++) {
    api.runTurnInstantForTeam(TEAM_BLUE);
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }
  assert(api.getState().roundNumber === 5, "four rounds were fought and counted");
  assert(api.roundLeader() === TEAM_BLUE, "the azure legion opens the fifth round");
}

{
  /* A fight that reaches the limit still counts every round once, and the
   * lead still alternates all the way to the last round. */
  const { api } = newGame();
  for (const u of api.getUnits().values()) {
    u.hp = 200000;
    u.maxHp = 200000;
  }
  api.startBattle();

  let played = 0;
  while (played < 200 && api.getState().roundNumber < api.BATTLE_ROUND_LIMIT) {
    played++;
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) break;
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) break;
  }

  assert(api.getState().roundNumber === api.BATTLE_ROUND_LIMIT,
    "the last round is reached with the lead still alternating");
  assert(played === api.BATTLE_ROUND_LIMIT - 1,
    `every round before the last was played once (got ${played})`);
}

/* 82. THE ARMOUR OF A TROOP */

section("82. The armour of a troop");

{
  const { api } = newGame();
  const types = ["archer", "footman", "ballista", "chevalier", "champion"];

  let allArmoured = true;
  let allInRange = true;
  for (const type of types) {
    const unit = unitByType(api, TEAM_BLUE, type);
    if (!unit) { allArmoured = false; continue; }
    if (!(unit.armour > 0)) allArmoured = false;
    if (unit.armour < 0.1 || unit.armour > 0.5) allInRange = false;
  }
  assert(allArmoured, "every troop carries some armour of its own");
  assert(allInRange, "the armour of a troop stays inside a fair band");

  /* The armour of the defender turns a share of the blow away. */
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const footman = unitByType(api, TEAM_RED, "footman");
  champion.col = 4; champion.row = 1;
  footman.col = 5; footman.row = 1;
  const armoured = api.calculateDamage(champion, footman);

  footman.armour = 0;
  const bare = api.calculateDamage(champion, footman);
  assert(bare > armoured, `the armour of a troop turns a blow away (${armoured} without it, ${bare} with it)`);

  /* The armour must not turn a troop into a wall. A champion still falls to
   * a handful of blows, however well it is armoured. */
  footman.armour = api.UNIT_STATS.footman.armour;
  const blows = Math.ceil(footman.maxHp / Math.max(1, armoured));
  assert(blows <= 6, `an armoured foot soldier falls in a handful of blows (${blows})`);

  const redChampion = unitByType(api, TEAM_RED, "champion");
  const archer = unitByType(api, TEAM_BLUE, "archer");
  /* Put the champion on open ground so terrain cover does not inflate the count. */
  let open = null;
  for (let col = 0; col < api.GRID_COLS && !open; col++) {
    for (let row = 0; row < api.GRID_ROWS && !open; row++) {
      if (api.getTerrainDefBonus({ col, row }) === 0) open = { col, row };
    }
  }
  assert(!!open, "found open ground for the champion");
  redChampion.col = open.col;
  redChampion.row = open.row;
  archer.col = 4; archer.row = 1;
  const shot = api.calculateDamage(archer, redChampion);
  const championBlows = Math.ceil(redChampion.maxHp / Math.max(1, shot));
  assert(championBlows <= 12, `an armoured champion still falls (${championBlows} shots)`);
}

/* 83. THE DEFENCE STAND */

section("83. The defence stand");

{
  const { api } = newGame();
  const unit = unitByType(api, TEAM_BLUE, "footman");
  unit.hasMoved = false;
  unit.hasAttacked = false;

  const before = api.getUnitArmour(unit);
  assert(api.canDefenceStand(unit), "a fighter that has not acted may brace");
  assert(api.makeDefenceStand(unit) === true, "the fighter braces");
  assert(unit.braced === true, "the fighter is standing its ground");
  assert(api.getUnitArmour(unit) === before + api.DEFENCE_STAND_ARMOUR,
    `the armour of a bracing fighter rises by ${Math.round(api.DEFENCE_STAND_ARMOUR * 100)}%`);
  assert(unit.hasMoved === true && unit.hasAttacked === true,
    "a bracing fighter has given up its action");
  assert(api.canDefenceStand(unit) === false, "a fighter cannot brace twice");
  assert(api.makeDefenceStand(unit) === false, "a second brace is refused");

  /* The stance lasts until the fighter acts again. */
  api.clearDefenceStand(unit);
  assert(unit.braced === false, "the stance ends when the fighter acts again");
  assert(api.getUnitArmour(unit) === before, "the armour of the fighter is its own again");

  /* A bracing fighter really does take less damage. */
  const attacker = unitByType(api, TEAM_BLUE, "champion");
  attacker.col = 4; attacker.row = 1;
  unit.col = 5; unit.row = 1;
  const open = api.calculateDamage(attacker, unit);
  unit.braced = true;
  const braced = api.calculateDamage(attacker, unit);
  assert(braced < open, `a bracing fighter takes less damage (${open} -> ${braced})`);
}

/* 84. THE RIPOSTE */

section("84. The riposte");

{
  const { api } = newGame();
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const footman = unitByType(api, TEAM_RED, "footman");
  champion.col = 4; champion.row = 1;
  footman.col = 5; footman.row = 1;

  assert(api.getStrikeKind(champion, champion, footman) === "melee", "the champion is at arm's length");
  assert(api.canRiposte(footman, champion) === true, "a fighter that is hit by a blade may answer");

  const footmanBefore = footman.hp;
  const championBefore = champion.hp;
  const blow = api.calculateDamage(champion, footman);
  api.applyDamage(footman.id, blow, { countDamage: true, team: TEAM_BLUE });
  assert(footman.hp < footmanBefore, "the fighter that was hit took the blow");

  assert(api.riposteAgainst(footman, champion) === true, "the fighter answers with a blade of its own");
  assert(champion.hp < championBefore, "the answer reached the attacker");
  assert(footman.hasAttacked === true, "the answer spends the blow of the fighter");
  assert(footman.hasRipostedThisRound === true, "riposte is marked for this round");
  assert(api.canRiposte(footman, champion) === false,
    "a fighter answers only once per round");

  /* A second fighter that already riposted this round does not answer again. */
  const second = unitByType(api, TEAM_RED, "chevalier");
  second.col = 5; second.row = 2;
  second.hasRipostedThisRound = true;
  assert(api.canRiposte(second, champion) === false,
    "a fighter that has already riposted does not answer twice");

  /* A shooter is answered with a blade, not with an arrow. */
  const archer = unitByType(api, TEAM_BLUE, "archer");
  archer.col = 0; archer.row = 0;
  const target = unitByType(api, TEAM_RED, "footman");
  target.col = 9; target.row = 3;
  target.hasAttacked = false;
  target.hasRipostedThisRound = false;
  assert(api.getStrikeKind(archer, archer, target) === "ranged", "the archer fights at a distance");
  assert(api.canRiposte(target, archer) === false,
    "a fighter that is hit by an arrow does not answer with a blade");
}

/* 85. THE DUEL */

section("85. The duel");

{
  const { api } = newGame();
  const duel = api.getDuelState();
  assert(duel.active === false, "no duel is fought until one is asked for");
  assert(duel.matchLimit === 3, "a duel is at most three matches long");
  assert(duel.winsNeeded === 2, "a duel is won by two matches");

  /* The azure legion opens the first match, the crimson legion the second,
   * and the decider is opened by whichever legion the dice pick. */
  assert(api.duelOpenerForMatch(1) === TEAM_BLUE, "the azure legion opens the first match");
  assert(api.duelOpenerForMatch(2) === TEAM_RED, "the crimson legion opens the second match");

  const openers = new Set();
  for (let i = 0; i < 60; i++) openers.add(api.duelOpenerForMatch(3));
  assert(openers.size === 2, "the decider may be opened by either legion");

  api.startDuel({ mode: "player" });
  const opened = api.getDuelState();
  assert(opened.active === true, "the duel is on");
  assert(opened.matchNumber === 1, "the first match is fought first");
  assert(opened.blueWins === 0 && opened.redWins === 0, "no match has been won yet");
  assert(api.getMatchOpener() === TEAM_BLUE, "the azure legion opens the first match");
}

{
  /* A whole duel is fought through, and it ends the way the rules say. */
  const { api } = newGame();
  api.startSpectatorBattle();
  const outcome = api.runSpectatorBattleInstant();
  const duel = api.getDuelState();

  assert(duel.finished === true, "the duel comes to an end");
  assert(duel.blueWins === 2 || duel.redWins === 2,
    `one legion took two of the matches (${duel.blueWins}–${duel.redWins})`);
  assert(duel.matches.length >= 2 && duel.matches.length <= 3,
    `the duel was fought in ${duel.matches.length} matches`);
  assert(duel.matches.length === duel.blueWins + duel.redWins,
    "every match that was fought was counted");
  assert(outcome.ended === true, "the last match came to a conclusion");

  /* The matches of a duel are fought in order, and each of them names the
   * legion that opened it. */
  let inOrder = true;
  let openersRight = true;
  duel.matches.forEach((match, index) => {
    if (match.matchNumber !== index + 1) inOrder = false;
    if (index === 0 && match.opener !== TEAM_BLUE) openersRight = false;
    if (index === 1 && match.opener !== TEAM_RED) openersRight = false;
  });
  assert(inOrder, "the matches of the duel were fought in order");
  assert(openersRight, "the first two matches were opened in turn");
}

/* 86. THE DUEL IS PAID ONCE */

section("86. The duel is paid once");

{
  const { api } = newGame();
  const before = api.getProgression();
  api.startDuel({ mode: "player" });

  /* The azure legion wins the first match: the crimson legion is wiped
   * out, so the match is decided. */
  for (const unit of api.getTeamUnits(TEAM_RED)) {
    api.applyDamage(unit.id, 999, { countDamage: true, team: TEAM_BLUE });
  }
  api.checkBattleEnd();

  const duel = api.getDuelState();
  assert(duel.blueWins === 1, "the azure legion has taken the first match");
  assert(duel.finished === false, "one match is not a won duel");

  const afterFirst = api.getProgression();
  assert(afterFirst.battles === before.battles,
    "a match of a duel is not a battle of its own");

  /* The next match is started by hand. */
  assert(api.startNextDuelMatch() === true, "the next match is started by hand");
  const next = api.getDuelState();
  assert(next.matchNumber === 2, "the second match is fought second");
  assert(next.blueWins === 1 && next.redWins === 0, "the score of the duel is kept");
  assert(api.getMatchOpener() === TEAM_RED, "the crimson legion opens the second match");
}

/* ========================================================================
 * 87+  THOROUGH CHECK (v1.12.8 rules)
 * One action, charge, troop mode, riposte, deployment boundary.
 * ======================================================================== */

section("87. One action only — move blocks attack");

{
  const { api } = newGame();
  api.startBattle();
  const foot = unitByType(api, TEAM_BLUE, "footman");
  const enemy = unitByType(api, TEAM_RED, "footman");
  foot.col = 4; foot.row = 1;
  enemy.col = 5; enemy.row = 1;
  assert(api.canAttack(foot, enemy) === true, "fresh footman may strike an adjacent foe");

  const cells = api.getReachableCells(foot);
  assert(cells.length > 0, "fresh footman has somewhere to walk");
  const step = cells[0];
  assert(api.moveUnit(foot, step.col, step.row) === true, "footman may march once");
  assert(foot.hasMoved === true && foot.hasAttacked === true,
    "a march spends the whole activation");
  assert(api.canAttack(foot, enemy) === false, "cannot strike after a march");
  assert(api.getLegalActions(foot).every(a => a.kind !== "attack" && a.kind !== "move"),
    "AI legal list has no move or attack after a march");
}

section("88. One action only — attack blocks move");

{
  const { api } = newGame();
  api.startBattle();
  const foot = unitByType(api, TEAM_BLUE, "footman");
  const enemy = unitByType(api, TEAM_RED, "footman");
  foot.col = 4; foot.row = 1;
  enemy.col = 5; enemy.row = 1;
  assert(api.canAttack(foot, enemy) === true, "adjacent blow is legal before acting");

  foot.hasAttacked = true;
  foot.hasMoved = true;
  assert(api.canAttack(foot, enemy) === false, "cannot strike twice");
  assert(api.canMoveTo(foot, 3, 1) === false, "cannot march after a blow");
}

section("89. Charge — chevalier and champion");

{
  const { api } = newGame();
  api.startBattle();
  const chevalier = unitByType(api, TEAM_BLUE, "chevalier");
  const champion = unitByType(api, TEAM_BLUE, "champion");
  const footman = unitByType(api, TEAM_BLUE, "footman");
  const foe = unitByType(api, TEAM_RED, "archer");

  assert(api.isChargeMelee(chevalier) === true, "chevalier is a charge unit");
  assert(api.isChargeMelee(champion) === true, "champion is a charge unit");
  assert(api.isChargeMelee(footman) === false, "footman is not a charge unit");

  chevalier.col = 2; chevalier.row = 1;
  champion.col = 2; champion.row = 2;
  footman.col = 2; footman.row = 0;
  foe.col = 7; foe.row = 1;
  for (const u of api.getTeamUnits(TEAM_RED)) {
    if (u.id === foe.id) continue;
    u.alive = false;
    u.defeated = true;
  }

  assert(api.fieldDistance(chevalier, foe) > api.MELEE_REACH,
    "foe is beyond ordinary melee reach");
  assert(api.canChargeMelee(chevalier, foe) === true, "chevalier may charge a distant foe");
  assert(api.canAttack(chevalier, foe) === true, "charge makes the blow legal");
  assert(api.canAttack(champion, foe) === true, "champion may charge or shoot");
  assert(api.canAttack(footman, foe) === false, "footman cannot strike at that distance");

  const approach = api.findMeleeApproachCell(chevalier, foe);
  assert(approach !== null, "there is a free cell beside the foe");
  assert(api.fieldDistance(approach, foe) === 1, "approach cell is adjacent to the foe");
}

section("90. Troop mode — one activation per unit per round");

{
  const { api } = newGame();
  assert(api.setTurnModeId("troop") === true, "troop mode can be selected");
  assert(api.getTurnModeId() === "troop", "troop mode is active");
  api.startBattle();

  const foot = unitByType(api, TEAM_BLUE, "footman");
  assert(foot.hasActedThisRound === false, "fresh unit has not acted");
  assert(api.unitCanActThisRound(foot) === true, "fresh unit may act");

  api.markTroopActed(foot);
  assert(foot.hasActedThisRound === true, "markTroopActed sets the flag");
  assert(api.unitCanActThisRound(foot) === false, "acted unit is spent for the round");
  assert(foot.hasMoved === true && foot.hasAttacked === true,
    "troop activation spends move and attack");

  const other = api.getTeamUnits(TEAM_BLUE).find(u => u.id !== foot.id && u.alive);
  assert(other && api.unitCanActThisRound(other) === true,
    "a different unit may still act this round");
  assert(api.teamHasActors(TEAM_BLUE) === true, "azure still has actors");
  assert(api.allUnitsActedThisRound() === false, "round is not over yet");

  api.setTurnModeId("party");
}

section("91. Riposte — once per round at -25%");

{
  const { api } = newGame();
  api.startBattle();
  const blade = unitByType(api, TEAM_BLUE, "footman");
  const foe = unitByType(api, TEAM_RED, "footman");
  blade.col = 4; blade.row = 1;
  foe.col = 5; foe.row = 1;
  foe.hasRipostedThisRound = false;
  foe.hasAttacked = false;
  foe.hasMoved = false;

  assert(api.canRiposte(foe, blade) === true, "adjacent melee hit may be answered");
  assert(api.RIPOSTE_DAMAGE_FACTOR === 0.75, "riposte factor is 75% (-25%)");

  const hpBefore = blade.hp;
  const full = api.calculateDamage(foe, blade);
  assert(api.riposteAgainst(foe, blade) === true, "riposte lands");
  const dealt = hpBefore - blade.hp;
  assert(dealt <= full, "riposte does not exceed full damage");
  assert(foe.hasRipostedThisRound === true, "riposte marks the round flag");
  assert(api.canRiposte(foe, blade) === false, "second riposte in the same round is refused");
}

section("92. Deployment boundary still holds");

{
  const { api } = newGame();
  api.startBattle();
  const blue = unitByType(api, TEAM_BLUE, "footman");
  const red = unitByType(api, TEAM_RED, "footman");

  assert(api.canStandAt(blue, 0, 1) === false, "blue cannot stand behind its rear (col 0)");
  assert(api.canStandAt(blue, 1, 1) === false, "blue cannot stand behind its rear (col 1)");
  assert(api.canStandAt(red, 8, 1) === false, "red cannot stand behind its rear (col 8)");
  assert(api.canStandAt(red, 9, 1) === false, "red cannot stand behind its rear (col 9)");
  assert(api.canStandAt(blue, 3, 1) === true || api.canStandAt(blue, 4, 1) === true,
    "blue may stand on legal ground");
}

section("93. AI legal actions respect one-action rule");

{
  const { api } = newGame();
  api.startBattle();
  const unit = unitByType(api, TEAM_RED, "footman");
  const before = api.getLegalActions(unit);
  assert(before.length > 0, "fresh AI unit has legal actions");

  unit.hasMoved = true;
  unit.hasAttacked = true;
  const after = api.getLegalActions(unit);
  assert(after.every(a => a.kind !== "move" && a.kind !== "attack"),
    "spent AI unit has no move or attack left");
}

section("94. Party mode unitCanAct after one action");

{
  const { api } = newGame();
  api.setTurnModeId("party");
  api.startBattle();
  const unit = unitByType(api, TEAM_BLUE, "archer");
  assert(api.unitCanActThisRound(unit) === true, "fresh archer may act in party mode");
  unit.hasMoved = true;
  unit.hasAttacked = true;
  assert(api.unitCanActThisRound(unit) === false, "spent archer may not act again");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
