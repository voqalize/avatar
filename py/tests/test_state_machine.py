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
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    FunctionCallsStartedFrame,
    InterruptionFrame,
    LLMFullResponseStartFrame,
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


def test_user_turn_sets_a_server_thinking_claim_after_speech_ends(machine) -> None:
    assert machine.start() == []
    assert drive(
        machine,
        UserStartedSpeakingFrame(),
        UserStoppedSpeakingFrame(),
        LLMFullResponseStartFrame(),
    ) == ["claim:THINKING", "claim:None"]


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
    assert drive(machine, FunctionCallResultFrame(function_name="lookup", tool_call_id="a", arguments={}, result={})) == ["claim:None"]
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
