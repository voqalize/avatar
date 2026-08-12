"""The processor's obligations, driven frame by frame.

The state machine's rules are tested next door as a pure function. What is left
here is everything the *processor* owes the pipeline: pass every frame through,
emit in the RTVI shape and the safe direction, stay reachable out of band (client
ready, the `send` escape hatch), and cut the audio stream into the chunks the
viseme engine is fed. Also the failure modes a real session cannot be asked to
produce on demand — a client that connects before StartFrame, and a host with no
native aligner.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    DataFrame,
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

from voqalize_avatar import AVATAR_MESSAGE_TYPE, AvatarClaim, AvatarControlFrame, AvatarMessage, AvatarProcessor
from voqalize_avatar.state_machine import AvatarStateMachine
from voqalize_avatar.sentence_audio import EARLY_PARTIAL_BYTES
from tests.helpers import AvatarPipe, sentence, spoken, word

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


async def test_a_nonstandard_tts_frame_without_context_never_invents_a_viseme_turn(
    engine: RecordingEngine,
) -> None:
    """FIFO browser binding is safe only for base-TTS context ids."""
    async with AvatarPipe() as pipe:
        await pipe.queue(TTSAudioRawFrame(audio=b"a" * 200, sample_rate=24000, num_channels=1))
        await pipe.settle()
        assert pipe.avatar._audio.pending("1.1") == 0
        assert engine.sentences == []


async def test_the_start_frame_reaches_the_transport_before_any_avatar_message() -> None:
    """StartFrame carries the sample rates every downstream service needs; it
    cannot wait behind our bookkeeping. It is also the gate: push_frame() drops
    everything silently until the processor has seen its own start."""
    async with AvatarPipe() as pipe:
        assert isinstance(pipe.downstream.frames[0], StartFrame)
        assert pipe.sent == []


async def test_messages_travel_downstream_in_the_rtvi_server_message_shape() -> None:
    """The RTVI observer fires on a push in either direction, so the choice is
    made by what else is in the way. Upstream of this seat sits the LLM service,
    whose serializer can claim `RTVIServerMessageFrame` and then block on an ack
    that never comes — so upstream is a deadlock and downstream is free."""
    async with AvatarPipe() as pipe:
        await pipe.push(AvatarControlFrame(AvatarMessage.claim(AvatarClaim.WORKING)))
        emitted = [f for f in pipe.downstream.frames if isinstance(f, RTVIServerMessageFrame)]
        assert emitted
        for frame in emitted:
            assert isinstance(frame.data, dict)
            assert frame.data["type"] == AVATAR_MESSAGE_TYPE
        # Not one travelled back toward the LLM.
        assert not [f for f in pipe.upstream.frames if isinstance(f, RTVIServerMessageFrame)]


# ─── Out-of-band entry points ─────────────────────────────────────────────────


async def test_client_ready_replays_the_current_server_claim() -> None:
    """The browser connects after the pipeline; without a resync it would sit
    in whatever pose it booted with."""
    async with AvatarPipe() as pipe:
        await pipe.push(AvatarControlFrame(AvatarMessage.claim(AvatarClaim.WORKING)))
        pipe.drain()
        await pipe.avatar.on_client_ready()
        assert pipe.sent == ["claim:WORKING"]


async def test_client_ready_before_the_start_frame_is_held_not_lost() -> None:
    """The order a real session actually produces (seen in the gato compat
    suite): the RTVI data channel is up, the browser says client-ready, and
    StartFrame is still several processors upstream. `push_frame()` drops
    anything sent before then, so the opening pose would never arrive — and the
    widget would hold whatever it booted with until the first state change.

        There is no synthetic idle message: the browser establishes its idle
        pose from Pipecat `BotReady`.
    """
    async with AvatarPipe(autostart=False) as pipe:
        await pipe.avatar.on_client_ready()
        assert pipe.sent == []
        await pipe.start()
        assert pipe.sent == []
        assert isinstance(pipe.downstream.frames[0], StartFrame)


async def test_send_lets_a_supervisor_override_the_heuristics() -> None:
    """Something outside the pipeline — an agent supervisor, an HTTP handler —
    has to be able to say what the frame stream never implies."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.avatar.send(AvatarMessage.action("ACK_RECEIVE"))
        assert pipe.sent == ["action:ACK_RECEIVE"]


