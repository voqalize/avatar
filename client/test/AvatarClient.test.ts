import { describe, expect, it, vi } from "vitest";
import { AvatarClient, RTVI_EVENTS } from "../src/AvatarClient.js";
import { createFakeAvatar } from "./fakeAvatar.js";

describe("AvatarClient dispatch", () => {
  it("accepts a durable lower-priority server claim", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "claim", state: "THINKING" });
    client.dispatch({ type: "avatar", cmd: "claim", state: "WORKING" });
    client.dispatch({ type: "avatar", cmd: "claim", state: null });

    expect(calls.setState).toHaveLength(3);
    expect(calls.setState.map(({ name }) => name)).toEqual(["THINKING", "TYPING", "LISTENING"]);
  });

  it("routes all one-shot sequences through action()", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "action", id: "ACK_RECEIVE" });
    client.dispatch({ type: "avatar", cmd: "action", id: "GESTURE_GREET" });

    expect(calls.action).toEqual([{ id: "ACK_RECEIVE" }, { id: "GESTURE_GREET" }]);
  });

  it("ignores an unknown cmd silently — a newer server talking to an older widget", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    expect(() => client.dispatch({ type: "avatar", cmd: "future_thing", foo: 1 })).not.toThrow();

    // No widget method should have fired for an unrecognized cmd, and there is
    // deliberately no callback reporting it — see docs/removed.md.
    expect(calls.setState).toHaveLength(0);
    expect(calls.action).toHaveLength(0);
    expect(calls.speak).toHaveLength(0);
  });

  it("drops anything that is not in the avatar envelope", () => {
    const { calls, api } = createFakeAvatar();
    const client = new AvatarClient(api);

    expect(() => client.dispatch(null)).not.toThrow();
    expect(() => client.dispatch(42)).not.toThrow();
    expect(() => client.dispatch({ notACmd: true })).not.toThrow();
    // A bare command with no envelope is somebody else's message that happens
    // to have a `cmd` field. The envelope is the whole membership test.
    expect(() => client.dispatch({ cmd: "claim", state: "THINKING" })).not.toThrow();
    // ...and so is a foreign envelope carrying one.
    expect(() => client.dispatch({ type: "llm", cmd: "claim", state: "THINKING" })).not.toThrow();
    expect(calls.setState).toHaveLength(0);
  });

  it("routes a thrown widget error to onError instead of propagating", () => {
    const { api } = createFakeAvatar();
    api.action = () => {
      throw new Error("unknown state");
    };
    const onError = vi.fn();
    const client = new AvatarClient(api, { onError });

    expect(() => client.dispatch({ type: "avatar", cmd: "action", id: "BOGUS" })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

});

describe("AvatarClient Pipecat-bound cue lifecycle", () => {
  it("buffers cues by base-TTS context, then starts the FIFO context at bot playout", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 1000 });

    // Cues arrive before the turn's clock is anchored.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "X" }, { t: 40, v: "B" }] });

    // Buffered, not yet handed to the widget.
    expect(calls.speak).toHaveLength(0);
    expect(calls.pushCues).toHaveLength(0);
    expect(client.turnCtx).toBeNull();

    (client as any).onBotStartedSpeaking();

    expect(calls.speak).toHaveLength(1);
    expect(calls.speak[0].o?.cues).toEqual([{ t: 0, v: "X" }, { t: 40, v: "B" }]);
    expect(client.turnCues).toEqual([{ t: 0, v: "X" }, { t: 40, v: "B" }]);
    expect(typeof calls.speak[0].o?.clock).toBe("function");
  });

  it("anchors the clock at Pipecat bot-start, not at construction", () => {
    let t = 500;
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => t });

    t = 5000;
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    const clock = calls.speak[0].o!.clock!;

    expect(clock()).toBe(0); // t0 == 5000, now() == 5000
    t = 5250;
    expect(clock()).toBe(250);
  });

  it("bot stop ends the active FIFO context and rejects a late cue", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    expect(client.turnCtx).toBe("turn-1");

    (client as any).onBotStoppedSpeaking();

    expect(calls.stopSpeaking).toBe(1);
    expect(client.turnCtx).toBeNull();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }] });
    expect(client.turnCues).toEqual([]);
  });

  it("FIFO-binds consecutive base-TTS contexts to consecutive playout intervals", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }] });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-2", from_ms: 0, cues: [{ t: 0, v: "B" }] });
    (client as any).onBotStartedSpeaking();
    (client as any).onBotStoppedSpeaking();
    (client as any).onBotStartedSpeaking();

    expect(client.turnCtx).toBe("turn-2");
    expect(calls.speak.at(-1)?.o?.cues).toEqual([{ t: 0, v: "B" }]);
  });
});

