// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 weavejam
// The plugin page's layout (tutti.js): the whole frame, whatever its size, never a scrollbar.
//   - wide (WIDE_ASPECT and WIDE_MIN_W or more): the device's tall drawing at the frame's full height on the left, the
//     parts panel on the right: the transport, the six parts (engine and sound, MUTE / asleep / ARP, a level meter, the
//     pattern's steps with the playhead, the selected one marked), the song's rows (the one playing marked), then the
//     render controls, the keys and the credits;
//   - else (a phone sheet, a small window): the device alone, in whichever drawing (wide or tall) is the larger in the
//     frame, the render controls and the credits in one line under it.
// The device is drawn in layout units (its box sized here, the drawing and its hit areas in % of it, web/emu/index.html),
// so it is crisp at any size and every hit area is where its control is. The panel only shows what the device plays
// (jiant_plugin.c tutti_view, sent by worklet-tutti.js); nothing in it changes the device.
export const WIDE_ASPECT = 1.3, WIDE_MIN_W = 900;
export const PREFERRED = { width: 1280, height: 800 };   // the size asked of the host (resize): the wide layout's own
const DRAW = { wide: [1000, 624], tall: [600, 1070] };    // web/emu/index.html LAYOUTS: the drawings' units
const TV_HEAD = 48, TV_PART = 32;                          // jiant_plugin.c tutti_view
const FULL = 131072;                                       // a part's peak at the master's full scale (fx.c: mix >> 2)
const SECTION = "ABCD";

export const isWide = (w, h) => w >= WIDE_MIN_W && w / h >= WIDE_ASPECT;
// the drawing for a frame of w x h with `bar` px under the device (compact): the one drawn larger
export function drawingFor(w, h, bar = 40) {
  if (isWide(w, h)) return "tall";
  const s = (d) => Math.min(w / DRAW[d][0], (h - bar) / DRAW[d][1]);
  return s("wide") >= s("tall") ? "wide" : "tall";
}

