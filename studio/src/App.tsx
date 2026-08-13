import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VISEME_LETTERS, VISEME_SHAPES, createAvatar } from "../../src/avatar.js";
import { FACES, FACE_NAMES, type FaceName } from "../../src/faces.js";
import { BehaviorController, BEHAVIOR_ACTION_IDS, type BehaviorStateId } from "../../src/behavior.js";
import { AvatarClient, RTVI_EVENTS, type AvatarPresenceState } from "../../client/src/AvatarClient.js";
import type { AvatarActionId, AvatarApi, Cue, CreateAvatarOptions, PoseOverrides, VisemeLetter } from "../../src/avatar.js";
import type { AvatarClaimCmd } from "../../client/src/types.js";

type Workspace = "rig" | "behavior" | "runtime" | "connection";
type EventName = (typeof RTVI_EVENTS)[keyof typeof RTVI_EVENTS];
type Listener = (...args: unknown[]) => void;
/**
 * One scripted moment in a trace. The union is per-`kind` so a fixture cannot
 * name a claim, action or letter the wire does not have — Studio drives the
 * production adapters, so a trace that typechecks is a trace the server could
 * actually send.
 */
type TraceEvent = { at: number; label: string } & (
  | { kind: "fact"; value: EventName }
  | { kind: "claim"; value: AvatarClaimCmd["state"] }
  | { kind: "action"; value: AvatarActionId }
  | { kind: "cues"; value: Cue[] }
);
type Trace = { id: string; name: string; description: string; duration: number; events: TraceEvent[]; audio?: string };
type Fixture = { id: string; text: string; voice: string; kind: string; ms: number; audio: string; tracks: Record<string, Cue[]> };
type PipecatLike = { on(event: string, listener: Listener): void; off(event: string, listener: Listener): void };

const cueSample: Cue[] = [{ t: 0, v: "X" }, { t: 120, v: "C", i: .8 }, { t: 300, v: "B" }, { t: 520, v: "D" }, { t: 780, v: "X" }];

// Viseme shapes come from the mixer, not from a copy here. Studio exists to
// review what ships; a second table would be reviewing the copy.

declare global {
  interface Window {
    avatarStudio?: {
      attachPipecat(client: PipecatLike): void;
      detachPipecat(): void;
    };
  }
}

const traces: Trace[] = [
  { id: "listen", name: "Available listener", description: "A quiet, connected call. The runtime earns compact idle after the cursor reaches four seconds.", duration: 6_000, events: [{ at: 0, kind: "fact", value: RTVI_EVENTS.connected, label: "Pipecat connected" }] },
  { id: "reply", name: "Normal spoken reply", description: "User turn → thinking claim → audio playout with cues → listening.", duration: 6_000, events: [
    { at: 0, kind: "fact", value: RTVI_EVENTS.userStartedSpeaking, label: "User started speaking" },
    { at: 1_400, kind: "fact", value: RTVI_EVENTS.userStoppedSpeaking, label: "User stopped speaking" },
    { at: 1_650, kind: "claim", value: "THINKING", label: "Server claim: thinking" },
    { at: 2_500, kind: "cues", value: cueSample, label: "Cue track buffered" },
    { at: 2_540, kind: "fact", value: RTVI_EVENTS.botStartedSpeaking, label: "Bot playout started" },
    { at: 4_800, kind: "fact", value: RTVI_EVENTS.botStoppedSpeaking, label: "Bot playout stopped" },
  ] },
  { id: "work", name: "Working on a request", description: "Server claim is durable until the explicit clear; bot playout still pre-empts it.", duration: 5_500, events: [
    { at: 0, kind: "fact", value: RTVI_EVENTS.userStartedSpeaking, label: "User started speaking" },
    { at: 900, kind: "fact", value: RTVI_EVENTS.userStoppedSpeaking, label: "User stopped speaking" },
    { at: 1_100, kind: "claim", value: "WORKING", label: "Server claim: working" },
    { at: 4_200, kind: "claim", value: null, label: "Server clears working" },
  ] },
  { id: "interrupt", name: "Interrupted reply", description: "The interruption action is deliberate; bot playout retains mouth authority until it actually stops.", duration: 4_800, events: [
    { at: 0, kind: "cues", value: cueSample, label: "Cue track buffered" },
    { at: 40, kind: "fact", value: RTVI_EVENTS.botStartedSpeaking, label: "Bot playout started" },
    { at: 1_400, kind: "action", value: "RESPONSE_INTERRUPTED", label: "Server action: interrupted" },
    { at: 1_720, kind: "fact", value: RTVI_EVENTS.botStoppedSpeaking, label: "Bot playout stopped" },
    { at: 1_750, kind: "fact", value: RTVI_EVENTS.userStartedSpeaking, label: "User started speaking" },
  ] },
];