describe("AvatarClient cue splice", () => {
  it("appends via the cheap pushCues path when from_ms doesn't reach into the queued track", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    // Buffered pre-playout, then handed over as the turn's one speak() call —
    // see the lifecycle describe block for that behavior in isolation.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 100, v: "B" }] });
    (client as any).onBotStartedSpeaking();
    expect(calls.speak).toHaveLength(1);
    expect(calls.speak[0].o?.cues).toEqual([{ t: 0, v: "A" }, { t: 100, v: "B" }]);

    // Pure append past the existing track's last cue: from_ms >= every queued t.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 200, cues: [{ t: 200, v: "C" }, { t: 300, v: "X" }] });

    expect(calls.pushCues).toHaveLength(1);
    expect(calls.pushCues[0].cues).toEqual([{ t: 200, v: "C" }, { t: 300, v: "X" }]);
    // speak() only fired once, for the turn's start; the append used pushCues.
    expect(calls.speak).toHaveLength(1);
    expect(client.turnCues).toEqual([
      { t: 0, v: "A" },
      { t: 100, v: "B" },
      { t: 200, v: "C" },
      { t: 300, v: "X" },
    ]);
  });

  it("re-speaks the full spliced track when from_ms discards a stale tail", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({
      type: "avatar",
      cmd: "cues",
      ctx: "turn-1",
      from_ms: 0,
      cues: [{ t: 0, v: "A" }, { t: 100, v: "B" }, { t: 200, v: "C" }, { t: 300, v: "D" }],
    });
    (client as any).onBotStartedSpeaking();
    expect(calls.speak).toHaveLength(1); // the turn-start handoff

    // The accurate leg corrects everything from 150ms on.
    client.dispatch({
      type: "avatar",
      cmd: "cues",
      ctx: "turn-1",
      from_ms: 150,
      cues: [{ t: 150, v: "F" }, { t: 250, v: "G" }],
    });

    // discarded > 0 (200 and 300 fell at/after from_ms) => full re-speak, not pushCues.
    expect(calls.pushCues).toHaveLength(0);
    expect(calls.speak).toHaveLength(2);
    expect(calls.speak[1].o?.cues).toEqual([
      { t: 0, v: "A" },
      { t: 100, v: "B" },
      { t: 150, v: "F" },
      { t: 250, v: "G" },
    ]);
    expect(client.turnCues).toEqual(calls.speak[1].o!.cues);
  });

  it("keeps the canonical track correctly ordered even if a chunk arrives out of t order", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 300, v: "D" }] });
    // A splice that both discards (300 >= 50) and inserts out of order relative
    // to what's already queued.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 50, cues: [{ t: 200, v: "C" }, { t: 100, v: "B" }] });

    expect(client.turnCues).toEqual([
      { t: 0, v: "A" },
      { t: 100, v: "B" },
      { t: 200, v: "C" },
    ]);
    expect(calls.speak.at(-1)!.o?.cues).toEqual(client.turnCues);
  });

  it("from_ms is an exclusive-of-kept boundary: a cue exactly at from_ms is discarded, not kept", () => {
    const { api } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 100, v: "B" }] });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 100, cues: [{ t: 100, v: "Z" }] });

    // t:100/"B" must be discarded (t >= from_ms) and replaced by t:100/"Z".
    expect(client.turnCues).toEqual([{ t: 0, v: "A" }, { t: 100, v: "Z" }]);
  });
});

describe("RTVI_EVENTS", () => {
  it("spells the subscribed event names the real enum spells", async () => {
    // AvatarClient imports the enum type-only, so nothing above can catch a
    // rename — string enums are nominal, so the compiler will not compare a
    // literal against RTVIEvent either. This test is the check, and it belongs
    // here: the peer is a devDependency of the workspace and absent from what
    // we publish, which is the whole point of the literals.
    const { RTVIEvent } = await import("@pipecat-ai/client-js");

    expect(RTVI_EVENTS.serverMessage).toBe(RTVIEvent.ServerMessage);
    expect(RTVI_EVENTS.userStartedSpeaking).toBe(RTVIEvent.UserStartedSpeaking);
    expect(RTVI_EVENTS.userStoppedSpeaking).toBe(RTVIEvent.UserStoppedSpeaking);
    expect(RTVI_EVENTS.botStartedSpeaking).toBe(RTVIEvent.BotStartedSpeaking);
    expect(RTVI_EVENTS.botStoppedSpeaking).toBe(RTVIEvent.BotStoppedSpeaking);
  });
});

