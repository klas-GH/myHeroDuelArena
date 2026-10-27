/* ==========================================================================
   myHeroDuelArena v1.12.11 — FIGHT IT, OR WATCH THE AI FIGHT IT
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
const APP_VERSION = "v1.12.11";

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

/* The name a legion is known by on the field. */
function teamName(team) {
  return team === TEAM_BLUE ? "The azure legion" : "The crimson legion";
}

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
 * `melee` marks a GROUND unit: a fighter that fights with its own hands at
 * arm's length. A ground unit strikes forward only, reaches into the front
 * two ranks of the other army and never cuts through a living shield (see
 * section 14.1). A unit without the flag is a shooter: it reaches any
 * target inside its range, and the front line of the other army never
 * covers anything from a bow.
 *
 * `range` is the reach of the unit's own weapon: the blade reach of a
 * ground unit. A shooter has no blade reach at all, because its bow covers
 * the whole field.
 *
 * `shot` is the second weapon of a unit that carries a bow. The champion
 * fights with its own weapon at close range and can loose an arrow at a
 * longer distance, but the arrow carries less force than a blow.
 *
 * `armour` is the share of every blow that the armour of the fighter turns
 * away. The numbers are tuned so that the game keeps its pace: armour
 * makes a fighter harder to bring down, but it never turns one into a
 * wall that has to be beaten down over half a duel. A champion in heavy
 * armour still falls in a handful of blows.
 */
const UNIT_STATS = {
  archer:   { hp: 40, atk: 14, def: 4,  move: 2, range: 3, melee: false, armour: 0.15, special: null },
  footman:  { hp: 60, atk: 12, def: 6,  move: 1, range: 1, melee: true,  armour: 0.20, special: null },
  ballista: { hp: 45, atk: 18, def: 3,  move: 1, range: 4, melee: false, armour: 0.12, special: null },
  chevalier:{ hp: 55, atk: 16, def: 5,  move: 3, range: 1, melee: true,  armour: 0.25, special: null },
  champion: { hp: 90, atk: 20, def: 8,  move: 2, range: 1, melee: true,  armour: 0.18, special: "rally",
              shot: { atk: 16 } }
};

/* 1.4 CHAMPION ABILITY SET — every champion owns the same three abilities. */
const CHAMPION_ABILITIES = ["rally", "power_strike", "guarding_aura"];

/* 1.5 THE DEFENCE STAND
 *
 * A fighter that makes a defence stand gives up its action and braces
 * behind its shield. While it stands, its armour is twenty points higher,
 * and the stance lasts until the fighter acts again.
 */
const DEFENCE_STAND_ARMOUR = 0.20;

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
      "GFGGBBGGFG",
      "GGGGBBGGGG",
      "GGHHHHHHGG",
      "GFGGRRGGFG"
    ]
  },
  {
    id: "high_ground",
    name: "The High Ground",
    tagline: "A raised plateau in the centre. Whoever holds it shoots free.",
    terrain: [
      "GRFGBBGFRG",
      "GGGGHHGGGG",
      "GGGGHHGGGG",
      "GRFGBBGFRG"
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
    melee: true,
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

/* Battle resolution */
/* A battle is never fought for longer than this. When the limit is reached
 * the field is settled in sudden death: the two armies are compared by the
 * health they have left, and an even field is a draw. */
const BATTLE_ROUND_LIMIT = 30;

/* Damage is amplified in the final round, so a stalemate breaks instead of
 * grinding on. The factor is the same for both armies. */
const SUDDEN_DEATH_DAMAGE_MULTIPLIER = 1.5;

/* The spectator show runs on a quicker clock than a player battle. */
const SPECTATOR_TIMING = {
  attack: 260,
  move: 320,
  ability: 240,
  gap: 160
};

/* 4.1 THE DUEL
 *
 * A duel is a series of matches, and the legion that takes two of them wins
 * the duel. The series is at most three matches long, and it stops as soon
 * as one legion has two wins.
 */
const DUEL_MATCH_LIMIT = 3;
const DUEL_WINS_NEEDED = 2;

/* How long a show waits between two matches, so the result of the match
 * that was just fought can be read before the next one begins. */
const DUEL_ADVANCE_DELAY = 4200;


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
  retaliationWeight: 0.12,    /* penalty for trading blows               */
  retaliationAnswers: 2,      /* how many answers a blow is weighed with  */
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
  lethalCredit: 18,          /* extra score for a blow that ends a unit    */
  dangerWeight: 0.35,        /* score per point of danger a target carries*/
  vulnerableDangerWeight: 1, /* danger to a shooter or a wounded ally     */
  ordinaryDangerWeight: 0.4, /* danger to any other ally                  */
  suicidalPenalty: 22,       /* penalty for a trade that kills the attacker*/
  tradePenalty: 8,           /* penalty for a trade that kills both       */
  wastedMovePenalty: 6,      /* penalty for walking when a blow was ready */
  positionalLethalCredit: 14,/* score for a cell that would end a unit     */
  minActionScore: 2         /* an action must be worth this much to run*/
};

/* AI turn pacing. Short enough that a full turn does not feel like a wait,
 * long enough that each action is readable. */
const AI_TIMING = {
  attack: 460,
  move: 520,
  ability: 420,
  gap: 280
};

/* The pacing of the running AI turn. A spectator battle is a show rather
 * than a fight, so it runs on the quicker clock. */
function aiTiming() {
  return battleMode === "spectator" ? SPECTATOR_TIMING : AI_TIMING;
}

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
  if (battleActive) return false;
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTY_PROFILES, id)) return false;
  currentDifficultyId = id;
  return true;
}

/* Show the current difficulty on the footer cycle button. */
function updateDifficultyLabel() {
  if (!$difficultyCycle) return;
  $difficultyCycle.textContent = DIFFICULTY_PROFILES[currentDifficultyId].label;
}

/* Cycle the AI difficulty: Easy → Normal → Hard → Easy. */
function cycleDifficulty() {
  if (battleActive) return false;
  const ids = DIFFICULTY_IDS;
  const index = ids.indexOf(currentDifficultyId);
  const next = ids[(index + 1) % ids.length];
  if (!setDifficulty(next)) return false;
  updateDifficultyLabel();
  logEvent(`Difficulty set to ${DIFFICULTY_PROFILES[next].label}.`, "system");
  return true;
}

const TURN_MODE_IDS = ["party", "troop"];
const DEFAULT_TURN_MODE_ID = "party";

let currentTurnModeId = DEFAULT_TURN_MODE_ID;

function getTurnModeProfiles() {
  return TURN_MODE_IDS.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
}

function getTurnModeId() {
  return currentTurnModeId;
}

function setTurnModeId(id) {
  if (battleActive) return false;
  if (!TURN_MODE_IDS.includes(id)) return false;
  currentTurnModeId = id;
  return true;
}

/* Show the current turn mode on the footer cycle button. */
function updateTurnLabel() {
  if (!$turnCycle) return;
  $turnCycle.textContent = currentTurnModeId.charAt(0).toUpperCase() + currentTurnModeId.slice(1);
}

/* Cycle the turn mode: Party → Troop → Party. */
function cycleTurnMode() {
  if (battleActive) return false;
  const index = TURN_MODE_IDS.indexOf(currentTurnModeId);
  const next = TURN_MODE_IDS[(index + 1) % TURN_MODE_IDS.length];
  if (!setTurnModeId(next)) return false;
  updateTurnLabel();
  logEvent(`Turn mode set to ${next}.`, "system");
  return true;
}

/* In troop mode each fighter acts alone: after one move or one blow the
 * activation is spent and the turn is handed over (HoMM-style one unit at
 * a time). The combat round only advances when every living fighter has
 * acted once. */
function maybeAutoEndTurnForTroopMode() {
  if (getTurnModeId() !== "troop") return;
  if (currentTurn !== "player") return;
  const unit = selectedUnitId ? units.get(selectedUnitId) : null;
  if (unit) markTroopActed(unit);
  endPlayerTurn();
}

/* 5.2 TACTICAL DEPTH
 *
 * The tactical evaluator always asks the same questions. A difficulty only
 * decides which answers it listens to, so the rules of a fight never change
 * with the difficulty — only the decisions do. Every weight is a plain
 * number, so the behaviour can be read, tuned and tested.
 *
 *   elimination  extra credit for a blow that ends a unit
 *   danger       extra credit for hitting a unit that threatens the army
 *   survival     penalty for a trade the attacker cannot survive
 *   waste        penalty for walking when a blow was already available
 *   position     credit for a cell from which the next blow would end a unit
 *
 * Easy listens to none of them and keeps the plain, obvious behaviour of
 * earlier versions. Normal listens to all of them with a light hand. Hard
 * listens to all of them with a heavier hand.
 *
 * The weights are measured, not guessed. Every one of them was chosen with
 * the balance harness, fighting the same reference opponent over four
 * battlefields and forty seeds a map:
 *
 *   - the plain legion (all weights zero) wins 0 % of Normal battles
 *   - the weights below win 51 % of Normal battles, so Normal stays the
 *     even fight it has always been
 *   - the same weights, one third heavier, win 90 % of Hard battles
 *
 * A heavier legion is a better legion, but a legion that wins every battle
 * is not a difficulty, it is a wall.
 */
const TACTICAL_DEPTH = {
  easy: { elimination: 0, danger: 0, survival: 0, waste: 0, position: 0 },
  normal: { elimination: 0.35, danger: 0.2, survival: 0.35, waste: 0.35, position: 0.2 },
  hard: { elimination: 0.45, danger: 0.4, survival: 0.4, waste: 0.45, position: 0.35 }
};

/* The tactical depth a team fights with. The azure legion always plays by
 * the normal rules, exactly like its damage profile, and a spectator show
 * gives both armies the same depth, so the fight stays an even one. */
function tacticalDepth(team) {
  if (battleMode === "spectator") return TACTICAL_DEPTH.normal;
  if (team !== TEAM_RED) return TACTICAL_DEPTH.normal;
  return TACTICAL_DEPTH[currentDifficultyId] || TACTICAL_DEPTH.normal;
}

/* The player is never handicapped by the difficulty setting: only the
 * crimson legion changes. The blue side always plays by the normal rules,
 * which also makes it a stable reference opponent for the balance harness.
 *
 * A spectator battle is a display, not a challenge, so both armies fight by
 * the normal rules there: neither side is handed the harder opponent. */
function profileForTeam(team) {
  if (battleMode === "spectator") return DIFFICULTY_PROFILES.normal;
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
const $modeButton = document.getElementById("mode-button");
const $selectionInfo = document.getElementById("selection-info");
const $selectedName = document.getElementById("selected-name");
const $selectedStats = document.getElementById("selected-stats");
const $selectedHealth = document.getElementById("selected-health");
const $actionHints = document.getElementById("action-hints");
const $braceButton = document.getElementById("brace-button");
const $actionIcons = document.getElementById("action-icons");
const $iconDefend = document.getElementById("icon-defend");
const $iconMelee = document.getElementById("icon-melee");
const $iconRanged = document.getElementById("icon-ranged");
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
const $overlayLayer = document.getElementById("overlay-layer");
const $moveIndicators = document.getElementById("move-indicators");
const $attackIndicators = document.getElementById("attack-indicators");
const $battlefield = document.getElementById("battlefield");
const $terrainLayer = document.getElementById("terrain-layer");

const $progressionStrip = document.getElementById("progression-strip");
const $progLevel = document.getElementById("prog-level");
const $progXpFill = document.getElementById("prog-xp-fill");
const $progXpText = document.getElementById("prog-xp-text");
const $progPoints = document.getElementById("prog-points");

const $championPanel = document.getElementById("champion-panel");
const $champLevel = document.getElementById("champ-level");
const $champStats = document.getElementById("champ-stats");
const $abilityList = document.getElementById("ability-list");

const $levelUpBanner = document.getElementById("level-up-banner");
const $levelUpText = document.getElementById("level-up-text");

const $difficultyLabel = document.getElementById("difficulty-label");
const $difficultyCycle = document.getElementById("difficulty-cycle");
const $turnLabel = document.getElementById("turn-label");
const $turnCycle = document.getElementById("turn-cycle");


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
const $reportSurvivors = document.getElementById("report-survivors");
const $reportHealth = document.getElementById("report-health");
const $reportDecided = document.getElementById("report-decided");
const $reportDuel = document.getElementById("report-duel");
const $reportMode = document.getElementById("report-mode");
const $reportBreakdown = document.getElementById("report-breakdown");
const $reportLevel = document.getElementById("report-level");

/* 7. GAME STATE */

let gameState = STATE_INIT;
let battleActive = false;
let currentTurn = "player";
let roundNumber = 1;
let selectedUnitId = null;
let pendingAttackKind = null; /* "melee" | "ranged" | null — set by icon bar */
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

/* "player" or "spectator". A spectator battle is the AI against itself and
 * pays nothing: no experience, no rewards, no change to the profile. */
let battleMode = "player";

/* The legion that opened the match being fought. It opens the odd rounds
 * of that match; the other legion opens the even ones. */
let matchOpener = TEAM_BLUE;

/* The duel in progress. A duel is a series of up to three matches that is
 * won by the legion that takes two of them. */
const duel = {
  active: false,
  id: 0,
  mode: "player",
  matchNumber: 0,
  blueWins: 0,
  redWins: 0,
  opener: TEAM_BLUE,
  matches: [],
  lastOutcome: null,
  finished: false,
  result: null
};

/* The instant driver steers a show itself, so the series is advanced by the
 * driver and not by the timer that carries a show from one match to the
 * next. */
let duelAutoAdvance = true;

/* True while a spectator battle is on the field. */
let spectatorActive = false;

/* The team whose turn comes next in a spectator battle. */
let spectatorTurnTeam = TEAM_BLUE;

/* The instant spectator driver steers the show itself instead of handing the
 * next turn to a timer. */
let spectatorAutoAdvance = true;

/* True once the round limit has been reached and the final round is fought. */
let suddenDeathActive = false;

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
    levelAfter: 1,
    outcome: null,
    spectator: false,
    /* What the two armies actually did, counted from the actions that were
     * really carried out. */
    actions: {
      blue: { attack: 0, move: 0, ability: 0, riposte: 0 },
      red: { attack: 0, move: 0, ability: 0, riposte: 0 }
    },
    /* How the fight ended, and how much of each army was left standing. */
    ending: null,
    survivors: {
      blue: { units: 0, hp: 0 },
      red: { units: 0, hp: 0 }
    }
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
    levelAfter: battleLedger.levelAfter,
    outcome: battleLedger.outcome,
    spectator: battleLedger.spectator,
    actions: {
      blue: {
        attack: battleLedger.actions.blue.attack,
        move: battleLedger.actions.blue.move,
        ability: battleLedger.actions.blue.ability,
        riposte: battleLedger.actions.blue.riposte
      },
      red: {
        attack: battleLedger.actions.red.attack,
        move: battleLedger.actions.red.move,
        ability: battleLedger.actions.red.ability,
        riposte: battleLedger.actions.red.riposte
      }
    },
    ending: battleLedger.ending,
    survivors: {
      blue: { units: battleLedger.survivors.blue.units, hp: battleLedger.survivors.blue.hp },
      red: { units: battleLedger.survivors.red.units, hp: battleLedger.survivors.red.hp }
    }
  };
}

