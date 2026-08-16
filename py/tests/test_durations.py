"""The duration estimator, scored on clips the fit never saw.

The fast leg stretches a predicted phone timeline over whatever duration it is
given, and measured over a real corpus a 10% duration error costs ~20 points of
frame agreement while a 20% error costs ~35 (`docs/removed.md`
§ The textsync experiment). So the estimator's error band *is*
the fast leg's quality ceiling; a regression here is invisible in every other
test and obvious on someone's face.

The held-out set is every 5th clip in corpus order, excluded from the fit by the
same deterministic stride in `scripts/fit_durations.py`, so these numbers are
genuinely out-of-sample.

Measured at the time of writing (96 held-out clips, both shipped voices):

    voice               n     median   p90     worst
    omnivoice/gauri     48    7.4%     11.6%   17.8%
    omnivoice/gaurav    48    4.5%     15.7%   28.3%
    both                96    6.5%     13.8%   28.3%

The worst cases are all one-word utterances — "Okay.", "Yes." — where the fitted
onset, weighted to minimise *relative* error across the whole range, cannot also
be right at 800 ms. They are also the cases the accurate leg overwrites soonest,
since a short sentence's audio has fully landed almost immediately.

The gate is a 10% median, which is roughly double the measured value — loose
enough that re-fitting on a re-measured corpus does not fail the build, tight
enough that losing the fit fails it. The estimator this replaced, a mean over two
piper voices the library could never name, sat at 19.1% against these same clips.
"""

from __future__ import annotations

import statistics

import pytest

from voqalize_avatar.durations import (
    MIN_DURATION_MS,
    MS_PER_CHAR,
    ONSET_MS,
    estimate_duration_ms,
)

from .conftest import load_holdout

VOICES = ["omnivoice/gauri", "omnivoice/gaurav"]


def relative_errors(voice: str | None = None) -> list[float]:
    return [
        abs(estimate_duration_ms(str(clip["text"])) - ms) / ms
        for clip in load_holdout()
        if (ms := float(clip["audio_ms"])) > 0 and (voice is None or clip["voice"] == voice)
    ]


@pytest.mark.parametrize("voice", VOICES)
def test_held_out_median_error_is_under_ten_percent(voice: str) -> None:
    """Per voice, not just pooled.

    One model serves both, because the library is never told which one is
    speaking. That is only acceptable while it fits both: a pooled median that
    looks fine by averaging a good voice against a bad one would be the fast leg
    silently degrading for half the corpus.
    """
    errors = relative_errors(voice)

    assert len(errors) > 40, "the holdout is too small to mean anything"
    median = statistics.median(errors)
    assert median < 0.10, f"{voice}: median relative error {median:.1%}"


def test_the_tail_stays_bounded_too() -> None:
    # A good median with a fat tail would still ruin the sentences in the tail,
    # and the head of a turn is exactly where the fast leg is alone on screen.
    errors = sorted(relative_errors())
    p90 = errors[int(0.9 * len(errors))]
    assert p90 < 0.25, f"p90 relative error {p90:.1%}"


def test_the_constants_are_a_fit_and_not_a_guess() -> None:
    assert 20 < MS_PER_CHAR < 80
    # The fixed lead-in every utterance pays before the first phone is fully
    # articulated. A bare rate model badly under-predicts interjections without
    # it, so a fit that collapses it to ~0 is broken — and interjections are the
    # thing this avatar says most.
    assert 100 < ONSET_MS < 900


def test_the_estimate_is_speech_only_and_never_degenerate() -> None:
    # No inter-sentence pad: that is wire time, added by the caller when laying
    # sentences out.
    assert estimate_duration_ms("That is good to hear.") < 1800
    assert estimate_duration_ms("") >= MIN_DURATION_MS
    assert estimate_duration_ms("Hi.") >= MIN_DURATION_MS


def test_longer_text_never_estimates_shorter() -> None:
    previous = 0
    for text in ["Yes.", "Yes, of course.", "Yes, of course — take your time with it."]:
        current = estimate_duration_ms(text)
        assert current > previous
        previous = current
