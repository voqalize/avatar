import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarClient, RTVI_EVENTS, VISUAL_LEAD_MS as LEAD } from "../client/AvatarClient.js";
import { createFakeAvatar } from "./fakeAvatar.js";
import { parseAvatarCommand } from "../client/types.js";

describe("AvatarClient dispatch", () => {
  it("accepts a durable lower-priority server state", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    client.dispatch({ type: "avatar", cmd: "state", state: "THINKING" });
    client.dispatch({ type: "avatar", cmd: "state", state: "WORKING" });
    client.dispatch({ type: "avatar", cmd: "state", state: null });

    expect(calls.setState).toHaveLength(3);
    expect(calls.setState.map(({ name }) => name)).toEqual(["THINKING", "WORKING", "LISTENING"]);
  });

  it("routes every one-shot motion through action(), core or the avatar's own", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    // One command, one method, whether the id is an intent every renderer owes
    // a server or a name out of the mounted avatar's own catalogue. There is
    // nothing to name a rendering independently of the face.
    client.dispatch({ type: "avatar", cmd: "action", id: "ACKNOWLEDGE" });
    client.dispatch({ type: "avatar", cmd: "action", id: "NOD_REALIZE" });

    expect(calls.action).toEqual([{ id: "ACKNOWLEDGE" }, { id: "NOD_REALIZE" }]);
  });

  it("passes an action id it has never heard of, because only the avatar knows", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    // The protocol deliberately does not hold a list. Validating here would
    // make the wire know every renderer's catalogue — so the parse is shape-only
    // and the mixer no-ops on a name it does not have.
    client.dispatch({ type: "avatar", cmd: "action", id: "SOMETHING_ONLY_A_FUTURE_FACE_HAS" });

    expect(calls.action).toEqual([{ id: "SOMETHING_ONLY_A_FUTURE_FACE_HAS" }]);
  });

  it("drops a malformed action id rather than forwarding it", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    for (const id of ["nod_small", "", "NOD SMALL", "N", "../etc", 7, null]) {
      client.dispatch({ type: "avatar", cmd: "action", id } as never);
    }

    expect(calls.action, "shape is still checked even though the name is not").toEqual([]);
  });

  it("still answers the pre-rename `sequence` command, as an action", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    // `sequence` was a second command for exactly this: a name resolved against
    // the mounted avatar. Now that `action` is that, a server older than the
    // merge keeps working — and only the parse boundary knows the old spelling.
    client.dispatch({ type: "avatar", cmd: "sequence", id: "NOD_NO" });

    expect(calls.action).toEqual([{ id: "NOD_NO" }]);
  });

  it("ignores an unknown cmd silently — a newer server talking to an older widget", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    expect(() => client.dispatch({ type: "avatar", cmd: "future_thing", foo: 1 })).not.toThrow();

    // No widget method should have fired for an unrecognized cmd, and there is
    // deliberately no callback reporting it.
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
    expect(() => client.dispatch({ cmd: "state", state: "THINKING" })).not.toThrow();
    // ...and so is a foreign envelope carrying one.
    expect(() => client.dispatch({ type: "llm", cmd: "state", state: "THINKING" })).not.toThrow();
    expect(calls.setState).toHaveLength(0);
  });

  it("routes a thrown widget error to onError instead of propagating", () => {
    const { api } = createFakeAvatar();
    api.action = () => {
      throw new Error("unknown state");
    };
    const onError = vi.fn();
    const client = new AvatarClient(api, { onError });

    expect(() => client.dispatch({ type: "avatar", cmd: "action", id: "ACK_NOD" })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("drops a command outside the vocabulary rather than handing it to the widget", () => {
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api);

    // A newer server naming a state or a letter this build does not have. Each
    // is dropped at the parse boundary — which is what lets every type below it
    // be a closed union. An action id is *not* in this list: that vocabulary is
    // open, so an unknown name is a legal message and is dropped by the face
    // rather than by the wire.
    client.dispatch({ type: "avatar", cmd: "state", state: "BRAINSTORMING" });
    expect(calls.setState).toHaveLength(0);

    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "A" }, { t: 50, v: "Z" }, { t: 100, v: "B" }] });
    // The unreadable cue drops; the utterance around it survives.
    expect(client.turnCues).toEqual([{ t: 0, v: "A" }, { t: 100, v: "B" }]);
  });

});