const poseOptions: Array<{ id: string; label: string; pose: PoseOverrides }> = [
  { id: "rest", label: "Rest", pose: {} }, { id: "lids", label: "Lids closed", pose: { lidL: 1, lidR: 1 } },
  { id: "brows-up", label: "Brows up", pose: { browRaiseL: 1, browRaiseR: 1 } }, { id: "brows-down", label: "Brows down", pose: { browRaiseL: -1, browRaiseR: -1 } },
  { id: "yaw-left", label: "Yaw left", pose: { headYaw: -1 } }, { id: "yaw-right", label: "Yaw right", pose: { headYaw: 1 } },
  { id: "smile", label: "Smile", pose: { mouthCornerL: 1, mouthCornerR: 1, mouthWidth: .9 } }, { id: "frown", label: "Frown", pose: { mouthCornerL: -1, mouthCornerR: -1 } },
  { id: "open", label: "Open mouth", pose: { mouthOpen: .85, jaw: .6 } }, { id: "tongue", label: "Tongue", pose: { mouthOpen: .6, tongue: 1 } },
];

/** The hand clips, with review labels. Ids are wire action ids, not free text. */
const gestureClips: ReadonlyArray<readonly [AvatarActionId, string]> = [
  ["GESTURE_GREET", "Greet"], ["GESTURE_GOODBYE", "Farewell"], ["GESTURE_APPROVE", "Approve"], ["GESTURE_WAIT", "Wait"],
];

class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  on(event: string, listener: Listener) { const listeners = this.listeners.get(event) ?? new Set<Listener>(); listeners.add(listener); this.listeners.set(event, listeners); }
  off(event: string, listener: Listener) { this.listeners.get(event)?.delete(listener); }
  emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
}

/** The DOM hands back a `string`; this is where it becomes a face again. */
const isFaceName = (value: string): value is FaceName => (FACE_NAMES as readonly string[]).includes(value);

function createStudioAvatar(mount: HTMLElement, faceName: FaceName, options: Partial<CreateAvatarOptions> = {}) {
  return createAvatar({ ...options, mount, face: FACES[faceName] });
}

function workspaceFromHash(): Workspace {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("rig")) return "rig";
  if (hash === "behavior") return "behavior";
  if (hash === "connection") return "connection";
  return "runtime";
}

function useWorkspace(): [Workspace, (next: Workspace) => void] {
  const [workspace, setWorkspace] = useState(workspaceFromHash);
  useEffect(() => { const update = () => setWorkspace(workspaceFromHash()); window.addEventListener("hashchange", update); return () => window.removeEventListener("hashchange", update); }, []);
  const navigate = useCallback((next: Workspace) => { window.location.hash = `/${next}`; }, []);
  return [workspace, navigate];
}

function AvatarViewport({ avatarName, className = "", onReady }: { avatarName: FaceName; className?: string; onReady: (avatar: AvatarApi | null) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const avatar = createStudioAvatar(mount.current!, avatarName, { hand: true, gestureGain: 1.15, mouthGain: 1.08 });
    onReady(avatar);
    return () => { onReady(null); avatar.destroy(); };
  }, [avatarName, onReady]);
  return <div className={`avatar-viewport ${className}`}><div ref={mount} /></div>;
}

function PresenceBadge({ state }: { state: AvatarPresenceState }) {
  const labels: Record<AvatarPresenceState, string> = { IDLE: "Stepped aside", LISTENING: "Listening", THINKING: "Thinking", WORKING: "Working", SPEAKING: "Speaking", DEGRADED: "Connection issue", OFFLINE: "Offline" };
  return <span className={`presence-badge ${state.toLowerCase()}`}><i />{labels[state]}</span>;
}

