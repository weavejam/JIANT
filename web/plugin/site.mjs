// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 weavejam
// The plugin's static site (web/plugin/build.sh calls it), for Cloudflare Pages or any static host (deployed: production
// https://jiant.plugins.tooljams.com, preview https://jiant-preview.plugins.tooljams.com):
//   PLUGIN_CHANNEL=production|preview node web/plugin/site.mjs WASM OUT JIANT_VERSION
//   OUT/tutti-plugin.json   the manifest (protocol-v0 1), CORS * (_headers)
//   OUT/_headers            Cloudflare Pages: the manifest's CORS and no-cache, frame-ancestors (the channel's embedders),
//                           the plugin page's CSP, wasm's type
//   OUT/plugin/             the entry: the emulator's page (web/emu/index.html) + tutti.js and its modules, the wasm
//   OUT/emu/worklet.js      the emulator's worklet (the plugin's modules import it from there, as in the tree)
//   OUT/credits.html, OUT/licenses/   who made what, the licences, the source
//   OUT/index.html          a landing page
// The build id is a hash of everything served but the manifest and plugin/build-info.js (which carry it), and the channel.
// PLUGIN_CHANNEL (required): which pages may embed it (protocol.js CHANNELS), into both plugin/build-info.js (EMBEDDERS,
// the handshake's check) and _headers (frame-ancestors): production exactly https://tuttidaw.com and
// https://www.tuttidaw.com; preview those and http://localhost:<any port>.
// The source link is the commit built (git HEAD): no commit, or a tree with changes not in it, fails the build
// (PLUGIN_ALLOW_DIRTY=1 lets a preview build through, marked as such; never a production one).
// Env: PLUGIN_SOURCE (the source repository, default https://github.com/weavejam/JIANT).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { OUTPUTS, SAMPLE_RATES } from "./renderer.js";
import { STATE_VERSION, STATE_READS } from "./state.js";
import { PROTOCOL, CHANNELS } from "./protocol.js";

export const PLUGIN_VERSION = "0.1.0";                 // semver of the plugin (+ the firmware's version as build metadata)
export const UPSTREAM = "https://github.com/juanjiant-bit/JIANT";   // JIANT FM, by Juan Jiant
export const NOTICE = "Not affiliated with or endorsed by M-VAVE or Hügelton Instruments.";
const [wasmPath, out, fwVersion = "dev"] = process.argv.slice(2);
if (!wasmPath || !out) { console.error("usage: node web/plugin/site.mjs WASM OUT JIANT_VERSION"); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = (...p) => path.join(ROOT, ...p);
const fail = (m) => { console.error(`site: ${m}`); process.exit(1); };
const channel = process.env.PLUGIN_CHANNEL;
if (!Object.hasOwn(CHANNELS, channel)) fail(`PLUGIN_CHANNEL=${Object.keys(CHANNELS).join("|")} (not ${channel})`);
const EMBEDDERS = CHANNELS[channel];
const SOURCE = process.env.PLUGIN_SOURCE || "https://github.com/weavejam/JIANT";
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let commit = "", changes = "";
try { commit = git("rev-parse --verify HEAD"); changes = git("status --porcelain"); } catch (e) { fail(`no git commit to link the source to (${String(e.message).split("\n")[0]})`); }
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`no git commit to link the source to (${commit})`);
const dirty = changes !== "";
if (dirty && !(channel === "preview" && process.env.PLUGIN_ALLOW_DIRTY === "1"))
  fail(`the tree has changes not in ${commit.slice(0, 12)}: the source link would not be this build's source\n${changes}`);
const sourceAt = `${SOURCE}/tree/${commit}`;
const version = `${PLUGIN_VERSION}+jiant.${fwVersion.replace(/^v/, "").replace(/[^0-9A-Za-z.-]/g, "-")}${dirty ? ".dirty" : ""}`;

