/**
 * Mode two: what the server does to the avatar during a call.
 *
 * Every control here is an HTTP request to the *server*, never a message this
 * page composes. The server owns intent: a page that could make the avatar nod
 * on its own would be a client deciding what the agent is doing, which is the
 * one thing this project does not allow. So what lands in the wire log is what
 * the server sent, which is how you tell a move the face ignored from one that
 * never arrived.
 *
 * The vocabularies come from `GET /api/lines` (see `corpus.ts`) rather than from
 * a list here. They live in the Python package, and a button list that had
 * drifted from them would be a UI testing a wire format that no longer exists.
 * `vocabulary.ts` turns their names into words; anything it has no words for
 * still gets a button.
 *
 * There is no button that makes it talk, and that is the point of the beats.
 * Talk to it — turn-taking is VAD, so it takes its turn when you stop — and the
 * three sections below are, in order, what happens before it speaks, what it
 * can do while you speak, and what happens when the server gets it wrong.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider } from "@pipecat-ai/voice-ui-kit";
import type { Corpus } from "./corpus";
import { actionGroup, actionTerm, misbehaviourLabel } from "./vocabulary";

/**
 * What a band's footnote is saying, and about which wire name.
 *
 * The id travels with the sentence because the button does not carry it: the
 * labels are English ("Nod", "One moment") and the thing that actually goes on
 * the wire is `ACK_NOD`. That used to live in a `title` attribute, which is to
 * say nowhere — a developer reading `contract-wire.md` afterwards had no way
 * to know which button they had pressed.
 */
interface Hint {
  id: string;
  why: string;
}

/**
 * How long a pressed control keeps the footnote after the pointer leaves.
 *
 * Long enough to look up at the face, watch the move, and look back down. A
 * hover that lands on a neighbour in the meantime does not steal the line,
 * because what you want to read is what you just *sent*.
 */
const STICKY_MS = 5000;

/** The accent blink on a pressed button. Some sends are subtle on the face. */
const FLASH_MS = 150;

function useHint() {
  const [hint, setHint] = useState<Hint | null>(null);
  const until = useRef(0);

  // Hover and focus, which yield to a recent press.
  const show = useCallback((next: Hint) => {
    if (Date.now() < until.current) return;
    setHint(next);
  }, []);

  // A press, which holds the line whatever the pointer does next.
  const pin = useCallback((next: Hint) => {
    until.current = Date.now() + STICKY_MS;
    setHint(next);
  }, []);

  return { hint, show, pin };
}

/** One pre-speech state: whether the server holds it, and for how long. */
interface Beat {
  on: boolean;
  ms: number;
}

/**
 * What a beat goes back to when you switch it on.
 *
 * A remembered duration has to be non-zero or the toggle does nothing — and
 * `work_ms` ships at `0`, because only a turn that calls a tool has any working
 * in it. So the fallback is a length you can actually see rather than the
 * server's own default.
 */
const FALLBACK_MS = 600;
const MAX_MS = 3000;

/**
 * A nominal utterance, so the timeline has something to be a fraction *of*.
 *
 * The point of the strip is proportion — 700 ms of thinking in front of a
 * couple of seconds of speech is a beat, and the same 700 in front of nothing
 * is the whole turn. Real lines run 1.5–4 s.
 */
const SPEAKING_MS = 2200;

const ms = (beat: Beat) => (beat.on ? beat.ms : 0);

