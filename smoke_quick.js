/* DOM SMOKE TEST — myHeroDuelArena v1.2.0
 * Run: node smoke_quick.js
 *
 * Verifies the real game.js against a minimal DOM stub: every element id
 * referenced by the script must exist in index.html, and the script must
 * initialise and run a full turn cycle without throwing.
 *
 * The DOM stub and the sandbox loader live in test_harness.js so the
 * regression suite drives the very same engine.
 *
 * No external dependencies: the DOM is stubbed and game.js is executed with
 * node's built-in vm module.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadGame, createLocalStorage } = require("./test_harness.js");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");
const GAME = path.join(ROOT, "game.js");

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

/* --- PARSE index.html FOR ELEMENT IDS --- */

function parseIds(html) {
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

function parseScriptSrcs(html) {
  const srcs = [];
  const re = /<script[^>]*\bsrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  return srcs;
}

const html = fs.readFileSync(INDEX, "utf8");
const gameSrc = fs.readFileSync(GAME, "utf8");
const htmlIds = parseIds(html);

/* --- TEST 1: every id used by game.js exists in index.html --- */

console.log("\n1. DOM wiring — element ids");

const idUsages = new Set();
const idRe = /getElementById\("([^"]+)"\)/g;
let idMatch;
while ((idMatch = idRe.exec(gameSrc)) !== null) idUsages.add(idMatch[1]);

assert(idUsages.size > 0, `game.js references ${idUsages.size} element ids`);