/* Pending timers are tracked so a reset can cancel them safely. */
const pendingTimers = new Set();
let audioCtx = null;
function getAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext));
    if (!Ctx) return null;
    audioCtx = new Ctx();
  } catch (e) { audioCtx = null; }
  return audioCtx;
}
function playTone(freq, dur, type, vol) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    gain.gain.value = vol || 0.08;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}
function playHit() { playTone(220, 0.15, "sawtooth", 0.1); playTone(110, 0.25, "square", 0.06); }
function playMove() { playTone(440, 0.08, "triangle", 0.05); }

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
    armour: stats.armour || 0,
    move: stats.move,
    range: stats.range,
    melee: !!stats.melee,
    /* How many columns wide the unit is drawn. The champion is drawn across
     * two columns but it is still one unit: one health pool, one turn, one
     * selection state and one logical cell. */
    footprint: type === "champion" ? 2 : 1,
    shot: stats.shot ? { atk: stats.shot.atk } : null,
    special: stats.special,
    abilities: type === "champion" ? CHAMPION_ABILITIES.slice() : [],
    alive: true,
    defeated: false,
    col: 0,
    row: 0,
    hasMoved: false,
    hasAttacked: false,
    hasRipostedThisRound: false,
    hasActedThisRound: false, /* troop mode: one action per unit per round */
    braced: false,
    abilityUses: {},
    effects: [],
    lastAiCell: null,
    selected: false,
    target: false
  };
}

/* 8.1 INITIAL FORMATION
 * Each army occupies TWO columns. Blue holds columns 2-3, red columns 6-7,
 * leaving columns 4-5 as neutral ground between the two lines. Columns 0-1
 * and 8-9 stay empty, so the two blocks never touch the edge of the field
 * and the two armies face each other across a short stretch of ground
 * instead of an empty board.
 *
 * The formation is built in two ranks:
 *   col 2  the rear rank: the champion, two archers and the ballista
 *   col 3  the front rank: two foot soldiers and the chevalier
 *
 * Seven fighters per side: two archers, a ballista, two foot soldiers, a
 * chevalier and the champion. Every slot sits on passable ground on both
 * sides, and the mirrored deployment means that both armies face the same
 * kind of fighter in the same lane.
 *
 * The champion is ONE unit with one health pool, one turn and one
 * selection state. It is anchored in the rear rank and its artwork spans
 * the whole width of the front rank above it, so it reads as the centrepiece
 * of the army without becoming a second unit.
 */
const BLUE_FORMATION = [
  { type: "champion",  col: 2, row: 3 },
  { type: "archer",    col: 2, row: 2 },
  { type: "ballista",  col: 2, row: 1 },
  { type: "archer",    col: 2, row: 0 },
  { type: "footman",   col: 3, row: 2 },
  { type: "chevalier", col: 3, row: 1 },
  { type: "footman",   col: 3, row: 0 }
];

const RED_FORMATION = BLUE_FORMATION.map(slot => ({
  type: slot.type,
  col: GRID_COLS - 1 - slot.col,
  row: slot.row
}));

const DEPLOYMENT_BOUNDARY = {
  [TEAM_BLUE]: Math.min(...BLUE_FORMATION.map(slot => slot.col)),
  [TEAM_RED]: Math.max(...RED_FORMATION.map(slot => slot.col))
};

function isInsideDeploymentBoundary(unit, col) {
  return unit.team === TEAM_BLUE
    ? col >= DEPLOYMENT_BOUNDARY[TEAM_BLUE]
    : col <= DEPLOYMENT_BOUNDARY[TEAM_RED];
}

function createArmy(team) {
  const formation = team === TEAM_BLUE ? BLUE_FORMATION : RED_FORMATION;
  return formation.map((slot, i) => {
    const unit = createUnit(`${team}-${i}`, team, slot.type);
    unit.col = slot.col;
    unit.row = slot.row;
    /* A unit that is drawn across more than one column reaches towards the
     * enemy, never away from it. */
    unit.footprintDir = advanceSign(team);
    return unit;
  });
}

const units = new Map();
const blueUnitIds = [];
const redUnitIds = [];
const unitElements = new Map();
/* The names and the health bars of the troops, in the layer above the
 * pictures. */
const unitOverlays = new Map();

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
  const reach = getRangedReach(unit);
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
  if ($overlayLayer) $overlayLayer.innerHTML = "";
  $moveIndicators.innerHTML = "";
  $attackIndicators.innerHTML = "";
  unitElements.clear();
  unitOverlays.clear();

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

  /* The artwork. The large troop picture stands for the unit; the small
   * inline SVG is kept as a fallback for the rare case where a picture
   * cannot be loaded, so a unit never disappears from the field. */
  const art = document.createElement("div");
  art.className = "unit-art";

  const symbol = document.createElement("div");
  symbol.className = "unit-silhouette";
  /* The <svg> wrapper keeps <use> in the SVG namespace — an HTML parser only
   * creates real SVG elements inside an <svg> subtree. */
  symbol.innerHTML = `<svg viewBox="0 0 100 100" class="unit-glyph"><use href="#sil-${unit.type}"></use></svg>`;

  const image = document.createElement("img");
  image.className = "unit-image";
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.src = `assets/troops/${unit.type}-${unit.team}.png`;
  image.addEventListener("error", () => image.classList.add("unit-image-missing"));

  art.append(symbol, image);

  const ring = document.createElement("div");
  ring.className = "selection-ring";

  element.append(art, ring);

  /* The name and the health bar live in their own layer above the troops.
   * A large picture covers the fighter behind it, and the numbers of that
   * fighter must still be readable. */
  const overlay = document.createElement("div");
  overlay.className = `unit-overlay ${unit.type} ${unit.team}`;
  overlay.dataset.id = unit.id;

  const label = document.createElement("div");
  label.className = "unit-label";
  label.textContent = unit.name.charAt(0);

  const healthWrap = document.createElement("div");
  healthWrap.className = "unit-health";
  const healthFill = document.createElement("div");
  healthFill.className = "health-fill";
  healthWrap.appendChild(healthFill);

  overlay.append(label, healthWrap);
  if ($overlayLayer) $overlayLayer.appendChild(overlay);
  unitOverlays.set(unit.id, overlay);

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
  /* A unit that is drawn wider than its own column sits across the middle
   * of that column and the next one, towards the enemy. The logical anchor
   * never changes, so the collision rules stay honest. */
  const span = unit.footprint && unit.footprint > 1 ? unit.footprint : 1;
  const shift = (span - 1) * 0.5 * (100 / GRID_COLS) * footprintDir(unit);
  element.style.left = `${colPercent(unit.col) + shift}%`;
  element.style.top = `${rowPercent(unit.row)}%`;
  /* The lane nearest to the viewer is drawn last, so a tall picture leans
   * over the fighter behind it instead of hiding behind it. */
  element.style.zIndex = String(GRID_ROWS - unit.row);
  /* A picture is wider than the cell it stands on, so a fighter in the
   * first or the last column would hang over the edge of the field. The
   * picture is nudged back inside by the width it overhangs, worked out
   * from the size of the picture itself, so a picture that grows keeps its
   * own edge. The champion is drawn across two whole columns, so it never
   * overhangs unless it stands on an edge column, in which case the
   * overhang is pulled back just as far as it needs to go. */
  const picW = unit.type === "champion" ? 21 : 14.5; /* cqw, match --champ-art-w / --art-w */
  /* translate(-50%) on the unit makes style.left its visual centre, so the
   * picture is centred on colPercent(col) plus the footprint shift. */
  const centre = colPercent(unit.col) + shift;
  const picLeft = centre - picW / 2;
  const picRight = centre + picW / 2;
  /* Nudge the picture back inside the field by however far it pokes out,
   * with a couple of pixels of slack so sub-pixel rounding never leaves a
   * picture half outside the field's edge. */
  const field = document.getElementById("battlefield");
  const bufferCqw = field ? (2 / Math.max(1, field.clientWidth)) * 100 : 0;
  let artShift = 0;
  if (picRight > 100) artShift = -(picRight - 100) - bufferCqw;
  else if (picLeft < 0) artShift = -picLeft + bufferCqw;
  element.style.setProperty("--art-shift", `${artShift}cqw`);
  /* The name and the health bar follow the troop. */
  const overlay = unitOverlays.get(unit.id);
  if (overlay) {
    overlay.style.left = `${colPercent(unit.col) + shift}%`;
    overlay.style.top = `${rowPercent(unit.row)}%`;
  }
  /* The drawn cell is written into the markup as well, so the picture can
   * be checked against the cell it claims to stand on. */
  element.dataset.col = String(unit.col);
  element.dataset.row = String(unit.row);
  element.dataset.span = String(span);
}

function updateUnitHealthBar(element, unit) {
  const overlay = unitOverlays.get(unit.id);
  const fill = overlay
    ? overlay.querySelector(".health-fill")
    : element.querySelector(".health-fill");
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
function highlightModeButton() {
  if (!$modeButton) return;
  $modeButton.classList.add("attention");
  later(() => $modeButton.classList.remove("attention"), 1200);
}

function clearSelection() {
  selectedUnitId = null;
  pendingAbilityId = null;
  units.forEach(u => { u.selected = false; u.target = false; });
  unitElements.forEach(el => {
    el.classList.remove("selected", "target");
    /* Restore lane order so the selected fighter does not stay permanently on top. */
    const row = Number(el.dataset.row || 0);
    el.style.zIndex = String(GRID_ROWS - row);
    const ring = el.querySelector(".selection-ring");
    if (ring) ring.classList.remove("selection-ring-active");
  });
  clearMoveIndicators();
  clearAttackIndicators();
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $actionHints.textContent = "";
  if ($braceButton) $braceButton.classList.add("hidden");
  if ($actionIcons) $actionIcons.classList.add("hidden");
  pendingAttackKind = null;
  updateChampionPanel();
  /* After deselect, show all blue move options again (party mode). */
  if (battleActive && currentTurn === "player" && battleMode !== "spectator") {
    showPreviewMoveIndicators();
  }
}

/* An offensive ability is played by picking a target, so the pending
 * ability is remembered between the button press and the click. */
let pendingAbilityId = null;

function selectUnit(id) {
  const unit = units.get(id);
  if (!unit || !unit.alive || unit.defeated) return;
  if (getTurnModeId() === "troop" && unit.team === TEAM_BLUE && unit.hasActedThisRound) {
    logEvent(`${unit.displayName} has already acted this round.`, "system");
    return;
  }

  clearSelection();
  selectedUnitId = id;
  unit.selected = true;

  const el = unitElements.get(id);
  if (el) {
    el.classList.add("selected");
    el.style.zIndex = String(GRID_ROWS + 2); /* selected fighter always on top */
    const ring = el.querySelector(".selection-ring");
    if (ring) ring.classList.add("selection-ring-active");
  }

  $selectionInfo.classList.remove("hidden");
  $selectedName.textContent = unit.displayName;
  const reach = unit.melee
    ? `MELEE ${formatReach(getMeleeReach(unit))}`
    : `RANGE ${formatReach(getRangedReach(unit))}`;
  $selectedStats.textContent = `ATK ${unit.atk} | DEF ${unit.def} | ARM ${Math.round(getUnitArmour(unit) * 100)}% | ${reach}` +
    (unit.shot ? ` | BOW ${unit.shot.atk} ATK · FIELD` : "");
  $selectedHealth.style.width = "100%";

  const hints = [];
  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    if (!unit.hasMoved && !unit.hasAttacked) hints.push("Can move");
    if (!unit.hasMoved && !unit.hasAttacked) hints.push("Can attack");
    const ready = getReadyAbilities(unit);
    if (ready.length > 0) hints.push(`${ready.length} ability ready`);
    if (!hints.length) hints.push("No actions available");
  }
  $actionHints.textContent = hints.join(" · ");

  /* Legacy text brace button stays hidden; icons handle the actions. */
  if ($braceButton) $braceButton.classList.add("hidden");

  updateActionIcons(unit);

  if (unit.team === TEAM_BLUE && currentTurn === "player") {
    showMoveIndicators(unit);
    showAttackIndicators(unit);
    renderAbilityActions(unit);
  }

  updateChampionPanel();
  updateBattleStatus();
}

/* Show Shield / Sword / Bow icons for the selected blue fighter. */
function updateActionIcons(unit) {
  if (!$actionIcons) return;
  if (!unit || unit.team !== TEAM_BLUE || currentTurn !== "player") {
    $actionIcons.classList.add("hidden");
    return;
  }

  $actionIcons.classList.remove("hidden");

  const canBrace = canDefenceStand(unit);
  const canAct = !unit.hasMoved && !unit.hasAttacked;
  const canMelee = !!unit.melee && canAct;
  const canRanged = (!!unit.shot || !unit.melee) && canAct;

  if ($iconDefend) {
    $iconDefend.disabled = !canBrace;
    $iconDefend.classList.toggle("is-disabled", !canBrace);
    $iconDefend.classList.remove("is-armed");
  }
  if ($iconMelee) {
    const showMelee = !!unit.melee;
    $iconMelee.style.display = showMelee ? "" : "none";
    $iconMelee.disabled = !canMelee;
    $iconMelee.classList.toggle("is-disabled", !canMelee);
    $iconMelee.classList.remove("is-armed");
  }
  if ($iconRanged) {
    const showRanged = !!unit.shot || !unit.melee;
    $iconRanged.style.display = showRanged ? "" : "none";
    $iconRanged.disabled = !canRanged;
    $iconRanged.classList.toggle("is-disabled", !canRanged);
    $iconRanged.classList.remove("is-armed");
  }
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

/* Whether a cell holds a living fighter of one particular team. The screen
 * in front of a target is made of these. */
function isOccupiedByTeam(col, row, team) {
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team !== team) continue;
    if (u.col === col && u.row === row) return true;
  }
  return false;
}

/* 13.1 THE GROUND UNDER A PICTURE
 *
 * The champion is drawn across two columns, but it is still one fighter in
 * one cell. The picture, however, covers the ground of two cells, and a
 * fighter that walked onto that ground would be drawn on top of it: two
 * champions could end up standing in the same place at the same time.
 *
 * So the ground a picture stands on counts as taken. A fighter may only
 * move to a cell when its whole picture would lie on free ground, and no
 * other picture may lie on the ground it claims.
 *
 * The champion always reaches towards the enemy, but it never draws itself
 * off the edge of the field: at the last column it turns back inwards.
 */
function footprintDir(unit) {
  const dir = unit.footprintDir || 1;
  const span = unit.footprint && unit.footprint > 1 ? unit.footprint : 1;
  if (span <= 1) return dir;
  const next = unit.col + dir;
  if (next < 0 || next >= GRID_COLS) return -dir;
  return dir;
}

/* Every cell a fighter's picture is drawn on. */
function footprintCells(unit, col, row) {
  const anchorCol = col === undefined ? unit.col : col;
  const anchorRow = row === undefined ? unit.row : row;
  const span = unit.footprint && unit.footprint > 1 ? unit.footprint : 1;
  const dir = footprintDir(unit);
  const cells = [{ col: anchorCol, row: anchorRow }];
  for (let i = 1; i < span; i++) {
    cells.push({ col: anchorCol + i * dir, row: anchorRow });
  }
  return cells;
}

/* Whether the ground under (col,row) is claimed by another fighter, either
 * because the fighter stands on it or because it is drawn on it. */
function isGroundTaken(col, row, excludeId) {
  for (const [id, u] of units) {
    if (id === excludeId) continue;
    if (!u.alive || u.defeated) continue;
    for (const cell of footprintCells(u)) {
      if (cell.col === col && cell.row === row) return true;
    }
  }
  return false;
}

/* Whether a fighter could stand on (col,row) with its whole picture on
 * ground that is free. */
