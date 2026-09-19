import type { AvatarStateName } from "./avatar.js";

/** The two renderer calls behavior resolution actually needs. */
export interface BehaviorAvatar {
  setState(name: AvatarStateName): unknown;
  /**
   * One motion by name. The vocabulary is open — two core intents plus
   * whatever this avatar publishes — so a name it does not have must be a
   * no-op rather than a throw.
   */
  action(id: string): unknown;
}

/**
 * The whole behaviour vocabulary — the nine. Not an alias list; see behavior.js.
 *
 * Every one of these is also an `AvatarStateName`, which is why there is no
 * mapping table any more.
 */
export type BehaviorStateId =
  | "IDLE" | "LISTENING" | "CANT_HEAR" | "THINKING" | "WORKING"
  | "MUTED" | "SPEAKING" | "DEGRADED" | "OFFLINE";

export type BehaviorActionId = "ack" | "turn.interrupted";

export const BEHAVIOR_STATE_IDS: readonly BehaviorStateId[];
export const BEHAVIOR_ACTIONS: Readonly<Record<BehaviorActionId, { renderAction: string }>>;
export const BEHAVIOR_ACTION_IDS: readonly BehaviorActionId[];
export const WIRE_ACTION_TO_BEHAVIOR: Readonly<Record<string, BehaviorActionId>>;

export class BehaviorController {
  constructor(avatar: BehaviorAvatar);
  state: BehaviorStateId | null;
  setState(id: BehaviorStateId, options?: { force?: boolean }): this;
  action(id: BehaviorActionId): this;
  /**
   * One id off the wire: a core intent through the catalog, anything else
   * straight to the renderer. Never throws — the vocabulary is open.
   */
  wireAction(id: string): this;
  destroy(): void;
}
