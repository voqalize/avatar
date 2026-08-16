// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("peep control-plane study", () => {
  it("keeps only dynamic feature paths while exercising the original pose contract", async () => {
    const { makeParams } = await import("../src/params.js");
    const { createFace } = await import("../src/face-peep-control-plane.js");
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const face = createFace(mount);
    face.apply(makeParams({
      headYaw: 1, headPitch: 0.6, shoulderL: 0.5, breath: 0.8,
      pupilX: 1, pupilY: -0.4, browRaiseL: 0.7,
      mouthOpen: 0.7, mouthWidth: 0.8, teethUpper: 1, tongue: 0.7,
    }));

    const dynamic = ["browL", "browR", "eyeL", "eyeR", "mouthIn", "lips", "teeth", "tongue"];
    for (const name of dynamic) {
      const node = face.svg.querySelector(`[id$="-${name}"]`);
      expect(node, `${name} is missing`).toBeTruthy();
    }
    expect(face.svg.querySelector('[id$="-eyeL"]')?.getAttribute("d")).toBeTruthy();
    expect(face.svg.querySelector('[id$="-lips"]')?.getAttribute("d")).toBeTruthy();
    expect(face.svg.querySelector('[id$="-teeth"]')?.getAttribute("d")).toBeTruthy();
    expect(face.svg.querySelector('[id$="-tongue"]')?.getAttribute("opacity")).toBe("1");

    // These transform targets are intentionally empty: every removed path was
    // static art, while the groups retain their normal poseTransforms wiring.
    for (const name of ["neck", "skull", "body", "hair"]) {
      const group = face.svg.querySelector(`[id$="-${name}"]`);
      expect(group?.children).toHaveLength(0);
      expect(group?.getAttribute("transform"), `${name} was not posed`).toBeTruthy();
    }

    face.destroy();
    expect(mount.children).toHaveLength(0);
    document.body.removeChild(mount);
  });
});
