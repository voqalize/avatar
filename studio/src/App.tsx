import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTION_IDS, AVATAR_NAMES, STATE_NAMES, VISEME_LETTERS, createAvatar } from "../../src/avatar.js";
import { BehaviorController, BEHAVIOR_ACTION_IDS, BEHAVIOR_STATE_IDS } from "../../src/behavior.js";
import { AvatarClient, RTVI_EVENTS } from "../../client/src/AvatarClient.js";
import type { AvatarApi } from "../../src/avatar.js";

type Route = "rig/review" | "rig/visemes" | "rig/gestures" | "behavior" | "wire" | "fixtures" | "connection";
type EventName = (typeof RTVI_EVENTS)[keyof typeof RTVI_EVENTS];
type Listener = (...args: unknown[]) => void;

interface Fixture {
  id: string;
  text: string;
  voice: string;
  kind: string;
  ms: number;
  audio: string;
  tracks: Record<string, Cue[]>;
}

interface Cue { t: number; v: string; i?: number }
interface LogItem { id: number; at: string; source: string; detail: string }
interface ConnectionProfile {
  endpoint: string;
  token: string;
  headers: string;
  request: string;
}
interface StudioApi {
  avatar: AvatarApi | null;
  log(source: string, detail: unknown): void;
  dispatch(message: unknown): void;
  emit(event: EventName): void;
  playFixture(fixture: Fixture, track: string): void;
  stopFixture(): void;
  behavior: BehaviorController | null;
}

const STORAGE_KEY = "voqalize.avatar-studio.connection.v1";
const routes: Array<{ id: Route; label: string; description: string }> = [
  { id: "rig/review", label: "Rig review", description: "Parameters + extremes" },
  { id: "rig/visemes", label: "Rig visemes", description: "Shapes + transitions" },
  { id: "rig/gestures", label: "Gesture review", description: "Hand-frame filmstrips" },
  { id: "behavior", label: "Behavior", description: "States + actions" },
  { id: "wire", label: "Wire Lab", description: "Protocol + lifecycle" },
  { id: "fixtures", label: "Fixtures", description: "Audio + visemes" },
  { id: "connection", label: "Connection", description: "Real service setup" },
];
const stateNames = STATE_NAMES as string[];
const actionIds = ACTION_IDS as readonly string[];

const sampleCues: Cue[] = [
  { t: 0, v: "X" }, { t: 80, v: "C", i: 0.7 }, { t: 230, v: "B", i: 1 },
  { t: 460, v: "E", i: 0.85 }, { t: 690, v: "X" },
];

// Kept beside the Studio instead of importing a second JS implementation into
// TypeScript. This is intentionally the public, full-intensity shape table;
// the live mixer continues to use `shapeFor()` for every actual utterance.
const visemeShapes: Record<string, Record<string, number>> = {
  X: { mouthOpen: .02, mouthWidth: .42, mouthRound: .10, mouthPress: .15, mouthTuck: 0, teethUpper: 0, tongue: 0, jaw: .014 },
  A: { mouthOpen: 0, mouthWidth: .40, mouthRound: .18, mouthPress: .55, mouthTuck: 0, teethUpper: 0, tongue: 0, jaw: 0 },
  B: { mouthOpen: .16, mouthWidth: .54, mouthRound: .05, mouthPress: .10, mouthTuck: 0, teethUpper: .75, tongue: 0, jaw: .112 },
  C: { mouthOpen: .45, mouthWidth: .58, mouthRound: .05, mouthPress: 0, mouthTuck: 0, teethUpper: .45, tongue: 0, jaw: .315 },
  D: { mouthOpen: .85, mouthWidth: .52, mouthRound: .02, mouthPress: 0, mouthTuck: 0, teethUpper: .25, tongue: .15, jaw: .595 },
  E: { mouthOpen: .34, mouthWidth: .28, mouthRound: .55, mouthPress: 0, mouthTuck: 0, teethUpper: .15, tongue: 0, jaw: .238 },
  F: { mouthOpen: .22, mouthWidth: .10, mouthRound: .95, mouthPress: .10, mouthTuck: 0, teethUpper: 0, tongue: 0, jaw: .154 },
  G: { mouthOpen: .20, mouthWidth: .46, mouthRound: .10, mouthPress: .40, mouthTuck: 1, teethUpper: 1, tongue: 0, jaw: .14 },
  H: { mouthOpen: .40, mouthWidth: .48, mouthRound: .05, mouthPress: 0, mouthTuck: 0, teethUpper: .35, tongue: .90, jaw: .28 },
};
const visemeShape = (letter: string) => visemeShapes[letter] ?? visemeShapes.X;