const CSS = `
html.tt, html.tt body { height: 100%; overflow: hidden; }
html.tt main { position: fixed; inset: 0; max-width: none; margin: 0; padding: 0; display: grid; }
html.tt-wide main { grid-template-columns: auto minmax(0, 1fr); }
html.tt-compact main { grid-template-rows: minmax(0, 1fr) auto; }
.tt-stage { display: grid; place-items: center; min-width: 0; min-height: 0; overflow: hidden; }
html.tt .device { flex: none; }
.tt-side { min-width: 0; min-height: 0; overflow: hidden; display: flex; box-sizing: border-box; color: var(--fg); }
html.tt-wide .tt-side { flex-direction: column; gap: 8px; padding: 12px 14px 8px 2px; }
html.tt-compact .tt-side { flex-direction: row; align-items: center; gap: 10px; padding: 4px 8px; white-space: nowrap; }
html.tt-compact .tt-panel, html.tt-compact .tt-side > .keys, html.tt-compact .tt-side > .kofi,
html.tt-compact .tt-side > footer { display: none; }
html.tt-wide .tt-mini { display: none; }
.tt-side .keys, .tt-side footer, .tt-side .kofi { margin: 0; }
.tt-side .keys { font-size: 12px; line-height: 1.7; }
.tt-side footer { font-size: 11px; line-height: 1.45; }
.tt-side .kofi { font-size: 12px; text-align: left; }
.tt-side [data-cut] { display: none !important; }
html.tt-wide .tutti { margin: 0; max-width: none; padding: 0; justify-content: flex-start; }
html.tt-wide .tutti .note { flex-basis: auto; text-align: left; margin: 0; }
html.tt-compact .tutti { margin: 0; padding: 0; flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; justify-content: flex-start; }
html.tt-compact .tutti .note { flex: 1 1 auto; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
html.tt-compact .tutti button { padding: 4px 10px; }
.tt-mini { flex: none; font-size: 11px; color: var(--dim); }
.tt-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px;
            background: var(--body); color: var(--label); border-radius: 16px; font-size: 12px; }
.tt-top { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; }
.tt-top b { font: 600 15px/1.2 "DotGothic16", ui-monospace, monospace; letter-spacing: .04em; color: #fff; }
.tt-top span { white-space: nowrap; color: #b4b4b8; }
.tt-top .on { color: var(--green); }
.tt-lanes { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: repeat(6, minmax(18px, 1fr)); gap: 4px; }
.tt-lane { min-height: 0; display: grid; grid-template-columns: minmax(150px, 30%) minmax(0, 1fr); gap: 10px; align-items: stretch;
           padding: 3px 8px; background: var(--tray); border-radius: 8px; border: 1.5px solid transparent; }
.tt-lane.sel { border-color: var(--lit); }
.tt-lane.asleep { opacity: .4; }
.tt-lane.muted .tt-steps { opacity: .45; }
.tt-who { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.tt-name { display: flex; gap: 6px; align-items: baseline; min-width: 0; white-space: nowrap; }
.tt-name b { font: 600 13px "DotGothic16", ui-monospace, monospace; color: #fff; }
.tt-name .eng { color: #d6d6d8; }
.tt-name .pre { color: #8e8e93; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tt-name .flag { font-size: 10px; padding: 0 4px; border-radius: 3px; background: #3a3a3e; color: #e6e6e8; }
.tt-name .flag.mute { background: #ff453a; color: #fff; }
.tt-meter { height: 5px; border-radius: 3px; background: #2a2a2d; overflow: hidden; }
.tt-meter i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #5fe08a 0 70%, #ffd60a 70% 88%, #ff453a 88%);
              background-size: var(--mw, 100px) 100%; }
.tt-steps { width: 100%; height: 100%; min-height: 0; display: block; }
.tt-song { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-height: 22px; }
.tt-song .lbl { color: #b4b4b8; margin-right: 4px; }
.tt-song i { font-style: normal; padding: 1px 6px; border-radius: 4px; background: var(--part); border: 1px solid var(--edge); }
.tt-song i.now { background: var(--lit); color: #1d1d1f; }
.tt-empty { color: #8e8e93; }
`;

// the layout: main restructured into a stage (the device) and a side (the panel, the controls, the credits)
export function frameLayout({ bar, getApi }) {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement, main = document.querySelector("main"), device = $("device");
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  root.classList.add("tt");
  const stage = document.createElement("div"), side = document.createElement("div");
  stage.className = "tt-stage";
  side.className = "tt-side";
  const panel = makePanel();
  const mini = document.createElement("span");
  mini.className = "tt-mini";
  mini.innerHTML = `<a href="../credits.html" target="_blank" rel="noopener">credits, licences, source</a>`;
  const rest = [...main.children].filter((e) => e !== device && e !== bar);
  main.replaceChildren(stage, side);
  stage.appendChild(device);
  side.append(bar, panel.el, ...rest, mini);
  // what goes first when the side is too short for it all (wide): the Ko-fi line, the keys, the credits' small print,
  // the song's rows (the parts stay, smaller)
  const CUTS = [side.querySelector(".kofi"), side.querySelector(".keys"), ...side.querySelectorAll("footer small, footer nav"), panel.song].filter(Boolean);

  let drawing = null;
  function layout() {
    const w = innerWidth, h = innerHeight, wide = isWide(w, h);
    root.classList.toggle("tt-wide", wide);
    root.classList.toggle("tt-compact", !wide);
    for (const c of CUTS) delete c.dataset.cut;
    let dw, dh;
    if (wide) {
      drawing = "tall";
      dh = h - 16;
      dw = Math.floor(dh * DRAW.tall[0] / DRAW.tall[1]);
      stage.style.padding = "8px 10px";
    } else {
      stage.style.padding = "0";
      const b = side.offsetHeight || 40;
      drawing = drawingFor(w, h, b);
      const [uw, uh] = DRAW[drawing], s = Math.min((w - 8) / uw, (h - b - 4) / uh);
      dw = Math.floor(uw * s);
      dh = Math.floor(uh * s);
    }
    if (wide) dh = Math.floor(dw * DRAW.tall[1] / DRAW.tall[0]);
    device.style.width = `${Math.max(0, dw)}px`;
    device.style.height = `${Math.max(0, dh)}px`;
    const a = getApi();
    if (a && a.layout) a.layout(drawing);
    if (wide) for (const c of CUTS) { if (side.scrollHeight <= side.clientHeight) break; c.dataset.cut = ""; }
    panel.resize();
  }
  addEventListener("resize", layout);
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  ro.observe(side);                                   // (the controls line: the render's progress shown, a note)
  document.fonts?.ready.then(layout, () => {});
  layout();
  return { layout, panel, drawing: () => drawing };
}

