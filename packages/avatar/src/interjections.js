/**
 * Interjection library.
 *
 * These are the highest-value animations in the whole widget: they're the
 * real-time feedback channel, and they fire on a single server token with zero
 * generation latency because the phrase set is fixed and everything is
 * pre-baked.
 *
 * Each entry carries three things:
 *   · a gesture timeline (additive deltas, normalized time 0..1)
 *   · a baked viseme track with real millisecond timings, tuned so the clip
 *     plays convincingly even with no audio at all (muted / degraded mode)
 *   · an `audio` slot for you to drop in a TTS clip in the agent's own voice
 *
 * If you supply audio, the mouth track re-schedules against the audio clock
 * automatically; the timings below are calibrated to a natural, slightly brisk
 * delivery, so a matching clip should line up with only small nudges.
 *
 * Timeline channel names are rig parameters. Values are deltas added on top of
 * whatever the base pose, gaze and viseme layers are already doing.
 */

/** @typedef {{id:string,label:string,text:string,duration:number,keys:object,mouthCues?:Array,gaze?:string,blinkAt?:number[],audio?:string}} Clip */

const nod = (peak, at = 0.24, rebound = 0.56) => [
  [0, 0], [at, peak], [rebound, -peak * 0.24], [1, 0],
];

// This is the authoring library. It intentionally contains exploratory clips
// as well as production ones; only the small `ACTIONS` export below is
// part of the public action contract.
const CLIPS = {
  // ---------------------------------------------------------------------
  // Wordless acknowledgement clips. Every one is an explicit backend or
  // application decision; the client never fires them from VAD or a timer.
  // ---------------------------------------------------------------------
  // The nod peaks below are pre-compensated for the head's 160ms time constant.
  // Authored at their perceptual value (~0.3) they rendered at ~0.6x and read as
  // no gesture at all — the smoothing that gives the head its mass also eats any
  // gesture faster than it. Judge these on screen, never as numbers: 0.55 here is
  // the same *rendered* nod that ~0.35 would be if the head had no inertia.
  //
  // The three nods are the mocap taxonomy (docs/research-biomechanics.md §3.3):
  // short continuer / long assessment / long-with-upswing realization, in the
  // corpus proportions 49/40/12. Their internal structure follows §3.4's three
  // laws — a long nod STARTS bigger (the head knows how long the nod will be
  // before it begins), each cycle is smaller than the last, and the final cycle
  // drops further than the trend — and everything stays under the 1.5 Hz line
  // where sustained attention turns into impatience.
  NOD_SMALL: {
    id: 'NOD_SMALL', label: 'nod (continuer)', text: '', duration: 900,
    keys: {
      // One readable stroke, not an ambient bob. The peak is deliberately
      // authored above its desired rendered travel because the common head
      // smoothing absorbs a fast impulse before it reaches the SVG.
      headPitch: [[0, 0], [0.25, 0.74], [0.38, 0.70], [0.68, -0.12], [1, 0]],
      browRaiseL: [[0, 0], [0.34, 0.16], [1, 0]],
      browRaiseR: [[0, 0], [0.34, 0.16], [1, 0]],
    },
  },
  NOD_SLOW: {
    id: 'NOD_SLOW', label: 'nod (assessment / receipt)', text: '', duration: 1200,
    keys: {
      // A receipt needs an arrival. The former two fast peaks registered as
      // idle bobbing at call-tile size, so this is one deep downstroke with a
      // short dwell and a slower recovery. The tiny torso commitment keeps the
      // head from looking like it is sliding independently of the body.
      headPitch: [[0, 0], [0.18, 0.18], [0.39, 1.06], [0.52, 1.02], [0.78, -0.16], [1, 0]],
      torsoLean: [[0, 0], [0.40, 0.09], [0.58, 0.07], [1, 0]],
      browRaiseL: [[0, 0], [0.23, 0.12], [0.62, 0.08], [1, 0]],
      browRaiseR: [[0, 0], [0.23, 0.10], [0.62, 0.07], [1, 0]],
    },
  },
  // The "ah — I see" nod. What separates it from agreement is the upswing:
  // the head rises FIRST (the realization arriving), then commits to the
  // deep beat. Brows and lids lift with the upswing and decay through the
  // rest — the face catches on a half-beat before the head does.
  NOD_UP: {
    id: 'NOD_UP', label: 'nod (realization, upswing)', text: '', duration: 1750,
    keys: {
      headPitch: [[0, 0], [0.13, -0.34], [0.34, 0.70], [0.52, -0.08], [0.68, 0.44], [1, 0]],
      browRaiseL: [[0, 0], [0.10, 0.42], [0.45, 0.18], [1, 0]],
      browRaiseR: [[0, 0], [0.11, 0.38], [0.45, 0.16], [1, 0]],
      lidL: [[0, 0], [0.12, -0.10], [0.5, 0], [1, 0]],
      lidR: [[0, 0], [0.12, -0.10], [0.5, 0], [1, 0]],
      // The settle carries a trace of satisfaction — getting it feels good.
      mouthCornerL: [[0, 0], [0.5, 0.10], [0.85, 0.16], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.10], [0.85, 0.16], [1, 0]],
    },
  },
  BROW_ACK: {
    id: 'BROW_ACK', label: 'brow acknowledge', text: '', duration: 720,
    keys: {
      browRaiseL: [[0, 0], [0.24, 0.30], [0.7, 0.06], [1, 0]],
      browRaiseR: [[0, 0], [0.24, 0.26], [0.7, 0.06], [1, 0]],
      mouthCornerL: [[0, 0], [0.35, 0.14], [1, 0]],
      mouthCornerR: [[0, 0], [0.35, 0.14], [1, 0]],
    },
    blinkAt: [0.22],
  },
  // ---------------------------------------------------------------------
  // Understanding beats — eye/face/body composites, deliberately separate
  // from nods. They are the shared low-authoring-cost alternative when a
  // portrait's pitch geometry is too limited to carry acknowledgement alone.
  // ---------------------------------------------------------------------
  ACK_CONTINUE: {
    id: 'ACK_CONTINUE', label: 'acknowledge: continue', text: '', duration: 620,
    keys: {
      // Eyes acknowledge first; nothing here claims agreement or closes the
      // conversational floor while the user is still talking.
      browRaiseL: [[0, 0], [0.18, 0.14], [0.48, 0.06], [1, 0]],
      browRaiseR: [[0, 0], [0.18, 0.12], [0.48, 0.05], [1, 0]],
      lidL: [[0, 0], [0.20, 0.035], [0.58, 0.01], [1, 0]],
      lidR: [[0, 0], [0.20, 0.035], [0.58, 0.01], [1, 0]],
    },
  },
  ACK_RECEIVE: {
    id: 'ACK_RECEIVE', label: 'acknowledge: received', text: '', duration: 1120,
    keys: {
      // Recognition → take it in → settle. The face does not nod; it lands in
      // a quiet, held receipt, leaving room for the user to see the response.
      browRaiseL: [[0, 0], [0.12, 0.16], [0.34, 0.055], [1, 0]],
      browRaiseR: [[0, 0], [0.12, 0.13], [0.34, 0.045], [1, 0]],
      lidL: [[0, 0], [0.16, 0.15], [0.49, 0.14], [0.82, 0.035], [1, 0]],
      lidR: [[0, 0], [0.16, 0.15], [0.49, 0.14], [0.82, 0.035], [1, 0]],
      mouthPress: [[0, 0], [0.23, 0.20], [0.60, 0.17], [1, 0]],
      mouthCornerL: [[0, 0], [0.34, 0.08], [0.80, 0.055], [1, 0]],
      mouthCornerR: [[0, 0], [0.34, 0.08], [0.80, 0.055], [1, 0]],
      torsoLean: [[0, 0], [0.34, 0.13], [0.70, 0.10], [1, 0]],
      shoulderL: [[0, 0], [0.50, 0.070], [0.76, 0.045], [1, 0]],
      shoulderR: [[0, 0], [0.50, 0.070], [0.76, 0.045], [1, 0]],
    },
  },
  ACK_REALIZE: {
    id: 'ACK_REALIZE', label: 'acknowledge: realization', text: '', duration: 980,
    keys: {
      // The brows and widened lid lead: this means "the point connected", not
      // the generic social smile which looks like agreement in a small tile.
      browRaiseL: [[0, 0], [0.15, 0.36], [0.42, 0.20], [1, 0]],
      browRaiseR: [[0, 0], [0.15, 0.32], [0.42, 0.18], [1, 0]],
      lidL: [[0, 0], [0.16, -0.07], [0.48, -0.025], [1, 0]],
      lidR: [[0, 0], [0.16, -0.07], [0.48, -0.025], [1, 0]],
      mouthCornerL: [[0, 0], [0.35, 0.12], [0.80, 0.09], [1, 0]],
      mouthCornerR: [[0, 0], [0.35, 0.12], [0.80, 0.09], [1, 0]],
      torsoLean: [[0, 0], [0.38, 0.07], [0.72, 0.05], [1, 0]],
    },
  },
  ACK_EMPATHIZE: {
    id: 'ACK_EMPATHIZE', label: 'acknowledge: empathy', text: '', duration: 1180,
    keys: {
      // Inner brows and softened lids acknowledge the affect without signalling
      // agreement. Keep the mouth nearly neutral for professional contexts.
      browInnerL: [[0, 0], [0.22, 0.24], [0.68, 0.16], [1, 0]],
      browInnerR: [[0, 0], [0.22, 0.20], [0.68, 0.13], [1, 0]],
      browRaiseL: [[0, 0], [0.22, 0.07], [0.68, 0.05], [1, 0]],
      browRaiseR: [[0, 0], [0.22, 0.06], [0.68, 0.04], [1, 0]],
      lidL: [[0, 0], [0.25, 0.06], [0.72, 0.04], [1, 0]],
      lidR: [[0, 0], [0.25, 0.06], [0.72, 0.04], [1, 0]],
      mouthPress: [[0, 0], [0.34, 0.06], [0.72, 0.045], [1, 0]],
      torsoLean: [[0, 0], [0.40, 0.065], [0.76, 0.045], [1, 0]],
    },
  },
  // A comparison nod, not the director's default. Two quick decaying strokes
  // with a barely-there listening tilt reflect the common conversational form
  // the current single deep receipt does not show. It stays comparison-only:
  // the host can decide whether this faster cadence fits its conversation.
  ACK_NOD: {
    id: 'ACK_NOD', label: 'acknowledge: nod', text: '', duration: 1120,
    keys: {
      // Values are intentionally a little theatrical at close range: at a
      // video-call tile the head's 160 ms smoothing otherwise eats the second
      // beat and the slight listening tilt entirely.
      headPitch: [[0, 0], [0.12, -0.15], [0.30, 0.98], [0.46, -0.13], [0.64, 0.68], [0.82, -0.09], [1, 0]],
      headRoll: [[0, 0], [0.18, -0.090], [0.68, -0.070], [1, 0]],
      torsoLean: [[0, 0], [0.31, 0.115], [0.68, 0.075], [1, 0]],
      shoulderL: [[0, 0], [0.43, 0.055], [0.73, 0.032], [1, 0]],
      shoulderR: [[0, 0], [0.43, 0.055], [0.73, 0.032], [1, 0]],
      lidL: [[0, 0], [0.30, 0.065], [0.64, 0.038], [1, 0]],
      lidR: [[0, 0], [0.30, 0.065], [0.64, 0.038], [1, 0]],
    },
  },
  // The disagree family follows the same three laws as explicit nods (§3.4): the
  // first swing is the biggest, every cycle decays, and the whole gesture
  // stays at or under ~1.5 Hz. Both are SERVER-SENT ONLY — an agent must
  // never disagree autonomously, so neither is in the listening engine's
  // picker.
  HEAD_SHAKE: {
    id: 'HEAD_SHAKE', label: 'no (firm)', text: '', duration: 1350,
    keys: {
      // Two decaying cycles at ~1.5 Hz, peaks pre-compensated like the nods
      // (the old ±0.20 rendered as ambient drift, not as "no"). The mouth
      // firms and the brows drop a touch: a "no" with a resting smile under
      // it reads as teasing.
      headYaw: [[0, 0], [0.16, -0.55], [0.42, 0.45], [0.68, -0.26], [0.88, 0.10], [1, 0]],
      mouthPress: [[0, 0], [0.20, 0.35], [0.80, 0.30], [1, 0]],
      mouthCornerL: [[0, 0], [0.25, -0.18], [1, 0]],
      mouthCornerR: [[0, 0], [0.25, -0.18], [1, 0]],
      browRaiseL: [[0, 0], [0.20, -0.20], [0.85, -0.10], [1, 0]],
      browRaiseR: [[0, 0], [0.20, -0.20], [0.85, -0.10], [1, 0]],
    },
  },
  // "Hmm, not quite" — the polite disagreement backchannel. Slower (~1 Hz),
  // smaller, a cycle and a half dying away, with the sympathetic head tilt
  // and knit brows of someone sorry to be disagreeing. The regretful set is
  // what separates not-quite from no.
  HEAD_SHAKE_SOFT: {
    id: 'HEAD_SHAKE_SOFT', label: 'not quite (soft)', text: '', duration: 1700,
    keys: {
      // At tile size the amplitude difference from HEAD_SHAKE is thin; what
      // actually separates not-quite from no here is the sympathetic head
      // TILT (line-face scaled — under 0.3 the roll never survives the 5.5°
      // multiplier's floor), the slower swing, and the sorry face.
      headYaw: [[0, 0], [0.22, -0.26], [0.55, 0.18], [0.82, -0.09], [1, 0]],
      headRoll: [[0, 0], [0.30, 0.50], [0.85, 0.35], [1, 0.06]],
      browInnerL: [[0, 0], [0.30, 0.50], [1, 0.08]],
      browInnerR: [[0, 0], [0.30, 0.42], [1, 0.06]],
      mouthCornerL: [[0, 0], [0.40, -0.24], [1, -0.06]],
      mouthCornerR: [[0, 0], [0.40, -0.24], [1, -0.06]],
      mouthPress: [[0, 0], [0.35, 0.30], [1, 0]],
    },
  },
  /**
   * The deliberate ~600ms blink, paired with a barely-there nod — the studied
   * stimulus (docs/research-biomechanics.md §3.6): listeners who got long
   * blinks with nods gave measurably shorter answers, with no awareness of
   * why. It reads as "that's noted — move on". SERVER-SENT ONLY: nothing
   * autonomous may ever pick it, because it genuinely shortens what the user
   * says next. Distinct from THINKING's 0.34s slow blink by duration alone.
   * The lids close in ~90ms, stay down half a second, and release slower
   * than they fell; the mouth is untouched.
   */
  BLINK_LONG: {
    id: 'BLINK_LONG', label: 'long blink (noted)', text: '', duration: 850,
    keys: {
      lidL: [[0, 0], [0.10, 1.0], [0.68, 1.0], [0.92, 0], [1, 0]],
      lidR: [[0, 0], [0.10, 1.0], [0.68, 1.0], [0.92, 0], [1, 0]],
      headPitch: [[0, 0], [0.30, 0.30], [0.75, -0.05], [1, 0]],
    },
  },

  // ---------------------------------------------------------------------
  // Floor management.
  //
  // These carry no words and no meaning about the conversation — they are pure
  // turn-taking. Their whole job is to be *predictive*: a claim has to land
  // before the audio it predicts, or it is describing the past.
  // ---------------------------------------------------------------------

  /**
   * The inbreath before speaking. Fire this ~350ms ahead of the first audio
   * sample — the server knows it is about to speak long before the samples
   * exist, so the lead time is free.
   *
   * This is the cue that prevents collisions. Everything in it is one gesture
   * seen from outside: the shoulders rise, the chest fills, the head comes up,
   * the lips part. It ends held rather than resolved, because the speech it
   * precedes is what resolves it — the clip's own ramp-out does the blending.
   */
  CLAIM_FLOOR: {
    id: 'CLAIM_FLOOR', label: 'about to speak (inhale)', text: '', duration: 480,
    keys: {
      breath: [[0, 0], [0.45, 0.55], [1, 0.22]],
      shoulderL: [[0, 0], [0.45, 0.36], [1, 0.14]],
      shoulderR: [[0, 0], [0.45, 0.34], [1, 0.13]],
      torsoLean: [[0, 0], [0.5, 0.22], [1, 0.10]],
      browRaiseL: [[0, 0], [0.35, 0.26], [1, 0.10]],
      browRaiseR: [[0, 0], [0.35, 0.22], [1, 0.08]],
      headPitch: [[0, 0], [0.4, -0.18], [1, -0.06]],
      lidL: [[0, 0], [0.4, -0.10], [1, -0.04]],
      lidR: [[0, 0], [0.4, -0.10], [1, -0.04]],
      mouthOpen: [[0, 0], [0.55, 0.20], [1, 0.12]],
    },
  },

  /**
   * Interrupted mid-word. The mouth shutting *is* the message, and it has to be
   * the fastest thing on the face — a yield that takes as long as a nod reads as
   * the agent finishing its sentence anyway, which is the opposite of the meaning.
   * The peak is at 12% of 420ms, so the lips are closed inside 50ms.
   */
  YIELD_FLOOR: {
    id: 'YIELD_FLOOR', label: 'yield (interrupted)', text: '', duration: 420,
    keys: {
      mouthOpen: [[0, 0], [0.12, -0.34], [0.5, -0.14], [1, 0]],
      mouthPress: [[0, 0], [0.14, 0.30], [0.6, 0.12], [1, 0]],
      // Settling back is the second half of it: the body gives the floor up as
      // well as the voice. Without this the face just stops, which reads as a
      // dropped connection rather than as deference.
      torsoLean: [[0, 0], [0.3, -0.24], [1, -0.08]],
      shoulderL: [[0, 0], [0.25, -0.20], [1, -0.06]],
      shoulderR: [[0, 0], [0.25, -0.20], [1, -0.06]],
      browRaiseL: [[0, 0], [0.2, 0.18], [1, 0.04]],
      browRaiseR: [[0, 0], [0.2, 0.15], [1, 0.04]],
      headPitch: [[0, 0], [0.28, 0.10], [1, 0.02]],
    },
    blinkAt: [0.1],
  },

  /** Server-confirmed cut-off after playout stopped. This is not a state: the
   * clip explains the abrupt transition, then lands in whatever factual pose
   * Pipecat has resolved underneath it. */
  RESPONSE_INTERRUPTED: {
    id: 'RESPONSE_INTERRUPTED', label: 'response: interrupted', text: '', duration: 1550,
    keys: {
      mouthOpen: [[0, 0], [0.06, 0.36], [0.80, 0.36], [1, 0]],
      jaw: [[0, 0], [0.08, 0.20], [0.80, 0.20], [1, 0]],
      browRaiseL: [[0, 0], [0.12, 0.46], [0.72, 0.34], [1, 0]],
      browRaiseR: [[0, 0], [0.12, 0.40], [0.72, 0.30], [1, 0]],
      lidL: [[0, 0], [0.12, -0.18], [0.72, -0.12], [1, 0]],
      lidR: [[0, 0], [0.12, -0.16], [0.72, -0.10], [1, 0]],
      torsoLean: [[0, 0], [0.18, -0.16], [0.72, -0.10], [1, 0]],
      shoulderL: [[0, 0], [0.18, -0.12], [0.72, -0.08], [1, 0]],
      shoulderR: [[0, 0], [0.18, -0.12], [0.72, -0.08], [1, 0]],
    },
  },

  /**
   * "May I come in." This used to be a raised palm, and it is now the same
   * signal without one: the body claims a little space and the face asks. The
   * hold is what carries it either way — the signal is the *hold*, and anything
   * that goes up and straight back down reads as a twitch.
   *
   * Distinct from CLAIM_FLOOR by intent rather than by parts. CLAIM_FLOOR is a
   * speaker taking a breath and is followed by audio; this is a listener asking
   * and is followed by waiting. What separates them on screen is the head: this
   * one comes *up* and stays up, holding eye contact, which is a question. The
   * inbreath drops the chin, which is a preparation.
   */
  RAISE_HAND: {
    id: 'RAISE_HAND', label: 'may I come in', text: '', duration: 1600,
    keys: {
      browRaiseL: [[0, 0], [0.2, 0.44], [0.8, 0.38], [1, 0.14]],
      browRaiseR: [[0, 0], [0.2, 0.40], [0.8, 0.34], [1, 0.12]],
      browInnerL: [[0, 0], [0.24, 0.20], [0.8, 0.16], [1, 0]],
      browInnerR: [[0, 0], [0.24, 0.20], [0.8, 0.16], [1, 0]],
      shoulderL: [[0, 0], [0.25, 0.36], [0.8, 0.30], [1, 0.10]],
      shoulderR: [[0, 0], [0.25, 0.32], [0.8, 0.26], [1, 0.08]],
      torsoLean: [[0, 0], [0.3, 0.30], [0.8, 0.24], [1, 0.08]],
      // Chin up and held, not a nod. Held is the whole gesture.
      headPitch: [[0, 0], [0.3, -0.26], [0.85, -0.22], [1, -0.06]],
      lidL: [[0, 0], [0.3, -0.12], [0.85, -0.10], [1, 0]],
      lidR: [[0, 0], [0.3, -0.12], [0.85, -0.10], [1, 0]],
      mouthOpen: [[0, 0], [0.3, 0.18], [0.85, 0.14], [1, 0]],
    },
  },

  // ---------------------------------------------------------------------
  // Gestures that were arm gestures.
  //
  // The rig had a forearm and a hand; they were removed (see the note in
  // params.js). These four kept their IDs, because the ID set is a wire
  // contract the server targets and dropping entries from it is a breaking
  // change for a reason the server has no way to know about. What each one
  // means is unchanged; only the body part saying it moved.
  //
  // Re-authoring a gesture off the face is not the same as deleting a track and
  // keeping the rest. A wave whose arm is gone is not a quieter wave, it is a
  // smile with a stray head-roll on it. Each of these had to be rebuilt around
  // whatever channel could carry the meaning on its own.
  // ---------------------------------------------------------------------

  /**
   * Greeting. What a face does when an arm is not available is the eyebrow
   * flash: a fast, high brow raise held under a fifth of a second, which is a
   * near-universal human greeting display and is *the* recognition signal at
   * conversational distance. It has to be fast — the difference between a
   * greeting and surprise is almost entirely duration — so the peak lands at
   * 11% of 1300ms and is off again by 40%.
   *
   * The smile outlasts the brows by design, and the head tilt outlasts both.
   * That ordering is the gesture: brows recognise, mouth greets, head settles
   * into listening. All three rising and falling together reads as a single
   * twitch instead of a greeting with a shape to it.
   *
   * Shorter than the wave it replaces (1300 vs 2200) because there is no
   * oscillation left to fill the time; a held smile past about a second stops
   * being a greeting and becomes an expression.
   */
  GESTURE_GREET: {
    id: 'GESTURE_GREET', label: 'gesture: greet', text: '', duration: 1300,
    keys: {
      browRaiseL: [[0, 0], [0.11, 0.85], [0.4, 0.22], [0.75, 0.12], [1, 0]],
      browRaiseR: [[0, 0], [0.11, 0.80], [0.4, 0.20], [0.75, 0.10], [1, 0]],
      lidL: [[0, 0], [0.13, -0.20], [0.45, -0.06], [1, 0]],
      lidR: [[0, 0], [0.13, -0.20], [0.45, -0.06], [1, 0]],
      mouthCornerL: [[0, 0], [0.26, 0.62], [0.72, 0.50], [1, 0]],
      mouthCornerR: [[0, 0], [0.26, 0.62], [0.72, 0.50], [1, 0]],
      // The squint is what makes it a real smile rather than a social one, and
      // it lags the corners on purpose: an orbicularis contraction that arrives
      // with the mouth reads as posed, one that arrives just after reads as felt.
      squintL: [[0, 0], [0.34, 0.38], [0.78, 0.32], [1, 0]],
      squintR: [[0, 0], [0.34, 0.38], [0.78, 0.32], [1, 0]],
      // Chin up on the recognition, then a small settle. A greeting head goes
      // up first; only an apology starts by going down.
      headPitch: [[0, 0], [0.16, -0.24], [0.5, 0.06], [1, 0]],
      headRoll: [[0, 0], [0.42, -0.20], [0.85, -0.14], [1, 0]],
    },
    blinkAt: [0.14],
  },

  /**
   * Approval. The thumb is gone, so the nod carries it — and a nod that means
   * "good" is not the nod that means "yes". It is slower, deeper, and the head
   * comes back up to level rather than overshooting, because the rebound is
   * what makes a nod read as assent to a question. Here there is no question.
   *
   * Deep enough to be unmistakable: peak 0.62 against NOD_SMALL's 0.52, over
   * nearly three times the duration.
   */
  GESTURE_APPROVE: {
    id: 'GESTURE_APPROVE', label: 'gesture: approve', text: '', duration: 1500,
    keys: {
      headPitch: [[0, 0], [0.3, 0.62], [0.58, 0.20], [0.78, 0.34], [1, 0]],
      mouthCornerL: [[0, 0], [0.36, 0.58], [0.8, 0.48], [1, 0]],
      mouthCornerR: [[0, 0], [0.36, 0.58], [0.8, 0.48], [1, 0]],
      squintL: [[0, 0], [0.45, 0.40], [0.8, 0.34], [1, 0]],
      squintR: [[0, 0], [0.45, 0.40], [0.8, 0.34], [1, 0]],
      browRaiseL: [[0, 0], [0.24, 0.30], [0.7, 0.10], [1, 0]],
      browRaiseR: [[0, 0], [0.24, 0.28], [0.7, 0.10], [1, 0]],
      // Eyes close a little further than the squint alone would take them. A
      // wholehearted approval is a slightly shut-eyed expression; wide eyes
      // with a big smile is delight, which is a different and stranger thing
      // for an attentive agent to be doing.
      lidL: [[0, 0], [0.4, 0.14], [0.8, 0.10], [1, 0]],
      lidR: [[0, 0], [0.4, 0.14], [0.8, 0.10], [1, 0]],
    },
  },

  /**
   * The shoulders now carry this alone, so they are pushed to the top of their
   * range and held. The old comment here noted that shoulders are legible only
   * in profile and that face-on the hands carried it; that is true of a small
   * shrug and false of a large one. The fix is amplitude plus the face — brows
   * up hard, mouth corners pulled *down* rather than up. Raised shoulders with
   * a neutral mouth is a flinch; it is the inverted mouth that makes the same
   * shoulders mean "I don't know".
   */
  SHRUG: {
    id: 'SHRUG', label: 'shrug', text: '', duration: 1250,
    keys: {
      shoulderL: [[0, 0], [0.26, 1], [0.66, 0.95], [1, 0]],
      shoulderR: [[0, 0], [0.26, 1], [0.66, 0.95], [1, 0]],
      browRaiseL: [[0, 0], [0.24, 0.62], [0.66, 0.56], [1, 0]],
      browRaiseR: [[0, 0], [0.24, 0.60], [0.66, 0.54], [1, 0]],
      browInnerL: [[0, 0], [0.28, 0.24], [0.7, 0.20], [1, 0]],
      browInnerR: [[0, 0], [0.28, 0.24], [0.7, 0.20], [1, 0]],
      headRoll: [[0, 0], [0.3, 0.18], [0.7, 0.14], [1, 0]],
      // The chin tucks with the shoulders — the head sinks a little between
      // them, which is most of what a shrug looks like from the front.
      headPitch: [[0, 0], [0.28, 0.18], [0.7, 0.14], [1, 0]],
      mouthCornerL: [[0, 0], [0.4, -0.30], [0.7, -0.26], [1, 0]],
      mouthCornerR: [[0, 0], [0.4, -0.26], [0.7, -0.22], [1, 0]],
      mouthPress: [[0, 0], [0.4, 0.30], [0.7, 0.26], [1, 0]],
    },
  },

  /**
   * "Keep going" — the emphatic one, as against the routine GO_ON backchannel.
   * The beckon is gone; what is left is the part of "go on" that was never in
   * the arm anyway. Eyes widen, brows go up and *stay* up, and the head tilts
   * and holds. The hold is the message: a face that returns to neutral has
   * stopped waiting, and this clip's whole job is to say the floor is still
   * yours.
   *
   * Two head beats rather than one continuous lift, which is what a listener
   * urging someone on actually does — the second beat is the "and?".
   */
  GO_ON_ARM: {
    id: 'GO_ON_ARM', label: 'go on (emphatic)', text: '', duration: 1400,
    keys: {
      browRaiseL: [[0, 0], [0.18, 0.58], [0.75, 0.44], [1, 0]],
      browRaiseR: [[0, 0], [0.18, 0.55], [0.75, 0.42], [1, 0]],
      lidL: [[0, 0], [0.22, -0.26], [0.8, -0.20], [1, 0]],
      lidR: [[0, 0], [0.22, -0.26], [0.8, -0.20], [1, 0]],
      headPitch: [[0, 0], [0.2, 0.26], [0.42, -0.04], [0.6, 0.20], [1, 0]],
      headRoll: [[0, 0], [0.35, 0.16], [0.8, 0.12], [1, 0]],
      torsoLean: [[0, 0], [0.3, 0.22], [0.8, 0.18], [1, 0]],
      mouthCornerL: [[0, 0], [0.5, 0.26], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.26], [1, 0]],
      mouthOpen: [[0, 0], [0.35, 0.12], [0.8, 0.10], [1, 0]],
    },
  },

  // ---------------------------------------------------------------------
  // Spoken interjections.
  // ---------------------------------------------------------------------
  MM_HMM: {
    id: 'MM_HMM', label: 'mm-hmm', text: 'mm-hmm', duration: 820,
    // Lips stay shut the whole way; the meaning is entirely in the nod.
    mouthCues: [{ t: 0, v: 'A' }, { t: 620, v: 'X' }],
    keys: {
      headPitch: [[0, 0], [0.15, 0.34], [0.33, 0.06], [0.50, 0.28], [0.72, 0.02], [1, 0]],
      mouthCornerL: [[0, 0], [0.4, 0.16], [1, 0]],
      mouthCornerR: [[0, 0], [0.4, 0.16], [1, 0]],
    },
  },
  OKAY: {
    id: 'OKAY', label: 'okay', text: 'okay', duration: 860,
    // oʊ · k · eɪ
    mouthCues: [
      { t: 0, v: 'F' }, { t: 140, v: 'B' }, { t: 235, v: 'C' },
      { t: 350, v: 'B' }, { t: 480, v: 'X' },
    ],
    keys: {
      headPitch: nod(0.42, 0.22, 0.52),
      browRaiseL: [[0, 0], [0.18, 0.16], [0.6, 0], [1, 0]],
      browRaiseR: [[0, 0], [0.18, 0.16], [0.6, 0], [1, 0]],
      mouthCornerL: [[0, 0], [0.55, 0.20], [1, 0]],
      mouthCornerR: [[0, 0], [0.55, 0.20], [1, 0]],
    },
  },
  YES: {
    id: 'YES', label: 'yes', text: 'yes', duration: 740,
    // j · ɛ · s
    mouthCues: [{ t: 0, v: 'B' }, { t: 70, v: 'C' }, { t: 195, v: 'B' }, { t: 330, v: 'X' }],
    keys: {
      headPitch: [[0, 0], [0.15, 0.55], [0.40, -0.14], [0.68, 0.08], [1, 0]],
      browRaiseL: [[0, 0], [0.13, 0.26], [0.5, 0.04], [1, 0]],
      browRaiseR: [[0, 0], [0.13, 0.26], [0.5, 0.04], [1, 0]],
      mouthCornerL: [[0, 0], [0.5, 0.30], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.30], [1, 0]],
    },
  },
  SURE: {
    id: 'SURE', label: 'sure', text: 'sure', duration: 860,
    // ʃ · ʊ · r
    mouthCues: [{ t: 0, v: 'B' }, { t: 85, v: 'F' }, { t: 200, v: 'E' }, { t: 350, v: 'X' }],
    keys: {
      headPitch: nod(0.34, 0.26, 0.6),
      mouthCornerL: [[0, 0], [0.45, 0.42], [1, 0]],
      mouthCornerR: [[0, 0], [0.45, 0.42], [1, 0]],
      squintL: [[0, 0], [0.45, 0.20], [1, 0]],
      squintR: [[0, 0], [0.45, 0.20], [1, 0]],
      browRaiseL: [[0, 0], [0.2, 0.14], [1, 0]],
      browRaiseR: [[0, 0], [0.2, 0.14], [1, 0]],
    },
  },
  I_SEE: {
    id: 'I_SEE', label: 'I see', text: 'I see', duration: 1050,
    // aɪ · s · iː
    mouthCues: [{ t: 0, v: 'D' }, { t: 120, v: 'C' }, { t: 215, v: 'B' }, { t: 450, v: 'X' }],
    keys: {
      headPitch: [[0, 0], [0.28, 0.44], [0.66, 0.02], [1, 0]],
      browRaiseL: [[0, 0], [0.18, 0.32], [0.55, 0.05], [1, 0]],
      browRaiseR: [[0, 0], [0.18, 0.30], [0.55, 0.05], [1, 0]],
    },
    blinkAt: [0.34],
  },
  RIGHT: {
    id: 'RIGHT', label: 'right', text: 'right', duration: 740,
    // r · aɪ · t
    mouthCues: [{ t: 0, v: 'E' }, { t: 75, v: 'D' }, { t: 200, v: 'B' }, { t: 330, v: 'X' }],
    keys: {
      headPitch: nod(0.42, 0.20, 0.5),
      browRaiseL: [[0, 0], [0.16, 0.20], [1, 0]],
      browRaiseR: [[0, 0], [0.16, 0.20], [1, 0]],
    },
  },
  GO_ON: {
    id: 'GO_ON', label: 'go on', text: 'go on', duration: 820,
    // g · oʊ · ɒ · n
    mouthCues: [{ t: 0, v: 'B' }, { t: 80, v: 'E' }, { t: 290, v: 'A' }, { t: 420, v: 'X' }],
    keys: {
      headPitch: nod(0.22, 0.25, 0.6),
      browRaiseL: [[0, 0], [0.2, 0.36], [0.65, 0.14], [1, 0]],
      browRaiseR: [[0, 0], [0.2, 0.36], [0.65, 0.14], [1, 0]],
      // Eyes widen — the "keep talking, I'm with you" signal.
      lidL: [[0, 0], [0.25, -0.14], [0.8, -0.08], [1, 0]],
      lidR: [[0, 0], [0.25, -0.14], [0.8, -0.08], [1, 0]],
      mouthCornerL: [[0, 0], [0.5, 0.18], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.18], [1, 0]],
      // A hint of the lean, deliberately much smaller than GO_ON_ARM. This clip
      // fires as routine backchannel, and a full-sized gesture every time the
      // user pauses is precisely the fidget that makes an avatar read as a
      // gimmick rather than as a listener.
      torsoLean: [[0, 0], [0.25, 0.10], [0.7, 0.08], [1, 0]],
    },
  },
  GESTURE_WAIT: {
    id: 'GESTURE_WAIT', label: 'gesture: wait', text: 'one moment', duration: 1350,
    // w · ʌ · n  ·  m · oʊ · m · ə · n · t
    mouthCues: [
      { t: 0, v: 'F' }, { t: 110, v: 'C' }, { t: 210, v: 'A' }, { t: 320, v: 'F' },
      { t: 420, v: 'C' }, { t: 510, v: 'A' }, { t: 590, v: 'B' }, { t: 730, v: 'X' },
    ],
    // Breaking eye contact is what actually communicates "hold on".
    gaze: 'AWAY_RIGHT',
    keys: {
      headRoll: [[0, 0], [0.3, 0.12], [0.8, 0.09], [1, 0]],
      headYaw: [[0, 0], [0.35, 0.13], [1, 0]],
      browRaiseL: [[0, 0], [0.2, 0.34], [0.7, 0.18], [1, 0]],
      browRaiseR: [[0, 0], [0.2, 0.30], [0.7, 0.16], [1, 0]],
      // This used to be a raised index finger, and that was the one gesture in
      // the set a mime did better than the words: legible muted, at thumbnail
      // size, across a language barrier. Nothing on the face replaces it, so no
      // attempt is made to — what carries the clip now is the gaze break above,
      // which is what actually communicates "hold on" and always was. The face
      // says "wait" by looking away; it never said it with the finger.
    },
    blinkAt: [0.12],
  },
  SORRY: {
    id: 'SORRY', label: 'sorry', text: 'sorry', duration: 1050,
    // s · ɒ · r · i
    mouthCues: [{ t: 0, v: 'B' }, { t: 80, v: 'E' }, { t: 260, v: 'B' }, { t: 420, v: 'X' }],
    keys: {
      // AU1: the inner-brow lift. This single channel is the whole apology.
      browInnerL: [[0, 0], [0.25, 0.62], [0.75, 0.40], [1, 0]],
      browInnerR: [[0, 0], [0.25, 0.62], [0.75, 0.40], [1, 0]],
      browRaiseL: [[0, 0], [0.3, -0.06], [1, 0]],
      browRaiseR: [[0, 0], [0.3, -0.06], [1, 0]],
      headPitch: [[0, 0], [0.32, 0.28], [0.8, 0.14], [1, 0]],
      headRoll: [[0, 0], [0.35, 0.13], [1, 0]],
      mouthCornerL: [[0, 0], [0.4, -0.18], [1, 0]],
      mouthCornerR: [[0, 0], [0.4, -0.18], [1, 0]],
    },
  },
  HMM: {
    id: 'HMM', label: 'hmm', text: 'hmm', duration: 1250,
    mouthCues: [{ t: 0, v: 'A' }, { t: 900, v: 'X' }],
    gaze: 'AWAY_THINKING',
    keys: {
      browRaiseL: [[0, 0], [0.2, -0.24], [0.75, -0.18], [1, 0]],
      browRaiseR: [[0, 0], [0.2, -0.18], [0.75, -0.14], [1, 0]],
      browInnerL: [[0, 0], [0.25, 0.30], [0.8, 0.20], [1, 0]],
      browInnerR: [[0, 0], [0.25, 0.30], [0.8, 0.20], [1, 0]],
      headRoll: [[0, 0], [0.4, 0.10], [1, 0]],
      mouthCornerL: [[0, 0], [0.4, -0.10], [1, 0]],
      mouthCornerR: [[0, 0], [0.4, 0.04], [1, 0]],
    },
  },
  GOT_IT: {
    id: 'GOT_IT', label: 'got it', text: 'got it', duration: 820,
    // g · ɒ · t · ɪ · t
    mouthCues: [{ t: 0, v: 'B' }, { t: 80, v: 'D' }, { t: 210, v: 'B' }, { t: 400, v: 'X' }],
    keys: {
      headPitch: [[0, 0], [0.16, 0.48], [0.44, -0.10], [1, 0]],
      browRaiseL: [[0, 0], [0.15, 0.22], [1, 0]],
      browRaiseR: [[0, 0], [0.15, 0.22], [1, 0]],
      mouthCornerL: [[0, 0], [0.5, 0.24], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.24], [1, 0]],
    },
  },
  TAKE_YOUR_TIME: {
    id: 'TAKE_YOUR_TIME', label: 'take your time', text: 'take your time', duration: 1500,
    mouthCues: [
      { t: 0, v: 'B' }, { t: 90, v: 'C' }, { t: 200, v: 'B' }, { t: 310, v: 'F' },
      { t: 430, v: 'E' }, { t: 560, v: 'A' }, { t: 650, v: 'D' }, { t: 800, v: 'A' },
      { t: 900, v: 'X' },
    ],
    keys: {
      headPitch: [[0, 0], [0.2, 0.22], [0.45, 0.02], [0.62, 0.16], [1, 0]],
      mouthCornerL: [[0, 0], [0.5, 0.40], [1, 0]],
      mouthCornerR: [[0, 0], [0.5, 0.40], [1, 0]],
      squintL: [[0, 0], [0.5, 0.24], [1, 0]],
      squintR: [[0, 0], [0.5, 0.24], [1, 0]],
      browRaiseL: [[0, 0], [0.25, 0.16], [1, 0]],
      browRaiseR: [[0, 0], [0.25, 0.16], [1, 0]],
    },
  },
};