class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  on(event: string, listener: Listener): void {
    const group = this.listeners.get(event) ?? new Set<Listener>();
    group.add(listener);
    this.listeners.set(event, group);
  }
  off(event: string, listener: Listener): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string, ...args: unknown[]): void { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
}

function routeFromHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  // Studio shipped briefly with hyphenated rig routes. Keep old bookmarks
  // working, but make the route hierarchy visible in URLs and documentation.
  const candidate = (raw === "rig-review" ? "rig/review" : raw === "rig-visemes" ? "rig/visemes" : raw === "rig-gestures" ? "rig/gestures" : raw) as Route;
  return routes.some((route) => route.id === candidate) ? candidate : "rig/review";
}

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route) => { window.location.hash = `/${next}`; }, []);
  return [route, navigate];
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function readProfile(): ConnectionProfile {
  const fallback: ConnectionProfile = { endpoint: "", token: "", headers: "{}", request: "{}" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch { return fallback; }
}

declare global {
  interface Window {
    avatarStudio?: {
      attachPipecat(client: { on(event: string, listener: Listener): void; off(event: string, listener: Listener): void }): void;
      detachPipecat(): void;
      dispatch(message: unknown): void;
    };
  }
}

export function App() {
  const [route, navigate] = useRoute();
  const [avatarName, setAvatarName] = useState(AVATAR_NAMES[0]);
  const [avatar, setAvatar] = useState<AvatarApi | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [externalAttached, setExternalAttached] = useState(false);
  const bus = useRef(new EventBus());
  const controller = useRef<AvatarClient | null>(null);
  const behaviorController = useRef<BehaviorController | null>(null);
  const externalClient = useRef<{ on(event: string, listener: Listener): void; off(event: string, listener: Listener): void } | null>(null);
  const externalDetach = useRef<(() => void) | null>(null);
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  const log = useCallback((source: string, detail: unknown) => {
    setLogs((items) => [{ id: Date.now() + Math.random(), at: new Date().toLocaleTimeString(), source, detail: pretty(detail) }, ...items].slice(0, 80));
  }, []);

  const ready = useCallback((next: AvatarApi | null, nextController: AvatarClient | null) => {
    externalDetach.current?.();
    externalDetach.current = null;
    controller.current = nextController;
    behaviorController.current?.destroy();
    behaviorController.current = next ? new BehaviorController(next) : null;
    if (nextController && externalClient.current) {
      externalDetach.current = nextController.attach(externalClient.current as never);
    }
    setAvatar(next);
  }, []);

  const emit = useCallback((event: EventName) => {
    bus.current.emit(event);
    log("Pipecat", event);
  }, [log]);

  const dispatch = useCallback((message: unknown) => {
    controller.current?.dispatch(message);
    log("avatar wire", message);
  }, [log]);

  const stopFixture = useCallback(() => {
    if (!currentAudio.current) return;
    currentAudio.current.pause();
    currentAudio.current.currentTime = 0;
    currentAudio.current = null;
    emit(RTVI_EVENTS.botStoppedSpeaking);
  }, [emit]);

  const playFixture = useCallback((fixture: Fixture, track: string) => {
    stopFixture();
    const ctx = `studio-${fixture.id}-${Date.now()}`;
    dispatch({ type: "avatar", cmd: "cues", ctx, from_ms: 0, cues: fixture.tracks[track] ?? [], final: true });
    emit(RTVI_EVENTS.botStartedSpeaking);
    const audio = new Audio(`/${fixture.audio}`);
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      if (currentAudio.current === audio) currentAudio.current = null;
      emit(RTVI_EVENTS.botStoppedSpeaking);
    }, { once: true });
    audio.addEventListener("error", () => {
      log("fixture", `Unable to play ${fixture.audio}`);
      emit(RTVI_EVENTS.botStoppedSpeaking);
    }, { once: true });
    currentAudio.current = audio;
    void audio.play().catch((error: unknown) => log("fixture", `Browser blocked playback: ${String(error)}`));
  }, [dispatch, emit, log, stopFixture]);

  const attachPipecat = useCallback((client: { on(event: string, listener: Listener): void; off(event: string, listener: Listener): void }) => {
    externalDetach.current?.();
    externalClient.current = client;
    externalDetach.current = controller.current?.attach(client as never) ?? null;
    setExternalAttached(Boolean(externalDetach.current));
    log("connection", "Attached an externally constructed Pipecat client");
  }, [log]);

  const detachPipecat = useCallback(() => {
    externalDetach.current?.();
    externalDetach.current = null;
    externalClient.current = null;
    setExternalAttached(false);
    log("connection", "Detached external Pipecat client");
  }, [log]);

  useEffect(() => {
    window.avatarStudio = { attachPipecat, detachPipecat, dispatch };
    return () => { delete window.avatarStudio; externalDetach.current?.(); };
  }, [attachPipecat, detachPipecat, dispatch]);

  const api = useMemo<StudioApi>(() => ({ avatar, log, dispatch, emit, playFixture, stopFixture, behavior: behaviorController.current }), [avatar, dispatch, emit, log, playFixture, stopFixture]);

  return <div className="studio-shell">
    <header className="topbar">
      <div><strong>Avatar Studio</strong><span>Avatar authoring and integration workbench</span></div>
      <label className="avatar-select"><span>Avatar under review</span>
        <select value={avatarName} onChange={(event) => setAvatarName(event.target.value)}>
          {AVATAR_NAMES.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
    </header>
    <aside className="nav">
      {routes.map((item) => <button key={item.id} className={route === item.id ? "selected" : ""} onClick={() => navigate(item.id)}>
        <strong>{item.label}</strong><small>{item.description}</small>
      </button>)}
      <div className="nav-foot">Production envelope<br /><code>{"{ type: 'avatar' }"}</code></div>
    </aside>
    <main className="workspace">
      {route === "rig/review" && <RigReviewRoute {...api} avatarName={avatarName} />}
      {route === "rig/visemes" && <RigVisemesRoute {...api} avatarName={avatarName} />}
      {route === "rig/gestures" && <RigGesturesRoute {...api} avatarName={avatarName} />}
      {route === "behavior" && <BehaviorRoute {...api} />}
      {route === "wire" && <WireRoute {...api} />}
      {route === "fixtures" && <FixturesRoute {...api} />}
      {route === "connection" && <ConnectionRoute attached={externalAttached} attach={attachPipecat} detach={detachPipecat} log={log} />}
    </main>
    <aside className="stage-column">
      <AvatarStage avatarName={avatarName} bus={bus.current} onReady={ready} />
      <div className="event-log"><div className="section-title"><span>Event log</span><button onClick={() => setLogs([])}>Clear</button></div>
        {logs.length === 0 ? <p className="empty">Events and commands will appear here.</p> : logs.map((item) => <div className="log-row" key={item.id}><time>{item.at}</time><b>{item.source}</b><span>{item.detail}</span></div>)}
      </div>
    </aside>
  </div>;
}

