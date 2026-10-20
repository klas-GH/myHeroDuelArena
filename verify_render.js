/* RENDER VERIFICATION — myHeroDuelArena v1.7.1
 * Run: node verify_render.js
 *
 * Drives the real page in headless Edge via the DevTools protocol and checks
 * the computed geometry of the rendered battlefield: that silhouettes resolve
 * to real SVG geometry, that units sit inside their grid cells, and that the
 * team colours and the red facing flip are applied.
 */

"use strict";

const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");

const ROOT = __dirname;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PAGE = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

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

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.on("connect", () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("browser did not start"));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

/* Minimal DevTools protocol client over the raw WebSocket framing. */
class CDP {
  constructor(url) {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1];
    this.port = Number(m[2]);
    this.path = m[3];
    this.id = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const sock = net.connect(this.port, this.host, () => {
        sock.write(
          `GET ${this.path} HTTP/1.1\r\n` +
          `Host: ${this.host}:${this.port}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      let handshakeDone = false;
      let buffer = Buffer.alloc(0);
      this.sock = sock;

      sock.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);

        if (!handshakeDone) {
          const idx = buffer.indexOf("\r\n\r\n");
          if (idx === -1) return;
          const headers = buffer.slice(0, idx).toString();
          if (!/101/.test(headers.split("\r\n")[0])) {
            reject(new Error("websocket upgrade failed: " + headers.split("\r\n")[0]));
            return;
          }
          buffer = buffer.slice(idx + 4);
          handshakeDone = true;
          resolve();
        }

        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0f;
          let len = buffer[1] & 0x7f;
          let offset = 2;

          if (len === 126) {
            if (buffer.length < 4) return;
            len = buffer.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buffer.length < 10) return;
            len = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }

          if (buffer.length < offset + len) return;
          const payload = buffer.slice(offset, offset + len);
          buffer = buffer.slice(offset + len);

          if (opcode === 1) this.handleMessage(payload.toString());
        }
      });

      sock.on("error", reject);
    });
  }

  handleMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  frame(text) {
    const payload = Buffer.from(text, "utf8");
    const mask = crypto.randomBytes(4);
    let header;

    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ mask[i % 4];
    }
    return Buffer.concat([header, mask, masked]);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(this.frame(JSON.stringify({ id, method, params })));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception
        ? res.exceptionDetails.exception.description
        : "evaluation failed");
    }
    return res.result.value;
  }

  /* A real mouse click at screen coordinates. Synthetic DOM events skip the
   * hit test, so they cannot tell whether the click actually reaches the
   * unit that is drawn on the field. */
  async mouseClick(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1
    });
  }

  close() {
    try { this.sock.destroy(); } catch (e) { /* already closed */ }
  }
}

/* Picks a free TCP port so parallel or leftover browsers can never be
 * mistaken for the one this run started. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/* Kills any browser left behind by an earlier run of this script. */
function killStaleBrowsers() {
  return new Promise(resolve => {
    const killer = spawn("taskkill", ["/F", "/T", "/IM", "msedge.exe"], { stdio: "ignore" });
    killer.on("exit", () => resolve());
    killer.on("error", () => resolve());
    setTimeout(resolve, 5000);
  });
}

async function main() {
  if (!fs.existsSync(EDGE)) {
    console.error("Edge not found at " + EDGE);
    process.exit(1);
  }

  await killStaleBrowsers();

  const profile = path.join(os.tmpdir(), "myHeroDuelArena-edge-verify");
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (e) { /* stale profile */ }
  const port = await findFreePort();
  const browser = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile,
    "--window-size=1280,900",
    "--allow-file-access-from-files",
    PAGE
  ], { stdio: "ignore" });

  let cdp;
  let fatal = null;
  try {
    await waitForPort(port, 20000);
    /* The browser this run started must still be alive, otherwise the
     * connection would belong to a leftover instance. */
    if (browser.exitCode !== null) {
      throw new Error("the browser exited before the checks could run");
    }
    await new Promise(r => setTimeout(r, 1200));

    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) throw new Error("no page target found");

    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    /* Headless Edge reports prefers-reduced-motion: reduce, which switches
     * every animation off and hides transform bugs. Force the normal setting
     * so the checks below run against the animated layout a real user sees. */
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log("\n1. Rendering — silhouettes resolve to real SVG geometry");

    /* The troops walk onto the field when the page opens. A measurement
     * taken in the middle of that entrance catches a troop that is still
     * gliding in, so the checks wait for the army to take its place. */
    const settled = await cdp.evaluate(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 60; i++) {
        const walking = [...document.querySelectorAll('.unit')].some(u =>
          u.getAnimations().some(a => a.animationName === 'arrive' && a.playState === 'running'));
        if (!walking) return { ok: true, waited: i * 100 };
        await wait(100);
      }
      return { ok: false, waited: 6000 };
    })()`);

    assert(settled.ok === true, `the army finished taking its place on the field (${settled.waited}ms)`);

    const glyph = await cdp.evaluate(`(() => {
      const sil = document.querySelector('.unit-silhouette');
      if (!sil) return { error: 'no silhouette' };
      const use = sil.querySelector('use');
      const svg = sil.querySelector('svg');
      if (!use) return { error: 'no use element' };
      const box = use.getBoundingClientRect();
      const parent = sil.getBoundingClientRect();
      return {
        useIsSvg: use instanceof SVGElement,
        useNamespace: use.namespaceURI,
        href: use.getAttribute('href'),
        hasSvgWrapper: !!svg,
        wrapperTag: svg ? svg.tagName : null,
        wrapperWidth: svg ? svg.getBoundingClientRect().width : 0,
        wrapperHeight: svg ? svg.getBoundingClientRect().height : 0,
        silWidth: parent.width,
        silHeight: parent.height
      };
    })()`);

    assert(!glyph.error, `silhouette structure is intact${glyph.error ? " -> " + glyph.error : ""}`);
    assert(glyph.useIsSvg === true, "<use> is a real SVG element (not an HTML unknown element)");
    assert(glyph.useNamespace === "http://www.w3.org/2000/svg", `<use> is in the SVG namespace (got ${glyph.useNamespace})`);
    assert(glyph.hasSvgWrapper === true, "silhouette is wrapped in an <svg> element");
    assert(glyph.wrapperWidth > 0 && glyph.wrapperHeight > 0, `<svg> wrapper renders with non-zero size (${glyph.wrapperWidth}x${glyph.wrapperHeight})`);
    assert(glyph.wrapperWidth >= glyph.silWidth * 0.9, "<svg> wrapper fills the silhouette box");

    console.log("\n2. Rendering — the troop artwork is in the DOM and sized");

    const artStats = await cdp.evaluate(`(() => {
      const units = [...document.querySelectorAll('.unit')];
      const out = {
        total: units.length,
        loaded: 0,
        sized: 0,
        wrongSrc: [],
        noFallback: 0,
        min: Infinity,
        championArt: 0,
        otherArt: Infinity,
        types: []
      };
      for (const u of units) {
        const type = u.classList[1];
        const team = u.classList[2];
        const img = u.querySelector('img.unit-image');
        const art = u.querySelector('.unit-art');
        const glyph = u.querySelector('.unit-glyph');

        out.types.push(type + '-' + team);
        if (!img || !art) {
          out.wrongSrc.push(u.dataset.id + ':no-art');
          continue;
        }
        const want = 'assets/troops/' + type + '-' + team + '.png';
        if (img.getAttribute('src') !== want) {
          out.wrongSrc.push(u.dataset.id + ':' + img.getAttribute('src'));
        }
        if (!glyph) out.noFallback++;
        if (img.complete && img.naturalWidth > 0) out.loaded++;

        const r = art.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          out.sized++;
          out.min = Math.min(out.min, Math.min(r.width, r.height));
          if (u.classList.contains('champion')) {
            out.championArt = Math.max(out.championArt, r.height);
          } else {
            out.otherArt = Math.min(out.otherArt, r.height);
          }
        }
      }
      return out;
    })()`);

    assert(artStats.total === 14, `all 14 troops are in the DOM (got ${artStats.total})`);
    assert(artStats.wrongSrc.length === 0,
      `every troop points at its own picture (${JSON.stringify(artStats.wrongSrc)})`);
    assert(artStats.loaded === 14, `all 14 troop pictures loaded (got ${artStats.loaded})`);
    assert(artStats.sized === 14, `all 14 troop pictures render with non-zero size (got ${artStats.sized})`);
    assert(artStats.noFallback === 0, `every troop keeps its inline fallback glyph (${artStats.noFallback} missing)`);
    assert(artStats.min >= 20, `the troop pictures stay legible (smallest ${artStats.min.toFixed(1)}px)`);
    assert(artStats.championArt > artStats.otherArt * 1.05,
      `the champion is drawn larger than the rank (${artStats.championArt.toFixed(1)}px vs ${artStats.otherArt.toFixed(1)}px)`);
    assert(new Set(artStats.types).size === 10,
      `the army uses ten different pictures (${new Set(artStats.types).size})`);

    console.log("\n3. Layout — units sit inside the battlefield");

    const layout = await cdp.evaluate(`(() => {
      const field = document.getElementById('battlefield');
      const fr = field.getBoundingClientRect();
      const units = [...document.querySelectorAll('.unit')];
      const labels = [...document.querySelectorAll('.army')].map(a => a.getBoundingClientRect());
      const rows = new Map();
      let outside = 0;
      let overflowTop = 0;
      let overflowBottom = 0;
      let artOutside = 0;
      let labelClash = 0;
      let overlaysOutside = 0;

      for (const u of units) {
        const r = u.getBoundingClientRect();
        if (r.top < fr.top - 1) overflowTop++;
        if (r.bottom > fr.bottom + 1) overflowBottom++;

        /* The picture may not leave the field, and it may not cover the
         * army names that stand above the ground. */
        const art = u.querySelector('.unit-art').getBoundingClientRect();
        if (art.top < fr.top - 1 || art.bottom > fr.bottom + 1) artOutside++;
        for (const l of labels) {
          const overlaps = art.right > l.left && art.left < l.right &&
            art.bottom > l.top && art.top < l.bottom;
          if (overlaps) labelClash++;
        }

        /* The name and the health bar are drawn over the troop, in the
         * overlay layer, so they have to stay on the field as well. */
        const layer = u.closest('.units-layer');
        const lr = layer.getBoundingClientRect();
        const centre = r.top + r.height / 2;
        const key = Math.round(((centre - lr.top) / lr.height) * 4);
        rows.set(key, (rows.get(key) || 0) + 1);
      }

      /* The name and the health bar of every troop live in the overlay
       * layer above the pictures, and they have to stay on the field. */
      for (const o of document.querySelectorAll('.unit-overlay')) {
        for (const part of [o.querySelector('.unit-label'), o.querySelector('.unit-health')]) {
          if (!part) { overlaysOutside++; continue; }
          const p = part.getBoundingClientRect();
          if (p.top < fr.top - 1 || p.bottom > fr.bottom + 1) overlaysOutside++;
        }
      }
      return {
        rowKeys: [...rows.keys()].sort((a,b)=>a-b),
        counts: [...rows.values()],
        overflowTop,
        overflowBottom,
        artOutside,
        labelClash,
        overlaysOutside
      };
    })()`);

    assert(layout.rowKeys.length === 4, `units occupy exactly four distinct rows (got ${layout.rowKeys.length}: ${layout.rowKeys})`);
    assert(layout.overflowTop === 0, `no unit overflows the top of the battlefield (got ${layout.overflowTop})`);
    assert(layout.overflowBottom === 0, `no unit overflows the bottom of the battlefield (got ${layout.overflowBottom})`);
    assert(layout.artOutside === 0, `every troop picture stays inside the battlefield (got ${layout.artOutside} outside)`);
    assert(layout.labelClash === 0, `no troop picture covers the army names (got ${layout.labelClash} clashes)`);
    assert(layout.overlaysOutside === 0, `every name and health bar stays on the field (got ${layout.overlaysOutside} outside)`);

    console.log("\n4. Layout — unit and marker cells agree");

    /* Units are anchored with translate(-50%, -50%) so that the box centre
     * lands on the cell centre. Any animation that replaces `transform`
     * silently breaks that anchor, so the check runs with animations live.
     *
     * A troop that stands on one column is centred on its cell. The champion
     * is drawn across two columns, so it stands on the border between them
     * and still keeps the cell it occupies as its anchor. */
    const centred = await cdp.evaluate(`(() => {
      const out = { checked: 0, worst: 0, worstCls: null, champions: 0, spans: new Set() };
      for (const u of document.querySelectorAll('.unit')) {
        const layer = u.closest('.units-layer');
        const lr = layer.getBoundingClientRect();
        const r = u.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        const col = Number(u.dataset.col);
        const row = Number(u.dataset.row);
        const span = Number(u.dataset.span) || 1;
        out.spans.add(span);
        if (span > 1) out.champions++;

        /* The picture leans towards the enemy, so the blue champion sits on
         * the right border of its column and the red one on the left. */
        const dir = u.classList.contains('red') ? -1 : 1;
        const colPct = ((col + 0.5) / 10) * 100 + (span - 1) * 0.5 * 10 * dir;
        const rowPct = 100 - ((row + 0.5) / 4) * 100;

        const gx = lr.left + (colPct / 100) * lr.width;
        const gy = lr.top + (rowPct / 100) * lr.height;
        const d = Math.hypot(cx - gx, cy - gy);
        out.checked++;
        if (d > out.worst) { out.worst = d; out.worstCls = u.className; }
      }
      return { checked: out.checked, worst: out.worst, worstCls: out.worstCls, champions: out.champions, spans: [...out.spans] };
    })()`);

    assert(centred.checked === 14, `all units were measured (${centred.checked})`);
    assert(centred.champions === 2, `both armies field one champion (${centred.champions})`);
    assert(centred.spans.length === 2 && centred.spans.includes(1) && centred.spans.includes(2),
      `only the champion is drawn across two columns (${centred.spans})`);
    assert(centred.worst < 3, `every unit is centred on its grid cell (worst offset ${centred.worst.toFixed(2)}px${centred.worstCls ? " on " + centred.worstCls : ""})`);

    const motion = await cdp.evaluate(`(() => ({
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animated: document.querySelector('.unit').getAnimations().length > 0
    }))()`);

    assert(motion.reduced === false, "the page is checked with animations enabled");
    assert(motion.animated === true, "unit animations are running during the check");

    console.log("\n5. Layout — unit and marker cells agree");

    /* Markers only exist once a unit is selected, so start the battle and
     * select a unit before comparing the two coordinate spaces. Move markers
     * point at empty cells, so they are checked against the grid itself
     * rather than against unit positions. */
     const agree = await cdp.evaluate(`(() => {
      document.getElementById('start-button').click();
      const u = document.querySelector('.unit.blue');
      u.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const out = { checked: 0, mismatched: 0, worst: 0 };
      const markers = [...document.querySelectorAll('.move-indicator, .attack-indicator')];
      for (const m of markers) {
        const mr = m.getBoundingClientRect();
        const mx = mr.left + mr.width / 2;
        const my = mr.top + mr.height / 2;

        const layer = m.closest('.marker-layer');
        const lr = layer.getBoundingClientRect();

        // Grid cell centres, expressed relative to the shared field layer.
        let bestD = Infinity;
        for (let c = 0; c < 10; c++) {
          for (let r = 0; r < 4; r++) {
            const cx = lr.left + ((c + 0.5) / 10) * lr.width;
            const cy = lr.top + ((r + 0.5) / 4) * lr.height;
            bestD = Math.min(bestD, Math.hypot(mx - cx, my - cy));
          }
        }
        out.checked++;
        out.worst = Math.max(out.worst, bestD);
        if (bestD > 2) out.mismatched++;
      }
      const api = window.MyHeroDuelArena;
      out.diag = {
        unitClass: u.className,
        state: api.getState ? api.getState() : null,
        selected: document.querySelectorAll('.unit.selected').length,
        unitCount: document.querySelectorAll('.unit').length
      };
      return out;
    })()`);

    assert(agree.checked > 0, `markers were rendered and measured (${agree.checked}) ${JSON.stringify(agree.diag)}`);
    assert(agree.mismatched === 0, `every marker sits on a grid cell centre (${agree.mismatched} mismatched, worst offset ${agree.worst.toFixed(2)}px)`);

    console.log("\n6. Styling — team identity and facing");

    const styling = await cdp.evaluate(`(() => {
      const blue = document.querySelector('.unit.blue .unit-silhouette');
      const red  = document.querySelector('.unit.red .unit-silhouette');
      const blueArt = document.querySelector('.unit.blue .unit-art');
      const redArt  = document.querySelector('.unit.red .unit-art');
      const mBlue = getComputedStyle(blue);
      const mRed  = getComputedStyle(red);
      return {
        blueColor: mBlue.color,
        redColor: mRed.color,
        blueTransform: getComputedStyle(blueArt).transform,
        redTransform: getComputedStyle(redArt).transform
      };
    })()`);

    assert(styling.blueColor !== styling.redColor, `blue and red units have different colours (${styling.blueColor} vs ${styling.redColor})`);
    assert(styling.redTransform.includes("-1"), `red units are mirrored to face left (${styling.redTransform})`);
    assert(!styling.blueTransform.includes("-1"), `blue units are not mirrored (${styling.blueTransform})`);

    /* Combat animations must not clobber the facing flip, so they use the
     * independent translate/scale properties instead of `transform`. */
    const facing = await cdp.evaluate(`(() => {
      const redUnit = document.querySelector('.unit.red');
      const art = redUnit.querySelector('.unit-art');
      const read = () => getComputedStyle(art).transform;

      const idle = read();
      redUnit.classList.add('attacking');
      const attacking = read();
      redUnit.classList.remove('attacking');
      redUnit.classList.add('defeated');
      const defeated = read();
      redUnit.classList.remove('defeated');
      return { idle, attacking, defeated };
    })()`);

    assert(facing.attacking.includes("-1"), `the red facing flip survives the attack animation (${facing.attacking})`);
    assert(facing.defeated.includes("-1"), `the red facing flip survives the defeat animation (${facing.defeated})`);

    console.log("\n7. Interaction — a unit can be selected and acted on");

    const started = await cdp.evaluate(`(() => {
      const u = document.querySelector('.unit.blue');
      u.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const info = document.getElementById('selection-info');
      return {
        bannerVisible: !document.getElementById('turn-banner').classList.contains('hidden'),
        isSelected: u.classList.contains('selected'),
        panelVisible: !info.classList.contains('hidden'),
        name: document.getElementById('selected-name').textContent,
        stats: document.getElementById('selected-stats').textContent,
        moveMarkers: document.querySelectorAll('.move-indicator').length,
        attackMarkers: document.querySelectorAll('.attack-indicator').length
      };
    })()`);

    assert(started.bannerVisible === true, "the turn banner is visible during the battle");
    assert(started.isSelected === true, "clicking a blue unit marks it selected");
    assert(started.panelVisible === true, "the selection panel becomes visible");
    assert(/ATK/.test(started.stats), "the selection panel shows unit stats");
    assert(started.moveMarkers > 0, `move indicators are rendered (${started.moveMarkers})`);

    console.log("\n8. Interaction — markers are clickable");

    const clickable = await cdp.evaluate(`(() => {
      const m = document.querySelector('.move-indicator');
      if (!m) return { error: 'no marker' };
      const r = m.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return {
        hitIsMarker: el === m,
        hitTag: el ? (el.className || el.tagName) : null,
        pointerEvents: getComputedStyle(m).pointerEvents,
        team: m.className
      };
    })()`);

    assert(!clickable.error, `a move marker exists${clickable.error ? " -> " + clickable.error : ""}`);
    assert(clickable.pointerEvents !== "none", `markers have pointer-events enabled (got ${clickable.pointerEvents})`);
    assert(clickable.hitIsMarker === true, `hit testing reaches the marker itself (got ${clickable.hitTag})`);
    assert(clickable.team.includes("target-blue"), `move markers carry the team class (${clickable.team})`);

    console.log("\n9. Interaction — clicking a move marker moves the unit");

    const moved = await cdp.evaluate(`(() => {
      const before = document.querySelector('.unit.blue').style.left;
      const m = document.querySelector('.move-indicator');
      m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const after = document.querySelector('.unit.blue').style.left;
      return { before, after, moved: before !== after };
    })()`);

    assert(moved.moved === true, `clicking a move marker relocates the unit (${moved.before} -> ${moved.after})`);

    console.log("\n10. Terrain — the field is decorated and stays click-through");

    const terrain = await cdp.evaluate(`(() => {
      const layer = document.getElementById('terrain-layer');
      const cells = [...layer.children];
      const cell = cells[0];
      const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        count: cells.length,
        types: [...new Set(cells.map(c => c.className))],
        layerPointerEvents: getComputedStyle(layer).pointerEvents,
        cellPointerEvents: getComputedStyle(cell).pointerEvents,
        hitIsTerrain: hit ? hit.classList.contains('terrain-cell') : false,
        hitTag: hit ? (hit.className || hit.tagName) : null
      };
    })()`);

    assert(terrain.count === 40, `the terrain layer renders one cell per grid position (${terrain.count})`);
    assert(terrain.types.length >= 4, `several terrain appearances are used (${terrain.types.length})`);
    assert(terrain.layerPointerEvents === "none", "the terrain layer ignores pointer events");
    assert(terrain.cellPointerEvents === "none", "terrain cells ignore pointer events");
    assert(terrain.hitIsTerrain === false,
      `terrain never covers a unit (hit test reached ${terrain.hitTag})`);

    console.log("\n11. Progression — the champion strip and panel");

    const progression = await cdp.evaluate(`(() => {
      const champ = document.querySelector('.unit.blue.champion');
      champ.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const panel = document.getElementById('champion-panel');
      return {
        panelVisible: !panel.classList.contains('hidden'),
        level: document.getElementById('prog-level').textContent,
        points: document.getElementById('prog-points').textContent,
        xp: document.getElementById('prog-xp-text').textContent,
        abilities: [...document.querySelectorAll('#ability-list .ability-row')].map(r => ({
          locked: r.classList.contains('locked'),
          ready: r.classList.contains('ready')
        })),
        quickActions: document.querySelectorAll('#ability-actions .ability-button').length,
        champLevel: document.getElementById('champ-level').textContent
      };
    })()`);

    assert(progression.panelVisible === true, "selecting the champion opens the champion panel");
    assert(progression.level === "1", `the progression strip shows the champion level (got ${JSON.stringify(progression.level)})`);
    assert(progression.points === "1", `the progression strip shows the unspent ability points (got ${JSON.stringify(progression.points)})`);
    assert(/XP/.test(progression.xp), "the progression strip shows the experience counter");
    assert(/LEVEL/.test(progression.champLevel), "the champion panel shows the level");
    assert(progression.abilities.length === 3, `all three champion abilities are listed (${progression.abilities.length})`);
    assert(progression.abilities.filter(a => a.locked).length === 2, "abilities above the current level are locked");
    assert(progression.abilities.filter(a => a.ready).length === 1, "the unlocked ability is ready");
    assert(progression.quickActions > 0, "a ready ability is offered as a quick action");

    console.log("\n11.5 The champion — two weapons");

    const weapons = await cdp.evaluate(`(() => {
      const api = window.MyHeroDuelArena;
      const champ = api.getPlayerChampion();
      const enemy = api.getTeamUnits('red').find(u => u.type === 'footman');
      const before = { col: champ.col, row: champ.row };
      /* Put the enemy three cells away on a clear row. */
      champ.col = 0; champ.row = 2;
      enemy.col = 3; enemy.row = 2;
      const canShoot = api.canAttack(champ, enemy);
      const shot = api.calculateDamage(champ, enemy);
      const melee = (() => {
        enemy.col = 1; enemy.row = 2;
        return api.calculateDamage(champ, enemy);
      })();
      champ.col = before.col; champ.row = before.row;
      return {
        canShoot,
        shot,
        melee,
        bowAtk: champ.shot ? champ.shot.atk : null,
        bowRange: api.getRangedReach(champ) === api.RANGED_REACH ? 'field' : 'short',
        panel: document.getElementById('champ-stats').textContent,
        selected: document.getElementById('selected-stats').textContent
      };
    })()`);

    assert(weapons.bowRange === 'field', `the champion carries a bow that covers the ${weapons.bowRange}`);
    assert(weapons.canShoot === true, "the champion can loose an arrow at three cells");
    assert(weapons.shot < weapons.melee, `the arrow hits softer than the blow (${weapons.shot} < ${weapons.melee})`);
    assert(/BOW/.test(weapons.panel), `the champion panel shows the bow (${weapons.panel})`);
    assert(/BOW/.test(weapons.selected), `the selection panel shows the bow (${weapons.selected})`);

    console.log("\n12. Progression — the level-up banner and the AI turn state");

    const levelUp = await cdp.evaluate(`(() => {
      const api = window.MyHeroDuelArena;
      api.awardExperience(150, 'verify', 'battle:verify');
      const banner = document.getElementById('level-up-banner');
      const shown = !banner.classList.contains('hidden');
      const text = document.getElementById('level-up-text').textContent;
      return { shown, text, level: document.getElementById('prog-level').textContent };
    })()`);

    assert(levelUp.shown === true, `the level-up banner appears when the champion levels up (hidden=${!levelUp.shown})`);
    assert(/LEVEL 2/.test(levelUp.text), `the banner names the new level (${levelUp.text})`);
    assert(levelUp.level === "2", `the progression strip follows the level up (got ${levelUp.level})`);

    const aiTurn = await cdp.evaluate(`(() => {
      document.getElementById('end-turn-button').click();
      const field = document.getElementById('battlefield');
      const redUnit = document.querySelector('.unit.red');
      const r = redUnit.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        active: field.classList.contains('ai-turn-active'),
        banner: document.getElementById('turn-text').textContent,
        hitIsRedUnit: hit === redUnit || !!(hit && hit.closest && hit.closest('.unit.red')),
        hitTag: hit ? (hit.className || hit.tagName) : null
      };
    })()`);

    assert(aiTurn.active === true, "the battlefield is flagged during the enemy phase");
    assert(aiTurn.banner === "ENEMY TURN", "the banner announces the enemy phase");
    assert(aiTurn.hitIsRedUnit === true,
      `red units stay clickable during the enemy phase (hit test reached ${aiTurn.hitTag})`);

    console.log("\n13. Responsive — the layout survives narrow and short viewports");

    const viewports = [
      { name: "desktop", width: 1280, height: 900 },
      { name: "tablet", width: 820, height: 1180 },
      { name: "phone", width: 390, height: 844 },
      { name: "small phone", width: 320, height: 640 }
    ];

    for (const vp of viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 700
      });
      await new Promise(r => setTimeout(r, 400));

      /* A troop that is still walking to its cell is measured on the way,
       * so the layout is only read once the field has come to rest. */
      await cdp.evaluate(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 30; i++) {
          const moving = [...document.querySelectorAll('.unit')].some(u =>
            u.getAnimations().some(a => a.playState === 'running' && a.transitionProperty));
          if (!moving) return true;
          await wait(100);
        }
        return false;
      })()`);

      const layout = await cdp.evaluate(`(() => {
        const field = document.getElementById('battlefield');
        const fr = field.getBoundingClientRect();
        const units = [...document.querySelectorAll('.unit')];
        const layer = document.getElementById('blue-units');
        const lr = layer.getBoundingClientRect();
        const panel = document.getElementById('setup-panel');
        const pr = panel.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.map-card')].map(c => {
          const r = c.getBoundingClientRect();
          return { right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        });
        const controls = ['start-button', 'end-turn-button', 'progression-strip', 'champion-panel', 'spectate-button']
          .map(id => document.getElementById(id))
          .filter(Boolean)
          .map(el => {
            const r = el.getBoundingClientRect();
            return { id: el.id, right: r.right, width: r.width, visible: r.width > 0 };
          });
        return {
          fieldWidth: fr.width,
          fieldLeft: fr.left,
          fieldRight: fr.right,
          layerWidth: lr.width,
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
          controls,
          unitCount: units.length,
          /* The anchor of a troop has to stay on the field. */
          unitsInsideField: units.every(u => {
            const r = u.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return cx >= fr.left && cx <= fr.right && cy >= fr.top && cy <= fr.bottom;
          }),
          /* The picture itself is centred in its box, so the painted pixels
           * are what has to stay on the field. */
          picturesInsideField: units.every(u => {
            const img = u.querySelector('.unit-image');
            const r = img.getBoundingClientRect();
            const scale = Math.min(r.width / (img.naturalWidth || 1), r.height / (img.naturalHeight || 1));
            const w = (img.naturalWidth || 1) * scale;
            const h = (img.naturalHeight || 1) * scale;
            const left = r.left + (r.width - w) / 2;
            const right = left + w;
            const bottom = r.bottom;
            const top = bottom - h;
            return left >= fr.left - 1 && right <= fr.right + 1 && top >= fr.top - 1 && bottom <= fr.bottom + 1;
          }),
          /* The same check, but it names the pictures that stepped out. */
          pictureOffenders: units.map(u => {
            const img = u.querySelector('.unit-image');
            const r = img.getBoundingClientRect();
            const scale = Math.min(r.width / (img.naturalWidth || 1), r.height / (img.naturalHeight || 1));
            const w = (img.naturalWidth || 1) * scale;
            const h = (img.naturalHeight || 1) * scale;
            const left = r.left + (r.width - w) / 2;
            const right = left + w;
            const bottom = r.bottom;
            const top = bottom - h;
            const over = {
              left: +(fr.left - left).toFixed(1),
              right: +(right - fr.right).toFixed(1),
              top: +(fr.top - top).toFixed(1),
              bottom: +(bottom - fr.bottom).toFixed(1)
            };
            if (over.left <= 1 && over.right <= 1 && over.top <= 1 && over.bottom <= 1) return null;
            return { id: u.id, cls: u.className, over };
          }).filter(Boolean),
          field: { left: fr.left, right: fr.right, top: fr.top, bottom: fr.bottom, width: fr.width, height: fr.height },
          smallestUnit: Math.min(...units.map(u => {
            const s = u.querySelector('.unit-art').getBoundingClientRect();
            return Math.min(s.width, s.height);
          })),
          championWidth: (() => {
            const c = document.querySelector('.unit.blue.champion');
            const layer = document.getElementById('blue-units');
            if (!c || !layer) return 0;
            /* The champion is drawn across two of the ten columns of the
             * field. Its idle breath may stretch it a little, so the
             * measurement is read against the field itself. */
            return c.getBoundingClientRect().width / layer.getBoundingClientRect().width;
          })(),
          overlaysInsideField: (() => {
            /* The name and the health bar of a troop are drawn in the
             * overlay layer above the pictures, so they are measured
             * there. */
            const overlays = [...document.querySelectorAll('.unit-overlay')];
            if (!overlays.length) return false;
            return overlays.every(o => {
              for (const part of [o.querySelector('.unit-label'), o.querySelector('.unit-health')]) {
                if (!part) continue;
                const p = part.getBoundingClientRect();
                if (p.top < fr.top - 1 || p.bottom > fr.bottom + 1) return false;
              }
              return true;
            });
          })(),
          panelHeight: pr.height,
          panelRight: pr.right,
          cards
        };
      })()`);

      assert(layout.unitCount === 14, `[${vp.name}] all units are rendered (${layout.unitCount})`);
      assert(layout.unitsInsideField === true, `[${vp.name}] every unit keeps its anchor on the battlefield`);
      assert(layout.picturesInsideField === true,
        `[${vp.name}] every troop picture stays inside the battlefield (${JSON.stringify(layout.pictureOffenders)})`);
      assert(layout.docScrollWidth <= layout.docClientWidth + 1,
        `[${vp.name}] the page does not scroll sideways (${layout.docScrollWidth} > ${layout.docClientWidth})`);
      assert(layout.controls.filter(c => c.visible).every(c => c.right <= layout.docClientWidth + 1),
        `[${vp.name}] the visible controls fit the viewport (${JSON.stringify(layout.controls)})`);
      assert(layout.smallestUnit >= 20,
        `[${vp.name}] unit sprites stay legible (smallest ${layout.smallestUnit.toFixed(1)}px)`);
      assert(Math.abs(layout.championWidth - 0.2) < 0.02,
        `[${vp.name}] the champion is drawn across two columns (${(layout.championWidth * 10).toFixed(2)} columns)`);
      assert(layout.overlaysInsideField === true,
        `[${vp.name}] every name and health bar stays on the field`);

      /* The selector has to stay out of the way: it must not eat the screen
       * and it must not push the battlefield off the page sideways. */
      assert(layout.panelHeight > 0 && layout.panelHeight <= 260,
        `[${vp.name}] the pre-battle selector stays compact (${layout.panelHeight.toFixed(0)}px tall)`);
      assert(layout.panelRight <= layout.docClientWidth + 1,
        `[${vp.name}] the selector fits the viewport`);
      assert(layout.cards.length === 4 && layout.cards.every(c => c.width > 0 && c.height > 0),
        `[${vp.name}] all four battlefield cards are drawn`);
      assert(layout.cards.every(c => c.right <= layout.docClientWidth + 1),
        `[${vp.name}] every battlefield card fits the viewport`);
    }

    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await new Promise(r => setTimeout(r, 300));

    console.log("\n14. Interaction — a real mouse click selects a blue unit");

    /* Synthetic DOM events skip the hit test, so they cannot tell whether a
     * click aimed at a unit actually reaches it. The two unit layers overlap
     * completely, and a layer that accepts pointer events would swallow every
     * click aimed at the units underneath it. */
    /* The previous section left the AI to play its turn, so the test waits
     * for the field to come back before it clicks a unit. */
    const ready = await cdp.evaluate(`(async () => {
      const api = window.MyHeroDuelArena;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40; i++) {
        const s = api.getState();
        if (s.currentTurn === 'player' && s.battleActive && s.gameState !== 'ended') {
          return { ok: true, state: s };
        }
        await wait(200);
      }
      api.resetBattle();
      api.startBattle();
      return { ok: true, state: api.getState(), restarted: true };
    })()`);

    assert(ready.ok === true, "the field is back under player control");

    /* A troop that has just moved is still gliding to its new cell, and a
     * click would then land on the cell it used to stand on. The field is
     * given time to settle before anything is measured. */
    await new Promise(r => setTimeout(r, 800));

    const candidates = await cdp.evaluate(`(() => [...document.querySelectorAll('.unit.blue')].map(u => {
      const r = u.getBoundingClientRect();
      return { id: u.dataset.id, w: r.width };
    }).filter(c => c.w > 0))()`);

    assert(candidates.length === 7, `the blue army offers seven troops to click (${candidates.length})`);

    let target = null;
    let picked = null;

    for (const candidate of candidates) {
      /* The spot is measured and clicked back to back, so the troop cannot
       * have walked away in between. */
      const spot = await cdp.evaluate(`(() => {
        const u = document.querySelector('.unit[data-id="${candidate.id}"]');
        const r = u.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          x, y,
          hitIsUnit: hit === u || !!(hit && hit.closest && hit.closest('.unit')),
          hitTag: hit ? (hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className) : null
        };
      })()`);

      assert(spot.hitIsUnit === true, `the hit test reaches the unit itself (got ${spot.hitTag})`);

      await cdp.mouseClick(spot.x, spot.y);
      await new Promise(r => setTimeout(r, 350));

      const state = await cdp.evaluate(`(() => ({
        selected: document.querySelectorAll('.unit.selected').length,
        selectedId: window.MyHeroDuelArena.getState().selectedUnitId,
        panelVisible: !document.getElementById('selection-info').classList.contains('hidden'),
        moveMarkers: document.querySelectorAll('.move-indicator').length
      }))()`);

      if (state.selectedId === candidate.id) {
        target = candidate;
        picked = state;
        /* A troop that is walled in has no cell to mark; the next one is
         * tried until a troop with a way forward is found. */
        if (state.moveMarkers > 0) break;
      }
    }

    assert(picked !== null, "a real click selects the troop it was aimed at");
    assert(picked.selected === 1, `a real click selects the unit (${picked.selected} selected)`);
    assert(picked.selectedId === target.id, `the clicked unit is the selected one (${picked.selectedId})`);
    assert(picked.panelVisible === true, "the selection panel opens");
    assert(picked.moveMarkers > 0, `the reachable cells are marked (${picked.moveMarkers})`);

    console.log("\n15. The pre-battle selector — real clicks on the cards");

    /* The selector is the first thing a player touches, so it has to work
     * with a real pointer: the hit test has to reach the card, the click has
     * to change the battlefield that is drawn on the field.
     *
     * The selector is locked while a battle runs, so the fight is put back to
     * the setup screen first. */
    await cdp.evaluate(`(() => { window.MyHeroDuelArena.resetBattle(); })()`);
    await new Promise(r => setTimeout(r, 250));

    const selector = await cdp.evaluate(`(() => {
      const panel = document.getElementById('setup-panel');
      const pr = panel.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.map-card')];
      const buttons = [...document.querySelectorAll('.difficulty-button')];
      const previews = [...document.querySelectorAll('.map-preview')];
      const card = cards.find(c => c.dataset.map !== window.MyHeroDuelArena.getActiveMapId()) || cards[0];
      const cr = card.getBoundingClientRect();
      const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      return {
        panelVisible: pr.width > 0 && pr.height > 0,
        cardCount: cards.length,
        buttonCount: buttons.length,
        previewCells: previews.map(p => p.children.length),
        selectedCards: cards.filter(c => c.classList.contains('selected')).length,
        selectedButtons: buttons.filter(b => b.classList.contains('selected')).length,
        cardX: cr.left + cr.width / 2,
        cardY: cr.top + cr.height / 2,
        hitIsCard: !!(hit && hit.closest && hit.closest('.map-card')),
        terrainBefore: [...document.querySelectorAll('.terrain-cell')].map(c => c.className).join('|')
      };
    })()`);

    assert(selector.panelVisible === true, "the pre-battle selector is on screen");
    assert(selector.cardCount === 4, `four battlefield cards are drawn (${selector.cardCount})`);
    assert(selector.buttonCount === 3, `three difficulty buttons are drawn (${selector.buttonCount})`);
    assert(selector.previewCells.length === 4 && selector.previewCells.every(n => n === 40),
      `every card previews all 40 cells (${JSON.stringify(selector.previewCells)})`);
    assert(selector.selectedCards === 1, "one battlefield is marked as chosen");
    assert(selector.selectedButtons === 1, "one difficulty is marked as chosen");
    assert(selector.hitIsCard === true, "the hit test reaches the battlefield card");

    await cdp.mouseClick(selector.cardX, selector.cardY);
    await new Promise(r => setTimeout(r, 350));

    const afterMap = await cdp.evaluate(`(() => ({
      active: window.MyHeroDuelArena.getActiveMapId(),
      terrain: [...document.querySelectorAll('.terrain-cell')].map(c => c.className).join('|'),
      cells: document.querySelectorAll('.terrain-cell').length
    }))()`);

    assert(afterMap.active !== null, "a real click on a card selects a battlefield");
    assert(afterMap.terrain !== selector.terrainBefore,
      "the battlefield is redrawn with the ground of the chosen card");
    assert(afterMap.cells === 40, "the battlefield still renders 40 cells");

    const difficultyClick = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.difficulty-button')]
        .find(b => b.dataset.difficulty !== window.MyHeroDuelArena.getDifficultyId());
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        id: button.dataset.difficulty,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        hitIsButton: !!(hit && hit.closest && hit.closest('.difficulty-button'))
      };
    })()`);

    assert(difficultyClick.hitIsButton === true, "the hit test reaches the difficulty button");
    await cdp.mouseClick(difficultyClick.x, difficultyClick.y);
    await new Promise(r => setTimeout(r, 300));

    const afterDifficulty = await cdp.evaluate(`(() => ({
      active: window.MyHeroDuelArena.getDifficultyId(),
      selected: [...document.querySelectorAll('.difficulty-button')]
        .filter(b => b.classList.contains('selected')).map(b => b.dataset.difficulty)
    }))()`);

    assert(afterDifficulty.active === difficultyClick.id,
      `a real click on a difficulty button selects it (${afterDifficulty.active})`);
    assert(afterDifficulty.selected.length === 1 && afterDifficulty.selected[0] === difficultyClick.id,
      "only the chosen difficulty stays marked");

    /* A running battle locks the selector, so the ground can never change
     * under the fighters. */
    const locked = await cdp.evaluate(`(() => {
      const api = window.MyHeroDuelArena;
      api.startBattle();
      const cards = [...document.querySelectorAll('.map-card')];
      const buttons = [...document.querySelectorAll('.difficulty-button')];
      const before = api.getActiveMapId();
      cards.find(c => c.dataset.map !== before).click();
      return {
        locked: document.getElementById('setup-panel').classList.contains('locked'),
        cardsDisabled: cards.every(c => c.disabled === true),
        buttonsDisabled: buttons.every(b => b.disabled === true),
        unchanged: api.getActiveMapId() === before
      };
    })()`);

    assert(locked.locked === true, "the selector is locked during a battle");
    assert(locked.cardsDisabled === true, "the battlefield cards are locked during a battle");
    assert(locked.buttonsDisabled === true, "the difficulty buttons are locked during a battle");
    assert(locked.unchanged === true, "the ground cannot change while the battle runs");

    console.log("\n16. The post-battle report");

    const report = await cdp.evaluate(`(() => {
      const api = window.MyHeroDuelArena;
      api.resetBattle();
      api.startBattle();
      for (const u of api.getTeamUnits('red')) { u.alive = false; u.defeated = true; }
      api.checkBattleEnd();

      const panel = document.getElementById('battle-report');
      const r = panel.getBoundingClientRect();
      const cell = id => {
        const el = document.getElementById(id);
        const cr = el.getBoundingClientRect();
        return { text: el.textContent, width: cr.width, height: cr.height };
      };
      return {
        hidden: panel.classList.contains('hidden'),
        width: r.width,
        height: r.height,
        outcome: cell('report-outcome'),
        damage: cell('report-damage'),
        kills: cell('report-kills'),
        xp: cell('report-xp'),
        breakdown: cell('report-breakdown'),
        level: cell('report-level')
      };
    })()`);

    assert(report.hidden === false, "the report is visible after the battle");
    assert(report.width > 0 && report.height > 0, "the report is actually drawn");
    assert(report.outcome.text === "VICTORY", `the report names the outcome (${report.outcome.text})`);
    assert(/^\d+$/.test(report.damage.text), `the report shows the damage (${report.damage.text})`);
    assert(/^\d+$/.test(report.kills.text), `the report shows the kills (${report.kills.text})`);
    assert(/^\d+$/.test(report.xp.text), `the report shows the experience (${report.xp.text})`);
    assert(/XP/.test(report.breakdown.text), "the report breaks the experience down");
    assert(report.level.text.length > 0, "the report says where the champion stands");

    console.log("\n17. The spectator mode — a real click on the control");

    /* The spectator show is the second door into the arena. It has to work
     * with a real pointer, and it has to leave the champion's profile
     * completely alone while the two legions fight it out. */
    const beforeShow = await cdp.evaluate(`(async () => {
      const api = window.MyHeroDuelArena;
      api.resetBattle();
      const button = document.getElementById('spectate-button');
      /* The control sits at the bottom of the page, so it is brought into
       * view before the pointer is aimed at it. */
      button.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise(r => setTimeout(r, 250));
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const p = api.getProgression();
      return {
        buttonVisible: r.width > 0 && r.height > 0,
        buttonDisabled: button.disabled,
        hitIsButton: !!(hit && hit.closest && hit.closest('#spectate-button')),
        hitTag: hit ? (hit.className || hit.tagName) : null,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        xp: p.xp,
        level: p.level,
        battles: p.battles,
        wins: p.wins
      };
    })()`);

    assert(beforeShow.buttonVisible === true, "the spectator control is on screen");
    assert(beforeShow.buttonDisabled === false, "the spectator control is free between battles");
    assert(beforeShow.hitIsButton === true,
      `the hit test reaches the spectator control (hit ${beforeShow.hitTag}, rect ${JSON.stringify(beforeShow.rect)}, viewport ${JSON.stringify(beforeShow.viewport)})`);

    await cdp.mouseClick(beforeShow.x, beforeShow.y);
    await new Promise(r => setTimeout(r, 1200));

    const watching = await cdp.evaluate(`(() => {
      const api = window.MyHeroDuelArena;
      const state = api.getState();
      const p = api.getProgression();
      const log = [...document.querySelectorAll('#combat-log .log-entry')].map(e => e.textContent);
      const button = document.getElementById('spectate-button');
      return {
        mode: state.battleMode,
        spectator: state.spectatorActive,
        active: state.battleActive,
        turn: document.getElementById('turn-text').textContent,
        round: document.getElementById('round-text').textContent,
        bannerVisible: !document.getElementById('turn-banner').classList.contains('hidden'),
        endTurnHidden: document.getElementById('end-turn-button').classList.contains('hidden'),
        stripSpectating: document.getElementById('progression-strip').classList.contains('spectating'),
        buttonDisabled: button.disabled,
        log,
        xp: p.xp,
        level: p.level,
        battles: p.battles,
        wins: p.wins,
        stored: localStorage.getItem(api.STORAGE_KEY)
      };
    })()`);

    assert(watching.mode === "spectator", "a real click starts the spectator show");
    assert(watching.spectator === true, "the page is in spectator mode");
    assert(watching.active === true, "the show is running");
    assert(watching.bannerVisible === true, "the turn banner is on screen during the show");
    assert(/AZURE LEGION|CRIMSON LEGION/.test(watching.turn),
      `the banner names the legion that is fighting (${watching.turn})`);
    assert(/^ROUND \d+$/.test(watching.round), `the banner names the round (${watching.round})`);
    assert(watching.endTurnHidden === true, "the end turn control is hidden during the show");
    assert(watching.stripSpectating === true, "the progression strip says that nothing is being earned");
    assert(watching.buttonDisabled === true, "the spectator control is locked while the show runs");
    assert(watching.log.some(t => /advances|attacks/.test(t)),
      `the AI is actually fighting (${JSON.stringify(watching.log)})`);

    assert(watching.xp === beforeShow.xp, "the show pays no experience");
    assert(watching.level === beforeShow.level, "the show gains no level");
    assert(watching.battles === beforeShow.battles, "the show is not counted as a battle");
    assert(watching.wins === beforeShow.wins, "the show records no win");

    await cdp.evaluate(`(() => { window.MyHeroDuelArena.resetBattle(); })()`);
    await new Promise(r => setTimeout(r, 250));

    const afterShow = await cdp.evaluate(`(() => ({
      mode: window.MyHeroDuelArena.getBattleMode(),
      stripSpectating: document.getElementById('progression-strip').classList.contains('spectating'),
      buttonDisabled: document.getElementById('spectate-button').disabled
    }))()`);

    assert(afterShow.mode === "player", "a reset hands the game back to the player");
    assert(afterShow.stripSpectating === false, "the progression strip comes back to normal");
    assert(afterShow.buttonDisabled === false, "the spectator control is free again");

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  } catch (err) {
    fatal = err;
  } finally {
    if (cdp) cdp.close();
    /* Edge spawns child processes that keep the profile directory locked, so
     * the whole process tree is killed before the profile is removed. */
    try {
      await new Promise(resolve => {
        const killer = spawn("taskkill", ["/F", "/T", "/PID", String(browser.pid)], { stdio: "ignore" });
        killer.on("exit", resolve);
        killer.on("error", resolve);
        setTimeout(resolve, 4000);
      });
    } catch (e) { /* fall back to the plain kill below */ }
    browser.kill();
    await new Promise(resolve => {
      if (browser.exitCode !== null) return resolve();
      browser.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
    /* The profile directory can still be locked by the browser process for a
     * moment after it exits, so the cleanup is retried and never fatal. */
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        break;
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  if (fatal) {
    console.error("verification error:", fatal);
    process.exit(1);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("verification error:", err);
  process.exit(1);
});
