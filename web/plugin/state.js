// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 weavejam
// The plugin's state (tutti-plugin/0 `state`, opaque to the host): the flash's storage sectors, as the browser emulator
// keeps them (web/emu/worklet.js STORE_AREAS: the songs' sections and index, the projects, the user presets and their
// FM6 patches, the autosave that holds the music (written just before, jiant_plugin.c tutti_snapshot), FM6's voice
// bank, the settings), only those that hold something, and what PLAY plays (the song layer's SONG / LOOP mode: the
// flash does not keep it). Version 1, little-endian:
//   "JNTT"  u32 version (1)  u32 flags (bit 0: PLAY plays the song)  u32 count  then count x { u32 offset, 4096 bytes }
//   (offsets ascending)
// At most 73 + 2 + 4 sectors (~ 325 KiB), far under the host's 8 MiB.
// A state in JS: { sectors: {offset: Uint8Array(4096)}, songMode: boolean }.
import { STORE_AREAS } from "../emu/worklet.js";

export const STATE_VERSION = 1;
export const STATE_READS = [1, 1];
const MAGIC = 0x5454_4e4a;                             // "JNTT"
const SECTOR = 4096, HEAD = 16;

export class StateError extends Error {
  constructor(message) { super(message); this.name = "StateError"; this.code = "state-incompatible"; }
}

export const emptyState = () => ({ sectors: {}, songMode: false });

export function packState({ sectors, songMode }) {
  const offs = Object.keys(sectors).map(Number).sort((a, b) => a - b);
  const buf = new ArrayBuffer(HEAD + offs.length * (4 + SECTOR)), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, STATE_VERSION, true);
  dv.setUint32(8, songMode ? 1 : 0, true);
  dv.setUint32(12, offs.length, true);
  offs.forEach((off, i) => {
    const p = HEAD + i * (4 + SECTOR);
    dv.setUint32(p, off, true);
    u8.set(sectors[off], p + 4);
  });
  return buf;
}

// -> { sectors (copies: the input is never changed), songMode }; StateError when it is not one
export function unpackState(buf, version = STATE_VERSION) {
  if (version < STATE_READS[0] || version > STATE_READS[1]) throw new StateError(`state version ${version} not read by this plugin`);
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEAD) throw new StateError("not a JIANT FM state");
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new StateError("not a JIANT FM state");
  if (dv.getUint32(4, true) !== version) throw new StateError("state version differs from its header");
  const flags = dv.getUint32(8, true), n = dv.getUint32(12, true);
  if (flags & ~1) throw new StateError("state flags not known to this plugin");
  if (buf.byteLength !== HEAD + n * (4 + SECTOR)) throw new StateError("state truncated or padded");
  const sectors = {};
  let last = -1;
  for (let i = 0; i < n; i++) {
    const p = HEAD + i * (4 + SECTOR), off = dv.getUint32(p, true);
    if (off <= last || off % SECTOR || !STORE_AREAS.some(([a, e]) => off >= a && off + SECTOR <= e))
      throw new StateError(`state sector at ${off} not a storage sector`);
    sectors[off] = u8.slice(p + 4, p + 4 + SECTOR);
    last = off;
  }
  return { sectors, songMode: !!(flags & 1) };
}

// the bytes a state is: for tests and the page (two states with the same music and settings are the same bytes)
export function stateEquals(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
