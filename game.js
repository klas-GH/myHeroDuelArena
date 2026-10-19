/* ==========================================================================
   myHeroDuelArena v1.3.0 — CHOOSE THE GROUND, SET THE DIFFICULTY, EARN THE XP
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
     * One distance rule. Movement, reach, weapon range and ability radii all
       measure the octagonal way: the longest axis decides, so a diagonal
       step costs the same as a straight one.
     * Permanent progression (champion level) is separate from battle state.
     * Every state change goes through one validation function.
     * The default game stays deterministic. Randomness only exists when a
       seed is used, and the seed only matters to the balance harness.
   ========================================================================== */

"use strict";

/* 1. APP CONFIG & CONSTANTS */

const APP_NAME = "myHeroDuelArena";
const APP_VERSION = "v1.3.0";

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

/* 1.3 UNIT TYPE STATS
 * Ranges are measured the octagonal way (see section 14), so a range of 3
 * covers a 7x7 block around the unit. The ranged numbers are set so the
 * area they sweep stays close to what it was on the old orthogonal grid.
 *
 * `shot` is a second reach for a unit that carries a bow. The champion
 * fights with its own weapon at close range and can loose an arrow at a
 * longer distance, but the arrow carries less force than a blow.
 */
const UNIT_STATS = {
  archer:   { hp: 40, atk: 14, def: 4,  move: 2, range: 3, special: null },
  footman:  { hp: 60, atk: 12, def: 6,  move: 1, range: 1, special: null },
  ballista: { hp: 45, atk: 18, def: 3,  move: 1, range: 4, special: null },
  chevalier:{ hp: 55, atk: 16, def: 5,  move: 3, range: 1, special: null },
  champion: { hp: 90, atk: 20, def: 8,  move: 2, range: 1, special: "rally",
              shot: { atk: 16, range: 3 } }
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
 * on screen). The default map is fixed so every battle starts identically
 * and neither army is given better ground than the other.
 *
 *   G = grass   F = forest   R = rock   H = high ground   B = boulder
 *
 * The layout is mirror symmetric (col <-> 9 - col):
 *   row 0  BFGGHHGGFB   row 1  GGFFFFFFGG
 *   row 2  GRGGHHGGRG   row 3  GGFGGGGFGG
 *
 * The live battlefield is whichever map is active; see the map registry in
 * section 2.2. TERRAIN_MAP always holds the default map.
 */
const TERRAIN_LEGEND = {
  G: "grass", F: "forest", R: "rock", H: "highground", B: "boulder"
};

/* 2.2 MAP REGISTRY
 *
 * Four handcrafted battlefields. Every map obeys the same three rules, so
 * the choice is always about tactics and never about who gets the better
 * ground:
 *
 *   1. MIRROR SYMMETRY. Every row reads the same from left to right and
 *      from right to left (column c equals column 9 - c). Both armies
 *      therefore start on identical terrain and meet on identical terrain.
 *   2. VALID GROUND. Every deployment slot of both armies sits on passable
 *      ground, so no map can ever start a battle with a unit stuck.
 *   3. AT LEAST FOUR TERRAIN TYPES, so each map asks for a different plan
 *      rather than repeating one texture.
 *
 *   G = grass   F = forest   R = rock   H = high ground   B = boulder
 */
const MAP_REGISTRY = [
  {
    id: "old_frontier",
    name: "The Old Frontier",
    tagline: "Open ground and two rocky rises. The even battlefield.",
    terrain: [
      "BFGGHHGGFB",
      "GGFFFFFFGG",
      "GRGGHHGGRG",
      "GGFGGGGFGG"
    ]
  },
  {
    id: "forest_march",
    name: "The Forest March",
    tagline: "Deep wood on both flanks. Cover for whoever holds it.",
    terrain: [
      "BFGFFFFGFB",
      "GFFHHHHFFG",
      "GFRHHHHRFG",
      "GFGFFFFGFG"
    ]
  },
  {
    id: "broken_pass",
    name: "The Broken Pass",
    tagline: "A fallen wall splits the field. Only the ridges lead through.",
    terrain: [
      "GGGRGGRGGG",
      "GGGBBBBGGG",
      "GGRHHHHRGG",
      "GGGRGGRGGG"
    ]
  },
  {
    id: "high_ground",
    name: "The High Ground",
    tagline: "A raised plateau in the centre. Whoever holds it shoots free.",
    terrain: [
      "GFFRBBRFFG",
      "GGHHHHHHGG",
      "GGHHHHHHGG",
      "GFFRBBRFFG"
    ]
  }
];

const DEFAULT_MAP_ID = "old_frontier";

/* The terrain of the default map. Kept as its own copy so the historic
 * constant keeps working even if a map is edited later. */
const TERRAIN_MAP = MAP_REGISTRY[0].terrain.map(row => row);

const MAP_IDS = MAP_REGISTRY.map(map => map.id);

function getMapRegistry() {
  return MAP_REGISTRY;
}

function getMapById(id) {
  return MAP_REGISTRY.find(map => map.id === id) || null;
}

function getActiveMap() {
  return getMapById(activeMapId) || MAP_REGISTRY[0];
}

function getActiveMapId() {
  return getActiveMap().id;
}

/* Switching a map is only allowed between battles, so a running battle can
 * never find the ground changing under its feet. */
function setActiveMap(id) {
  const map = getMapById(id);
  if (!map) return false;
  activeMapId = map.id;
  return true;
}

/* How many cells of every terrain type a map uses. The previews and the
 * balance harness both need this. */
