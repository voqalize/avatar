import type { AvatarApi, AvatarActionId, AvatarStateName } from "./avatar.js";

/** The whole behaviour vocabulary. Not an alias list — see behavior.js. */
export type BehaviorStateId =
  | "IDLE" | "LISTENING" | "THINKING" | "WORKING"
  | "SPEAKING" | "DEGRADED" | "OFFLINE";

export type BehaviorActionId =
  | "ack.receive" | "ack.nod"
  | "turn.interrupted"
  | "gesture.greet" | "gesture.farewell" | "gesture.approve" | "gesture.wait";

export const BEHAVIOR_STATES: Readonly<Record<BehaviorStateId, { renderState: AvatarStateName }>>;
export const BEHAVIOR_STATE_IDS: readonly BehaviorStateId[];
export const BEHAVIOR_ACTIONS: Readonly<Record<BehaviorActionId, { renderAction: AvatarActionId }>>;
export const BEHAVIOR_ACTION_IDS: readonly BehaviorActionId[];
export const WIRE_ACTION_TO_BEHAVIOR: Readonly<Record<AvatarActionId, BehaviorActionId>>;

export class BehaviorController {
  constructor(avatar: AvatarApi);
  state: BehaviorStateId | null;
  setState(id: BehaviorStateId, options?: { force?: boolean }): this;
  action(id: BehaviorActionId): this;
  wireAction(id: AvatarActionId): this;
  destroy(): void;
}
