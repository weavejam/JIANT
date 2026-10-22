// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 weavejam
// JIANT FM behind a session (protocol.js engine): the state and its revisions, renders of a revision's state, the
// live device of the page (edit mode) when there is one. A state here is state.js's { sectors, songMode }.
//   render(state, request, sink) -> result       renderer.js render, here or in a Worker (render-worker.js)
//   live (edit mode, the page; null headless): {
//     load(state, context) -> Promise            (re)start the live device with this state
//     snapshot() -> Promise<state>               its state now (jiant_plugin.c tutti_snapshot)
//     context(context), transport(transport)     the host's tempo, its transport (preview, listen-only)
//     close()
//   } and it calls engine.changed() when its music or flash changed (the page's check, tutti.js)
// A revision is a state the host may ask a render of: 1 the one init gave (or the factory state), +1 when the live
// device changed since the last revision; its bytes are made when the host asks for them (get-state) or renders it,
// once: what asks for them while its snapshot is made waits for that snapshot (a revision is never two sets of bytes).
// stopRenders(): what close() stops besides the live device (the page: its render Worker's work, tutti.js).
import { packState, unpackState, emptyState, STATE_VERSION, StateError } from "./state.js";
import { RenderError, checkTimeMap, tempoAt, MIN_BPM, MAX_BPM } from "./renderer.js";

const KEEP = 8;                                        // revisions whose states are kept for renders

export class JiantEngine {
  constructor({ render, live = null, onChanged = () => {}, name = () => null, stopRenders = () => {} }) {
    this.renderFn = render;
    this.live = live;
    this.stopRenders = stopRenders;
    this.onChanged = onChanged;                        // (revision): the session's state-changed
    this.name = name;
    this.revision = 0;
    this.states = new Map();                           // revision -> { rev, buf, state }
    this.dirty = false;                                // the live device changed since `revision` was made
    this.epoch = 0;                                    // +1 per init: what an earlier session's await gives is dropped
    this.making = null;                                // the snapshot being made: { epoch, rev, p }
  }

  async init({ context, state, stateVersion, mode }) {
    const st = state ? unpackState(state, stateVersion) : emptyState();
    this.mode = mode;
    this.ctx = context;                                // (not `context`: that is the method)
    this.epoch++;
    this.revision = 1;
    this.dirty = false;
    this.making = null;
    this.states.clear();
    this.keep(1, { rev: 1, buf: state ? state.slice(0) : packState(st), state: st });   // (the input is never changed)
    if (mode === "edit" && this.live) await this.live.load(st, context);
    return { stateRevision: this.revision };
  }

  keep(rev, s) {
    this.states.set(rev, s);
    for (const k of [...this.states.keys()]) if (k <= rev - KEEP) this.states.delete(k);
  }

  // the live device changed (its music, a saved preset, a setting): a new revision from now
  changed() {
    if (!this.revision) return;
    if (!this.dirty) {
      this.dirty = true;
      this.revision++;
    }
    this.onChanged(this.revision);
  }

  // the state of the current revision ({ rev, buf, state }), made now if it is not yet: kept as the revision current
  // when it was asked for; asked for again while it is made, that same snapshot; if its session ended meanwhile
  // (another init), dropped, never kept
  async current() {
    const have = this.states.get(this.revision);
    if (have && !this.dirty) return have;
    if (!this.live || this.mode !== "edit") return have;
    const making = this.pending(this.revision);
    if (making) return making;
    this.dirty = false;                                // (a change from here on: the next revision)
    const epoch = this.epoch, rev = this.revision;
    const m = this.making = { epoch, rev, p: null };
    m.p = (async () => {
      try {
        const st = await this.live.snapshot();
        if (epoch !== this.epoch) throw new RenderError("session-ended", "the session ended");
        const s = { rev, buf: packState(st), state: st };
        this.keep(rev, s);
        return s;
      } finally {
        if (this.making === m) this.making = null;
      }
    })();
    return m.p;
  }
  // the snapshot of revision rev being made in this session, or null
  pending(rev) {
    const m = this.making;
    return m && m.epoch === this.epoch && m.rev === rev ? m.p : null;
  }

  async getState() {
    const s = await this.current();
    const name = this.name();
    return { state: s.buf.slice(0), stateVersion: STATE_VERSION, stateRevision: s.rev,
             ...(name ? { summary: { name } } : {}) };
  }

  context(ctx) {
    this.ctx = ctx;
    if (this.live) this.live.context(ctx);
  }
  transport(t) { if (this.live) this.live.transport(t); }

  async render(req, sink) {
    let s = this.states.get(req.stateRevision);
    if (req.stateRevision === this.revision) s = await this.current();
    else if (!s && this.pending(req.stateRevision)) s = await this.pending(req.stateRevision);   // (an edit since it was asked for)
    if (sink.cancelled()) throw new RenderError("cancelled", "cancelled");   // (its session ended while the state was made)
    if (!s) throw new RenderError("state-incompatible", `state revision ${req.stateRevision} is not known (now ${this.revision})`);
    return this.renderFn(s.state, req, sink);
  }

  close() {
    this.stopRenders();
    if (this.live) this.live.close();
  }
}

// the live preview's tempo (tutti.js live): the host's time map (`context`) and the tempo at a beat, within JIANT's
// range; send(bpm) when it changes
export class PreviewTempo {
  constructor(send) {
    this.send = send;
    this.pts = [{ beat: 0, bpm: 120, ramp: "step" }];
    this.bpm = 0;                                      // the one sent (0: none yet)
  }
  context(ctx) {
    try { this.pts = checkTimeMap(ctx && ctx.timeMap); } catch { return; }
    this.at(0);
  }
  at(beat) {
    const b = Math.min(MAX_BPM, Math.max(MIN_BPM, tempoAt(this.pts, beat)));
    if (b !== this.bpm) { this.bpm = b; this.send(b); }
  }
  reset() { this.bpm = 0; }                            // (a new device: the tempo sent again)
}

export { StateError };