function Timeline({ duration, cursor, events = [], tracks = [], onSeek }: { duration: number; cursor: number; events?: TraceEvent[]; tracks?: Array<{ label: string; start: number; end: number; tone?: string }>; onSeek?: (value: number) => void }) {
  const percent = Math.max(0, Math.min(100, (cursor / duration) * 100));
  return <section className="timeline" aria-label="Timeline">
    <div className="timeline-ruler"><span>0.0s</span><span>{(duration / 2_000).toFixed(1)}s</span><span>{(duration / 1_000).toFixed(1)}s</span></div>
    <div className="timeline-lanes">
      {tracks.map((track) => <div className="timeline-lane" key={track.label}><span>{track.label}</span><div className="timeline-track"><b className={track.tone ?? "blue"} style={{ left: `${(track.start / duration) * 100}%`, width: `${Math.max(2, ((track.end - track.start) / duration) * 100)}%` }} /></div></div>)}
      {events.length > 0 && <div className="timeline-lane"><span>Events</span><div className="timeline-track">{events.map((event) => <button title={`${(event.at / 1000).toFixed(2)}s · ${event.label}`} key={`${event.at}-${event.label}`} className={`timeline-event ${event.kind}`} style={{ left: `${(event.at / duration) * 100}%` }} onClick={() => onSeek?.(event.at)} />)}</div></div>}
    </div>
    <div className="timeline-scrub"><input aria-label="Timeline playhead" type="range" min="0" max={duration} step="25" value={cursor} onChange={(event) => onSeek?.(Number(event.target.value))} /><i style={{ left: `${percent}%` }} /></div>
  </section>;
}

function Library({ title, children }: { title: string; children: React.ReactNode }) { return <aside className="lab-library"><h2>{title}</h2>{children}</aside>; }
function Inspector({ title, children }: { title: string; children: React.ReactNode }) { return <aside className="lab-inspector"><h2>{title}</h2>{children}</aside>; }
function ButtonList({ children }: { children: React.ReactNode }) { return <div className="button-list">{children}</div>; }

function RigWorkspace({ avatarName }: { avatarName: FaceName }) {
  const [avatar, setAvatar] = useState<AvatarApi | null>(null);
  const [pose, setPose] = useState(poseOptions[0]);
  const [gesture, setGesture] = useState<AvatarActionId | null>(null);
  const [viseme, setViseme] = useState<VisemeLetter>("X");
  const [mode, setMode] = useState<"pose" | "viseme" | "gesture">("pose");
  useEffect(() => { if (!avatar) return; avatar.setOverrides(mode === "pose" ? (Object.keys(pose.pose).length ? pose.pose : null) : mode === "viseme" ? VISEME_SHAPES[viseme] : null); }, [avatar, mode, pose, viseme]);
  const runGesture = (id: AvatarActionId) => { setMode("gesture"); setGesture(id); avatar?.setOverrides(null); avatar?.action(id); };
  const title = mode === "pose" ? pose.label : mode === "viseme" ? `Viseme ${viseme}` : gesture?.replace("GESTURE_", "").toLowerCase() ?? "Gesture";
  return <LabFrame workspace="Rig review" subtitle="Direct renderer controls. A selected item is an inspection target, never hidden persistent application state." library={<><div className="library-section"><h3>Review mode</h3><ButtonList>{(["pose", "viseme", "gesture"] as const).map((item) => <button className={mode === item ? "selected" : ""} onClick={() => setMode(item)} key={item}>{item === "pose" ? "Pose extremes" : item === "viseme" ? "Visemes" : "Hand gestures"}</button>)}</ButtonList></div><div className="library-section"><h3>{mode === "pose" ? "Pose controls" : mode === "viseme" ? "Mouth alphabet" : "Gesture clips"}</h3><ButtonList>{mode === "pose" && poseOptions.map((item) => <button className={pose.id === item.id ? "selected" : ""} onClick={() => { setMode("pose"); setPose(item); }} key={item.id}>{item.label}</button>)}{mode === "viseme" && VISEME_LETTERS.map((item) => <button className={viseme === item ? "selected" : ""} onClick={() => { setMode("viseme"); setViseme(item); }} key={item}>{item}</button>)}{mode === "gesture" && gestureClips.map(([id, label]) => <button className={gesture === id ? "selected" : ""} onClick={() => runGesture(id)} key={id}>{label}</button>)}</ButtonList></div></>} inspector={<><p className="eyebrow">Inspection target</p><strong className="inspector-title">{title}</strong><p>{mode === "gesture" ? "Finite clip. It naturally returns to the selected neutral pose." : "Static, deterministic renderer frame. Select another target to compare."}</p><dl><dt>Authority</dt><dd>Rig adapter</dd><dt>Scope</dt><dd>Local preview only</dd><dt>Export</dt><dd>Review capture (next)</dd></dl></>}><AvatarViewport avatarName={avatarName} onReady={setAvatar} /><Timeline duration={1_400} cursor={mode === "gesture" && gesture ? 650 : 0} tracks={[{ label: "Inspection", start: 0, end: mode === "gesture" ? 1_200 : 1_400, tone: mode === "gesture" ? "amber" : "blue" }]} /></LabFrame>;
}

