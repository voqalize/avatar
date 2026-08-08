"""How long a sentence will take to say, before it has been said.

The fast viseme leg runs the moment a sentence is handed to TTS, which is before
any of its audio exists — so it has to be told how long the sentence will be.
That number is the single most load-bearing input in the whole fast path.
Measured over a real corpus with the true timeline as reference
(`experiments/rhubarb-textsync/README.md`):

    duration error   exact frame agreement
        -20%              48.0%
        -10%              57.5%
          0%              71.3%
        +10%              50.5%
        +20%              35.8%

A perfect phone model fed a 20% wrong duration is worse than a crude one fed the
right duration. Hence a fitted table rather than a rule of thumb.

The model is two parameters per (voice, lang): `ms = ms_per_char * chars +
onset_ms`. Characters beat words comfortably (median 5.5% vs 11%), and adding
words as a second feature earns nothing. `onset_ms` is not decoration — it is
the fixed lead-in every utterance pays before the first phone is fully
articulated, which is why a bare rate model badly under-predicts short
interjections.

Coefficients live in `duration_table.json`, fitted by `scripts/fit_durations.py`
over 600 utterances per voice (real audio with the exact text that produced it;
see `py/tests/fixtures/README.md` for the corpus). Out-of-sample median error is
6.0% and 4.8% for the two fitted voices — inside the ±10% band where the fast
leg still beats the `phonetic` recognizer on short utterances, which is where it
matters.

Two limits worth knowing. **The shipped fit is two reference voices, not
yours** — a voice the table has never seen falls back to the cross-voice mean,
and re-fitting against your own TTS is a `scripts/fit_durations.py --cache` away.
And injected emotion changes speaking rate in a way a static character rate
cannot represent at all. Both are survivable because the accurate leg overwrites
the fast leg as soon as the audio lands — the estimate only has to hold for the
head of a turn.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_TABLE_PATH = Path(__file__).with_name("duration_table.json")

# Nothing sensible can be said in under a tenth of a second, and a zero or
# negative estimate would make the fast leg emit an empty track.
MIN_DURATION_MS = 100


@dataclass(frozen=True, slots=True)
class DurationModel:
    """One voice's fitted character rate."""

    ms_per_char: float
    onset_ms: float
    median_rel_err: float = 0.0

    def estimate_ms(self, text: str) -> int:
        return max(MIN_DURATION_MS, round(self.ms_per_char * len(text) + self.onset_ms))


@lru_cache(maxsize=1)
def _models() -> dict[str, DurationModel]:
    raw = json.loads(_TABLE_PATH.read_text())
    return {
        key: DurationModel(
            ms_per_char=float(entry["ms_per_char"]),
            onset_ms=float(entry["onset_ms"]),
            median_rel_err=float(entry.get("median_rel_err", 0.0)),
        )
        for key, entry in raw["voices"].items()
    }


@lru_cache(maxsize=1)
def _fallback() -> DurationModel:
    """The mean of every fitted voice.

    A voice we have never measured is likelier to resemble the average of the
    ones we have than any single one of them, and averaging keeps the fallback
    correct-by-construction as voices are added rather than pinned to whichever
    voice happened to be first.
    """
    models = list(_models().values())
    if not models:
        # Only reachable if the table is emptied, which would be a packaging
        # bug; a plausible rate beats a crash on a live call.
        return DurationModel(ms_per_char=40.0, onset_ms=400.0)
    n = len(models)
    return DurationModel(
        ms_per_char=sum(m.ms_per_char for m in models) / n,
        onset_ms=sum(m.onset_ms for m in models) / n,
    )


def model_for(voice: str | None, lang: str = "en") -> DurationModel:
    """The fitted model for a voice, falling back by language and then to the mean."""
    models = _models()
    if voice:
        exact = models.get(f"{voice}|{lang}")
        if exact is not None:
            return exact
        # Same voice, different language: the character rate is a property of
        # the speaker as much as the language, so it is a better guess than the
        # cross-voice mean.
        for key, model in models.items():
            if key.split("|", 1)[0] == voice:
                return model
    return _fallback()


def estimate_duration_ms(text: str, voice: str | None = None, lang: str = "en") -> int:
    """Predicted speech duration in ms.

    Used only where measurement is not available yet — the fast leg, and the
    running estimate of a still-unresolved sentence's start. Every sentence whose
    audio has arrived is timed by its byte count instead.
    """
    return model_for(voice, lang).estimate_ms(text)
