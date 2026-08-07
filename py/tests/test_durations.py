"""The duration estimator, scored on clips the fit never saw.

The fast leg stretches a predicted phone timeline over whatever duration it is
given, and measured over a real corpus a 10% duration error costs ~20 points of
frame agreement while a 20% error costs ~35
(`experiments/rhubarb-textsync/README.md`). So the estimator's error band *is*
the fast leg's quality ceiling; a regression here is invisible in every other
test and obvious on someone's face.

The held-out set is every 5th clip in manifest order, excluded from the fit by
the same deterministic stride in `scripts/fit_durations.py`, so these numbers are
genuinely out-of-sample.

Measured at the time of writing (240 clips, both voices):

    voice         n     median   p75     p90     worst
    reference/a   120   6.0%     10.0%   15.1%   27.8%
    reference/b   120   4.8%     9.6%    13.4%   30.5%
    both          240   5.2%     9.7%    13.9%   30.5%

The worst cases are all one-word utterances — "Okay.", "Yes." — under-predicted
because the fitted onset, weighted to minimise *relative* error across the whole
range, cannot also be right at 500 ms. They are also the cases the accurate leg
overwrites soonest, since a 500 ms sentence's audio has fully landed almost
immediately.

The gate is a 10% median, which is roughly double the measured value — loose
enough that re-fitting on a different corpus does not fail the build, tight
enough that losing the fit (or regressing to a flat rate) does.
"""

from __future__ import annotations

import statistics

import pytest

from voqalize_avatar.durations import (
    MIN_DURATION_MS,
    estimate_duration_ms,
    model_for,
)

from .conftest import load_holdout


def relative_errors(voice: str | None = None) -> list[float]:
    return [
        abs(estimate_duration_ms(str(clip["text"]), str(clip["voice"]), str(clip["lang"])) - ms)
        / ms
        for clip in load_holdout()
        if (ms := float(clip["audio_ms"])) > 0 and (voice is None or clip["voice"] == voice)
    ]


@pytest.mark.parametrize("voice", ["reference/a", "reference/b"])
def test_held_out_median_error_is_under_ten_percent(voice: str) -> None:
    errors = relative_errors(voice)

    assert len(errors) > 100, "the holdout fixture is too small to mean anything"
    median = statistics.median(errors)
    assert median < 0.10, f"{voice}: median relative error {median:.1%}"


def test_the_tail_stays_bounded_too() -> None:
    # A good median with a fat tail would still ruin the sentences in the tail,
    # and the head of a turn is exactly where the fast leg is alone on screen.
    errors = sorted(relative_errors())
    p90 = errors[int(0.9 * len(errors))]
    assert p90 < 0.25, f"p90 relative error {p90:.1%}"


def test_both_shipped_voices_are_fitted_not_fallen_back_to() -> None:
    a = model_for("reference/a")
    b = model_for("reference/b")

    assert a != b, "one of the two voices is resolving to the fallback"
    for model in (a, b):
        assert 20 < model.ms_per_char < 80
        # onset_ms is the fixed lead-in every utterance pays before the first
        # phone is fully articulated. A bare rate model badly under-predicts
        # interjections without it, so a fit that collapses it to ~0 is broken.
        assert 100 < model.onset_ms < 900


def test_an_unknown_voice_falls_back_to_the_mean_of_the_known_ones() -> None:
    unknown = model_for("reference/nobody")
    known = [model_for("reference/a"), model_for("reference/b")]

    assert unknown.ms_per_char == pytest.approx(
        sum(m.ms_per_char for m in known) / len(known), rel=1e-9
    )
    assert model_for(None).ms_per_char == unknown.ms_per_char


def test_an_unknown_language_keeps_the_voice() -> None:
    # The character rate is as much a property of the speaker as of the
    # language, so a known voice in an unknown language beats the cross-voice
    # mean.
    assert model_for("reference/b", "hi") == model_for("reference/b", "en")


def test_the_estimate_is_speech_only_and_never_degenerate() -> None:
    # No inter-sentence pad: that is wire time, added by the caller when laying
    # sentences out. A sentence of ~20 chars is ~1.2 s of speech, not 1.45.
    assert estimate_duration_ms("That is good to hear.", "reference/a") < 1400
    assert estimate_duration_ms("", "reference/a") >= MIN_DURATION_MS
    assert estimate_duration_ms("Hi.", "reference/a") >= MIN_DURATION_MS


def test_longer_text_never_estimates_shorter() -> None:
    previous = 0
    for text in ["Yes.", "Yes, of course.", "Yes, of course — take your time with it."]:
        current = estimate_duration_ms(text, "reference/a")
        assert current > previous
        previous = current
