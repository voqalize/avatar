/**
 * Microphone voice-activity detection for the call demo.
 *
 * This is *harness* code, not rig code. In production the server owns turn
 * detection — it has the ASR endpointer, the TTS clock and the dialogue state,
 * and it is the only place that can decide what the agent does. The demo needs a
 * local stand-in so the floor behaviour can be seen without a server, and this
 * is it.
 *
 * Two implementations behind one interface:
 *
 *   silero  ricky0123/vad-web, a small neural VAD. Accurate, and it ignores
 *           keyboard clatter and room noise the way a real endpointer must.
 *           Loaded from a CDN, so it can simply fail to arrive.
 *   rms     A dozen lines of WebAudio with hysteresis. Always available, and
 *           good enough that a demo never has a dead mic — but it will trigger
 *           on a cough or a closing door.
 *
 * The project has no build step and no dependencies, so silero is attempted and
 * rms is the floor. `kind` says which one is live; the UI shows it, because a
 * reviewer watching false triggers deserves to know they are watching the
 * fallback rather than the design.
 */

// Pinned versions. vad-web is coupled to a specific onnxruntime-web — it is not
// a peer dependency you can float, and a mismatch fails at model-load time with
// an error that looks like a network problem.
const CDN = [
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort.js',
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.22/dist/bundle.min.js',
];

const loadScript = (src) => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = res;
  s.onerror = () => rej(new Error(`failed to load ${src}`));
  document.head.append(s);
});

/**
 * @param {object} o
 * @param {MediaStream} o.stream
 * @param {() => void} o.onSpeechStart
 * @param {(reason: 'end'|'misfire') => void} o.onSpeechEnd
 * @param {(db: number) => void} [o.onLevel] smoothed input level, for a meter
 * @returns {Promise<{kind: string, start(): void, pause(): void, destroy(): void}>}
 */
export async function createVAD(o) {
  try {
    return await silero(o);
  } catch (e) {
    console.warn('[vad] silero unavailable, falling back to rms:', e.message);
    return rms(o);
  }
}

async function silero(o) {
  for (const src of CDN) await loadScript(src);
  if (!window.vad) throw new Error('vad global missing after load');

  // Level metering is not part of vad-web's API, so the meter runs off a
  // parallel analyser on the same stream. It is display only — nothing in the
  // floor logic reads it.
  const meter = levelMeter(o.stream, o.onLevel);

  const mic = await window.vad.MicVAD.new({
    stream: o.stream,
    onSpeechStart: () => o.onSpeechStart(),
    onSpeechEnd: () => o.onSpeechEnd('end'),
    // A misfire is speech that started and stopped inside the pre-roll window —
    // a cough, a chair. It must NOT count as a turn end, or the agent claims the
    // floor every time the user clears their throat.
    onVADMisfire: () => o.onSpeechEnd('misfire'),
  });

  return {
    kind: 'silero',
    start: () => mic.start(),
    pause: () => mic.pause(),
    destroy: () => { mic.destroy(); meter.destroy(); },
  };
}

function rms(o) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  ctx.createMediaStreamSource(o.stream).connect(node);
  const buf = new Float32Array(node.fftSize);

  // Asymmetric hysteresis, and the asymmetry is the whole design. Onset is
  // cheap to be wrong about — a false start just means the agent stops talking for
  // a moment, which is what a person does. Offset is expensive: declaring the
  // turn over 200ms early cuts the user off mid-sentence, which is the one
  // failure everybody notices. So: quick in, slow out.
  const ON = 0.030, OFF = 0.018;
  const HOLD_ON = 100, HOLD_OFF = 420;

  let speaking = false, since = 0, raf = 0, running = false;

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    node.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const level = Math.sqrt(sum / buf.length);
    if (o.onLevel) o.onLevel(level);

    const now = performance.now();
    const wants = level > (speaking ? OFF : ON);
    if (wants === speaking) { since = now; return; }
    if (now - since < (speaking ? HOLD_OFF : HOLD_ON)) return;
    since = now;
    speaking = wants;
    if (speaking) o.onSpeechStart(); else o.onSpeechEnd('end');
  }

  return {
    kind: 'rms',
    start() { running = true; ctx.resume(); since = performance.now(); tick(); },
    pause() { running = false; cancelAnimationFrame(raf); if (speaking) { speaking = false; o.onSpeechEnd('end'); } },
    destroy() { this.pause(); ctx.close(); },
  };
}

/** A display-only level meter; smoothed hard, because a raw RMS bar is noise. */
function levelMeter(stream, onLevel) {
  if (!onLevel) return { destroy() {} };
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(node);
  const buf = new Float32Array(node.fftSize);
  let raf = 0, smooth = 0;
  (function tick() {
    raf = requestAnimationFrame(tick);
    node.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    smooth += (Math.sqrt(sum / buf.length) - smooth) * 0.25;
    onLevel(smooth);
  })();
  return { destroy() { cancelAnimationFrame(raf); ctx.close(); } };
}
