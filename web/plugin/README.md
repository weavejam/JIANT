# JIANT FM for tuttidaw (`web/plugin/`)

weavejam's plugin build of **JIANT FM** by Juan Ignacio Antonucci (Juan Jiant, <https://github.com/juanjiant-bit/JIANT>)
for [tuttidaw](https://tuttidaw.com) (protocol `tutti-plugin/0`, an "L0 offline plugin"): the browser emulator
(`web/emu/`, the whole firmware in WebAssembly) as the plugin's own UI, plus a headless renderer that renders JIANT's
music (or MIDI from tuttidaw) offline into a mix and six part stems, at tuttidaw's tempo. GPL-3.0-only like the rest of
JIANT. Not affiliated with or endorsed by M-VAVE or Hügelton Instruments.

## Build, run, test

```
python3 -c "import sys; sys.path.insert(0, 'tools'); import build; build.generate()"   # build/gen, as emulator.yml makes it
web/plugin/build.sh                 # -> build/plugin-wasm/felucca.wasm, build/plugin-site-preview/ (needs emcc, node)
PLUGIN_CHANNEL=production web/plugin/build.sh   # -> build/plugin-site/ (the one to deploy)
node web/plugin/plugin_test.mjs build/plugin-wasm/felucca.wasm [build/emu/felucca.wasm]
node web/plugin/dev/serve.mjs       # the preview site on http://127.0.0.1:8791/, a stand-in host on http://localhost:8792/
```

Emscripten 6.0.11 (the emulator's, `.github/workflows/emulator.yml`). `tests/run_tests.sh` builds and tests the plugin
too when `emcc` is there. The site is static (Cloudflare Pages or any host that reads `_headers`: the manifest's CORS
and `no-cache`, the CSPs, the wasm's type).

**Channels.** `PLUGIN_CHANNEL` (`production`, `preview`, or both separated by a space; default `preview`) decides which
pages may embed the build, and `site.mjs` writes that one list into both the page's `plugin/build-info.js`
(`EMBEDDERS`, the handshake's check) and `_headers`' `frame-ancestors`:

| Channel | Embedders | Out |
| --- | --- | --- |
| `production` | exactly `https://tuttidaw.com`, `https://www.tuttidaw.com` | `build/plugin-site/`, served at `https://jiant.plugins.tooljams.com` |
| `preview` | those and `http://localhost:<any port>` (tuttidaw's dev server, `dev/`) | `build/plugin-site-preview/`, served at `https://jiant-preview.plugins.tooljams.com` |

`.github/workflows/plugin-site.yml` builds both from one wasm and keeps the production site as an artifact on a push to
main (the only event a deployment may come from), the preview site on a pull request. A second job runs the host tests
of the firmware sources the `JIANT_TUTTI` parts touch (no JieLi toolchain needed).

**Source links.** The manifest's `source`, the credits page and the page's footer link the exact commit built
(`<repo>/tree/<sha>`). With no commit, or a tree with changes not in it, the build fails; `PLUGIN_ALLOW_DIRTY=1` lets a
preview through, its version marked `.dirty` (never a production build). The manifest's `upstream` names JIANT FM itself.

**The page's CSP** (`/plugin/*`): `default-src 'none'; script-src 'self' 'sha256-<the emulator's inline module>'
'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self';
img-src 'self' data:; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'; frame-ancestors ...`.

| File | What |
| --- | --- |
| `jiant_plugin.c` | the emulator (`web/emu/felucca_web.c`) built with `JIANT_TUTTI`, and the host's exports: tempo, headless render, MIDI at frames, the part captures and their stems, state snapshot, preview seek |
| `renderer.js` | a render: the time map's geometry, the request checked, a fresh instance per render, mix and stems, 48 kHz |
| `resample.js` | 44.1 kHz to 48 kHz |
| `state.js` | the state blob (the flash's storage sectors, the PLAY mode) |
| `protocol.js` | the session: handshake, messages, state machine, credited chunks |
| `engine.js` | state revisions, renders of a revision, the live device |
| `tutti.js`, `worklet-tutti.js`, `render-worker.js` | the page: the emulator's page and worklet with the protocol, renders in a Worker |
| `panel.js` | the page's layout at any frame size, the parts panel |
| `site.mjs`, `build.sh` | the static site, the manifest |
| `dev/` | a stand-in host and a server for development |
| `plugin_test.mjs` | the tests (Node) |

The design is FM-1's (weavejam's plugin of Felucca, <https://github.com/weavejam/Felucca> `web/plugin/`), adapted to
JIANT: six parts, the leveler, the SLICER's bus, CLIP and the DJ FILTER in the master, a song that needs the main loop.

## What the firmware does differently (`JIANT_TUTTI`)

Only builds that define `JIANT_TUTTI=1` (this plugin's) change; the hardware build, the host tests and the browser
emulator preprocess to the same code as without it (checked with `emcc -E` on `firmware/src/felucca.c`,
`web/emu/felucca_web.c`, `web/emu/native_check.c` and every `tests/*.c`; the emulator's wasm is byte for byte the same).

- **Fractional tempo.** The firmware's tempo is an integer `G_BPM` and a beat is `44100 * 60 / BPM` samples, truncated:
  at 123 BPM a track's step clock is 50 samples behind the ideal grid after 64 bars, and 123.45 BPM cannot be set at
  all. Hosted, the host's tempo is a beat in samples in Q32 (`tutti_beat_q32`), and every clock that counts the grid
  counts exact lengths: each step is `floor(end) - floor(start)` of its exact span (swing included), so the spans add up
  to the exact time. That is each track's step clock (`seq.c seq_tick`, TIMING's early steps kept as they are), the
  song's bar (`song_play.c chain_tick`: a section starts on it, the tracks from its fraction), the transport's 1/16
  (`click_tick`: the SLICER's and the FX layer's grid, the modulation sequences' clock) and the beat (`beat_pos`:
  MUTATE). 64 bars at 123.45 BPM: every bar of track 1 and of the song within 0.96 samples of `bar * 4 * 60 / bpm *
  44100` (`plugin_test.mjs`). What is timed by a whole number of samples (the delay's time, LFO SYNC, AUTO PAN, the ARP's
  rate, a ratchet) takes the beat rounded.
- **Each part's share.** Hosted headless (`tutti_on`), `mix_block` keeps each part's share of the block as `mix_part`
  added it: its dry L / R, what it put into the SLICER's bus and its CHORUS, DELAY and REVERB sends (the sums after it
  less the sums before: integers, so the mix is bit for bit the same, `plugin_test.mjs` checks it against the emulator's
  build), and what the master did to the whole: the SLICER's step state, what went into CLIP, the leveler's, the
  limiter's and the soft clip's gain on each sample, the globals the buses read.
- **The screen** shows the host's tempo (`HEAD_BPM`); the song's own `G_BPM` stays in the state.

## Stems and the mix

- `mix` is JIANT's master output exactly as the instrument makes it (the buses, the SLICER, the DJ FILTER, CLIP, the
  leveler, the DC blocker and SPEAKER EQ, the limiter, the soft clip), with MASTER at its top (the knob is a monitor
  volume; the live page keeps its own). The metronome's click is never in a render (it is the speaker's only on the FM-1
  too).
- `t1`..`t6` come from **the same render** as the mix: each part's share of every block (above), run in an instance of
  the firmware of its own through **its own** buses (fed by that part's sends only, a block behind as in the mix), its
  own SLICER (the mix's step state replayed each block, its own recording: a STUT repeats that part only) and DJ FILTER,
  then **the mix's** gains at that sample: CLIP's (from its curve at the mix's value), the leveler's, the limiter's and
  the soft clip's (so a stem is as loud and as squeezed as the part is in the mix), with the master's level, DC blocker
  and LOW CUT of its own.
- How they relate to the mix: with one part playing, its stem **is** the mix, bit for bit (also through the SLICER and
  the DJ FILTER; through CLIP within -59 dB: the mix's own CLIP steps its input by 16 and its output by 4). With several,
  the stems add up to the mix within about -50 dB (the heavy test song: -53 dB; with SLICER STUT on the returns, CLIP 60
  and the DJ FILTER: -50 dB): what is left is the buses (their gate and saturation see one part, not the sum) and the
  rounding of six stems. `stemsSumToMix` is `false` (informative: they are close, not exact). Not in the stems: BASS+ and
  the FX hold layer (a live performance gesture). A part with nothing playing, or asleep (MENU > TRACKS 4, the default:
  T5 and T6), gives a silent stem.
- JIANT's own browser stems (`web/emu/stems.js`) render each part alone in a fresh device, each through the whole
  master (its own leveler and limiter): those are the instrument's "solo" files. The plugin's stems are the parts of one
  render, as they sit in the mix.

## Timing

- **The device as the emulator runs it.** A render runs the emulator's own loop (`web_ms`: the millisecond clock, the
  audio ISR's halves of 128 frames, the main loop every 15 ms, which stages a song's next section), its splash skipped,
  the session's seed pinned (`web_seed`: GEN's seed and the power-on dice; the state's music restored after them).
- **Blocks.** The firmware takes its events (sequencer steps, MIDI) once per block of 32 frames (`CTL`). A step sounds
  at the first block boundary at or after its exact time (0 to 31 frames late, as on the FM-1); a MIDI note of use B
  goes in with the nearest block (within 16 frames of its time). There is no other latency: a render's frame 0 is the
  sound at `fromBeat` (`tutti_latency()` is 0).
- **Every render plays from the song's start.** A render of `[fromBeat, toBeat)` renders from beat 0 (transport started
  on the first block) and drops the frames before `fromBeat`, so notes held over `fromBeat`, delay and reverb tails,
  LFOs, automation and a song's rows are as when it plays through, and a render of a later range is bit for bit the
  same audio as that part of a render from 0.
- **Tempo maps.** `tempoMap: "constant"`: frame positions follow the host's map (protocol section 5: `frame(beat)`
  integrates it, linear ramps included); JIANT plays the range at the tempo in effect at `fromBeat`. A tempo change
  inside the range is refused (`unsupported`) unless the request says `approximation: "start-tempo"`; then the range is
  rendered at the start tempo throughout and is as long as that tempo makes it (protocol section 7; the host warps it).
- **Tempo range.** JIANT plays 40 .. 240 BPM (its own BPM's range, fractional within it). A render whose tempo at
  `fromBeat` is outside it gets `unsupported`; nothing is rendered at a different tempo.
- **No seek.** `capabilities.seek` is `false`: every render runs from beat 0, and `render-progress` goes over the
  pre-roll from beat 0 and the range together. The pre-roll has a budget as the result has (protocol 6: at most 600 s):
  `fromBeat` at most 610 s (600 s and the longest tail, 10 s) from beat 0 at the render's tempo, else `too-large`; so a
  render's work is at most twice the longest result. A range whose frames the firmware's counters (32 bits) cannot
  hold is a `bad-request`.
- **Use A / use B.** `input: null`: JIANT's own sequencer plays (use A), from beat 0, as PLAY starts it: the song's rows
  when the song layer's PLAY is SONG (the state keeps it), else the music; it stops at `toBeat` (the nearest block): its
  notes are released there and the tail only rings out. With `input` (use B) JIANT's sequencer never runs (protocol 7b:
  only the host's MIDI plays, the state gives the sounds and settings; realtime messages are not taken, so the MIDI
  cannot start it either) and the notes, CC and pitch bend go in as USB-MIDI would deliver them, MIDI IN's ROUTE as CH
  (whatever the state's): MIDI channels 0..5 ("1..6" on the device) play T1..T6 (the manifest's `midiChannels`; T5 and
  T6 sound with MENU > TRACKS 6). Notes are released at `min(end, toBeat)`; a note's off comes at least a block (32
  frames) after its on, so a note of length 0 (or less: taken as 0) still sounds and is let go, never off before on;
  moved that way, it still comes before the next note of the same pitch on the same channel, never cutting it. A
  channel whose sustain pedal (CC64) is down at `toBeat` gets CC64 0 there, after the offs (a pedal-up later is not in
  the range): its notes are let go at `toBeat` as without the pedal, their release and the effects ring out in the tail
  (no sound-off). A note lasts as the host says, whatever latches in the state: ARP 2's HOLD plays as OFF (each off
  takes its note out of the arp), and with `toBeat`'s block, after its offs, what is still held or latched is let go
  (the arp's notes, its sounding note ended as an off ends it): a runtime override (`tutti_input`, core.h
  `tutti_unlatch`), HOLD itself stays as it was in the state, the live preview and the emulator latch as always. KBD
  HOLD (LATCH, ARP OFF) holds the keys' notes only, never MIDI's; the kit's octave ratchets end with their note's off;
  FX LATCH latches what the keys turn on (runtime, not in the state); ARP TRNS moves the sequence, which does not run
  (`plugin_test.mjs`: with HOLD ON, ARP UP or OFF, a render is HOLD OFF's bit for bit).

## Sample rates

The firmware runs at 44.1 kHz only (its tables, filters and delays). `48000` is made from it by `resample.js`: a
polyphase windowed sinc at the exact ratio 160/147, 192 taps (Kaiser, beta 9.5, cut-off 0.95 of 22.05 kHz), centred
on each output frame (no delay), in double precision. A 1 kHz sine comes out within -120 dB of the ideal.

Cost (Node 24, the heavy test song): 60 s of the mix in about 3 s, with the six stems about 4 s; at 48 kHz with the six
stems about 16 s (the resampler).

## State

The state is the emulator's flash storage, the same sectors the emulator's page keeps (`web/emu/worklet.js`
`STORE_AREAS`: the songs' sections and index, the projects, user presets and their FM6 patches, settings, FM6's voice
bank, and the autosave holding the music), and the song layer's PLAY mode (SONG / LOOP), which the flash does not keep.
Before the state is read, everything the main loop would write later is written (`tutti_snapshot`: the pending
settings, the song's sections stored in RAM and its index, the music as the autosave; while a song plays, as in the
live preview in SONG mode, the music it keeps and brings back when it ends, not the section playing: its sections going
in are no edit and start no revision). A new instance loads the autosave
at power-on even with MENU > RESTORE LAST OFF, after the power-on dice (so the state's macros are the state's). Format
(`stateVersion` 1): `"JNTT"`, u32 version, u32 flags (bit 0: PLAY plays the song), u32 count, then count x (u32 offset,
4096 bytes), little-endian. A song is about 4 KiB, everything at most about 325 KiB. The hardware's backup files
(`web/fm1backup.js`) are not read as a state (they restore through the device's editor protocol); load them in the
emulator's own page or the editor, or rebuild the music here.

Revisions: 1 is the state `init` gave (or the factory state). An edit on the live device (its music, the PLAY mode, a
saved preset or project, a setting) starts the next revision, `state-changed` follows once it has been still for 600 ms
(at most every 2 s while it keeps changing). Renders take the state of the revision they ask for (the last 8 are kept).
A revision's bytes are made once: a `get-state` or a render that asks for it while its snapshot is being made waits for
that snapshot (an edit meanwhile is the next revision), so a revision never stands for two different states.

## The page

- In tuttidaw's frame: the handshake (accepted from the build's channel's embedders, above, from the parent window
  only), then `init`. Edit mode: the live device starts with the state (on its own if the browser lets the frame play
  sound, else with Switch on). It saves nothing in this browser, and tuttidaw's transport drives its preview
  (listen-only: it starts at `atEpochMs` less the output latency, a drift of over 20 ms re-seeks). A seek runs the
  sequencer up to the position at most 1024 blocks per audio quantum (`tutti_seek_run`, a song's next section staged
  every 16 blocks; silent meanwhile, the time it takes added), so a seek minutes into a song never stalls the audio
  thread. Render to tuttidaw sends `commit` (the mix, or with the T1..T6 stems). Renders run in a Worker, so the device
  and its screen stay live. `mode: "render"` is headless: no device, no audio, only renders.
- **Tempo while hosted.** The host's tempo is a runtime value: the screen shows it, but the song's own BPM (in the
  state) stays as it was, so tuttidaw's tempo never changes the state or starts a new revision. The BPM knob and TAP
  still change the song's own BPM (saved with the state), which plays no part while hosted.
- **Clock while hosted.** The live preview and every render play on the host's clock (the internal one at its tempo),
  also with MENU > CLOCK USB or TRS in the state: a runtime override (core.h `CLOCK_EXT`), the setting itself stays
  the user's (`get-state` gives it back as it was, the emulator opened by itself follows it).
- **Sessions.** A request keeps the session it came in with: what it sends after the session has ended is dropped,
  never sent into the next session, and a late `init` of an ended session leaves the next one uninitialised. A render
  still running in the Worker when the next session renders is stopped with its Worker. A session ends on `close`, the
  page going away or a message that cannot be read (`messageerror`, the port's or the render Worker's: protocol 3's
  port error), all alike: its render stopped (the Worker terminated), the port's handlers off and the port let go, so
  the next `connect` starts a new session. Credits (`render-credit`) add up to at most 4800 (8 outputs x 600 chunks
  of 1 s, protocol 6's budget).
- Opened by itself (or not connected within 4 s): the browser emulator, its saves in this browser, a seed of its own,
  with a note; a `connect` after that is refused (reload the frame to connect).
- **Any frame size, no scrollbars** (`panel.js`). tuttidaw opens the frame wide on a desktop and lets it be resized to
  anything from 480 x 360; the page fills it, whatever its size. The device is sized in layout units (its drawing and its
  hit areas are % of its box, `web/emu/index.html`), so it stays crisp and every control is where it is drawn.
  - **Wide** (at least 900 px wide and 1.3 times as wide as high): the device's tall drawing at the frame's full height on
    the left; on the right the render controls and **the parts panel**: the transport (playing, the tempo, bar and beat,
    PLAY's SONG / LOOP, the section playing and the one asked for), the six parts (engine and sound, MUTE / ASLEEP / ARP /
    HOLD, a level meter, the pattern's steps, struck and tied, with the playhead, the selected part outlined) and the
    song's rows (section and bars, the one playing lit); then the keys, the credits (what does not fit goes, the parts
    stay). It only shows what the device plays (`jiant_plugin.c tutti_view`, with the frames from the worklet; the
    meters: each part's share of the mix as a render keeps it, `tutti_meters`, the sound bit for bit the same); nothing
    in it changes the device.
  - **Otherwise** (a phone sheet, a small window): the device alone, in whichever drawing (the FM-1's wide one or the
    tall one) is the larger in the frame, the render controls and a credits link in one line under it.
  - `resize` is sent once connected, as a hint: 1280 x 800, the wide layout's own size.
  - Opened by itself: the same.
  - `screenshots/`: the frame at 1280 x 820, 1600 x 900, 900 x 700, 480 x 360 and 390 x 780 (Chromium, in the dev host).
- `/credits.html`: who made what (JIANT FM, Felucca, SLOOP, X0X and the rest of JIANT's credits), the licences, the
  source of the build, the non-affiliation. The page's footer links it and shows the source URL as text too.

## Not done (yet)

- `tempoMap: "full"` (tempo changes inside a render): the firmware's clocks would need the tempo per block.
- Sub-block timing (steps and MIDI to the sample): the firmware's control rate is a block of 32 frames.
- The hardware backup format as a state (above).
- Web MIDI in tuttidaw's frame (the manifest asks no `midi` permission; opened by itself it has the emulator's MIDI in).
