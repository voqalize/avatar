/**
 * A hand-rolled fake `AvatarApi` — records every call instead of driving a
 * real widget instance. No mock-framework auto-stubbing: every member is
 * written out against the real interface, so a shape change in
 * `src/avatar.d.ts` is a compile error here, not a silently-passing test.
 */
import type {
  AvatarApi,
  AvatarEmotionName,
  AvatarGazeName,
  AvatarMeta,
  AvatarStateName,
  Cue,
  GazeCustom,
  PerformHandle,
  SetStateOptions,
  SpeakOptions,
  AvatarAction,
  PerformOptions,
} from "../../src/avatar.js";

export interface FakeAvatarCalls {
  setState: Array<{ name: string; o?: SetStateOptions }>;
  setEmotion: Array<{ name: string; intensity?: number }>;
  setGaze: Array<{ name: string; custom?: GazeCustom }>;
  speak: Array<{ o?: SpeakOptions }>;
  pushCues: Array<{ cues: Cue[] }>;
  stopSpeaking: number;
  action: Array<{ id: string }>;
  perform: Array<{ actions: AvatarAction[]; o?: PerformOptions }>;
  setUserSpeaking: Array<boolean | null>;
  destroy: number;
}

export interface FakeAvatar {
  api: AvatarApi;
  calls: FakeAvatarCalls;
}

/** Builds a fake `AvatarApi` plus a `calls` log the test can assert against. */
export function createFakeAvatar(): FakeAvatar {
  const calls: FakeAvatarCalls = {
    setState: [],
    setEmotion: [],
    setGaze: [],
    speak: [],
    pushCues: [],
    stopSpeaking: 0,
    action: [],
    perform: [],
    setUserSpeaking: [],
    destroy: 0,
  };

  let state: AvatarStateName = "IDLE";
  let emotion: AvatarEmotionName = "neutral";
  let gaze: AvatarGazeName = "USER";
  let speaking = false;

  const api: AvatarApi = {
    setState(name, o) {
      calls.setState.push({ name, o });
      state = name as AvatarStateName;
      if (o?.emotion) emotion = o.emotion as AvatarEmotionName;
      if (o?.gaze) gaze = o.gaze as AvatarGazeName;
      return api;
    },
    setEmotion(name, intensity) {
      calls.setEmotion.push({ name, intensity });
      emotion = name as AvatarEmotionName;
      return api;
    },
    setGaze(name, custom) {
      calls.setGaze.push({ name, custom });
      gaze = name as AvatarGazeName;
      return api;
    },
    speak(o) {
      calls.speak.push({ o });
      speaking = true;
      return api;
    },
    pushCues(cues) {
      calls.pushCues.push({ cues });
      return api;
    },
    stopSpeaking() {
      calls.stopSpeaking += 1;
      speaking = false;
      return api;
    },
    action(id) {
      calls.action.push({ id });
      return api;
    },
    setHandSide() {
      return api;
    },
    perform(actions, o): PerformHandle {
      calls.perform.push({ actions, o });
      return { stop: () => {} };
    },
    setUserSpeaking(b) {
      calls.setUserSpeaking.push(b);
      return api;
    },
    attend() {
      return api;
    },
    setMouthGain() {
      return api;
    },
    get mouthGain() {
      return 1;
    },
    setGestureGain() {
      return api;
    },
    get gestureGain() {
      return 1;
    },
    setMotionGain() {
      return api;
    },
    get motionGain() {
      return 1;
    },
    blink() {
      return api;
    },
    step() {
      return api;
    },
    setOverrides() {
      return api;
    },
    on() {
      return api;
    },
    get state() {
      return state;
    },
    get emotion() {
      return emotion;
    },
    get gaze() {
      return gaze;
    },
    get speaking() {
      return speaking;
    },
    get performing() {
      return false;
    },
    get clip() {
      return null;
    },
    get gesturing() {
      return null;
    },
    get params() {
      return {};
    },
    get userSpeaking() {
      return false;
    },
    svg: undefined as unknown as SVGSVGElement,
    meta: { viewBox: { x: 0, y: 0, w: 1, h: 1 } } as AvatarMeta,
    destroy() {
      calls.destroy += 1;
    },
  };

  return { api, calls };
}