fs.rmSync(out, { recursive: true, force: true });
const put = (rel, data) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};
const copy = (from, rel) => put(rel, fs.readFileSync(from));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- the plugin
copy(wasmPath, "plugin/felucca.wasm");
for (const f of ["tutti.js", "panel.js", "protocol.js", "fm1-panel.js", "engine.js", "renderer.js", "resample.js", "state.js", "render-worker.js", "worklet-tutti.js"])
  copy(src("web/plugin", f), `plugin/${f}`);
copy(src("web/emu/worklet.js"), "emu/worklet.js");
copy(src("web/emu/fonts/DotGothic16-subset.woff"), "plugin/fonts/DotGothic16-subset.woff");
copy(src("web/emu/fonts/OFL.txt"), "plugin/fonts/OFL.txt");
let page = fs.readFileSync(src("web/emu/index.html"), "utf8");
const swap = (a, b) => { if (!page.includes(a)) throw new Error(`site: web/emu/index.html has no ${a}`); page = page.replace(a, b); };
swap("<title>JIANT FM</title>", "<title>JIANT FM · tuttidaw plugin</title>");
swap(/<meta name="description" content="[^"]*">/.exec(page)[0],
     '<meta name="description" content="JIANT FM for tuttidaw: the JIANT FM firmware for the FM-1 in your browser, rendering into tuttidaw.">');
swap('<script type="module">', '<script type="module" src="tutti.js"></script>\n<script type="module">');
page = page.replace(/@VERSION@/g, esc(fwVersion)).replace(/@PREVIEW@/g, ` · JIANT FM plugin ${esc(PLUGIN_VERSION)}`);
put("plugin/index.html", page);

