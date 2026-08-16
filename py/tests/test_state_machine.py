"""The reduced backend contract: claims/actions and explicit control only.

Pipecat's browser client projects its own lifecycle events. These tests protect
the pieces that cannot be reconstructed there: lower-priority claims,
interruption-safe actions, and application-authored commands.
"""

from __future__ import annotations

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    ErrorFrame,
    FunctionCallCancelFrame,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    FunctionCallsStartedFrame,
    InterruptionFrame,
    LLMFullResponseStartFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)

from voqalize_avatar import AvatarAction, AvatarClaim, AvatarControlFrame, AvatarMessage
from voqalize_avatar.state_machine import AvatarStateMachine
from tests.helpers import sentence, sequence


def drive(machine: AvatarStateMachine, *frames) -> list[str]:
    out: list[str] = []
    for frame in frames:
        out.extend(sequence(machine.on_frame(frame)))
    return out


@pytest.fixture
def machine() -> AvatarStateMachine:
    m = AvatarStateMachine()
    m.start()
    return m


def test_thinking_spans_the_whole_wait_for_words(machine) -> None:
    """The reported bug, as a test.

    `LLMFullResponseStartFrame` used to clear the claim — so the model+TTS
    latency window, which is the longest silence in a call, was claimless and the
    widget fell through its ladder to IDLE. It re-arms the wait instead, and
    nothing retires it until words are actually audible.
    """
    assert machine.start() == []
    assert drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame()) == [
        "claim:THINKING"
    ]
    assert drive(machine, LLMFullResponseStartFrame()) == []
    assert machine.claim is AvatarClaim.THINKING
    assert drive(machine, BotStartedSpeakingFrame()) == ["claim:None"]


def test_a_turn_with_nothing_behind_it_strains_rather_than_waits(machine) -> None:
    """Two ways to learn the same thing, and the fast one is optional.

    An empty final transcript says it outright — but transcripts usually do not
    reach this seat, so `waited()` is the leg that has to work everywhere.
    """
    drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
    assert sequence(machine.waited()) == ["claim:STRAINING"]
    # The wait is over, so a second expiry has nothing left to give up on.
    assert machine.waited() == []
    assert not machine.awaiting_reply
    # And the next turn clears it, whatever came of the last one.
    assert drive(machine, UserStartedSpeakingFrame()) == ["claim:None"]


def test_an_empty_transcript_strains_without_waiting_for_the_clock(machine) -> None:
    drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
    assert drive(machine, TranscriptionFrame(user_id="u", timestamp="t", text="   ")) == [
        "claim:STRAINING"
    ]


def test_a_transcript_with_words_leaves_the_wait_alone(machine) -> None:
    drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
    assert drive(machine, TranscriptionFrame(user_id="u", timestamp="t", text="hello")) == []
    assert machine.claim is AvatarClaim.THINKING


def test_speech_outranks_every_claim(machine) -> None:
    """Both speech states resolve to *no* claim: the browser has them as Pipecat
    facts already, and restating one here would be the library speaking with less
    authority than the copy that is already there."""
    drive(machine, FunctionCallInProgressFrame(function_name="f", tool_call_id="a", arguments={}))
    assert drive(machine, UserStartedSpeakingFrame()) == ["claim:None"]
    # The tool is still running underneath, but the turn that just ended is the
    # more recent thing to be waiting on, so the ladder answers with it.
    assert drive(machine, UserStoppedSpeakingFrame()) == ["claim:THINKING"]
    assert machine.tools_in_flight == 1


def test_sentence_does_not_create_a_custom_lifecycle_command(machine) -> None:
    assert drive(machine, sentence("Hello.", "1.1")) == []


def test_bot_playout_does_not_duplicate_the_browser_lifecycle(machine) -> None:
    drive(machine, sentence("Hello.", "1.1"))
    assert drive(machine, BotStartedSpeakingFrame(), BotStoppedSpeakingFrame()) == []


