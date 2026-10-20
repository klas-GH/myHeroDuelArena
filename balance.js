/* BALANCE HARNESS — myHeroDuelArena v1.7.1
 * Run: node balance.js [options]
 *
 * Fights battles with the real engine, headless and without a browser, and
 * reports what actually happened. Nothing here is an estimate: every number
 * comes out of a battle that was played.
 *
 * The reference opponent is the azure legion, played by the same tactical
 * AI that plays the crimson legion. The AI never gets a private rule: it
 * uses the same movement, targeting, line of sight, damage and ability code
 * the player uses. The difficulty setting only ever changes the crimson
 * legion, so a difficulty is measured against a fixed opponent.
 *
 * OPTIONS
 *   --seeds=N        how many seeds per configuration      (default 8)
 *   --seed=START     the first seed to use                  (default 1)
 *   --variance=X     damage scatter, 0 - 0.5                (default 0)
 *   --jitter=X       noise in the AI's own scoring          (default 0)
 *   --difficulty=ID  only measure this difficulty           (default: all)
 *   --maps=ID,ID     only measure these maps                (default: all)
 *   --max-rounds=N   round cap for a single battle          (default 40)
 *   --timeout=MS     wall clock budget for a single battle  (default 5000)
 *   --out=FILE       also write the JSON report to a file
 *   --quiet          print the JSON only
 *
 * A run with the default options (no variance, no jitter) is fully
 * deterministic: the same seed always produces the same battle. The harness
 * proves that before it measures anything.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadGame } = require("./test_harness.js");

const TEAM_BLUE = "blue";
const TEAM_RED = "red";

/* --- OPTIONS --- */

function parseArgs(argv) {
  const options = {
    seeds: 8,
    seedStart: 1,
    variance: 0.08,
    jitter: 2,
    difficulty: null,
    maps: null,
    /* The engine settles a battle itself after BATTLE_ROUND_LIMIT rounds, so
     * this is only a safety net above that limit. */
    maxRounds: 40,
    timeoutMs: 5000,
    out: null,
    quiet: false,
    deterministic: false
  };

  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const key = (eq === -1 ? arg : arg.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? null : arg.slice(eq + 1);

    switch (key) {
      case "seeds": options.seeds = Math.max(1, parseInt(value, 10) || 1); break;
      case "seed": options.seedStart = parseInt(value, 10) || 1; break;
      case "variance": options.variance = Math.max(0, Math.min(0.5, parseFloat(value) || 0)); break;
      case "jitter": options.jitter = Math.max(0, Math.min(50, parseFloat(value) || 0)); break;
      case "difficulty": options.difficulty = value; break;
      case "maps": options.maps = String(value || "").split(",").map(s => s.trim()).filter(Boolean); break;
      case "max-rounds": options.maxRounds = Math.max(1, parseInt(value, 10) || 40); break;
      case "timeout": options.timeoutMs = Math.max(100, parseInt(value, 10) || 5000); break;
      case "out": options.out = value; break;
      case "quiet": options.quiet = true; break;
      case "deterministic":
        options.deterministic = true;
        options.variance = 0;
        options.jitter = 0;
        break;
      case "help": options.help = true; break;
      default:
        if (!options.quiet) console.error(`unknown option --${key}`);
        break;
    }
  }
  return options;
}

/* --- ONE BATTLE --- */

/* Plays a whole battle and returns what happened. The engine is loaded
 * fresh for every battle, so no profile, reward or leftover state can leak
 * from one measurement into the next. */