function getMapTerrainCounts(map) {
  const counts = { grass: 0, forest: 0, rock: 0, highground: 0, boulder: 0 };
  const source = typeof map === "string" ? (getMapById(map) || getActiveMap()) : (map || getActiveMap());
  for (const row of source.terrain) {
    for (const ch of row) {
      const type = TERRAIN_LEGEND[ch];
      if (type && Object.prototype.hasOwnProperty.call(counts, type)) counts[type]++;
    }
  }
  return counts;
}

/* The cells a unit with a single movement point can stand on. */
function walkableCells(map) {
  const cells = new Set();
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const type = TERRAIN_LEGEND[(map.terrain[row] || "")[col]];
      if (type && TERRAIN_TYPES[type].passable && TERRAIN_TYPES[type].cost <= 1) {
        cells.add(`${col},${row}`);
      }
    }
  }
  return cells;
}

/* True when a unit with one movement point can walk from the azure lines to
 * the crimson lines. A map that walls a whole unit type out of the battle
 * is broken, however good it looks.
 *
 * The walk follows the same rules the engine uses: the octagonal step, and a
 * diagonal step that is refused only when both of its side cells are walled
 * in. */
function mapConnectsArmies(map) {
  const source = typeof map === "string" ? getMapById(map) : map;
  if (!source) return false;

  const walkable = walkableCells(source);
  const passable = new Set();
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const type = TERRAIN_LEGEND[(source.terrain[row] || "")[col]];
      if (type && TERRAIN_TYPES[type].passable) passable.add(`${col},${row}`);
    }
  }

  const reached = new Set();
  const queue = [];

  for (const slot of BLUE_FORMATION) {
    const key = `${slot.col},${slot.row}`;
    if (reached.has(key)) continue;
    reached.add(key);
    queue.push({ col: slot.col, row: slot.row });
  }

  while (queue.length) {
    const cell = queue.shift();
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cell.col + dc;
        const nr = cell.row + dr;
        const key = `${nc},${nr}`;
        if (!walkable.has(key) || reached.has(key)) continue;
        if (dc !== 0 && dr !== 0) {
          /* A diagonal step needs at least one open side. */
          const sideA = passable.has(`${cell.col + dc},${cell.row}`);
          const sideB = passable.has(`${cell.col},${cell.row + dr}`);
          if (!sideA && !sideB) continue;
        }
        reached.add(key);
        queue.push({ col: nc, row: nr });
      }
    }
  }

  /* A crimson fighter has to be able to be reached, so every crimson slot
   * needs a neighbouring cell the azure side can stand on. */
  return RED_FORMATION.every(slot => {
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        if (reached.has(`${slot.col + dc},${slot.row + dr}`)) return true;
      }
    }
    return false;
  });
}

/* True when a map is mirror symmetric and every deployment slot is on
 * passable ground. The suites check this for every registered map. */
function validateMap(map) {
  const problems = [];
  const source = typeof map === "string" ? getMapById(map) : map;
  if (!source) return { ok: false, problems: ["unknown map"] };
  if (!Array.isArray(source.terrain) || source.terrain.length !== GRID_ROWS) {
    problems.push("a map needs exactly four rows");
    return { ok: false, problems };
  }
  source.terrain.forEach((row, index) => {
    if (typeof row !== "string" || row.length !== GRID_COLS) {
      problems.push(`row ${index} needs exactly ${GRID_COLS} cells`);
      return;
    }
    for (const ch of row) {
      if (!TERRAIN_LEGEND[ch]) problems.push(`row ${index} uses an unknown terrain code "${ch}"`);
    }
    for (let col = 0; col < GRID_COLS; col++) {
      if (row[col] !== row[GRID_COLS - 1 - col]) {
        problems.push(`row ${index} is not mirror symmetric`);
        break;
      }
    }
  });
  for (const slot of BLUE_FORMATION) {
    const type = TERRAIN_LEGEND[(source.terrain[slot.row] || "")[slot.col]];
    if (!type || !TERRAIN_TYPES[type].passable) {
      problems.push(`blue slot (${slot.col},${slot.row}) is not passable`);
    }
  }
  for (const slot of RED_FORMATION) {
    const type = TERRAIN_LEGEND[(source.terrain[slot.row] || "")[slot.col]];
    if (!type || !TERRAIN_TYPES[type].passable) {
      problems.push(`red slot (${slot.col},${slot.row}) is not passable`);
    }
  }
  if (!mapConnectsArmies(source)) {
    problems.push("a one-move fighter cannot reach the crimson lines");
  }
  const counts = getMapTerrainCounts(source);
  const used = Object.keys(counts).filter(key => counts[key] > 0);
  if (used.length < 4) problems.push(`only ${used.length} terrain types are used`);
  return { ok: problems.length === 0, problems, counts };
}

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
    description: "Adjacent allies gain +3 ATK and +2 DEF for one round. Costs only the ability.",
    type: "support",
    radius: 1,
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
    description: "The champion and adjacent allies gain +3 DEF for two rounds. Uses the whole turn.",
    type: "defensive",
    radius: 1,
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

/* Experience for the work itself: one point for every five points of damage
 * the legion actually lands. Damage that overshoots a wounded target is
 * never rewarded, because the target was already dead before the extra
 * landed. */
const XP_PER_DAMAGE = 5;

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
  championAllyProximity: 5,  /* score per ally the champion can rally    */
  championAllyRadius: 1,     /* how close the champion keeps its ranks    */
  minActionScore: 2         /* an action must be worth this much to run*/
};

/* AI turn pacing. Short enough that a full turn does not feel like a wait,
 * long enough that each action is readable. */
const AI_TIMING = {
  attack: 320,
  move: 380,
  ability: 300,
  gap: 200
};

