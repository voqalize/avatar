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

import { useState } from "react";
import { Button, Slider } from "@pipecat-ai/voice-ui-kit";
import type { VoiceOption } from "./corpus";
import {
  AVATAR_NAMES,
  DEFAULT_LOOK,
  GAINS,
  hasConfigurableHand,
  type AvatarName,
  type Look,
} from "./look";

const pct = (gain: number) => `${Math.round(gain * 100)}%`;

const round = (gain: number) => Number(gain.toFixed(2));

const side = (look: Look) => (look.hand ? (look.handSide === 1 ? "hand right" : "hand left") : "no hand");

/** What `npm install` you run before any of the code below compiles. */
const INSTALL = "npm install @voqalize/avatar";

/** And the other half, which is a different package manager on a different machine. */
const INSTALL_PY = "pip install voqalize-avatar";

/**
 * The backend half, which is one import and one seat in the pipeline.
 *
 * Zero-argument on purpose: `AvatarProcessor()` infers everything it announces
 * from ordinary pipecat frames, so there is no configuration here to get wrong
 * and no second copy of the call's state to keep in step.
 */
const PIPELINE = `from voqalize_avatar import AvatarProcessor

pipeline = Pipeline([..., tts, AvatarProcessor(), transport.output()])`;

/**
 * How each drawing reads, and therefore which voice belongs with it.
 *
 * **Studio's own opinion, and nothing in the package backs it.** `META` is a
 * viewBox and a mouth crop; a face carries no gender and should not, because
 * that would be the library holding a view about a TTS it deliberately has none
 * of. These are the characters the faces were authored as — the headers of
 * `src/face-*.js` say male, female, female — copied by hand, because Studio
 * imports `@voqalize/avatar` and never `src/`.
 *
 * It used to buy one quiet sentence after the fact. It is now the *default*:
 * picking a face between calls picks the voice with it (`App.tsx`), because the
 * pairing was right almost every time and the person who has to act on a hint
 * is the one least placed to judge it — CLAUDE.md ranks a voice/face mismatch
 * above every animation defect, so the page should not open on one. Applying it
 * is still not preventing it: override the voice afterwards and the sentence
 * comes back, which is what makes hearing a mismatch a thing you can come here
 * for.
 */
export const READS: Record<AvatarName, string> = {
  peep: "male",
  wren: "female",
  myna: "female",
  "interviewer-male": "male",
  "interviewer-female": "female",
  "professional-male-a": "male",
  "professional-female-a": "female",
  "professional-male-b": "male",
  "professional-female-b": "female",
};

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
  if (look.mouthGain !== 1) opts.push(`mouthGain: ${round(look.mouthGain)}`);
  if (look.gestureGain !== 1) opts.push(`gestureGain: ${round(look.gestureGain)}`);
  if (look.motionGain !== 1) opts.push(`motionGain: ${round(look.motionGain)}`);
  if (hasConfigurableHand(look.avatar)) {
    if (!look.hand) opts.push("hand: false");
    else if (look.handSide === -1) opts.push("handSide: -1");
  }

  const isInterviewer = look.avatar.startsWith("interviewer-");
  const imports = [isInterviewer
    ? `import { createAvatar } from "@voqalize/avatar/avatars/${look.avatar}";`
    : `import { createAvatar } from "@voqalize/avatar";`];
  if (!isInterviewer && look.avatar !== "peep") {
    opts.unshift(`face: ${look.avatar}`);
    imports.push(`import { ${look.avatar} } from "@voqalize/avatar/faces/${look.avatar}";`);
  }
  const call = opts.length
    ? `createAvatar({\n  mount,\n  client,\n${opts.map((o) => `  ${o},`).join("\n")}\n});`
    : `createAvatar({ mount, client });`;
  return `${imports.join("\n")}\n\n${call}`;
}

/**
 * Copy, and then say so.
 *
 * The confirmation is the whole feature: a clipboard write is silent, and a
 * button that gives no sign is one you press twice. `navigator.clipboard` needs
 * a secure context, which `127.0.0.1` is — but a failure still has to show,
 * because "nothing happened" and "it copied" would otherwise look identical.
 */
function Copy({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  return (
    <Button
      size="sm"
      variant="outline"
      className="copy"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setSaid("Copied"))
          .catch((err: unknown) => {
            console.error("[studio] clipboard write failed", err);
            setSaid("Copy failed");
          })
          .finally(() => setTimeout(() => setSaid(""), 1400));
      }}
    >
      {said || "Copy"}
    </Button>
  );
}

