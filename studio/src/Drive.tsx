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

import { useEffect, useMemo, useState } from "react";
import { Button, Slider } from "@pipecat-ai/voice-ui-kit";
import type { Corpus } from "./corpus";
import { actionGroup, actionTerm, misbehaviourLabel } from "./vocabulary";

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
  const [interjectHint, setInterjectHint] = useState("");
  const [wrongHint, setWrongHint] = useState("");

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
            ["Thinking", think, setThink, "Every turn has some."],
            ["Working", work, setWork, "Only a turn that calls a tool."],
          ] as const
        ).map(([label, beat, setBeat, when]) => (
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
            <b>{beat.on ? `${beat.ms} ms` : "off"}</b>
            <small>{when}</small>
          </div>
        ))}

        {/* The signature control: the two numbers you just set, drawn against a
            nominal utterance. "700 ms" means nothing on its own; a third of the
            bar in front of the speech is the thing being configured. */}
        <div className="turn" aria-hidden="true">
          {ms(think) > 0 && <span className="seg think" style={{ width: `${(ms(think) / total) * 100}%` }}>think</span>}
          {ms(work) > 0 && <span className="seg work" style={{ width: `${(ms(work) / total) * 100}%` }}>work</span>}
          <span className="seg speak" style={{ width: `${(SPEAKING_MS / total) * 100}%` }}>speaks</span>
        </div>
        <p className="why">
          One turn, to scale. Talk to it and watch — turn-taking is voice activity, so it takes its turn
          when you stop. Drag thinking past the library's reply grace and it stops waiting: the claim
          turns to <code>STRAINING</code> and the face leans in to hear you better.
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
            frames, read off the client, nothing on the avatar wire. This pipeline has no aggregator to
            suppress with, so it announces the mute without enforcing it: stay quiet to read the pose.
          </small>
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <h2>Interject</h2>
        </header>
        <p className="note">
          One-shot moves, sent while you are the one talking. The face never invents these — every nod
          and receipt is an explicit instruction, which is why they are buttons and not a setting.
        </p>

        <div className="group">
          <span className="group-label">Acknowledge</span>
          <div className="choices">
            {groups.acknowledge.map((action) => (
              <ActionButton key={action} action={action} live={live} onSend={post} onHover={setInterjectHint} />
            ))}
          </div>
        </div>

        <div className="group">
          <span className="group-label">Gesture</span>
          <div className="choices">
            {groups.gesture.map((action) => (
              <ActionButton key={action} action={action} live={live} onSend={post} onHover={setInterjectHint} />
            ))}
          </div>
        </div>

        {/* One line rather than a caption per button: seven permanent sentences
            would bury the seven buttons they explain. */}
        <p className="watch">{hint(live, interjectHint)}</p>
      </section>

      <section className="band">
        <header className="band-head">
          <h2>Send something wrong</h2>
        </header>
        <p className="note">
          The face is allowed to disobey. Observed playout outranks whatever the server claims, and until
          these existed nothing in the repo tested that — every message this server sent was well-formed
          and sent at the right moment.
        </p>
        <div className="choices">
          {Object.keys(corpus.misbehaviours).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              className="wrong"
              disabled={!live}
              onMouseEnter={() => setWrongHint(corpus.misbehaviours[kind])}
              onFocus={() => setWrongHint(corpus.misbehaviours[kind])}
              onClick={() => void post("/api/misbehave", { kind })}
            >
              {misbehaviourLabel(kind)}
            </Button>
          ))}
        </div>
        {/* The server's own sentence, not a second copy written here. These are
            only worth pressing if you know what the face is supposed to do
            about it, and the answer lives with the thing being sent. */}
        <p className="watch">{hint(live, wrongHint)}</p>
      </section>
    </>
  );
}

const hint = (live: boolean, watching: string) =>
  live
    ? watching || "Point at any of them to read what to watch for."
    : "Connect first — these act on the call in progress, and answer 409 without one.";

function ActionButton({
  action,
  live,
  onSend,
  onHover,
}: {
  action: string;
  live: boolean;
  onSend: (path: string, body: unknown) => Promise<void>;
  onHover: (why: string) => void;
}) {
  const term = actionTerm(action);
  return (
    <Button
      size="sm"
      variant="outline"
      title={action}
      disabled={!live}
      onMouseEnter={() => onHover(term.why)}
      onFocus={() => onHover(term.why)}
      onClick={() => void onSend("/api/action", { action })}
    >
      {term.label}
    </Button>
  );
}
