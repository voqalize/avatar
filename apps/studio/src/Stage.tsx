/**
 * The avatar and the four things you need next to it.
 *
 *     createAvatar({ mount, client, ...look })
 *
 * The frame is small on purpose. 130 px is the size this rig is calibrated at
 * (CLAUDE.md § In flight — production calibration retires the reference image as
 * the yardstick), so this is the avatar at the size a consumer will actually
 * embed it, not a poster of it. A face that only reads at 400 px is a face that
 * does not work, and showing it big hides that. Every identity owns the same
 * 4:3 webcam camera, so the host never needs renderer-specific dimensions. The
 * size control under the status line can enlarge it for inspection and defaults back
 * to nothing — 130 is what opens, always, so the first read of the face is the
 * shipping read.
 *
 * Under the frame, in the order you need them: what the avatar is doing, what it
 * is saying, the button that starts the call, and your own microphone. That is
 * the whole player, and it is one column because the reading order is the order
 * a first call happens in.
 *
 * The two voice meters are the kit's, not ours, and they measure the *audio*
 * rather than the animation: the bot's sits on the frame, so you can see the
 * mouth and the waveform disagree if lipsync is drifting, and yours is inside
 * the mic control, so "is it hearing me" and "which mic" are one control instead
 * of a meter next to a picker that might be about a different device.
 */

import { useEffect, useRef } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { ConnectButton, UserAudioControl, VoiceVisualizer } from "@pipecat-ai/voice-ui-kit";
import { Captions } from "./Captions";
import { SERVER_URL } from "./call";
import { createLookAvatar, type Look } from "./look";
import { usePresence, type Presence } from "./presence";

/**
 * The three widths, and why the first one is the default.
 *
 * 130 px is the size the rig is calibrated at and the size a consumer embeds —
 * CLAUDE.md § In flight. It stays the default deliberately: a page that opened
 * at 400 would be advertising a face nobody ships, and a defect that only
 * shows at tile size is exactly the defect this page exists to catch. The
 * other two are inspection, for when you have found something and want to see
 * what it is.
 */
export const SIZES = [130, 240, 400] as const;
export type Size = (typeof SIZES)[number];
export const DEFAULT_SIZE: Size = 130;

export function Stage({
  client,
  look,
  live,
  transport,
  size,
  onSize,
  unreachable,
  onConnect,
  onHangUp,
}: {
  client: PipecatClient;
  look: Look;
  live: boolean;
  transport: string;
  size: Size;
  onSize: (size: Size) => void;
  /** Raw text from the last failed dial, "" if it carried none, `null` if none. */
  unreachable: string | null;
  onConnect: () => void;
  onHangUp: () => void;
}) {
  return (
    <div className="player">
      <Frame client={client} look={look} live={live} />
      <Doing live={live} transport={transport} />
      <Sizes size={size} onSize={onSize} />
      {/* Only while there is something to caption. A permanently reserved
          two-line gap under an idle avatar reads as a rendering fault. */}
      {live && <Captions />}
      {/* Hanging up is not what this column invites you to do, so the one state
          the kit draws as a filled destructive is taken down to an outline.
          Everything else about the button is the kit's — including which states
          it is disabled in, which is the half worth not reimplementing. */}
      <ConnectButton
        className="dial"
        size="xl"
        stateContent={{ ready: { children: "Disconnect", variant: "outline", className: "dial-hangup" } }}
        onConnect={onConnect}
        onDisconnect={onHangUp}
      />
      {unreachable !== null && <Unreachable detail={unreachable} />}
      <UserAudioControl
        classNames={{ buttongroup: "mic", button: "mic-button" }}
        dropdownMenuLabel="Your devices"
      />
    </div>
  );
}

/**
 * What to do about a dial that went nowhere.
 *
 * It sits under the button rather than in the page banner because it is about
 * the button, and because the answer is a command: this page is half of a pair
 * and the other half is a process you have not started. The transport's own
 * text goes in brackets when there is any — usually there is not, which is why
 * the sentence cannot be built out of it.
 */
function Unreachable({ detail }: { detail: string }) {
  return (
    <p className="unreachable" role="alert">
      Couldn't reach the pipecat server at <code>{SERVER_URL}</code>. Start it in another terminal:{" "}
      <code>cd py &amp;&amp; uv run --group server python ../server/server.py</code> — then press Connect
      again.
      {detail && <span className="unreachable-raw"> ({detail})</span>}
    </p>
  );
}