/** Full local authoring library. Not a server action vocabulary. */
export const INTERNAL_CLIPS = CLIPS;

/**
 * Public, server-addressable actions. Naming is `CATEGORY_INTENT`:
 * acknowledgements are `ACK_*`, the special transition is `RESPONSE_*`, and
 * visible hand/body movements are `GESTURE_*`. This is deliberately an intent
 * vocabulary — `ACK_NOD` is one implementation, not a promise about anatomy.
 */
export const ACTION_IDS = Object.freeze([
  'ACK_RECEIVE', 'ACK_NOD',
  'RESPONSE_INTERRUPTED',
  'GESTURE_GREET', 'GESTURE_GOODBYE', 'GESTURE_APPROVE', 'GESTURE_WAIT',
]);

/** Face-capable subset of the action contract. */
export const ACTIONS = Object.freeze({
  ...Object.fromEntries(ACTION_IDS.filter((id) => CLIPS[id]).map((id) => [id, CLIPS[id]])),
  // The goodbye face intentionally reuses the greeting brow-flash while its
  // hand owns the distinct, longer farewell motion. It still needs metadata so
  // a client can enumerate every public action without knowing that detail.
  GESTURE_GOODBYE: {
    ...CLIPS.GESTURE_GREET,
    id: 'GESTURE_GOODBYE', label: 'gesture: goodbye', duration: 1550,
  },
});

/**
 * Attach audio to an internal authoring clip. Production actions are silent
 * sequences; response speech always belongs to Pipecat's audio/viseme track.
 * The baked viseme track is then scheduled against that file's clock instead of
 * the local timer, so any timing drift resolves in the audio's favour.
 */
export function attachAudio(id, url) {
  const clip = CLIPS[id];
  if (!clip) throw new Error(`unknown interjection: ${id}`);
  const el = new Audio(url);
  el.preload = 'auto';
  clip.audioEl = el;
  return el;
}