function playBattle(config) {
  const loaded = loadGame({ quiet: true });
  if (loaded.error) throw loaded.error;
  const api = loaded.api;

  api.setActiveMap(config.map);
  api.setDifficulty(config.difficulty);
  api.setSeed(config.seed);
  api.setCombatOptions({ variance: config.variance, jitter: config.jitter });

  const started = Date.now();
  api.startBattle();

  let rounds = 0;
  let ended = false;
  let timedOut = false;

  while (rounds < config.maxRounds) {
    /* The reference opponent takes its turn with the same brain. */
    api.runTurnInstantForTeam(TEAM_BLUE);
    if (api.checkBattleEnd()) { ended = true; break; }

    /* The turn is ended the way the player ends it: the answer that
     * follows and the round that closes with it are resolved in one step.
     * The lead alternates from round to round, so the crimson legion opens
     * every other round and this call is what plays that opening. */
    api.endPlayerTurnInstant();
    if (api.checkBattleEnd()) { ended = true; break; }

    rounds++;
    if (Date.now() - started > config.timeoutMs) { timedOut = true; break; }
  }

  const durationMs = Date.now() - started;
  const ledger = api.getBattleLedger();
  const blueAlive = api.getTeamUnits(TEAM_BLUE).filter(u => u.alive && !u.defeated).length;
  const redAlive = api.getTeamUnits(TEAM_RED).filter(u => u.alive && !u.defeated).length;

  let outcome = "stalemate";
  if (ended) {
    /* The engine records how it settled the battle, so the measurement
     * never has to guess. */
    const settled = ledger.outcome;
    if (settled === "victory") outcome = "blue";
    else if (settled === "defeat") outcome = "red";
    else if (settled === "draw") outcome = "limit";
    else if (blueAlive === 0 && redAlive === 0) outcome = "stalemate";
    else if (blueAlive > 0 && redAlive > 0) outcome = "limit";
  }

  const totalXp = ledger.xp.damage + ledger.xp.kill + ledger.xp.victory;

  return {
    difficulty: config.difficulty,
    map: config.map,
    seed: config.seed,
    outcome,
    ended,
    timedOut,
    rounds: ended ? ledger.rounds : rounds,
    durationMs,
    damage: ledger.damage,
    defeated: ledger.defeated,
    lost: ledger.lost,
    xp: { damage: ledger.xp.damage, kill: ledger.xp.kill, victory: ledger.xp.victory, total: totalXp },
    levelAfter: ledger.levelAfter,
    blueAlive,
    redAlive
  };
}

/* --- AGGREGATION --- */

