/**
 * The server's names, in words a person would use.
 *
 * The wire vocabulary is `ACK_RECEIVE`, `GESTURE_WAIT`, `claim-during-speech` —
 * good names for a protocol and bad ones for a control. They are also *inward*
 * facing: `claim` describes who wins an argument between the server and the
 * renderer, which is a thing the library cares about and a thing nobody
 * pressing a button does.
 *
 * So the names stay on the wire, where the log shows them verbatim, and this is
 * the one place they turn into English. Every lookup falls back to a prettified
 * form of the name itself, so a vocabulary the server grows without telling us
 * renders as a plain button rather than disappearing — the lists still come
 * from `GET /api/lines`, and a UI that could only show names it had been taught
 * would be a UI that hides the new thing you added.
 */

/** What a control says, and the sentence under it. */
export interface Term {
  label: string;
  why: string;
}

const ACTIONS: Record<string, Term> = {
  ACK_RECEIVE: { label: "Got it", why: "A receipt. It heard you and is taking it in." },
  ACK_NOD: { label: "Nod", why: "The plainest backchannel, and the one that has to read." },
  RESPONSE_INTERRUPTED: { label: "Cut off", why: "It was speaking and you took the turn back." },
  GESTURE_GREET: { label: "Hello", why: "Opening the call." },
  GESTURE_GOODBYE: { label: "Goodbye", why: "Closing it." },
  GESTURE_APPROVE: { label: "Approve", why: "Agreement, not applause." },
  GESTURE_WAIT: { label: "One moment", why: "Asking you to hold." },
};

const MISBEHAVIOURS: Record<string, string> = {
  "claim-during-speech": "Contradict the speech",
  "stale-claim": "Arrive too late",
  "unknown-action": "Unknown move",
  "unknown-claim": "Unknown state",
  "action-storm": "Twelve at once",
};

/** `GESTURE_WAIT` → `wait`, `claim-during-speech` → `claim during speech`. */
const prettify = (name: string) =>
  name.replace(/^(ACK|GESTURE|RESPONSE)_/, "").replace(/[_-]+/g, " ").toLowerCase();

export const actionTerm = (name: string): Term =>
  ACTIONS[name] ?? { label: prettify(name), why: `\`${name}\` — this build has no words for it yet.` };

export const misbehaviourLabel = (kind: string): string => MISBEHAVIOURS[kind] ?? prettify(kind);

/**
 * Which heading an action sits under.
 *
 * By prefix rather than by a hand-kept list, so an action the server adds lands
 * in the right group without a change here. `RESPONSE_INTERRUPTED` groups with
 * the acknowledgements because that is what it is from the face's side: the
 * agent registering that the turn was taken from it.
 */
export const actionGroup = (name: string): "acknowledge" | "gesture" =>
  name.startsWith("GESTURE_") ? "gesture" : "acknowledge";
