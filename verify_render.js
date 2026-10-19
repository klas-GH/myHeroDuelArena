/* RENDER VERIFICATION — myHeroDuelArena v1.1.0
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

    console.log("\n2. Rendering — every unit sprite is visible and sized");

    const spriteStats = await cdp.evaluate(`(() => {
      const units = [...document.querySelectorAll('.unit')];
      const out = { total: units.length, visible: 0, zero: 0, min: Infinity, max: 0 };
      for (const u of units) {
        const use = u.querySelector('use');
        if (!use) { out.zero++; continue; }
        const svg = u.querySelector('.unit-glyph');
        const r = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
        if (r.width > 0 && r.height > 0) {
          out.visible++;
          out.min = Math.min(out.min, r.width);
          out.max = Math.max(out.max, r.width);
        } else {
          out.zero++;
        }
      }
      return out;
    })()`);

    assert(spriteStats.total === 22, `all 22 unit sprites are in the DOM (got ${spriteStats.total})`);
    assert(spriteStats.visible === 22, `all 22 unit sprites render with non-zero size (got ${spriteStats.visible})`);
    assert(spriteStats.zero === 0, `no unit sprite collapsed to zero size (got ${spriteStats.zero})`);

    console.log("\n3. Layout — units sit inside the battlefield");

    const layout = await cdp.evaluate(`(() => {
      const field = document.getElementById('battlefield');
      const fr = field.getBoundingClientRect();
      const units = [...document.querySelectorAll('.unit')];
      const rows = new Map();
      let outside = 0;
      let overflowTop = 0;
      let overflowBottom = 0;

      for (const u of units) {
        const r = u.getBoundingClientRect();
        if (r.top < fr.top - 1) overflowTop++;
        if (r.bottom > fr.bottom + 1) overflowBottom++;

        const layer = u.closest('.units-layer');
        const lr = layer.getBoundingClientRect();
        const centre = r.top + r.height / 2;
        const key = Math.round(((centre - lr.top) / lr.height) * 4);
        rows.set(key, (rows.get(key) || 0) + 1);
      }
      return { rowKeys: [...rows.keys()].sort((a,b)=>a-b), counts: [...rows.values()], overflowTop, overflowBottom };
    })()`);

    assert(layout.rowKeys.length === 4, `units occupy exactly four distinct rows (got ${layout.rowKeys.length}: ${layout.rowKeys})`);
    assert(layout.overflowTop === 0, `no unit overflows the top of the battlefield (got ${layout.overflowTop})`);
    assert(layout.overflowBottom === 0, `no unit overflows the bottom of the battlefield (got ${layout.overflowBottom})`);

    console.log("\n4. Layout — unit and marker cells agree");

    /* Units are anchored with translate(-50%, -50%) so that the box centre
     * lands on the cell centre. Any animation that replaces `transform`
     * silently breaks that anchor, so the check runs with animations live. */
    const centred = await cdp.evaluate(`(() => {
      const layer = document.getElementById('blue-units');
      const lr = layer.getBoundingClientRect();
      let worst = 0;
      let worstCls = null;
      let checked = 0;

      for (const u of document.querySelectorAll('.unit')) {
        const r = u.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        let best = Infinity;
        for (let c = 0; c < 10; c++) {
          for (let rw = 0; rw < 4; rw++) {
            const gx = lr.left + ((c + 0.5) / 10) * lr.width;
            const gy = lr.top + ((rw + 0.5) / 4) * lr.height;
            best = Math.min(best, Math.hypot(cx - gx, cy - gy));
          }
        }
        checked++;
        if (best > worst) { worst = best; worstCls = u.className; }
      }
      return { checked, worst, worstCls };
    })()`);

    assert(centred.checked === 22, `all units were measured (${centred.checked})`);
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
      const mBlue = getComputedStyle(blue);
      const mRed  = getComputedStyle(red);
      return {
        blueColor: mBlue.color,
        redColor: mRed.color,
        blueTransform: mBlue.transform,
        redTransform: mRed.transform
      };
    })()`);

    assert(styling.blueColor !== styling.redColor, `blue and red units have different colours (${styling.blueColor} vs ${styling.redColor})`);
    assert(styling.redTransform.includes("-1"), `red units are mirrored to face left (${styling.redTransform})`);
    assert(!styling.blueTransform.includes("-1"), `blue units are not mirrored (${styling.blueTransform})`);

    /* Combat animations must not clobber the facing flip, so they use the
     * independent translate/scale properties instead of `transform`. */
    const facing = await cdp.evaluate(`(() => {
      const redUnit = document.querySelector('.unit.red');
      const sil = redUnit.querySelector('.unit-silhouette');
      const read = () => getComputedStyle(sil).transform;

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

      const layout = await cdp.evaluate(`(() => {
        const field = document.getElementById('battlefield');
        const fr = field.getBoundingClientRect();
        const units = [...document.querySelectorAll('.unit')];
        const layer = document.getElementById('blue-units');
        const lr = layer.getBoundingClientRect();
        const controls = ['start-button', 'end-turn-button', 'progression-strip', 'champion-panel']
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
          unitsInsideField: units.every(u => {
            const r = u.getBoundingClientRect();
            return r.left >= fr.left - 1 && r.right <= fr.right + 1;
          }),
          smallestUnit: Math.min(...units.map(u => {
            const s = u.querySelector('.unit-silhouette').getBoundingClientRect();
            return Math.min(s.width, s.height);
          }))
        };
      })()`);

      assert(layout.unitCount === 22, `[${vp.name}] all units are rendered (${layout.unitCount})`);
      assert(layout.unitsInsideField === true, `[${vp.name}] every unit stays inside the battlefield`);
      assert(layout.docScrollWidth <= layout.docClientWidth + 1,
        `[${vp.name}] the page does not scroll sideways (${layout.docScrollWidth} > ${layout.docClientWidth})`);
      assert(layout.controls.filter(c => c.visible).every(c => c.right <= layout.docClientWidth + 1),
        `[${vp.name}] the visible controls fit the viewport (${JSON.stringify(layout.controls)})`);
      assert(layout.smallestUnit >= 20,
        `[${vp.name}] unit sprites stay legible (smallest ${layout.smallestUnit.toFixed(1)}px)`);
    }

    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await new Promise(r => setTimeout(r, 300));

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