@dataclass
class _MyToolCall(DataFrame):
    """An application's own tool frame — an LLM running out of process never
    produces pipecat's `FunctionCallsStartedFrame`."""


async def test_a_subclass_can_name_its_own_state_machine() -> None:
    """The documented seam for an application whose frames are its own spelling
    of something the library already models. It is a class attribute rather
    than a constructor argument because the front door takes no arguments —
    so what this actually pins is that `AvatarProcessor()` still has none."""

    class Mine(AvatarStateMachine):
        def on_frame(self, frame: Frame) -> Sequence[AvatarMessage]:
            if isinstance(frame, _MyToolCall):
                return self.tool_started("call-1")
            return super().on_frame(frame)

    class MyProcessor(AvatarProcessor):
        STATE_MACHINE = Mine

    async with AvatarPipe(cls=MyProcessor) as pipe:
        pipe.drain()
        await pipe.push(_MyToolCall())
        assert pipe.drain() == ["claim:WORKING"]
        # ...and everything the base machine does still happens underneath.
        await pipe.push(UserStartedSpeakingFrame())
        assert pipe.drain() == ["claim:None"]


# ─── Failure ──────────────────────────────────────────────────────────────────


async def test_a_non_fatal_error_degrades_and_the_next_turn_recovers() -> None:
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.push(ErrorFrame(error="tts websocket dropped"))
        assert pipe.drain() == []
        await pipe.push(UserStartedSpeakingFrame(), UserStoppedSpeakingFrame())
        assert pipe.drain() == ["claim:THINKING"]


async def test_a_fatal_error_goes_offline_and_stays_there() -> None:
    """A fatal error cancels the pipeline, and a tearing-down pipeline keeps
    pushing frames — none of which may animate the face again."""
    async with AvatarPipe() as pipe:
        pipe.drain()
        await pipe.push(FatalErrorFrame(error="transport gone"))
        assert pipe.drain() == []
        await pipe.push(UserStartedSpeakingFrame(), TTSStartedFrame(context_id="1.1"))
        assert pipe.drain() == []


# ─── Sentence audio ───────────────────────────────────────────────────────────


class RecordingEngine:
    """Stands where the viseme engine stands, and only records.

    Every call the processor makes on the engine lands here, in order — the
    ordering between a cut and the context close is the whole reason `final` is
    trustworthy on the wire.
    """

    def __init__(self) -> None:
        self.queued: list[tuple[str, str]] = []
        self.sentences: list[tuple[str, bytes, int | None]] = []
        self.partials: list[tuple[str, bytes]] = []
        self.closed: list[str] = []
        self.ended: list[str] = []
        self.calls: list[tuple[str, str]] = []

    async def on_sentence_queued(self, ctx: str, text: str) -> None:
        self.queued.append((ctx, text))
        self.calls.append(("queued", ctx))

    async def on_sentence_audio(self, ctx: str, pcm: bytes, *, sentences: int | None = 1) -> None:
        self.sentences.append((ctx, pcm, sentences))
        self.calls.append(("audio", ctx))

    async def on_sentence_partial(self, ctx: str, pcm: bytes) -> None:
        self.partials.append((ctx, pcm))
        self.calls.append(("partial", ctx))

    async def on_context_closed(self, ctx: str) -> None:
        self.closed.append(ctx)
        self.calls.append(("closed", ctx))

    async def end_turn(self, ctx: str) -> None:
        self.ended.append(ctx)
        self.calls.append(("end", ctx))

    async def aclose(self) -> None:
        self.calls.append(("aclose", ""))


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> RecordingEngine:
    """Swap the real engine out at its one construction site.

    The processor takes no arguments, so there is no seam to inject through —
    which is the point of the design and not an obstacle to testing it: the
    builder is a module-level function, and patching it is how a test says "the
    aligner is somebody else's problem today".
    """
    recorder = RecordingEngine()

    def build(emit: Any, *, sample_rate: int) -> RecordingEngine:
        recorder.sample_rate = sample_rate  # type: ignore[attr-defined]
        return recorder

    monkeypatch.setattr("voqalize_avatar.processor.build_viseme_engine", build)
    return recorder