/**
 * How big the drawing is, which is a question about *inspection* and not about
 * the library — nothing here reaches `createAvatar`, the mount just gets wider
 * and the SVG fills it.
 */
function Sizes({ size, onSize }: { size: Size; onSize: (size: Size) => void }) {
  return (
    <div className="sizes">
      <div className="sizes-set" role="group" aria-label="Avatar size">
        {SIZES.map((px) => (
          <button
            key={px}
            type="button"
            className={px === size ? "on" : ""}
            aria-pressed={px === size}
            onClick={() => onSize(px)}
          >
            {px}
          </button>
        ))}
      </div>
      <small>{size === DEFAULT_SIZE ? "ships at this size" : "for inspection — it ships at 130"}</small>
    </div>
  );
}

function Frame({ client, look, live }: { client: PipecatClient; look: Look; live: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  // Every option is a remount, because the public surface has no setters:
  // `createAvatar` returns `{ destroy }` and that is the whole of it. Studio
  // shows what a consumer gets rather than routing around it.
  useEffect(() => {
    const avatar = createLookAvatar(look, mount.current!, client);
    return () => avatar.destroy();
  }, [client, look.avatar, look.mouthGain, look.gestureGain, look.motionGain, look.hand, look.handSide]);

  return (
    <div className="frame">
      <div className="frame-mount" ref={mount} />
      {/* The bot's output level, over the bottom of the drawing. It is fed by
          the transport's track and knows nothing about the avatar, which is
          what makes it worth having: mouth moving with a flat meter, or a loud
          meter with a still mouth, are both lipsync defects you can see.
          Only during a call: with no track to measure it drew nine flat dots
          across the character's collar, which is ink the drawing does not have
          and the first thing you see on a page that has not been dialled. */}
      {live && (
        <div className="frame-meter">
          <VoiceVisualizer
            participantType="bot"
            backgroundColor="transparent"
            barColor="--color-agent"
            barCount={9}
            barGap={2}
            barWidth={3}
            barMaxHeight={18}
            barOrigin="center"
            barLineCap="round"
          />
        </div>
      )}
    </div>
  );
}

/**
 * What the avatar is doing, in the library's own names for it.
 *
 * The state is resolved by `usePresence`, which reads the same events and the
 * same wire the face does rather than asking it anything — there is nothing to
 * ask, `createAvatar` returns `{ destroy }`. So this is a second, independent
 * reading of the call, and when it and the drawing disagree the disagreement is
 * the finding.
 *
 * The word shown is the state name off the wire, not a friendlier synonym.
 * `THINKING` is greppable in this repo and in a consumer's logs; "Pondering"
 * would be one more spelling of a vocabulary CLAUDE.md keeps exactly one copy
 * of. Before the call there is no state to name, so the transport says where it
 * has got to, in its own words.
 */
function Doing({ live, transport }: { live: boolean; transport: string }) {
  const presence = usePresence(live);

  // Announced, because the word changing is the event — the face moving is not
  // something a screen reader can report, and this line is the text of it.
  if (presence === null) {
    const settled = transport === "disconnected" || transport === "initialized";
    const tone = settled ? "idle" : transport === "error" ? "error" : "busy";
    return (
      <p className={`doing doing-${tone}`} aria-live="polite">
        <span className="doing-dot" aria-hidden="true" />
        {settled ? "Not connected" : transport}
      </p>
    );
  }

  return (
    <p className={`doing doing-${TONES[presence]}`} aria-live="polite">
      <span className="doing-dot" aria-hidden="true" />
      {presence}
    </p>
  );
}

/**
 * Colour is the whole signal at this size, so it carries the distinction that
 * matters rather than one per name: who has the floor (the kit's two semantic
 * colours), versus the run of states where nobody does. The three claims share
 * one tone deliberately — telling `THINKING` from `WORKING` is what the word is
 * for, and giving each its own colour would make the strip a legend to learn.
 */
const TONES: Record<Presence, string> = {
  SPEAKING: "talking",
  LISTENING: "listening",
  STRAINING: "waiting",
  THINKING: "waiting",
  WORKING: "waiting",
  MUTED: "error",
  IDLE: "idle",
};