function AvatarStage({ avatarName, bus, onReady }: { avatarName: string; bus: EventBus; onReady: (avatar: AvatarApi | null, client: AvatarClient | null) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const api = createAvatar({ mount: mount.current!, avatar: avatarName, hand: true, gestureGain: 1.15, mouthGain: 1.08 });
    const client = new AvatarClient(api, { idleDelayMs: 12_000 });
    const detach = client.attach(bus as never);
    onReady(api, client);
    return () => { detach(); client.destroy(); api.destroy(); onReady(null, null); };
  }, [avatarName, bus, onReady]);
  return <section className="stage"><div ref={mount} className="avatar-mount" /><div className="stage-caption">Live runtime · {avatarName}</div></section>;
}

function RigFrame({ avatarName, pose, label }: { avatarName: string; pose: Record<string, number>; label: string }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const api = createAvatar({ mount: mount.current!, avatar: avatarName, hand: false, manual: true, motionGain: 0 });
    api.setOverrides(Object.keys(pose).length ? pose : null);
    // A fixed settle gives every card the same renderer result: no idle or
    // live clock is involved in author review.
    for (let t = 0; t < .42; t += 1 / 60) api.step(1 / 60);
    return () => api.destroy();
  }, [avatarName, pose]);
  return <figure className="rig-frame"><div ref={mount} className="rig-frame-art" /><figcaption>{label}</figcaption></figure>;
}