def pcm(byte: bytes, ms: int, ctx: str = "1.1") -> TTSAudioRawFrame:
    """`ms` milliseconds of a recognisable filler at 24 kHz mono s16le."""
    return TTSAudioRawFrame(
        audio=byte * (ms * 48), sample_rate=24000, num_channels=1, context_id=ctx
    )


async def test_the_engine_is_built_at_the_sample_rate_the_pipeline_declared(
    engine: RecordingEngine,
) -> None:
    """`StartFrame.audio_out_sample_rate` is the whole configuration story — the
    engine takes nothing else. A hard-coded 24 kHz would mis-measure every cue
    offset on a 16 kHz service."""
    async with AvatarPipe():
        assert engine.sample_rate == 24000  # type: ignore[attr-defined]


async def test_an_announced_sentence_reaches_the_fast_leg(engine: RecordingEngine) -> None:
    """Text is on the wire ~450 ms before its audio. That head start is the fast
    leg's entire reason to exist."""
    async with AvatarPipe() as pipe:
        await pipe.push(sentence("Take your time.", "1.1"))
        assert engine.queued == [("1.1", "Take your time.")]


async def test_a_karaoke_word_is_not_an_announcement(engine: RecordingEngine) -> None:
    """`TTSTextFrame` subclasses the announcement frame and carries the same
    `will_be_spoken`. Without the negative isinstance check the fast leg would
    run once per *word* and the turn timeline would be nonsense."""
    async with AvatarPipe() as pipe:
        await pipe.push(word("Take", "1.1"), word("your", "1.1"))
        assert engine.queued == []


async def test_a_cut_hands_over_exactly_that_sentence(engine: RecordingEngine) -> None:
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 100), pcm(b"a", 100), spoken("time.", "1.1"))
        await pipe.settle()
        assert engine.sentences == [("1.1", b"a" * 9600, 1)]


async def test_a_word_mid_sentence_cuts_nothing(engine: RecordingEngine) -> None:
    """Every karaoke word is a progress frame; only the one with nothing left to
    say is the end of the slot."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 100), spoken("Take", "1.1", remaining=" your time."))
        await pipe.settle()
        assert engine.sentences == []


async def test_sentence_two_gets_its_own_bytes_and_no_others(engine: RecordingEngine) -> None:
    """The slice is cumulative: whatever the first sentence took, the second
    must not be charged again, or every cue in it lands late by that much."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 200), spoken("one.", "1.1"))
        await pipe.queue(pcm(b"b", 300), spoken("two.", "1.1"))
        await pipe.settle()
        assert [(c, len(p)) for c, p, _ in engine.sentences] == [("1.1", 9600), ("1.1", 14400)]
        assert set(engine.sentences[1][1]) == {ord("b")}


async def test_a_word_stream_cut_retires_one_sentence_however_many_are_announced(
    engine: RecordingEngine,
) -> None:
    """Text runs ahead of audio, so sentences two and three are usually already
    announced when sentence one's last word plays. Retiring them all here would
    strand nothing — it would *un*-strand them, onto offsets already spoken."""
    async with AvatarPipe() as pipe:
        await pipe.push(sentence("One.", "1.1"), sentence("Two.", "1.1"), sentence("Three.", "1.1"))
        await pipe.queue(pcm(b"a", 100), spoken("One.", "1.1"))
        await pipe.settle()
        assert [n for _, _, n in engine.sentences] == [1]