describe("AvatarClient Pipecat-bound cue lifecycle", () => {
  it("keeps a cue's phone label, and rejects one that is not a name", () => {
    // `p` is deliberately not checked against a list: the set belongs to
    // whatever recognised the audio. Bounded as an identifier is the whole
    // check, so an unheard-of label survives and a payload does not.
    const cmd = parseAvatarCommand({
      type: "avatar",
      cmd: "cues",
      ctx: "c1",
      from_ms: 0,
      cues: [
        { t: 0, v: "B", p: "TH" },
        { t: 10, v: "E", p: "Schwa" },
        { t: 20, v: "A", p: "P!" },
        { t: 30, v: "X" },
      ],
    });
    expect(cmd?.cmd).toBe("cues");
    expect((cmd as { cues: { p?: string }[] }).cues.map((c) => c.p)).toEqual([
      "TH",
      "Schwa",
      undefined,
      undefined,
    ]);
  });

  it("buffers cues by base-TTS context, then starts the FIFO context at bot output", () => {
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

    expect(clock()).toBe(LEAD); // t0 == 5000, now() == 5000
    t = 5250;
    expect(clock()).toBe(250 + LEAD);
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

describe("AvatarClient playout anchor", () => {
  // The event and the sound reach the browser by different roads, measured on
  // both sides of each other. These pin that the sound wins when it can be
  // heard, and that the event still anchors the turn when it cannot.
  function setup(onset: () => number | null | undefined) {
    vi.useFakeTimers({ now: 10_000 });
    const probe = { onset: vi.fn(onset), dispose: vi.fn() };
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => Date.now(), playoutProbe: probe });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues: [{ t: 0, v: "X" }, { t: 60, v: "B" }] });
    (client as any).onBotStartedSpeaking();
    return { client, calls, probe, clock: calls.speak[0]!.o!.clock! };
  }

  it("backdates the turn's zero to audio that began before the event", () => {
    const { clock } = setup(() => 9_943);
    expect(clock()).toBe(57 + LEAD);
    vi.useRealTimers();
  });

  it("holds the mouth before the first cue until the sound begins", () => {
    let heard: number | null = null;
    const { clock } = setup(() => heard);
    expect(clock()).toBeLessThan(0);
    vi.advanceTimersByTime(150);
    expect(clock()).toBeLessThan(0);

    heard = 10_160;
    vi.advanceTimersByTime(20);
    expect(clock()).toBe(10 + LEAD);
    vi.useRealTimers();
  });

  it("anchors at the event when the probe cannot say", () => {
    const { clock } = setup(() => undefined);
    expect(clock()).toBe(LEAD);
    vi.useRealTimers();
  });

  it("falls back to the event, and stops asking a probe that has never heard the track", () => {
    const { client, calls, probe, clock } = setup(() => null);
    vi.advanceTimersByTime(400);
    expect(clock()).toBe(400 + LEAD); // zero is the event, not the timeout
    expect(probe.dispose).toHaveBeenCalledOnce();

    const asked = probe.onset.mock.calls.length;
    (client as any).onBotStoppedSpeaking();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-2", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    expect(calls.speak.at(-1)!.o!.clock!()).toBe(LEAD);
    expect(probe.onset.mock.calls.length).toBe(asked);
    vi.useRealTimers();
  });

  it("stops listening for a turn that ends before its sound arrives", () => {
    const { client, probe } = setup(() => null);
    vi.advanceTimersByTime(30);
    (client as any).onBotStoppedSpeaking();
    const asked = probe.onset.mock.calls.length;
    vi.advanceTimersByTime(400);
    expect(probe.onset.mock.calls.length).toBe(asked);
    vi.useRealTimers();
  });
});