describe("AvatarClient authority resolver", () => {
  function attached() {
    const listeners = new Map<string, (...args: any[]) => void>();
    const pc = {
      on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); },
      off(event: string) { listeners.delete(event); },
    };
    const fake = createFakeAvatar();
    const adapter = new AvatarClient(fake.api);
    adapter.attach(pc as never);
    const emit = (event: string, data?: unknown) => listeners.get(event)?.(data);
    return { ...fake, adapter, emit };
  }

  it("uses Pipecat user speech for listening and server claims for the lower states", () => {
    const { calls, emit } = attached();

    emit(RTVI_EVENTS.userStartedSpeaking);
    emit(RTVI_EVENTS.userStoppedSpeaking);

    expect(calls.setUserSpeaking).toEqual([true, false]);
    expect(calls.setState.map((call) => call.name)).toEqual(["LISTENING"]);
  });

  it("makes bot speech win over user VAD and all server claims", () => {
    const { calls, emit, adapter } = attached();

    adapter.dispatch({ type: "avatar", cmd: "claim", state: "WORKING" });
    emit(RTVI_EVENTS.botStartedSpeaking);
    emit(RTVI_EVENTS.userStartedSpeaking);

    expect(calls.setState.map((call) => call.name)).toEqual(["TYPING", "SPEAKING"]);
  });

  it("keeps observed speech above a concurrent recoverable failure", () => {
    const { calls, emit } = attached();

    emit(RTVI_EVENTS.error, { data: { fatal: false } });
    emit(RTVI_EVENTS.botStartedSpeaking);

    // Starting playout clears a recoverable failure first; the important
    // precedence invariant is the final SPEAKING projection.
    expect(calls.setState.map((call) => call.name)).toEqual(["DEGRADED", "IDLE", "SPEAKING"]);
  });

  it("uses bot playout as a mouth safety stop and returns to listening", () => {
    const { calls, emit, adapter } = attached();

    emit(RTVI_EVENTS.botStartedSpeaking);
    adapter.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    emit(RTVI_EVENTS.botStoppedSpeaking);
    expect(calls.stopSpeaking).toBe(1);
    expect(adapter.turnCtx).toBeNull();
    expect(calls.setState.at(-1)?.name).toBe("LISTENING");
  });

  it("waits for playout to stop before starting a server-confirmed interruption action", () => {
    const { calls, emit, adapter } = attached();

    emit(RTVI_EVENTS.botStartedSpeaking);
    adapter.dispatch({ type: "avatar", cmd: "cues", ctx: "cut-1", from_ms: 0, cues: [] });
    adapter.dispatch({ type: "avatar", cmd: "action", id: "RESPONSE_INTERRUPTED" });
    emit(RTVI_EVENTS.userStartedSpeaking);
    expect(calls.action).toEqual([]);
    emit(RTVI_EVENTS.botStoppedSpeaking);

    expect(calls.stopSpeaking).toBe(1);
    expect(calls.setState.at(-1)?.name).toBe("LISTENING");
    expect(calls.action).toEqual([{ id: "RESPONSE_INTERRUPTED" }]);
  });

  it("drops prefetched visemes that belonged to interrupted audio", () => {
    const { calls, emit, adapter } = attached();

    adapter.dispatch({ type: "avatar", cmd: "cues", ctx: "active", from_ms: 0, cues: [] });
    adapter.dispatch({ type: "avatar", cmd: "cues", ctx: "discard", from_ms: 0, cues: [] });
    emit(RTVI_EVENTS.botStartedSpeaking);
    adapter.dispatch({ type: "avatar", cmd: "action", id: "RESPONSE_INTERRUPTED" });
    emit(RTVI_EVENTS.botStoppedSpeaking);
    emit(RTVI_EVENTS.botStartedSpeaking);

    expect(calls.speak).toHaveLength(1);
    expect(adapter.turnCtx).toBeNull();
  });

  it("enters client-owned idle only after a sustained quiet listening interval", () => {
    vi.useFakeTimers();
    const fake = createFakeAvatar();
    const adapter = new AvatarClient(fake.api, { idleDelayMs: 600 });
    const listeners = new Map<string, (...args: any[]) => void>();
    adapter.attach({ on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); }, off() {} } as never);
    const emit = (event: string) => listeners.get(event)?.();

    emit(RTVI_EVENTS.userStartedSpeaking);
    emit(RTVI_EVENTS.userStoppedSpeaking);
    expect(fake.calls.setState.at(-1)?.name).toBe("LISTENING");

    vi.advanceTimersByTime(600);
    expect(fake.calls.setState.at(-1)?.name).toBe("IDLE");
    vi.useRealTimers();
  });

  it("plays an acknowledgement only when the backend sends its explicit action", () => {
    const { calls, adapter } = attached();
    adapter.dispatch({ type: "avatar", cmd: "action", id: "ACK_NOD" });

    expect(calls.action).toEqual([{ id: "ACK_NOD" }]);
  });
});
