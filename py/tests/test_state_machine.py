"""The avatar heuristics as a table: frames in, messages out.

No pipeline, no clock, no I/O — the state machine is synchronous on purpose, so
every transition in the design's table is one assertion here. The harness tests
next door prove the same rules survive a real pipeline; these prove the rules.
"""

from __future__ import annotations

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    ErrorFrame,
    FatalErrorFrame,
    FunctionCallFromLLM,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    FunctionCallsStartedFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    LLMFullResponseStartFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    UserTurnInferenceCompletedFrame,
)
from pipecat.utils.time import time_now_iso8601

from voqalize_avatar import (
    AvatarControlFrame,
    AvatarMessage,
    AvatarState,
    AvatarStateMachine,
    Interjection,
)
from tests.helpers import sequence


def final(text: str) -> TranscriptionFrame:
    return TranscriptionFrame(text=text, user_id="u", timestamp=time_now_iso8601(), finalized=True)


def interim(text: str) -> InterimTranscriptionFrame:
    return InterimTranscriptionFrame(text=text, user_id="u", timestamp=time_now_iso8601())


def drive(machine: AvatarStateMachine, *frames) -> list[str]:
    """Feed frames in order; return the flattened message sequence."""
    out: list[str] = []
    for frame in frames:
        out.extend(sequence(machine.on_frame(frame)))
    return out


@pytest.fixture
def machine() -> AvatarStateMachine:
    m = AvatarStateMachine()
    m.start()
    return m


# ─── Lifecycle ────────────────────────────────────────────────────────────────


def test_start_enters_idle() -> None:
    m = AvatarStateMachine()
    assert sequence(m.start()) == ["state:IDLE"]
    assert m.state is AvatarState.IDLE


def test_resync_repeats_the_current_state_bypassing_dedup(machine) -> None:
    """A client that was not connected did not receive what we 'sent'."""
    drive(machine, UserStartedSpeakingFrame())
    assert sequence(machine.resync()) == ["state:LISTENING"]
    assert sequence(machine.resync()) == ["state:LISTENING"]


def test_resync_before_start_still_gives_the_client_something() -> None:
    assert sequence(AvatarStateMachine().resync()) == ["state:IDLE"]


# ─── The user's turn ──────────────────────────────────────────────────────────


def test_user_started_speaking_listens_and_reports_the_voice(machine) -> None:
    assert drive(machine, UserStartedSpeakingFrame()) == [
        "state:LISTENING",
        "user:True",
    ]


def test_a_pause_mid_turn_holds_the_state(machine) -> None:
    """LISTENING is where the widget's contingent acknowledgements live, and a
    pause is exactly when one should land — so the state must not move."""
    drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
    assert drive(machine, UserStartedSpeakingFrame()) == ["state:LISTENING", "user:True"]
    assert machine.state is AvatarState.LISTENING


def test_the_voice_signal_dedups_like_a_state(machine) -> None:
    """Flux and the VAD can both announce the same onset; the widget takes
    `user speaking` as a condition, so a repeat is noise on the data channel."""
    assert drive(machine, UserStartedSpeakingFrame(), UserStartedSpeakingFrame()) == [
        "state:LISTENING",
        "user:True",
    ]


def test_the_end_of_a_user_turn_thinks(machine) -> None:
    assert drive(machine, UserStartedSpeakingFrame(), UserStoppedSpeakingFrame()) == [
        "state:LISTENING",
        "user:True",
        "user:False",
        "state:THINKING",
    ]


def test_a_transcript_landing_after_the_stop_still_thinks(machine) -> None:
    """Flux's finalized transcript can arrive either side of its stop frame, so
    THINKING fires on whichever is second — never on a fixed one."""
    assert drive(
        machine,
        UserStartedSpeakingFrame(),
        final("what is the weather"),
        UserStoppedSpeakingFrame(),
    ) == ["state:LISTENING", "user:True", "user:False", "state:THINKING"]


def test_an_empty_final_transcript_withdraws_the_turn(machine) -> None:
    """The endpointer heard noise, not speech. Sending the avatar off to think
    about nothing is worse than doing nothing."""
    assert drive(
        machine,
        UserStartedSpeakingFrame(),
        final("   "),
        UserStoppedSpeakingFrame(),
    ) == ["state:LISTENING", "user:True", "user:False"]


def test_semantic_turn_completion_also_commits(machine) -> None:
    drive(machine, UserStartedSpeakingFrame(), final("   "), UserStoppedSpeakingFrame())
    assert machine.state is AvatarState.LISTENING
    assert drive(machine, UserTurnInferenceCompletedFrame()) == ["state:THINKING"]


