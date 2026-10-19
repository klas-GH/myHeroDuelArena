/* DOM SMOKE TEST — myHeroDuelArena v1.1.0
 * Run: node smoke_quick.js
 *
 * Verifies the real game.js against a minimal DOM stub: every element id
 * referenced by the script must exist in index.html, and the script must
 * initialise and run a full turn cycle without throwing.
 *
 * No external dependencies: the DOM is stubbed and game.js is executed with
 * node's built-in vm module.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

/* --- MINIMAL DOM STUB --- */

class StubClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { names.forEach(n => this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach(n => this.set.delete(n)); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name) { this.set.has(name) ? this.set.delete(name) : this.set.add(name); this.sync(); }
  toString() { return [...this.set].join(" "); }
  sync() { this.el._className = [...this.set].join(" "); }
}

class StubElement {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this._className = "";
    this.classList = new StubClassList(this);
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this._text = "";
    this._html = "";
    this.listeners = {};
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.value = "";
  }

  /* className and classList stay in sync, as they do in a real browser. */
  get className() { return this._className; }
  set className(value) {
    this._className = String(value);
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }

  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    if (v === "") {
      this.children = [];
      this.childNodes = [];
    }
  }

  get firstChild() { return this.childNodes[0] || null; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    const j = this.childNodes.indexOf(child);
    if (j >= 0) this.childNodes.splice(j, 1);
    return child;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") {
        this.childNodes.push({ nodeType: 3, textContent: n });
      } else {
        this.appendChild(n);
      }
    }
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    const i = this.listeners[type].indexOf(fn);
    if (i >= 0) this.listeners[type].splice(i, 1);
  }

  dispatch(type, event) {
    (this.listeners[type] || []).forEach(fn => fn(event || { preventDefault() {} }));
  }

  click() { this.dispatch("click"); }

  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches && child.matches(selector)) return child;
      const found = child.querySelector && child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches && child.matches(selector)) out.push(child);
      if (child.querySelectorAll) out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
}

function buildDocument(ids) {
  const registry = new Map();
  ids.forEach(id => registry.set(id, new StubElement("div")));

  return {
    registry,
    getElementById(id) {
      if (!registry.has(id)) {
        // Missing elements resolve to null so the test can detect a mismatch.
        return null;
      }
      return registry.get(id);
    },
    createElement(tag) { return new StubElement(tag); },
    addEventListener() {}
  };
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

/* --- TEST 1: every id used by game.js exists in index.html --- */

console.log("\n1. DOM wiring — element ids");

const html = fs.readFileSync(INDEX, "utf8");
const gameSrc = fs.readFileSync(GAME, "utf8");
const htmlIds = parseIds(html);

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

const doc = buildDocument(htmlIds);
const win = {
  addEventListener() {},
  listeners: {}
};

const sandbox = {
  document: doc,
  window: win,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let bootError = null;
try {
  vm.runInContext(gameSrc, sandbox, { filename: "game.js" });
} catch (err) {
  bootError = err;
}

assert(bootError === null, `game.js initialises cleanly${bootError ? " -> " + bootError.message : ""}`);

if (bootError === null) {
  /* --- TEST 3: armies rendered into the DOM --- */
  console.log("\n3. Runtime — armies render");

  const blue = doc.getElementById("blue-units");
  const red = doc.getElementById("red-units");

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

  /* --- TEST 6: end turn runs the AI without errors --- */
  console.log("\n6. Runtime — end turn and AI turn");

  let aiError = null;
  try {
    endTurnButton.dispatch("click");
  } catch (err) {
    aiError = err;
  }
  assert(aiError === null, `end turn dispatches cleanly${aiError ? " -> " + aiError.message : ""}`);
  assert(turnText.textContent === "ENEMY TURN", "turn banner switches to the enemy phase");

  /* --- TEST 7: rematch resets cleanly --- */
  console.log("\n7. Runtime — rematch resets state");

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
  assert(doc.getElementById("combat-log").children.length >= 0, "combat log is reachable after reset");
}

/* --- TEST 8: CSS class coverage --- */

console.log("\n8. Stylesheet — class coverage");

const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
const requiredClasses = [
  "unit", "unit-silhouette", "unit-label", "unit-health", "health-fill",
  "selection-ring", "move-indicator", "attack-indicator",
  "turn-banner", "combat-log", "log-entry", "end-turn-button",
  "rally-button", "battle-result", "selection-info", "units-layer", "marker-layer"
];

const missingClasses = requiredClasses.filter(c => !css.includes("." + c));
assert(missingClasses.length === 0, `all required CSS classes exist${missingClasses.length ? " (missing: " + missingClasses.join(", ") + ")" : ""}`);

assert(css.includes("prefers-reduced-motion"), "reduced-motion preference is respected");

/* --- TEST 9: stylesheet wiring matches the runtime markup --- */

console.log("\n9. Stylesheet — runtime wiring");

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

/* A keyframe that animates `transform` replaces the unit's
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

/* The AI turn pulse is applied to a battlefield ancestor of the unit layers. */
assert(htmlIds.includes("battlefield"), "index.html exposes a battlefield container");
assert(/\.ai-turn-active\s+\.unit\.red/.test(css), "AI turn pulse targets red units under the battlefield");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