export function Drive({
  live,
  corpus,
  onProblem,
}: {
  live: boolean;
  corpus: Corpus | null;
  onProblem: (text: string) => void;
}) {
  const [think, setThink] = useState<Beat>({ on: true, ms: 700 });
  const [work, setWork] = useState<Beat>({ on: false, ms: FALLBACK_MS });
  // Optimistic, and it has to be: the mute lives in the pipeline, and a call
  // that ended took it with it. Reset on hang-up rather than remembered, so the
  // button never offers to unmute a microphone nobody is holding.
  const [muted, setMuted] = useState(false);
  // One hint line per band rather than one for the panel: the sentence has to
  // sit next to the buttons it describes, or you are reading an explanation of
  // something two sections away.
  const interject = useHint();
  const wrong = useHint();

  // The server's own defaults, once they arrive, so the panel opens agreeing
  // with the call it is about to drive rather than guessing at it.
  useEffect(() => {
    if (!live) setMuted(false);
  }, [live]);

  const beats = corpus?.beats;
  useEffect(() => {
    if (!beats) return;
    setThink({ on: beats.think_ms > 0, ms: beats.think_ms || FALLBACK_MS });
    setWork({ on: beats.work_ms > 0, ms: beats.work_ms || FALLBACK_MS });
  }, [beats]);

  // Arm the call whenever the numbers or the call itself change. A fresh call
  // is a fresh `CannedLLMService` back on its defaults, so connecting has to
  // re-send these or the panel would be describing a turn nobody configured.
  // Debounced because a dragged slider fires per pixel and each frame is a POST.
  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => {
      void fetch("/api/beats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ think_ms: ms(think), work_ms: ms(work) }),
      }).catch(() => onProblem("/api/beats — the call went away"));
    }, 150);
    return () => clearTimeout(timer);
  }, [live, think, work, onProblem]);

  const groups = useMemo(() => {
    const all = corpus?.actions ?? [];
    return {
      acknowledge: all.filter((a) => actionGroup(a) === "acknowledge"),
      gesture: all.filter((a) => actionGroup(a) === "gesture"),
    };
  }, [corpus]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const detail = await res
      .json()
      .then((d: { detail?: string }) => d.detail)
      .catch(() => res.statusText);
    onProblem(`${path} → ${res.status} ${detail}`);
  }

  if (!corpus) {
    return (
      <section className="band">
        <p className="note">
          Waiting for the vocabulary from <code>/api/lines</code>.
        </p>
      </section>
    );
  }

  const total = ms(think) + ms(work) + SPEAKING_MS;

  return (
    <>
      <section className="band">
        <header className="band-head">
          <h2>While nobody is talking</h2>
        </header>
        <p className="note">
          The hard part of the call. A real agent takes a moment to think, longer if it runs a tool,
          and a face that goes blank through it reads as disconnected rather than busy. Switch these
          on and the server takes as long as a real one would — it announces nothing, so what the
          face does in the gap is inferred from the same frames any pipeline emits.
        </p>

        {(
          [
            ["Thinking", think, setThink, "Every turn has some.", corpus.beats.think_ms || FALLBACK_MS],
            ["Working", work, setWork, "Only a turn that calls a tool.", corpus.beats.work_ms || FALLBACK_MS],
          ] as const
        ).map(([label, beat, setBeat, when, fallback]) => (
          <div className="beat" key={label}>
            <Button
              size="sm"
              variant={beat.on ? "active" : "outline"}
              aria-pressed={beat.on}
              disabled={!live}
              onClick={() => setBeat({ ...beat, on: !beat.on })}
            >
              {label}
            </Button>
            <div className="beat-track">
              <Slider
                aria-label={`${label} duration`}
                min={100}
                max={MAX_MS}
                step={100}
                value={[beat.ms]}
                disabled={!live || !beat.on}
                onValueChange={([value]) => setBeat({ ...beat, ms: value })}
              />
            </div>
            {/* The number is also the way back to the server's own default —
                the one this call started on, before you dragged anything. */}
            <button
              type="button"
              className="readout"
              title="reset to default"
              disabled={!live || !beat.on || beat.ms === fallback}
              onClick={() => setBeat({ ...beat, ms: fallback })}
            >
              {beat.on ? `${beat.ms} ms` : "off"}
            </button>
            <small>{when}</small>
          </div>
        ))}

        {/* The band's lead element: the two numbers you just set, drawn against
            a nominal utterance. "700 ms" means nothing on its own; a third of
            the bar in front of the speech is the thing being configured. */}
        <div className="turn" aria-hidden="true">
          {ms(think) > 0 && <span className="seg think" style={{ width: `${(ms(think) / total) * 100}%` }}>think</span>}
          {ms(work) > 0 && <span className="seg work" style={{ width: `${(ms(work) / total) * 100}%` }}>work</span>}
          <span className="seg speak" style={{ width: `${(SPEAKING_MS / total) * 100}%` }}>speaks</span>
        </div>
        <p className="why">
          One turn, to scale. Talk to it and watch — turn-taking is voice activity, so it takes its turn
          when you stop. Drag thinking past the library's reply grace (2 s) and it stops waiting: the
          claim turns to <code>STRAINING</code> and the face leans in to hear you better.
        </p>

        {/* The one control on this page that sends no avatar command. Mute is a
            pipecat fact with its own frames, so the face learns about it from
            the browser client rather than from anything the library says — and
            the way to prove that is to have the server say nothing. */}
        <div className="beat">
          <Button
            size="sm"
            variant={muted ? "active" : "outline"}
            aria-pressed={muted}
            disabled={!live}
            onClick={() => {
              setMuted(!muted);
              void post("/api/mute", { on: !muted });
            }}
          >
            Mute the user
          </Button>
          <small>
            Closes your microphone from the agent's side, the way a mute strategy does — pipecat's own
            frames, nothing on the avatar wire. This demo server announces the mute but doesn't actually
            gate your audio, so stay quiet for a moment to read the pose.
          </small>
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <h2>One-shot actions</h2>
        </header>
        <p className="note">
          One-shot moves, sent while you are the one talking. The face never invents these — every nod
          and receipt is an explicit instruction, which is why they are buttons and not a setting.
        </p>

        <div className="group">
          <span className="group-label">Acknowledge</span>
          <div className="choices">
            {groups.acknowledge.map((action) => (
              <Send
                key={action}
                id={action}
                label={actionTerm(action).label}
                why={actionTerm(action).why}
                live={live}
                onSend={() => post("/api/action", { action })}
                hint={interject}
              />
            ))}
          </div>
        </div>

        <div className="group">
          <span className="group-label">Gesture</span>
          <div className="choices">
            {groups.gesture.map((action) => (
              <Send
                key={action}
                id={action}
                label={actionTerm(action).label}
                why={actionTerm(action).why}
                live={live}
                onSend={() => post("/api/action", { action })}
                hint={interject}
              />
            ))}
          </div>
        </div>

        {/* One line rather than a caption per button: seven permanent sentences
            would bury the seven buttons they explain. It carries the wire name,
            because that is the half of the button that is not on the button. */}
        <Watch live={live} hint={interject.hint} empty="Hover or focus a button to see what to watch for." />
      </section>

      <section className="band">
        <header className="band-head">
          <h2>Send something wrong</h2>
        </header>
        <p className="note">
          The face is allowed to disobey. These deliberately send bad or contradictory messages, so you
          can watch the face refuse them: observed playout outranks whatever the server claims.
        </p>
        <div className="choices">
          {Object.keys(corpus.misbehaviours).map((kind) => (
            <Send
              key={kind}
              id={kind}
              label={misbehaviourLabel(kind)}
              why={corpus.misbehaviours[kind]}
              live={live}
              wrong
              onSend={() => post("/api/misbehave", { kind })}
              hint={wrong}
            />
          ))}
        </div>
        {/* The server's own sentence, not a second copy written here. These are
            only worth pressing if you know what the face is supposed to do
            about it, and the answer lives with the thing being sent. */}
        <Watch live={live} hint={wrong.hint} empty="Hover a button to see what the face is supposed to refuse." />
      </section>
    </>
  );
}