function canStandAt(unit, col, row) {
  if (!isInBounds(col, row)) return false;
  if (!isInsideDeploymentBoundary(unit, col)) return false;
  const dir = footprintDir(unit);
  const span = unit.footprint && unit.footprint > 1 ? unit.footprint : 1;
  for (let i = 0; i < span; i++) {
    if (isGroundTaken(col + i * dir, row, unit.id)) return false;
  }
  return true;
}

/* Every pair of fighters that are drawn on the same ground. The list is
 * empty when no two pictures overlap. */
function findGroundOverlaps() {
  const clashes = [];
  const living = [];
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    living.push(u);
  }
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = footprintCells(living[i]);
      const b = footprintCells(living[j]);
      for (const ca of a) {
        for (const cb of b) {
          if (ca.col === cb.col && ca.row === cb.row) {
            clashes.push({
              a: living[i].id,
              b: living[j].id,
              col: ca.col,
              row: ca.row
            });
          }
        }
      }
    }
  }
  return clashes;
}

/* A diagonal step is refused when both cells it would slip between are
 * blocked, whether by a rock formation or by another fighter. A line of
 * units therefore holds its ground, and a gap in a wall is a real gap. */
function canStepDiagonally(fromCol, fromRow, dc, dr, unitId) {
  const sideA = getTerrainAt(fromCol + dc, fromRow);
  const sideB = getTerrainAt(fromCol, fromRow + dr);
  const blockedA = !sideA.passable || isGroundTaken(fromCol + dc, fromRow, unitId);
  const blockedB = !sideB.passable || isGroundTaken(fromCol, fromRow + dr, unitId);
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
      if (!canStandAt(unit, nc, nr)) continue;
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
  if (!unit || unit.hasMoved || unit.hasAttacked) return false;
  if (!isInBounds(col, row)) return false;
  if (!canStandAt(unit, col, row)) return false;
  if (!isTerrainPassable(col, row)) return false;
  return getReachableCells(unit).some(c => c.col === col && c.row === row);
}

function moveUnit(unit, col, row) {
  if (!canMoveTo(unit, col, row)) return false;

  unit.col = col;
  unit.row = row;
  unit.hasMoved = true;
  /* One action only (v1.12.9): a march spends the activation — no blow after. */
  unit.hasAttacked = true;
  /* A fighter that walks is no longer standing its ground. */
  clearDefenceStand(unit);

  const el = unitElements.get(unit.id);
  if (el) {
    positionUnit(el, unit);
    el.classList.add("moving");
    later(() => el.classList.remove("moving"), MOVE_ANIM_MS);
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

/* 14.1 STRIKE CLASSES
 *
 * Every weapon in the game is either a bow or a blade, and the two obey
 * different laws on the field.
 *
 *   RANGED — the archer's bow, the ballista's bolt and the champion's own
 *     bow. A shot reaches EVERY living enemy on the field. Distance does not
 *     shorten it, a rank of fighters does not stop it, and neither does a
 *     forest or a rock formation. The only thing that can spoil a shot is
 *     the target being dead, gone or friendly. The number printed on the
 *     card is the weapon's own reach; the field does not enforce it.
 *
 *   MELEE — the footman's sword, the chevalier's lance and the champion's
 *     own weapon. A blade only cuts FORWARD, it reaches at most
 *     MELEE_REACH columns into the other army, and it needs a way in. The
 *     rank in front of a target no longer covers it, but a rank that closes
 *     every lane still holds: a fighter that cannot reach the target cannot
 *     cut it down. A gap in the front rank is a door into the second rank.
 *
 * The champion owns both weapons, so it swings a blade up close and looses
 * an arrow at everything else.
 */
/* Melee only from an adjacent cell (v1.12.2). A blade must be next to its
 * target — no more striking from two columns away. */
const MELEE_REACH = 1;

/* A bow covers the whole field. The number is kept as a named constant so
 * that the rule is stated once and read everywhere. */
const RANGED_REACH = Infinity;

/* Which way a team faces. Blue marches to the right, red to the left. */
function advanceSign(team) {
  return team === TEAM_BLUE ? 1 : -1;
}

/* The reach of a unit's own weapon at arm's length. Ground units have one,
 * shooters have none, and no blade ever reaches further than MELEE_REACH. */
function getMeleeReach(unit) {
  if (!unit || !unit.melee) return 0;
  return Math.min(unit.range || 0, MELEE_REACH);
}

/* The reach of a shot. Since v1.7.1 a bow covers the whole field, so this
 * is RANGED_REACH for every shooter and 0 for a fighter that fights with
 * its own hands. The nominal reach of a weapon is still in UNIT_STATS and
 * is printed on the card, but it never refuses a shot. */
function getRangedReach(unit) {
  if (!unit) return 0;
  if (unit.melee && !unit.shot) return 0;
  return RANGED_REACH;
}

/* How a reach is written on the card. */
function formatReach(reach) {
  if (reach === null || reach === undefined) return "--";
  if (!isFinite(reach)) return "FIELD";
  return String(reach);
}

/* The weapon a unit would use against a target: the blade up close, the bow
 * at a distance. Returns null when the target is out of reach entirely. */
function getStrikeKind(attacker, attackerPos, targetPos) {
  if (!attacker) return null;
  if (attacker.melee && meleeStrikeAllowed(attacker, attackerPos, targetPos)) return "melee";
  if (getRangedReach(attacker) > 0) return "ranged";
  return null;
}

/* The rows a fighter can use on its way to a target that stands two columns
 * away. A blade moves one column and at most one row at a time, so the
 * fighter in front can be straight ahead or one row to the side, as long as
 * the second step still reaches the target. */
function meleeApproachRows(attackerRow, targetRow) {
  const low = Math.max(attackerRow - 1, targetRow - 1);
  const high = Math.min(attackerRow + 1, targetRow + 1);
  const rows = [];
  for (let r = low; r <= high; r++) rows.push(r);
  return rows;
}

/* Whether the rank in front of a target covers it from the attacker.
 *
 * The answer is "yes" only when EVERY lane the attacker could walk is held
 * by a fighter of the other army. One open lane is a door, and one door is
 * enough. A target that stands in the front rank has nothing in front of
 * it and is never covered. */
function isShielded(attackerPos, targetPos, defenderTeam, attackerTeam) {
  if (!attackerPos || !targetPos) return false;
  if (!Number.isFinite(attackerPos.col) || !Number.isFinite(attackerPos.row)) return false;
  if (!Number.isFinite(targetPos.col) || !Number.isFinite(targetPos.row)) return false;
  const team = attackerTeam || (defenderTeam === TEAM_BLUE ? TEAM_RED : TEAM_BLUE);
  const forward = advanceSign(team);
  const step = (targetPos.col - attackerPos.col) * forward;
  /* Beside the attacker, behind it, or in the front rank: there is no rank
   * in between that could cover anything. */
  if (step <= 1) return false;
  const rows = meleeApproachRows(attackerPos.row, targetPos.row);
  if (rows.length === 0) return false;
  /* The walk is bounded by the field, so the loop can never run away. */
  const lastCol = targetPos.col;
  for (let col = attackerPos.col + forward; col !== lastCol; col += forward) {
    if (col < 0 || col >= GRID_COLS) return false;
    for (const row of rows) {
      if (!isOccupiedByTeam(col, row, defenderTeam)) return false;
    }
  }
  return true;
}

/* A blade only cuts forward, only into the front two ranks of the other
 * army, and only where the fighter can get to the target. */
function meleeStrikeAllowed(attacker, attackerPos, targetPos, defenderTeam) {
  if (!attacker || !attacker.melee) return false;
  const forward = advanceSign(attacker.team);
  const step = (targetPos.col - attackerPos.col) * forward;
  /* Never strike backwards: a fighter cannot turn its back on the enemy. */
  if (step < 0) return false;
  if (step > getMeleeReach(attacker)) return false;
  if (fieldDistance(attackerPos, targetPos) > getMeleeReach(attacker)) return false;
  const team = defenderTeam || (attacker.team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE);
  return !isShielded(attackerPos, targetPos, team, attacker.team);
}

/* Chevalier and champion may charge: close from any distance to an open
 * adjacent cell, then strike (v1.12.6). */
function isChargeMelee(unit) {
  return !!(unit && unit.melee && (unit.type === "chevalier" || unit.type === "champion"));
}

function getAdjacentCells(col, row) {
  const cells = [];
  for (const [dc, dr] of MOVE_DIRECTIONS) {
    const c = col + dc;
    const r = row + dr;
    if (isInBounds(c, r)) cells.push({ col: c, row: r });
  }
  return cells;
}

/* A charge may cover any distance (v1.12.6), but it is still a march: the
 * fighter has to WALK there. This is the list of cells the unit can reach on
 * foot, counted in steps, using exactly the rules of an ordinary move:
 * passable ground, no fighter in the way, and the corner rule for diagonal
 * steps. Only the movement budget is lifted. A wall of fighters or rocks
 * with no gap therefore stops a charge (v1.12.10; before, the unit was set
 * down beside the target without any route). Set CHARGE_MAX_STEPS to a
 * number to limit how far a charge may run. */
const CHARGE_MAX_STEPS = Infinity;

function getChargeSteps(unit) {
  const steps = new Map([[`${unit.col},${unit.row}`, 0]]);
  const queue = [{ col: unit.col, row: unit.row }];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = steps.get(`${cur.col},${cur.row}`);
    if (d >= CHARGE_MAX_STEPS) continue;
    for (const [dc, dr] of MOVE_DIRECTIONS) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      if (!isInBounds(nc, nr)) continue;
      const key = `${nc},${nr}`;
      if (steps.has(key)) continue;
      if (!isTerrainPassable(nc, nr)) continue;
      if (!canStandAt(unit, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && !canStepDiagonally(cur.col, cur.row, dc, dr, unit.id)) continue;
      steps.set(key, d + 1);
      queue.push({ col: nc, row: nr });
    }
  }
  return steps;
}

/* Nearest cell beside the target that this attacker can WALK to and strike
 * from. Returns null when the target is already in reach, or when no route
 * leads to a cell from which the blade may cut (blocked lanes, or only
 * cells behind the target: a blade never cuts backwards). */
function findMeleeApproachCell(attacker, target) {
  if (!attacker || !target) return null;
  if (meleeStrikeAllowed(attacker, attacker, target)) return null;

  const steps = getChargeSteps(attacker);
  const candidates = [];
  for (const cell of getAdjacentCells(target.col, target.row)) {
    const walk = steps.get(`${cell.col},${cell.row}`);
    if (walk === undefined || walk === 0) continue;
    if (!meleeStrikeAllowed(attacker, cell, target)) continue;
    candidates.push({ col: cell.col, row: cell.row, walk });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.walk - b.walk || a.row - b.row || a.col - b.col);
  return { col: candidates[0].col, row: candidates[0].row };
}

function canChargeMelee(attacker, target) {
  if (!isChargeMelee(attacker)) return false;
  if (!target || !target.alive || target.defeated) return false;
  if (attacker.team === target.team) return false;
  if (meleeStrikeAllowed(attacker, attacker, target)) return true;
  return !!findMeleeApproachCell(attacker, target);
}

/* Reach in one answer. A shot reaches the whole field; a blow has to get
 * there on its own feet. */
function hasReach(attacker, attackerPos, targetPos, defenderTeam) {
  const kind = getStrikeKind(attacker, attackerPos, targetPos);
  if (kind === "ranged") return true;
  if (kind === "melee") return meleeStrikeAllowed(attacker, attackerPos, targetPos, defenderTeam);
  return false;
}

/* The same answer without the target's team, used when the AI asks what a
 * unit could reach rather than what it may shoot at. */
function canReach(attacker, attackerPos, targetPos, defenderTeam) {
  const kind = getStrikeKind(attacker, attackerPos, targetPos);
  if (kind === "ranged") return true;
  if (kind === "melee") return meleeStrikeAllowed(attacker, attackerPos, targetPos, defenderTeam);
  return false;
}

/* The force of the blow that lands on the target. */
function attackValue(attacker, attackerPos, targetPos) {
  const kind = getStrikeKind(attacker, attackerPos, targetPos);
  if (kind === "ranged" && attacker.shot) return attacker.shot.atk;
  return attacker.atk;
}

function getValidTargets(unit, from) {
  const pos = from || unit;
  const targets = [];
  for (const [, u] of units) {
    if (!u.alive || u.defeated) continue;
    if (u.team === unit.team) continue;
    if (hasReach(unit, pos, u)) {
      targets.push(u);
      continue;
    }
    /* Charge units may approach from anywhere if a free cell exists. */
    if (isChargeMelee(unit) && !from && canChargeMelee(unit, u)) {
      targets.push(u);
    }
  }
  return targets;
}

function canAttack(attacker, target) {
  if (!attacker || !target) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!target.alive || target.defeated) return false;
  /* A fighter that is not on the field is not a target. */
  if (!units.has(target.id)) return false;
  if (attacker.team === target.team) return false;
  if (attacker.hasAttacked) return false;
  /* One action only (v1.12.9): a march spends the activation — no blow after. */
  if (attacker.hasMoved) return false;
  if (hasReach(attacker, attacker, target)) return true;
  if (canChargeMelee(attacker, target)) return true;
  return false;
}

/* Counts an action that was really carried out. The report and the balance
 * harness read these numbers, so they are counted where the action happens
 * and never guessed afterwards. */
function recordAction(kind, team) {
  if (!battleLedger || !battleLedger.actions) return;
  const side = battleLedger.actions[team];
  if (!side || side[kind] === undefined) return;
  side[kind] += 1;
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
  /* High ground helps a shot, never a blow: the aim belongs to the weapon
   * that is loosed at a distance. */
  const strike = getStrikeKind(attacker, attackerPos, defenderPos);
  const aimBonus = (opts.useTerrainAim === false || strike !== "ranged")
    ? 0
    : getTerrainAimBonus(attackerPos);

  let raw = attackValue(attacker, attackerPos, defenderPos) + atkBonus + aimBonus
    - Math.floor((defender.def + defBonus) / 2);

  /* In sudden death every blow counts for more, for both armies alike, so a
   * fight that reached the round limit still ends in a decision. */
  if (suddenDeathActive) {
    raw = Math.round(raw * SUDDEN_DEATH_DAMAGE_MULTIPLIER);
  }

  /* Damage scatter is off unless the balance harness turns it on, so the
   * ordinary game keeps its exact numbers. */
  if (combatVariance > 0) {
    raw = Math.round(raw * (1 + (nextRandom() * 2 - 1) * combatVariance));
  }

  /* The armour of the defender turns a share of the blow away. The share is
   * the last word on the damage: what is left is what the fighter feels. */
  raw = raw * (1 - getUnitArmour(defender));

  return Math.max(1, Math.round(raw));
}

/* The share of every blow that the armour of a fighter turns away. */
function getUnitArmour(unit) {
  if (!unit) return 0;
  const value = Number(unit.armour);
  const base = Number.isFinite(value) && value > 0 ? value : 0;
  /* A fighter that makes a defence stand braces behind its shield, and the
   * stance adds to the armour it already carries. */
  const bonus = unit.braced ? DEFENCE_STAND_ARMOUR : 0;
  return Math.min(0.9, base + bonus);
}

/* 15.2 THE RIPOSTE
 *
 * A fighter that is hit by a blade answers with a blade of its own, at
 * once, without waiting for its turn. The answer costs the fighter its
 * blow for that round: it has already struck, and it does not strike
 * twice. A fighter that cannot reach the attacker with its own weapon, or
 * that has already attacked this round, keeps its blow to itself.
 */
