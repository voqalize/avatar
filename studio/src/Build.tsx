/**
 * Before the call: the avatar you are about to embed, and who it sounds like.
 *
 * The panel leads with the code because the code is the answer to "why would I
 * care about these controls" — every one of them writes a line of the
 * `createAvatar` call you would paste into your own app, and at the defaults it
 * writes none of them. That is the shape of the library in one screen: one
 * function, a mount, and a client you already have.
 *
 * Two bands, and the split is real rather than cosmetic. The first is
 * `createAvatar`'s own arguments — yours, decided in your code, no server
 * involved. The second is the voice, which is `server/`'s and reaches the face
 * only as audio. Putting them in one list would suggest the library has an
 * opinion about the TTS, and it has none.
 */

import { Button, Slider } from "@pipecat-ai/voice-ui-kit";
import type { VoiceOption } from "./corpus";
import { FACE_NAMES, GAINS, type Look } from "./look";

const pct = (gain: number) => `${Math.round(gain * 100)}%`;

const round = (gain: number) => Number(gain.toFixed(2));

const side = (look: Look) => (look.hand ? (look.handSide === 1 ? "hand right" : "hand left") : "no hand");

/**
 * The call you would write for this build, with the defaults left out.
 *
 * Omitting defaults is the honest rendering and also the argument: a reader who
 * has touched nothing sees `createAvatar({ mount, client })` and knows the
 * options are optional. `peep` needs no import — it is the face this entry point
 * already carries.
 */
function snippet(look: Look): string {
  const opts: string[] = [];
  if (look.face !== "peep") opts.push(`face: ${look.face}`);
  if (look.mouthGain !== 1) opts.push(`mouthGain: ${round(look.mouthGain)}`);
  if (look.gestureGain !== 1) opts.push(`gestureGain: ${round(look.gestureGain)}`);
  if (look.motionGain !== 1) opts.push(`motionGain: ${round(look.motionGain)}`);
  if (!look.hand) opts.push("hand: false");
  else if (look.handSide === -1) opts.push("handSide: -1");

  const imports = [`import { createAvatar } from "@voqalize/avatar";`];
  if (look.face !== "peep") {
    imports.push(`import { ${look.face} } from "@voqalize/avatar/faces/${look.face}";`);
  }
  const call = opts.length
    ? `createAvatar({\n  mount,\n  client,\n${opts.map((o) => `  ${o},`).join("\n")}\n});`
    : `createAvatar({ mount, client });`;
  return `${imports.join("\n")}\n\n${call}`;
}

/** The one-line standing of the build, for when the call has the floor. */
export function BuildSummary({
  look,
  voice,
  onOpen,
}: {
  look: Look;
  voice: string;
  onOpen: () => void;
}) {
  return (
    <div className="summary">
      <p>
        <b>
          {look.face} · {voice}
        </b>
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
  onLook,
  voices,
  voice,
  onVoice,
  live,
  onDone,
}: {
  look: Look;
  onLook: (next: Look) => void;
  voices: VoiceOption[];
  voice: string;
  onVoice: (name: string) => void;
  /** A call is up — the voice is fixed until it ends. */
  live: boolean;
  /** Present only while a call is up: the way back to the drive controls. */
  onDone?: () => void;
}) {
  const set = <K extends keyof Look>(key: K, value: Look[K]) => onLook({ ...look, [key]: value });

  return (
    <>
      <section className="band">
        <header className="band-head">
          <h2>Your createAvatar call</h2>
          {onDone && (
            <Button size="sm" variant="outline" onClick={onDone}>
              Done
            </Button>
          )}
        </header>
        <p className="note">
          This is the whole library: one function, a mount, and the{" "}
          <code>PipecatClient</code> you already have. Every control below rewrites the snippet — change
          one and the avatar is destroyed and rebuilt, because the returned handle is{" "}
          <code>{"{ destroy }"}</code> and there are no setters.
        </p>

        {/* The signature control, and the reason the panel exists: the settings
            are not preferences, they are arguments, and you can see which ones
            you have actually spent. */}
        <pre className="snippet">
          <code>{snippet(look)}</code>
        </pre>

        <div className="group">
          <span className="group-label">
            <span>Face</span>
            <code>face</code>
          </span>
          <div className="choices">
            {FACE_NAMES.map((name) => (
              <Button
                key={name}
                size="sm"
                variant={look.face === name ? "active" : "outline"}
                aria-pressed={look.face === name}
                onClick={() => set("face", name)}
              >
                {name}
              </Button>
            ))}
          </div>
          <p className="why">
            A value, not a name — import the one you want and the other two never enter your bundle.{" "}
            <code>peep</code> is the default and the rig the library is authored against.
          </p>
        </div>

        {GAINS.map(([key, label, why]) => (
          <div className="group" key={key}>
            <div className="group-label">
              <span>{label}</span>
              <code>{key}</code>
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
          <span className="group-label">
            <span>Hand</span>
            <code>hand</code>
          </span>
          <div className="choices">
            <Button
              size="sm"
              variant={look.hand ? "active" : "outline"}
              aria-pressed={look.hand}
              onClick={() => set("hand", !look.hand)}
            >
              {look.hand ? "shown" : "hidden"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!look.hand}
              onClick={() => set("handSide", look.handSide === 1 ? -1 : 1)}
            >
              {look.handSide === 1 ? "viewer's right" : "viewer's left"}
            </Button>
          </div>
          <p className="why">
            One drawing waved in from the frame edge. There is no arm behind it — a channel only one
            avatar can render is the shape of the mistake.
          </p>
        </div>
      </section>

      <section className="band">
        <header className="band-head">
          <h2>Voice</h2>
        </header>
        <p className="note">
          Not a <code>createAvatar</code> argument — this is which voice <code>server/</code> speaks in,
          and it reaches the face only as audio. It is here anyway because the two have to agree: a voice
          that contradicts the face is read as a mistake long before any animation defect is.
        </p>
        <div className="choices">
          {voices.map((option) => (
            <Button
              key={option.name}
              size="sm"
              variant={voice === option.name ? "active" : "outline"}
              aria-pressed={voice === option.name}
              disabled={live}
              title={option.id}
              onClick={() => onVoice(option.name)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="why">
          {live
            ? "Fixed for this call. A TTS opens its context with a voice id, so swapping mid-call would mean one sentence in each — hang up to change it."
            : `Chosen before the call. ${voices.find((v) => v.name === voice)?.id ?? ""} — vql-speech's own ids, which is what a production call asks for.`}
        </p>
      </section>
    </>
  );
}