/**
 * The footnote under a band of buttons: the wire name, then the sentence.
 *
 * The empty line is per band, because the two bands are asking for opposite
 * things. Under the interjections, what to watch for is the move. Under the
 * misbehaviours it is the *absence* of one — the same sentence in both places
 * had the second band promising a gesture that is supposed not to arrive.
 */
function Watch({ live, hint, empty }: { live: boolean; hint: Hint | null; empty: string }) {
  if (!live) {
    return <p className="watch">Connect first — these act on the call in progress, and answer 409 without one.</p>;
  }
  if (!hint) {
    return <p className="watch">{empty}</p>;
  }
  return (
    <p className="watch">
      <code>{hint.id}</code> — {hint.why}
    </p>
  );
}

/**
 * A button that puts one message on the wire, and admits it.
 *
 * Three things it does that a plain button does not, all of them about the same
 * problem: the face's answer is often too small or too quick to serve as
 * feedback. The wire name goes into the footnote on hover and on focus; the
 * press holds that footnote for a few seconds so it survives looking away; and
 * the button itself blinks, which is the only confirmation that does not depend
 * on the drawing having done something visible.
 */
function Send({
  id,
  label,
  why,
  live,
  wrong,
  onSend,
  hint,
}: {
  /** The wire name — `ACK_NOD`, `claim-during-speech`. Shown, not hidden in a title. */
  id: string;
  label: string;
  why: string;
  live: boolean;
  wrong?: boolean;
  onSend: () => Promise<void>;
  hint: { show: (h: Hint) => void; pin: (h: Hint) => void };
}) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <Button
      size="sm"
      variant="outline"
      className={`${wrong ? "wrong" : ""}${flash ? " sent" : ""}`}
      disabled={!live}
      onMouseEnter={() => hint.show({ id, why })}
      onFocus={() => hint.show({ id, why })}
      onClick={() => {
        hint.pin({ id, why });
        setFlash(true);
        void onSend();
      }}
    >
      {label}
    </Button>
  );
}