function BehaviorWorkspace({ avatarName }: { avatarName: FaceName }) {
  const [avatar, setAvatar] = useState<AvatarApi | null>(null);
  const controller = useRef<BehaviorController | null>(null);
  const [base, setBase] = useState<BehaviorStateId>("LISTENING");
  const [action, setAction] = useState<string | null>(null);
  useEffect(() => { if (!avatar) return; const next = new BehaviorController(avatar); controller.current = next; next.setState(base); return () => { next.destroy(); controller.current = null; }; }, [avatar]);
  useEffect(() => { controller.current?.setState(base); }, [base]);
  const playAction = (id: (typeof BEHAVIOR_ACTION_IDS)[number]) => { setAction(id); controller.current?.action(id); window.setTimeout(() => setAction(null), 1_700); };
  return <LabFrame workspace="Behavior composition" subtitle="States define the base track. Actions are finite clips layered above it; neither is a disguised runtime fact." library={<><div className="library-section"><h3>Base state</h3><ButtonList>{(["IDLE", "LISTENING", "THINKING", "WORKING", "SPEAKING", "DEGRADED", "OFFLINE"] as BehaviorStateId[]).map((id) => <button key={id} className={base === id ? "selected" : ""} onClick={() => setBase(id)}>{id}</button>)}</ButtonList></div><div className="library-section"><h3>Finite action</h3><ButtonList>{BEHAVIOR_ACTION_IDS.map((id) => <button key={id} onClick={() => playAction(id)}>{id}</button>)}</ButtonList></div></>} inspector={<><p className="eyebrow">Resolved behavior</p><strong className="inspector-title">{base}</strong><p>{"This is the durable base state. Select another base state to replace it at time zero."}</p><dl><dt>Base owner</dt><dd>Behavior library</dd><dt>Action in flight</dt><dd>{action ?? "None"}</dd><dt>Runtime wire</dt><dd>{base === "THINKING" || base === "WORKING" ? "Claim-compatible" : "Derived locally"}</dd></dl></>}><AvatarViewport avatarName={avatarName} onReady={setAvatar} /><Timeline duration={3_000} cursor={action ? 700 : 0} tracks={[{ label: "Base state", start: 0, end: 3_000, tone: "blue" }, ...(action ? [{ label: "Action", start: 120, end: 1_500, tone: "amber" }] : [])]} /></LabFrame>;
}

