/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 weavejam
 * Parts derived from JIANT / Felucca (tutti_snapshot after project.c settings_poll, autosave_poll and song_main.c
 * song_poll's writes, tutti_restore after autosave_boot, tutti_stem_render after fx.c mix_block and master_out, the
 * SLICER's replay after slicer.c slicer_bus):
 * Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments
 * Copyright (C) 2026 Juan Ignacio Antonucci (Juan Jiant)
 * JIANT FM for tuttidaw (protocol tutti-plugin/0, web/plugin/README.md): the browser emulator (web/emu/felucca_web.c,
 * the whole firmware against a simulated FM-1) built with JIANT_TUTTI, plus what a host needs:
 *   - the host's tempo, fractional (core.h tutti_beat_q32: the step clocks keep to its grid over any length);
 *   - a headless render: the device as the emulator runs it (its millisecond clock, the audio halves, the main loop
 *     that stages a song's sections), its splash skipped, the transport started on a block of the host's choosing
 *     (frame 0 of the render), MIDI events at frames (use B), each part's share of every block kept (fx.c tutti_part);
 *   - a part's stem from those (tutti_stem_render, in an instance of its own: its own buses, SLICER and DJ FILTER,
 *     the mix's master gains, see README);
 *   - the state: the music written as the autosave (project.c), the song's sections and index flushed, the flash's
 *     storage sectors read by the page;
 *   - for the live page: where the music has changed (tutti_sig), the transport placed at a frame (tutti_seek).
 *   web/plugin/build.sh  ->  build/plugin-site/plugin/felucca.wasm */
#define JIANT_TUTTI 1
#include "../emu/felucca_web.c"

/* ------------------------------------------------------------ the tempo --- */
/* the host's tempo: the firmware's own range (params.c G_BPM, 40 .. 240), fractional. A runtime value only: the song's
 * G_BPM (in the state and the autosave's signature) stays JIANT's own, and while hosted its BPM knob and TAP change
 * that, not the tempo; the screen shows the host's (core.h HEAD_BPM) */
#define TUTTI_BPM_MIN 40.0
#define TUTTI_BPM_MAX 240.0
EXPORT double tutti_bpm_min(void) { return TUTTI_BPM_MIN; }
EXPORT double tutti_bpm_max(void) { return TUTTI_BPM_MAX; }
/* 1 = set; 0 = out of the range (nothing changed). 0 bpm: none, G_BPM again */
EXPORT uint32_t tutti_tempo(double bpm)
{
    double s;
    if (bpm == 0.0) {
        tutti_beat_q32 = 0;
        tutti_bpm_shown = 0;
        return 1;
    }
    if (!(bpm >= TUTTI_BPM_MIN && bpm <= TUTTI_BPM_MAX))
        return 0;
    s = (double)FS * 60.0 / bpm;
    tutti_beat_q32 = (uint64_t)(s * 4294967296.0 + 0.5);
    tutti_bpm_shown = (int16_t)(bpm + 0.5);
    return 1;
}

/* ------------------------------------------------------------ the state --- */
/* everything the main loop would write later, written now: the settings a MENU change left pending (project.c
 * settings_poll, without its wait for the transport), the song's sections stored in RAM and its index (song_main.c
 * song_poll), and the music as it is into the autosave (autosave_poll's write): then the flash's storage sectors are
 * the whole state. 1 = written */
EXPORT uint32_t tutti_snapshot(void)
{
    persist_t p;
    uint32_t k;
    if (!flash_ok)
        return 0;
    p = persist_saved;
    settings_export(&p);
    if (memcmp(&p, &persist_saved, sizeof p)) {
        if (st_save(OBJ_SETTINGS, &p, sizeof p) != 0)
            return 0;
        persist_saved = p;
    }
    persist_pending = 0;
    for (k = 0; k < 4u; k++)
        if (((live.dirty >> k) & 1u) && !st_save(proj_obj(k), &proj_slot[k], sizeof proj_slot[k]))
            live.dirty &= (uint8_t)~(1u << k);
    if (live.dirty)
        return 0;
    if (song_idx_dirty || memcmp(&chain_config, &song_idx.rows[song_cur], sizeof chain_config) ||
        song_idx.cur != song_cur) {
        if (song_index_save())
            return 0;
    }
    if ((chain.running || chain.armed) && chain.kept) {   /* a song playing: the music is what it keeps (song_main.c
                                                       * song_keep: back when it ends), not its section now */
        if (st_save(OBJ_AUTOSAVE, &song_keep, sizeof song_keep) != 0)
            return 0;
        return 1;
    }
    project_capture(&proj_scratch);
    proj_wire_gen++;
    if (!proj_pack(&proj_wire, &proj_scratch) || st_save(OBJ_AUTOSAVE, &proj_wire, sizeof proj_wire) != 0)
        return 0;
    as.saved = as.seen = autosave_sig();
    as.last = fm1_ms;
    as.wrote = 1;
    return 1;
}
/* what the music is (project.c autosave_sig: a hash of what a project holds); while a song plays, the music it keeps
 * (as before it started: its sections going in are no edit, and what is changed meanwhile goes when it ends) */
static uint32_t tt_sig;
EXPORT uint32_t tutti_sig(void)
{
    if (!(chain.running || chain.armed) || !chain.kept)
        tt_sig = autosave_sig();
    return tt_sig;
}
/* the song layer's PLAY: 1 SONG (the song's rows), 0 LOOP (the music): not a setting the flash keeps, so the plugin's
 * state carries it (state.js) */
EXPORT uint32_t tutti_song_mode(void) { return live.mode; }
EXPORT void tutti_set_song_mode(uint32_t on) { live.mode = (uint8_t)(on != 0u); }

/* the autosave as the music in any case: with MENU > SYSTEM > RESTORE LAST OFF too (autosave_boot skips it then), and
 * again after session_dice (main.c: this session's macros, which a host's state already holds): a host's state is the
 * music it saved, nothing else */
static void tutti_restore(void)
{
    int n;
    if (!flash_ok)
        return;
    proj_wire_gen++;
    n = st_load(OBJ_AUTOSAVE, &proj_wire, sizeof proj_wire);
    if (n > 0 && proj_import(&proj_scratch, &proj_wire, n)) {
        proj_bound(&proj_scratch);
        project_restore_runtime(&proj_scratch);
    }
    as.saved = as.seen = autosave_sig();
}

/* ----------------------------------------------------- the headless device --- */
#define TT_SEED 0x4A49414Eu                /* "JIAN": the session's seed, pinned (web_seed: GEN's SEED, the dice) */
#define TT_MAXB 128u                       /* blocks a call renders at most (4096 frames, 32 halves) */
static float tt_l[TT_MAXB * CTL], tt_r[TT_MAXB * CTL];
static int32_t tt_cap[NPART][TT_MAXB][TT_NCAP][CTL];   /* each part's share of each block of a call (fx.c tutti_part) */
static tutti_blk_t tt_blk[TT_MAXB];                     /* .. and the master's (fx.c tutti_b) */
static uint8_t tt_meter;                                /* the live page's meters (tutti_meters, below) */
static void tt_meter_block(uint32_t n);
static uint32_t tt_capture, tt_nb, tt_cur, tt_frames, tt_headless;

/* power on as web_boot, for the host: the session's seed pinned, the state's music in any case, the host's clock (the
 * internal one at the host's tempo, core.h CLOCK_EXT: the live preview and a render alike, MENU CLOCK as the state has
 * it, USB or TRS too; the setting itself unchanged, the state keeps it). headless (a render): the splash over at once
 * (the main loop from the next millisecond), the keys free, MASTER at its top (the render's level; the live page keeps
 * its knob), no recording, no click, MIDI IN's channels to their parts */
EXPORT void tutti_boot(uint32_t headless)
{
    tt_headless = headless;
    tutti_hosted = 1;
    web_seed(TT_SEED);
    web_boot();
    tutti_restore();
    if (headless) {
        web_boot_ms = fm1_ms + 1u;
        kb_boot_hold = 0;
        web_master(1023);
        song.master_q12 = MASTER_FULL;
        song.g[G_ROUTE] = 0;                          /* MIDI channels 1..6 play T1..T6 (manifest midiChannels) */
        song.rec = 0;
    }
}

/* MIDI events at frames from the transport's start (use B), in time order: each goes in with the block whose start is
 * nearest (the firmware takes MIDI per block of CTL frames: within CTL / 2), as USB-MIDI's packets arrive */
#define TT_NEV 65536u
static struct { uint32_t frame, pkt; } tt_ev[TT_NEV];
static uint32_t tt_nev, tt_evr;
EXPORT uint32_t tutti_event(uint32_t frame, uint32_t status, uint32_t d1, uint32_t d2)
{
    if (tt_nev >= TT_NEV || status < 0x80u || status >= 0xF0u)
        return 0;
    tt_ev[tt_nev].frame = frame;
    tt_ev[tt_nev].pkt = (status >> 4) | status << 8 | (d1 & 127u) << 16 | (d2 & 127u) << 24;
    tt_nev++;
    return 1;
}

/* the transport from the first block rendered (frame 0 of the render: step 0 of every track there), as PLAY starts it
 * (ui_input.c: the song layer's SONG mode plays the song's rows, else the music); stopped with the block nearest to
 * frame `stop` (toBeat: the notes let go there, the tail only rings out; ~0u: never) */
static uint32_t tt_stop = ~0u, tt_start;
EXPORT void tutti_start(uint32_t stop)
{
    tt_start = 1;
    tt_stop = stop;
}

/* use B (the host's MIDI, the sequencer never started): the host's notes last as it says, whatever latches in the state
 * (core.h tutti_unlatch: ARP 2's HOLD as OFF, the setting unchanged), and with the block nearest to frame `stop`
 * (toBeat: the offs and CC64 0 there) what is still held or latched is let go (seq.c tutti_unhold), the tail only
 * rings out. The live page never calls it */
static uint32_t tt_unhold = ~0u;
EXPORT void tutti_input(uint32_t stop)
{
    tutti_unlatch = 1;
    tt_unhold = stop;
}

/* audio.c audio_block, before each block's mix: the host's MIDI due, the transport */
static void tutti_block_begin(void)
{
    uint32_t f0 = tt_frames;
    tt_frames += CTL;
    tt_cur = tt_nb < TT_MAXB ? tt_nb : TT_MAXB - 1u;
    tt_nb++;
    if (!tt_headless)
        return;
    song.master_q12 = MASTER_FULL;
    click_mode = CLICK_OFF;                           /* (the metronome: the speaker's, never in a render) */
    if (tt_start) {
        tt_start = 0;
        if (!(live.mode && !chain_prepare()))         /* (SONG: chain_prepare asks for PLAY itself) */
            transport_req = 1;
    }
    while (tt_evr < tt_nev && tt_ev[tt_evr].frame < f0 + CTL / 2u) {
        if (mi_w - mi_r >= MQ - 1u)
            break;                                    /* the queue full: the rest with the next block */
        midi_enqueue(tt_ev[tt_evr].pkt, 1);
        tt_evr++;
    }
    if (tt_stop != ~0u && f0 + CTL / 2u > tt_stop) {
        transport_req = 2;                            /* (seq.c events_block: seq_stop, before the steps) */
        tt_stop = ~0u;
    }
    if (tt_unhold != ~0u && f0 + CTL / 2u > tt_unhold) {
        tutti_let_go = 1;                             /* (seq.c events_block: after this block's MIDI, its offs) */
        tt_unhold = ~0u;
    }
}

/* fx.c mix_block, after each block (or its silence): the parts' shares and the master's into the call's capture */
static void tutti_block(uint32_t n)
{
    uint32_t p;
    if (tt_meter)
        tt_meter_block(n);
    if (!tt_capture)
        return;
    for (p = 0; p < NPART; p++)
        memcpy(tt_cap[p][tt_cur], tutti_pc[p], sizeof tutti_pc[p]);
    tt_blk[tt_cur] = tutti_b;
}

/* nhalves (<= TT_MAXB / 4) halves of HALF_FRAMES into tutti_out_l / _r: the device runs (web_ms: its clock, the audio
 * ISR's halves, the main loop) until they exist; capture: each block's shares too (tutti_cap, tutti_blk) */
EXPORT uint32_t tutti_render(uint32_t nhalves, uint32_t capture)
{
    uint32_t k, n;
    if (nhalves > TT_MAXB * CTL / HALF_FRAMES)
        nhalves = TT_MAXB * CTL / HALF_FRAMES;
    n = nhalves * HALF_FRAMES;
    tt_capture = capture;
    tutti_on = (uint8_t)(tt_headless && capture);     /* each part's share kept (fx.c): only for stems */
    tt_nb = 0;
    if (capture)
        memset(tt_cap, 0, sizeof tt_cap);
    while (ring_w - ring_r < n)
        web_ms();
    for (k = 0; k < n; k++) {
        uint32_t i = (ring_r++ % RING) * 2u;
        tt_l[k] = ring[i];
        tt_r[k] = ring[i + 1];
    }
    tt_capture = 0;
    tutti_on = tt_meter;
    return n;
}
EXPORT float *tutti_out_l(void) { return tt_l; }
EXPORT float *tutti_out_r(void) { return tt_r; }
EXPORT int32_t *tutti_cap(uint32_t p) { return &tt_cap[p % NPART][0][0][0]; }
EXPORT tutti_blk_t *tutti_blk(void) { return tt_blk; }
EXPORT uint32_t tutti_blk_size(void) { return (uint32_t)sizeof(tutti_blk_t); }
EXPORT uint32_t tutti_ncap(void) { return TT_NCAP; }
EXPORT uint32_t tutti_block_frames(void) { return CTL; }
EXPORT uint32_t tutti_half_frames(void) { return HALF_FRAMES; }
EXPORT uint32_t tutti_max_blocks(void) { return TT_MAXB; }
EXPORT uint32_t tutti_parts(void) { return NPART; }
EXPORT int16_t *tutti_song_g(void) { return song.g; }
/* frames from an event to its sound: none (a step, a MIDI note sounds in the block it is taken in; the firmware takes
 * them per block, so within CTL frames of their time, see tutti_block_begin and README) */
EXPORT uint32_t tutti_latency(void) { return 0; }
/* the step clocks, for the tests: track t's step and samples into it at the last block's start (seq.c seq_tick) */
EXPORT uint32_t tutti_seq_idx(uint32_t t) { return trk[t % NTRK].seq_idx; }
EXPORT uint32_t tutti_seq_pos(uint32_t t) { return trk[t % NTRK].seq_pos; }
EXPORT uint32_t tutti_bar_n(void) { return bar_n; }

/* ------------------------------------------------------- the page's view --- */
/* The plugin page's parts panel (tutti.js, the wide layout): what the device plays, read only, nothing in it changes
 * the device. Meters: on the live device (not headless), each part's share of every block kept (fx.c tutti_part, as for
 * a render: the mix bit for bit the same) and its peak taken here, dry and SLICER bus (its sends left out), until
 * tutti_view reads it */
static uint32_t tt_peak[NPART];
EXPORT void tutti_meters(uint32_t on)
{
    tt_meter = (uint8_t)(on && !tt_headless);
    tutti_on = tt_meter;
}
static void tt_meter_block(uint32_t n)
{
    uint32_t p, k, i;
    for (p = 0; p < NPART; p++)
        for (k = TT_L; k <= TT_SR; k++)
            for (i = 0; i < n; i++) {
                int32_t x = tutti_pc[p][k][i];
                uint32_t a = (uint32_t)(x < 0 ? -x : x);
                if (a > tt_peak[p])
                    tt_peak[p] = a;
            }
}
/* the view, TV_SIZE bytes (tutti.js reads it by these offsets): the song, its rows, then each part's TV_PART bytes */
#define TV_HEAD 48u
#define TV_PART 32u
#define TV_SIZE (TV_HEAD + NPART * TV_PART)
static uint8_t tt_view[TV_SIZE];
EXPORT uint32_t tutti_view_size(void) { return TV_SIZE; }
EXPORT uint8_t *tutti_view(void)
{
    uint8_t *v = tt_view;
    uint32_t p, s, k;
    memset(tt_view, 0, sizeof tt_view);
    v[0] = song.playing;
    v[1] = song.sel;
    v[2] = trk_live;
    v[3] = live.mode;
    v[4] = chain.running;
    v[5] = chain.row;
    v[6] = chain_config.count < CHAIN_ROWS ? chain_config.count : CHAIN_ROWS;
    v[7] = (uint8_t)(live.cur + 1);                    /* the section playing + 1 (0: none) */
    v[8] = chain.remaining;
    v[9] = (uint8_t)beat_n;
    v[10] = (uint8_t)bar_n;
    v[11] = (uint8_t)(bar_n >> 8);
    v[12] = (uint8_t)HEAD_BPM;
    v[13] = (uint8_t)(HEAD_BPM >> 8);
    v[14] = chain.armed;
    v[15] = (uint8_t)(live.req + 1);                   /* a section asked for + 1 (0: none) */
    for (k = 0; k < CHAIN_ROWS; k++) {                 /* the rows: section, bars */
        v[16u + 2u * k] = chain_config.row[k].slot;
        v[17u + 2u * k] = chain_config.row[k].bars;
    }
    for (p = 0; p < NPART; p++) {
        const track_t *t = &trk[p];
        uint8_t *q = v + TV_HEAD + p * TV_PART;
        uint32_t len = t->p[P_SLEN] > 0 && t->p[P_SLEN] <= NSTEP ? (uint32_t)t->p[P_SLEN] : 1u, vo = 0;
        q[0] = (uint8_t)eng_idx(t->engine);
        q[1] = (uint8_t)(t->p[P_MUTE] != 0);
        q[2] = (uint8_t)len;
        q[3] = (uint8_t)(t->seq_idx % len);
        q[4] = (uint8_t)clamp(t->p[P_LEVEL], 0, 127);
        q[5] = (uint8_t)clamp(t->p[P_AMODE], 0, 255);
        q[6] = (uint8_t)(t->p[P_AHOLD] != 0);
        for (k = 0; k < NVOICE; k++)
            vo += t->v[k].active != 0;
        q[7] = (uint8_t)vo;
        for (s = 0; s < NSTEP; s++) {                  /* the steps: one that strikes, one that ties */
            const step_t *st = &t->step[s];
            if ((st->n && st->time == ST_NOTE) || st->hit)
                q[8u + s / 8u] |= (uint8_t)(1u << (s % 8u));
            else if (st->n && st->time == ST_TIE)
                q[16u + s / 8u] |= (uint8_t)(1u << (s % 8u));
        }
        q[24] = (uint8_t)tt_peak[p];
        q[25] = (uint8_t)(tt_peak[p] >> 8);
        q[26] = (uint8_t)(tt_peak[p] >> 16);
        q[27] = (uint8_t)(tt_peak[p] >> 24);
        q[28] = t->user;
        q[29] = t->preset;
        tt_peak[p] = 0;
    }
    return tt_view;
}
/* engine e's name, its factory preset k's ("" none) */
EXPORT const char *tutti_engine_name(uint32_t e) { return ENGINES[eng_idx(e)]->name; }
EXPORT const char *tutti_preset_name(uint32_t e, uint32_t k)
{
    const engine_t *g = ENGINES[eng_idx(e)];
    return g->presets && k < g->npresets && g->presets[k].name ? g->presets[k].name : "";
}

/* ------------------------------------------------------------ a stem --- */
/* In an instance of its own (booted with the same state and tempo, headless; nothing else runs in it): one part's
 * shares (tt_cap's layout, copied into tutti_bus_in) and the master's of each block (tutti_blk_in) through this
 * instance's buses (fx.c fx_run: its own chorus, delay and reverb, fed by this part's sends only, a block behind as in
 * the mix), its SLICER (the mix's step state each block, slicer.c slicer_bus: its own recording of this part, so a
 * STUT repeats this part), its DJ FILTER, CLIP's gain on the mix at that sample, the master's level, DC blocker and
 * LOW CUT as master_out has them, then the mix's leveler, limiter and soft clip gains of that sample (the mix's, not its
 * own: the stems sit in the mix as it was levelled and clipped, and add up to it); not BASS+ or the FX layer (README) */
static int32_t tt_bus[TT_MAXB][TT_NCAP][CTL];
static tutti_blk_t tt_bin[TT_MAXB];
static float tt_sl[TT_MAXB * CTL], tt_sr[TT_MAXB * CTL];
EXPORT int32_t *tutti_bus_in(void) { return &tt_bus[0][0][0]; }
EXPORT tutti_blk_t *tutti_blk_in(void) { return tt_bin; }
EXPORT float *tutti_stem_l(void) { return tt_sl; }
EXPORT float *tutti_stem_r(void) { return tt_sr; }
static void tt_sl_load(const sl_t *from)              /* the mix's step state; the recording's half pair stays ours */
{
    int32_t hl = sl.hl, hr = sl.hr;
    sl = *from;
    sl.hl = hl;
    sl.hr = hr;
}
static void tt_slicer(const tutti_blk_t *k, uint32_t n)   /* (fx.c mix_block's SLICER step, slicer.c slicer_bus) */
{
    uint32_t i = 0, j;
    int act;
    tt_sl_load(&k->sl0);
    act = slicer_on();
    if (slicer_fx())                                  /* FX ON: the returns through it */
        for (j = 0; j < n; j++) {
            sl_l[j] += wet[j];
            sl_r[j] += wet[j];
            wet[j] = 0;
        }
    while (i < n) {
        uint32_t m;
        if (sl.pos >= sl.len) {
            if (!(k->flags & TT_SLE))
                break;                                /* (cannot happen: the mix's step began here) */
            tt_sl_load(&k->sl1);
        }
        m = sl.len - sl.pos;
        if (m > n - i)
            m = n - i;
        if (act)
            sl_seg(&sl, sl_l + i, sl_r + i, m);
        sl.pos += m;
        i += m;
    }
    if (slicer_on())
        for (j = 0; j < n; j++) {
            mix_l[j] += sl_l[j];
            mix_r[j] += sl_r[j];
        }
}

/* the soft clip (dsp.c softclip): its gain on the mix at that sample; near 0 the table's first step (its slope) */
static int32_t tt_softclip(int32_t x, int32_t in, int32_t out)
{
    if (in > 255 || in < -255)
        return (int32_t)((int64_t)x * out / in);
    return x < 0 ? -((-x * TANH_Q15[1]) >> 8) : (x * TANH_Q15[1]) >> 8;
}
/* CLIP (fx.c clip_block, master_begin): its gain on the mix at that sample, from its curve at the mix's value, without
 * clip_block's steps of 16 on its way in and of 4 on its way out (a part's stem keeps its own detail; a mix of one part
 * differs from its stem by those steps only), dry and wet in one */
static int32_t tt_clip_gain(int32_t x, int32_t in, int32_t g, int32_t mk)
{
    int64_t a = in < 0 ? -(int64_t)in : in, a16, y;
    uint32_t i, f;
    if (a < 16)
        a = 16;                                       /* (near 0: its slope there) */
    a16 = (a * g) >> 10;                              /* (clip_block's softclip input, 16 x finer) */
    i = (uint32_t)(a16 >> 12);
    f = (uint32_t)(a16 & 4095);
    y = i >= 256u ? TANH_Q15[256] : TANH_Q15[i] + (((int64_t)(TANH_Q15[i + 1u] - TANH_Q15[i]) * f) >> 12);
    return (int32_t)((int64_t)x * y * mk * 4 / ((int64_t)32768 * a));
}
static void tt_clip(const tutti_blk_t *k, uint32_t n)
{
    uint32_t c, i;
    for (c = 0; c < 2u; c++) {
        int32_t *x = c ? mix_r : mix_l;
        for (i = 0; i < n; i++)
            x[i] = tt_clip_gain(x[i] + wet[i], k->cin[c][i], k->clip_g, k->clip_mk);
    }
    for (i = 0; i < n; i++)
        wet[i] = 0;
}
EXPORT void tutti_stem_render(uint32_t nblocks)
{
    uint32_t b, i;
    if (nblocks > TT_MAXB)
        nblocks = TT_MAXB;
    for (b = 0; b < nblocks; b++) {
        int32_t (*s)[CTL] = tt_bus[b];
        const tutti_blk_t *k = &tt_bin[b];
        if (k->flags & TT_REST) {                     /* (the mix silent, nothing run: as mix_block) */
            for (i = 0; i < CTL; i++) {
                fxq_c[i] = fxq_d[i] = fxq_r[i] = 0;
                tt_sl[b * CTL + i] = tt_sr[b * CTL + i] = 0.0f;
            }
            continue;
        }
        memcpy(song.g, k->g, sizeof song.g);
        memcpy((void *)gfx_off, k->gfx, sizeof k->gfx);
        fx_run(CTL);                                  /* (the block before's sends) */
        fx_bad = 0;
        for (i = 0; i < CTL; i++) {
            wet[i] = fx_wet[i];
            mix_l[i] = s[TT_L][i] + fx_sl[i];
            mix_r[i] = s[TT_R][i] + fx_sr[i];
            sl_l[i] = s[TT_SL][i];
            sl_r[i] = s[TT_SR][i];
            fxq_c[i] = s[TT_C][i];
            fxq_d[i] = s[TT_D][i];
            fxq_r[i] = s[TT_V][i];
        }
        tt_slicer(k, CTL);
        if (song.g[G_DJF] || djf.mode)
            djf_block(CTL);
        if (k->flags & TT_CLIP)
            tt_clip(k, CTL);
        for (i = 0; i < CTL; i++) {
            int32_t l = (((mix_l[i] + wet[i]) >> 2) * (int32_t)k->mg) >> 10;
            int32_t r = (((mix_r[i] + wet[i]) >> 2) * (int32_t)k->mg) >> 10;
            l = dc_block(l, &dc_l, &dce_l);
            r = dc_block(r, &dc_r, &dce_r);
            if (fx_lowcut) {
                uint32_t sh = fx_lowcut == 2u ? 5u : 6u;
                l = lowcut1(lowcut1(l, &lc_l1, &lce[0], sh), &lc_l2, &lce[1], sh);
                r = lowcut1(lowcut1(r, &lc_r1, &lce[2], sh), &lc_r2, &lce[3], sh);
            }
            l = (clamp(l, -262143, 262143) * (k->lev[i] >> 4)) >> 11;
            r = (clamp(r, -262143, 262143) * (k->lev[i] >> 4)) >> 11;
            if (k->lim[i] < 32768) {
                l = ((l >> 4) * k->lim[i]) >> 11;
                r = ((r >> 4) * k->lim[i]) >> 11;
            }
            l = tt_softclip(l, k->sc[0][i], k->so[0][i]);
            r = tt_softclip(r, k->sc[1][i], k->so[1][i]);
            tt_sl[b * CTL + i] = (float)(l * (1 << OUT_SHIFT)) / 8388608.0f;
            tt_sr[b * CTL + i] = (float)(r * (1 << OUT_SHIFT)) / 8388608.0f;
        }
    }
}

/* ------------------------------------------------------- the live page --- */
/* the transport for the page's preview of the host's (listen-only): stopped, or playing from `frames` after the
 * start: the sequencer started and run on that far without sound (events_block: its steps, automation, a song's rows,
 * the main loop's staging of the next section every few blocks, as playing them would), then what it started let go
 * (faded over a block), so the music goes on from there. tutti_seek only starts it; tutti_seek_run runs it a bounded
 * number of blocks per call (the worklet: per render quantum, silent until it is done), so a seek minutes into a song
 * never stalls the audio thread */
static uint32_t tt_seek, tt_seeking;               /* blocks still to run; a seek is on */
EXPORT void tutti_seek(uint32_t play, uint32_t frames)
{
    if (song.playing || chain.armed) {
        seq_stop();
        song_poll();                                  /* (a song stopped: the music before it back, as the main loop
                                                       * would, before a song starts again and keeps the music now) */
    }
    transport_req = 0;
    tt_seek = tt_seeking = 0;
    if (!play)
        return;
    song.rec = 0;
    if (!(live.mode && !chain_prepare()))
        transport_req = 1;
    if (transport_req == 1u) {                        /* (chain_prepare's or ours: started at once, not by a block) */
        transport_req = 0;
        seq_start();
    }
    tt_seek = frames / CTL;
    tt_seeking = 1;
}
/* at most `max` blocks of the seek, `more` blocks added to it first (the time that went by meanwhile) -> the blocks still
 * to run; 0: it is done (what it started let go now), or there is none */
EXPORT uint32_t tutti_seek_run(uint32_t max, uint32_t more)
{
    uint32_t i, k;
    if (!tt_seeking)
        return 0;
    tt_seek += more;
    for (; tt_seek && max; tt_seek--, max--) {
        events_block(CTL);
        if (!(tt_seek & 15u))
            song_poll();                              /* (the main loop's: a song's next section staged) */
    }
    if (tt_seek)
        return tt_seek;
    tt_seeking = 0;
    for (i = 0; i < NTRK; i++)
        for (k = 0; k < NVOICE; k++)
            if (trk[i].v[k].active)
                voice_kill(&trk[i].v[k]);
    return 0;
}

/* for the tests (web/plugin/plugin_test.mjs): track t's pattern emptied (the heavy song, web_test_heavy, without it) */
EXPORT void tutti_test_clear(uint32_t t)
{
    memset(trk[t % NTRK].step, 0, sizeof trk[0].step);
    ui.force = 1;
}
/* .. track t's ARP MODE (0 OFF, 1 UP, ..) and ARP 2's HOLD (0 / 1) set (each < 0: left as it is); -> mode | hold << 8 */
EXPORT uint32_t tutti_test_arp(uint32_t t, int32_t mode, int32_t hold)
{
    track_t *k = &trk[t % NTRK];
    if (mode >= 0)
        k->p[P_AMODE] = (int16_t)mode;
    if (hold >= 0)
        k->p[P_AHOLD] = (int16_t)(hold != 0);
    return (uint32_t)k->p[P_AMODE] | (uint32_t)k->p[P_AHOLD] << 8;
}
/* .. the arp's held notes and keys down on track t (seq.c arp_add: nheld | arp_phys << 8), its sounding note << 16 */
EXPORT uint32_t tutti_test_held(uint32_t t)
{
    const track_t *k = &trk[t % NTRK];
    return (uint32_t)k->nheld | (uint32_t)(k->arp_phys & 0xFFu) << 8 | (uint32_t)k->arp_note << 16;
}
/* .. MENU > TRACKS 6 (all six tracks play; the setting, written with the next snapshot) */
EXPORT void tutti_test_six(void)
{
    ui_rec_prefs = (uint8_t)(ui_rec_prefs | PREF_SIX >> 8);
    persist_pending = 1;
    rp_apply();
}
/* .. a global's index in song.g (tutti_song_g): 0 BPM, 1 CLIP, 2 DJF, 3 SLMODE, 4 SLPAT, 5 SLRATE, 6 SLDEP, 7 SLT1, 8 SLFX */
EXPORT uint32_t tutti_test_gid(uint32_t k)
{
    static const uint8_t ID[9] = {G_BPM, G_CLIP, G_DJF, G_SLMODE, G_SLPAT, G_SLRATE, G_SLDEP, G_SLT1, G_SLFX};
    return ID[k % 9u];
}
/* .. the song's chain: samples into its bar at the last block's end (song_play.c chain_tick), running, its row */
EXPORT uint32_t tutti_chain_bar_pos(void) { return chain.bar_pos; }
EXPORT uint32_t tutti_chain_running(void) { return chain.running; }
EXPORT uint32_t tutti_chain_row(void) { return chain.row; }
/* .. the selected track's sound stored as user preset k (SAVE's store, upreset.c up_store): 0 = done */
EXPORT uint32_t tutti_test_store_preset(uint32_t k) { return (uint32_t)up_store(k % UP_SLOTS, "TUTTI"); }
