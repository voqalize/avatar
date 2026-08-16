/**
 * Avatar Studio — one screen, two modes, and the mode is the call.
 *
 * Studio imports `@voqalize/avatar` and nothing else from this repo. Not
 * `src/avatar.js`, not `client/src/AvatarClient.ts`, not
 * `@voqalize/avatar/internal` — the published entry point, the three published
 * faces, and a real call. That is the point of it: if a thing cannot be done
 * here, a consumer cannot do it either, and the gap is a defect in the package
 * rather than a reason to reach past it.
 *
 * It used to be two routes — one for the face, one for the wire — and the honest
 * verdict on them was that the difference was not apparent from either. It
 * wasn't: they were the same call, and what changed between them was which
 * panel was on the right. So the panel changes on its own now, at the moment
 * that makes it true.
 *
 *   disconnected  → build the avatar, and pick who it sounds like. The whole
 *                   option surface of `createAvatar`, which is what you get to
 *                   decide, and the only time it is the interesting question.
 *   in a call     → drive the server. Options collapse to a line you can
 *                   reopen; what takes their place is what the *server* can do
 *                   to the face, because that is now the thing in motion.
 *
 * The header carries the orientation, because a developer landing here cold has
 * two questions — what is this, and what do I do — and neither is answered by a
 * screen of controls.
 */

import { useState, type CSSProperties } from "react";
import { PipecatClientAudio, PipecatClientProvider, usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { useCall, type Call } from "./call";
import { useCorpus } from "./corpus";
import { DEFAULT_LOOK, type Look } from "./look";
import { Build, BuildSummary } from "./Build";
import { Drive } from "./Drive";
import { DEFAULT_SIZE, Stage, type Size } from "./Stage";

/** Where the package, the source and the architecture note live. */
export const LINKS = {
  npm: "https://www.npmjs.com/package/@voqalize/avatar",
  github: "https://github.com/voqalize/avatar",
  docs: "https://github.com/voqalize/avatar/blob/main/docs/architecture.md",
} as const;

export function App() {
  const call = useCall();
  return (
    // Everything below reads the connection from one place: the transport, via
    // the provider. Studio holds no `connected` boolean of its own, so the
    // button, the mode and the disabled controls cannot disagree about whether
    // there is a call.
    <PipecatClientProvider client={call.client}>
      <Studio call={call} />
      {/* The bot's voice arrives as a track on the transport. The avatar is
          mute by itself and lipsyncs to whatever this is playing. */}
      <PipecatClientAudio />
    </PipecatClientProvider>
  );
}

function Studio({ call }: { call: Call }) {
  const transport = usePipecatClientTransportState();
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  // The frame width lives up here rather than in `Stage`, because the avatar
  // column is a grid track: a 400 px drawing has to widen the track it sits in,
  // and a custom property only travels downward.
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const [building, setBuilding] = useState(false);
  const { corpus, chooseVoice } = useCorpus(call.problem);

  // `ready` and not `connected`: the peer connection being up is not the same
  // as the bot being ready to be driven, and every control endpoint answers 409
  // until it is.
  const live = transport === "ready";

  const voices = corpus?.voices ?? [];
  const voice = corpus?.voice ?? "";
  const voiceLabel = voices.find((v) => v.name === voice)?.label ?? voice;

  return (
    <div className="studio">
      <Header live={live} />

      {call.detail && <p className="banner">{call.detail}</p>}

      <main className="layout" style={{ "--frame": `${size}px` } as CSSProperties}>
        <div className="floor">
          <Stage
            client={call.client}
            look={look}
            live={live}
            transport={transport}
            size={size}
            onSize={setSize}
            unreachable={call.unreachable}
            onConnect={() => void call.connect()}
            onHangUp={() => void call.hangUp()}
          />
        </div>

        <aside className="rail">
          {live && !building ? (
            <>
              <BuildSummary look={look} voice={voiceLabel} onOpen={() => setBuilding(true)} />
              <Drive live={live} corpus={corpus} onProblem={call.problem} />
            </>
          ) : (
            <Build
              look={look}
              onLook={setLook}
              voices={voices}
              voice={voice}
              onVoice={(name) => void chooseVoice(name)}
              live={live}
              onDone={live ? () => setBuilding(false) : undefined}
            />
          )}
        </aside>
      </main>
    </div>
  );
}

/**
 * What this is, and what to do with it.
 *
 * The three steps are numbered because they genuinely are a sequence — you
 * cannot drive a call you have not dialled — and the current one is marked, so
 * the header doubles as the answer to "where am I". It is the only place on the
 * page that explains the page.
 */
function Header({ live }: { live: boolean }) {
  const step = live ? 3 : 1;
  return (
    <header className="bar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div>
          <strong>Avatar Studio</strong>
          <span>
            <a className="chip" href={LINKS.npm} target="_blank" rel="noreferrer">
              <code>@voqalize/avatar</code>
            </a>{" "}
            — a 2-D talking head that animates itself from a pipecat call. This is the published package
            on a real one.
          </span>
        </div>
      </div>
      <ol className="steps">
        {(
          [
            ["Build", "Pick the face and the voice. These are arguments to createAvatar; the snippet on the right is your call."],
            ["Connect", "Dial the local pipecat server and talk. Turn-taking is voice activity — it answers when you stop — so this needs a microphone. No credential, no API key."],
            ["Drive", "Make the server claim a state, send a gesture, or send something wrong. The face never invents any of it."],
          ] as const
        ).map(([label, why], i) => (
          <li key={label} className={i + 1 === step ? "now" : i + 1 < step ? "done" : ""}>
            <b>{i + 1}</b>
            <div>
              <strong>{label}</strong>
              <span>{why}</span>
            </div>
          </li>
        ))}
      </ol>
      {/* Quiet, and at the end of the bar: a developer who wants the source or
          the docs should not have to guess the org, but the page is about the
          face and these are not what to look at. */}
      <nav className="links" aria-label="Project links">
        <a href={LINKS.github} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span aria-hidden="true">·</span>
        <a href={LINKS.docs} target="_blank" rel="noreferrer">
          Docs
        </a>
        <span aria-hidden="true">·</span>
        <a href={LINKS.npm} target="_blank" rel="noreferrer">
          npm
        </a>
      </nav>
    </header>
  );
}