function RuntimeAvatar({ avatarName, trace, startAt, playing, onPresence, onEvent, onDone }: { avatarName: FaceName; trace: Trace; startAt: number; playing: boolean; onPresence: (state: AvatarPresenceState) => void; onEvent: (event: TraceEvent) => void; onDone: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bus = new EventBus();
    const avatar = createStudioAvatar(mount.current!, avatarName, { hand: true, gestureGain: 1.15, mouthGain: 1.08 });
    let now = 0;
    let timerId = 0;
    const virtualTimers = new Map<number, { due: number; callback: () => void }>();
    const liveTimers: number[] = [];
    const liveVirtualTimerIds = new Set<number>();
    const fireThrough = (target: number) => {
      for (;;) {
        const next = [...virtualTimers.entries()].filter(([, timer]) => timer.due <= target).sort(([, a], [, b]) => a.due - b.due)[0];
        if (!next) break;
        const [id, timer] = next;
        virtualTimers.delete(id);
        now = timer.due;
        timer.callback();
      }
      now = target;
    };
    const client = new AvatarClient(avatar, {
      idleDelayMs: 4_000,
      now: () => now,
      setTimeout: ((callback: () => void, delay = 0) => {
        const id = ++timerId;
        virtualTimers.set(id, { due: now + delay, callback });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: ((id: ReturnType<typeof setTimeout>) => { virtualTimers.delete(id as unknown as number); }) as unknown as typeof clearTimeout,
      onPresenceChange: onPresence,
    });
    const detach = client.attach(bus as never);
    const armLiveVirtualTimers = () => {
      virtualTimers.forEach((timer, id) => {
        if (liveVirtualTimerIds.has(id)) return;
        liveVirtualTimerIds.add(id);
        liveTimers.push(window.setTimeout(() => fireThrough(timer.due), Math.max(0, timer.due - startAt)));
      });
    };
    const apply = (event: TraceEvent, report = false) => {
      fireThrough(event.at);
      if (event.kind === "fact") bus.emit(event.value);
      if (event.kind === "claim") client.dispatch({ type: "avatar", cmd: "claim", state: event.value });
      if (event.kind === "action") client.dispatch({ type: "avatar", cmd: "action", id: event.value });
      if (event.kind === "cues") client.dispatch({ type: "avatar", cmd: "cues", ctx: `studio-${trace.id}`, from_ms: 0, cues: event.value, final: true });
      if (report) onEvent(event);
      if (playing) armLiveVirtualTimers();
    };
    bus.emit(RTVI_EVENTS.connected);
    // Connected is a factual frame at t=0; process the idle timer it arms as
    // part of the same deterministic reconstruction.
    fireThrough(startAt);
    trace.events.filter((event) => event.at <= startAt).forEach((event) => apply(event));
    fireThrough(startAt);
    const audio = playing && trace.audio ? new Audio(`/${trace.audio}`) : null;
    if (audio) {
      audio.preload = "auto";
      audio.currentTime = Math.min(startAt / 1_000, Math.max(0, audio.duration || startAt / 1_000));
      void audio.play().catch(() => undefined);
    }
    if (playing) {
      armLiveVirtualTimers();
      trace.events.filter((event) => event.at > startAt).forEach((event) => liveTimers.push(window.setTimeout(() => apply(event, true), event.at - startAt)));
      liveTimers.push(window.setTimeout(onDone, Math.max(0, trace.duration - startAt)));
    }
    return () => { audio?.pause(); liveTimers.forEach(window.clearTimeout); detach(); client.destroy(); avatar.destroy(); };
  }, [avatarName, onDone, onEvent, onPresence, playing, startAt, trace]);
  return <div className="avatar-viewport runtime-avatar"><div ref={mount} /></div>;
}

function RuntimeWorkspace({ avatarName }: { avatarName: FaceName }) {
  const [traceId, setTraceId] = useState(traces[1].id);
  const [fixtureTrace, setFixtureTrace] = useState<Trace | null>(null);
  const trace = fixtureTrace?.id === traceId ? fixtureTrace : traces.find((item) => item.id === traceId) ?? traces[0];
  const [cursor, setCursor] = useState(0);
  const [runStart, setRunStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const [presence, setPresence] = useState<AvatarPresenceState>("LISTENING");
  const [lastEvent, setLastEvent] = useState<TraceEvent | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  useEffect(() => { void fetch("/eval-clips.json").then((response) => response.ok ? response.json() as Promise<Fixture[]> : []).then(setFixtures).catch(() => setFixtures([])); }, []);
  const seek = (value: number) => { setPlaying(false); setCursor(value); setRunStart(value); setRun((n) => n + 1); };
  const play = () => { setRunStart(cursor); setPlaying(true); setRun((n) => n + 1); };
  const chooseTrace = (id: string) => { if (!id.startsWith("fixture-")) setFixtureTrace(null); setTraceId(id); setCursor(0); setRunStart(0); setPlaying(false); setLastEvent(null); setRun((n) => n + 1); };
  const done = useCallback(() => { setPlaying(false); setCursor(trace.duration); }, [trace.duration]);
  const event = useCallback((item: TraceEvent) => setLastEvent(item), []);
  const chooseFixture = (fixture: Fixture) => {
    const fixtureTrace: Trace = { id: `fixture-${fixture.id}`, name: fixture.id, description: `Checked-in audio · “${fixture.text}” · ${fixture.voice} · phonetic cue track.`, duration: Math.ceil(fixture.ms + 460), audio: fixture.audio, events: [
      { at: 0, kind: "cues", value: fixture.tracks.phonetic ?? fixture.tracks.sphinx ?? [], label: "Fixture cue track buffered" },
      { at: 10, kind: "fact", value: RTVI_EVENTS.botStartedSpeaking, label: "Fixture audio started" },
      { at: Math.ceil(fixture.ms), kind: "fact", value: RTVI_EVENTS.botStoppedSpeaking, label: "Fixture audio stopped" },
    ] };
    setFixtureTrace(fixtureTrace);
    chooseTrace(fixtureTrace.id);
  };
  useEffect(() => {
    if (!playing) return;
    const wallStart = performance.now();
    const timer = window.setInterval(() => setCursor(Math.min(trace.duration, runStart + performance.now() - wallStart)), 40);
    return () => window.clearInterval(timer);
  }, [playing, runStart, trace.duration]);
  return (
    <LabFrame
      workspace="Runtime traces"
      subtitle="Every run is reconstructed from time zero. The playhead is the source of truth; there is no hidden state to reset."
      library={<>
        <div className="library-section"><h3>Trace library</h3><ButtonList>{traces.map((item) => <button className={item.id === trace.id ? "selected" : ""} key={item.id} onClick={() => chooseTrace(item.id)}><b>{item.name}</b><small>{(item.duration / 1000).toFixed(1)}s · {item.events.length} events</small></button>)}</ButtonList></div>
        <div className="library-section"><h3>Audio fixtures</h3><ButtonList>{fixtures.slice(0, 5).map((fixture) => <button key={fixture.id} onClick={() => chooseFixture(fixture)}><b>{fixture.text}</b><small>{fixture.voice} · {Math.round(fixture.ms)}ms</small></button>)}</ButtonList></div>
        <div className="library-section"><h3>Playback</h3><div className="transport"><button onClick={() => seek(0)}>↺ Start</button><button className="primary" onClick={play}>{playing ? "Restart from cursor" : cursor >= trace.duration ? "Run again" : "Play from cursor"}</button></div></div>
      </>}
      inspector={<>
        <p className="eyebrow">Resolver output</p><PresenceBadge state={presence} /><p>{trace.description}</p>
        <dl><dt>Playhead</dt><dd>{(cursor / 1000).toFixed(2)}s / {(trace.duration / 1000).toFixed(2)}s</dd><dt>Last input</dt><dd>{lastEvent?.label ?? "Connected baseline"}</dd><dt>Precedence</dt><dd>Speech {">"} listening {">"} claims {">"} idle</dd></dl>
        <div className="inspector-note">Compact idle is derived after four seconds of quiet in Studio. Move the playhead or run an input trace to evaluate its exit.</div>
      </>}
    >
      <RuntimeAvatar key={`${avatarName}:${trace.id}:${run}`} avatarName={avatarName} trace={trace} startAt={runStart} playing={playing} onPresence={setPresence} onEvent={event} onDone={done} />
      <Timeline duration={trace.duration} cursor={cursor} events={trace.events} tracks={[{ label: "Resolved state", start: 0, end: trace.duration, tone: "blue" }, ...trace.events.filter((event) => event.kind === "action").map((item) => ({ label: "Action", start: item.at, end: Math.min(trace.duration, item.at + 1_250), tone: "amber" })), ...trace.events.filter((event) => event.kind === "cues").map((item) => ({ label: "Speech cues", start: item.at, end: Math.min(trace.duration, item.at + 2_200), tone: "green" }))]} onSeek={seek} />
    </LabFrame>
  );
}

function LiveAvatar({ avatarName, onAttached }: { avatarName: FaceName; onAttached: (attached: boolean) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const avatar = createStudioAvatar(mount.current!, avatarName, { hand: true, gestureGain: 1.15, mouthGain: 1.08 });
    let detach: (() => void) | null = null;
    const attachPipecat = (client: PipecatLike) => { detach?.(); detach = new AvatarClient(avatar).attach(client as never); onAttached(true); };
    const detachPipecat = () => { detach?.(); detach = null; onAttached(false); };
    window.avatarStudio = { attachPipecat, detachPipecat };
    return () => { detachPipecat(); delete window.avatarStudio; avatar.destroy(); };
  }, [avatarName, onAttached]);
  return <div className="avatar-viewport runtime-avatar"><div ref={mount} /></div>;
}

function ConnectionWorkspace({ avatarName }: { avatarName: FaceName }) {
  const [attached, setAttached] = useState(false);
  return (
    <LabFrame
      workspace="Live session bridge"
      subtitle="Attach a host-created stock Pipecat client after deterministic review. Studio never stores or constructs a transport from secrets."
      library={<>
        <div className="library-section"><h3>Session source</h3><ButtonList><button className={!attached ? "selected" : ""}>Awaiting host client</button><button className={attached ? "selected" : ""} disabled={!attached}>Attached Pipecat client</button></ButtonList></div>
        <div className="library-section"><h3>Session control</h3><div className="transport"><button disabled={!attached} onClick={() => window.avatarStudio?.detachPipecat()}>Detach client</button></div></div>
      </>}
      inspector={<>
        <p className="eyebrow">Integration contract</p><strong className="inspector-title">{attached ? "Client attached" : "Host-created client"}</strong>
        <p>Pipecat is transport-neutral. The deployment owns construction; Studio only binds its factual lifecycle and <code>serverMessage</code> channel to the exact production controller.</p>
        <pre>window.avatarStudio.attachPipecat(pipecatClient)</pre><dl><dt>Persisted secrets</dt><dd>Never</dd><dt>Transport</dt><dd>Host-owned</dd><dt>Avatar messages</dt><dd>RTVI serverMessage</dd></dl>
      </>}
    >
      <LiveAvatar avatarName={avatarName} onAttached={setAttached} />
      <Timeline duration={3_000} cursor={0} tracks={[{ label: "Live session", start: 0, end: 3_000, tone: attached ? "green" : "muted" }]} />
    </LabFrame>
  );
}

function LabFrame({ workspace, subtitle, library, inspector, children }: { workspace: string; subtitle: string; library: React.ReactNode; inspector: React.ReactNode; children: React.ReactNode }) {
  const parts = Array.isArray(children) ? children : [children];
  return <div className="lab-frame"><section className="lab-heading"><p className="eyebrow">{workspace}</p><h1>{workspace}</h1><p>{subtitle}</p></section><div className="lab-grid"><Library title="Library">{library}</Library><main className="lab-stage"><div className="stage-toolbar"><span>Review canvas</span><span className="stage-toolbar-note">1× tile framing</span></div>{parts[0]}{parts[1]}</main><Inspector title="Inspector">{inspector}</Inspector></div></div>;
}

export function App() {
  const [workspace, navigate] = useWorkspace();
  const [avatarName, setAvatarName] = useState(FACE_NAMES[0]);
  return <div className="studio-app"><header className="studio-header"><div className="brand"><strong>Avatar Studio</strong><span>Animation review and runtime trace lab</span></div><nav aria-label="Workspace">{(["rig", "behavior", "runtime", "connection"] as Workspace[]).map((item) => <button className={workspace === item ? "active" : ""} key={item} onClick={() => navigate(item)}>{item === "rig" ? "Rig" : item === "behavior" ? "Behavior" : item === "runtime" ? "Runtime" : "Connect"}</button>)}</nav><label className="avatar-picker"><span>Avatar</span><select value={avatarName} onChange={(event) => { if (isFaceName(event.target.value)) setAvatarName(event.target.value); }}>{FACE_NAMES.map((item) => <option key={item}>{item}</option>)}</select></label></header>{workspace === "rig" && <RigWorkspace avatarName={avatarName} />}{workspace === "behavior" && <BehaviorWorkspace avatarName={avatarName} />}{workspace === "runtime" && <RuntimeWorkspace avatarName={avatarName} />}{workspace === "connection" && <ConnectionWorkspace avatarName={avatarName} />}</div>;
}
