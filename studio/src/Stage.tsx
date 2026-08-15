/**
 * The avatars, mounted from the published seam and nothing else.
 *
 *     createAvatar({ mount, client, ...look })
 *
 * Compare mode mounts all three faces on the *same* client. That is the claim
 * the interface makes — an avatar is an embodiment of a `PipecatClient`, and
 * nothing about it is exclusive — and it is the only way to judge two drawings
 * against identical input, which matters because the avatars are separate
 * drawings rather than renderings of one: a fix that reads on `peep` often
 * means nothing on `myna`.
 */

import { useEffect, useRef } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";
import { createAvatar } from "@voqalize/avatar";
import { FACE_NAMES, faceValue, type FaceName, type Look } from "./look";

function Tile({ client, look, face }: { client: PipecatClient; look: Look; face: FaceName }) {
  const mount = useRef<HTMLDivElement>(null);
  // Every option is a remount, because the public surface has no setters:
  // `createAvatar` returns `{ destroy }` and that is the whole of it. Studio
  // shows what a consumer gets rather than routing around it.
  useEffect(() => {
    const avatar = createAvatar({
      mount: mount.current!,
      client,
      face: faceValue(face),
      mouthGain: look.mouthGain,
      gestureGain: look.gestureGain,
      motionGain: look.motionGain,
      hand: look.hand,
      handSide: look.handSide,
    });
    return () => avatar.destroy();
  }, [client, face, look.mouthGain, look.gestureGain, look.motionGain, look.hand, look.handSide]);
  return (
    <figure className="tile">
      <div className="tile-mount" ref={mount} />
      <figcaption>{face}</figcaption>
    </figure>
  );
}

export function Stage({ client, look, compare }: { client: PipecatClient; look: Look; compare: boolean }) {
  const faces = compare ? FACE_NAMES : [look.face];
  return (
    <div className={`stage ${compare ? "stage-compare" : ""}`}>
      {faces.map((face) => (
        <Tile key={face} client={client} look={look} face={face} />
      ))}
    </div>
  );
}
