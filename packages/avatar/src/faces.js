/**
 * The faces we ship, as a table — for tooling that wants every one of them.
 *
 * **Importing this costs all three drawings** (~2k lines of path data). That is
 * the right trade for `rig-check`, the contact sheets, the sweep and Studio,
 * which exist to compare faces against each other. It is the wrong trade for an
 * application, which renders one: those import a single face module and hand
 * the record to `createAvatar` directly.
 *
 *     import { peep } from '@voqalize/avatar/faces/peep';
 *     createAvatar({ mount, client, face: peep });
 *
 * A **Face** is `{ create, meta }` and nothing else.
 *
 * `create` is `createFace(mount, theme) -> { svg, apply, theme, destroy }`,
 * callable standalone — the rig tooling drives faces with no mixer attached.
 * That behavioural contract is the whole of what the *rig* needs: everything
 * else — visemes, emotions, gaze, idle, clips, the mixer — works in parameter
 * space and never learns which face it is driving.
 *
 * `meta` is the descriptor (viewBox, mouthCrop — see META in any face module):
 * the things a HOST or a TOOL needs to frame a face without opening it. A face
 * was once a bare factory, on the argument that a schema guessed from two of
 * them would be wrong; the third settled it. Every rig needed exactly a framing
 * rect and a mouth rect to stop the tooling hard-coding per-face tables, and
 * nothing else — so that is all meta carries.
 *
 * The key is the face's name, not its rank. It used to be possible to read rank
 * into it — the original rig was keyed `default`, which became a lie the moment
 * it stopped being the one we ship. `DEFAULT_FACE` is the only place the choice
 * is made, and `packages/avatar/client/createAvatar.ts` is the only place it is consulted.
 *
 * Two earlier rigs, `classic` and `blue-shirt`, were removed on 2026-08-06:
 * stakeholders accepted the line-art pair and rejected both of the others, so
 * carrying them was maintenance against art nobody wanted. What they taught the
 * abstraction survives them — `face-core.js` exists because all three of the
 * first rigs wrote the same apply(), and META exists because all three needed
 * the same two rects. Their code is in git history if a lesson ever needs
 * re-reading.
 */

import { peep } from './face-peep.js';
import { wren } from './face-wren.js';
import { myna } from './face-myna.js';
import { lark } from './face-lark.js';

export { peep, wren, myna, lark };

export const FACES = { peep, wren, myna, lark };

export const FACE_NAMES = Object.keys(FACES);

/** The face a host gets when it does not name one. */
export const DEFAULT_FACE = 'peep';