const gestureReviews = [
  { id: "GESTURE_GREET", label: "Greet", duration: 1250 },
  { id: "GESTURE_GOODBYE", label: "Farewell", duration: 1550 },
  { id: "GESTURE_APPROVE", label: "Approve", duration: 1300 },
  { id: "GESTURE_WAIT", label: "Wait", duration: 1700 },
] as const;

function GestureFrame({ avatarName, id, at, label }: { avatarName: string; id: string; at: number; label: string }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const api = createAvatar({ mount: mount.current!, avatar: avatarName, hand: true, manual: true, motionGain: 0 });
    api.action(id);
    for (let elapsed = 0; elapsed < at / 1000; elapsed += 1 / 60) api.step(1 / 60);
    return () => api.destroy();
  }, [avatarName, id, at]);
  return <figure className="rig-frame"><div ref={mount} className="rig-frame-art gesture-frame-art" /><figcaption>{label}</figcaption></figure>;
}

function RigReviewRoute({ avatar, log, avatarName }: Pick<StudioApi, "avatar" | "log"> & { avatarName: string }) {
  const extremes: Array<[string, Record<string, number>]> = [
    ["Rest", {}], ["Lids closed", { lidL: 1, lidR: 1 }], ["Squint", { squintL: 1, squintR: 1 }],
    ["Brows up", { browRaiseL: 1, browRaiseR: 1 }], ["Brows down", { browRaiseL: -1, browRaiseR: -1 }],
    ["Yaw left", { headYaw: -1 }], ["Yaw right", { headYaw: 1 }], ["Pitch down", { headPitch: 1 }],
    ["Smile", { mouthCornerL: 1, mouthCornerR: 1, mouthWidth: .9 }], ["Frown", { mouthCornerL: -1, mouthCornerR: -1 }],
    ["Teeth", { mouthOpen: .5, teethUpper: 1 }], ["Tongue", { mouthOpen: .6, tongue: 1 }],
    ["Stress composite", { headPitch: .9, squintL: .9, squintR: .9, browRaiseL: -1, browRaiseR: -1, mouthOpen: .85 }],
  ];
  const [selected, setSelected] = useState("Rest");
  return <section className="route"><h1>Rig review</h1><p className="lede">The review sheet is the author’s first gate: compare every critical extreme at once, then send one frame to the live runtime for closer inspection. These are raw renderer controls, not conversational states.</p>
    <ControlGroup title="Extreme review sheet"><p className="hint">Look for silhouette breaks, collisions, and controls that are too subtle to read at tile size.</p><div className="rig-frame-grid">{extremes.map(([name, pose]) => <button className={`rig-frame-button ${selected === name ? "active" : ""}`} key={name} onClick={() => { setSelected(name); avatar?.setOverrides(Object.keys(pose).length ? pose : null); log("rig frame", name); }}><RigFrame avatarName={avatarName} pose={pose} label={name} /></button>)}</div></ControlGroup>
    <ControlGroup title="Selected frame"><div className="inline-controls"><strong>{selected}</strong><button disabled={!avatar} onClick={() => avatar?.setOverrides(null)}>Clear raw frame</button><button disabled={!avatar} onClick={() => avatar?.setState("IDLE")}>Return to live idle</button></div></ControlGroup>
    <ControlGroup title="Hand framing"><p className="hint">Hands are a first-class rig surface. These exercise the semantic hand frame plus the matching face motion; judge whether the silhouette stays readable and the hand remains attached to the body.</p><div className="button-grid compact">{[
      ["GESTURE_GREET", "Greet"], ["GESTURE_GOODBYE", "Farewell"], ["GESTURE_APPROVE", "Approve"], ["GESTURE_WAIT", "Wait"],
    ].map(([id, label]) => <button key={id} disabled={!avatar} onClick={() => { avatar?.setOverrides(null); avatar?.action(id); log("rig hand", id); }}>{label}<small>{id}</small></button>)}</div></ControlGroup>
    <ControlGroup title="Control surface"><p className="hint">Live values after smoothing. This is diagnostic evidence, not a primary authoring UI.</p><div className="channel-list">{Object.entries(avatar?.params ?? {}).map(([name, value]) => <span key={name}><code>{name}</code> {value.toFixed(2)}</span>)}</div></ControlGroup>
  </section>;
}