function canRiposte(defender, attacker) {
  if (!defender || !attacker) return false;
  if (!defender.alive || defender.defeated) return false;
  if (!attacker.alive || attacker.defeated) return false;
  if (!defender.melee) return false;
  /* Once per round only (v1.12.3). */
  if (defender.hasRipostedThisRound) return false;
  /* Only a blow of the hand is answered with a blow of the hand. */
  if (getStrikeKind(attacker, attacker, defender) !== "melee") return false;
  return meleeStrikeAllowed(defender, defender, attacker);
}

/* The answer of a fighter that has been hit by a blade.
 * Once per round, at −25% damage (v1.12.3). */
function riposteAgainst(defender, attacker) {
  if (!canRiposte(defender, attacker)) return false;

  const raw = calculateDamage(defender, attacker, {
    attackerPos: defender,
    defenderPos: attacker
  });
  const damage = Math.max(1, Math.round(raw * RIPOSTE_DAMAGE_FACTOR));
  defender.hasRipostedThisRound = true;
  /* Spending the blow keeps the old “already struck” rule for the turn. */
  defender.hasAttacked = true;
  applyDamage(attacker.id, damage, { countDamage: true, team: defender.team });
  recordAction("riposte", defender.team);

  logEvent(
    `${defender.displayName} ripostes against ${attacker.displayName} for ${damage} damage (−25%).`,
    defender.team === TEAM_BLUE ? "player" : "ai"
  );

  const el = unitElements.get(defender.id);
  if (el) {
    el.classList.add("attacking");
    later(() => el.classList.remove("attacking"), ATTACK_ANIM_MS);
  }
  if (!attacker.alive || attacker.defeated) {
    logEvent(`${attacker.displayName} is defeated.`, "system");
  }
  return true;
}

/* 15.3 THE DEFENCE STAND
 *
 * A fighter that makes a defence stand gives up its action and braces
 * behind its shield: while it stands, its armour is twenty points higher.
 * The stance lasts until the fighter acts again, so a unit that braces and
 * then strikes is an ordinary fighter once more.
 */
function canDefenceStand(unit) {
  if (!unit || !unit.alive || unit.defeated) return false;
  if (unit.hasMoved || unit.hasAttacked) return false;
  if (unit.braced) return false;
  return true;
}

/* Braces a fighter behind its shield. The action is spent: a fighter that
 * braces does not also walk or strike. */
function makeDefenceStand(unit) {
  if (!canDefenceStand(unit)) return false;
  unit.braced = true;
  unit.hasMoved = true;
  unit.hasAttacked = true;

  const el = unitElements.get(unit.id);
  if (el) el.classList.add("braced");

  logEvent(
    `${unit.displayName} makes a defence stand — its armour rises by ${Math.round(DEFENCE_STAND_ARMOUR * 100)}%.`,
    unit.team === TEAM_BLUE ? "player" : "ai"
  );
  return true;
}

/* The stance ends when the fighter acts again. */
function clearDefenceStand(unit) {
  if (!unit || !unit.braced) return;
  unit.braced = false;
  const el = unitElements.get(unit.id);
  if (el) el.classList.remove("braced");
}

/* 15.1 DAMAGE NUMBERS
 *
 * A blow reads better when the number is shown on the field itself and not
 * only in the log. The number is purely visual: it never touches the rules,
 * it never touches the ledger, and it takes itself away again.
 */

/* How long the red aura and the shudder of a fighter that has been hit
 * last. */
const HIT_FLASH_MS = 1400;

/* Combat animation pacing (v1.12.4). Melee and ranged both ~1.2 s total:
 *   melee  — wind-up → lunge/strike
 *   ranged — draw → release + arrow flight
 */
const ATTACK_ANIM_MS = 1200;
const MELEE_WINDUP_MS = 400;
const RANGED_DRAW_MS = 400;
const RANGED_FLIGHT_MS = 800;
const MOVE_ANIM_MS = 1200;
/* Riposte deals this share of normal damage (once per round). */
const RIPOSTE_DAMAGE_FACTOR = 0.75;

/* A device that can buzz is told about every blow, so the hit can be felt
 * as well as seen. Devices that cannot buzz are left alone. */
function vibrateOnHit() {
  if (typeof navigator === "undefined") return;
  if (!navigator || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(HIT_FLASH_MS);
  } catch (err) {
    /* A device that refuses to buzz is not a reason to stop the fight. */
  }
}
function showDamagePop(targetId, amount, kind) {
  const el = unitElements.get(targetId);
  if (!el) return;
  const pop = document.createElement("div");
  pop.className = kind === "kill" ? "damage-pop damage-pop-kill" : "damage-pop";
  pop.textContent = String(amount);
  el.appendChild(pop);
  later(() => {
    if (pop.parentNode) pop.parentNode.removeChild(pop);
  }, 900);
}