async def test_the_end_of_generation_retires_everything_still_predicted(
    engine: RecordingEngine,
) -> None:
    """A TTS with no word timestamps emits no progress frames at all, so the
    turn arrives as one chunk covering every sentence in it. `None` is that:
    all of them."""
    async with AvatarPipe() as pipe:
        await pipe.push(sentence("One.", "1.1"), sentence("Two.", "1.1"))
        await pipe.queue(pcm(b"a", 300), TTSStoppedFrame(context_id="1.1"))
        await pipe.settle()
        assert [n for _, _, n in engine.sentences] == [None]


async def test_the_cut_lands_behind_the_audio_already_queued(engine: RecordingEngine) -> None:
    """Both cut signals ride the TTS service's own audio-context queue, so they
    arrive behind the samples they describe. Reading the buffer any earlier
    undercharges this sentence and overcharges the next."""
    async with AvatarPipe() as pipe:
        # Queue a full turn's worth without letting the loop run in between.
        for _ in range(20):
            await pipe.avatar.queue_frame(pcm(b"a", 20))
        await pipe.queue(spoken("w", "1.1"))
        await pipe.settle()
        assert len(engine.sentences[0][1]) == 20 * 20 * 48


async def test_a_long_first_sentence_is_handed_over_as_a_prefix(engine: RecordingEngine) -> None:
    """The turn's first sentence is the only one played off an estimate, and its
    cut cannot arrive until its last byte does. So once enough of it exists,
    it goes over early — without being consumed."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 600))
        await pipe.settle()
        assert engine.partials == []  # below the threshold: nothing yet

        await pipe.queue(pcm(b"a", 700))
        await pipe.settle()
        assert [ctx for ctx, _ in engine.partials] == ["1.1"]
        # Everything held when the threshold was crossed — the frame that
        # crosses it is included, so this is the threshold or a little past it,
        # never less.
        assert len(engine.partials[0][1]) == 1300 * 48 >= EARLY_PARTIAL_BYTES

        # A peek, not a take: the cut still gets the whole sentence, and the
        # byte count that places every later sentence is untouched.
        await pipe.queue(pcm(b"a", 200), spoken("w", "1.1"))
        await pipe.settle()
        assert len(engine.sentences[0][1]) == 1500 * 48


async def test_only_the_first_sentence_of_a_turn_gets_a_prefix(engine: RecordingEngine) -> None:
    """Sentence two is recognised before it is played — generation outruns
    playout — so an early pass there is churn, not a correction."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 1300), spoken("one.", "1.1"))
        await pipe.queue(pcm(b"b", 1300), spoken("two.", "1.1"))
        await pipe.settle()
        assert len(engine.partials) == 1
        assert set(engine.partials[0][1]) == {ord("a")}


async def test_the_next_turn_gets_its_own_prefix(engine: RecordingEngine) -> None:
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 1300))
        await pipe.settle()
        await pipe.queue(BotStoppedSpeakingFrame())
        await pipe.settle()
        await pipe.queue(pcm(b"b", 1300, ctx="1.2"))
        await pipe.settle()
        assert [ctx for ctx, _ in engine.partials] == ["1.1", "1.2"]


async def test_keepalives_never_reach_the_recogniser(engine: RecordingEngine) -> None:
    async with AvatarPipe() as pipe:
        await pipe.queue(
            TTSAudioRawFrame(audio=b"\x00\x00", sample_rate=24000, num_channels=1, context_id="1.1")
        )
        await pipe.queue(pcm(b"a", 50), spoken("w", "1.1"))
        await pipe.settle()
        assert len(engine.sentences[0][1]) == 2400


