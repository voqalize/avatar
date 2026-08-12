import { Layout, Fit, Alignment, Rive, StateMachineInputType, type StateMachineInput } from "@rive-app/canvas";
import type { AvatarFrame, AvatarRig, HandFrame } from "../../src/rig.js";

const RIVE_SRC = "/rive/bob.riv";
const STATE_MACHINES = ["Lip Sync", "Pupils", "Poses"];
const VISEMES = ["X", "A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type ContractReport = {
  stateMachines: string[];
  inputs: Record<string, Array<{ name: string; type: string; value: number | boolean }>>;
};

type Options = { onContract?: (report: ContractReport) => void };

function key(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function inputType(input: StateMachineInput): string {
  return input.type === StateMachineInputType.Number ? "number" : input.type === StateMachineInputType.Boolean ? "boolean" : "trigger";
}

function average(pose: Record<string, number>, left: string, right: string): number {
  return ((pose[left] ?? 0) + (pose[right] ?? 0)) / 2;
}

function visemeIndex(pose: Record<string, number>): number {
  const open = pose.mouthOpen ?? 0.02;
  if (open < 0.06) return 0;
  if ((pose.mouthPress ?? 0) > 0.42) return 1;
  if ((pose.mouthTuck ?? 0) > 0.5) return 7;
  if ((pose.tongue ?? 0) > 0.5) return 8;
  if ((pose.mouthRound ?? 0) > 0.7) return 6;
  if (open > 0.68) return 4;
  if (open > 0.38) return 3;
  if (open > 0.26) return 5;
  return 2;
}

function handPose(hand?: HandFrame): number | null {
  if (!hand) return null;
  // Bob's Poses machine is authored as a numeric pose selector. These values
  // are deliberately private to this adapter; the public rig only sees the
  // semantic hand frame.
  return { greet: 4, farewell: 5, approve: 2, wait: 3 }[hand.gesture] ?? 0;
}

export function createBobRiveRig(mount: HTMLElement, rawOptions: unknown = {}): AvatarRig {
  const options = (rawOptions && typeof rawOptions === "object" ? rawOptions : {}) as Options;
  const canvas = document.createElement("canvas");
  canvas.className = "rive-avatar-canvas";
  canvas.setAttribute("aria-label", "Rive Bob avatar");
  mount.replaceChildren(canvas);

  let rive: Rive | null = null;
  let disposed = false;
  let latest: AvatarFrame | null = null;
  const inputs = new Map<string, StateMachineInput>();

  const find = (...names: string[]) => names.map(key).map((name) => inputs.get(name)).find(Boolean) ?? null;
  const setNumber = (value: number, ...names: string[]) => {
    const input = find(...names);
    if (input?.type === StateMachineInputType.Number) input.value = value;
  };
  const setBoolean = (value: boolean, ...names: string[]) => {
    const input = find(...names);
    if (input?.type === StateMachineInputType.Boolean) input.value = value;
  };

  const applyFrame = (frame: AvatarFrame) => {
    latest = frame;
    if (!rive || disposed) return;
    const pose = frame.pose;
    setNumber(visemeIndex(pose), "visemes", "viseme");
    setNumber(pose.pupilX ?? 0, "pupils_X", "pupilX");
    setNumber(pose.pupilY ?? 0, "pupils_Y", "pupilY");
    setNumber(pose.headYaw ?? 0, "Head_Rotation_X", "headYaw");
    setNumber(pose.headPitch ?? 0, "Head_Rotation_Y", "headPitch");
    setNumber(average(pose, "browRaiseL", "browRaiseR"), "eyebrows_Y", "browRaise");
    setNumber(average(pose, "browAngleL", "browAngleR"), "eyebrows_Rot", "browAngle");
    setNumber(average(pose, "browInnerL", "browInnerR"), "eyebrows_Bend", "browInner");
    setNumber(average(pose, "mouthCornerL", "mouthCornerR"), "mouth_mood", "mouthMood");
    setNumber(pose.mouthWidth ?? 0.42, "mouth_X", "mouthWidth");
    setNumber(pose.mouthOpen ?? 0.02, "mouth_Y", "mouthOpen");
    setNumber(pose.breath ?? 0, "breathIntense", "breath");
    const poseValue = handPose(frame.hand);
    if (poseValue !== null) setNumber(poseValue, "poses", "pose");
    setBoolean(Boolean(frame.hand?.side === "left"), "flipView", "flip");
  };

  rive = new Rive({
    src: RIVE_SRC,
    canvas,
    autoplay: true,
    stateMachines: STATE_MACHINES,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoad: () => {
      if (!rive || disposed) return;
      for (const machine of rive.stateMachineNames) {
        for (const input of rive.stateMachineInputs(machine)) inputs.set(key(input.name), input);
      }
      options.onContract?.({
        stateMachines: [...rive.stateMachineNames],
        inputs: Object.fromEntries([...rive.stateMachineNames].map((machine) => [machine, rive!.stateMachineInputs(machine).map((input) => ({ name: input.name, type: inputType(input), value: input.value }))])),
      });
      if (latest) applyFrame(latest);
    },
  });

  return {
    apply: applyFrame,
    destroy() {
      disposed = true;
      rive?.cleanup();
      rive = null;
      mount.replaceChildren();
    },
  };
}

export { RIVE_SRC, STATE_MACHINES, VISEMES };
