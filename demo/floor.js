/**
 * Floor management — who has the conversational turn, and how the agent shows it.
 *
 * This is the part of the demo that is *not* about lipsync. Lipsync makes the agent
 * look like it is saying the words; this makes it look like it is in a
 * conversation. It is a stand-in for server logic: everything here would be
 * decided by the endpointer, the dialogue manager and the TTS clock, and would
 * reach the client as the same state/clip tokens it emits locally. Every
 * decision this file makes is announced through `emit`, so the demo can show
 * the token stream a real server would be sending.
 *
 * The behaviour, in the order it matters:
 *
 * 1. **The user speaks while the agent is speaking → the agent yields, immediately.**
 *    Not "finishes the sentence". The mouth closes inside ~50ms, the torso
 *    settles back, and the state goes to YIELDED. Barging in on a person who
 *    keeps talking is the single most alienating thing a voice agent does.
 *
 * 2. **The user stops → about half the time, a nod and a short ack.** Half,
 *    not every time: a listener who acknowledges every pause is not listening,
 *    they are a metronome. The other half of the time the agent just keeps looking
 *    at them, which is also an answer.
 *
 * 3. **Silence holds for a second → the agent claims the floor, visibly, before any
 *    audio.** CLAIM_FLOOR is an inbreath: shoulders up, lips part, brows lift,
 *    lean forward. It fires LEAD_MS ahead of the first sample so the user
 *    can see the turn changing hands and stop competing for it. This is the
 *    thing that a text transcript cannot do and a talking head can.
 */

/** How far ahead of the audio the claim gesture starts. */
const LEAD_MS = 350;
/** How long silence has to hold before the agent treats the turn as handed over. */
const HANDOVER_MS = 1000;
/** Fraction of user pauses that get an acknowledgement. */
const ACK_RATE = 0.5;

// Backchannels, in rising order of commitment. The silent ones are the rig's
// own clips; the voiced ones are real TTS with cue tracks, so an ack that
// happens to land can still be lipsynced properly.
const SILENT_ACKS = ['MM_HMM', 'I_SEE', 'NOD_SMALL', 'NOD_SLOW', 'NOD_UP'];
const VOICED_ACKS = ['pf_00', 'pf_02', 'pf_01', 'pf_03'];

const pick = (a) => a[(Math.random() * a.length) | 0];

export class Floor {
  /**
   * @param {object} o
   * @param {object} o.avatar the rig
   * @param {Array} o.clips  perf-clips.json
   * @param {(token: {kind: string, text: string, note?: string}) => void} o.emit
   */
  constructor(o) {
    this.k = o.avatar;
    this.clips = new Map(o.clips.map((c) => [c.id, c]));
    this.emit = o.emit || (() => {});
    this.track = 'sphinx';
    this.audio = new Map();
    for (const c of o.clips) {
      const a = new Audio(new URL(c.audio, import.meta.url).href);
      a.preload = 'auto';
      this.audio.set(c.id, a);
    }
    // Turns the agent takes, in order, looping. A real dialogue manager picks these;
    // the demo only needs them to be plausible and varied.
    this.queue = ['pf_20', 'pf_50', 'pf_21', 'pf_10', 'pf_51', 'pf_31',
                  'pf_11', 'pf_41', 'pf_52', 'pf_30', 'pf_12', 'pf_40'];
    this.qi = 0;
    this.enabled = true;
    this.userSpeaking = false;
    this._handover = 0;
    this._lead = 0;
    this._cur = null;
    this._perf = null;
  }

  // --- inputs from the VAD --------------------------------------------------

  userStart() {
    if (!this.enabled) return;
    this.userSpeaking = true;
    // The rig's listening engine gets the same signal the floor logic gets, so
    // its contingent backchannels key off real pauses instead of a timer.
    this.k.setUserSpeaking?.(true);
    clearTimeout(this._handover);
    clearTimeout(this._lead);

    if (this.k.speaking) {
      this.emit({ kind: 'interrupt', text: 'user barge-in', note: 'while SPEAKING' });
      this._yield();
    } else {
      this.emit({ kind: 'vad', text: 'speech start' });
      this._state('LISTENING');
    }
  }