/* 5.1 DIFFICULTY PROFILES
 *
 * The difficulty setting never touches the rules. Damage, movement, terrain
 * and abilities stay exactly the same for every setting, so a battle on Hard
 * is still the same battle, only fought by a sharper opponent.
 *
 * Every knob is a multiplier on an existing AI weight. The Normal profile
 * leaves every multiplier at one and adds nothing, which keeps the default
 * behaviour byte for byte identical to earlier versions.
 *
 *   aggression   — how eagerly the enemy closes the distance
 *   tradeAppetite— how much the enemy values dealing damage against risk
 *   caution      — how much the enemy fears trading blows
 *   championFocus— extra interest in the player's champion
 *   abilityDrive— how readily the enemy spends its champion abilities
 *   aimAssist    — flat damage the enemy adds to every blow
 */
const DIFFICULTY_PROFILES = {
  easy: {
    id: "easy",
    label: "Easy",
    hint: "The crimson legion hesitates, under-reads the field and rarely presses home.",
    aggression: 0.65,
    tradeAppetite: 0.8,
    caution: 1.35,
    championFocus: 0,
    abilityDrive: 0.5,
    aimAssist: -2
  },
  normal: {
    id: "normal",
    label: "Normal",
    hint: "The crimson legion fights the way it always has.",
    aggression: 1,
    tradeAppetite: 1,
    caution: 1,
    championFocus: 0,
    abilityDrive: 1,
    aimAssist: 0
  },
  hard: {
    id: "hard",
    label: "Hard",
    hint: "The crimson legion reads the field, hunts your champion and presses hard.",
    aggression: 1.3,
    tradeAppetite: 1.25,
    caution: 0.75,
    championFocus: 14,
    abilityDrive: 1.6,
    aimAssist: 2
  }
};

const DIFFICULTY_IDS = Object.keys(DIFFICULTY_PROFILES);
const DEFAULT_DIFFICULTY_ID = "normal";

let currentDifficultyId = DEFAULT_DIFFICULTY_ID;

function getDifficultyProfiles() {
  return DIFFICULTY_PROFILES;
}

function getDifficultyId() {
  return currentDifficultyId;
}

function setDifficulty(id) {
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTY_PROFILES, id)) return false;
  currentDifficultyId = id;
  return true;
}

/* The player is never handicapped by the difficulty setting: only the
 * crimson legion changes. The blue side always plays by the normal rules,
 * which also makes it a stable reference opponent for the balance harness. */
function profileForTeam(team) {
  if (team !== TEAM_RED) return DIFFICULTY_PROFILES.normal;
  return DIFFICULTY_PROFILES[currentDifficultyId] || DIFFICULTY_PROFILES.normal;
}

/* 5.2 SEEDED RANDOMNESS
 *
 * The shipped game is fully deterministic: with the default settings the
 * same battle always plays out the same way. The balance harness needs a
 * different kind of control, so the engine also carries a seed and two
 * optional knobs that are off by default:
 *
 *   variance — how far a blow can scatter around its expected damage
 *   jitter   — how much noise the AI adds to every option it weighs
 *
 * The seed only matters when one of those knobs is turned up, which keeps
 * the ordinary game untouched.
 */
const DEFAULT_SEED = 20260119;

let randomSeed = DEFAULT_SEED;
let randomState = DEFAULT_SEED;
let combatVariance = 0;
let aiJitter = 0;

