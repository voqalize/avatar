/**
 * When the bot's audio actually begins, heard on the track the browser plays.
 *
 * `BotStartedSpeaking` and the audio reach the browser by different roads —
 * the event on the data channel, the sound over RTP and through a jitter
 * buffer — so the event is a statement about *which* audio is starting and
 * not about when anyone hears it. Measured on two stacks, the event arrived
 * 57 ms after the first sample on one and 160 ms before it on the other: the
 * mouth lagged the voice on the first and ran ahead of it on the second, and
 * no constant corrects both. So the turn clock is anchored to the sound.
 *
 * What makes "the sound began" observable is that between turns the decoded
 * track is exact digital zero — Opus decodes silence to silence — so onset is
 * the first sample off zero, not a speech detector's guess at a threshold. That
 * matters: cue `t: 0` is the first sample the TTS produced, lead-in included,
 * and a detector keyed to *speech* would anchor 20-50 ms into the lead-in.
 *
 * No output-device latency is added. The mouth reaches the viewer through a
 * compositor and a display that are late by about as much as the speaker is,
 * and when they do not cancel, a mouth early by a frame is the forgiving side:
 * sound leading picture is noticed at ~45 ms, picture leading sound at ~125 ms.
 */

export interface PlayoutProbe {
  /**
   * Where the bot's current sound began, on the caller's `now()` clock.
   * `null`: the track is silent right now. `undefined`: this probe cannot say —
   * the track has been sounding for longer than it can look back, or the
   * audio graph is not running.
   */
  onset(): number | null | undefined;
  dispose(): void;
}

/** 8192 samples is 170 ms at 48 kHz: past the 57 ms the sound has been seen to
 * lead the event by, with room for a slower network. */
const WINDOW = 8192;
/** -80 dBFS. The gaps between turns are exact zero; this only keeps a
 * denormal from reading as speech. */
const FLOOR = 1e-4;

export function createPlayoutProbe(track: MediaStreamTrack, now: () => number): PlayoutProbe | null {
  const Ctx = globalThis.AudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    ctx = new Ctx();
    source = ctx.createMediaStreamSource(new MediaStream([track]));
    analyser = ctx.createAnalyser();
    analyser.fftSize = WINDOW;
    source.connect(analyser);
  } catch {
    return null;
  }
  // A context made after the user's connect click is allowed to run; one that
  // is not simply answers `undefined`, and the event anchors the turn.
  ctx.resume().catch(() => {});
  const buf = new Float32Array(WINDOW);

  return {
    onset() {
      if (ctx.state !== "running") return undefined;
      analyser.getFloatTimeDomainData(buf);
      const t = now();
      let first = -1;
      for (let i = 0; i < buf.length; i++) {
        if (Math.abs(buf[i]!) > FLOOR) { first = i; break; }
      }
      if (first < 0) return null;
      if (first === 0) return undefined;
      return t - ((buf.length - first) / ctx.sampleRate) * 1000;
    },
    dispose() {
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}
