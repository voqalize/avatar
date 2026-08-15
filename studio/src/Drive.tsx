/**
 * Driving the call by hand — and misdriving it on purpose.
 *
 * Every control here is an HTTP request to the *server*, never a message this
 * page composes. The server owns intent: a page that could make the avatar nod
 * on its own would be a client deciding what the agent is doing, which is the
 * one thing this project does not allow. So what lands in the wire log is what
 * the server sent, which is how you tell a command the face ignored from one
 * that never arrived.
 *
 * The vocabularies come from `GET /api/lines` rather than from a list here.
 * They live in the Python package, and a button list that had drifted from them
 * would be a UI testing a wire format that no longer exists.
 *
 * The misbehaviours are the part worth the code. The authority model
 * (docs/pipecat-lifecycle-protocol.md) is a claim about the *renderer* —
 * observed playout outranks server intent — and until these existed nothing in
 * the repo exercised it: every message the server sent was well-formed and sent
 * at the right moment. Each one names what should happen, because a deliberately
 * wrong message is worthless unless you know what the face is supposed to do
 * about it.
 */

import { useEffect, useState } from "react";

interface Line {
  id: string;
  tag: string;
  text: string;
  ms: number;
}

interface Corpus {
  lines: Line[];
  claims: string[];
  actions: string[];
  /** kind → what to watch for. */
  misbehaviours: Record<string, string>;
}

/** The vocabulary prefixes are what group the actions; the verb is what you press. */
const verb = (action: string) => action.replace(/^(ACK|GESTURE|RESPONSE)_/, "").toLowerCase();

export function Drive({ live, onProblem }: { live: boolean; onProblem: (text: string) => void }) {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [line, setLine] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lines")
      .then((r) => (r.ok ? (r.json() as Promise<Corpus>) : Promise.reject(new Error(`/api/lines → ${r.status}`))))
      .then((body) => {
        if (cancelled) return;
        setCorpus(body);
        setLine(body.lines[0]?.id ?? "");
        setKind(Object.keys(body.misbehaviours)[0] ?? "");
      })
      .catch((err: Error) => !cancelled && onProblem(`${err.message} — is \`server/\` running?`));
    return () => { cancelled = true; };
  }, [onProblem]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const detail = await res.json().then((d: { detail?: string }) => d.detail).catch(() => res.statusText);
    onProblem(`${path} → ${res.status} ${detail}`);
  }

  if (!corpus) return <p className="muted">Waiting for the corpus from <code>/api/lines</code>.</p>;

  return (
    <div className="drive" aria-disabled={!live}>
      <div className="drive-row">
        <select aria-label="Line to say" value={line} disabled={!live} onChange={(e) => setLine(e.target.value)}>
          {corpus.lines.map((n) => (
            <option key={n.id} value={n.id}>{n.tag} · {n.text}</option>
          ))}
        </select>
        <button className="go" disabled={!live} onClick={() => void post("/api/say", { id: line })}>Say</button>
      </div>

      <div className="drive-row" aria-label="Claim a state">
        {corpus.claims.map((state) => (
          <button key={state} disabled={!live} onClick={() => void post("/api/claim", { state })}>
            {state.toLowerCase()}
          </button>
        ))}
        {/* Clearing is a real command rather than a missing one — the face has
            to be told the agent stopped thinking. */}
        <button disabled={!live} onClick={() => void post("/api/claim", {})}>clear</button>
      </div>

      <div className="drive-row" aria-label="Send an action">
        {corpus.actions.map((action) => (
          <button key={action} title={action} disabled={!live} onClick={() => void post("/api/action", { action })}>
            {verb(action)}
          </button>
        ))}
      </div>

      <div className="drive-row">
        <select aria-label="Misbehaviour" value={kind} disabled={!live} onChange={(e) => setKind(e.target.value)}>
          {Object.keys(corpus.misbehaviours).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="bad" disabled={!live} onClick={() => void post("/api/misbehave", { kind })}>Break it</button>
      </div>

      <p className="watch">{live ? corpus.misbehaviours[kind] : "Start the call — these act on the call in progress, and answer 409 without one."}</p>
    </div>
  );
}