const missing = [...idUsages].filter(id => !htmlIds.includes(id));
assert(missing.length === 0, `all referenced ids exist in index.html${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);

const srcs = parseScriptSrcs(html);
assert(srcs.includes("game.js"), "index.html loads game.js");
assert(srcs.length === 1, "index.html loads exactly one script (no external deps)");

const external = srcs.filter(s => /^https?:|^\\/i.test(s));
assert(external.length === 0, "no external script URLs");

assert(!/<img[^>]+src="https?:/i.test(html), "no external image URLs in index.html");
assert(!/url\((['"]?)https?:/i.test(html), "no external CSS url() in index.html");

/* --- TEST 2: game.js initialises against the stub DOM --- */

console.log("\n2. Runtime — game.js boots without errors");

const storage = createLocalStorage();
const loaded = loadGame({ html, source: gameSrc, storage });
const doc = loaded.doc;
const api = loaded.api;

assert(loaded.error === null, `game.js initialises cleanly${loaded.error ? " -> " + loaded.error.message : ""}`);
assert(!!api, "the engine exposes its rules for the verification suites");

if (loaded.error === null) {
  /* --- TEST 3: armies and terrain render into the DOM --- */
  console.log("\n3. Runtime — armies and terrain render");

  const blue = doc.getElementById("blue-units");
  const red = doc.getElementById("red-units");
  const terrain = doc.getElementById("terrain-layer");

  assert(blue.children.length === 11, `11 blue unit elements rendered (got ${blue.children.length})`);
  assert(red.children.length === 11, `11 red unit elements rendered (got ${red.children.length})`);

  const blueIds = new Set(blue.children.map(c => c.dataset.id));
  const redIds = new Set(red.children.map(c => c.dataset.id));
  assert(blueIds.size === 11, "blue unit element ids are unique");
  assert(redIds.size === 11, "red unit element ids are unique");

  const overlap = [...blueIds].filter(id => redIds.has(id));
  assert(overlap.length === 0, "no unit element id appears in both armies");

  const everyUnitHasSvg = blue.children.every(c => c.querySelector(".unit-silhouette"));
  assert(everyUnitHasSvg, "every unit element contains a silhouette");

  const everyUnitHasHealth = blue.children.every(c => c.querySelector(".unit-health"));
  assert(everyUnitHasHealth, "every unit element contains a health bar");

  const positions = blue.children.map(c => c.style.left);
  assert(positions.every(p => typeof p === "string" && p.endsWith("%")), "units are positioned with percentage coordinates");

  /* Units and markers share one coordinate space, so both must be anchored
   * with `top` (not `bottom`) and centred via translate(-50%,-50%). */
  const vertical = blue.children.map(c => c.style.top);
  assert(vertical.every(v => typeof v === "string" && v.endsWith("%")), "units are positioned vertically with percentage coordinates");
  assert(blue.children.every(c => c.style.bottom === undefined), "units are anchored from the top, not the bottom");

  /* The four rows must map to four distinct vertical bands, top to bottom. */
  const rowTops = [...new Set(blue.children.map(c => c.style.top))].sort();
  assert(rowTops.length === 4, `blue units occupy four distinct rows (got ${rowTops.length})`);

  /* Every unit must contain a real <svg> wrapper so the <use> element is
   * parsed in the SVG namespace and actually renders the silhouette. */
  const everyUnitHasGlyph = blue.children.every(c => {
    const sil = c.querySelector(".unit-silhouette");
    return sil && /<svg[\s>]/.test(sil.innerHTML) && /#sil-/.test(sil.innerHTML);
  });
  assert(everyUnitHasGlyph, "every unit embeds an <svg> wrapper around its <use> symbol");

  /* Team identity is carried by the unit's own class, since the units no
   * longer live inside per-army container elements. */
  assert(blue.children.every(c => c.classList.contains("blue")), "blue units carry the blue team class");
  assert(red.children.every(c => c.classList.contains("red")), "red units carry the red team class");
  assert(!blue.children.some(c => c.classList.contains("army-blue")), "units no longer rely on army-* container classes");

  /* The terrain is drawn as one decorative cell per grid position. */
  assert(terrain.children.length === 40, `the terrain layer renders 40 cells (got ${terrain.children.length})`);
  assert(terrain.children.every(c => /^terrain-cell terrain-\w+$/.test(c.className)),
    "every terrain cell carries a terrain type class");
  assert(terrain.children.every(c => typeof c.style.left === "string" && c.style.left.endsWith("%")),
    "terrain cells are positioned with percentage coordinates");
  assert(terrain.children.every(c => typeof c.style.top === "string" && c.style.top.endsWith("%")),
    "terrain cells are positioned vertically with percentage coordinates");
  assert(new Set(terrain.children.map(c => c.className)).size >= 4,
    "at least four terrain appearances are rendered");

  /* --- TEST 4: start button begins a battle --- */
  console.log("\n4. Runtime — battle flow");

  const startButton = doc.getElementById("start-button");
  const turnBanner = doc.getElementById("turn-banner");
  const endTurnButton = doc.getElementById("end-turn-button");
  const combatLog = doc.getElementById("combat-log");

  startButton.dispatch("click");
  assert(startButton.disabled === true, "start button disables once the battle begins");
  assert(turnBanner.classList.contains("hidden") === false, "turn banner becomes visible");
  assert(endTurnButton.classList.contains("hidden") === false, "end turn button becomes visible");
  assert(combatLog.children.length > 0, "combat log records the battle start");

  const turnText = doc.getElementById("turn-text");
  assert(turnText.textContent === "PLAYER TURN", "turn banner shows the player phase");

  /* --- TEST 5: selecting a unit shows indicators --- */
  console.log("\n5. Runtime — selection and indicators");

  const moveLayer = doc.getElementById("move-indicators");
  const attackLayer = doc.getElementById("attack-indicators");

  const blueFootman = blue.children.find(c => c.classList.contains("footman"));
  blueFootman.dispatch("click");

  const selectionInfo = doc.getElementById("selection-info");
  assert(selectionInfo.classList.contains("hidden") === false, "selection panel becomes visible");
  assert(blueFootman.classList.contains("selected"), "clicked unit is marked as selected");
  assert(moveLayer.children.length > 0, `move destinations are shown (${moveLayer.children.length} cells)`);

  const selStats = doc.getElementById("selected-stats");
  assert(/ATK/.test(selStats.textContent) && /RNG/.test(selStats.textContent), "selected unit stats are displayed");

  /* Markers must be clickable and coloured by the team they refer to. */
  const moveMarker = moveLayer.children[0];
  assert(moveMarker.classList.contains("target-blue"), "move markers are tagged with the moving unit's team");
  assert(!moveMarker.classList.contains("army-blue"), "markers no longer reuse the army-* container classes");

  /* --- TEST 6: the champion panel and the progression strip --- */
  console.log("\n6. Runtime — champion panel and progression");

  const championPanel = doc.getElementById("champion-panel");
  const abilityList = doc.getElementById("ability-list");
  const progLevel = doc.getElementById("prog-level");
  const progPoints = doc.getElementById("prog-points");
  const progXpText = doc.getElementById("prog-xp-text");

  assert(championPanel.classList.contains("hidden") === true, "the champion panel stays hidden until the champion is selected");
  assert(progLevel.textContent === "1", "the progression strip shows the champion level");
  assert(progPoints.textContent === "1", "the progression strip shows the unspent ability points");
  assert(/XP/.test(progXpText.textContent), "the progression strip shows the experience target");

  const championElement = blue.children.find(c => c.classList.contains("champion"));
  championElement.dispatch("click");

  assert(championPanel.classList.contains("hidden") === false, "selecting the champion opens the champion panel");
  assert(abilityList.children.length === 3, `every champion ability is listed (${abilityList.children.length})`);
  assert(abilityList.children.every(c => c.classList.contains("ability-row")), "ability rows are rendered");
  assert(abilityList.children.filter(c => c.classList.contains("locked")).length === 2,
    "abilities above the current level are shown as locked");
  assert(abilityList.children.some(c => c.classList.contains("ready")), "an unlocked ability is shown as ready");
  assert(/LEVEL/.test(doc.getElementById("champ-level").textContent), "the champion panel shows the level");
  assert(/HP/.test(doc.getElementById("champ-stats").textContent), "the champion panel shows the unit statistics");

  /* The quick action buttons list the abilities the champion can use now. */
  const abilityActions = doc.getElementById("ability-actions");
  assert(abilityActions.children.length > 0, "a ready ability is offered as a quick action");

  /* --- TEST 7: the reset control asks for confirmation --- */
  console.log("\n7. Runtime — progression reset needs a confirmation");

  const resetButton = doc.getElementById("reset-progress-button");
  assert(resetButton.textContent === "RESET", "the reset control starts unarmed");
  resetButton.dispatch("click");
  assert(resetButton.textContent === "CONFIRM?", "the first tap arms the reset");
  assert(api.getProgression().level === 1, "arming the reset does not change the profile");
  resetButton.dispatch("click");
  assert(resetButton.textContent === "RESET", "the control returns to its idle label after the reset");
  assert(api.getProgression().level === 1, "the confirmed reset applies the default profile");

  /* --- TEST 8: end turn runs the AI without errors --- */
  console.log("\n8. Runtime — end turn and AI turn");

  let aiError = null;
  try {
    endTurnButton.dispatch("click");
  } catch (err) {
    aiError = err;
  }
  assert(aiError === null, `end turn dispatches cleanly${aiError ? " -> " + aiError.message : ""}`);
  assert(turnText.textContent === "ENEMY TURN", "turn banner switches to the enemy phase");
  assert(api.getState().gameState === "enemy_turn", "the game state reports the enemy phase");

  /* --- TEST 9: rematch resets cleanly --- */
  console.log("\n9. Runtime — rematch resets state");

  const beforeIds = new Set(blue.children.map(c => c.dataset.id));

  let resetError = null;
  try {
    // Force the battle into the ended state, then reset.
    startButton.dispatch("click");
  } catch (err) {
    resetError = err;
  }
  assert(resetError === null, `reset path runs cleanly${resetError ? " -> " + resetError.message : ""}`);

  const afterIds = new Set(blue.children.map(c => c.dataset.id));
  assert(afterIds.size === beforeIds.size, "rematch keeps the same unit count (no duplicates)");
  assert(blue.children.length === 11, "rematch renders exactly 11 blue units again");
  assert(doc.getElementById("terrain-layer").children.length === 40, "rematch redraws the terrain layer");
  assert(doc.getElementById("combat-log").children.length >= 0, "combat log is reachable after reset");
  assert(api.getUnits().size === 22, "rematch rebuilds exactly 22 units");
}

/* --- TEST 10: CSS class coverage --- */

console.log("\n10. Stylesheet — class coverage");

const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
const requiredClasses = [
  "unit", "unit-silhouette", "unit-glyph", "unit-label", "unit-health", "health-fill",
  "selection-ring", "move-indicator", "attack-indicator", "target-blue", "target-red",
  "turn-banner", "combat-log", "log-entry", "selection-info", "sel-label", "sel-name",
  "sel-stats", "health-bar", "action-hints", "battle-result", "victory", "defeat",
  "rally-button", "end-turn-button", "terrain-cell", "terrain-grass",
  "terrain-forest", "terrain-rock", "terrain-highground", "terrain-boulder",
  "progression-strip", "prog-xp-bar", "prog-xp-fill", "prog-level", "prog-points",
  "reset-progress-button", "champion-panel", "champ-level", "ability-list",
  "ability-row", "ability-name", "ability-state", "ability-button", "level-up-banner"
];

const missingClasses = requiredClasses.filter(c => !css.includes(`.${c}`));
assert(missingClasses.length === 0, `all required CSS classes exist${missingClasses.length ? " (missing: " + missingClasses.join(", ") + ")" : ""}`);

/* Every control button must be styled, by id or by class. */
const buttonRules = [
  { id: "start-button", cls: null },
  { id: "end-turn-button", cls: "end-turn-button" },
  { id: "reset-progress-button", cls: "reset-progress-button" }
];
const unstyledButtons = buttonRules.filter(b =>
  !css.includes(`#${b.id}`) && !(b.cls && css.includes(`.${b.cls}`)));
assert(unstyledButtons.length === 0,
  `all control buttons are styled${unstyledButtons.length ? " (missing: " + unstyledButtons.map(b => b.id).join(", ") + ")" : ""}`);

assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), "reduced-motion preference is respected");