// ------------------------------------------------------------------ the parts panel
function makePanel() {
  const el = document.createElement("section");
  el.className = "tt-panel";
  el.setAttribute("aria-label", "The parts: what JIANT FM plays");
  el.innerHTML = `
    <div class="tt-top"><b>JIANT FM</b><span id="tt-run">■ stopped</span><span id="tt-tempo"></span><span id="tt-pos"></span>
      <span id="tt-mode"></span><span id="tt-sec"></span></div>
    <div class="tt-lanes">${[1, 2, 3, 4, 5, 6].map((n) => `
      <div class="tt-lane"><div class="tt-who"><div class="tt-name"><b>T${n}</b><span class="eng"></span><span class="pre"></span><span class="flags"></span></div>
        <div class="tt-meter"><i></i></div></div><canvas class="tt-steps" aria-hidden="true"></canvas></div>`).join("")}
    </div>
    <div class="tt-song"><span class="lbl">SONG</span><span class="tt-empty">Switch on to see the parts and the song.</span></div>`;
  const lanes = [...el.querySelectorAll(".tt-lane")].map((l) => ({
    l, eng: l.querySelector(".eng"), pre: l.querySelector(".pre"), flags: l.querySelector(".flags"),
    meter: l.querySelector(".tt-meter i"), cv: l.querySelector("canvas"), level: 0, key: "",
  }));
  const song = el.querySelector(".tt-song");
  const q = (s) => el.querySelector(s);
  let last = null, songKey = "";

  function drawSteps(L, v, o, playing) {
    const cv = L.cv, r = devicePixelRatio || 1, w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const len = v[o + 2] || 16, at = v[o + 3], x = cv.getContext("2d");
    const rows = len > 32 && h > 40 * r ? 2 : 1, per = Math.ceil(len / rows), gap = Math.max(1, Math.round(2 * r));
    const cw = (w - gap * (per - 1)) / per, ch = (h - gap * (rows - 1)) / rows;
    x.clearRect(0, 0, w, h);
    for (let s = 0; s < len; s++) {
      const on = (v[o + 8 + (s >> 3)] >> (s & 7)) & 1, tie = (v[o + 16 + (s >> 3)] >> (s & 7)) & 1;
      const cx = (s % per) * (cw + gap), cy = Math.floor(s / per) * (ch + gap), ph = playing && s === at;
      x.fillStyle = ph ? "#fff4d6" : on ? "#d6d6d8" : tie ? "#6b6b70" : s % 4 === 0 ? "#34343a" : "#26262a";
      x.fillRect(Math.round(cx), Math.round(cy), Math.max(1, Math.round(cw)), Math.round(ch));
      if (ph && !on && !tie) {                         // (the playhead on an empty step: an outline)
        x.fillStyle = "#26262a";
        const b = Math.max(1, Math.round(1.5 * r));
        x.fillRect(Math.round(cx) + b, Math.round(cy) + b, Math.max(0, Math.round(cw) - 2 * b), Math.round(ch) - 2 * b);
      }
    }
  }

  function show(view, names) {
    last = { view, names };
    const v = view, playing = !!v[0], bpm = v[12] | v[13] << 8, bar = (v[10] | v[11] << 8) + 1;
    q("#tt-run").textContent = playing ? "▶ playing" : "■ stopped";
    q("#tt-run").className = playing ? "on" : "";
    q("#tt-tempo").textContent = bpm ? `${bpm} BPM` : "";
    q("#tt-pos").textContent = playing ? `bar ${bar} · beat ${v[9] + 1}` : "";
    q("#tt-mode").textContent = `PLAY: ${v[3] ? "SONG" : "LOOP"}`;
    q("#tt-sec").textContent = v[7] ? `section ${SECTION[(v[7] - 1) & 3]}${v[15] ? ` → ${SECTION[(v[15] - 1) & 3]}` : ""}` : "";
    for (let p = 0; p < 6; p++) {
      const L = lanes[p], o = TV_HEAD + p * TV_PART, asleep = p >= v[2];
      const [eng, pre] = names[p] || ["", ""];
      const flags = [v[o + 1] ? "MUTE" : "", asleep ? "ASLEEP" : "", v[o + 5] ? (v[o + 6] ? "ARP HOLD" : "ARP") : v[o + 6] ? "HOLD" : ""].filter(Boolean);
      const key = `${eng}|${pre}|${v[o + 28]}|${flags.join()}|${p === v[1]}|${asleep}`;
      if (key !== L.key) {
        L.key = key;
        L.eng.textContent = eng === "-" ? "—" : eng;
        L.pre.textContent = v[o + 28] ? `USER ${v[o + 28]}` : pre;
        L.flags.innerHTML = flags.map((f) => `<span class="flag${f === "MUTE" ? " mute" : ""}">${f}</span>`).join("");
        L.l.classList.toggle("sel", p === v[1]);
        L.l.classList.toggle("asleep", asleep);
        L.l.classList.toggle("muted", !!v[o + 1]);
        L.l.title = `T${p + 1}: ${eng}${pre ? " · " + pre : ""}, LEVEL ${v[o + 4]}, LEN ${v[o + 2]} steps, ${v[o + 7]} voice(s) sounding`;
      }
      const pk = new DataView(v.buffer, v.byteOffset + o + 24, 4).getUint32(0, true);
      const d = pk > 0 ? 20 * Math.log10(pk / FULL) : -99, lvl = Math.max(0, Math.min(1, (d + 48) / 48));
      L.level = Math.max(lvl, L.level - 0.04);           // (falls ~1 dB a frame)
      L.meter.style.width = `${(L.level * 100).toFixed(1)}%`;
      drawSteps(L, v, o, playing);
    }
    const n = v[6], rows = [];
    for (let k = 0; k < n; k++) rows.push([v[16 + 2 * k], v[17 + 2 * k]]);
    const now = v[4] ? v[5] : -1, sk = `${n}|${now}|${rows.join(";")}|${v[3]}`;
    if (sk !== songKey) {
      songKey = sk;
      song.innerHTML = `<span class="lbl">SONG</span>` + (n
        ? rows.map(([s, b], k) => `<i class="${k === now ? "now" : ""}" title="row ${k + 1}: section ${SECTION[s & 3]}, ${b} bar${b === 1 ? "" : "s"}">${SECTION[s & 3]} ${b}</i>`).join("")
        : `<span class="tt-empty">no rows (the song layer's SONG REC or the generator makes them)</span>`);
    }
  }
  return {
    el, song, show,
    resize() {
      for (const L of lanes) L.meter.parentElement.style.setProperty("--mw", `${L.meter.parentElement.clientWidth}px`);
      if (last) show(last.view, last.names);
    },
    idle(text) { song.innerHTML = `<span class="lbl">SONG</span><span class="tt-empty">${text}</span>`; songKey = ""; },
  };
}
