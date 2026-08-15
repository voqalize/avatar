/**
 * Avatar Studio — the avatar on a live call, and the wire that drives it.
 *
 * Studio imports `@voqalize/avatar` and nothing else from this repo. Not
 * `src/avatar.js`, not `client/src/AvatarClient.js`, not `@voqalize/avatar/internal`
 * — the published entry point, the three published faces, and the wire format as
 * documented. That is the point of it: if a thing cannot be done here, a
 * consumer cannot do it either, and the gap is a defect in the package rather
 * than a reason to reach past it.
 *
 * Two routes, and the difference is who is looking:
 *
 * - `#/`     the face on a real call, with the option surface of `createAvatar`.
 * - `#/wire` the same call, plus what the server is sending and the controls to
 *            make it send something — including something wrong.
 *
 * The call is owned here, above the routes, so navigating between them does not
 * hang up.
 */

import { useCallback, useEffect, useState } from "react";
import { useCall } from "./call";
import { DEFAULT_LOOK, type Look } from "./look";
import { Options } from "./Options";
import { Stage } from "./Stage";
import { WireLog } from "./WireLog";
import { Drive } from "./Drive";

type Route = "call" | "wire";

const ROUTES: ReadonlyArray<readonly [Route, string]> = [
  ["call", "Call"],
  ["wire", "Wire"],
];

const routeFromHash = (): Route => (window.location.hash.replace(/^#\/?/, "") === "wire" ? "wire" : "call");

function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const update = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return [route, useCallback((next: Route) => { window.location.hash = next === "call" ? "/" : "/wire"; }, [])];
}

const LABEL: Record<ReturnType<typeof useCall>["status"], string> = {
  offline: "offline",
  connecting: "connecting…",
  live: "live",
  error: "error",
};

export function App() {
  const [route, go] = useRoute();
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [compare, setCompare] = useState(false);
  const call = useCall();
  const live = call.status === "live";

  return (
    <div className="studio">
      <header className="bar">
        <div className="brand">
          <strong>Avatar Studio</strong>
          <span>@voqalize/avatar, on a live pipecat call</span>
        </div>
        <nav aria-label="View">
          {ROUTES.map(([id, label]) => (
            <button key={id} className={route === id ? "active" : ""} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
        <div className="call-controls">
          <span className={`status ${call.status}`}>{LABEL[call.status]}</span>
          <button
            className={live ? "hang" : "go"}
            disabled={call.status === "connecting"}
            onClick={() => void (live ? call.hangUp() : call.connect())}
          >
            {live ? "End call" : "Start call"}
          </button>
        </div>
      </header>

      {call.detail && <p className="banner">{call.detail}</p>}

      <main className={`layout ${route}`}>
        <Stage client={call.client} look={look} compare={compare} />
        {route === "call" ? (
          <aside className="panel">
            <Options look={look} compare={compare} onLook={setLook} onCompare={setCompare} />
            <p className="muted">
              Microphone required; the bot speaks first. It runs on <code>server/</code>,
              which needs no credential — <code>cd py && uv run --group server python ../server/server.py</code>.
            </p>
          </aside>
        ) : (
          <aside className="panel">
            <section className="options">
              <h2>Drive the call</h2>
              <Drive live={live} onProblem={call.problem} />
            </section>
            <WireLog log={call.log} onClear={call.clearLog} />
          </aside>
        )}
      </main>

      {/* The bot's voice arrives as a track on the transport; the avatar is
          mute by itself and lipsyncs to whatever this element is playing. */}
      <audio ref={call.audio} autoPlay />
    </div>
  );
}