/** A shell line above a code block — what you run before the code compiles. */
function Install({ cmd }: { cmd: string }) {
  return (
    <p className="install">
      <span aria-hidden="true">$</span> <code>{cmd}</code>
    </p>
  );
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
          {look.avatar} · {voice}
        </b>
        <span>
          mouth {pct(look.mouthGain)} · gestures {pct(look.gestureGain)} · idle {pct(look.motionGain)} ·{" "}
          {side(look)}
        </span>
      </p>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Show code
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

  // Studio's own reading of the drawing against the voice on the wire — see
  // READS. Silent until the server's vocabulary has arrived and until the two
  // actually differ, and picking a face between calls moves the voice with it —
  // so a difference is never something Studio just did. It is either a voice
  // chosen deliberately against the face, or a face changed mid-call, when the
  // voice is fixed for the duration and the line is the explanation.
  const pairs = READS[look.avatar];
  const wanted = voices.find((v) => v.name === pairs);
  const mismatch =
    voice && wanted && voice !== pairs
      ? `${look.avatar} reads ${pairs} — ${wanted.label} is the matching voice.`
      : "";

  return (
    <>
      <section className="band">
        <header className="band-head">
          <h2>Your createAvatar call</h2>
          {onDone && (
            <Button size="sm" variant="outline" onClick={onDone}>
              Hide
            </Button>
          )}
        </header>
        <p className="note">
          This is the whole browser half: one function, a mount, and the{" "}
          <code>PipecatClient</code> you already have. Every control below rewrites the snippet — change
          one and the avatar is destroyed and rebuilt, because the returned handle is{" "}
          <code>{"{ destroy }"}</code> and there are no setters.
        </p>

        {/* The panel's lead element, and the reason the panel exists: the
            settings are not preferences, they are arguments, and you can see
            which ones you have actually spent. The install line is above it
            because a snippet you cannot run is a screenshot. */}
        <div className="code">
          <div className="code-head">
            <Install cmd={INSTALL} />
            <Copy text={`${INSTALL}\n\n${snippet(look)}\n`} />
          </div>
          <pre className="snippet">
            <code>{snippet(look)}</code>
          </pre>
        </div>

        <div className="group">
          <span className="group-label">
            <span>Avatar</span>
            <code>module</code>
          </span>
          <div className="choices">
            {AVATAR_NAMES.map((name) => (
              <Button
                key={name}
                size="sm"
                variant={look.avatar === name ? "active" : "outline"}
                aria-pressed={look.avatar === name}
                onClick={() => set("avatar", name)}
              >
                {name}
              </Button>
            ))}
          </div>
          <p className="why">
            SVG drawings are imported as face values. The professional interviewer identities are
            complete <code>createAvatar</code> modules with their Canvas2D renderer and wardrobe kept private.
          </p>
        </div>

        {GAINS.map(([key, label, why]) => (
          <div className="group" key={key}>
            <div className="group-label">
              <span>{label}</span>
              <code>{key}</code>
              {/* The readout is the way back. A slider you have dragged has no
                  detent at the default, and 100% is both the default and the
                  only value that keeps the option out of the snippet — so the
                  number that tells you where you are is also what puts you
                  back. */}
              <button
                type="button"
                className="readout"
                title="reset to default"
                disabled={look[key] === DEFAULT_LOOK[key]}
                onClick={() => set(key, DEFAULT_LOOK[key])}
              >
                {pct(look[key] as number)}
              </button>
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

        {hasConfigurableHand(look.avatar) && <div className="group">
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
        </div>}
      </section>

      {/* Nothing to press. It is here because the panel above answers "what do
          I write in the browser" completely, and a reader who stopped there
          would ship a face that blinks and never speaks — the messages the
          avatar animates from are put on the wire by a pipecat processor, in
          the other language, in the other repo half. */}
      <section className="band">
        <header className="band-head">
          <h2>Your pipeline</h2>
        </header>
        <p className="note">
          The other half. The face is driven by messages this server sends. Add one processor to your
          pipeline, between the TTS and the output transport — it takes no arguments.
        </p>
        <div className="code">
          <div className="code-head">
            <Install cmd={INSTALL_PY} />
            <Copy text={`${INSTALL_PY}\n\n${PIPELINE}\n`} />
          </div>
          <pre className="snippet">
            <code>{PIPELINE}</code>
          </pre>
        </div>
        <p className="why">
          Without it the avatar still blinks and breathes, but it will not lip-sync and will not change
          state.
        </p>
      </section>

      {/* Set a little further down the rail than the two above it: this band is
          `server/`'s, not `createAvatar`'s, and the extra air is the only thing
          saying so short of a second heading level. */}
      <section className="band band-voice">
        <header className="band-head">
          <h2>Voice</h2>
        </header>
        <p className="note">
          Not a <code>createAvatar</code> argument — this is which voice <code>server/</code> speaks in,
          and it reaches the face only as audio. It is here anyway because the two have to agree: a voice
          that contradicts the face is read as a mistake long before any animation defect is. So it{" "}
          <b>follows the face by default</b> — pick a drawing above and this moves with it. Change it
          yourself to hear what a mismatched pair costs.
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
        {/* One line, only when the pair disagrees. It is a warning and not a
            constraint: hearing the mismatch is a legitimate thing to come here
            for, and this only makes sure you meant it. */}
        {mismatch && <p className="mismatch">{mismatch}</p>}
        <p className="why">
          {live
            ? "Fixed for this call. A TTS opens its context with a voice id, so swapping mid-call would mean one sentence in each — hang up to change it."
            : `Set from the face, and yours to change until you dial. ${voices.find((v) => v.name === voice)?.id ?? ""} — vql-speech's own ids, which is what a production call asks for.`}
        </p>
      </section>
    </>
  );
}
