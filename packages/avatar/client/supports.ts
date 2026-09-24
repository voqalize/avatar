/**
 * `supports` for every avatar this package ships.
 *
 * It is one constant and one file because they are one renderer: every avatar
 * mounts the same mixer with the same clip library, so a second list would be
 * the same list with a second chance to be wrong. It is not in
 * `createAvatar.ts`, where the type is documented, because a value is imported
 * for real — reading it from there would pull `peep`'s drawing into every
 * consumer's bundle.
 *
 * The two required ids first, then this renderer's own catalogue. `ACTION_IDS`
 * already carries `RESPONSE_INTERRUPTED` as this renderer's shape for it, so
 * the join dedupes rather than concatenating, and `ACKNOWLEDGE` is the one name
 * here with no clip behind it because `action()` resolves it on the floor
 * (docs/internal-mixer.md § Actions).
 */

import { ACTION_IDS } from "../src/avatar.js";
import type { AvatarSupport } from "./createAvatar.js";
import { CORE_ACTION_IDS } from "./types.js";

export const supports: AvatarSupport = Object.freeze({
  actions: Object.freeze([
    ...CORE_ACTION_IDS,
    ...ACTION_IDS.filter((id) => !(CORE_ACTION_IDS as readonly string[]).includes(id)),
  ]),
});
