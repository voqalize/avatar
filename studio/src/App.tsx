/**
 * Avatar Studio — one screen, two modes, and the mode is the call.
 *
 * Studio imports `@voqalize/avatar` and nothing else from this repo. Not
 * `src/avatar.js`, not `client/src/AvatarClient.ts`, not
 * `@voqalize/avatar/internal` — the published entry point, the three published
 * faces, and the wire format as documented. That is the point of it: if a thing
 * cannot be done here, a consumer cannot do it either, and the gap is a defect
 * in the package rather than a reason to reach past it.
 *
 * It used to be two routes — one for the face, one for the wire — and the honest
 * verdict on them was that the difference was not apparent from either. It
 * wasn't: they were the same call, and what changed between them was which
 * panel was on the right. So the panel changes on its own now, at the moment
 * that makes it true.
 *
 *   disconnected  → build the avatar. The whole option surface of
 *                   `createAvatar`, which is what you get to decide, and the
 *                   only time it is the interesting question.
 *   in a call     → drive the server. Options collapse to a line you can
 *                   reopen; what takes their place is what the *server* can do
 *                   to the face, because that is now the thing in motion.
 *
 * The wire log spans both, because it is the evidence for both. Everything else
 * moves; the log stays exactly where it was.
 */

import { useState } from "react";
import { PipecatClientAudio, PipecatClientProvider, usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { ConnectButton } from "@pipecat-ai/voice-ui-kit";
import { useCall, type Call } from "./call";
import { DEFAULT_LOOK, type Look } from "./look";
import { Build, BuildSummary } from "./Build";
import { Drive } from "./Drive";
import { Stage } from "./Stage";
import { Transcript } from "./Transcript";
import { WireLog } from "./WireLog";

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
  const [compare, setCompare] = useState(false);
  const [building, setBuilding] = useState(false);

  // `ready` and not `connected`: the peer connection being up is not the same
  // as the bot being ready to be driven, and every control endpoint answers 409
  // until it is.
  const live = transport === "ready";

  return (
    <div className="studio">
      <header className="bar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <strong>Avatar Studio</strong>
            <span>@voqalize/avatar, on a real pipecat call</span>
          </div>
        </div>
        <div className="dial">
          <span className={`status ${live ? "live" : transport}`}>{transport}</span>
          <ConnectButton
            size="xl"
            onConnect={() => void call.connect()}
            onDisconnect={() => void call.hangUp()}
          />
        </div>
      </header>

      {call.detail && <p className="banner">{call.detail}</p>}

      <main className="layout">
        <div className="floor">
          <Stage client={call.client} look={look} compare={compare} />
          {live ? (
            <Transcript />
          ) : (
            <p className="invite">
              Build it, then start the call and talk to it. Turn-taking is voice activity — it answers when
              you stop — so this needs a microphone. It runs against <code>server/</code>, which needs no
              credential: <code>cd py && uv run --group server python ../server/server.py</code>.
            </p>
          )}
        </div>

        <aside className="rail">
          {live && !building ? (
            <>
              <BuildSummary look={look} compare={compare} onOpen={() => setBuilding(true)} />
              <Drive live={live} onProblem={call.problem} />
            </>
          ) : (
            <Build
              look={look}
              compare={compare}
              onLook={setLook}
              onCompare={setCompare}
              onDone={live ? () => setBuilding(false) : undefined}
            />
          )}
          <WireLog log={call.log} onClear={call.clearLog} />
        </aside>
      </main>
    </div>
  );
}
