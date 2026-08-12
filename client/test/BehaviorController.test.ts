import { describe, expect, it, vi } from "vitest";
import { BehaviorController } from "../../src/behavior.js";
import { createFakeAvatar } from "./fakeAvatar.js";

describe("BehaviorController", () => {
  it("keeps WORKING as client policy while selecting the current typing activity", () => {
    const { api, calls } = createFakeAvatar();
    const controller = new BehaviorController(api, { random: () => 0 });

    controller.setState("WORKING");

    expect(controller.state).toBe("WORKING");
    expect(calls.setState).toEqual([{ name: "TYPING", o: undefined }]);
    controller.destroy();
  });

  it("stops a state program before projecting the next durable state", () => {
    vi.useFakeTimers();
    const { api, calls } = createFakeAvatar();
    const controller = new BehaviorController(api, { random: () => 0 });

    controller.setState("WORKING").setState("THINKING");
    vi.advanceTimersByTime(10_000);

    expect(calls.setState.map((call) => call.name)).toEqual(["TYPING", "THINKING"]);
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