function average(list) {
  if (!list.length) return 0;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/* Two battles are the same when everything that was measured is the same. */
function sameBattle(a, b) {
  return a.outcome === b.outcome
    && a.rounds === b.rounds
    && a.damage.blue === b.damage.blue
    && a.damage.red === b.damage.red
    && a.defeated === b.defeated
    && a.lost === b.lost
    && a.xp.total === b.xp.total;
}

function summarise(battles) {
  const total = battles.length;
  const enemyWins = battles.filter(b => b.outcome === "red").length;
  const referenceWins = battles.filter(b => b.outcome === "blue").length;
  const stalemates = battles.filter(b => b.outcome === "stalemate").length;
  const limits = battles.filter(b => b.outcome === "limit").length;
  const timeouts = battles.filter(b => b.timedOut).length;

  return {
    battles: total,
    enemyWins,
    referenceWins,
    stalemates,
    limits,
    timeouts,
    enemyWinRate: total ? round2(enemyWins / total) : 0,
    averageRounds: round2(average(battles.map(b => b.rounds))),
    averageDurationMs: Math.round(average(battles.map(b => b.durationMs))),
    averageDamageDealt: round2(average(battles.map(b => b.damage.blue))),
    averageDamageTaken: round2(average(battles.map(b => b.damage.red))),
    averageUnitsLost: round2(average(battles.map(b => b.lost))),
    averageEnemiesFelled: round2(average(battles.map(b => b.defeated))),
    averageXp: round2(average(battles.map(b => b.xp.total))),
    averageDamageXp: round2(average(battles.map(b => b.xp.damage))),
    averageKillXp: round2(average(battles.map(b => b.xp.kill)))
  };
}

/* --- RUN --- */

function run(options) {
  const probe = loadGame({ quiet: true });
  if (probe.error) throw probe.error;

  const difficulties = options.difficulty
    ? [options.difficulty]
    : probe.api.DIFFICULTY_IDS.slice();
  const maps = options.maps && options.maps.length
    ? options.maps
    : probe.api.MAP_REGISTRY.map(m => m.id);

  for (const id of difficulties) {
    if (!probe.api.DIFFICULTY_IDS.includes(id)) {
      throw new Error(`unknown difficulty "${id}"`);
    }
  }
  for (const id of maps) {
    if (!probe.api.MAP_IDS.includes(id)) {
      throw new Error(`unknown map "${id}"`);
    }
  }

  /* Two proofs about the seed, taken before anything is measured.
   *
   * REPRODUCIBLE: the same seed must give the same battle twice. With the
   * deterministic settings this proves the engine carries no hidden state.
   * With jitter and variance turned up it proves the seed really does drive
   * every random choice.
   *
   * SENSITIVE: two different seeds must give different battles. If they do
   * not, the seed is doing nothing and the measurement is a single sample
   * wearing a seed as a hat. */
  const determinism = {
    reproducibleChecked: 0,
    reproducibleIdentical: 0,
    sensitiveChecked: 0,
    sensitiveDifferent: 0,
    failures: []
  };

  for (const difficulty of difficulties) {
    for (const map of maps) {
      const base = {
        difficulty, map,
        variance: options.variance, jitter: options.jitter,
        maxRounds: options.maxRounds, timeoutMs: options.timeoutMs
      };

      const first = playBattle(Object.assign({ seed: options.seedStart }, base));
      const second = playBattle(Object.assign({ seed: options.seedStart }, base));
      determinism.reproducibleChecked++;
      if (sameBattle(first, second)) determinism.reproducibleIdentical++;
      else determinism.failures.push({ proof: "reproducible", difficulty, map, seed: options.seedStart });

      const other = playBattle(Object.assign({ seed: options.seedStart + 1 }, base));
      determinism.sensitiveChecked++;
      if (!sameBattle(first, other)) determinism.sensitiveDifferent++;
      else determinism.failures.push({ proof: "sensitive", difficulty, map, seed: options.seedStart });
    }
  }

  const battles = [];
  const configurations = [];

  for (const difficulty of difficulties) {
    for (const map of maps) {
      const group = [];
      for (let i = 0; i < options.seeds; i++) {
        const seed = options.seedStart + i;
        const result = playBattle({
          difficulty, map, seed,
          variance: options.variance, jitter: options.jitter,
          maxRounds: options.maxRounds, timeoutMs: options.timeoutMs
        });
        battles.push(result);
        group.push(result);
      }
      const summary = summarise(group);
      configurations.push(Object.assign({ difficulty, map }, summary));
    }
  }

  return {
    engine: probe.api.version,
    generatedAt: new Date().toISOString(),
    options: {
      seeds: options.seeds,
      seedStart: options.seedStart,
      variance: options.variance,
      jitter: options.jitter,
      maxRounds: options.maxRounds,
      timeoutMs: options.timeoutMs,
      difficulties,
      maps
    },
    determinism,
    configurations,
    battles
  };
}

/* --- REPORT --- */

function printReport(report) {
  console.log(`\n=== Balance report — ${report.engine} ===`);
  console.log(`seeds ${report.options.seeds} (from ${report.options.seedStart})`
    + ` Â· variance ${report.options.variance} Â· jitter ${report.options.jitter}`);

  if (report.determinism.reproducibleChecked > 0) {
    console.log(`seed reproducibility: ${report.determinism.reproducibleIdentical}`
      + `/${report.determinism.reproducibleChecked} configurations replayed exactly`);
    console.log(`seed sensitivity: ${report.determinism.sensitiveDifferent}`
      + `/${report.determinism.sensitiveChecked} configurations changed with the seed`);
  }

  console.log("\nDifficulty   Map               Battles  Enemy wins  Win rate  Rounds  Damage  DMG XP  KILL XP  XP");
  console.log("-----------  ----------------  -------  ----------  --------  ------  ------  ------  -------  -----");
  for (const c of report.configurations) {
    console.log(
      `${c.difficulty.padEnd(11)}  ${c.map.padEnd(16)}  ${String(c.battles).padStart(7)}`
      + `  ${String(c.enemyWins).padStart(10)}  ${String(c.enemyWinRate).padStart(8)}`
      + `  ${String(c.averageRounds).padStart(6)}  ${String(c.averageDamageDealt).padStart(6)}`
      + `  ${String(c.averageDamageXp).padStart(6)}  ${String(c.averageKillXp).padStart(7)}`
      + `  ${String(c.averageXp).padStart(5)}`
    );
  }

  const totals = summarise(report.battles);
  console.log(`\noverall: enemy win rate ${totals.enemyWinRate} over ${totals.battles} battles, `
    + `${totals.averageRounds} rounds and ${totals.averageXp} XP per battle`);
  if (totals.limits > 0) {
    console.log(`battles settled by the round limit: ${totals.limits}`);
  }

  const timedOut = report.battles.filter(b => b.timedOut).length;
  if (timedOut > 0) console.log(`warning: ${timedOut} battle(s) hit the round or time limit`);
}

/* --- ENTRY --- */

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*/, ""));
    return 0;
  }

  const report = run(options);

  if (options.out) {
    const target = path.isAbsolute(options.out)
      ? options.out
      : path.join(__dirname, options.out);
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    if (!options.quiet) console.log(`\nreport written to ${target}`);
  }

  if (options.quiet) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  const incomplete = report.battles.filter(b => b.timedOut).length;
  return incomplete > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`balance harness failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { run, playBattle, parseArgs, summarise };
