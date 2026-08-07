"""The processor's obligations, driven frame by frame.

The state machine's rules are tested next door as a pure function. What is left
here is everything the *processor* owes the pipeline: pass every frame through,
emit in the RTVI shape and the safe direction, and stay reachable out of band (client ready,
eager end of turn, the Sprint B cue seam). Also the two failure modes a real
session cannot be asked to produce on demand.
"""

from __future__ import annotations

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    FatalErrorFrame,
    Frame,
    InterruptionFrame,
    OutputAudioRawFrame,
    StartFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame

from voqalize_avatar import AVATAR_MESSAGE_TYPE, AvatarMessage, AvatarState
from voqalize_avatar.sentence_audio import EARLY_PARTIAL_BYTES
from tests.helpers import AvatarPipe

pytestmark = pytest.mark.asyncio


# ─── Pipeline obligations ─────────────────────────────────────────────────────


async def test_the_avatar_consumes_nothing() -> None:
    """It is seated in the audio path between TTS and the transport. Anything
    it swallows is silence the user hears."""
    fed: list[Frame] = [
        TTSStartedFrame(context_id="1.1"),
        TTSAudioRawFrame(audio=b"\x00\x00", sample_rate=24000, num_channels=1),
        OutputAudioRawFrame(audio=b"\x00\x00", sample_rate=24000, num_channels=1),
        BotStartedSpeakingFrame(),
        TTSStoppedFrame(context_id="1.1"),
        BotStoppedSpeakingFrame(),
        UserStartedSpeakingFrame(),
    ]
    async with AvatarPipe() as pipe:
        await pipe.push(*fed)
        arrived = [f for f in pipe.downstream.passed if not isinstance(f, StartFrame)]
        assert [type(f) for f in arrived] == [type(f) for f in fed]


async def test_the_start_frame_reaches_the_transport_before_any_avatar_message() -> None:
    """StartFrame carries the sample rates every downstream service needs; it
    cannot wait behind our bookkeeping. It is also the gate: push_frame() drops
    everything silently until the processor has seen its own start."""
    async with AvatarPipe() as pipe:
        assert isinstance(pipe.downstream.frames[0], StartFrame)
        assert pipe.sent == ["state:IDLE"]


async def test_messages_travel_downstream_in_the_rtvi_server_message_shape() -> None:
    """The RTVI observer fires on a push in either direction, so the choice is
    made by what else is in the way. Upstream of this seat sits the LLM service,
    whose serializer can claim `RTVIServerMessageFrame` and then block on an ack
    that never comes — so upstream is a deadlock and downstream is free."""
    async with AvatarPipe() as pipe:
        await pipe.push(UserStartedSpeakingFrame())
        emitted = [f for f in pipe.downstream.frames if isinstance(f, RTVIServerMessageFrame)]
        assert emitted
        for frame in emitted:
            assert isinstance(frame.data, dict)
            assert frame.data["type"] == AVATAR_MESSAGE_TYPE
            assert frame.data["v"] == 1
        # Not one travelled back toward the LLM.
        assert not [f for f in pipe.upstream.frames if isinstance(f, RTVIServerMessageFrame)]


# ─── Out-of-band entry points ─────────────────────────────────────────────────


async def test_client_ready_replays_the_current_state() -> None:
    """The browser connects after the pipeline; without a resync it would sit
    in whatever pose it booted with."""
    async with AvatarPipe() as pipe:
        await pipe.push(UserStartedSpeakingFrame())
        pipe.drain()
        await pipe.avatar.on_client_ready()
        assert pipe.sent == ["state:LISTENING"]


async def test_client_ready_before_the_start_frame_is_held_not_lost() -> None:
    """The order a real session actually produces (seen in the gato compat
    suite): the RTVI data channel is up, the browser says client-ready, and
    StartFrame is still several processors upstream. `push_frame()` drops
    anything sent before then, so the opening pose would never arrive — and the
    widget would hold whatever it booted with until the first state change.

    One `state:IDLE`, not two: the held resync already announced it, so the
    state machine's own `start()` dedups to nothing.
    """
    async with AvatarPipe(autostart=False) as pipe:
        await pipe.avatar.on_client_ready()
        assert pipe.sent == []
        await pipe.start()
        assert pipe.sent == ["state:IDLE"]
        assert isinstance(pipe.downstream.frames[0], StartFrame)