  /** @param {'end'|'misfire'} reason */
  userEnd(reason) {
    if (!this.enabled) return;
    this.userSpeaking = false;
    this.k.setUserSpeaking?.(false);
    // A misfire is a cough, not a turn. Acking it or claiming the floor on it
    // is worse than doing nothing, because both are confident and both are wrong.
    if (reason === 'misfire') {
      this.emit({ kind: 'vad', text: 'misfire', note: 'ignored' });
      return;
    }
    this.emit({ kind: 'vad', text: 'speech end' });

    if (Math.random() < ACK_RATE) this._ack();
    else this.emit({ kind: 'skip', text: 'no ack', note: `${Math.round((1 - ACK_RATE) * 100)}% of pauses` });

    // Wall-clock is correct here, unlike a cue track: there is no audio playing
    // to clock against, and what is being measured is real-world silence.
    clearTimeout(this._handover);
    this._handover = setTimeout(() => this._claim(), HANDOVER_MS);
  }

  // --- the agent's side ----------------------------------------------------------

  /** Fire a short acknowledgement — the "I'm still with you" beat. */
  _ack() {
    if (Math.random() < 0.45) {
      const id = pick(VOICED_ACKS);
      this.emit({ kind: 'ack', text: this.clips.get(id).text, note: 'voiced' });
      this._play(id, { ack: true });
    } else {
      const id = pick(SILENT_ACKS);
      this.emit({ kind: 'ack', text: id, note: 'gesture only' });
      this.k.interject(id);
    }
  }

  /** Silence held. Show the intent to speak, then speak. */
  _claim() {
    if (this.userSpeaking || !this.enabled) return;
    this.emit({ kind: 'floor', text: 'WANTS_IN', note: `${HANDOVER_MS}ms silence` });
    this._state('WANTS_IN');
    this.k.interject('CLAIM_FLOOR');
    // The gesture leads the audio. Perceptual tolerance here is asymmetric:
    // a body that moves slightly early reads as someone drawing breath, and a
    // body that moves late reads as a dubbing error.
    this._lead = setTimeout(() => this.takeTurn(), LEAD_MS);
  }

  /** The agent takes the floor and speaks the next queued turn. */
  takeTurn() {
    if (!this.enabled) return;
    const id = this.queue[this.qi++ % this.queue.length];
    this.emit({ kind: 'speak', text: this.clips.get(id).text });
    this._state('TAKING_FLOOR');
    this._play(id);
  }

  /** Give the floor up mid-sentence. */
  _yield() {
    this._stopAudio();
    this.k.stopSpeaking();
    this.k.interject('YIELD_FLOOR');
    this._state('YIELDED');
    this.emit({ kind: 'floor', text: 'YIELDED' });
    // A beat of visibly-having-stopped before settling into listening. Cutting
    // straight to LISTENING makes the yield look like a dropped frame.
    setTimeout(() => {
      if (!this.userSpeaking || !this.enabled) return;
      this._state('LISTENING');
    }, 450);
  }

  // --- playback -------------------------------------------------------------

  _play(id, o = {}) {
    const c = this.clips.get(id);
    const a = this.audio.get(id);
    this._stopAudio();
    this._cur = { c, a };
    a.currentTime = 0;
    this.k.speak({ cues: c.tracks[this.track], audio: a });
    // The turn's choreography rides the same audio element the cues do — one
    // clock, so a gesture can never drift out of its own sentence.
    this._perf = this.k.perform(c.beats || [], {
      audio: a,
      onAction: (b) => this.emit({ kind: 'beat', text: `${b.do}: ${b.name || b.id}`, note: `${b.t}ms` }),
    });
    a.onended = () => {
      if (this._cur && this._cur.a !== a) return;
      this.k.stopSpeaking();
      this._cur = null;
      // An ack is not a turn — it lands inside the user’s pause and hands
      // straight back, and the handover timer it interrupted is still running,
      // so if the silence holds the agent will claim the floor anyway. A real turn
      // ends on WAITING_FOR_USER instead: the same eyes with an open,
      // expectant brow, which is what says "your turn" without a word.
      this._state(o.ack ? 'LISTENING' : 'WAITING_FOR_USER');
    };
  }

  _stopAudio() {
    if (this._perf) { this._perf.stop(); this._perf = null; }
    if (!this._cur) return;
    this._cur.a.onended = null;
    this._cur.a.pause();
    this._cur.a.currentTime = 0;
    this._cur = null;
  }

  _state(name) {
    this.k.setState(name, { keepGaze: name === 'TAKING_FLOOR' });
    this.emit({ kind: 'state', text: name });
  }

  setEnabled(on) {
    this.enabled = on;
    clearTimeout(this._handover);
    clearTimeout(this._lead);
    if (!on) { this._stopAudio(); this.k.stopSpeaking(); this._state('IDLE'); }
    else this._state('LISTENING');
  }

  destroy() {
    clearTimeout(this._handover);
    clearTimeout(this._lead);
    this._stopAudio();
  }
}