def test_interim_transcripts_alone_change_nothing(machine) -> None:
    assert drive(machine, UserStartedSpeakingFrame(), interim("what"), interim("what is")) == [
        "state:LISTENING",
        "user:True",
    ]


def test_eager_end_of_turn_is_a_hint_not_a_state(machine) -> None:
    drive(machine, UserStartedSpeakingFrame())
    assert sequence(machine.eager_end_of_turn()) == ["hint:eager_eot"]
    assert machine.state is AvatarState.LISTENING


# ─── The agent's turn ─────────────────────────────────────────────────────────


def test_a_queued_sentence_claims_the_floor(machine) -> None:
    """The earliest honest evidence of imminent speech, and the only one with
    real lead time: the text is on the websocket and the audio is ~450 ms away."""
    assert sequence(machine.sentence_queued("1.1")) == [
        "state:TAKING_FLOOR",
        "interject:CLAIM_FLOOR",
    ]
    assert machine.ctx == "1.1"


def test_the_audio_trigger_stays_as_the_fallback(machine) -> None:
    """Both hooks fire on a normal turn — the claim dedups, so having the slow
    path as well costs nothing and covers a TTS that never calls the fast one."""
    machine.sentence_queued("1.1")
    assert drive(machine, audio("1.1"), TTSStartedFrame(context_id="1.1")) == []


def test_a_later_sentence_does_not_re_point_the_open_turn(machine) -> None:
    """`speech:start` announced a ctx and the client anchored its cue clock to
    it; sentence two of the same turn must not move the anchor."""
    machine.sentence_queued("1.1")
    drive(machine, BotStartedSpeakingFrame())
    machine.sentence_queued("1.2")
    assert machine.ctx == "1.1"


def test_a_queued_sentence_says_nothing_once_offline(machine) -> None:
    drive(machine, FatalErrorFrame(error="gone"))
    assert sequence(machine.sentence_queued("1.1")) == []


def test_tts_start_claims_the_floor(machine) -> None:
    assert drive(machine, TTSStartedFrame(context_id="1.1")) == [
        "state:TAKING_FLOOR",
        "interject:CLAIM_FLOOR",
    ]


def test_the_floor_is_claimed_once_per_turn(machine) -> None:
    """TTS starts once per inference; a CLAIM_FLOOR per sentence reads as a
    stutter."""
    drive(machine, TTSStartedFrame(context_id="1.1"))
    assert drive(machine, TTSStartedFrame(context_id="1.2")) == []


def audio(context_id: str | None = None) -> TTSAudioRawFrame:
    return TTSAudioRawFrame(
        audio=b"\x00\x00", sample_rate=24000, num_channels=1, context_id=context_id
    )


def test_synthesized_audio_claims_the_floor_when_no_start_frame_comes(machine) -> None:
    """Not every TTS service emits `TTSStartedFrame` — pipecat suppresses it
    whenever the audio context was pre-created, which is exactly what the
    inference-context mixin does. Audio is the fact underneath the announcement,
    so the inbreath rides on whichever arrives first."""
    assert drive(machine, audio("1.1")) == ["state:TAKING_FLOOR", "interject:CLAIM_FLOOR"]
    assert drive(machine, audio("1.1"), audio("1.1")) == []


def test_audio_after_the_start_frame_does_not_claim_twice(machine) -> None:
    drive(machine, TTSStartedFrame(context_id="1.1"))
    assert drive(machine, audio("1.1")) == []


def test_audio_mid_speech_is_not_a_new_claim(machine) -> None:
    """The common case by frame count: once the bot is audibly speaking, every
    chunk must cost one boolean and say nothing."""
    drive(machine, TTSStartedFrame(context_id="1.1"), BotStartedSpeakingFrame())
    assert drive(machine, *[audio("1.1") for _ in range(5)]) == []


def test_bot_speech_anchors_and_releases_the_turn_clock(machine) -> None:
    assert drive(
        machine,
        TTSStartedFrame(context_id="1.1"),
        BotStartedSpeakingFrame(),
        TTSStoppedFrame(context_id="1.1"),
        BotStoppedSpeakingFrame(),
    ) == [
        "state:TAKING_FLOOR",
        "interject:CLAIM_FLOOR",
        "speech:start",
        "speech:stop",
        "state:WAITING_FOR_USER",
    ]