def test_a_stale_bot_stop_and_duplicate_start_emit_nothing(machine) -> None:
    assert drive(machine, BotStoppedSpeakingFrame()) == []
    assert drive(machine, BotStartedSpeakingFrame(), BotStartedSpeakingFrame()) == []
    assert drive(machine, BotStoppedSpeakingFrame(), BotStoppedSpeakingFrame()) == []


def test_interruption_emits_one_action_without_a_lifecycle_duplicate(machine) -> None:
    drive(machine, BotStartedSpeakingFrame())
    assert drive(machine, InterruptionFrame()) == ["action:RESPONSE_INTERRUPTED"]
    assert drive(machine, BotStoppedSpeakingFrame()) == []


def test_tool_calls_claim_working_until_the_last_parallel_call_finishes(machine) -> None:
    assert drive(machine, FunctionCallInProgressFrame(function_name="lookup", tool_call_id="a", arguments={})) == ["claim:WORKING"]
    assert machine.tools_in_flight == 1
    assert drive(machine, FunctionCallInProgressFrame(function_name="lookup", tool_call_id="a", arguments={})) == []
    assert machine.tools_in_flight == 1
    # The result goes back to the model, so the wait resumes rather than ending —
    # there is no silence between the tool and the answer worth showing as IDLE.
    assert drive(machine, FunctionCallResultFrame(function_name="lookup", tool_call_id="a", arguments={}, result={})) == ["claim:THINKING"]
    assert machine.tools_in_flight == 0


def test_working_is_reachable_even_though_it_is_the_bottom_of_the_ladder(machine) -> None:
    """The trap in the ordering the ladder was asked for.

    Tool calls happen *inside* an outstanding reply. If the THINKING latch stayed
    set across one, WORKING — which sits below it — could never win, and would be
    a state nothing in a real pipeline ever reaches.
    """
    drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame(), LLMFullResponseStartFrame())
    assert machine.claim is AvatarClaim.THINKING
    assert drive(machine, FunctionCallInProgressFrame(function_name="f", tool_call_id="a", arguments={})) == [
        "claim:WORKING"
    ]


def test_a_cancelled_tool_call_is_not_a_finished_one(machine) -> None:
    """The interruption path, which has no result frame anywhere in it.

    Two things separate it from `tool_finished`: nothing goes back to the model,
    so the wait does not resume — and, the reason this exists at all, the call
    has to leave the set. `WORKING` is the bottom of the ladder, so a stranded
    one is not a missed beat; it is where the face spends the rest of the call.
    """
    drive(machine, FunctionCallInProgressFrame(function_name="f", tool_call_id="a", arguments={}))
    assert drive(machine, FunctionCallCancelFrame(function_name="f", tool_call_id="a")) == [
        "claim:None"
    ]
    assert machine.tools_in_flight == 0


def test_batched_tool_calls_emit_one_working_claim(machine) -> None:
    frame = FunctionCallsStartedFrame(function_calls=[
        type("Call", (), {"tool_call_id": "a"})(),
        type("Call", (), {"tool_call_id": "b"})(),
    ])
    assert drive(machine, frame) == ["claim:WORKING"]
    assert machine.tools_in_flight == 2


def test_explicit_application_controls_are_claims_and_actions(machine) -> None:
    claim = AvatarControlFrame(AvatarMessage.claim(AvatarClaim.WORKING))
    nod = AvatarControlFrame(AvatarMessage.action(AvatarAction.ACK_NOD))
    assert drive(machine, claim, nod) == ["claim:WORKING", "action:ACK_NOD"]
    assert machine.claim is AvatarClaim.WORKING
    assert sequence(machine.resync()) == ["claim:WORKING"]


def test_errors_are_projected_by_the_browser_and_fatal_stops_future_output(machine) -> None:
    assert drive(machine, ErrorFrame(error="temporary")) == []
    assert drive(machine, CancelFrame()) == []
    assert drive(machine, BotStartedSpeakingFrame()) == []