describe("AvatarClient hears the bot track it is given", () => {
  // SmallWebRTC hands the bot's track to `trackStarted` and nowhere else —
  // `tracks()` lists local media only. Reading `tracks()` alone meant no probe
  // on that transport, and every turn anchored on the event.
  function withAudio() {
    const sources: MediaStreamTrack[][] = [];
    class FakeContext {
      state = "running";
      outputLatency = 0;
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource(s: { tracks: MediaStreamTrack[] }) {
        sources.push(s.tracks);
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData() {} }; }
    }
    class FakeStream { constructor(public tracks: MediaStreamTrack[]) {} }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("MediaStream", FakeStream);
    const listeners = new Map<string, (...args: any[]) => void>();
    const pc = {
      on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); },
      off(event: string) { listeners.delete(event); },
      tracks: () => ({ local: {} }),
    };
    const client = new AvatarClient(createFakeAvatar().api);
    client.attach(pc as never);
    const started = (...args: unknown[]) => listeners.get(RTVI_EVENTS.trackStarted)?.(...args);
    return { sources, started };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("listens to the remote audio track the event carries", () => {
    const { sources, started } = withAudio();
    const bot = { kind: "audio", id: "bot" } as MediaStreamTrack;
    started(bot);
    expect(sources).toEqual([[bot]]);
    started(bot);
    expect(sources).toHaveLength(1);
  });

  it("does not mistake the user's microphone or a video track for the bot", () => {
    const { sources, started } = withAudio();
    started({ kind: "audio", id: "mic" }, { local: true });
    started({ kind: "video", id: "cam" });
    expect(sources).toEqual([]);
  });
});

describe("AvatarClient mouth lead and re-anchor", () => {
  type Probe = { onset: () => number | null | undefined; outputLatencyMs?: () => number };
  function start(probe: Probe, cues = [{ t: 0, v: "X" }, { t: 60, v: "B" }]) {
    vi.useFakeTimers({ now: 10_000 });
    const full = { dispose: vi.fn(), resume: vi.fn(), ...probe, onset: vi.fn(probe.onset) };
    const { api, calls } = createFakeAvatar();
    const client = new AvatarClient(api, { now: () => Date.now(), playoutProbe: full });
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 0, cues });
    (client as any).onBotStartedSpeaking();
    return { client, calls, probe: full, clock: calls.speak[0]!.o!.clock! };
  }

  it("runs the mouth ahead of the sound by what the smoothing will cost it", () => {
    const { clock } = start({ onset: () => 9_943, outputLatencyMs: () => 20 });
    expect(clock()).toBe(57 + LEAD);
    vi.useRealTimers();
  });

  it("holds the mouth back for an output device slower than the display", () => {
    // 200 ms reported, 40 of which the display matches.
    const { clock } = start({ onset: () => 9_943, outputLatencyMs: () => 200 });
    expect(clock()).toBe(57 + LEAD - 160);
    vi.useRealTimers();
  });

  it("does not trust an absurd latency report", () => {
    const { clock } = start({ onset: () => 9_943, outputLatencyMs: () => 5_000 });
    expect(clock()).toBe(57 + LEAD - 250);
    vi.useRealTimers();
  });

  it("asks a suspended audio graph to run at every turn", () => {
    const { client, probe } = start({ onset: () => undefined });
    (client as any).onBotStoppedSpeaking();
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-2", from_ms: 0, cues: [] });
    (client as any).onBotStartedSpeaking();
    expect(probe.resume).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // Speech at 0, a pause from 400 to 900, speech again at 900.
  const PAUSED = [{ t: 0, v: "B" }, { t: 400, v: "X" }, { t: 900, v: "C" }, { t: 1300, v: "X" }];

  it("re-anchors where the sound resumes late after a pause, slewing instead of jumping", () => {
    let heard: number | null | undefined = 10_000;
    const { clock } = start({ onset: () => heard }, PAUSED);
    expect(clock()).toBe(LEAD);

    // The track says speech resumes at 10_900; the server ran dry, and it is
    // heard 170 ms later — past anything the track's own anticipation explains.
    heard = null;
    vi.advanceTimersByTime(1_065);
    clock();
    heard = 11_070;
    vi.advanceTimersByTime(15);
    const before = clock();
    vi.advanceTimersByTime(100);
    const step = clock() - before;
    // Slowed, not stopped: at most 10% off real time.
    expect(step).toBeGreaterThanOrEqual(90);
    expect(step).toBeLessThan(100);

    vi.advanceTimersByTime(1_500);
    clock();
    vi.advanceTimersByTime(10);
    // Fully absorbed: the track's 900 now sits where a resumption is usually
    // heard before its sound — 30 ms ahead of 11_070.
    expect(clock()).toBe(Date.now() - 10_140 + LEAD);
    vi.useRealTimers();
  });

  it("keeps the clock where the sound resumes within the track's usual anticipation of it", () => {
    // A mouth opens before its sound: 105 ms after the cue is still on time.
    let heard: number | null | undefined = 10_000;
    const { clock } = start({ onset: () => heard }, PAUSED);
    heard = null;
    vi.advanceTimersByTime(990);
    heard = 11_005;
    vi.advanceTimersByTime(1_010);
    expect(clock()).toBe(2_000 + LEAD);
    vi.useRealTimers();
  });

  it("re-anchors where the sound resumes before the track says it does", () => {
    let heard: number | null | undefined = 10_000;
    const { clock } = start({ onset: () => heard }, PAUSED);
    heard = null;
    vi.advanceTimersByTime(990);
    heard = 10_840; // 60 ms before the cue: the clock is late
    vi.advanceTimersByTime(1_500);
    clock();
    vi.advanceTimersByTime(10);
    expect(clock()).toBe(Date.now() - 9_910 + LEAD);
    vi.useRealTimers();
  });

  it("leaves the clock alone where the pause was not silence on the wire", () => {
    let heard: number | null | undefined = 10_000;
    const { clock } = start({ onset: () => heard }, PAUSED);
    heard = undefined;
    vi.advanceTimersByTime(2_000);
    expect(clock()).toBe(2_000 + LEAD);
    vi.useRealTimers();
  });

  it("ignores a sound too far from where the track expects it", () => {
    let heard: number | null | undefined = 10_000;
    const { clock } = start({ onset: () => heard }, PAUSED);
    heard = null;
    vi.advanceTimersByTime(990);
    heard = 10_600; // 300 ms early: some other sound, not this resumption
    vi.advanceTimersByTime(1_000);
    expect(clock()).toBe(1_990 + LEAD);
    vi.useRealTimers();
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
    client.dispatch({ type: "avatar", cmd: "cues", ctx: "turn-1", from_ms: 100, cues: [{ t: 100, v: "E" }] });

    // t:100/"B" must be discarded (t >= from_ms) and replaced by t:100/"E".
    expect(client.turnCues).toEqual([{ t: 0, v: "A" }, { t: 100, v: "E" }]);
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
    expect(RTVI_EVENTS.trackStarted).toBe(RTVIEvent.TrackStarted);
    expect(RTVI_EVENTS.userMuteStarted).toBe(RTVIEvent.UserMuteStarted);
    expect(RTVI_EVENTS.userMuteStopped).toBe(RTVIEvent.UserMuteStopped);
  });

  // `remoteAudioLevel` was subscribed only to relay a gain to a host waveform.
  // Nothing in the projection ever read it, so the subscription was pure cost
  // on a high-frequency event. Assert it stays gone.
  it("does not subscribe to anything the projection does not use", () => {
    const events = new Set<string>();
    new AvatarClient(createFakeAvatar().api)
      .attach({ on(event: string) { events.add(event); }, off() {} } as never);

    expect(events.has("remoteAudioLevel")).toBe(false);
  });
});