def test_speech_carries_the_inference_context(machine) -> None:
    machine.on_frame(LLMFullResponseStartFrame())
    assert machine.ctx == "turn.1"
    machine.on_frame(TTSStartedFrame(context_id="turn.1"))
    (start,) = machine.on_frame(BotStartedSpeakingFrame())
    assert start.to_wire() == {
        "type": "avatar",
        "v": 1,
        "cmd": "speech",
        "event": "start",
        "ctx": "turn.1",
    }


def test_ctx_is_overridable_for_a_runtime_with_real_ids() -> None:
    """The default `turn.N` is a fallback, not a format. A pipeline that has its
    own inference ids should subclass so avatar traffic joins its logs — this is
    the recovery path for a consumer whose private frames carried them."""

    class Numbered(AvatarStateMachine):
        def next_ctx(self) -> str:
            return f"3.{self._inference}"

    machine = Numbered()
    machine.on_frame(LLMFullResponseStartFrame())
    assert machine.ctx == "3.1"


def test_a_repeated_bot_start_does_not_reopen_the_clock(machine) -> None:
    drive(machine, TTSStartedFrame(context_id="1.1"), BotStartedSpeakingFrame())
    assert drive(machine, BotStartedSpeakingFrame()) == []


def test_a_bot_stop_with_no_turn_in_flight_is_ignored(machine) -> None:
    assert drive(machine, BotStoppedSpeakingFrame()) == []


# ─── Barge-in ─────────────────────────────────────────────────────────────────


def test_barge_in_yields_the_floor(machine) -> None:
    drive(machine, TTSStartedFrame(context_id="1.1"), BotStartedSpeakingFrame())
    assert drive(machine, InterruptionFrame()) == [
        "state:YIELDED",
        "interject:YIELD_FLOOR",
        "speech:stop",
    ]


def test_a_yielded_turn_does_not_then_wait_for_the_user(machine) -> None:
    """The floor was taken, not handed over — WAITING_FOR_USER would claim the
    agent asked something and stopped."""
    drive(
        machine,
        TTSStartedFrame(context_id="1.1"),
        BotStartedSpeakingFrame(),
        InterruptionFrame(),
    )
    assert drive(machine, BotStoppedSpeakingFrame()) == []
    assert machine.state is AvatarState.YIELDED


def test_yielded_recovers_to_listening_on_the_next_transcript(machine) -> None:
    """No new UserStartedSpeaking is coming — the user was already mid-sentence
    when they cut in, so the next fragment is the evidence."""
    drive(
        machine,
        UserStartedSpeakingFrame(),
        TTSStartedFrame(context_id="1.1"),
        BotStartedSpeakingFrame(),
        InterruptionFrame(),
    )
    assert drive(machine, interim("no wait")) == ["state:LISTENING"]


def test_interruption_with_no_floor_held_says_nothing(machine) -> None:
    assert drive(machine, InterruptionFrame()) == []


def test_interruption_between_tts_and_audio_still_yields(machine) -> None:
    """The inbreath was already visible; it has to be undone even though no
    sample ever played."""
    drive(machine, TTSStartedFrame(context_id="1.1"))
    assert drive(machine, InterruptionFrame()) == ["state:YIELDED", "interject:YIELD_FLOOR"]


# ─── Tool calls ───────────────────────────────────────────────────────────────


def call(tool_call_id: str, function_name: str = "lookup") -> FunctionCallFromLLM:
    return FunctionCallFromLLM(
        function_name=function_name, tool_call_id=tool_call_id, arguments={}, context=None
    )


def started(*tool_call_ids: str, function_name: str = "lookup") -> FunctionCallsStartedFrame:
    """One frame announcing however many calls — the shape stock pipecat uses.

    Variadic because the batching is the interesting part: three calls in one
    frame and three calls in three frames must both enter THINKING exactly once.
    """
    return FunctionCallsStartedFrame(
        function_calls=[call(tid, function_name) for tid in tool_call_ids]
    )


def result(tool_call_id: str, function_name: str = "lookup") -> FunctionCallResultFrame:
    return FunctionCallResultFrame(
        function_name=function_name, tool_call_id=tool_call_id, arguments={}, result={}
    )


def test_a_tool_call_thinks(machine) -> None:
    assert drive(machine, started("tc-1")) == ["state:THINKING"]


def test_parallel_calls_batched_in_one_frame_enter_thinking_once(machine) -> None:
    """The stock frame carries a *list*, so this is the common shape — an LLM
    that asks for three tools announces them together."""
    assert drive(machine, started("tc-1", "tc-2", "tc-3")) == ["state:THINKING"]
    assert machine.tools_in_flight == 3


