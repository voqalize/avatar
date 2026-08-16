/**
 * Mode one: what the avatar is made of.
 *
 * These are the whole of `createAvatar`'s options past `mount` and `client`,
 * and they are grouped here — before the call — because that is when they are
 * yours to decide. Nothing forbids changing one mid-call; the panel just steps
 * out of the way once there is a call to watch, because the questions stop
 * being "which face" and start being "what is the server doing".
 *
 * Every control is the value itself, not a name for it: three face buttons
 * rather than a dropdown, a percentage rather than `1.00`, and a sentence under
 * each slider saying what turning it costs. The three gains used to be three
 * unlabelled tracks reading `1.00` and the honest verdict on them was that
 * nobody could tell what any of them did.
 *
 * The gains are clamped 0..2 by `createAvatar` itself, which throws a
 * `RangeError` at construction — so the sliders carry the same range rather
 * than a wider one that would make Studio a way to discover an exception.
 */

import { Button, Slider } from "@pipecat-ai/voice-ui-kit";
import { FACE_NAMES, GAINS, type Look } from "./look";

const pct = (gain: number) => `${Math.round(gain * 100)}%`;

const side = (look: Look) => (look.hand ? (look.handSide === 1 ? "hand right" : "hand left") : "no hand");

/** The one-line standing of the build, for when the call has the floor. */
export function BuildSummary({ look, compare, onOpen }: { look: Look; compare: boolean; onOpen: () => void }) {
  return (
    <div className="summary">
      <p>
        <b>{compare ? "all three faces" : look.face}</b>
        <span>
          mouth {pct(look.mouthGain)} · gestures {pct(look.gestureGain)} · idle {pct(look.motionGain)} ·{" "}
          {side(look)}
        </span>
      </p>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Change
      </Button>
    </div>
  );
}

export function Build({
  look,
  compare,
  onLook,
  onCompare,
  onDone,
}: {
  look: Look;
  compare: boolean;
  onLook: (next: Look) => void;
  onCompare: (next: boolean) => void;
  /** Present only while a call is up: the way back to the drive controls. */
  onDone?: () => void;
}) {
  const set = <K extends keyof Look>(key: K, value: Look[K]) => onLook({ ...look, [key]: value });

  return (
    <section className="band">
      <header className="band-head">
        <h2>Build the avatar</h2>
        {onDone && (
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        )}
      </header>
      <p className="note">
        The arguments to <code>createAvatar</code>. Changing any of them destroys the avatar and builds a
        new one — the published surface is <code>{"{ destroy }"}</code> and has no setters. The call is
        untouched; the client outlives every avatar mounted on it.
      </p>

      <div className="group">
        <span className="group-label">Face</span>
        <div className="choices">
          {FACE_NAMES.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={!compare && look.face === name ? "active" : "outline"}
              aria-pressed={!compare && look.face === name}
              onClick={() => {
                onCompare(false);
                set("face", name);
              }}
            >
              {name}
            </Button>
          ))}
          <Button
            size="sm"
            variant={compare ? "active" : "outline"}
            aria-pressed={compare}
            onClick={() => onCompare(!compare)}
          >
            all three
          </Button>
        </div>
        <p className="why">
          {compare
            ? "Three avatars on one client. They are separate drawings rather than renderings of one, so a fix that reads on peep often means nothing on myna — this is the only way to judge them on identical input."
            : "peep is the rig the library is authored against; wren and myna are confirmed on, not chased for parity."}
        </p>
      </div>

      {GAINS.map(([key, label, why]) => (
        <div className="group" key={key}>
          <div className="group-label">
            <span>{label}</span>
            <b>{pct(look[key] as number)}</b>
          </div>
          <Slider
            aria-label={label}
            min={0}
            max={2}
            step={0.05}
            value={[look[key] as number]}
            onValueChange={([value]) => set(key, value as never)}
          />
          <p className="why">{why}</p>
        </div>
      ))}

      <div className="group">
        <span className="group-label">Hand</span>
        <div className="choices">
          <Button
            size="sm"
            variant={look.hand ? "active" : "outline"}
            aria-pressed={look.hand}
            onClick={() => set("hand", !look.hand)}
          >
            {look.hand ? "shown" : "hidden"}
          </Button>
          <Button size="sm" variant="outline" disabled={!look.hand} onClick={() => set("handSide", look.handSide === 1 ? -1 : 1)}>
            {look.handSide === 1 ? "viewer's right" : "viewer's left"}
          </Button>
        </div>
        <p className="why">
          One drawing waved in from the frame edge. There is no arm behind it and no forearm chain — a
          channel only one avatar can render is the shape of the mistake.
        </p>
      </div>
    </section>
  );
}