async def test_eager_end_of_turn_reaches_the_wire_as_a_hint() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.on_eager_end_of_turn()
        assert pipe.sent == ["hint:eager_eot"]


async def test_push_cues_is_the_sprint_b_seam() -> None:
    """The viseme engine is not built yet; the socket it plugs into is, and it
    speaks the widget's splice contract (`from_ms` + `final`)."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.push_cues(
            ctx="1.1",
            from_ms=0,
            cues=[{"t": 0, "v": "B"}, {"t": 80, "v": "X"}],
            final=True,
        )
        assert pipe.wire == [
            {
                "type": "avatar",
                "v": 1,
                "cmd": "cues",
                "ctx": "1.1",
                "from_ms": 0,
                "cues": [{"t": 0, "v": "B"}, {"t": 80, "v": "X"}],
                "final": True,
            }
        ]


async def test_a_queued_sentence_claims_the_floor_out_of_band() -> None:
    """The claim used to wait for the first audio frame, which is the moment the
    sound starts — an inbreath on top of the first syllable is not an inbreath."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.on_sentence_queued("4.1")
        assert pipe.drain() == ["state:TAKING_FLOOR", "interject:CLAIM_FLOOR"]
        await pipe.push(TTSAudioRawFrame(audio=b"\x00" * 96, sample_rate=24000, num_channels=1))
        assert pipe.drain() == []
        assert pipe.avatar.ctx == "4.1"


async def test_an_out_of_band_error_reaches_the_wire() -> None:
    """The session's observer is the only thing that can see an ErrorFrame — it
    travels upstream, behind this seat."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.on_error(fatal=False)
        assert pipe.drain() == ["state:DEGRADED"]
        await pipe.avatar.on_error(fatal=True)
        assert pipe.drain() == ["state:OFFLINE"]


async def test_send_lets_a_brain_override_the_heuristics() -> None:
    """`session.action("avatar", ...)` has to be able to say things the frame
    stream never implies — a state the pipeline has no evidence for."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.send(AvatarMessage.state(AvatarState.REVIEWING_SCREEN))
        assert pipe.sent == ["state:REVIEWING_SCREEN"]


async def test_the_processor_exposes_the_turn_context() -> None:
    async with AvatarPipe() as pipe:
        await pipe.push(TTSStartedFrame(context_id="7.3"))
        assert pipe.avatar.ctx == "7.3"


# ─── Failure ──────────────────────────────────────────────────────────────────