function clampFloat(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function setSeed(seed) {
  const value = Math.floor(Number(seed));
  if (!Number.isFinite(value)) return false;
  randomSeed = value >>> 0;
  randomState = randomSeed;
  return true;
}

function getSeed() {
  return randomSeed;
}

/* mulberry32: small, fast and identical in every engine, so a seed always
 * reproduces the same run. */
function nextRandom() {
  randomState = (randomState + 0x6D2B79F5) >>> 0;
  let t = randomState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function setCombatOptions(options) {
  const opts = options || {};
  combatVariance = clampFloat(opts.variance, 0, 0.5, combatVariance);
  aiJitter = clampFloat(opts.jitter, 0, 50, aiJitter);
  return { variance: combatVariance, jitter: aiJitter };
}

function getCombatOptions() {
  return { variance: combatVariance, jitter: aiJitter };
}

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

/* Pre-battle selector: difficulty buttons and one card per battlefield. */
const $setupPanel = document.getElementById("setup-panel");
const $setupToggle = document.getElementById("setup-toggle");
const $difficultyRow = document.getElementById("difficulty-row");
const $difficultyHint = document.getElementById("difficulty-hint");
const $mapRow = document.getElementById("map-row");

/* Post-battle report. */
const $battleReport = document.getElementById("battle-report");
const $reportOutcome = document.getElementById("report-outcome");
const $reportMap = document.getElementById("report-map");
const $reportDifficulty = document.getElementById("report-difficulty");
const $reportRounds = document.getElementById("report-rounds");
const $reportDamage = document.getElementById("report-damage");
const $reportTaken = document.getElementById("report-taken");
const $reportKills = document.getElementById("report-kills");
const $reportLosses = document.getElementById("report-losses");
const $reportXp = document.getElementById("report-xp");
const $reportBreakdown = document.getElementById("report-breakdown");
const $reportLevel = document.getElementById("report-level");

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

/* The team the tactical AI is driving right now. It is only set while an AI
 * turn is running, so the phase check still refuses abilities outside it. */
let aiTurnTeam = null;

/* True when the running AI turn owns the round bookkeeping. The enemy turn
 * does; the harness turn for the reference opponent does not, because the
 * round is closed by the enemy turn that follows it. */
let aiTurnOwnsRound = false;

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

/* The battlefield the next battle is fought on. */
let activeMapId = DEFAULT_MAP_ID;

/* The ledger of the running battle. Everything the post-battle report shows
 * is written down here while the fight happens, so the report can never
 * disagree with the rewards that were actually paid. */
let battleLedger = createBattleLedger();

function createBattleLedger() {
  return {
    mapId: DEFAULT_MAP_ID,
    difficultyId: DEFAULT_DIFFICULTY_ID,
    seed: DEFAULT_SEED,
    rounds: 0,
    damage: { blue: 0, red: 0 },
    defeated: 0,
    lost: 0,
    xp: { damage: 0, kill: 0, victory: 0 },
    levelBefore: 1,
    levelAfter: 1
  };
}

/* Damage that actually left a target. Overkill is not counted. */
function recordDamage(team, amount) {
  if (!amount || amount <= 0) return 0;
  const key = team === TEAM_RED ? "red" : "blue";
  battleLedger.damage[key] += amount;
  return amount;
}

function getBattleLedger() {
  return {
    mapId: battleLedger.mapId,
    difficultyId: battleLedger.difficultyId,
    seed: battleLedger.seed,
    rounds: battleLedger.rounds,
    damage: { blue: battleLedger.damage.blue, red: battleLedger.damage.red },
    defeated: battleLedger.defeated,
    lost: battleLedger.lost,
    xp: { damage: battleLedger.xp.damage, kill: battleLedger.xp.kill, victory: battleLedger.xp.victory },
    levelBefore: battleLedger.levelBefore,
    levelAfter: battleLedger.levelAfter
  };
}

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
    shot: stats.shot ? { atk: stats.shot.atk, range: stats.shot.range } : null,
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
 * Each army occupies 3 columns. Blue holds columns 0-2, red columns 7-9,
 * leaving columns 3-6 as neutral ground between the two lines.
 *
 * The formation is built in three ranks:
 *   col 2  the front rank: two foot soldiers and two chevaliers
 *   col 1  the mid rank: two ballista and two archers
 *   col 0  the rear guard: the champion
 *
 * Nine fighters per side, two of every kind except the champion. Every slot
 * sits on passable ground on both sides, and the mirrored deployment means
 * that both armies face the same kind of fighter in the same lane.
 */
const BLUE_FORMATION = [
  { type: "footman", col: 2, row: 0 },
  { type: "footman", col: 2, row: 1 },
  { type: "chevalier", col: 2, row: 2 },
  { type: "chevalier", col: 2, row: 3 },
  { type: "ballista", col: 1, row: 0 },
  { type: "archer", col: 1, row: 1 },
  { type: "archer", col: 1, row: 2 },
  { type: "ballista", col: 1, row: 3 },
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
  const rowMap = getActiveMap().terrain[row] || "";
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
/* High ground helps anything that can shoot from a distance, including the
 * champion when it looses an arrow rather than using its own blow. */
function getTerrainAimBonus(unit) {
  if (!unit) return 0;
  const reach = unit.shot ? Math.max(unit.range, unit.shot.range) : unit.range;
  if (reach <= 1) return 0;
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

/* Draws the eye to the control that starts the battle. */
function highlightStartButton() {
  if (!$startButton) return;
  $startButton.classList.add("attention");
  later(() => $startButton.classList.remove("attention"), 1200);
}

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
  $selectedStats.textContent = `ATK ${unit.atk} | DEF ${unit.def} | RNG ${unit.range}` +
    (unit.shot ? ` (BOW ${unit.shot.atk} / ${unit.shot.range})` : "");
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
 * Octagonal steps. A unit moves to any of the eight neighbouring cells, and
 * a diagonal step costs the same as a straight one. A diagonal step may not
 * slip between two blocked cells, so a wall of fighters and a rock
 * formation both hold their ground. A unit may not enter an occupied cell
 * and may never spend more movement points than its allowance. The same
 * routine draws the reachable set and validates an action, so the preview
 * can never lie.
 */
const MOVE_DIRECTIONS = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function isOccupied(col, row, excludeId) {
  for (const [id, u] of units) {
    if (id === excludeId) continue;
    if (!u.alive || u.defeated) continue;
    if (u.col === col && u.row === row) return true;
  }
  return false;
}

/* A diagonal step is refused when both cells it would slip between are
 * blocked, whether by a rock formation or by another fighter. A line of
 * units therefore holds its ground, and a gap in a wall is a real gap. */
function canStepDiagonally(fromCol, fromRow, dc, dr, unitId) {
  const sideA = getTerrainAt(fromCol + dc, fromRow);
  const sideB = getTerrainAt(fromCol, fromRow + dr);
  const blockedA = !sideA.passable || isOccupied(fromCol + dc, fromRow, unitId);
  const blockedB = !sideB.passable || isOccupied(fromCol, fromRow + dr, unitId);
  return !(blockedA && blockedB);
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
      if (dc !== 0 && dr !== 0 && !canStepDiagonally(current.col, current.row, dc, dr, unit.id)) continue;

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

/* 14. TARGETING & LINE OF SIGHT
 *
 * Distance is measured the octagonal way: the longest axis decides. A cell
 * one column and one row away is therefore one step away, which is exactly
 * the step a unit makes when it moves diagonally. Movement, reach, weapon
 * range and ability radii all use this one rule, so a shot always reaches
 * as far as a march.
 */
function fieldDistance(a, b) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
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

/* A unit fights with its own weapon. The champion also carries a bow, so it
 * can cover the ranks it guards without leaving them. The bow reaches
 * further but hits softer than the champion's own blow. */
function isBowShot(attacker, attackerPos, targetPos) {
  if (!attacker.shot) return false;
  return fieldDistance(attackerPos, targetPos) > attacker.range;
}

function canReach(attacker, attackerPos, targetPos) {
  const dist = fieldDistance(attackerPos, targetPos);
  if (dist <= attacker.range) return true;
  return !!(attacker.shot && dist <= attacker.shot.range);
}

/* Reach and line of sight in one answer. A blow at arm's length is never
 * blocked, an arrow or a bolt always is. */
function hasReach(attacker, attackerPos, targetPos) {
  const dist = fieldDistance(attackerPos, targetPos);
  if (dist <= 1) return true;
  if (dist <= attacker.range) return hasLineOfSight(attackerPos, targetPos, attacker.range);
  if (attacker.shot && dist <= attacker.shot.range) {
    return hasLineOfSight(attackerPos, targetPos, attacker.shot.range);
  }
  return false;
}

/* The force of the blow that lands on the target. */
function attackValue(attacker, attackerPos, targetPos) {
  return isBowShot(attacker, attackerPos, targetPos) ? attacker.shot.atk : attacker.atk;
}

function getValidTargets(unit, from) {
  const pos = from || unit;
  const targets = [];
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team === unit.team) continue;
    if (!hasReach(unit, pos, u)) continue;
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
  if (!hasReach(attacker, attacker, target)) return false;
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

  const profile = profileForTeam(attacker.team);
  const atkBonus = getUnitAtkBonus(attacker) + (opts.extraDamage || 0) + profile.aimAssist;
  const defBonus = getUnitDefBonus(defender) + getTerrainDefBonus(defenderPos);
  const aimBonus = opts.useTerrainAim === false ? 0 : getTerrainAimBonus(attackerPos);

  let raw = attackValue(attacker, attackerPos, defenderPos) + atkBonus + aimBonus
    - Math.floor((defender.def + defBonus) / 2);

  /* Damage scatter is off unless the balance harness turns it on, so the
   * ordinary game keeps its exact numbers. */
  if (combatVariance > 0) {
    raw = Math.round(raw * (1 + (nextRandom() * 2 - 1) * combatVariance));
  }

  return Math.max(1, raw);
}

function applyDamage(targetId, amount, options) {
  const opts = options || {};
  const target = units.get(targetId);
  if (!target || !target.alive || target.defeated) return 0;

  const hpBefore = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  const dealt = hpBefore - target.hp;

  /* Only a real blow counts towards the damage reward, and only the health
   * that actually left the target counts: overkill is never rewarded. */
  if (opts.countDamage) recordDamage(opts.team || target.team, dealt);

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
    /* The reward is keyed by the battle, so it can only ever be paid once.
     * Only the crimson legion pays out: losing one of your own fighters is
     * a loss, never an income. */
    if (target.team === TEAM_RED) {
      battleLedger.defeated += 1;
      awardExperienceForDefeat(target);
    } else {
      battleLedger.lost += 1;
    }
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
    if (fieldDistance(unit, target) > ability.range) return false;
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
  /* Only the team the AI is currently driving may use an ability. Outside an
   * AI turn there is no such team, so the answer is always no. */
  if (aiTurnTeam !== unit.team) return false;
  if (!isAbilityUnlocked(ability.id)) return false;
  if (getAbilityUses(unit, ability.id) >= ability.usesPerBattle) return false;
  if (ability.actionCost === "attack" && unit.hasAttacked) return false;
  if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) return false;

  if (ability.type === "offensive") {
    const target = units.get(targetId);
    if (!target) return false;
    if (!target.alive || target.defeated) return false;
    if (target.team === unit.team) return false;
    if (fieldDistance(unit, target) > ability.range) return false;
    if (!hasLineOfSight(unit, target, ability.range)) return false;
  }
  return true;
}

/* Applies the effect of an ability to the battlefield. */
function applyAbilityEffect(unit, ability, target) {
  if (ability.type === "offensive") {
    const damage = calculateDamage(unit, target, { extraDamage: ability.damageBonus });
    applyDamage(target.id, damage, { countDamage: true, team: unit.team });
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
    if (fieldDistance(unit, ally) > ability.radius) continue;
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
  gameState = STATE_PLAYER_SELECTING;
  roundNumber = 1;
  selectedUnitId = null;
  pendingAbilityId = null;

  $startButton.disabled = true;
  $startButton.textContent = "ARENA READY";
  $battleResult.classList.add("hidden");
  hideBattleReport();
  $turnBanner.classList.remove("hidden");
  $endTurnButton.classList.remove("hidden");
  $endTurnButton.disabled = false;
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $combatLog.innerHTML = "";

  resetActionFlags();
  resetAbilityUses();
  renderSetupPanel();
  battleLedger = createBattleLedger();
  battleLedger.mapId = getActiveMapId();
  battleLedger.difficultyId = getDifficultyId();
  battleLedger.seed = randomSeed;
  battleLedger.levelBefore = progression.level;
  battleLedger.levelAfter = progression.level;
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

/* Front-to-back order: the units of a team take their turn from the front
 * rank backwards, so the fighter that is already closest to the enemy moves
 * first. Ties break on row, then on id. */
function buildActionQueue(team) {
  const ids = team === TEAM_BLUE ? blueUnitIds : redUnitIds;
  const direction = team === TEAM_BLUE ? -1 : 1;
  return ids
    .map(id => units.get(id))
    .filter(u => u && u.alive && !u.defeated)
    .sort((a, b) => {
      if (a.col !== b.col) return (a.col - b.col) * direction;
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
    if (!canReach(enemy, enemy, { col, row })) continue;
    const weight = enemy.range > 1 ? 1 : 0.7;
    const attack = attackValue(enemy, enemy, { col, row }) + getUnitAtkBonus(enemy);
    total += weight * Math.max(1, attack - Math.floor(defenderDef / 2));
  }
  return total;
}

function evaluateAttackAction(attacker, target, attackerPos) {
  const pos = attackerPos || attacker;
  const profile = profileForTeam(attacker.team);
  const damage = calculateDamage(attacker, target, { attackerPos: pos });
  const kills = damage >= target.hp;

  let score = damage * AI_TUNING.damageWeight * profile.tradeAppetite;
  if (kills) score += AI_TUNING.killBonus + targetValue(target);
  if (target.hp <= target.maxHp * 0.5) score += AI_TUNING.finishBonus;
  score += getTerrainAimBonus(pos);

  /* A sharper opponent goes after the banner carrier. */
  if (profile.championFocus && target.type === "champion") {
    score += profile.championFocus;
  }

  /* Trading blows is a real cost. */
  const retaliation = estimateIncomingDamage(pos.col, pos.row, attacker.team, attacker.def);
  score -= retaliation * AI_TUNING.retaliationWeight * profile.caution;
  return score;
}

/* Which way is forward for this unit. Normally the enemy lies ahead and
 * forward is the way the army marches. When every living enemy has already
 * walked past the unit, forward turns around: a unit that keeps marching on
 * would leave the field and the battle would never end. */
function advanceDirection(unit) {
  const forward = unit.team === TEAM_BLUE ? 1 : -1;
  let enemyAhead = false;
  let enemyBehind = false;
  for (const [, other] of units) {
    if (!other.alive || other.defeated) continue;
    if (other.team === unit.team) continue;
    const delta = (other.col - unit.col) * forward;
    if (delta > 0) enemyAhead = true;
    else if (delta < 0) enemyBehind = true;
  }
  if (enemyAhead || !enemyBehind) return forward;
  return -forward;
}

function evaluateMoveAction(unit, cell) {
  const terrain = getTerrainAt(cell.col, cell.row);
  const profile = profileForTeam(unit.team);
  const advance = (cell.col - unit.col) * advanceDirection(unit);

  let score = 0;
  score += advance * AI_TUNING.advanceWeight * profile.aggression;
  score += terrain.def * AI_TUNING.coverWeight;

  const currentThreat = estimateIncomingDamage(unit.col, unit.row, unit.team, unit.def);
  const nextThreat = estimateIncomingDamage(cell.col, cell.row, unit.team, unit.def);
  /* Only the CHANGE in danger matters. A unit that is already exposed does
   * not refuse to advance just because arrows can still reach it. */
  score -= (nextThreat - currentThreat) * AI_TUNING.threatWeight * profile.caution;

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
    score += Math.min(advance, 2) * AI_TUNING.meleeAdvanceBonus * profile.aggression;
  }

  /* A unit that can loose an arrow likes the high ground. */
  const shootRange = unit.shot ? unit.shot.range : unit.range;
  if (shootRange > 1 && terrain.aim > 0) {
    score += terrain.aim * AI_TUNING.elevationWeight;
  }

  /* The champion is a standard-bearer as much as a fighter, so it prefers a
   * cell that still reaches its own ranks. Without this the bow would let
   * it wander off alone and leave the army it is meant to rally. */
  if (unit.type === "champion") {
    score += countAlliesNear(unit, cell, AI_TUNING.championAllyRadius) * AI_TUNING.championAllyProximity;
  }
  return score;
}

/* How many living allies of the unit would stand next to a candidate cell. */
function countAlliesNear(unit, cell, radius) {
  let count = 0;
  for (const [, ally] of units) {
    if (!ally.alive || ally.defeated) continue;
    if (ally.team !== unit.team) continue;
    if (ally.id === unit.id) continue;
    if (fieldDistance(cell, ally) > radius) continue;
    count++;
  }
  return count;
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
    if (fieldDistance(unit, ally) > ability.radius) continue;
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
    if (fieldDistance(unit, ally) > ability.radius) continue;
    if (hasEffect(ally, ability.id)) continue;
    if (estimateIncomingDamage(ally.col, ally.row, unit.team, ally.def) > 0) count++;
  }
  return count;
}

function evaluateAbilityAction(unit, ability, target) {
  const profile = profileForTeam(unit.team);
  if (ability.type === "offensive") {
    const damage = calculateDamage(unit, target, { extraDamage: ability.damageBonus });
    const kills = damage >= target.hp;
    let score = damage * AI_TUNING.offensiveAbilityDamage;
    if (kills) score += AI_TUNING.killBonus + targetValue(target) + AI_TUNING.offensiveAbilityBonus * profile.abilityDrive;
    return score;
  }

  const beneficiaries = countAbilityBeneficiaries(unit, ability);
  if (beneficiaries < AI_TUNING.supportMinimum / profile.abilityDrive) return -1;

  let score = beneficiaries * (ability.type === "defensive"
    ? AI_TUNING.guardPerAlly
    : AI_TUNING.supportPerAlly) * profile.abilityDrive;
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
          if (fieldDistance(unit, target) > ability.range) continue;
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
  let score = 0;
  if (action.kind === "attack") {
    score = AI_TUNING.actNowBonus + evaluateAttackAction(action.unit, action.target);
  } else if (action.kind === "move") {
    score = evaluateMoveAction(action.unit, action.cell);
    const follow = bestAttackFrom(action.unit, action.cell);
    if (follow) score += follow.score;
  } else if (action.kind === "ability") {
    score = evaluateAbilityAction(action.unit, action.ability, action.target);
  }
  /* The jitter is off by default, so the shipped game weighs every option by
   * the rules alone. The balance harness turns it up to explore strategies. */
  if (aiJitter > 0) score += nextRandom() * aiJitter;
  return score;
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

  aiTurnTeam = TEAM_RED;
  aiTurnOwnsRound = true;
  aiActionQueue = buildActionQueue(TEAM_RED);
  aiActionIndex = 0;

  if (aiActionQueue.length === 0) {
    finishEnemyTurn();
    return;
  }
  executeNextEnemyAction();
}

/* Plays one team's turn with the tactical AI, resolving the whole turn in one
 * step. The balance harness uses it to fight the reference opponent with
 * exactly the same brain the enemy uses, instead of a copy of the rules.
 *
 * The turn does not close the round: the round is closed by the enemy turn
 * that follows it, so the round counter stays honest. */
function runTurnInstantForTeam(team) {
  const previous = instantTimers;
  instantTimers = true;
  const previousTeam = aiTurnTeam;
  const previousOwnsRound = aiTurnOwnsRound;
  try {
    aiTurnTeam = team;
    aiTurnOwnsRound = false;
    aiActionQueue = buildActionQueue(team);
    aiActionIndex = 0;
    if (aiActionQueue.length > 0) executeNextEnemyAction();
  } finally {
    instantTimers = previous;
    aiTurnTeam = previousTeam;
    aiTurnOwnsRound = previousOwnsRound;
  }
}

function executeNextEnemyAction() {
  if (battleToken !== currentBattleToken) return;
  if (gameState === STATE_ENDED) return;

  if (aiActionIndex >= aiActionQueue.length) {
    if (aiTurnOwnsRound) finishEnemyTurn();
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
    applyDamage(target.id, damage, { countDamage: true, team: unit.team });

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
  aiTurnTeam = null;
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
    renderSetupPanel();
    gameState = STATE_ENDED;
    currentTurn = "ended";
    clearSelection();
    $endTurnButton.classList.add("hidden");
    $abilityWrap.classList.add("hidden");
    $turnBanner.classList.add("hidden");

    let outcome = "stalemate";
    if (!livingRed && livingBlue) {
      outcome = "victory";
      $battleResult.textContent = "VICTORY — AZURE LEGION PREVAILS";
      $battleResult.className = "battle-result victory";
      logEvent("Azure Legion is victorious!", "system");
    } else if (!livingBlue && livingRed) {
      outcome = "defeat";
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
      finalizeBattleResult(!livingRed && livingBlue, outcome);
    }
    return true;
  }
  return false;
}

/* The completion bonus is paid exactly once per battle. */
function finalizeBattleResult(victory, outcome) {
  progression.battles += 1;
  if (victory) progression.wins += 1;

  battleLedger.rounds = roundNumber;

  /* Experience for the damage itself. The key is tied to the battle, so the
   * reward can only ever be paid once, however often the end check runs. */
  const damageXp = Math.floor(battleLedger.damage.blue / XP_PER_DAMAGE);
  if (damageXp > 0) {
    battleLedger.xp.damage = damageXp;
    awardExperience(damageXp, `${battleLedger.damage.blue} damage dealt`, `battle:${battleId}:damage`);
  }
  if (victory) {
    battleLedger.xp.victory = XP_VICTORY_BONUS;
    awardExperience(XP_VICTORY_BONUS, "victory", `battle:${battleId}:victory`);
  }

  /* The level is read after the rewards, so a level that the last blow
   * earned is still shown. */
  battleLedger.levelAfter = progression.level;

  saveChampionProgression();
  updateProgressionUI();
  updateChampionPanel();
  renderBattleReport(outcome || (victory ? "victory" : "defeat"));
}

function awardExperienceForDefeat(defeatedUnit) {
  const base = XP_REWARDS[defeatedUnit.type] || 10;
  let total = base;
  let reason = `defeated ${defeatedUnit.displayName}`;
  if (defeatedUnit.type === "champion") {
    total += XP_CHAMPION_BONUS;
    reason = `defeated the enemy champion`;
  }
  battleLedger.xp.kill += total;
  awardExperience(total, reason, `battle:${battleId}:kill:${defeatedUnit.id}`);
}

function resetBattle() {
  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  aiTurnTeam = null;
  aiTurnOwnsRound = false;
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
  renderSetupPanel();

  $startButton.disabled = false;
  $startButton.textContent = "ENTER THE ARENA";
  $battleResult.classList.add("hidden");
  $battleResult.className = "battle-result hidden";
  hideBattleReport();
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

/* 21.1 PRE-BATTLE SELECTOR
 *
 * The selector is drawn from the same data the engine plays on, so a card
 * can never promise ground the battlefield does not have. Each map card
 * carries a small picture of its own terrain.
 */
function renderSetupPanel() {
  if (!$setupPanel) return;
  renderDifficultyButtons();
  renderMapCards();
  /* The ground and the opponent are chosen between battles: the field must
   * never change under a running fight. */
  $setupPanel.classList.toggle("locked", battleActive);
}

function renderDifficultyButtons() {
  if (!$difficultyRow) return;
  const locked = battleActive;
  $difficultyRow.innerHTML = "";
  for (const id of DIFFICULTY_IDS) {
    const profile = DIFFICULTY_PROFILES[id];
    const button = document.createElement("button");
    button.className = "difficulty-button" + (id === currentDifficultyId ? " selected" : "");
    button.type = "button";
    button.disabled = locked;
    button.dataset.difficulty = id;
    button.textContent = profile.label;
    button.title = profile.hint;
    button.addEventListener("click", () => selectDifficulty(id));
    $difficultyRow.appendChild(button);
  }
  if ($difficultyHint) {
    const profile = DIFFICULTY_PROFILES[currentDifficultyId] || DIFFICULTY_PROFILES.normal;
    $difficultyHint.textContent = profile.hint;
  }
}

function renderMapCards() {
  if (!$mapRow) return;
  const locked = battleActive;
  $mapRow.innerHTML = "";
  for (const map of MAP_REGISTRY) {
    const card = document.createElement("button");
    card.className = "map-card" + (map.id === activeMapId ? " selected" : "");
    card.type = "button";
    card.disabled = locked;
    card.dataset.map = map.id;

    const name = document.createElement("span");
    name.className = "map-name";
    name.textContent = map.name;
    card.appendChild(name);

    const tagline = document.createElement("span");
    tagline.className = "map-tagline";
    tagline.textContent = map.tagline;
    card.appendChild(tagline);

    const preview = document.createElement("span");
    preview.className = "map-preview";
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cell = document.createElement("span");
        cell.className = `map-preview-cell terrain-${TERRAIN_LEGEND[map.terrain[row][col]] || "grass"}`;
        preview.appendChild(cell);
      }
    }
    card.appendChild(preview);

    card.addEventListener("click", () => selectMap(map.id));
    $mapRow.appendChild(card);
  }
}

function selectDifficulty(id) {
  if (battleActive) return false;
  if (!setDifficulty(id)) return false;
  renderSetupPanel();
  const profile = DIFFICULTY_PROFILES[id];
  logEvent(`Difficulty set to ${profile.label}.`, "system");
  return true;
}

function selectMap(id) {
  if (battleActive) return false;
  if (!setActiveMap(id)) return false;
  renderSetupPanel();
  renderTerrain();
  logEvent(`Battlefield set to ${getActiveMap().name}.`, "system");
  return true;
}

function toggleSetupPanel() {
  if (!$setupPanel || !$setupToggle) return;
  const collapsed = $setupPanel.classList.contains("collapsed");
  $setupPanel.classList.toggle("collapsed", !collapsed);
  $setupToggle.textContent = collapsed ? "HIDE" : "SHOW";
}

/* 21.2 POST-BATTLE REPORT
 *
 * The report shows the ledger that was written while the battle ran, so the
 * numbers always match the rewards that were actually paid out.
 */
function renderBattleReport(outcome) {
  if (!$battleReport) return;

  const map = getMapById(battleLedger.mapId) || getActiveMap();
  const profile = DIFFICULTY_PROFILES[battleLedger.difficultyId] || DIFFICULTY_PROFILES.normal;
  const totalXp = battleLedger.xp.damage + battleLedger.xp.kill + battleLedger.xp.victory;

  if ($reportOutcome) {
    $reportOutcome.textContent = outcome === "victory" ? "VICTORY"
      : outcome === "defeat" ? "DEFEAT" : "NO SURVIVORS";
    $reportOutcome.className = "report-outcome " + outcome;
  }
  if ($reportMap) $reportMap.textContent = map.name;
  if ($reportDifficulty) $reportDifficulty.textContent = profile.label;
  if ($reportRounds) $reportRounds.textContent = String(battleLedger.rounds);
  if ($reportDamage) $reportDamage.textContent = String(battleLedger.damage.blue);
  if ($reportTaken) $reportTaken.textContent = String(battleLedger.damage.red);
  if ($reportKills) $reportKills.textContent = String(battleLedger.defeated);
  if ($reportLosses) $reportLosses.textContent = String(battleLedger.lost);
  if ($reportXp) $reportXp.textContent = String(totalXp);
  if ($reportBreakdown) {
    $reportBreakdown.textContent =
      `Damage ${battleLedger.xp.damage} XP  ·  Kills ${battleLedger.xp.kill} XP  ·  Victory ${battleLedger.xp.victory} XP`;
  }
  if ($reportLevel) {
    $reportLevel.textContent = battleLedger.levelAfter > battleLedger.levelBefore
      ? `Champion rose from level ${battleLedger.levelBefore} to level ${battleLedger.levelAfter}.`
      : `Champion stays at level ${battleLedger.levelAfter}.`;
  }
  $battleReport.dataset.outcome = outcome;
  $battleReport.classList.remove("hidden");
}

function hideBattleReport() {
  if (!$battleReport) return;
  $battleReport.classList.add("hidden");
  $battleReport.dataset.outcome = "";
}

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
    (champion.shot ? ` · BOW ${champion.shot.atk}/${champion.shot.range}` : "") +
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
    if (fieldDistance(unit, target) > ability.range) continue;
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
  if (!battleActive) {
    /* The armies are on the field before the battle starts, so a click in
     * that state has to say what to do next instead of doing nothing. */
    logEvent("The battle has not begun — press ENTER THE ARENA.", "system");
    highlightStartButton();
    return;
  }
  if (currentTurn !== "player" || actionLock) return;

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
    const dist = fieldDistance(attacker, unit);
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
    if (fieldDistance(attacker, target) > attacker.range) {
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
    applyDamage(targetId, damage, { countDamage: true, team: attacker.team });

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
  renderSetupPanel();
  updateProgressionUI();

  $startButton.addEventListener("click", () => {
    if (gameState === STATE_ENDED || battleActive) resetBattle();
    startBattle();
  });

  if ($setupToggle) {
    $setupToggle.addEventListener("click", () => toggleSetupPanel());
  }

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
    TEAM_BLUE,
    TEAM_RED,
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
    MAP_REGISTRY,
    DEFAULT_MAP_ID,
    MAP_IDS,
    DIFFICULTY_PROFILES,
    DIFFICULTY_IDS,
    DEFAULT_DIFFICULTY_ID,
    XP_PER_DAMAGE,
    DEFAULT_SEED,

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

    /* maps */
    getMapRegistry,
    getMapById,
    getActiveMap,
    getActiveMapId,
    setActiveMap,
    getMapTerrainCounts,
    validateMap,
    selectMap,
    renderSetupPanel,

    /* difficulty */
    getDifficultyProfiles,
    getDifficultyId,
    setDifficulty,
    selectDifficulty,
    profileForTeam,

    /* seeded randomness */
    setSeed,
    getSeed,
    setCombatOptions,
    getCombatOptions,

    /* battle ledger */
    getBattleLedger,

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
    fieldDistance,

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
    },

    /* Resolves one team's turn with the tactical AI in one step. The
     * balance harness uses it so the reference opponent is fought by the
     * same brain the enemy uses. */
    runTurnInstantForTeam
  };
}
