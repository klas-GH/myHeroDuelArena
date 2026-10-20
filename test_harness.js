/* SHARED TEST HARNESS — myHeroDuelArena
 *
 * Provides the minimal DOM stub and the sandbox loader used by the
 * verification suites.
 *
 * The suites drive the REAL game.js through this harness instead of keeping
 * a mirrored copy of the rules. A mirror can drift from the game and then
 * pass tests that the shipped code would fail, so the engine is loaded once
 * here and exercised directly.
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

/* --- MINIMAL DOM STUB --- */

class StubClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { names.forEach(n => this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach(n => this.set.delete(n)); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  toString() { return [...this.set].join(" "); }
  sync() { this.el._className = [...this.set].join(" "); }
}

/* The inline style of an element. The browser stores the custom properties
 * in the same bag as the ordinary ones, so the stub does the same. */
class StubStyle {
  constructor() {
    Object.defineProperty(this, "_props", { value: {}, enumerable: false, writable: true });
  }
  setProperty(name, value) {
    this._props[name] = String(value);
    this[name] = String(value);
  }
  getPropertyValue(name) {
    return this._props[name] !== undefined ? this._props[name] : "";
  }
  removeProperty(name) {
    const value = this.getPropertyValue(name);
    delete this._props[name];
    delete this[name];
    return value;
  }
}

class StubElement {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this._className = "";
    this.classList = new StubClassList(this);
    this.style = new StubStyle();
    this.dataset = {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this._text = "";
    this._html = "";
    this.listeners = {};
    this.attributes = {};
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.value = "";
    this.offsetWidth = 0;
    this.offsetHeight = 0;
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

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
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

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
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

  focus() {}
  blur() {}

  contains(node) {
    if (node === this) return true;
    return this.children.some(c => c.contains && c.contains(node));
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }

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

/* Parses the elements of index.html so the stub can reproduce their tag,
 * class and static text. Without this the stub would hand the game a set of
 * blank <div>s and any assertion about rendered copy would be meaningless. */
function parseElements(html) {
  const elements = new Map();
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\sid="([^"]+)"((?:\s+[^>]*?)?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1];
    const attrs = m[2] + " " + (m[4] || "");
    const classMatch = attrs.match(/class="([^"]*)"/);
    const rest = html.slice(m.index + m[0].length);
    const closeIdx = rest.toLowerCase().indexOf("</" + tag.toLowerCase());
    const inner = closeIdx === -1 ? rest : rest.slice(0, closeIdx);
    const text = inner.replace(/<[^>]*>/g, "").trim();
    elements.set(m[3], {
      tag,
      className: classMatch ? classMatch[1] : "",
      text,
      innerHTML: inner
    });
  }
  return elements;
}

function buildDocument(ids, elements) {
  const registry = new Map();
  ids.forEach(id => {
    const el = new StubElement("div");
    const meta = elements && elements.get(id);
    if (meta) {
      el.tagName = meta.tag.toUpperCase();
      el.className = meta.className;
      el._text = meta.text;
      el._html = meta.innerHTML;
    }
    registry.set(id, el);
  });

  return {
    registry,
    getElementById(id) {
      // Missing elements resolve to null so the test can detect a mismatch.
      return registry.has(id) ? registry.get(id) : null;
    },
    createElement(tag) { return new StubElement(tag); },
    addEventListener() {}
  };
}

/* --- LOCAL STORAGE STUB --- */

function createLocalStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); },
    key(i) {
      const keys = [...data.keys()];
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    get length() { return data.size; },
    _data: data
  };
}

/* --- HTML HELPERS --- */

function parseIds(html) {
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

/* --- SANDBOX LOADER --- */

/* Loads game.js into a fresh vm context and returns the sandbox plus the
 * engine API the game exposes on `window.MyHeroDuelArena`.
 *
 * options.storage  — a localStorage-shaped object, or null to simulate
 *                    storage being unavailable.
 * options.throwOnWrite — when true, setItem throws (simulates a private
 *                    browsing mode that blocks writes).
 */
function loadGame(options) {
  const opts = options || {};
  const html = opts.html !== undefined ? opts.html : fs.readFileSync(INDEX, "utf8");
  const source = opts.source !== undefined ? opts.source : fs.readFileSync(GAME, "utf8");
  const ids = opts.ids || parseIds(html);
  const elements = parseElements(html);

  const doc = buildDocument(ids, elements);

  let storage = opts.storage !== undefined ? opts.storage : createLocalStorage();
  if (opts.throwOnWrite && storage && storage.setItem) {
    const rawSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => { throw new Error("storage write blocked"); };
    storage._rawSet = rawSet;
  }

  const win = {
    addEventListener() {},
    removeEventListener() {},
    listeners: {},
    localStorage: storage,
    matchMedia() { return { matches: false, addListener() {}, removeListener() {} }; },
    innerWidth: 1280,
    innerHeight: 900
  };

  const sandbox = {
    document: doc,
    window: win,
    console: opts.quiet ? Object.assign({}, console, { log() {} }) : console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    Math,
    Date,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Infinity,
    NaN,
    isNaN,
    parseInt,
    parseFloat,
    Error,
    TypeError,
    localStorage: storage
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  let error = null;
  try {
    vm.runInContext(source, sandbox, { filename: "game.js" });
  } catch (err) {
    error = err;
  }

  return {
    sandbox,
    win,
    doc,
    storage,
    error,
    api: win.MyHeroDuelArena || null
  };
}

module.exports = {
  ROOT,
  INDEX,
  GAME,
  StubClassList,
  StubElement,
  buildDocument,
  createLocalStorage,
  parseIds,
  parseElements,
  loadGame
};
