/**
 * The avatar and the four things you need next to it.
 *
 *     createAvatar({ mount, client, ...look })
 *
 * The frame is small on purpose. 130 px is the size this rig is calibrated at
 * (CLAUDE.md § In flight — production calibration retires the reference image as
 * the yardstick), so this is the avatar at the size a consumer will actually
 * embed it, not a poster of it. A face that only reads at 400 px is a face that
 * does not work, and showing it big hides that.
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

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import { ConnectButton, UserAudioControl, VoiceVisualizer } from "@pipecat-ai/voice-ui-kit";
import { createAvatar } from "@voqalize/avatar";
import { Captions } from "./Captions";
import { faceValue, type Look } from "./look";

export function Stage({
  client,
  look,
  live,
  transport,
  onConnect,
  onHangUp,
}: {
  client: PipecatClient;
  look: Look;
  live: boolean;
  transport: string;
  onConnect: () => void;
  onHangUp: () => void;
}) {
  return (
    <div className="player">
      <Frame client={client} look={look} />
      <Doing live={live} transport={transport} />
      {/* Only while there is something to caption. A permanently reserved
          two-line gap under an idle avatar reads as a rendering fault. */}
      {live && <Captions />}
      <ConnectButton
        className="dial"
        size="xl"
        onConnect={onConnect}
        onDisconnect={onHangUp}
      />
      <UserAudioControl
        classNames={{ buttongroup: "mic", button: "mic-button" }}
        dropdownMenuLabel="Your devices"
      />
    </div>
  );
}

function Frame({ client, look }: { client: PipecatClient; look: Look }) {
  const mount = useRef<HTMLDivElement>(null);
  // Every option is a remount, because the public surface has no setters:
  // `createAvatar` returns `{ destroy }` and that is the whole of it. Studio
  // shows what a consumer gets rather than routing around it.
  useEffect(() => {
    const avatar = createAvatar({
      mount: mount.current!,
      client,
      face: faceValue(look.face),
      mouthGain: look.mouthGain,
      gestureGain: look.gestureGain,
      motionGain: look.motionGain,
      hand: look.hand,
      handSide: look.handSide,
    });
    return () => avatar.destroy();
  }, [client, look.face, look.mouthGain, look.gestureGain, look.motionGain, look.hand, look.handSide]);

  return (
    <div className="frame">
      <div className="frame-mount" ref={mount} />
      {/* The bot's output level, over the bottom of the drawing. It is fed by
          the transport's track and knows nothing about the avatar, which is
          what makes it worth having: mouth moving with a flat meter, or a loud
          meter with a still mouth, are both lipsync defects you can see. */}
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
    </div>
  );
}

/**
 * What the avatar is doing, in the words the library uses for it.
 *
 * Derived from transport state and the two speaking events, because there is no
 * "what is the avatar doing" to read: the face is downstream of the same events
 * and holds no state a caller may query — `createAvatar` returns `{ destroy }`.
 * So this is a second, independent reading of the call rather than a report from
 * the avatar, and when the two disagree the disagreement is the finding.
 */
function Doing({ live, transport }: { live: boolean; transport: string }) {
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, useCallback(() => setBotSpeaking(true), []));
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, useCallback(() => setBotSpeaking(false), []));
  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking, useCallback(() => setUserSpeaking(true), []));
  useRTVIClientEvent(RTVIEvent.UserStoppedSpeaking, useCallback(() => setUserSpeaking(false), []));

  useEffect(() => {
    if (!live) {
      setBotSpeaking(false);
      setUserSpeaking(false);
    }
  }, [live]);

  const [tone, label] =
    !live
      ? transport === "disconnected" || transport === "initialized"
        ? (["idle", "Idle"] as const)
        : ([transport === "error" ? "error" : "busy", transport] as const)
      : botSpeaking
        ? (["talking", "Talking"] as const)
        : userSpeaking
          ? (["listening", "Listening"] as const)
          : (["idle", "Idle"] as const);

  return (
    <p className={`doing doing-${tone}`}>
      <span className="doing-dot" aria-hidden="true" />
      {label}
    </p>
  );
}