function RigVisemesRoute({ avatar, log, avatarName }: Pick<StudioApi, "avatar" | "log"> & { avatarName: string }) {
  const timer = useRef<number | null>(null);
  const play = (letters: string[], dwell = 220) => {
    if (!avatar) return;
    if (timer.current) window.clearTimeout(timer.current);
    let index = 0;
    const next = () => {
      const letter = letters[index++];
      if (!letter) { avatar.setOverrides(null); return; }
      avatar.setOverrides({ ...avatar.params, ...visemeShape(letter) });
      timer.current = window.setTimeout(next, dwell);
    };
    log("viseme sequence", letters.join(" → "));
    next();
  };
  const transitions: Array<[string, string[]]> = [["Closure", ["X", "A", "X"]], ["Open vowel", ["A", "D", "A"]], ["Rounded", ["D", "F", "B"]], ["Contacts", ["B", "G", "H"]], ["Rapid closures", ["A", "B", "A", "D", "A", "G", "A", "X"]]];
  return <section className="route"><h1>Rig visemes</h1><p className="lede">First review the complete mouth alphabet at a glance. Then run the transitions that expose weak closures, shape bleed, or poor co-articulation through the live runtime.</p>
    <ControlGroup title="Viseme review sheet"><div className="rig-frame-grid viseme-grid">{VISEME_LETTERS.map((letter) => <button className="rig-frame-button" key={letter} disabled={!avatar} onClick={() => play([letter], 1_500)}><RigFrame avatarName={avatarName} pose={visemeShape(letter)} label={letter} /></button>)}</div></ControlGroup>
    <ControlGroup title="Curated transitions"><div className="button-grid">{transitions.map(([name, letters]) => <button key={name} disabled={!avatar} onClick={() => play([...letters])}>{name}<small>{letters.join(" → ")}</small></button>)}</div></ControlGroup>
    <ControlGroup title="Reset"><button disabled={!avatar} onClick={() => { if (timer.current) window.clearTimeout(timer.current); avatar?.setOverrides(null); }}>Clear viseme frame</button></ControlGroup>
  </section>;
}