async def test_the_end_of_generation_closes_the_context_behind_its_last_sentence(
    engine: RecordingEngine,
) -> None:
    """`TTSStoppedFrame` is appended to the *audio context*, so it drains behind
    the last sentence's audio and behind the word that cuts it. That ordering is
    what makes it a usable end-of-context signal: when it arrives, every cut for
    this turn is already at the engine."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 100), spoken("w", "1.1"))
        await pipe.queue(TTSStoppedFrame(context_id="1.1"))
        await pipe.settle()
        assert engine.calls == [("audio", "1.1"), ("closed", "1.1")]


async def test_the_context_close_is_not_the_end_of_the_turn(engine: RecordingEngine) -> None:
    """Generation stopping is not playout stopping. Ending the turn here would
    drop the cues for audio still queued in the transport."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 100))
        await pipe.queue(TTSStoppedFrame(context_id="1.1"))
        await pipe.settle()
        assert engine.ended == []
        await pipe.push(BotStoppedSpeakingFrame())
        assert engine.ended == ["1.1"]


async def test_barge_in_ends_the_turn_and_drops_its_bytes(engine: RecordingEngine) -> None:
    """Cues for audio that will never be heard are worse than no cues: they
    would splice into the next turn's timeline."""
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 200))
        await pipe.settle()
        await pipe.push(InterruptionFrame())
        await pipe.queue(spoken("w", "1.1"))
        await pipe.settle()
        assert engine.ended == ["1.1"]
        assert engine.sentences == []


async def test_a_finished_turn_is_closed_out(engine: RecordingEngine) -> None:
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 20))
        await pipe.settle()
        await pipe.push(BotStoppedSpeakingFrame())
        assert engine.ended == ["1.1"]


# ─── The degraded experience ──────────────────────────────────────────────────


async def test_a_missing_aligner_costs_the_lipsync_and_nothing_else(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The internal API fails fast; this seat is the wrapper that catches it.

    A platform we publish no wheel for must still get a working avatar — states,
    interjections, the floor claim — with a mouth that does not move. Anything
    that turned a missing binary into a dead call would be worse than no avatar
    at all.
    """

    def explode(emit: Any, *, sample_rate: int) -> None:
        raise FileNotFoundError("no avatarsync binary for sparc64")

    monkeypatch.setattr("voqalize_avatar.processor.build_viseme_engine", explode)
    async with AvatarPipe() as pipe:
        assert pipe.drain() == []
        await pipe.queue(sentence("Take your time.", "1.1"), pcm(b"a", 200), spoken("time.", "1.1"))
        await pipe.settle()
        await pipe.push(TTSStartedFrame(context_id="1.1"), BotStartedSpeakingFrame())
        assert pipe.drain() == []


async def test_with_no_engine_nothing_is_accumulated_at_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The overwhelming majority of frames on this seat are audio. With visemes
    off they must cost one isinstance check and a null test."""

    def explode(emit: Any, *, sample_rate: int) -> None:
        raise FileNotFoundError("no avatarsync binary for sparc64")

    monkeypatch.setattr("voqalize_avatar.processor.build_viseme_engine", explode)
    async with AvatarPipe() as pipe:
        await pipe.queue(pcm(b"a", 200), spoken("w", "1.1"))
        await pipe.settle()
        assert pipe.avatar._audio.pending("1.1") == 0


# ─── Silence ──────────────────────────────────────────────────────────────────


async def test_a_silent_session_says_nothing_after_idle() -> None:
    """Constraint: the avatar does nothing autonomous. Idle behaviour is the
    widget's; a server that fills silence nods at the wrong moment."""
    async with AvatarPipe() as pipe:
        assert pipe.drain() == []
        for _ in range(50):
            await pipe.push(
                OutputAudioRawFrame(audio=b"\x00" * 320, sample_rate=16000, num_channels=1)
            )
        assert pipe.drain() == []