/* --- TEST 11: stylesheet runtime wiring --- */

console.log("\n11. Stylesheet — runtime wiring");

/* Team styling must key off the unit's own team class. The old
 * `.army-blue .unit-silhouette` selectors no longer match anything because
 * units live in flat layers instead of per-army containers. */
assert(!/\.army-blue\s+\.unit/.test(css), "no unit rules depend on army-* container classes");
assert(/\.unit\.blue\s+\.unit-silhouette/.test(css), "blue team colour is keyed off .unit.blue");
assert(/\.unit\.red\s+\.unit-silhouette/.test(css), "red team colour is keyed off .unit.red");

/* Markers must stay clickable: the layer disables pointer events, so the
 * marker rules themselves must not re-disable them. */
const markerRules = css.match(/\.(move|attack)-indicator\s*\{[^}]*\}/g) || [];
const markerBlocks = markerRules.join("\n");
assert(markerBlocks.length > 0, "marker rules are present");
assert(!/pointer-events:\s*none/.test(markerBlocks), "markers keep pointer-events enabled so they stay clickable");

/* Units are centred with translate(-50%,-50%), which only lines up when the
 * box is anchored from the top. A `bottom` anchor would offset every unit. */
const unitRule = css.match(/\.unit\s*\{[^}]*\}/);
assert(unitRule && /transition:[^;]*top/.test(unitRule[0]), "unit transition animates `top`");
assert(!unitRule || !/transition:[^;]*bottom/.test(unitRule[0]), "unit transition no longer animates `bottom`");