function RigGesturesRoute({ avatar, log, avatarName }: Pick<StudioApi, "avatar" | "log"> & { avatarName: string }) {
  const [selected, setSelected] = useState<string>(gestureReviews[0].id);
  const current = gestureReviews.find((gesture) => gesture.id === selected) ?? gestureReviews[0];
  const sampleTimes = [0, .18, .36, .54, .72, .88, 1].map((progress) => Math.round(current.duration * progress));
  return <section className="route"><h1>Gesture review</h1><p className="lede">A gesture has to survive as a sequence, not just a flattering endpoint. Review its entry, readable hold, and exit side by side before allowing it into behavior or wire controls.</p>
    <ControlGroup title="Choose a gesture"><div className="button-grid compact">{gestureReviews.map((gesture) => <button className={selected === gesture.id ? "active" : ""} key={gesture.id} onClick={() => setSelected(gesture.id)}>{gesture.label}<small>{gesture.id}</small></button>)}</div></ControlGroup>
    <ControlGroup title={`${current.label} · frame filmstrip`}><p className="hint">Each image is a deterministic sample from the real hand and face timelines. Look first for an instantly readable silhouette, then for finger collisions, clipping, and mouth occlusion.</p><div className="rig-frame-grid gesture-grid">{sampleTimes.map((at) => <button className="rig-frame-button" key={at} disabled={!avatar} onClick={() => { avatar?.action(current.id); log("gesture preview", `${current.id} at ${at}ms`); }}><GestureFrame avatarName={avatarName} id={current.id} at={at} label={`${at} ms`} /></button>)}</div></ControlGroup>
    <ControlGroup title="Live playback"><div className="inline-controls"><button disabled={!avatar} onClick={() => { avatar?.action(current.id); log("gesture", current.id); }}>Play {current.label}</button><span className="hint">The live stage remains visible while this page scrolls.</span></div></ControlGroup>
  </section>;
}

function BehaviorRoute({ behavior, avatar, log }: Pick<StudioApi, "behavior" | "avatar" | "log">) {
  return <section className="route"><h1>Behavior library</h1><p className="lede">States are durable and may run programs. Actions are finite, self-completing physical sequences layered over the current state. None of these controls claim to be server-supported.</p>
    <ControlGroup title="Durable behavior states"><div className="button-grid">{BEHAVIOR_STATE_IDS.slice(0, 7).map((state) => <button key={state} disabled={!behavior} onClick={() => { behavior?.setState(state); log("behavior state", state); }}>{state}</button>)}</div></ControlGroup>
    <ControlGroup title="Library actions"><div className="button-grid">{BEHAVIOR_ACTION_IDS.map((id) => <button key={id} disabled={!behavior} onClick={() => { behavior?.action(id); log("behavior action", id); }}>{id}</button>)}</div></ControlGroup>
    <ControlGroup title="Underlying mixer"><p className="hint">For legacy/rendering diagnosis only; these are not the behavior or wire contract.</p><div className="inline-controls"><button disabled={!avatar} onClick={() => avatar?.blink()}>Blink</button><span>{stateNames.length} legacy renderer states · {actionIds.length} promoted wire actions</span></div></ControlGroup>
  </section>;
}

