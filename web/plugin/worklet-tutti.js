// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 weavejam
// The plugin page's live JIANT FM: the emulator's worklet (web/emu/worklet.js, its Felucca processor) on the plugin's
// build (jiant_plugin.c) with what the host needs from it:
//   load            {wasm?, sectors, songMode, hosted, master}: hosted, booted by tutti_boot (the session's seed pinned,
//                   the state's music, RESTORE LAST or not, its PLAY mode, the host's clock whatever MENU CLOCK
//                   says); on its own (standalone) as the emulator's (a seed of its own, its CLOCK); again for a new
//                   state (the module kept)
//   tutti-tempo     {bpm}: the host's tempo (fractional)
//   tutti-play      {gen, playing, atFrame, pos}: the host's transport, listen-only: play from `pos` (frames of
//                   44.1 kHz from beat 0) at this context's frame `atFrame`; the same generation again: only a drift
//                   of over 20 ms moves it (re-seek); not playing: stop. A seek runs the sequencer up to `pos` at most
//                   SEEK_BLOCKS blocks per render quantum (jiant_plugin.c tutti_seek_run), silent until it is there
//   tutti-snapshot  {id}: the music written as the autosave, the state back {type: tutti-snapshot, id, ok, state, sig}
//                   (state.js: the storage sectors, the PLAY mode)
//   tutti-view      {on}: the parts panel's view (jiant_plugin.c tutti_view: the song, each part's steps and meter)
//                   with every frame, or no more
// and out: {type: tutti-sig, sig} when the music (project.c autosave_sig) or the PLAY mode changed; {type: tutti-view,
// view, names} with the frames while the view is on (names: each part's engine and factory preset).
import { storeSectors, restoreSectors } from "../emu/worklet.js";

const Base = globalThis.FeluccaProcessor;
const DRIFT = 0.02;                                    // s
const SEEK_BLOCKS = 1024;                               // a seek's blocks per render quantum (plugin_test.mjs times them)

const sigOf = (ex) => (ex.tutti_sig() ^ (ex.tutti_song_mode() ? 0x5bd1e995 : 0)) >>> 0;

class JiantTutti extends Base {
  constructor() {
    super();
    this.module = null;
    this.bpm = 0;
    this.play = null;                                  // a start to come: {gen, atFrame, pos}
    this.at = null;                                    // playing: {gen, frame, pos} (pos at that frame)
    this.seeking = null;                               // a seek on its way: {gen, frame, pos} (pos at that frame)
    this.sentSig = null;
    this.view = false;
  }

  async onMessage(m) {
    if (m.type === "load") return this.load(m);
    if (m.type === "tutti-tempo") {
      this.bpm = m.bpm;
      if (this.ex) this.ex.tutti_tempo(m.bpm);         // (out of JIANT's range: refused, the tempo stays)
      return;
    }
    const ex = this.ex;
    if (!ex) return;
    if (m.type === "tutti-play") return this.schedule(m);
    if (m.type === "tutti-view") {
      this.view = !!m.on;
      ex.tutti_meters(this.view ? 1 : 0);
      return;
    }
    if (m.type === "tutti-snapshot") {
      const ok = ex.tutti_snapshot();
      const sectors = storeSectors(new Uint8Array(ex.memory.buffer, ex.web_nor(), ex.web_nor_size()));
      this.sentWrites = ex.web_flash_writes_count();   // (they go with this reply, not with a frame)
      this.sentSig = sigOf(ex);
      this.port.postMessage({ type: "tutti-snapshot", id: m.id, ok: !!ok, state: { sectors, songMode: !!ex.tutti_song_mode() },
                              sig: this.sentSig });
      return;
    }
    return super.onMessage(m);
  }

  async load(m) {
    try {
      if (m.wasm) this.module = await WebAssembly.compile(m.wasm);
      const { exports: ex } = await WebAssembly.instantiate(this.module, {});
      ex._initialize();
      ex.web_nor_erase();
      restoreSectors(new Uint8Array(ex.memory.buffer, ex.web_nor(), ex.web_nor_size()), m.sectors);
      ex.web_master(m.master ?? 700);
      if (m.hosted) {
        ex.tutti_boot(0);
        ex.tutti_set_song_mode(m.songMode ? 1 : 0);
      } else {                                         // (on its own: the emulator, this session's macros its own)
        ex.web_seed((Math.random() * 4294967296) >>> 0);
        ex.web_boot();
      }
      if (this.bpm) ex.tutti_tempo(this.bpm);
      ex.tutti_meters(this.view ? 1 : 0);
      this.ex = ex;
      this.sentWrites = ex.web_flash_writes_count();
      this.sentDraws = -1;
      this.sentLeds = "";
      this.queue = [];
      this.play = this.at = this.seeking = null;
      this.sentSig = null;
      this.port.postMessage({ type: "ready", rate: ex.web_sample_rate() });
    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err && err.message || err) });
    }
  }

  schedule(m) {
    if (!m.playing) {
      this.play = null;
      if (this.at || this.seeking) this.ex.tutti_seek(0, 0);
      this.at = this.seeking = null;
      return;
    }
    const run = this.at || this.seeking;
    if (run && run.gen === m.gen) {                    // still the same run: only a drift moves it
      const ours = run.pos + (m.atFrame - run.frame);
      if (Math.abs(ours - m.pos) <= DRIFT * sampleRate) return;
    }
    this.play = { gen: m.gen, atFrame: m.atFrame, pos: m.pos };
  }

  process(inputs, outputs) {
    const p = this.play, ex = this.ex;
    let left = 0;                                      // a seek's blocks still to run
    if (ex && p && currentFrame + 128 > p.atFrame) {    // (the quantum it starts in)
      this.play = this.at = null;
      const pos = Math.max(0, Math.round(p.pos + (currentFrame - p.atFrame)));
      ex.tutti_seek(1, pos);
      this.seeking = { gen: p.gen, frame: currentFrame, pos };
      left = ex.tutti_seek_run(SEEK_BLOCKS, 0);
    } else if (ex && this.seeking)                     // on with it, the last (silent) quantum's time added
      left = ex.tutti_seek_run(SEEK_BLOCKS, outputs[0][0].length / ex.tutti_block_frames());
    if (this.seeking) {
      if (left) return true;                           // not there yet: silence (the outputs are zeros), the UI waits
      const s = this.seeking;
      this.seeking = null;
      this.at = { gen: s.gen, frame: currentFrame, pos: s.pos + (currentFrame - s.frame) };
    }
    return super.process(inputs, outputs);
  }

  publish() {
    super.publish();
    if (this.view) {
      const ex = this.ex, view = new Uint8Array(ex.memory.buffer, ex.tutti_view(), ex.tutti_view_size()).slice();
      const str = (p) => { const m = new Uint8Array(ex.memory.buffer); let s = ""; while (m[p] && s.length < 32) s += String.fromCharCode(m[p++]); return s; };
      const names = [];
      for (let p = 0; p < ex.tutti_parts(); p++) {
        const q = 48 + p * 32;                         // (jiant_plugin.c TV_HEAD, TV_PART)
        names.push([str(ex.tutti_engine_name(view[q])), view[q + 28] ? "" : str(ex.tutti_preset_name(view[q], view[q + 29]))]);
      }
      this.port.postMessage({ type: "tutti-view", view, names }, [view.buffer]);
    }
    const sig = sigOf(this.ex);
    if (sig !== this.sentSig) {
      this.sentSig = sig;
      this.port.postMessage({ type: "tutti-sig", sig });
    }
  }
}
registerProcessor("jiant-tutti", JiantTutti);
