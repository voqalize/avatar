/**
 * What the avatar is saying, as captions under the frame.
 *
 * Deliberately shaped like subtitles on a video and not like a chat log: two
 * sentences at most, two lines at most, the older one fading. A transcript
 * panel invites you to read the conversation; the thing worth watching here is
 * the *face*, and anything tall enough to scroll pulls your eyes off it.
 *
 * Two lines is a budget, and when the sentence being spoken needs all of it the
 * previous one goes rather than the clamp eating the end of the live one — the
 * words currently on the mouth are the whole reason the captions are here.
 *
 * The text is the karaoke split — `BotOutputText { spoken, unspoken }` from
 * `usePipecatConversation`, which is the same boundary the mouth is animating
 * from. Rendering the two halves differently makes that boundary visible: the
 * dim tail is text the TTS has not reached, so the mouth should not be shaping
 * it yet. If it is, you are looking at the defect.
 *
 * **`spoken` is empty on a TTS with no word timestamps**, which is most of them
 * — the whole sentence arrives at once and the split never happens. Dimming it
 * anyway would make every caption on that path look permanently unspoken, so an
 * empty `spoken` is read as "no karaoke here" rather than "nothing said yet".
 * That is the same two-spellings boundary the backend has, one layer up.
 *
 * There is no user caption because there is no speech-to-text in this pipeline:
 * `server/` runs a canned LLM off voice activity alone, so the only words that
 * exist are the bot's.
 */

import { useMemo } from "react";
import {
  usePipecatConversation,
  type BotOutputText,
  type ConversationMessagePart,
} from "@pipecat-ai/voice-ui-kit";

/** How many sentences stay on screen. Two, as asked; the older one fades. */
const KEPT = 2;

/**
 * The length at which the sentence being said stops sharing the two lines.
 *
 * The clamp is two lines and the height is fixed, so a long live sentence
 * behind a faded previous one loses its *end* — the words the mouth is shaping
 * right now, which is the only part anyone is here to check against the face.
 * Past that length the older sentence is dropped instead: context for half a
 * second is worth less than the current words being visible. 55 characters is a
 * shade under one line at this width, so the rule only fires when the pair
 * genuinely cannot both fit.
 */
const CROWDED = 55;

const isBotText = (text: unknown): text is BotOutputText =>
  typeof text === "object" && text !== null && "spoken" in text && "unspoken" in text;

/** The plain text of a part, either spelling, for the "is it empty" question. */
function flat(part: ConversationMessagePart): string {
  if (isBotText(part.text)) return `${part.text.spoken}${part.text.unspoken}`;
  return typeof part.text === "string" ? part.text : "";
}

export function Captions() {
  const { messages } = usePipecatConversation();

  // The last thing the bot said, whether or not it has finished saying it.
  // Between turns this leaves the previous sentence on screen, which is what
  // subtitles do — clearing it the instant the audio stops would flicker.
  const parts = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") continue;
      const kept = messages[i].parts.filter((p) => flat(p).trim().length > 0).slice(-KEPT);
      // A long live sentence takes both lines to itself — see CROWDED. Measured
      // on the whole part, spoken and unspoken together, so the decision does
      // not change halfway through as the karaoke boundary advances.
      const live = kept[kept.length - 1];
      if (kept.length > 1 && flat(live).trim().length > CROWDED) return [live];
      return kept;
    }
    return [];
  }, [messages]);

  return (
    // `aria-live` because this is the only place the bot's words appear, and
    // polite because interrupting a screen reader mid-sentence to announce a
    // caption is worse than the caption arriving late.
    <div className="captions" aria-live="polite" aria-atomic="false">
      <p className="caption-clamp">
        {parts.map((part, i) => (
          <Part key={`${part.createdAt}-${i}`} part={part} past={i < parts.length - 1} />
        ))}
      </p>
    </div>
  );
}

function Part({ part, past }: { part: ConversationMessagePart; past: boolean }) {
  const className = past ? "cap cap-past" : "cap";
  if (!isBotText(part.text)) return <span className={className}>{part.text} </span>;

  const { spoken, unspoken } = part.text;
  // No split available — render it as said. See the module note.
  if (!spoken) return <span className={className}>{unspoken} </span>;
  return (
    <span className={className}>
      {spoken}
      {unspoken && <span className="cap-ahead">{unspoken}</span>}{" "}
    </span>
  );
}