function applyDamage(targetId, amount, options) {
  const opts = options || {};
  const target = units.get(targetId);
  if (!target || !target.alive || target.defeated) return 0;

  const hpBefore = target.hp;
  target.hp = Math.max(0, target.hp - amount);
  const dealt = hpBefore - target.hp;

  /* The number of the blow, shown on the field. */
  if (dealt > 0) showDamagePop(targetId, dealt, target.hp <= 0 ? "kill" : "hit");

  /* Only a real blow counts towards the damage reward, and only the health
   * that actually left the target counts: overkill is never rewarded. */
  if (opts.countDamage) recordDamage(opts.team || target.team, dealt);

  const el = unitElements.get(targetId);
  if (el) {
    updateUnitHealthBar(el, target);
    /* The fighter that took the blow glows red and shudders for a second,
     * so the hit is felt and not only counted. */
    el.classList.remove("damaged");
    void el.offsetWidth;
    el.classList.add("damaged");
    later(() => el.classList.remove("damaged"), HIT_FLASH_MS);
  }
  vibrateOnHit();
  playHit();

  if (target.hp <= 0) {
    target.alive = false;
    target.defeated = true;
    target.effects = [];
    if (el) {
      el.classList.add("defeated");
      el.style.pointerEvents = "none";
    }
    const overlay = unitOverlays.get(target.id);
    if (overlay) overlay.classList.add("defeated");
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

/* Whether an offensive ability may be aimed at a target. A melee blow obeys
 * the same law as every other blade: it only cuts forward, and it never
 * cuts through a living shield. */
function canAbilityReachTarget(unit, ability, target) {
  if (!target) return false;
  if (!target.alive || target.defeated) return false;
  if (target.team === unit.team) return false;
  if (fieldDistance(unit, target) > ability.range) return false;
  if (!hasLineOfSight(unit, target, ability.range)) return false;
  if (ability.melee && !meleeStrikeAllowed(unit, unit, target)) return false;
  return true;
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
    if (!canAbilityReachTarget(unit, ability, units.get(targetId))) return false;
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
    if (!canAbilityReachTarget(unit, ability, units.get(targetId))) return false;
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
  /* A spectator battle is a show, not a fight the player took part in, so
   * it pays nothing. The gate sits here, in the one place every reward
   * passes through. */
  if (battleMode === "spectator") return 0;
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

/* Starts a battle.
 *
 * options.mode "player" (the default) hands the blue legion to the player.
 * options.mode "spectator" hands both armies to the AI and takes every
 * reward off the table, so a watched battle can never touch the profile.
 * options.opener names the legion that opens the match; it opens the odd
 * rounds of that match and the other legion opens the even ones. */
function startBattle(options) {
  const opts = options || {};
  const mode = opts.mode === "spectator" ? "spectator" : "player";

  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  actionLock = false;
  currentBattleToken = ++battleToken;
  battleId += 1;
  battleFinalized = false;

  setBattleMode(mode);

  /* Whoever opens the match takes the first round. */
  matchOpener = opts.opener || (duel.active ? duel.opener : TEAM_BLUE);

  battleActive = true;
  currentTurn = mode === "spectator" ? TEAM_BLUE : "player";
  gameState = mode === "spectator" ? STATE_ENEMY_TURN : STATE_PLAYER_SELECTING;
  roundNumber = 1;
  selectedUnitId = null;
  pendingAbilityId = null;
  suddenDeathActive = false;
  updateActionButtons();

  $modeButton.disabled = true;
  $battleResult.classList.add("hidden");
  hideBattleReport();
  $turnBanner.classList.remove("hidden");
  updateEndTurnButton();
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $combatLog.innerHTML = "";

  resetActionFlags();
  resetAbilityUses();
  battleLedger = createBattleLedger();
  battleLedger.mapId = getActiveMapId();
  battleLedger.difficultyId = mode === "spectator" ? DEFAULT_DIFFICULTY_ID : getDifficultyId();
  battleLedger.seed = randomSeed;
  battleLedger.levelBefore = progression.level;
  battleLedger.levelAfter = progression.level;
  battleLedger.spectator = mode === "spectator";
  /* The champion's permanent bonuses belong to the player. A spectator
   * battle is fought at base strength on both sides. */
  if (mode !== "spectator") applyChampionProgression(getPlayerChampion());
  refreshAllHealthBars();
  updateTurnBanner();
  updateBattleStatus();
  updateProgressionUI();
  updateChampionPanel();

  if (mode === "spectator") {
    spectatorTurnTeam = matchOpener;
    logEvent("The legions clash. You are watching, not fighting.", "system");
    logEvent(`${teamName(matchOpener)} opens match ${duel.active ? duel.matchNumber : 1}.`, "system");
    runSpectatorTurn(matchOpener);
    return;
  }

  logEvent("The battle begins!", "system");
  logEvent(`${teamName(matchOpener)} opens the match.`, "system");

  /* A match that the crimson legion opens is started by the crimson
   * legion: the azure legion answers the first round. */
  if (matchOpener === TEAM_RED) {
    beginEnemyTurn("The crimson legion opens the match.");
  } else if (getTurnModeId() === "troop") {
    autoSelectNextTroopUnit(TEAM_BLUE);
  } else {
    showPreviewMoveIndicators();
  }
}

/* Switches the battle mode and puts the interface into the matching state. */
function setBattleMode(mode) {
  battleMode = mode === "spectator" ? "spectator" : "player";
  spectatorActive = battleMode === "spectator";
  spectatorAutoAdvance = true;
  if ($progressionStrip) {
    $progressionStrip.classList.toggle("spectating", spectatorActive);
  }
  if (document && document.body) {
    document.body.classList.toggle("spectating", spectatorActive);
  }
}

/* Starts a spectator battle: the AI fights the AI and the fight pays
 * nothing at all. A show is a duel like any other: up to three matches,
 * won by the legion that takes two of them. */
function startSpectatorBattle(options) {
  const opts = options || {};
  return startDuel(Object.assign({}, opts, { mode: "spectator" }));
}

/* Action flags reset every round; ability uses are per battle. */
function resetActionFlags() {
  units.forEach(u => {
    u.hasMoved = false;
    u.hasAttacked = false;
    u.hasRipostedThisRound = false;
    u.hasActedThisRound = false;
  });
}

/* Troop mode (HoMM-style): a fighter spends its whole activation on one
 * action — move OR attack OR defence stand — then sits out until the next
 * combat round. */
function markTroopActed(unit) {
  if (!unit) return;
  unit.hasMoved = true;
  unit.hasAttacked = true;
  unit.hasActedThisRound = true;
}

function unitCanActThisRound(unit) {
  if (!unit || !unit.alive || unit.defeated) return false;
  if (getTurnModeId() === "troop") return !unit.hasActedThisRound;
  /* Party mode also uses one action only (v1.12.9). */
  return !unit.hasMoved && !unit.hasAttacked;
}

function teamHasActors(team) {
  for (const [, u] of units) {
    if (u.team !== team) continue;
    if (unitCanActThisRound(u)) return true;
  }
  return false;
}

function allUnitsActedThisRound() {
  return !teamHasActors(TEAM_BLUE) && !teamHasActors(TEAM_RED);
}

function resetAbilityUses() {
  units.forEach(u => { u.abilityUses = {}; });
}

function endPlayerTurn() {
  if (currentTurn !== "player") return;
  clearSelection();

  /* Troop mode: one unit acted. Keep the combat round open until every
   * living fighter has had its activation (v1.12.5). */
  if (getTurnModeId() === "troop") {
    if (allUnitsActedThisRound()) {
      if (closeRound()) return;
      startNextRound();
      return;
    }
    if (teamHasActors(TEAM_RED)) {
      currentTurn = "enemy";
      updateTurnBanner();
      $endTurnButton.disabled = true;
      logEvent("Crimson Legion answers...", "ai");
      runEnemyTurn();
      return;
    }
    /* Only azure fighters still have activations left. */
    beginPlayerTurn();
    return;
  }

  if (roundLeader() === TEAM_RED) {
    /* Party mode: crimson opened; azure has answered → round over. */
    if (closeRound()) return;
    startNextRound();
    return;
  }

  currentTurn = "enemy";
  updateTurnBanner();
  $endTurnButton.disabled = true;
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
  let list = ids
    .map(id => units.get(id))
    .filter(u => u && u.alive && !u.defeated);
  /* Troop mode: only fighters that have not yet acted this combat round. */
  if (getTurnModeId() === "troop") {
    list = list.filter(u => !u.hasActedThisRound);
  }
  return list.sort((a, b) => {
    if (a.col !== b.col) return (a.col - b.col) * direction;
    if (a.row !== b.row) return a.row - b.row;
    return a.id.localeCompare(b.id);
  });
}

function targetValue(unit) {
  return AI_TUNING.targetValue[unit.type] !== undefined ? AI_TUNING.targetValue[unit.type] : 6;
}

/* Every blow that a fighter standing on a cell would earn back, one entry
 * per enemy that can reach the cell. */
function incomingAnswers(col, row, team, defenderDef) {
  const answers = [];
  for (const [, enemy] of units) {
    if (!enemy.alive || enemy.defeated || enemy.team === team) continue;
    if (!canReach(enemy, enemy, { col, row })) continue;
    const weight = getRangedReach(enemy) > 1 ? 1 : 0.7;
    const attack = attackValue(enemy, enemy, { col, row }) + getUnitAtkBonus(enemy);
    answers.push(weight * Math.max(1, attack - Math.floor(defenderDef / 2)));
  }
  return answers;
}

/* How much damage a unit standing on a cell would take. */
function estimateIncomingDamage(col, row, team, defenderDef) {
  let total = 0;
  for (const answer of incomingAnswers(col, row, team, defenderDef)) total += answer;
  return total;
}

/* The answer a blow would earn back.
 *
 * Since v1.7.1 a bow covers the whole field, so every enemy can answer
 * every blow. Counting all of them would make the whole army stand still:
 * the answer would always be worth more than the blow. A fighter is
 * answered by the one or two enemies that can reach it, not by the whole
 * enemy army, so only the strongest answers are counted.
 */
function estimateRetaliation(col, row, team, defenderDef) {
  const answers = incomingAnswers(col, row, team, defenderDef);
  answers.sort((a, b) => b - a);
  let total = 0;
  const counted = Math.min(answers.length, AI_TUNING.retaliationAnswers);
  for (let i = 0; i < counted; i++) total += answers[i];
  return total;
}

/* Whether a unit is soft: the champion, or a fighter that is already badly
 * hurt. A shooter is no longer soft: since v1.7.1 its bow reaches the whole
 * field, so it answers back from anywhere. */
function isVulnerableUnit(unit) {
  if (!unit || !unit.alive || unit.defeated) return false;
  if (unit.type === "champion") return true;
  return unit.hp <= unit.maxHp * 0.5;
}

/* How much danger a target carries for the side that wants it gone. A unit
 * that can reach a soft ally is worth more than its bare type value, and a
 * unit that can reach nothing is worth nothing at all. */
function targetDanger(target, viewerTeam) {
  if (!target || !target.alive || target.defeated) return 0;
  let danger = 0;
  for (const [, ally] of units) {
    if (!ally.alive || ally.defeated) continue;
    if (ally.team !== viewerTeam) continue;
    if (ally.id === target.id) continue;
    if (!canReach(target, target, { col: ally.col, row: ally.row })) continue;
    const weight = isVulnerableUnit(ally)
      ? AI_TUNING.vulnerableDangerWeight
      : AI_TUNING.ordinaryDangerWeight;
    danger += weight * attackValue(target, target, { col: ally.col, row: ally.row });
  }
  return danger;
}

function evaluateAttackAction(attacker, target, attackerPos) {
  const pos = attackerPos || attacker;
  const profile = profileForTeam(attacker.team);
  const depth = tacticalDepth(attacker.team);
  const damage = calculateDamage(attacker, target, { attackerPos: pos });
  const lethal = damage >= target.hp;

  /* 1. The blow itself. */
  let score = damage * AI_TUNING.damageWeight * profile.tradeAppetite;

  /* 2. The unit that falls. */
  if (lethal) {
    score += AI_TUNING.killBonus + targetValue(target);
    score += depth.elimination * AI_TUNING.lethalCredit;
  }

  /* 3. Finishing a unit that is already hurt. */
  if (target.hp <= target.maxHp * 0.5) score += AI_TUNING.finishBonus;

  /* 4. The ground the blow is struck from. */
  score += getTerrainAimBonus(pos);

  /* 5. A sharper opponent goes after the banner carrier. */
  if (profile.championFocus && target.type === "champion") {
    score += profile.championFocus;
  }

  /* 6. The danger the target carries and the share of it this blow takes off
   *    the table. A blow that ends the target removes all of it. */
  if (depth.danger > 0) {
    const share = lethal ? 1 : damage / Math.max(1, target.hp + damage);
    score += depth.danger * AI_TUNING.dangerWeight * targetDanger(target, attacker.team) * share;
  }

  /* 7. Trading blows is a real cost. */
  const retaliation = estimateRetaliation(pos.col, pos.row, attacker.team, attacker.def);
  score -= retaliation * AI_TUNING.retaliationWeight * profile.caution;

  /* 8. Survival. The blow the target lands back decides whether the
   *    attacker lives through the exchange. A target that falls cannot land
   *    it, so a killing blow is never a suicide. */
  if (depth.survival > 0 && !lethal) {
    const counter = calculateDamage(target, attacker, { attackerPos: target, defenderPos: pos });
    if (attacker.hp - counter <= 0) {
      score -= depth.survival * AI_TUNING.suicidalPenalty;
    }
  }

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

function evaluateMoveAction(unit, cell, currentAttack, follow) {
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

  if (getMeleeReach(unit) > 0 && advance > 0) {
    score += Math.min(advance, 2) * AI_TUNING.meleeAdvanceBonus * profile.aggression;
  }

  /* A unit that can loose an arrow likes the high ground. */
  const shootRange = getRangedReach(unit);
  if (shootRange > 1 && terrain.aim > 0) {
    score += terrain.aim * AI_TUNING.elevationWeight;
  }

  /* The champion is a standard-bearer as much as a fighter, so it prefers a
   * cell that still reaches its own ranks. Without this the bow would let
   * it wander off alone and leave the army it is meant to rally. */
  if (unit.type === "champion") {
    score += countAlliesNear(unit, cell, AI_TUNING.championAllyRadius) * AI_TUNING.championAllyProximity;
  }

  /* Walking has to be worth something. When the unit can already strike and
   * the new cell opens nothing better, the walk is a wasted step. A step
   * that makes the unit safer is never a waste. */
  const depth = tacticalDepth(unit.team);
  if (depth.waste > 0 && currentAttack) {
    const next = follow || null;
    const safer = nextThreat < currentThreat;
    if (!safer && (!next || next.score <= currentAttack.score)) {
      score -= depth.waste * AI_TUNING.wastedMovePenalty;
    }
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
    if (!best || score > best.score) {
      const damage = calculateDamage(unit, target, { attackerPos: cell });
      best = { target, score, lethal: damage >= target.hp };
    }
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

  /* One action only (v1.12.9): attack OR move, never both in one activation. */
  if (!unit.hasMoved && !unit.hasAttacked) {
    for (const target of getValidTargets(unit)) {
      actions.push({ kind: "attack", unit, target });
    }
    for (const cell of getReachableCells(unit)) {
      actions.push({ kind: "move", unit, cell });
    }
  }

  if (unit.type === "champion") {
    for (const id of unit.abilities || []) {
      if (id === "rally") continue;
      const ability = ABILITIES[id];
      if (!ability) continue;
      if (!isAbilityUnlocked(id)) continue;
      if (getAbilityUses(unit, id) >= ability.usesPerBattle) continue;
      if (ability.actionCost === "attack" && unit.hasAttacked) continue;
      if (ability.actionCost === "turn" && (unit.hasAttacked || unit.hasMoved)) continue;

      if (ability.type === "offensive") {
        for (const target of getValidTargets(unit)) {
          if (!canAbilityReachTarget(unit, ability, target)) continue;
          actions.push({ kind: "ability", unit, ability, target });
        }
      } else {
        actions.push({ kind: "ability", unit, ability, target: null });
      }
    }
  }

  /* The defence stand: give up the action, gain armour. */
  if (canDefenceStand(unit)) {
    actions.push({ kind: "brace", unit });
  }
  return actions;
}

/* Deterministic tie break so the same state always yields the same plan. */
function actionKey(action) {
  if (action.kind === "attack") return `attack:${action.target.id}`;
  if (action.kind === "move") return `move:${action.cell.col},${action.cell.row}`;
  if (action.kind === "brace") return "brace";
  if (action.kind === "ability") {
    return `ability:${action.ability.id}:${action.target ? action.target.id : "-"}`;
  }
  return action.kind;
}

/* What the defence stand is worth to a fighter.
 *
 * The armour that is gained is worth the blows it keeps off the fighter:
 * a fifth of everything that is aimed at it while it stands. A fighter
 * that stands in the open with nothing aimed at it gains nothing, so the
 * AI only braces when it is really under the weather. */
function evaluateBraceAction(unit) {
  const incoming = estimateIncomingDamage(unit.col, unit.row, unit.team, unit.def);
  if (incoming <= 0) return -1;
  return incoming * DEFENCE_STAND_ARMOUR * AI_TUNING.damageWeight;
}

function evaluateAction(action, currentAttack) {
  let score = 0;
  if (action.kind === "attack") {
    score = AI_TUNING.actNowBonus + evaluateAttackAction(action.unit, action.target);
  } else if (action.kind === "move") {
    const follow = bestAttackFrom(action.unit, action.cell);
    score = evaluateMoveAction(action.unit, action.cell, currentAttack, follow);
    if (follow) score += follow.score;
    /* A cell from which the next blow would end a unit is worth more than
     * a cell that only looks closer. */
    const depth = tacticalDepth(action.unit.team);
    if (follow && follow.lethal) score += depth.position * AI_TUNING.positionalLethalCredit;
  } else if (action.kind === "ability") {
    score = evaluateAbilityAction(action.unit, action.ability, action.target);
  } else if (action.kind === "brace") {
    score = evaluateBraceAction(action.unit);
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
  const depth = tacticalDepth(unit.team);
  /* The best blow available from where the unit stands, worked out once for
   * the whole turn so that every candidate step can be compared against it. */
  const currentAttack = depth.waste > 0 ? bestAttackFrom(unit, unit) : null;
  let best = null;
  for (const action of actions) {
    const score = evaluateAction(action, currentAttack);
    if (score < AI_TUNING.minActionScore) continue;
    if (!best || score > best.score || (score === best.score && actionKey(action) < actionKey(best.action))) {
      best = { action, score };
    }
  }
  return best ? best.action : null;
}

/* Hands a turn to the tactical AI. The player never drives a team through
 * this path: the enemy does, and so does the other legion in a spectator
 * battle. Both are played by exactly the same brain, under exactly the
 * same rules. */
function runAiTurn(team) {
  gameState = STATE_ENEMY_TURN;
  $turnBanner.classList.add("ai-turn-active");
  $battlefield.classList.toggle("ai-turn-active", team !== TEAM_BLUE);
  $battlefield.classList.toggle("ai-turn-blue-active", team === TEAM_BLUE);

  aiTurnTeam = team;
  aiTurnOwnsRound = true;
  aiActionQueue = buildActionQueue(team);
  aiActionIndex = 0;

  if (aiActionQueue.length === 0) {
    finishEnemyTurn();
    return;
  }
  executeNextEnemyAction();
}

function runEnemyTurn() {
  runAiTurn(TEAM_RED);
}

/* Hands the next turn of a spectator battle to the AI. The player only
 * watches. */
function runSpectatorTurn(team) {
  if (!battleActive || gameState === STATE_ENDED) return;
  spectatorTurnTeam = team;
  currentTurn = team;
  updateTurnBanner();
  updateBattleStatus();
  runAiTurn(team);
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
    advanceAiTurn();
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
  if (action.kind === "brace") {
    performAiBrace(unit);
    return;
  }
  performAiMove(unit, action.cell);
}

/* Hands the AI turn over after exactly one unit action when the fight is in
 * troop mode (one fighter acts at a time), and keeps chaining units in party
 * mode (the whole legion plays its turn). Instant turns ignore the mode so
 * the balance harness and suites still resolve a whole legion in one step. */
function advanceAiTurn() {
  if (instantTimers) {
    executeNextEnemyAction();
    return;
  }
  if (getTurnModeId() === "troop") {
    finishEnemyTurn();
  } else {
    executeNextEnemyAction();
  }
}

/* The AI braces: it gives up its action and its armour goes up. */
function performAiBrace(unit) {
  makeDefenceStand(unit);
  if (getTurnModeId() === "troop") markTroopActed(unit);
  later(() => {
    advanceAiTurn();
  }, aiTiming().gap);
}

function performAiMove(unit, destination) {
  if (!canMoveTo(unit, destination.col, destination.row)) {
    advanceAiTurn();
    return;
  }
  const from = { col: unit.col, row: unit.row };
  unit.col = destination.col;
  unit.row = destination.row;
  unit.hasMoved = true;
  /* One action only — march spends the activation (v1.12.9). */
  unit.hasAttacked = true;
  if (getTurnModeId() === "troop") markTroopActed(unit);
  /* Remember where the unit came from so it cannot shuffle back and forth. */
  unit.lastAiCell = from;
  recordAction("move", unit.team);

  const el = unitElements.get(unit.id);
  if (el) {
    positionUnit(el, unit);
    el.classList.add("moving");
    later(() => el.classList.remove("moving"), MOVE_ANIM_MS);
  }

  logEvent(`${unit.displayName} advances to (${destination.col},${destination.row}).`, "ai");

  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (!unit.alive || unit.defeated) {
      advanceAiTurn();
      return;
    }
    continueAiAction(unit);
  }, aiTiming().move);
}

/* After an action that did not consume the whole turn, the unit may still
 * have something worth doing. */
function continueAiAction(unit) {
  if (battleToken !== currentBattleToken) return;
  /* In troop mode the move that just arrived is the one action this fighter
   * gets: hand the turn over at once. */
  if (getTurnModeId() === "troop") {
    advanceAiTurn();
    return;
  }
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
  const kind = getAttackKind(unit, target);
  const isRanged = kind === "ranged";
  const animMs = isRanged ? RANGED_FLIGHT_MS : ATTACK_ANIM_MS;

  unit.hasAttacked = true;
  /* A blow ends the march — cannot walk after striking (v1.12.7). */
  unit.hasMoved = true;
  if (getTurnModeId() === "troop") markTroopActed(unit);
  clearDefenceStand(unit);

  const resolveAiBlow = () => {
    if (battleToken !== currentBattleToken) return;
    if (attackerEl) {
      attackerEl.classList.remove("attacking");
      attackerEl.classList.remove("shooting");
      attackerEl.classList.remove("windup");
      attackerEl.classList.remove("drawing");
    }

    const damage = calculateDamage(unit, target);
    applyDamage(target.id, damage, { countDamage: true, team: unit.team });
    recordAction("attack", unit.team);

    logEvent(`${unit.displayName} attacks ${target.displayName} for ${damage} damage.`, "ai");

    riposteAgainst(target, unit);

    if (!target.alive || target.defeated) {
      logEvent(`${target.displayName} is defeated.`, "system");
    }

    if (checkBattleEnd()) return;

    later(() => {
      advanceAiTurn();
    }, aiTiming().gap);
  };

  const playAiMeleeStrike = () => {
    if (battleToken !== currentBattleToken) return;
    if (attackerEl) attackerEl.classList.add("windup");
    later(() => {
      if (battleToken !== currentBattleToken) return;
      if (attackerEl) {
        attackerEl.classList.remove("windup");
        attackerEl.classList.add("attacking");
      }
      later(resolveAiBlow, ATTACK_ANIM_MS - MELEE_WINDUP_MS);
    }, MELEE_WINDUP_MS);
  };

  if (isRanged) {
    /* Same two-phase ranged as the player: draw, then release + flight. */
    if (attackerEl) attackerEl.classList.add("drawing");
    later(() => {
      if (battleToken !== currentBattleToken) return;
      if (attackerEl) {
        attackerEl.classList.remove("drawing");
        attackerEl.classList.add("shooting");
      }
      spawnProjectile(unit, target, unit.type === "ballista" ? "bolt" : "arrow");
      later(resolveAiBlow, RANGED_FLIGHT_MS);
    }, RANGED_DRAW_MS);
  } else {
    const approach = isChargeMelee(unit) && !meleeStrikeAllowed(unit, unit, target)
      ? findMeleeApproachCell(unit, target)
      : null;
    if (approach) {
      animateChargeTo(unit, approach, playAiMeleeStrike);
    } else {
      playAiMeleeStrike();
    }
  }
}

function performAiAbility(unit, ability, target) {
  const used = useAiAbility(unit, ability, target);
  if (!used) {
    advanceAiTurn();
    return;
  }
  recordAction("ability", unit.team);
  later(() => {
    if (battleToken !== currentBattleToken) return;
    if (checkBattleEnd()) return;
    /* A support ability does not consume the turn, so the champion may
     * still have an action left. */
    if (ability.actionCost === "ability") {
      continueAiAction(unit);
      return;
    }
    later(() => { advanceAiTurn(); }, aiTiming().gap);
  }, aiTiming().ability);
}

/* 21.2 THE LEAD ALTERNATES
 *
 * Since v1.7.1 a bow covers the whole field, so the legion that acts first
 * in a round gets a free round of shooting before the other army can
 * answer. The order of play would then decide the battle and not the
 * armies, which is why the lead alternates: the legion that opened the
 * match opens the first round, the other legion opens the second, and so
 * on. Neither side keeps the first move, and the fight is settled by the
 * legions themselves.
 *
 * The round that is being fought right now decides who opens it. A round
 * is closed when the legion that answered has finished its turn.
 *
 * Over a duel each party opens one of the matches, so the series as a
 * whole hands the opening move around as well.
 */
function roundLeader() {
  const opener = matchOpener;
  if (roundNumber % 2 === 1) return opener;
  return opener === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
}

/* Hands the field to the azure legion. In Troop mode we also put the
 * first ready fighter under the cursor so the player can act at once
 * (classic "one unit at a time" feel). */
function beginPlayerTurn() {
  currentTurn = "player";
  gameState = STATE_PLAYER_SELECTING;
  updateEndTurnButton();
  logEvent(getTurnModeId() === "troop"
    ? "Troop mode — choose one fighter."
    : "Your turn!", "system");
  if (getTurnModeId() === "troop") {
    autoSelectNextTroopUnit(TEAM_BLUE);
  } else {
    showPreviewMoveIndicators();
  }
}

/* Picks a living fighter that can still act and selects it. Prefers the
 * front rank, then left-to-right, so the choice feels deliberate rather
 * than random. */
function autoSelectNextTroopUnit(team) {
  const candidates = getTeamUnits(team)
    .filter(u => unitCanActThisRound(u))
    .sort((a, b) => {
      /* Front rank (lower row number is closer to the viewer) first. */
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  if (candidates.length === 0) return;
  selectUnit(candidates[0].id);
}

/* Hands the field to the crimson legion. */
function beginEnemyTurn(message) {
  currentTurn = "enemy";
  gameState = STATE_ENEMY_TURN;
  updateEndTurnButton();
  if (message) logEvent(message, "ai");
  runEnemyTurn();
}

/* Opens the round that follows the one that has just been closed. */
function startNextRound() {
  if (roundLeader() === TEAM_RED) {
    beginEnemyTurn("The crimson legion opens the round.");
    return;
  }
  beginPlayerTurn();
}

function finishEnemyTurn() {
  const finishedTeam = aiTurnTeam;
  aiTurnTeam = null;
  $turnBanner.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-blue-active");

  if (!aiTurnOwnsRound) return;

  /* A spectator battle hands the field straight from one legion to the
   * other. The round is only closed once both have had their turn. */
  if (battleMode === "spectator") {
    /* The instant driver steers the show itself, so it closes the rounds. */
    if (!spectatorAutoAdvance) return;

    const leader = roundLeader();
    const trailer = leader === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
    if (finishedTeam === trailer) {
      /* The legion that answered is done: the round is over. */
      if (closeRound()) return;
      const next = roundLeader();
      spectatorTurnTeam = next;
      later(() => runSpectatorTurn(next), aiTiming().gap);
      return;
    }
    /* The legion that opened the round is done: the other one answers. */
    spectatorTurnTeam = trailer;
    later(() => runSpectatorTurn(trailer), aiTiming().gap);
    return;
  }

  /* Troop mode: one crimson activation done. Close the combat round only
   * when every living fighter has acted (v1.12.5). */
  if (getTurnModeId() === "troop") {
    if (allUnitsActedThisRound()) {
      if (closeRound()) return;
      startNextRound();
      return;
    }
    if (teamHasActors(TEAM_BLUE)) {
      beginPlayerTurn();
      return;
    }
    if (teamHasActors(TEAM_RED)) {
      beginEnemyTurn("Crimson Legion continues...");
      return;
    }
    if (closeRound()) return;
    startNextRound();
    return;
  }

  if (roundLeader() === TEAM_RED) {
    /* Party mode: crimson opened; azure answers next. */
    beginPlayerTurn();
    return;
  }

  /* Party mode: azure opened; crimson answered → round over. */
  if (closeRound()) return;
  startNextRound();
}

/* Closes the round: the counter moves on, the flags are reset and the
 * battle either ends or the next round begins. Returns true when the
 * battle is over. */
function closeRound() {
  /* An army that has been wiped out decides the battle, whatever the round
   * counter says. Elimination always comes first. */
  if (checkBattleEnd()) return true;

  /* The round limit is the last word: no battle is ever fought for longer
   * than BATTLE_ROUND_LIMIT rounds. */
  if (roundNumber >= BATTLE_ROUND_LIMIT) {
    endBattleByRoundLimit();
    return true;
  }

  roundNumber++;
  resetActionFlags();
  expireTemporaryEffects();
  refreshAllHealthBars();

  /* The last round is fought in sudden death. */
  if (roundNumber === BATTLE_ROUND_LIMIT) enterSuddenDeath();

  updateTurnBanner();
  updateBattleStatus();
  return false;
}

/* The last round of a battle is fought in sudden death: every blow counts
 * for more, so a fight that reached the round limit still ends in a
 * decision. */
function enterSuddenDeath() {
  if (suddenDeathActive) return;
  suddenDeathActive = true;
  logEvent("SUDDEN DEATH — the final round is fought.", "system");
}

/* The health an army has left. The round limit is settled on this number. */
function totalRemainingHp(team) {
  return getTeamUnits(team).reduce((sum, unit) => sum + Math.max(0, unit.hp), 0);
}

/* The round limit has been reached. The field is settled by the health each
 * army has left: the stronger army wins and an even field is a draw. */
function endBattleByRoundLimit() {
  const livingBlue = getTeamUnits(TEAM_BLUE).length > 0;
  const livingRed = getTeamUnits(TEAM_RED).length > 0;

  /* Elimination comes first: a wiped out army loses, whatever the health
   * comparison would have said. */
  if (!livingBlue || !livingRed) {
    checkBattleEnd();
    return;
  }

  const blueHp = totalRemainingHp(TEAM_BLUE);
  const redHp = totalRemainingHp(TEAM_RED);

  if (blueHp === redHp) {
    logEvent(`The round limit is reached with ${blueHp} health on each side — a draw.`, "system");
    endBattle(false, "draw", "even");
    return;
  }
  if (blueHp > redHp) {
    logEvent(`The round limit is reached — the azure legion holds the field with ${blueHp} health.`, "system");
    endBattle(true, "victory", "round_limit");
    return;
  }
  logEvent(`The round limit is reached — the crimson legion holds the field with ${redHp} health.`, "system");
  endBattle(false, "defeat", "round_limit");
}

/* 20. BATTLE END & REMATCH */

/* Is the battle over? The battle ends when one army is wiped out, and the
 * round limit settles it if both are still standing. */
function checkBattleEnd() {
  if (gameState === STATE_ENDED) return true;

  const livingBlue = getTeamUnits(TEAM_BLUE).length > 0;
  const livingRed = getTeamUnits(TEAM_RED).length > 0;

  if (livingBlue && livingRed) return false;

  let outcome = "stalemate";
  if (!livingRed && livingBlue) outcome = "victory";
  else if (!livingBlue && livingRed) outcome = "defeat";

  endBattle(!livingRed && livingBlue, outcome, "elimination");
  return true;
}

/* Ends the battle: the field is put into its final state and the result is
 * written down exactly once.
 *
 * ending says what settled the fight: "elimination" when an army was wiped
 * out, "round_limit" when the field was settled on the health left, and
 * "even" when neither army was ahead. */
function endBattle(victory, outcome, ending) {
  battleActive = false;
  gameState = STATE_ENDED;
  currentTurn = "ended";
  clearSelection();
  updateEndTurnButton();
  $abilityWrap.classList.add("hidden");
  $turnBanner.classList.add("hidden");
  $battlefield.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-blue-active");

  const spectator = battleMode === "spectator";
  const atLimit = ending === "round_limit";

  if (outcome === "victory") {
    $battleResult.textContent = spectator
      ? `SPECTATOR — AZURE LEGION PREVAILS${atLimit ? " ON THE ROUND LIMIT" : ""}`
      : `VICTORY — AZURE LEGION PREVAILS${atLimit ? " ON THE ROUND LIMIT" : ""}`;
    $battleResult.className = "battle-result victory";
    logEvent(spectator
      ? "The azure legion wins the show."
      : "Azure Legion is victorious!", "system");
  } else if (outcome === "defeat") {
    $battleResult.textContent = spectator
      ? `SPECTATOR — CRIMSON LEGION PREVAILS${atLimit ? " ON THE ROUND LIMIT" : ""}`
      : `DEFEAT — CRIMSON LEGION PREVAILS${atLimit ? " ON THE ROUND LIMIT" : ""}`;
    $battleResult.className = "battle-result defeat";
    logEvent(spectator
      ? "The crimson legion wins the show."
      : "Crimson Legion has triumphed.", "system");
  } else if (outcome === "draw") {
    $battleResult.textContent = spectator
      ? "SPECTATOR — EVEN ARMIES STAND"
      : "DRAW — BOTH LEGIONS STAND";
    $battleResult.className = "battle-result draw";
    logEvent(spectator
      ? "The show ends in a draw."
      : "The battle ends in a draw.", "system");
  } else {
    $battleResult.textContent = "BATTLE ENDED — NO SURVIVORS";
    $battleResult.className = "battle-result";
  }

  $battleResult.classList.remove("hidden");
  updateActionButtons();

  if (!battleFinalized) {
    battleFinalized = true;
    battleLedger.ending = ending || "elimination";
    finalizeBattleResult(victory, outcome);
  }

  /* A duel counts the match that was just fought and says whether the
   * series goes on. */
  if (duel.active && !duel.finished) {
    recordDuelMatch(outcome === "victory" ? "victory" : outcome === "defeat" ? "defeat" : "draw");
    if (duel.finished) {
      finishDuel();
    } else {
      announceNextDuelMatch();
    }
  }
}

/* The completion bonus is paid exactly once per battle. */
function finalizeBattleResult(victory, outcome) {
  battleLedger.rounds = Math.min(roundNumber, BATTLE_ROUND_LIMIT);
  battleLedger.spectator = battleMode === "spectator";
  battleLedger.outcome = outcome || (victory ? "victory" : "defeat");

  /* What was left standing when the fight ended, and what settled it. */
  const blueLeft = getTeamUnits(TEAM_BLUE);
  const redLeft = getTeamUnits(TEAM_RED);
  battleLedger.survivors.blue = { units: blueLeft.length, hp: totalRemainingHp(TEAM_BLUE) };
  battleLedger.survivors.red = { units: redLeft.length, hp: totalRemainingHp(TEAM_RED) };
  battleLedger.ending = battleLedger.ending || (outcome === "draw" ? "even" : "elimination");

  /* A spectator battle pays nothing at all: no experience, no battle in the
   * tally, no level, no change to the saved profile. */
  if (battleMode === "spectator") {
    updateProgressionUI();
    updateChampionPanel();
    renderBattleReport(outcome || (victory ? "victory" : "defeat"));
    return;
  }

  /* A duel is a series of matches, and the series is what is counted: a
   * match inside a duel is not a battle of its own. A single match that
   * was never part of a duel still counts on its own. */
  if (!duel.active) {
    progression.battles += 1;
    if (victory) progression.wins += 1;
  }

  /* Experience for the damage itself. The key is tied to the battle, so the
   * reward can only ever be paid once, however often the end check runs. */
  const damageXp = Math.floor(battleLedger.damage.blue / XP_PER_DAMAGE);
  if (damageXp > 0) {
    battleLedger.xp.damage = damageXp;
    awardExperience(damageXp, `${battleLedger.damage.blue} damage dealt`, `battle:${battleId}:damage`);
  }
  /* The victory bonus belongs to the duel, not to a single match of it. */
  if (victory && !duel.active) {
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
  /* A spectator battle pays nothing, so nothing is written down either. */
  if (battleMode === "spectator") return;
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

/* 20.5 THE DUEL SERIES
 *
 * A duel is not one match: it is a series of up to three matches, and the
 * legion that takes two of them wins the duel. The ground, the opponent and
 * the rules stay the same from one match to the next — what changes is who
 * opens.
 *
 * The legion that opens a match takes the first round, and with it the
 * extra round of an odd fight. Inside a match the lead still alternates
 * from one round to the next, so the opener of a match opens the odd
 * rounds of that match and the other legion opens the even ones.
 *
 * Over a series each party opens once: the azure legion opens the first
 * match, the crimson legion opens the second, and the third match — the
 * decider, fought only when the series is level — is opened by a random
 * legion. Neither side can hoard the opening move.
 *
 * Every match keeps its own ledger, so the report can still say what a
 * single match was worth. The duel keeps the score of the series on top of
 * it, and the duel is what the profile counts: a duel won is a win, a duel
 * lost is a loss.
 */
function createDuel(mode) {
  duel.active = true;
  duel.id += 1;
  duel.mode = mode === "spectator" ? "spectator" : "player";
  duel.matchNumber = 1;
  duel.blueWins = 0;
  duel.redWins = 0;
  duel.opener = duelOpenerForMatch(1);
  duel.matches = [];
  duel.lastOutcome = null;
  duel.finished = false;
  duel.result = null;
  return duel;
}

/* Throws a duel away. The field is emptied as well, so nothing of the
 * series is left behind. */
function abandonDuel() {
  duel.active = false;
  duel.matchNumber = 0;
  duel.blueWins = 0;
  duel.redWins = 0;
  duel.opener = TEAM_BLUE;
  duel.matches = [];
  duel.lastOutcome = null;
  duel.finished = false;
  duel.result = null;
}

/* Who opens a given match of a duel. The azure legion opens the first
 * match, the crimson legion opens the second, and the decider is opened by
 * a random legion. */
function duelOpenerForMatch(matchNumber) {
  if (matchNumber <= 1) return TEAM_BLUE;
  if (matchNumber === 2) return TEAM_RED;
  return nextRandom() < 0.5 ? TEAM_BLUE : TEAM_RED;
}

/* The score of the series, as it is shown on the field. */
function duelScoreText() {
  return `${duel.blueWins}–${duel.redWins}`;
}

function duelScoreLabel() {
  return `AZURE ${duel.blueWins} – ${duel.redWins} CRIMSON`;
}

/* The state of the duel, for the interface and for the test surface. */
function getDuelState() {
  return {
    active: duel.active,
    id: duel.id,
    mode: duel.mode,
    matchNumber: duel.matchNumber,
    matchLimit: DUEL_MATCH_LIMIT,
    winsNeeded: DUEL_WINS_NEEDED,
    blueWins: duel.blueWins,
    redWins: duel.redWins,
    opener: duel.opener,
    score: duelScoreText(),
    finished: duel.finished,
    result: duel.result,
    matches: duel.matches.map(m => Object.assign({}, m))
  };
}

/* Starts a duel: a fresh series, fought on the ground that is chosen. */
function startDuel(options) {
  const opts = options || {};
  const mode = opts.mode === "spectator" ? "spectator" : "player";
  createDuel(mode);
  resetField();
  startBattle({ mode, opener: duel.opener });
  return true;
}

/* Starts the next match of a duel that is still open. */
function startNextDuelMatch() {
  if (!duel.active || duel.finished) return false;
  if (duel.matchNumber >= DUEL_MATCH_LIMIT) return false;
  duel.matchNumber += 1;
  duel.opener = duelOpenerForMatch(duel.matchNumber);
  resetField({ keepMode: true });
  startBattle({ mode: duel.mode, opener: duel.opener });
  return true;
}

/* Writes the match that was just fought into the score of the duel and
 * decides whether the series is over. */
function recordDuelMatch(outcome) {
  const winner = outcome === "victory" ? TEAM_BLUE : outcome === "defeat" ? TEAM_RED : null;
  duel.matches.push({
    matchNumber: duel.matchNumber,
    opener: duel.opener,
    outcome: outcome || "draw",
    winner,
    rounds: battleLedger.rounds,
    damage: battleLedger.damage.blue,
    kills: battleLedger.defeated,
    losses: battleLedger.lost
  });
  if (winner === TEAM_BLUE) duel.blueWins += 1;
  else if (winner === TEAM_RED) duel.redWins += 1;
  duel.lastOutcome = outcome || "draw";

  if (duel.blueWins >= DUEL_WINS_NEEDED) {
    duel.finished = true;
    duel.result = "victory";
  } else if (duel.redWins >= DUEL_WINS_NEEDED) {
    duel.finished = true;
    duel.result = "defeat";
  } else if (duel.matchNumber >= DUEL_MATCH_LIMIT) {
    /* Three matches fought and the series is still level: the duel is
     * drawn. */
    duel.finished = true;
    duel.result = "draw";
  }
  return duel;
}

/* The duel is over: the series is written down and the field says so. */
function finishDuel() {
  const outcome = duel.result === "victory" ? "victory"
    : duel.result === "defeat" ? "defeat" : "draw";

  if (battleMode !== "spectator") {
    /* The duel is what the profile counts. */
    progression.battles += 1;
    if (outcome === "victory") {
      progression.wins += 1;
      battleLedger.xp.victory = XP_VICTORY_BONUS;
      awardExperience(XP_VICTORY_BONUS, "duel victory", `duel:${duel.id}:victory`);
    }
    battleLedger.levelAfter = progression.level;
    saveChampionProgression();
    updateProgressionUI();
    updateChampionPanel();
  }

  const score = duelScoreText();
  if (outcome === "victory") {
    $battleResult.textContent = `DUEL VICTORY — AZURE LEGION WINS ${score}`;
    $battleResult.className = "battle-result victory";
  } else if (outcome === "defeat") {
    $battleResult.textContent = `DUEL DEFEAT — CRIMSON LEGION WINS ${score}`;
    $battleResult.className = "battle-result defeat";
  } else {
    $battleResult.textContent = `DUEL DRAWN — ${score}`;
    $battleResult.className = "battle-result draw";
  }

  logEvent(`The duel is over: ${duelScoreLabel()}.`, "system");
  renderBattleReport(outcome);
  updateActionButtons();
  updateBattleStatus();
}

/* The match is over but the duel is not: the next match is announced. */
function announceNextDuelMatch() {
  const score = duelScoreText();
  const won = duel.blueWins > duel.redWins;
  logEvent(`Match ${duel.matchNumber} of ${DUEL_MATCH_LIMIT} — the duel stands at ${score}.`, "system");
  $battleResult.textContent =
    `MATCH ${duel.matchNumber} ${won ? "WON" : "LOST"} — DUEL ${score}`;
  $battleResult.className = "battle-result " + (won ? "victory" : "defeat");
  /* The report is written again, so it carries the score of the series. */
  renderBattleReport(duel.lastOutcome);
  updateActionButtons();
  updateBattleStatus();

  /* A show plays itself: the next match begins on its own. A player waits
   * for the NEXT MATCH button. */
  if (battleMode === "spectator" && duelAutoAdvance) {
    later(() => {
      if (duel.active && !duel.finished) startNextDuelMatch();
    }, DUEL_ADVANCE_DELAY);
  }
}

function resetBattle() {
  abandonDuel();
  resetField();
}

/* Empties the field and puts the interface back to the state before a
 * battle. The mode is kept when the field is cleared for the next match of
 * a duel, and dropped back to the player's when the whole duel is
 * abandoned. */
function resetField(options) {
  const keepMode = !!(options && options.keepMode);
  cancelPendingTimers();
  aiActionQueue = [];
  aiActionIndex = 0;
  aiTurnTeam = null;
  aiTurnOwnsRound = false;
  actionLock = false;
  currentBattleToken = ++battleToken;
  battleFinalized = false;

  /* A reset always returns to the player: the spectator show is a detour,
   * not a state the game stays in. */
  if (!keepMode) setBattleMode("player");
  suddenDeathActive = false;

  battleActive = false;
  gameState = STATE_INIT;
  currentTurn = "player";
  roundNumber = 1;
  selectedUnitId = null;
  pendingAbilityId = null;

  initArmies();
  renderArmies();
  renderTerrain();

  $modeButton.disabled = false;
  $modeButton.textContent = battleMode === "spectator" ? "AI vs AI" : "Hum vs AI";
  $battleResult.classList.add("hidden");
  $battleResult.className = "battle-result hidden";
  hideBattleReport();
  $turnBanner.classList.add("hidden");
  $turnBanner.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-active");
  $battlefield.classList.remove("ai-turn-blue-active");
  updateEndTurnButton();
  $selectionInfo.classList.add("hidden");
  $abilityWrap.classList.add("hidden");
  $combatLog.innerHTML = "";

  $status.textContent = "THE ARMIES AWAIT YOUR COMMAND";
  updateProgressionUI();
  updateChampionPanel();
  updateActionButtons();
}

/* The mode button lets the player pick how the next battle is fought:
 * Hum vs AI starts a duel against the crimson legion, AI vs AI starts a
 * spectator show. It toggles between the two states and is locked while a
 * battle runs. */
function updateActionButtons() {
  if (!$modeButton) return;
  $modeButton.disabled = battleActive;
  $modeButton.textContent = battleMode === "spectator" ? "AI vs AI" : "Hum vs AI";
  updateEndTurnButton();
}

/* Toggles the battle mode between Hum vs AI and AI vs AI. Only works when
 * no battle is running. */
function toggleBattleMode() {
  if (battleActive) return false;
  const next = battleMode === "spectator" ? "player" : "spectator";
  setBattleMode(next);
  updateActionButtons();
  return true;
}

/* 21. UI HELPERS */

function selectDifficulty(id) {
  if (battleActive || (duel.active && !duel.finished)) return false;
  if (!setDifficulty(id)) return false;
  const profile = DIFFICULTY_PROFILES[id];
  updateDifficultyLabel();
  logEvent(`Difficulty set to ${profile.label}.`, "system");
  return true;
}

function selectMap(id) {
  if (battleActive || (duel.active && !duel.finished)) return false;
  if (!setActiveMap(id)) return false;
  renderTerrain();
  logEvent(`Battlefield set to ${getActiveMap().name}.`, "system");
  return true;
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
      : outcome === "defeat" ? "DEFEAT"
      : outcome === "draw" ? "DRAW" : "NO SURVIVORS";
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

  /* What was left standing, and what settled the fight. The numbers come
   * from the ledger, never from the combat log. */
  const survivors = battleLedger.survivors || { blue: { units: 0, hp: 0 }, red: { units: 0, hp: 0 } };
  if ($reportSurvivors) {
    $reportSurvivors.textContent = `${survivors.blue.units} / ${survivors.red.units}`;
  }
  if ($reportHealth) {
    $reportHealth.textContent = `${survivors.blue.hp} / ${survivors.red.hp}`;
  }
  if ($reportDecided) {
    $reportDecided.textContent = battleLedger.ending === "round_limit"
      ? "ROUND LIMIT"
      : battleLedger.ending === "even" ? "EVEN ARMIES" : "ELIMINATION";
  }
  if ($reportMode) {
    $reportMode.textContent = battleLedger.spectator ? "SPECTATOR" : "PLAYER";
  }
  /* The score of the series, when the match was one of a duel. */
  if ($reportDuel) {
    $reportDuel.textContent = duel.active
      ? `${duelScoreText()} · MATCH ${duel.matchNumber}/${DUEL_MATCH_LIMIT}`
      : "—";
  }
  if ($reportBreakdown) {
    if (battleLedger.spectator) {
      $reportBreakdown.textContent = "Spectator mode — no rewards are paid.";
    } else if (duel.active) {
      $reportBreakdown.textContent = duel.finished
        ? `Duel ${duelScoreLabel()} — Damage ${battleLedger.xp.damage} XP  ·  Kills ${battleLedger.xp.kill} XP  ·  Victory ${battleLedger.xp.victory} XP`
        : `Duel ${duelScoreLabel()} — Damage ${battleLedger.xp.damage} XP  ·  Kills ${battleLedger.xp.kill} XP  ·  The duel is not over yet`;
    } else {
      $reportBreakdown.textContent = `Damage ${battleLedger.xp.damage} XP  ·  Kills ${battleLedger.xp.kill} XP  ·  Victory ${battleLedger.xp.victory} XP`;
    }
  }
  if ($reportLevel) {
    $reportLevel.textContent = battleLedger.spectator
      ? "Spectator mode — the champion's profile is untouched."
      : battleLedger.levelAfter > battleLedger.levelBefore
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
  /* The banner says which match of the duel is being fought. */
  const match = duel.active ? `MATCH ${duel.matchNumber}/${DUEL_MATCH_LIMIT} · ` : "";
  $roundText.textContent = match + (suddenDeathActive
    ? `ROUND ${roundNumber} — SUDDEN DEATH`
    : `ROUND ${roundNumber}`);

  /* A spectator battle names the legion that is fighting, because there is
   * no player turn to announce. */
  if (battleMode === "spectator") {
    if (currentTurn === TEAM_BLUE) {
      $turnText.textContent = "AZURE LEGION TURN";
      $turnBanner.style.borderColor = "rgba(233, 198, 108, 0.3)";
    } else if (currentTurn === TEAM_RED) {
      $turnText.textContent = "CRIMSON LEGION TURN";
      $turnBanner.style.borderColor = "rgba(248, 113, 113, 0.3)";
    } else {
      $turnText.textContent = "SPECTATING";
    }
    return;
  }

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
    if (battleMode === "spectator") {
      $status.textContent = duel.active && !duel.finished
        ? "THE SHOW GOES ON — THE NEXT MATCH IS COMING"
        : "THE SHOW IS OVER — THE PROFILE IS UNTOUCHED";
    } else {
      $status.textContent = duel.active && !duel.finished
        ? `THE DUEL GOES ON — ${duelScoreLabel()} — PRESS NEXT MATCH`
        : "THE ARMIES AWAIT YOUR COMMAND";
    }
    return;
  }

  if (battleMode === "spectator") {
    if (suddenDeathActive) {
      $status.textContent = "SUDDEN DEATH — THE FINAL ROUND";
      return;
    }
    $status.textContent = currentTurn === TEAM_RED
      ? "CRIMSON LEGION IS FIGHTING..."
      : "AZURE LEGION IS FIGHTING...";
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
      if (!unit.hasMoved && !unit.hasAttacked) parts.push("can move");
      if (!unit.hasMoved && !unit.hasAttacked) parts.push("can attack");
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
  if (!battleActive) {
    $endTurnButton.textContent = "START";
    $endTurnButton.disabled = false;
    return;
  }

  if (battleMode === "spectator") {
    $endTurnButton.textContent = "WATCHING";
    $endTurnButton.disabled = true;
    return;
  }

  $endTurnButton.textContent = "END TURN";
  const anyBlueCanAct = blueUnitIds.some(id => {
    const u = units.get(id);
    if (!u || !u.alive || u.defeated) return false;
    if (!u.hasMoved || !u.hasAttacked) return true;
    return getReadyAbilities(u).length > 0;
  });
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
  /* v1.11: champion panel is removed from the footer UI. Keep the node
   * updated for tests / ability unlock flow, but never show it. */
  if ($championPanel) $championPanel.classList.add("hidden");
  const champion = getPlayerChampion();
  if (!champion) return;

  if ($champLevel) $champLevel.textContent = `LEVEL ${progression.level}`;
  if ($champStats) {
    const bonus = getLevelBonuses(progression.level);
    $champStats.textContent =
      `HP ${champion.hp}/${champion.maxHp} · ATK ${champion.atk} · DEF ${champion.def}` +
      (champion.shot ? ` · BOW ${champion.shot.atk} ATK · FIELD` : "") +
      (bonus.hp || bonus.atk || bonus.def ? ` (base +${bonus.hp} HP +${bonus.atk} ATK +${bonus.def} DEF)` : "");
  }
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
    if (ability.id === "rally") continue;
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
    if (!canAbilityReachTarget(unit, ability, target)) continue;
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

/* Preview: all reachable cells for every blue fighter that can still act.
 * Drawn as blue circles from the start of the player turn (v1.12.2). */
function showPreviewMoveIndicators() {
  clearMoveIndicators();
  if (!battleActive || currentTurn !== "player" || battleMode === "spectator") return;

  const seen = new Set();
  for (const [, unit] of units) {
    if (unit.team !== TEAM_BLUE || !unit.alive || unit.defeated) continue;
    if (unit.hasMoved || unit.hasAttacked) continue;
    const cells = getReachableCells(unit);
    for (const cell of cells) {
      const key = `${cell.col},${cell.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const marker = document.createElement("div");
      marker.className = "move-indicator preview-move";
      marker.style.left = `${colPercent(cell.col)}%`;
      marker.style.top = `${rowPercent(cell.row)}%`;
      marker.title = describeTerrain(cell.col, cell.row);
      /* Clicking a preview cell selects a blue unit that can reach it. */
      marker.addEventListener("click", () => {
        const candidate = findBlueUnitThatCanReach(cell.col, cell.row);
        if (candidate) selectUnit(candidate.id);
      });
      $moveIndicators.appendChild(marker);
      moveIndicators.push(marker);
    }
  }
}

function findBlueUnitThatCanReach(col, row) {
  for (const [, unit] of units) {
    if (unit.team !== TEAM_BLUE || !unit.alive || unit.defeated || unit.hasMoved) continue;
    if (canMoveTo(unit, col, row)) return unit;
  }
  return null;
}

/* Selected unit: green circles for that fighter's moves. */
function showMoveIndicators(unit) {
  clearMoveIndicators();
  /* Attack ends the march — no move after a blow (v1.12.7). */
  if (unit.hasMoved || unit.hasAttacked) return;
  const cells = getReachableCells(unit);

  for (const cell of cells) {
    const marker = document.createElement("div");
    marker.className = "move-indicator selected-move";
    marker.style.left = `${colPercent(cell.col)}%`;
    marker.style.top = `${rowPercent(cell.row)}%`;
    marker.title = describeTerrain(cell.col, cell.row);
    marker.addEventListener("click", () => onMoveClick(unit.id, cell.col, cell.row));
    $moveIndicators.appendChild(marker);
    moveIndicators.push(marker);
  }
}

/* Red circles for attack targets. */
function showAttackIndicators(unit) {
  /* One action only — no blow after a march (v1.12.9). */
  if (unit.hasAttacked || unit.hasMoved) return;
  const targets = getValidTargets(unit);

  for (const target of targets) {
    const marker = document.createElement("div");
    marker.className = "attack-indicator target-red";
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
    logEvent("The battle has not begun — press START.", "system");
    highlightModeButton();
    return;
  }
  if (battleMode === "spectator") {
    /* A spectator does not command anybody. */
    logEvent("You are watching the show — the legions fight on their own.", "system");
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
    if (attacker.melee && dist > getMeleeReach(attacker)) {
      logEvent(`${unit.displayName} is out of reach (${dist} > ${getMeleeReach(attacker)}).`, "system");
    } else if (attacker.melee) {
      logEvent(`No way in to ${unit.displayName} — every lane is closed.`, "system");
    } else {
      logEvent("That target cannot be struck.", "system");
    }
  }
}

function onMoveClick(unitId, col, row) {
  const unit = units.get(unitId);
  if (!unit || unit.hasMoved || unit.hasAttacked) return;
  if (!battleActive || currentTurn !== "player" || actionLock) return;

  if (canMoveTo(unit, col, row)) {
    moveUnit(unit, col, row);
    recordAction("move", unit.team);
    clearMoveIndicators();
    clearAttackIndicators();
    /* No attack after a march (v1.12.9). */
    updateBattleStatus();
    updateEndTurnButton();
    maybeAutoEndTurnForTroopMode();
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
    const reach = getMeleeReach(attacker);
    if (reach > 0 && fieldDistance(attacker, target) > reach) {
      logEvent("Cannot attack — target out of range.", "system");
    } else {
      logEvent("The blow cannot get there — the rank in front closes the way.", "system");
    }
    return;
  }
  const kind = pendingAttackKind || null;
  pendingAttackKind = null;
  executeAttack(attackerId, targetId, kind);
}

/* 24. COMBAT EXECUTION
 * The action lock prevents rapid taps from queueing multiple attacks.
 * Animations run ~1.5–1.6 s so the lunge or flying arrow is readable.
 */
function executeAttack(attackerId, targetId, preferredKind) {
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
  /* A blow ends the march — cannot walk after striking (v1.12.7). */
  attacker.hasMoved = true;
  clearDefenceStand(attacker);

  let kind = preferredKind || getAttackKind(attacker, target) || "melee";
  /* Explicit bow choice wins; otherwise charge units prefer melee. */
  if (preferredKind === "ranged") kind = "ranged";
  if (preferredKind === "melee") kind = "melee";
  const attackerEl = unitElements.get(attackerId);
  const isRanged = kind === "ranged" || kind === "shot" || (!attacker.melee && !preferredKind);

  const playMeleeStrike = () => {
    if (battleToken !== currentBattleToken) return;
    if (attackerEl) attackerEl.classList.add("windup");
    later(() => {
      if (battleToken !== currentBattleToken) return;
      if (attackerEl) {
        attackerEl.classList.remove("windup");
        attackerEl.classList.add("attacking");
      }
      later(() => {
        if (attackerEl) attackerEl.classList.remove("attacking");
        finishAttackResolve(attacker, target, attackerId, targetId);
      }, ATTACK_ANIM_MS - MELEE_WINDUP_MS);
    }, MELEE_WINDUP_MS);
  };

  if (isRanged) {
    /* Two-phase ranged: draw, then release + flying arrow (total ~1.2 s). */
    if (attackerEl) attackerEl.classList.add("drawing");
    later(() => {
      if (battleToken !== currentBattleToken) return;
      if (attackerEl) {
        attackerEl.classList.remove("drawing");
        attackerEl.classList.add("shooting");
      }
      spawnProjectile(attacker, target, attacker.type === "ballista" ? "bolt" : "arrow");
      later(() => {
        if (attackerEl) attackerEl.classList.remove("shooting");
        finishAttackResolve(attacker, target, attackerId, targetId);
      }, RANGED_FLIGHT_MS);
    }, RANGED_DRAW_MS);
  } else {
    /* Charge in if not already adjacent (chevalier / champion). */
    const approach = isChargeMelee(attacker) && !meleeStrikeAllowed(attacker, attacker, target)
      ? findMeleeApproachCell(attacker, target)
      : null;
    if (approach) {
      animateChargeTo(attacker, approach, playMeleeStrike);
    } else {
      playMeleeStrike();
    }
  }
}

function finishAttackResolve(attacker, target, attackerId, targetId) {
  if (battleToken !== currentBattleToken) return;

  const damage = calculateDamage(attacker, target);
  applyDamage(targetId, damage, { countDamage: true, team: attacker.team });
  recordAction("attack", attacker.team);

  logEvent(`${attacker.displayName} attacks ${target.displayName} for ${damage} damage.`, "player");

  riposteAgainst(target, attacker);

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
  maybeAutoEndTurnForTroopMode();
  checkBattleEnd();
}

/* Spawn a simple arrow/bolt that flies from attacker to target. */
function spawnProjectile(attacker, target, style) {
  const field = document.getElementById("battlefield");
  if (!field) return;
  const aEl = unitElements.get(attacker.id);
  const tEl = unitElements.get(target.id);
  if (!aEl || !tEl) return;

  const fieldRect = field.getBoundingClientRect();
  const aRect = aEl.getBoundingClientRect();
  const tRect = tEl.getBoundingClientRect();

  const x0 = aRect.left + aRect.width / 2 - fieldRect.left;
  const y0 = aRect.top + aRect.height * 0.4 - fieldRect.top;
  const x1 = tRect.left + tRect.width / 2 - fieldRect.left;
  const y1 = tRect.top + tRect.height * 0.4 - fieldRect.top;

  const proj = document.createElement("div");
  proj.className = "projectile" + (style === "bolt" ? " bolt" : "");
  proj.style.left = x0 + "px";
  proj.style.top = y0 + "px";

  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  proj.style.transform = `rotate(${angle}deg)`;

  field.appendChild(proj);

  /* Force layout then animate position. */
  void proj.offsetWidth;
  proj.style.transition = `left ${RANGED_FLIGHT_MS}ms linear, top ${RANGED_FLIGHT_MS}ms linear`;
  proj.style.left = x1 + "px";
  proj.style.top = y1 + "px";

  later(() => {
    if (proj.parentNode) proj.parentNode.removeChild(proj);
  }, RANGED_FLIGHT_MS + 40);
}

/* Which weapon the attacker would use against this target. */
function getAttackKind(attacker, target) {
  if (!attacker || !target) return null;
  const aPos = { col: attacker.col, row: attacker.row };
  const tPos = { col: target.col, row: target.row };
  if (attacker.melee && meleeStrikeAllowed(attacker, aPos, tPos)) return "melee";
  if (canChargeMelee(attacker, target)) return "melee";
  if (!attacker.melee || attacker.shot) return "ranged";
  return "melee";
}

/* Animate a charge into an approach cell, then run onDone. */
function animateChargeTo(attacker, cell, onDone) {
  if (!attacker || !cell) {
    if (onDone) onDone();
    return;
  }
  attacker.col = cell.col;
  attacker.row = cell.row;
  attacker.hasMoved = true;
  clearDefenceStand(attacker);
  const el = unitElements.get(attacker.id);
  if (el) {
    positionUnit(el, attacker);
    el.classList.add("moving");
    later(() => {
      if (el) el.classList.remove("moving");
      if (onDone) onDone();
    }, MOVE_ANIM_MS);
  } else if (onDone) {
    onDone();
  }
  logEvent(`${attacker.displayName} charges to (${cell.col},${cell.row}).`,
    attacker.team === TEAM_BLUE ? "player" : "ai");
}

/* 25. INITIALISATION */

function initGame() {
  loadChampionProgression();
  initArmies();
  renderArmies();
  renderTerrain();
  updateProgressionUI();
  updateActionButtons();
  updateDifficultyLabel();
  updateTurnLabel();

  $modeButton.addEventListener("click", () => {
    toggleBattleMode();
  });

  $endTurnButton.addEventListener("click", () => {
    onStartEndButtonClick();
  });

  if ($difficultyCycle) {
    $difficultyCycle.addEventListener("click", cycleDifficulty);
  }

  if ($turnCycle) {
    $turnCycle.addEventListener("click", cycleTurnMode);
  }

  if ($braceButton) {
    $braceButton.addEventListener("click", () => {
      if (currentTurn !== "player" || gameState !== STATE_PLAYER_SELECTING) return;
      const unit = selectedUnitId ? units.get(selectedUnitId) : null;
      if (!unit || unit.team !== TEAM_BLUE) return;
      if (!makeDefenceStand(unit)) return;
      clearSelection();
      updateBattleStatus();
      updateEndTurnButton();
      if (checkBattleEnd()) return;
    });
  }

  /* Icon action bar: Shield / Sword / Bow */
  if ($iconDefend) {
    $iconDefend.addEventListener("click", () => onActionIconClick("defend"));
  }
  if ($iconMelee) {
    $iconMelee.addEventListener("click", () => onActionIconClick("melee"));
  }
  if ($iconRanged) {
    $iconRanged.addEventListener("click", () => onActionIconClick("ranged"));
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onStartEndButtonClick();
    }
  });

  console.log(`${APP_NAME} ${APP_VERSION} initialized.`);
}

/* Handle clicks on the Shield / Sword / Bow icons. */
function onActionIconClick(action) {
  if (currentTurn !== "player" || gameState !== STATE_PLAYER_SELECTING || actionLock) return;
  const unit = selectedUnitId ? units.get(selectedUnitId) : null;
  if (!unit || unit.team !== TEAM_BLUE) return;

  if (action === "defend") {
    if (!makeDefenceStand(unit)) return;
    clearSelection();
    updateBattleStatus();
    updateEndTurnButton();
    maybeAutoEndTurnForTroopMode();
    checkBattleEnd();
    return;
  }

  /* Arm a weapon mode: next enemy click uses that kind of attack. */
  if (action === "melee" || action === "ranged") {
    if (unit.hasAttacked) {
      logEvent(`${unit.displayName} has already attacked this turn.`, "system");
      return;
    }
    pendingAttackKind = action;
    if ($iconMelee) $iconMelee.classList.toggle("is-armed", action === "melee");
    if ($iconRanged) $iconRanged.classList.toggle("is-armed", action === "ranged");
    if ($iconDefend) $iconDefend.classList.remove("is-armed");
    logEvent(action === "melee"
      ? `${unit.displayName} ready to strike — click an enemy in reach.`
      : `${unit.displayName} ready to shoot — click any living enemy.`, "system");
    showAttackIndicators(unit);
  }
}

/* pendingAttackKind is declared with the other game-state lets above. */

/* The start / end button does one of three things: before a battle it starts
 * a duel (Hum vs AI) or a show (AI vs AI) in the currently selected mode, it
 * opens the next match of a duel that is still running, or — once a battle is
 * under way — it ends the player's turn. */
function onStartEndButtonClick() {
  if (!battleActive) {
    if (duel.active && !duel.finished && gameState === STATE_ENDED) {
      /* The duel is still open: the next match of the series. */
      startNextDuelMatch();
      return;
    }
    if (battleMode === "spectator") {
      startSpectatorBattle();
    } else {
      startDuel({ mode: "player" });
    }
    return;
  }
  endPlayerTurn();
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
    DEPLOYMENT_BOUNDARY: Object.assign({}, DEPLOYMENT_BOUNDARY),
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
    BATTLE_ROUND_LIMIT,
    SUDDEN_DEATH_DAMAGE_MULTIPLIER,
    SPECTATOR_TIMING,
    DUEL_MATCH_LIMIT,
    DUEL_WINS_NEEDED,

    /* state */
    getUnits: () => units,
    getUnit,
    getTeamUnits,
    getChampion,
    getPlayerChampion,
    getEnemyChampion,
    getState: () => ({
      gameState, battleActive, currentTurn, roundNumber,
      selectedUnitId, actionLock, battleId, battleToken, currentBattleToken,
      battleMode, spectatorActive, suddenDeathActive, roundLimit: BATTLE_ROUND_LIMIT
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

    /* turn mode */
    getTurnModeProfiles,
    getTurnModeId,
    setTurnModeId,
    cycleTurnMode,

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

    /* the ground under a picture */
    footprintCells,
    footprintDir,
    isGroundTaken,
    canStandAt,
    findGroundOverlaps,

    /* rules */
    getReachableCells,
    canMoveTo,
    getValidTargets,
    canAttack,
    isChargeMelee,
    canChargeMelee,
    findMeleeApproachCell,
    getChargeSteps,
    markTroopActed,
    unitCanActThisRound,
    teamHasActors,
    allUnitsActedThisRound,
    setTurnModeId,
    getTurnModeId,
    RIPOSTE_DAMAGE_FACTOR,
    calculateDamage,
    getUnitArmour,
    getUnitAtkBonus,
    getUnitDefBonus,
    expireTemporaryEffects,

    /* armour, the defence stand and the riposte */
    canDefenceStand,
    makeDefenceStand,
    clearDefenceStand,
    canRiposte,
    riposteAgainst,
    DEFENCE_STAND_ARMOUR,

    /* strike classes
     *
     * Since v1.7.1 a bow reaches every living enemy on the field, so
     * getRangedReach reports RANGED_REACH for a shooter and 0 for a fighter
     * that fights with its own hands. isShielded answers the new question:
     * it is TRUE when every lane the attacker could walk is held by the other
     * army, which is the only thing that still keeps a blade from a target.
     */
    getMeleeReach,
    getRangedReach,
    getStrikeKind,
    meleeStrikeAllowed,
    meleeApproachRows,
    isShielded,
    isOccupiedByTeam,
    advanceSign,
    formatReach,
    MELEE_REACH,
    RANGED_REACH,

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
    evaluateAttackAction,
    evaluateMoveAction,
    bestAttackFrom,
    tacticalDepth,
    roundLeader,
    targetDanger,
    isVulnerableUnit,
    TACTICAL_DEPTH,
    AI_TUNING,

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

    /* battle mode and the round limit */
    getBattleMode: () => battleMode,
    isSpectatorMode: () => battleMode === "spectator",
    setBattleMode,
    startSpectatorBattle,
    getRoundLimit: () => BATTLE_ROUND_LIMIT,
    isSuddenDeath: () => suddenDeathActive,
    getTotalRemainingHp: totalRemainingHp,

    /* the duel */
    getDuelState,
    startDuel,
    startNextDuelMatch,
    duelOpenerForMatch,
    getMatchOpener: () => matchOpener,
    getDuelScoreText: duelScoreText,
    resolveRoundLimit: () => {
      const blue = getTeamUnits(TEAM_BLUE);
      const red = getTeamUnits(TEAM_RED);
      if (blue.length === 0 || red.length === 0) return "elimination";
      const blueHp = totalRemainingHp(TEAM_BLUE);
      const redHp = totalRemainingHp(TEAM_RED);
      if (blueHp === redHp) return "draw";
      return blueHp > redHp ? "blue" : "red";
    },
    runSpectatorTurn,

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

    /* Ends the azure legion's turn and resolves whatever follows it: the
     * crimson legion's answer, and the round that closes with it. The
     * suites use it to play a battle through to its end. */
    endPlayerTurnInstant: () => {
      const previous = instantTimers;
      instantTimers = true;
      try {
        endPlayerTurn();
      } finally {
        instantTimers = previous;
      }
    },

    /* Plays a whole show in one step, without the animation delays: every
     * match of the duel, one after the other. The suites use it to watch a
     * full AI against AI duel. */
    runSpectatorBattleInstant: () => {
      const previousTimers = instantTimers;
      const previousAuto = spectatorAutoAdvance;
      const previousDuelAuto = duelAutoAdvance;
      /* The show takes over: the animation timers of the opening turn are
       * dropped, so the driver below is the only thing steering it. */
      cancelPendingTimers();
      instantTimers = true;
      spectatorAutoAdvance = false;
      duelAutoAdvance = false;
      try {
        let guard = 0;
        const limit = BATTLE_ROUND_LIMIT * 40 * DUEL_MATCH_LIMIT;
        while (guard++ < limit) {
          if (!battleActive || gameState === STATE_ENDED) {
            /* A match is over. The series either goes on or it does not. */
            if (duel.active && !duel.finished) {
              startNextDuelMatch();
              continue;
            }
            break;
          }
          const team = spectatorTurnTeam;
          if (!team) break;
          runSpectatorTurn(team);
          if (gameState === STATE_ENDED) {
            if (duel.active && !duel.finished) {
              startNextDuelMatch();
              continue;
            }
            break;
          }
          const leader = roundLeader();
          const trailer = leader === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
          if (team === trailer) {
            /* The legion that answered is done: the round is over. */
            if (closeRound()) {
              if (duel.active && !duel.finished) {
                startNextDuelMatch();
                continue;
              }
              break;
            }
            spectatorTurnTeam = roundLeader();
          } else {
            spectatorTurnTeam = trailer;
          }
        }
      } finally {
        instantTimers = previousTimers;
        spectatorAutoAdvance = previousAuto;
        duelAutoAdvance = previousDuelAuto;
      }
      return { ended: gameState === STATE_ENDED, rounds: roundNumber, duel: getDuelState() };
    },

    /* Resolves one team's turn with the tactical AI in one step. The
     * balance harness uses it so the reference opponent is fought by the
     * same brain the enemy uses. */
    runTurnInstantForTeam
  };
}