function WireRoute({ dispatch, emit, log }: Pick<StudioApi, "dispatch" | "emit" | "log">) {
  const [claim, setClaim] = useState<"THINKING" | "WORKING" | "">("");
  const [raw, setRaw] = useState('{\n  "type": "avatar",\n  "cmd": "action",\n  "id": "ACK_RECEIVE"\n}');
  const run = (name: string, frames: Array<{ wait: number; message?: unknown; event?: EventName }>) => {
    log("scenario", name);
    let at = 0;
    frames.forEach((frame) => { at += frame.wait; window.setTimeout(() => { if (frame.message) dispatch(frame.message); if (frame.event) emit(frame.event); }, at); });
  };
  return <section className="route"><h1>Wire Lab</h1><p className="lede">The production commands are only <code>claim</code>, <code>action</code>, and correlated <code>cues</code>. Pipecat lifecycle facts are emitted separately below.</p>
    <ControlGroup title="Server claims"><div className="inline-controls"><select value={claim} onChange={(event) => setClaim(event.target.value as typeof claim)}><option value="">Clear claim</option><option>THINKING</option><option>WORKING</option></select><button onClick={() => dispatch({ type: "avatar", cmd: "claim", state: claim || null })}>Send claim</button></div></ControlGroup>
    <ControlGroup title="Server actions"><div className="button-grid compact">{actionIds.map((id) => <button key={id} onClick={() => dispatch({ type: "avatar", cmd: "action", id })}>{id}</button>)}</div></ControlGroup>
    <ControlGroup title="Pipecat factual lifecycle"><p className="hint">Speaking audio wins projection. User audio alone never silences the avatar's mouth.</p><div className="button-grid compact">{[
      RTVI_EVENTS.connected, RTVI_EVENTS.userStartedSpeaking, RTVI_EVENTS.userStoppedSpeaking,
      RTVI_EVENTS.botStartedSpeaking, RTVI_EVENTS.botStoppedSpeaking, RTVI_EVENTS.disconnected,
    ].map((event) => <button key={event} onClick={() => emit(event)}>{event}</button>)}</div></ControlGroup>
    <ControlGroup title="Scenarios"><div className="inline-controls">
      <button onClick={() => run("Normal response", [{ wait: 0, event: RTVI_EVENTS.userStartedSpeaking }, { wait: 700, event: RTVI_EVENTS.userStoppedSpeaking }, { wait: 180, message: { type: "avatar", cmd: "claim", state: "THINKING" } }, { wait: 650, message: { type: "avatar", cmd: "cues", ctx: `normal-${Date.now()}`, from_ms: 0, cues: sampleCues, final: true } }, { wait: 20, event: RTVI_EVENTS.botStartedSpeaking }, { wait: 1_000, event: RTVI_EVENTS.botStoppedSpeaking }])}>Normal response</button>
      <button onClick={() => { const ctx = `splice-${Date.now()}`; run("Cue splice", [{ wait: 0, message: { type: "avatar", cmd: "cues", ctx, from_ms: 0, cues: sampleCues } }, { wait: 20, event: RTVI_EVENTS.botStartedSpeaking }, { wait: 320, message: { type: "avatar", cmd: "cues", ctx, from_ms: 230, cues: [{ t: 230, v: "F", i: 1 }, { t: 520, v: "X" }], final: true } }, { wait: 720, event: RTVI_EVENTS.botStoppedSpeaking }]); }}>Cue splice</button>
      <button onClick={() => run("Interrupted response", [{ wait: 0, message: { type: "avatar", cmd: "cues", ctx: `interrupt-${Date.now()}`, from_ms: 0, cues: sampleCues } }, { wait: 10, event: RTVI_EVENTS.botStartedSpeaking }, { wait: 350, message: { type: "avatar", cmd: "action", id: "RESPONSE_INTERRUPTED" } }, { wait: 180, event: RTVI_EVENTS.botStoppedSpeaking }])}>Interrupted response</button>
    </div></ControlGroup>
    <ControlGroup title="Raw server message"><textarea value={raw} onChange={(event) => setRaw(event.target.value)} spellCheck={false} /><div className="inline-controls"><button onClick={() => { try { dispatch(JSON.parse(raw)); } catch (error) { log("wire", `Invalid JSON: ${String(error)}`); } }}>Dispatch JSON</button><button onClick={() => setRaw(JSON.stringify({ type: "avatar", cmd: "cues", ctx: "test-turn", from_ms: 0, cues: sampleCues, final: true }, null, 2))}>Load cues sample</button></div></ControlGroup>
  </section>;
}

