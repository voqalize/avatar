/**
 * The avatar wire as it arrives.
 *
 * A turn typically shows one `claim`, then a run of `cues` rewriting the same
 * span from a low `from_ms` — that is the accurate viseme leg overwriting the
 * predicted one, and it is supposed to look like that.
 *
 * This is the whole of what Studio can show. `createAvatar` returns `{ destroy }`
 * and nothing else: there is no resolved state to read back, deliberately, so
 * an integration cannot come to depend on one. What the face decided is a thing
 * you judge by looking at the face.
 */

import { useEffect, useRef } from "react";
import { Button } from "@pipecat-ai/voice-ui-kit";
import type { LogEntry } from "./call";

export function WireLog({ log, onClear }: { log: readonly LogEntry[]; onClear: () => void }) {
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  // Follow the tail only when the reader is already at it — scrolling back to
  // read a burst of cues should not have to fight the incoming ones.
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <section className="wire">
      <header>
        <h2>Avatar wire</h2>
        <Button size="sm" variant="outline" onClick={onClear} disabled={log.length === 0}>
          Clear
        </Button>
      </header>
      <ol
        ref={list}
        className="wire-log"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
        }}
      >
        {log.map((entry) => (
          <li key={entry.seq}>
            <span className="at">{entry.at}</span>
            <span className={entry.kind}>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
