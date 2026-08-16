/**
 * What it is saying, word by word, as the audio plays.
 *
 * This is the kit's `Conversation` in its default `karaoke` mode: the whole
 * sentence is on screen, the part already out of the speaker is in full ink, the
 * rest is muted, and the boundary advances with playout.
 *
 * It replaced a "Say" button, and it is a better instrument than one. The button
 * told you a turn had been requested. This tells you where the audio *is* — so
 * when the mouth is ahead of the words or behind them, you are looking at the
 * two clocks side by side rather than guessing from one.
 *
 * It only renders when the server puts word timings on the wire, and that is a
 * real check rather than a decoration: `CannedTTSService` calls
 * `add_word_timestamps` and runs with `push_text_frames=False`, which is
 * pipecat's spelling of "this service has word timestamps". Get that wrong and
 * the words all arrive at once at the end of the sentence — which is exactly
 * what a TTS with no timings does, and is worth being able to see.
 *
 * Not `TranscriptOverlay`, which looks like the obvious component and is not: it
 * filters on `spoken === true`, a protocol-1.4.x field pipecat no longer sets on
 * this path, so it renders an empty box forever.
 */

import { Conversation } from "@pipecat-ai/voice-ui-kit";

export function Transcript() {
  return (
    <section className="transcript">
      <header className="band-head">
        <h2>Transcript</h2>
        <small>spoken in full ink, unspoken muted</small>
      </header>
      <div className="transcript-body">
        <Conversation
          assistantLabel="avatar"
          clientLabel="you"
          textRenderMode="karaoke"
          // No text box: this server has no STT and takes its turn on voice
          // activity, so the way to make it talk is to talk to it.
          noTextInput
          noFunctionCalls
        />
      </div>
    </section>
  );
}