describe("AvatarClient projection", () => {
  it("resolves back to listening once playout ends", () => {
    const fake = createFakeAvatar();
    const presence: string[] = [];
    const adapter = new AvatarClient(fake.api, { onPresenceChange: (state) => presence.push(state) });
    const listeners = new Map<string, (...args: any[]) => void>();
    adapter.attach({ on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); }, off() {} } as never);

    listeners.get(RTVI_EVENTS.botStartedSpeaking)?.();
    listeners.get(RTVI_EVENTS.botStoppedSpeaking)?.();

    expect(presence).toContain("SPEAKING");
    expect(adapter.presenceState).toBe("LISTENING");
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

  it("uses Pipecat user speech for listening and server states for the lower ones", () => {
    const { calls, emit } = attached();

    emit(RTVI_EVENTS.userStartedSpeaking);
    emit(RTVI_EVENTS.userStoppedSpeaking);

    expect(calls.setUserSpeaking).toEqual([true, false]);
    expect(calls.setState.map((call) => call.name)).toEqual(["LISTENING"]);
  });

  it("makes bot speech win over user VAD and every server state", () => {
    const { calls, emit, adapter } = attached();

    adapter.dispatch({ type: "avatar", cmd: "state", state: "WORKING" });
    emit(RTVI_EVENTS.botStartedSpeaking);
    emit(RTVI_EVENTS.userStartedSpeaking);

    expect(calls.setState.map((call) => call.name)).toEqual(["WORKING", "SPEAKING"]);
  });

  it("keeps observed speech above a concurrent recoverable failure", () => {
    const { calls, emit } = attached();

    emit(RTVI_EVENTS.error, { data: { fatal: false } });
    emit(RTVI_EVENTS.botStartedSpeaking);

    // Starting bot output clears a recoverable failure first; before any session
    // activity the safe baseline is available/listening, not stepped aside.
    // The important precedence invariant is the final SPEAKING projection.
    expect(calls.setState.map((call) => call.name)).toEqual(["DEGRADED", "LISTENING", "SPEAKING"]);
  });

  it("uses the bot-output interval as a mouth safety stop and returns to listening", () => {
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

  it("starts available and earns idle only after a connected quiet interval", () => {
    vi.useFakeTimers();
    const fake = createFakeAvatar();
    const adapter = new AvatarClient(fake.api, { idleDelayMs: 600 });
    const listeners = new Map<string, (...args: any[]) => void>();
    adapter.attach({ on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); }, off() {} } as never);

    expect(adapter.presenceState).toBe("LISTENING");
    expect(fake.calls.setState).toEqual([]);
    listeners.get(RTVI_EVENTS.connected)?.();
    expect(fake.calls.setState.at(-1)?.name).toBe("LISTENING");
    vi.advanceTimersByTime(599);
    expect(adapter.presenceState).toBe("LISTENING");
    vi.advanceTimersByTime(1);
    expect(adapter.presenceState).toBe("IDLE");
    vi.useRealTimers();
  });

  it("renders a mute strategy without the server sending anything", () => {
    // "Has muted you" needs no wire verb: Pipecat's mute frames reach the
    // browser client as ordinary events, so the fact arrives with the same
    // authority as the speech states above it.
    const { calls, emit } = attached();

    emit(RTVI_EVENTS.userMuteStarted);
    expect(calls.setState.at(-1)?.name).toBe("MUTED");

    emit(RTVI_EVENTS.userMuteStopped);
    expect(calls.setState.at(-1)?.name).toBe("LISTENING");
  });

  it("does not let a mute quietly earn idle underneath itself", () => {
    vi.useFakeTimers();
    const fake = createFakeAvatar();
    const adapter = new AvatarClient(fake.api, { idleDelayMs: 600 });
    const listeners = new Map<string, (...args: any[]) => void>();
    adapter.attach({ on(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); }, off() {} } as never);

    listeners.get(RTVI_EVENTS.connected)?.();
    listeners.get(RTVI_EVENTS.userMuteStarted)?.();
    vi.advanceTimersByTime(5_000);
    // The silence was imposed, so it buys nothing: unmuting reveals an
    // available avatar, not one that stepped aside while it could not hear.
    listeners.get(RTVI_EVENTS.userMuteStopped)?.();
    expect(adapter.presenceState).toBe("LISTENING");
    vi.useRealTimers();
  });

  it("renders a CANT_HEAR below speech and above thinking's silence", () => {
    const { calls, emit, adapter } = attached();

    adapter.dispatch({ type: "avatar", cmd: "state", state: "CANT_HEAR" });
    expect(calls.setState.at(-1)?.name).toBe("CANT_HEAR");

    // Precedence among the server's three is the server's, since only one can
    // be in flight; what this side owes is that observed speech still outranks
    // it.
    emit(RTVI_EVENTS.userStartedSpeaking);
    expect(calls.setState.at(-1)?.name).toBe("LISTENING");
  });

  it("still answers the pre-rename `claim` command and STRAINING, as CANT_HEAR", () => {
    // A server older than the rename is the case the translation exists for,
    // and the only place it may live is the parse boundary: nothing above it
    // knows the old spelling, so this is the one test that can prove the
    // acceptance is still wired.
    const { calls, adapter } = attached();

    adapter.dispatch({ type: "avatar", cmd: "claim", state: "STRAINING" });
    expect(calls.setState.at(-1)?.name).toBe("CANT_HEAR");
  });

  it("plays an acknowledgement only when the backend sends its explicit action", () => {
    const { calls, adapter } = attached();
    adapter.dispatch({ type: "avatar", cmd: "action", id: "ACKNOWLEDGE" });

    expect(calls.action).toEqual([{ id: "ACKNOWLEDGE" }]);
  });
});
