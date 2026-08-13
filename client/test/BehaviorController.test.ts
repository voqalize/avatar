import { describe, expect, it, vi } from "vitest";
import { BehaviorController } from "../../src/behavior.js";
import { createFakeAvatar } from "./fakeAvatar.js";

describe("BehaviorController", () => {
  // The wire word has to reach the renderer intact. WORKING used to project
  // as TYPING — a behaviour named after one rendering of it — which meant an
  // implementation was told what to *draw* rather than what was happening.
  it("projects the behavior state, not a renderer's name for it", () => {
    const { api, calls } = createFakeAvatar();
    const controller = new BehaviorController(api);

    controller.setState("WORKING");

    expect(controller.state).toBe("WORKING");
    expect(calls.setState).toEqual([{ name: "WORKING", o: undefined }]);
    controller.destroy();
  });

  // There is no activity program any more, so a durable state must be silent
  // between transitions rather than re-asserting itself on a timer.
  it("issues nothing after a state settles", () => {
    vi.useFakeTimers();
    const { api, calls } = createFakeAvatar();
    const controller = new BehaviorController(api);

    controller.setState("WORKING").setState("THINKING");
    vi.advanceTimersByTime(10_000);

    expect(calls.setState.map((call) => call.name)).toEqual(["WORKING", "THINKING"]);
    controller.destroy();
    vi.useRealTimers();
  });

  it("maps stable wire names into library action names", () => {
    const { api, calls } = createFakeAvatar();
    const controller = new BehaviorController(api);

    controller.wireAction("GESTURE_GOODBYE");

    expect(calls.action).toEqual([{ id: "GESTURE_GOODBYE" }]);
    controller.destroy();
  });
});
