import { afterEach, describe, expect, it, vi } from "vitest";
import { createPresenceDirector } from "../../src/presence.js";
import { createFakeAvatar } from "./fakeAvatar.js";

afterEach(() => vi.useRealTimers());

describe("PresenceDirector", () => {
  it("turns a user-speaking signal into durable listening without changing the avatar contract", () => {
    const { api, calls } = createFakeAvatar();
    const director = createPresenceDirector(api);

    director.setUserSpeaking(true);

    expect(calls.setUserSpeaking).toEqual([true]);
    expect(calls.setState.at(-1)).toEqual({ name: "LISTENING", o: { emotion: "neutral" } });
  });

  it("only emits a semantic receipt once inside its cooldown unless forced", () => {
    let now = 1000;
    const { api, calls } = createFakeAvatar();
    const director = createPresenceDirector(api, { now: () => now });

    expect(director.acknowledge("RECEIPT")).toBe("ACK_RECEIVE");
    expect(director.acknowledge("RECEIPT")).toBe(false);
    now += 4200;
    expect(director.acknowledge("RECEIPT")).toBe("ACK_RECEIVE");
    expect(calls.action).toEqual([{ id: "ACK_RECEIVE" }, { id: "ACK_RECEIVE" }]);
  });

  it("composes the existing tool states into a repeatable work loop", () => {
    vi.useFakeTimers();
    const { api, calls } = createFakeAvatar();
    const director = createPresenceDirector(api);

    director.setToolStatus("WORKING");
    expect(calls.setState.at(-1)?.name).toBe("TYPING");
    vi.advanceTimersByTime(1900);
    expect(calls.setState.at(-1)?.name).toBe("REVIEWING_SCREEN");
    vi.advanceTimersByTime(1450);
    expect(calls.setState.at(-1)?.name).toBe("TYPING");

    director.setToolStatus("COMPLETE");
    expect(calls.setState.at(-1)).toEqual({ name: "WAITING_FOR_USER", o: { emotion: "encouraging" } });
    vi.advanceTimersByTime(10000);
    expect(calls.setState.filter(({ name }) => name === "SEARCHING_SCREEN")).toHaveLength(0);
  });

  it("choreographs a pre-speech handoff and a clear post-speech invitation", () => {
    const { api, calls } = createFakeAvatar();
    const director = createPresenceDirector(api);

    director.beginResponse({ leadMs: 280 }).endResponse();

    expect(calls.perform).toEqual([{
      actions: [
        { t: 0, do: "state", name: "TAKING_FLOOR" },
        { t: 0, do: "action", id: "ACK_RECEIVE" },
        { t: 280, do: "state", name: "SPEAKING" },
      ],
      o: undefined,
    }]);
    expect(calls.setState.at(-1)).toEqual({ name: "WAITING_FOR_USER", o: { emotion: "encouraging" } });
  });
});