def test_parallel_tool_calls_enter_thinking_once_and_do_not_flap(machine) -> None:
    assert drive(machine, started("tc-1"), started("tc-2"), started("tc-3")) == ["state:THINKING"]
    assert machine.tools_in_flight == 3
    assert drive(machine, result("tc-1"), result("tc-2")) == []
    assert machine.state is AvatarState.THINKING
    assert drive(machine, result("tc-3")) == []
    # Zero in flight is not a state change: the brain is still composing. The
    # floor claim is what ends THINKING.
    assert machine.tools_in_flight == 0
    assert machine.state is AvatarState.THINKING


def test_a_repeated_announcement_cannot_strand_the_counter(machine) -> None:
    """Pipecat sends both *Started* and *InProgress* for the same call; counting
    them would leave the avatar thinking forever."""
    in_progress = FunctionCallInProgressFrame(
        function_name="lookup", tool_call_id="tc-1", arguments={}
    )
    drive(machine, started("tc-1"), in_progress)
    assert machine.tools_in_flight == 1
    drive(machine, result("tc-1"))
    assert machine.tools_in_flight == 0


def test_a_tool_call_during_a_committed_turn_is_deduped(machine) -> None:
    drive(machine, UserStartedSpeakingFrame(), final("hi"), UserStoppedSpeakingFrame())
    assert machine.state is AvatarState.THINKING
    assert drive(machine, started("tc-1")) == []


def test_tools_hand_the_floor_over_to_tts(machine) -> None:
    assert drive(machine, started("tc-1"), result("tc-1"), TTSStartedFrame(context_id="1.1")) == [
        "state:THINKING",
        "state:TAKING_FLOOR",
        "interject:CLAIM_FLOOR",
    ]


# ─── Tool states ──────────────────────────────────────────────────────────────


def test_a_mapped_tool_shows_its_own_state() -> None:
    machine = AvatarStateMachine(tool_states={"search_web": AvatarState.SEARCHING_SCREEN})
    assert drive(machine, started("tc-1", function_name="search_web")) == [
        "state:SEARCHING_SCREEN"
    ]


def test_an_unmapped_tool_falls_back_to_thinking() -> None:
    machine = AvatarStateMachine(tool_states={"search_web": AvatarState.SEARCHING_SCREEN})
    assert drive(machine, started("tc-1", function_name="lookup")) == ["state:THINKING"]


def test_the_first_mapped_call_wins_and_does_not_flap() -> None:
    """Two tools at once cannot both be depicted, and alternating between their
    states would read as indecision rather than as work."""
    machine = AvatarStateMachine(
        tool_states={
            "search_web": AvatarState.SEARCHING_SCREEN,
            "write_notes": AvatarState.TYPING,
        }
    )
    assert drive(
        machine,
        started("tc-1", function_name="search_web"),
        started("tc-2", function_name="write_notes"),
    ) == ["state:SEARCHING_SCREEN"]


def test_a_finished_mapped_call_hands_back_to_its_survivor() -> None:
    """The specific state the finished call was holding is over; the honest
    answer is whatever the calls still running ask for."""
    machine = AvatarStateMachine(tool_states={"search_web": AvatarState.SEARCHING_SCREEN})
    drive(
        machine,
        started("tc-1", function_name="search_web"),
        started("tc-2", function_name="lookup"),
    )
    assert drive(machine, result("tc-1", function_name="search_web")) == ["state:THINKING"]


# ─── Explicit control ─────────────────────────────────────────────────────────


def test_a_control_frame_passes_straight_through(machine) -> None:
    frame = AvatarControlFrame(AvatarMessage.state(AvatarState.TYPING))
    assert drive(machine, frame) == ["state:TYPING"]


def test_a_control_frame_updates_the_dedup_memo(machine) -> None:
    """The whole reason control frames route through the state machine.

    Without the memo update the machine would still believe LISTENING is current
    and swallow the next inferred one as a no-op — leaving the avatar typing for
    the rest of the call.
    """
    drive(machine, UserStartedSpeakingFrame())
    assert machine.state is AvatarState.LISTENING
    drive(machine, AvatarControlFrame(AvatarMessage.state(AvatarState.TYPING)))
    assert machine.state is AvatarState.TYPING
    drive(machine, UserStoppedSpeakingFrame(), UserStartedSpeakingFrame())
    assert machine.state is AvatarState.LISTENING


def test_a_control_frame_that_is_not_a_state_leaves_the_memo_alone(machine) -> None:
    drive(machine, UserStartedSpeakingFrame())
    assert drive(machine, AvatarControlFrame(AvatarMessage.interject(Interjection.NOD_SLOW))) == [
        "interject:NOD_SLOW"
    ]
    assert machine.state is AvatarState.LISTENING


