import type { AvatarApi } from "./avatar.js";

export type BehaviorStateId =
  | "IDLE" | "LISTENING" | "THINKING" | "WORKING"
  | "SPEAKING" | "DEGRADED" | "OFFLINE"
  | "TYPING" | "REVIEWING_SCREEN" | "WAITING_FOR_USER" | "TYPING_CHAT"
  | "DISTRACTED" | "SEARCHING_SCREEN" | "CANT_HEAR" | "TAKING_FLOOR"
  | "WANTS_IN" | "YIELDED";

export type BehaviorActionId =
  | "ack.receive" | "ack.nod"
  | "turn.interrupted"
  | "gesture.greet" | "gesture.farewell" | "gesture.approve" | "gesture.wait";

export const BEHAVIOR_STATES: Record<BehaviorStateId, { renderState: string }>;
export const BEHAVIOR_STATE_IDS: BehaviorStateId[];
export const BEHAVIOR_ACTIONS: Record<BehaviorActionId, { renderAction: string }>;
export const BEHAVIOR_ACTION_IDS: BehaviorActionId[];
export const WIRE_ACTION_TO_BEHAVIOR: Record<string, BehaviorActionId>;
export const STATE_PROGRAMS: Record<string, { activities: string[]; repeatMs: [number, number] }>;
export const BEHAVIOR_ACTIVITIES: Record<string, { renderState: string }>;

export class BehaviorController {
  constructor(avatar: AvatarApi, options?: { random?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout });
  state: BehaviorStateId | null;
  setState(id: BehaviorStateId, options?: { force?: boolean }): this;
  action(id: BehaviorActionId): this;
  wireAction(id: string): this;
  destroy(): void;
}
