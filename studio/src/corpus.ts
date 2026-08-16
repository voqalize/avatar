/**
 * What this server can do, asked once and shared.
 *
 * Every vocabulary on this page — the voices, the actions, the misbehaviours,
 * the beats a fresh call starts with — comes from `GET /api/lines` rather than
 * from a list written here. They live in the Python package; a button list that
 * had drifted from them would be a UI testing a wire format that no longer
 * exists.
 *
 * It is one request for the page rather than one per panel because two panels
 * want it and they are never mounted at the same time — which is exactly the
 * shape that produces two subtly different copies of the same fetch.
 */

import { useCallback, useEffect, useState } from "react";

export interface VoiceOption {
  /** The server's key — "female", "male". Not a vendor voice id. */
  name: string;
  label: string;
  /** The vql-speech id this row really means, shown so the mapping is visible. */
  id: string;
}

export interface Corpus {
  actions: string[];
  /** kind → what to watch for while it runs. */
  misbehaviours: Record<string, string>;
  beats: { think_ms: number; work_ms: number };
  voices: VoiceOption[];
  /** The voice the *next* call will use. */
  voice: string;
}

export interface CorpusState {
  corpus: Corpus | null;
  /** Choose the voice for the next call. Resolves once the server has it. */
  chooseVoice(name: string): Promise<void>;
}

export function useCorpus(onProblem: (text: string) => void): CorpusState {
  const [corpus, setCorpus] = useState<Corpus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lines")
      .then((r) => (r.ok ? (r.json() as Promise<Corpus>) : Promise.reject(new Error(`/api/lines → ${r.status}`))))
      .then((body) => !cancelled && setCorpus(body))
      .catch((err: Error) => !cancelled && onProblem(`${err.message} — is \`server/\` running?`));
    return () => {
      cancelled = true;
    };
  }, [onProblem]);

  const chooseVoice = useCallback(
    async (name: string) => {
      // Optimistic, and safe to be: the server stores a string and the next
      // call reads it. Nothing about the current call changes, so there is no
      // state here that could be wrong for longer than a round trip.
      setCorpus((prev) => (prev ? { ...prev, voice: name } : prev));
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) onProblem(`/api/voice → ${res.status}`);
    },
    [onProblem],
  );

  return { corpus, chooseVoice };
}