async def test_a_non_fatal_error_degrades_and_the_next_turn_recovers() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.push(ErrorFrame(error="tts websocket dropped"))
        assert pipe.drain() == ["state:DEGRADED"]
        await pipe.push(UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
        assert pipe.drain() == ["state:LISTENING", "user:True", "user:False", "state:THINKING"]


async def test_a_fatal_error_goes_offline_and_stays_there() -> None:
    """A fatal error cancels the pipeline, and a tearing-down pipeline keeps
    pushing frames — none of which may animate the face again."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.push(FatalErrorFrame(error="transport gone"))
        assert pipe.drain() == ["state:OFFLINE"]
        await pipe.push(UserStartedSpeakingFrame(), TTSStartedFrame(context_id="1.1"))
        assert pipe.drain() == []


# ─── Sentence audio ───────────────────────────────────────────────────────────


class RecordingSink:
    """Stands where the viseme engine stands, and only records.

    Structurally a `SentenceAudioSink`, which is the point: the processor was
    given a Protocol precisely so the state channel and the viseme stack never
    import each other, and a 10-line class here proves the seam is honest.
    """

    def __init__(self) -> None:
        self.sentences: list[tuple[str, bytes, list[tuple[str, float]]]] = []
        self.partials: list[tuple[str, bytes]] = []
        self.closed: list[str] = []
        self.ended: list[str] = []
        # Everything, in order — the ordering between a cut and the close is the
        # whole reason `final` is trustworthy.
        self.calls: list[tuple[str, str]] = []

    async def on_sentence_audio(self, ctx, pcm, word_timestamps=None) -> None:
        self.sentences.append((ctx, pcm, list(word_timestamps or ())))
        self.calls.append(("audio", ctx))

    async def on_sentence_partial(self, ctx, pcm) -> None:
        self.partials.append((ctx, pcm))
        self.calls.append(("partial", ctx))

    async def on_context_closed(self, ctx: str) -> None:
        self.closed.append(ctx)
        self.calls.append(("closed", ctx))

    async def end_turn(self, ctx: str) -> None:
        self.ended.append(ctx)
        self.calls.append(("end", ctx))


def pcm(byte: bytes, ms: int, ctx: str = "1.1") -> TTSAudioRawFrame:
    """`ms` milliseconds of a recognisable filler at 24 kHz mono s16le."""
    return TTSAudioRawFrame(
        audio=byte * (ms * 48), sample_rate=24000, num_channels=1, context_id=ctx
    )


async def test_a_boundary_hands_over_exactly_that_sentence() -> None:
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 100), pcm(b"a", 100))
        await pipe.avatar.on_sentence_boundary("1.1", [("hello", 0.0)])
        await pipe.settle()
        assert sink.sentences == [("1.1", b"a" * 9600, [("hello", 0.0)])]


async def test_sentence_two_gets_its_own_bytes_and_no_others() -> None:
    """The slice is cumulative: whatever the first sentence took, the second
    must not be charged again, or every cue in it lands late by that much."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 200))
        await pipe.avatar.on_sentence_boundary("1.1", [("one", 0.0)])
        await pipe.queue(pcm(b"b", 300))
        await pipe.avatar.on_sentence_boundary("1.1", [("two", 0.0)])
        await pipe.settle()
        assert [(c, len(p)) for c, p, _ in sink.sentences] == [("1.1", 9600), ("1.1", 14400)]
        assert set(sink.sentences[1][1]) == {ord("b")}


async def test_the_cut_lands_behind_the_audio_already_queued() -> None:
    """The hook fires from the TTS drain loop, which has only *queued* those
    frames here. Slicing at that instant would undercount by however far behind
    this processor is; queueing the marker puts it in its own audio's place."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        # Queue a full turn's worth without letting the loop run in between.
        for _ in range(20):
            await pipe.avatar.queue_frame(pcm(b"a", 20))
        await pipe.avatar.on_sentence_boundary("1.1", [("w", 0.0)])
        await pipe.settle()
        assert len(sink.sentences[0][1]) == 20 * 20 * 48


async def test_a_long_first_sentence_is_handed_over_as_a_prefix() -> None:
    """The turn's first sentence is the only one played off an estimate, and its
    boundary cannot arrive until its last byte does. So once enough of it exists,
    it goes over early — without being consumed."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 600))
        await pipe.settle()
        assert sink.partials == []  # below the threshold: nothing yet

        await pipe.queue(pcm(b"a", 700))
        await pipe.settle()
        assert [ctx for ctx, _ in sink.partials] == ["1.1"]
        # Everything held when the threshold was crossed — the frame that
        # crosses it is included, so this is the threshold or a little past it,
        # never less.
        assert len(sink.partials[0][1]) == 1300 * 48 >= EARLY_PARTIAL_BYTES

        # A peek, not a take: the boundary still gets the whole sentence, and
        # the byte count that places every later sentence is untouched.
        await pipe.queue(pcm(b"a", 200))
        await pipe.avatar.on_sentence_boundary("1.1", [("w", 0.0)])
        await pipe.settle()
        assert len(sink.sentences[0][1]) == 1500 * 48


async def test_only_the_first_sentence_of_a_turn_gets_a_prefix() -> None:
    """Sentence two is recognised before it is played — generation outruns
    playout — so an early pass there is churn, not a correction."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 1300))
        await pipe.avatar.on_sentence_boundary("1.1", [("one", 0.0)])
        await pipe.queue(pcm(b"b", 1300))
        await pipe.avatar.on_sentence_boundary("1.1", [("two", 0.0)])
        await pipe.settle()
        assert len(sink.partials) == 1
        assert set(sink.partials[0][1]) == {ord("a")}


async def test_the_next_turn_gets_its_own_prefix() -> None:
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 1300))
        await pipe.settle()
        await pipe.queue(BotStoppedSpeakingFrame())
        await pipe.settle()
        await pipe.queue(pcm(b"b", 1300, ctx="1.2"))
        await pipe.settle()
        assert [ctx for ctx, _ in sink.partials] == ["1.1", "1.2"]


async def test_keepalives_never_reach_the_recogniser() -> None:
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(
            TTSAudioRawFrame(audio=b"\x00\x00", sample_rate=24000, num_channels=1, context_id="1.1")
        )
        await pipe.queue(pcm(b"a", 50))
        await pipe.avatar.on_sentence_boundary("1.1", [])
        await pipe.settle()
        assert len(sink.sentences[0][1]) == 2400


async def test_the_boundary_marker_never_travels() -> None:
    """It is addressed to this processor. Anything downstream seeing it would
    be seeing avatar bookkeeping in the audio path."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 20))
        await pipe.avatar.on_sentence_boundary("1.1", [])
        await pipe.settle()
        assert not [
            f for f in pipe.downstream.frames if type(f).__name__ == "SentenceBoundaryFrame"
        ]


async def test_the_end_of_generation_closes_the_context_behind_its_last_sentence() -> None:
    """`TTSStoppedFrame` is appended to the *audio context*, so it drains behind
    the last sentence's audio and behind the boundary that cuts it. That
    ordering is what makes it a usable end-of-context signal: when it arrives,
    every cut for this turn is already at the engine."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 100))
        await pipe.avatar.on_sentence_boundary("1.1", [("w", 0.0)])
        await pipe.queue(TTSStoppedFrame(context_id="1.1"))
        await pipe.settle()
        assert sink.calls == [("audio", "1.1"), ("closed", "1.1")]


async def test_the_context_close_is_not_the_end_of_the_turn() -> None:
    """Generation stopping is not playout stopping. Ending the turn here would
    drop the cues for audio still queued in the transport."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 100))
        await pipe.queue(TTSStoppedFrame(context_id="1.1"))
        await pipe.settle()
        assert sink.ended == []
        await pipe.push(BotStoppedSpeakingFrame())
        assert sink.ended == ["1.1"]


async def test_barge_in_ends_the_turn_and_drops_its_bytes() -> None:
    """Cues for audio that will never be heard are worse than no cues: they
    would splice into the next turn's timeline."""
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 200))
        await pipe.settle()
        await pipe.push(InterruptionFrame())
        await pipe.avatar.on_sentence_boundary("1.1", [])
        await pipe.settle()
        assert sink.ended == ["1.1"]
        assert sink.sentences == []


