# Avatar test fixtures

Text authored for the purpose — nothing here is copied from a private corpus.
The two halves differ in who speaks it, and that is deliberate: the PCM clips
feed a *recognizer*, where the licence of the voice matters and its identity does
not, while the duration corpus fits a *predictor* of the voices this project
actually ships, where the opposite is true.

## The PCM clips

Three clips spoken by [piper](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0)
using `en_US-ljspeech-high` (LJSpeech, public domain), so anyone who clones the
repo can regenerate them:

| file | text | ms |
|---|---|---|
| `take-your-time.pcm` | "Take your time." | 937 |
| `that-is-good-to-hear.pcm` | "That is good to hear." | 1266 |
| `thank-you-for-your-time-today.pcm` | "Thank you for your time today." | 1639 |

Raw **s16le mono 24000 Hz**, the encoding the accurate leg is fed. Byte length
is the duration: `bytes / 2 / 24000`. Leading and trailing silence is trimmed,
so they are pure speech and carry **none** of the 250 ms inter-sentence pad the
streaming wire appends; tests that exercise the pad synthesise it.

Real synthesised speech and not a synthetic tone on purpose. The accurate leg is
pocketsphinx doing acoustic recognition; a sine wave or white noise tells you the
plumbing works and nothing about whether the recognizer produced mouth shapes
that belong to the words. Three clips spanning 0.9-1.7 s cover the range where
the fast leg goes from clearly better than recognition to roughly level with it.

## `duration_corpus.json`

240 sentences in the assistant's register, stratified across character length
from one-word acknowledgements to two-sentence replies — because the model is
`ms = MS_PER_CHAR * chars + ONSET_MS` and a corpus bunched at one length fits a
rate that only holds there. Each one is spoken by **both shipped vql-speech
voices**, `omnivoice/gauri` and `omnivoice/gaurav`, for 480 rows of `{text,
voice, audio_ms}`. No audio: `audio_ms` is the wire byte count at 24 kHz, which
is the same number the service divides when it places its own word timestamps.

`scripts/fit_durations.py` fits the constants in `durations.py` from this file
and holds out every 5th row; `test_durations.py` scores them against exactly
those rows, so its numbers are out-of-sample.

The text is committed and the timings are measured, so re-fitting after a voice
or engine change is `scripts/measure_durations.py` (which needs the vql-speech
credential — see `server/record.py` for why it is not here) followed by
`scripts/fit_durations.py`. This corpus used to be spoken by piper too, on the
same reasoning as the clips above. It is the wrong reasoning for a *predictor*:
what the fast leg needs to know is how fast the voice on the call talks, and the
licence-clean stand-in was 19.1% away from that.
