"""Where the state channel and the viseme stack are introduced to each other.

Neither half imports the other. `processor.py` knows a structural
`SentenceAudioSink`; `visemes.py` knows an `emit` callback and nothing about
pipecat. That separation is deliberate — the avatar barrel must never drag the
native runtime into a session that has visemes switched off — and it leaves
exactly one place where the two shapes have to be reconciled. This is it, kept
a function rather than left as a paragraph of setup in an application, so a test
harness builds the same rig by calling it rather than by re-implementing it
slightly differently.

Two adaptations happen here and nowhere else:

- `VisemeEngine.emit(ctx, from_ms, cues, final)` is positional and carries
  `Cue` objects; `AvatarProcessor.push_cues` is keyword-only and carries wire
  dicts. `cues_to_wire` is the seam.
- A TTS service *may* expose `(context_id, ...)` sentence callbacks with no idea
  what an avatar is. They fan out to both consumers here: sentence-queued drives
  the floor claim *and* the fast viseme leg, and the boundary drives the
  accurate one. `SentenceHookTTS` is structural and the hooks are optional —
  stock pipecat services have neither, and the avatar degrades rather than
  refusing to run.

Not imported by `avatar/__init__.py`. Import it by name.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine, Sequence
from typing import Any, Protocol, runtime_checkable

from loguru import logger

from .processor import AvatarProcessor
from .avatarsync import (
    Cue,
    RhubarbPaths,
    RhubarbUnavailableError,
    VisemeRuntime,
    shared_pool,
)
from .visemes import VisemeEngine, cues_to_wire

# The language is whatever the TTS service stored after its own enum→string
# conversion. `durations.model_for` degrades by voice and then to the cross-voice
# mean, so a voice or lang the table has never seen costs accuracy in the *fast*
# leg only — the accurate leg measures real audio and does not care.
DEFAULT_LANG = "en"


def build_viseme_engine(
    processor: AvatarProcessor,
    *,
    enabled: bool = True,
    sample_rate: int,
    pad_ms: int = 0,
    runtime: VisemeRuntime | None = None,
) -> VisemeEngine | None:
    """The engine, or `None` if this node cannot or should not run it.

    Never raises. A missing binary is an ordinary condition on a platform we
    have not built for, and the right response is a state-channel-only session
    with one clear log line — the avatar still animates, it just moves its mouth
    on the widget's own amplitude fallback.

    The runtime is a **lease on a worker-wide pool**, not a process of this
    session's own. `avatarsync` is ~86 MB of acoustic model answering requests
    that take 15-31 ms; per-session processes made memory scale with concurrency
    for no throughput gain at all. See `avatarsync` for the sizing.

    `pad_ms` is the trailing silence your TTS appends to every sentence — zero
    for most, and cumulative if you get it wrong. `visemes.INTER_SENTENCE_PAD_MS`
    documents how to measure your own.
    """
    if not enabled:
        return None

    if runtime is None:
        try:
            paths = RhubarbPaths.resolve()
            paths.check()
        except RhubarbUnavailableError as exc:
            logger.warning("avatar: server-side lipsync disabled — {}", exc)
            return None
        except Exception:
            logger.exception("avatar: could not resolve the lipsync runtime; disabling it")
            return None
        runtime = shared_pool(paths).lease()

    async def emit(ctx: str, from_ms: int, cues: list[Cue], final: bool) -> None:
        await processor.push_cues(
            ctx=ctx,
            from_ms=from_ms,
            cues=cues_to_wire(cues),
            final=final,
        )

    engine = VisemeEngine(emit, runtime, sample_rate=sample_rate, pad_ms=pad_ms)
    processor.set_audio_sink(engine)
    # Spawn `avatarsync` now, in the background. Lazily started it starts on the
    # call's first sentence — ~250 ms charged to exactly the window the fast leg
    # exists to cover, so the one turn that genuinely needs predicted cues is the
    # one that would not get them in time. Only the worker's first session pays
    # it now that the pool is shared; every later one finds the model loaded.
    engine.prewarm()
    return engine


@runtime_checkable
class SentenceHookTTS(Protocol):
    """A TTS service that will tell us when a sentence is queued and when it ends.

    Structural, and optional. Stock pipecat TTS services do not have these
    hooks — an application adds them to its own TTS service if it wants the
    sharper timing — and the avatar has to work without them, because most
    deployments run a stock service. What is lost without them is stated in
    `attach_tts_hooks`.
    """

    def set_sentence_queued_listener(
        self, listener: Callable[[str, str], Coroutine[Any, Any, None]]
    ) -> None: ...

    def set_sentence_boundary_listener(
        self, listener: Callable[[str, Sequence[tuple[str, float]]], Coroutine[Any, Any, None]]
    ) -> None: ...


def attach_tts_hooks(
    tts: object,
    processor: AvatarProcessor,
    engine: VisemeEngine | None = None,
) -> bool:
    """Route the two TTS sentence hooks into the avatar, if this service has them.

    Both listeners are installed even with no engine: the floor claim is the
    half that matters most and it costs nothing but a state message.

    Returns whether anything was attached, and **a `False` is not a failure**.
    A service without these hooks costs the avatar two things, both survivable:
    the inbreath loses its lead (the floor claim falls back to
    `TTSStartedFrame`, which on most services is close enough to the first
    sample that `TAKING_FLOOR` reads as a flinch rather than an anticipation),
    and the fast text-predicted viseme leg never runs, so the head of each turn
    plays audio-recognised cues or none. Everything else is unaffected.
    """
    if not isinstance(tts, SentenceHookTTS):
        logger.info(
            "avatar: {} has no sentence hooks — floor claim falls back to TTSStarted "
            "and the predicted viseme leg is off",
            type(tts).__name__,
        )
        return False

    async def on_queued(context_id: str, text: str) -> None:
        # The claim first — it is the message with a deadline. The fast leg is
        # allowed to be a few hundred microseconds later; an inbreath is not.
        await processor.on_sentence_queued(context_id)
        if engine is not None:
            voice, lang = _voice_of(tts)
            await engine.on_sentence_queued(context_id, text, voice, lang)

    async def on_boundary(context_id: str, word_times: Sequence[tuple[str, float]]) -> None:
        await processor.on_sentence_boundary(context_id, word_times)

    tts.set_sentence_queued_listener(on_queued)
    if engine is not None:
        tts.set_sentence_boundary_listener(on_boundary)
    return True


def _voice_of(tts: object) -> tuple[str | None, str]:
    """Read the voice and language off the service, per sentence.

    Per sentence rather than once, because a brain can change the voice mid-call
    (`Session.configure_tts`) and the duration estimate is voice-specific. Wrapped
    in `getattr` because this is pipecat's private settings store: if its shape
    changes, the fast leg should fall back to the cross-voice mean, not raise on
    every sentence of every call.
    """
    settings = getattr(tts, "_settings", None)
    voice = getattr(settings, "voice", None)
    lang = getattr(settings, "language", None)
    return (
        voice if isinstance(voice, str) else None,
        lang if isinstance(lang, str) and lang else DEFAULT_LANG,
    )
