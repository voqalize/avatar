import { describe, expect, it, vi } from "vitest";
import { AvatarClient, RTVI_EVENTS } from "../src/AvatarClient.js";
import { createFakeAvatar } from "./fakeAvatar.js";

describe("AvatarClient dispatch", () => {
  it("passes every state command straight through, including repeats (dedup passthrough)", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "state", name: "SPEAKING", emotion: "warm" });
    client.dispatch({ type: "avatar", cmd: "state", name: "SPEAKING", emotion: "warm" });
    client.dispatch({ type: "avatar", cmd: "state", name: "SPEAKING", gaze: "USER" });

    // No client-side dedup: three messages in, three setState calls out —
    // a resend must still land (e.g. a gaze/emotion override on a repeat).
    expect(calls.setState).toHaveLength(3);
    expect(calls.setState[0]).toEqual({ name: "SPEAKING", o: { emotion: "warm", gaze: undefined } });
    expect(calls.setState[1]).toEqual({ name: "SPEAKING", o: { emotion: "warm", gaze: undefined } });
    expect(calls.setState[2]).toEqual({ name: "SPEAKING", o: { emotion: undefined, gaze: "USER" } });
  });

  it("routes interject and user commands straight through", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "interject", id: "OKAY" });
    client.dispatch({ type: "avatar", cmd: "user", speaking: true });
    client.dispatch({ type: "avatar", cmd: "user", speaking: false });

    expect(calls.interject).toEqual([{ id: "OKAY" }]);
    expect(calls.setUserSpeaking).toEqual([true, false]);
  });

  it("routes gesture to gesture(), never to interject()", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "gesture", id: "HI" });

    expect(calls.gesture).toEqual([{ id: "HI" }]);
    // The face half is the widget's business — a server asking for a gesture
    // must not also see an interjection dispatched behind its back.
    expect(calls.interject).toHaveLength(0);
  });

  it("ignores an unknown cmd silently — a newer server talking to an older widget", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    expect(() => client.dispatch({ type: "avatar", cmd: "future_thing", foo: 1 })).not.toThrow();

    // No widget method should have fired for an unrecognized cmd, and there is
    // deliberately no callback reporting it — see docs/removed.md.
    expect(calls.setState).toHaveLength(0);
    expect(calls.interject).toHaveLength(0);
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
    expect(() => client.dispatch({ cmd: "state", name: "SPEAKING" })).not.toThrow();
    // ...and so is a foreign envelope carrying one.
    expect(() => client.dispatch({ type: "llm", cmd: "state", name: "SPEAKING" })).not.toThrow();
    expect(calls.setState).toHaveLength(0);
  });

  it("routes a thrown widget error to onError instead of propagating", () => {
    const { api } = createFakeAvatar();
    api.setState = () => {
      throw new Error("unknown state");
    };
    const onError = vi.fn();
    const client = new AvatarClient(api, { onError });

    expect(() => client.dispatch({ type: "avatar", cmd: "state", name: "BOGUS" })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

});

describe("AvatarClient speech start/stop lifecycle", () => {
  it("buffers cues that arrive before speech start, then hands them to the first speak() call", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 1000 });

    // Cues arrive before the turn's clock is anchored.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "X" }, { t: 40, v: "B" }] });

    // Buffered, not yet handed to the widget.
    expect(calls.speak).toHaveLength(0);
    expect(calls.pushCues).toHaveLength(0);
    expect(client.turnCues).toEqual([{ t: 0, v: "X" }, { t: 40, v: "B" }]);

    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });

    expect(calls.speak).toHaveLength(1);
    expect(calls.speak[0].o?.cues).toEqual([{ t: 0, v: "X" }, { t: 40, v: "B" }]);
    expect(typeof calls.speak[0].o?.clock).toBe("function");
  });

  it("anchors the clock at the moment speech start is dispatched, not at construction", () => {
    let t = 500;
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => t });

    t = 5000;
    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
    const clock = calls.speak[0].o!.clock!;

    expect(clock()).toBe(0); // t0 == 5000, now() == 5000
    t = 5250;
    expect(clock()).toBe(250);
  });

  it("stop ends the named turn and clears it", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
    expect(client.turnCtx).toBe("turn-1");

    client.dispatch({ type: "avatar", cmd: "speech", event: "stop", ctx: "turn-1" });

    expect(calls.stopSpeaking).toBe(1);
    expect(client.turnCtx).toBeNull();
  });

  it("ignores a stale stop naming a superseded ctx, and does not cut off the newer turn", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-2" }); // supersedes turn-1
    client.dispatch({ type: "avatar", cmd: "speech", event: "stop", ctx: "turn-1" }); // stale

    expect(calls.stopSpeaking).toBe(0);
    expect(client.turnCtx).toBe("turn-2");
  });

  it("a new ctx on speech start supersedes an unfinished turn outright", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }] });
    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-2" });

    expect(client.turnCtx).toBe("turn-2");
    expect(client.turnCues).toEqual([]); // turn-1's buffered cues are gone with it
    expect(calls.speak[0].o?.cues).toEqual([]);
  });
});

describe("AvatarClient cue splice", () => {
  it("appends via the cheap pushCues path when from_ms doesn't reach into the queued track", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => 0 });

    // Buffered pre-start, then handed over as the turn's one speak() call —
    // see the lifecycle describe block for that behavior in isolation.
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 100, v: "B" }] });
    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
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
    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
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

    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
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

    client.dispatch({ type: "avatar", cmd: "speech", event: "start", ctx: "turn-1" });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 100, v: "B" }] });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 100, cues: [{ t: 100, v: "Z" }] });

    // t:100/"B" must be discarded (t >= from_ms) and replaced by t:100/"Z".
    expect(client.turnCues).toEqual([{ t: 0, v: "A" }, { t: 100, v: "Z" }]);
  });
});

describe("RTVI_EVENTS", () => {
  it("spells the one event name the real enum spells", async () => {
    // AvatarClient imports the enum type-only, so nothing above can catch a
    // rename — string enums are nominal, so the compiler will not compare a
    // literal against RTVIEvent either. This test is the check, and it belongs
    // here: the peer is a devDependency of the workspace and absent from what
    // we publish, which is the whole point of the literals.
    const { RTVIEvent } = await import("@pipecat-ai/client-js");

    expect(RTVI_EVENTS.serverMessage).toBe(RTVIEvent.ServerMessage);
  });
});