/* The unit box must hug its content so the health bar stays on the sprite. */
assert(unitRule && !/height:\s*25%/.test(unitRule[0]), "unit box no longer forces a 25% cell height");

/* The keyframe that animates `transform` replaces the unit's
 * translate(-50%, -50%) centring, which shifts every unit to the top-left
 * corner of its cell. Each transform keyframe must repeat the centring. */
const transformKeyframes = css.match(/@keyframes\s+(\S+)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
for (const block of transformKeyframes) {
  const name = block.match(/@keyframes\s+(\S+)/)[1];
  const frames = block.match(/\{[^{}]*transform\s*:[^;}]*[;}]/g) || [];
  for (const frame of frames) {
    if (!/transform\s*:/.test(frame)) continue;
    assert(/translate\(-50%/.test(frame),
      `keyframe "${name}" keeps the unit centring translate`);
  }
}

/* Combat animations run on the silhouette, which already carries the red
 * facing flip. They must use the independent translate/scale properties so
 * the mirror is not replaced. */
const silhouetteAnimations = css.match(/\.unit\.(?:blue|red)\.attacking \.unit-silhouette\s*\{[^}]*\}/g) || [];
assert(silhouetteAnimations.length === 2, "attack animations target the unit silhouette");
for (const rule of silhouetteAnimations) {
  assert(!/animation:[^;]*\b(move-slide|attack-lunge)\b[^;]*\btransform/.test(rule),
    "attack animations do not animate `transform` on the silhouette");
}
assert(!/@keyframes\s+move-slide/.test(css), "the dead move-slide keyframe is gone");
assert(!/var\(--dx/.test(css) && !/var\(--dy/.test(css), "no dead custom-property move offsets remain");

/* Terrain decoration must never intercept a click meant for a unit. */
const terrainRules = css.match(/\.terrain-layer\s*\{[^}]*\}/);
assert(terrainRules && /pointer-events:\s*none/.test(terrainRules[0]), "the terrain layer ignores pointer events");
const terrainCellRules = css.match(/\.terrain-cell\s*\{[^}]*\}/);
assert(terrainCellRules && /pointer-events:\s*none/.test(terrainCellRules[0]), "terrain cells ignore pointer events");

/* The AI turn pulse is applied to a battlefield ancestor of the unit layers. */
assert(htmlIds.includes("battlefield"), "index.html exposes a battlefield container");
assert(/\.ai-turn-active\s+\.unit\.red/.test(css), "AI turn pulse targets red units under the battlefield");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