def test_an_unknown_state_is_rejected_here_rather_than_in_the_browser(machine) -> None:
    """The widget throws on an unknown state, where nobody can see it. Raising
    at this seat names the application that sent it."""
    frame = AvatarControlFrame(AvatarMessage(cmd="state", payload={"name": "DAYDREAMING"}))
    with pytest.raises(ValueError, match="DAYDREAMING"):
        machine.on_frame(frame)


def test_control_is_ignored_once_the_avatar_is_offline(machine) -> None:
    """OFFLINE is terminal: a tearing-down pipeline must not animate a corpse,
    and that has to hold for explicit instructions too."""
    drive(machine, FatalErrorFrame(error="pipeline died"))
    assert drive(machine, AvatarControlFrame(AvatarMessage.state(AvatarState.TYPING))) == []


# ─── Failure ──────────────────────────────────────────────────────────────────


def test_a_non_fatal_error_degrades(machine) -> None:
    assert drive(machine, ErrorFrame(error="tts websocket dropped")) == ["state:DEGRADED"]


def test_degraded_recovers_on_the_next_real_activity(machine) -> None:
    """No timer and no recovery message: the next thing that actually happens
    carries the avatar out, into whatever is true then."""
    drive(machine, ErrorFrame(error="tts websocket dropped"))
    assert drive(machine, UserStartedSpeakingFrame()) == ["state:LISTENING", "user:True"]


def test_a_fatal_error_goes_offline(machine) -> None:
    assert drive(machine, FatalErrorFrame(error="pipeline died")) == ["state:OFFLINE"]


def test_a_fatal_flag_on_a_plain_error_frame_is_also_fatal(machine) -> None:
    assert drive(machine, ErrorFrame(error="gone", fatal=True)) == ["state:OFFLINE"]


def test_an_out_of_band_error_takes_the_same_route(machine) -> None:
    """Errors travel upstream, so the session watches for them with an observer
    and calls in. Same transitions, or the avatar would show two different
    faces for one failure depending on where it was seen."""
    assert sequence(machine.error(fatal=False)) == ["state:DEGRADED"]
    assert sequence(machine.error(fatal=True)) == ["state:OFFLINE"]
    assert sequence(machine.error(fatal=True)) == []


def test_pipeline_cancel_goes_offline(machine) -> None:
    assert drive(machine, CancelFrame()) == ["state:OFFLINE"]


def test_offline_is_terminal(machine) -> None:
    """A tearing-down pipeline keeps pushing frames; none of them animate a
    corpse."""
    drive(machine, FatalErrorFrame(error="pipeline died"))
    assert drive(machine, UserStartedSpeakingFrame(), TTSStartedFrame(), started("tc-1")) == []
    assert machine.state is AvatarState.OFFLINE


# ─── Dedup ────────────────────────────────────────────────────────────────────


def test_a_state_is_never_sent_twice_in_a_row(machine) -> None:
    """The collapse is on the state, not on the frame that derived it: a tool
    call arriving into an already-THINKING avatar has nothing to say."""
    assert drive(machine, UserStartedSpeakingFrame()) == ["state:LISTENING", "user:True"]
    assert drive(machine, UserStoppedSpeakingFrame()) == ["user:False", "state:THINKING"]
    assert drive(machine, started("tc-1")) == []


def test_an_interjection_is_an_event_and_always_fires(machine) -> None:
    """A second recoil *is* a second recoil — the collapse rule for states must
    not reach clips, even when the state either side is identical."""
    turn = (
        TTSStartedFrame(),
        BotStartedSpeakingFrame(),
        InterruptionFrame(),
        BotStoppedSpeakingFrame(),
    )
    first = drive(machine, *turn)
    second = drive(machine, *turn)
    yielded = f"interject:{Interjection.YIELD_FLOOR}"
    assert first == second
    assert yielded in first
    assert first.count(f"interject:{Interjection.CLAIM_FLOOR}") == 1


# ─── The envelope ─────────────────────────────────────────────────────────────


def test_every_message_carries_the_versioned_avatar_envelope(machine) -> None:
    frames = [
        UserStartedSpeakingFrame(),
        TTSStartedFrame(context_id="1.1"),
        BotStartedSpeakingFrame(),
        InterruptionFrame(),
    ]
    emitted = [m for f in frames for m in machine.on_frame(f)]
    assert emitted
    for message in emitted:
        wire = message.to_wire()
        assert wire["type"] == "avatar"
        assert wire["v"] == 1
        assert wire["cmd"] in {"state", "interject", "speech", "user", "hint", "cues", "perform"}