function FixturesRoute({ playFixture, stopFixture, log }: Pick<StudioApi, "playFixture" | "stopFixture" | "log">) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [track, setTrack] = useState("phonetic");
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/eval-clips.json").then((response) => { if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json() as Promise<Fixture[]>; }).then((items) => { setFixtures(items); setSelectedId((current) => current || items[0]?.id || ""); }).catch((reason: unknown) => setError(String(reason))); }, []);
  const index = Math.max(0, fixtures.findIndex((fixture) => fixture.id === selectedId));
  const selected = fixtures[index];
  const move = (by: number) => { if (!fixtures.length) return; setSelectedId(fixtures[(index + by + fixtures.length) % fixtures.length].id); };
  return <section className="route"><h1>Fixture playback</h1><p className="lede">Checked-in audio is played through the same cue/lifecycle path as a real response. Select either generated cue track for visual comparison.</p>
    {error && <p className="error">Could not load fixtures: {error}</p>}
    {selected && <>
      <ControlGroup title={`Fixture ${index + 1} of ${fixtures.length}`}><div className="fixture-picker"><button onClick={() => move(-1)}>Previous</button><label>Choose fixture<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{fixtures.map((fixture, fixtureIndex) => <option value={fixture.id} key={fixture.id}>{fixtureIndex + 1}. {fixture.id}</option>)}</select></label><button onClick={() => move(1)}>Next</button></div><p className="fixture-prompt">{selected.text}</p><div className="inline-controls"><label>Cue track <select value={track} onChange={(event) => setTrack(event.target.value)}><option value="phonetic">phonetic</option><option value="sphinx">sphinx</option></select></label><button disabled={!selected.tracks[track]} onClick={() => { playFixture(selected, track); log("fixture", `${selected.id} / ${track}`); }}>Play selected</button><button onClick={stopFixture}>Stop</button></div><details className="fixture-details"><summary>Fixture details</summary><p><code>{selected.id}</code> · {selected.voice} · {Math.round(selected.ms)} ms · {selected.tracks[track]?.length ?? 0} cues</p></details></ControlGroup>
    </>}
  </section>;
}

function ConnectionRoute({ attached, attach, detach, log }: { attached: boolean; attach: (client: { on(event: string, listener: Listener): void; off(event: string, listener: Listener): void }) => void; detach: () => void; log: (source: string, detail: unknown) => void }) {
  const [profile, setProfile] = useState<ConnectionProfile>(readProfile);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");
  const update = (key: keyof ConnectionProfile, value: string) => setProfile((current) => ({ ...current, [key]: value }));
  const save = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); setSaved(true); log("connection", "Connection profile saved in this browser"); };
  const testEndpoint = async () => {
    if (!profile.endpoint) { setStatus("Enter an HTTP(S) endpoint first."); return; }
    try {
      const headers = JSON.parse(profile.headers || "{}") as Record<string, string>;
      if (profile.token) headers.Authorization ??= `Bearer ${profile.token}`;
      const body = JSON.parse(profile.request || "{}");
      const response = await fetch(profile.endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      setStatus(`Endpoint returned ${response.status} ${response.statusText}`);
    } catch (error) { setStatus(`Endpoint test failed: ${String(error)}`); }
  };
  return <section className="route"><h1>Connection</h1><p className="lede">Profiles stay in this browser only. They are never bundled, sent by Studio, or committed to the repository.</p>
    <ControlGroup title="Backend profile"><label>Endpoint<input type="url" placeholder="https://your-service.example/start" value={profile.endpoint} onChange={(event) => update("endpoint", event.target.value)} /></label><label>Token / API key<input type="password" autoComplete="off" value={profile.token} onChange={(event) => update("token", event.target.value)} /></label><label>Additional headers (JSON)<textarea value={profile.headers} onChange={(event) => update("headers", event.target.value)} spellCheck={false} /></label><label>Start request body (JSON)<textarea value={profile.request} onChange={(event) => update("request", event.target.value)} spellCheck={false} /></label><div className="inline-controls"><button onClick={save}>Save locally</button><button onClick={() => void testEndpoint()}>Test endpoint</button>{saved && <span className="ok">Saved</span>}</div>{status && <p className="hint">{status}</p>}</ControlGroup>
    <ControlGroup title="Attach a real Pipecat client"><p>Stock <code>@pipecat-ai/client-js</code> is transport-neutral, so a connection URL alone is insufficient to construct the client. Once a host adapter creates its actual Pipecat client, attach it here:</p><pre>{"window.avatarStudio.attachPipecat(pipecatClient)"}</pre><p className="hint">Attached clients feed standard lifecycle events plus <code>serverMessage</code> directly into the production controller.</p><div className="inline-controls"><span className={attached ? "ok" : "muted"}>{attached ? "Client attached" : "No client attached"}</span><button disabled={!attached} onClick={detach}>Detach</button></div></ControlGroup>
  </section>;
}

function ControlGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section className="control-group"><h2>{title}</h2>{children}</section>; }