async def test_a_finished_turn_is_closed_out() -> None:
    sink = RecordingSink()
    async with AvatarPipe(audio_sink=sink) as pipe:
        await pipe.queue(pcm(b"a", 20))
        await pipe.settle()
        await pipe.push(BotStoppedSpeakingFrame())
        assert sink.ended == ["1.1"]


async def test_with_no_sink_nothing_is_accumulated_at_all() -> None:
    """The overwhelming majority of frames on this seat are audio. With visemes
    off they must cost one isinstance check and a null test."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 200))
        await pipe.avatar.on_sentence_boundary("1.1", [("w", 0.0)])
        await pipe.settle()
        assert pipe.avatar.audio_sink is None
        assert not [
            f for f in pipe.downstream.frames if type(f).__name__ == "SentenceBoundaryFrame"
        ]


# ─── Silence ──────────────────────────────────────────────────────────────────


async def test_a_silent_session_says_nothing_after_idle() -> None:
    """Constraint: the avatar does nothing autonomous. Idle behaviour is the
    widget's; a server that fills silence nods at the wrong moment."""
    async with AvatarPipe() as pipe:
        assert pipe.drain() == ["state:IDLE"]
        for _ in range(50):
            await pipe.push(
                OutputAudioRawFrame(audio=b"\x00" * 320, sample_rate=16000, num_channels=1)
            )
        assert pipe.drain() == []
