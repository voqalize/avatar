"""How long a sentence will take to say, before it has been said.

The fast viseme leg runs the moment a sentence is handed to TTS, which is before
any of its audio exists — so it has to be told how long the sentence will be.
That number is the single most load-bearing input in the whole fast path.
Measured over a real corpus with the true timeline as reference (the spike the
fast leg came out of; its numbers survive in `docs/removed.md`
§ The textsync experiment):

    duration error   exact frame agreement
        -20%              48.0%
        -10%              57.5%
          0%              71.3%
        +10%              50.5%
        +20%              35.8%

A perfect phone model fed a 20% wrong duration is worse than a crude one fed the
right duration. Hence a fit rather than a rule of thumb.

`ms = MS_PER_CHAR * chars + ONSET_MS`. Characters beat words comfortably (median
5.5% vs 11%) and adding words as a second feature earns nothing. `ONSET_MS` is
not decoration — it is the fixed lead-in every utterance pays before the first
phone is fully articulated, which is why a bare rate model badly under-predicts
short interjections, and they are the ones this project cares most about.

**Two numbers, fitted once against vql-speech, and no table.** There used to be a
per-(voice, language) table with a fallback ladder, from when the processor could
be told which voice the TTS had opened its context with. It cannot any more
(`AvatarProcessor()` takes nothing — see `docs/removed.md`), so every lookup
resolved to the same cross-voice mean of two piper reference voices, and that
mean was 19.1% off vql-speech's actual median — deep inside the band the table
above says costs half the fast leg's frame agreement. "Okay." was predicted at
449 ms against a measured 810-850. Fitting the one model that is actually
reachable took that to 6.5%.

Fitted by `scripts/fit_durations.py` over `tests/fixtures/duration_corpus.json`
— 240 sentences in the assistant's register, stratified from one-word
acknowledgements to two-sentence replies, spoken by both shipped voices. Every
5th clip is held out; the out-of-sample median is 6.5% and p90 13.8%.

The two voices are pooled because the library only ever sees text. Fitting them
separately does better on paper (3.1% and 4.4%) and cannot be used: nothing
downstream of `AvatarProcessor()` knows who is speaking. Pooling costs the faster
voice about four points of median error, which the accurate leg overwrites within
a sentence — re-measure and re-fit if the shipped voices change, and take the
same 6.5% as the bar.
"""

from __future__ import annotations

#: Fitted 2026-08 against vql-speech `omnivoice/gauri` + `omnivoice/gaurav`.
#: Re-run `scripts/fit_durations.py` after `scripts/measure_durations.py`.
MS_PER_CHAR = 53.8172
ONSET_MS = 442.2

# Nothing sensible can be said in under a tenth of a second, and a zero or
# negative estimate would make the fast leg emit an empty track.
MIN_DURATION_MS = 100


def estimate_duration_ms(text: str) -> int:
    """Predicted speech duration in ms.

    Used only where measurement is not available yet — the fast leg, and the
    running estimate of a still-unresolved sentence's start. Every sentence whose
    audio has arrived is timed by its byte count instead.
    """
    return max(MIN_DURATION_MS, round(MS_PER_CHAR * len(text) + ONSET_MS))