// ---- credits, licences, source
for (const f of ["LICENSE", "LICENSING.md", "README.md"]) copy(src(f), `licenses/${f}${f === "LICENSE" ? ".txt" : ""}`);
copy(src("web/plugin/README.md"), "licenses/PLUGIN-README.md");
for (const f of fs.readdirSync(src("LICENSES"))) copy(src("LICENSES", f), `licenses/LICENSES/${f}`);
const licences = fs.readdirSync(src("LICENSES")).map((f) => `<li><a href="licenses/LICENSES/${f}">${esc(f)}</a></li>`).join("\n");
const STYLE = `<style>
body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; margin: 0; color: #111; background: #f4f4f5; }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; }
a { color: #0b57d0; } code { font-size: 13px; } .notice { padding: 10px 14px; background: #fff; border-left: 4px solid #111; }
</style>`;
put("credits.html", `<!doctype html>
<!-- SPDX-License-Identifier: GPL-3.0-only -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JIANT FM plugin · credits, licences, source</title>${STYLE}</head><body><main>
<h1>JIANT FM plugin for tuttidaw</h1>
<p>Version ${esc(version)} · <a href="plugin/">open the plugin</a></p>
<p class="notice">This is <strong>weavejam's plugin build of JIANT FM</strong> by Juan Ignacio Antonucci (Juan Jiant).
<strong>${esc(NOTICE)}</strong> "M-VAVE" and "FM-1" are trademarks of their respective owners; "Felucca" and
"Hügelton Instruments" are names of Hügelton Instruments. This plugin runs JIANT FM, independent firmware for the FM-1,
in your browser; it contains no M-VAVE material.</p>
<h2>Who made it</h2>
<ul>
<li><strong>JIANT FM</strong>, the firmware this plugin is built from (all of the sound and the instrument), by
  Juan Ignacio Antonucci (<a href="https://github.com/juanjiant-bit">Juan Jiant</a>):
  <a href="${esc(UPSTREAM)}">${esc(UPSTREAM.replace(/^https:\/\//, ""))}</a>
  (<a href="licenses/README.md">README.md</a> with its credits, <a href="licenses/LICENSING.md">LICENSING.md</a>).</li>
<li>JIANT FM is a fork of <a href="https://github.com/hugelton/Felucca">Felucca</a> by
  <a href="https://github.com/kurogedelic">Leo Kuroshita</a>, <a href="https://hugelton.com">Hügelton Instruments</a>
  (the whole base of the firmware; PHASE's waveforms after CrispyZebra; the DRUM voices and kits; the Fukiai icon font),
  and Felucca's contributors: keremimo, ChanceTheMaker, andreahaku, spinkham, zednaked, jasonpersinger.</li>
<li><a href="https://github.com/isod89/sloop-fm1">SLOOP</a> by isod89 (GPL-3.0): the sections, quick chain and SONG REC
  system JIANT's song mode is based on.</li>
<li>The browser emulator it runs in: JIANT's <code>web/emu</code>, after <a href="https://github.com/charlesvestal/fm1-x0x">X0X</a>
  by charlesvestal (GPL-3.0).</li>
<li>The second core's start and its guard after <a href="https://github.com/keremimo/melodee">Melodee</a> (keremimo) and
  <a href="https://github.com/charlesvestal/fm1-x0x">fm1-x0x</a> (Charles Vestal); two feature designs after
  <a href="https://github.com/illuminus5/skiff">Skiff</a> (illuminus5); MIDI LEARN from Felucca 1.5; testing on a real
  FM-1 by praztalfractal (gospodindilly-ops).</li>
<li>FM6: msfa from <a href="https://github.com/asb2m10/dexed">Dexed</a>, Google Inc. and Pascal Gauthier (Apache-2.0).
  VOICE: after <a href="https://github.com/tgies/klattsch">klattsch</a> by Tony Gies (MIT, a design reference); the CMU
  Pronouncing Dictionary (BSD-2-Clause). Fonts: Chakra Petch, IBM Plex Mono, Michroma, Inter Tight, DotGothic16 (SIL OFL
  1.1), Fukiai (MIT).</li>
<li>The tuttidaw plugin (the headless renderer, the part stems, the fractional tempo, the protocol, this site):
  <strong>weavejam</strong>, in the fork <a href="${esc(SOURCE)}">${esc(SOURCE.replace(/^https:\/\//, ""))}</a>
  (<a href="licenses/PLUGIN-README.md">how it works</a>).</li>
</ul>
<h2>Licence</h2>
<p>This plugin is free software under the <a href="licenses/LICENSE.txt">GNU General Public License, version 3 only</a>
(GPL-3.0-only). It includes parts under other licences, each kept (Apache-2.0: msfa; MIT: the Fukiai font, fm1-clk320;
BSD-2-Clause: the CMU Pronouncing Dictionary's words; SIL OFL 1.1: the fonts; see
<a href="licenses/LICENSING.md">LICENSING.md</a>):</p>
<ul>
${licences}
</ul>
<h2>Source</h2>
<p>The complete corresponding source of this build (the firmware, the plugin, the site's build):
<a href="${esc(sourceAt)}">${esc(sourceAt)}</a>. Build it as <code>web/plugin/README.md</code> there says
(the generated headers, then <code>web/plugin/build.sh</code>).${dirty ? `</p>
<p class="notice">A development build (preview): it was built from a tree with changes not in that commit.` : ""}</p>
</main></body></html>
`);
put("index.html", `<!doctype html>
<!-- SPDX-License-Identifier: GPL-3.0-only -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JIANT FM plugin for tuttidaw</title>${STYLE}</head><body><main>
<h1>JIANT FM plugin for tuttidaw</h1>
<p>The JIANT FM firmware for the FM-1 (by Juan Jiant), running in your browser, as a <a href="https://tuttidaw.com">tuttidaw</a>
plugin (protocol <code>${PROTOCOL}</code>, manifest <a href="tutti-plugin.json">tutti-plugin.json</a>): weavejam's plugin build.</p>
<p><a href="plugin/">Open it on its own</a> (the emulator; your saves stay in this browser) ·
<a href="credits.html">credits, licences, source</a></p>
<p class="notice">${esc(NOTICE)}</p>
</main></body></html>
`);
put("icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1d1d1f"/><rect x="18" y="10" width="28" height="22" rx="3" fill="#0b0b0c" stroke="#3a3a3e"/><g fill="#2a2a2d" stroke="#3a3a3e">${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${8 + i * 8}" y="40" width="6" height="16" rx="3"/>`).join("")}</g><rect x="22" y="14" width="20" height="14" fill="#ec6e50" opacity=".85"/></svg>\n`);

// ---- the build id, the manifest, the headers
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); };
walk(out);
const h = crypto.createHash("sha256");
for (const f of files.map((f) => path.relative(out, f).split(path.sep).join("/")).sort()) {
  h.update(f + "\0");
  h.update(fs.readFileSync(path.join(out, f)));
}
h.update(`channel\0${channel}\0${EMBEDDERS.join(" ")}`);           // (the channel too: its embedders differ)
const build = h.digest("hex").slice(0, 16);
const manifest = {
  protocol: PROTOCOL,
  id: "com.weavejam.jiant",
  name: "JIANT FM",
  vendor: "weavejam (JIANT FM firmware by Juan Jiant)",
  version,
  build,
  license: "GPL-3.0-only",
  source: sourceAt,
  upstream: UPSTREAM,                                  // (informative: JIANT FM itself; receivers ignore unknown fields)
  notice: NOTICE,
  entry: "/plugin/",
  icon: "/icon.svg",
  state: { version: STATE_VERSION, reads: STATE_READS },
  capabilities: {
    ownSequencer: true,
    acceptsMidi: true,
    outputs: OUTPUTS,
    stemsSumToMix: false,
    tempoMap: "constant",
    sampleRates: SAMPLE_RATES,
    seek: false,                                       // every render plays from beat 0 (renderer.js)
    fm1Panel: true,                                    // a hardware FM-1 can play it (protocol 12, fm1-panel.js)
    midiChannels: [0, 1, 2, 3, 4, 5].map((channel) => ({ channel, name: `T${channel + 1}` })),   // (MIDI IN, ROUTE CH)
  },
};
put("tutti-plugin.json", JSON.stringify(manifest, null, 2) + "\n");
put("plugin/build-info.js", `// generated by web/plugin/site.mjs (PLUGIN_CHANNEL=${channel})
export const BUILD = ${JSON.stringify({ id: manifest.id, version, build, source: sourceAt, channel })};
export const EMBEDDERS = ${JSON.stringify(EMBEDDERS)};
`);
// the plugin page's policy: its one inline module (the emulator's page) by its hash, the rest from this origin only
const inline = [...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
if (inline.length !== 1 || /<script(?![^>]*\bsrc=)/.test(page.replace(inline[0][0], "")) || /\son[a-z]+\s*=/i.test(page.replace(inline[0][0], "")))
  throw new Error("site: plugin/index.html: one inline script (the emulator's module) and no inline handlers expected");
const inlineHash = crypto.createHash("sha256").update(inline[0][1], "utf8").digest("base64");
const ANCESTORS = EMBEDDERS.join(" ");
const PAGE_CSP = [`default-src 'none'`, `script-src 'self' 'sha256-${inlineHash}' 'wasm-unsafe-eval'`, `worker-src 'self'`,
                  `connect-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'`, `img-src 'self' data:`,
                  `frame-src 'none'`, `form-action 'none'`, `object-src 'none'`, `base-uri 'self'`,
                  `frame-ancestors ${ANCESTORS}`].join("; ");
// (Cloudflare Pages joins the values of every rule matching a path with commas: two policies, both enforced)
put("_headers", `# Cloudflare Pages (web/plugin/site.mjs, PLUGIN_CHANNEL=${channel})
/*
  Content-Security-Policy: frame-ancestors ${ANCESTORS}; object-src 'none'; base-uri 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=()
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/tutti-plugin.json
  Access-Control-Allow-Origin: *
  Cache-Control: no-cache
  Content-Type: application/json; charset=utf-8
/*.wasm
  Content-Type: application/wasm
/plugin/*
  Content-Security-Policy: ${PAGE_CSP}
/plugin/felucca.wasm
  Content-Type: application/wasm
`);
console.log(`plugin: ${out} (${channel}, ${files.length + 3} files, build ${build}, ${version})`);
