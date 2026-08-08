"""The two-leg viseme engine: fast cues now, accurate cues when the audio lands.

## Why two legs

Rhubarb needs a whole clip before it emits anything, so a naive sidecar adds its
full runtime to time-to-first-audio. But `animate()` — everything Rhubarb knows
about looking right — is a pure function of a phone timeline, and recognition
exists only to *discover* that timeline. Given a duration, the timeline can be
predicted instead.

So:

- **Fast leg**, the moment a sentence is handed to TTS: predict the timeline from
  text plus an estimated duration (`durations.py`), ~0.4 ms. Cues exist before
  the first audio sample does.
- **Accurate leg**, the moment that sentence's audio has fully arrived: real
  `phonetic` recognition over the PCM, ~15-31 ms, with the *true* duration. It
  replaces the not-yet-played tail.
- **Early leg**, once ~1.2 s of the turn's *first* sentence exists: the same
  recognition over a **prefix**, spliced in at `EARLY_SPLICE_MS`.

Only the first sentence of a turn genuinely plays fast-leg cues. Generation
outruns playout, so later sentences are usually accurate before their playout
begins — which is the fortunate shape, because the fast leg is at its best on
short utterances (86.7% frame agreement under 700 ms) and drifts to parity with
real recognition by ~2 s.

## Why there is an early leg

That fortunate shape has one hole, and it is the one people notice: the *first*
sentence of a turn is played entirely off an estimated duration, because its
boundary — the signal that says "this sentence is complete" — cannot arrive
until its last byte has. A 3 s opener is 3 s of predicted cues, and the estimate
is wrong by a median 8% (measured over 300 real clips), which is a visible slip
that then "catches up" at sentence two. That is exactly the artefact this leg
removes.

Recognition does not need the whole clip — it needs *a* clip. Run it on the
first 1.2 s and it agrees with the whole-clip result on 85% of frames (vs the
fast leg's 61%), provided the last ~100 ms is thrown away: `-cmn batch`
normalises over whatever it is given, and the final phone is half-heard. So the
early leg keeps `[EARLY_SPLICE_MS, held - EARLY_TAIL_GUARD_MS)` and re-places
the fast cues after it.

`EARLY_SPLICE_MS` is 500 rather than 0 because a splice must land *behind the
playhead*: the client discards its queued cues at `from_ms` and rewriting a
shape it is already showing is a twitch, not a correction. 500 ms is ~250 ms of
margin over when these cues actually arrive, and it is cheap — the fast leg is
at its most accurate in exactly that opening window.

The early leg does not resolve anything. It advances no cursor and consumes no
sentence; the real boundary still arrives, still recognises the whole clip, and
still splices from 0. This only makes the wait bearable.

## Why the fast leg leads

Predicted cues go out `FAST_LEAD_MS` early. Not because the estimate is biased —
it is not, its error scatters evenly either side of the truth — but because the
*tolerance* for that error is lopsided. A face that moves ahead of its sound is
forgiven to about -125 ms; a face that lags is objectionable past about +45 ms.
Centring a symmetric error on zero therefore spends half of it in a window three
times narrower than the other. Sliding the whole track earlier moves that half
into the side the eye forgives: against whole-clip recognition, frames inside
tolerance go 62.3% -> 71.7%, and frames on the late side 30% -> 13%. The total
error does not shrink at all. It only moves to where it does not read as wrong.

Only *predicted* tracks lead. The early and accurate legs take their times from
recognition over real audio, so their times are already right and a shift would
be an error rather than the removal of one — which is why `_emit_sentence` and
`_emit_chunk` are two paths and not one.

## The turn timeline

Cue `t` is milliseconds from the turn's **first audio sample**, and the client
anchors t=0 when bot playout starts. So offsets accumulate over *wire* bytes,
and every byte counts the same whether it carries speech or silence. Some TTS
services append a fixed tail of silence to each sentence; nothing here treats
that as a special case, because recognition already handles it — silence in the
PCM comes back as `X` cues, which is exactly what the pad should look like.

While earlier sentences are still unresolved, a later sentence's start is itself
an estimate. When an audio leg resolves sentence *k*, every still-pending
sentence after it is re-emitted at its corrected offset — from the fast cues we
already have, not by re-running the leg — and only when the correction actually
moved. That keeps the stream continuous instead of leaving a hole between "the
splice discarded it" and "its own audio arrived".

## Emission

Everything leaves through one injected callback, `emit(ctx, from_ms, cues,
final)`, meaning *discard queued cues at or after `from_ms`, then append these*.
`AvatarProcessor` supplies it; nothing here knows about pipecat frames, RTVI, or
the transport.

## Fail fast

This is the internal API and it behaves like a library: `build_viseme_engine`
raises when the native aligner is not there, naming the path it looked at. The
pipecat wrapper is the layer that decides a missing binary should cost the call
its lipsync rather than its audio — see `AvatarProcessor._start_visemes`.

## The latency rule

Nothing in this module may be awaited inline by a `process_frame`. Both entry
points hand work to a per-turn worker task and return; the fast leg is
fire-and-forget by construction, and the accurate leg chews on bytes the caller
already accumulated. A `RhubarbError` costs one sentence its cues and never the
call — degraded visemes beat a dropped turn.

The same rule is why the runtime is pre-warmed (`prewarm()`): `avatarsync` costs
~250 ms to spawn (an 82 MB acoustic model plus a decoder warmup), and left to
start lazily it starts *on the first sentence of the call* — inside the very
window the fast leg exists to cover. Pre-warming happens in a background task, so
it delays neither session setup nor a sentence that beats it: a request arriving
mid-startup blocks on the runtime's own start lock and is served when the process
is up.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from .durations import estimate_duration_ms
from .avatarsync import (
    Cue,
    RhubarbError,
    RhubarbPaths,
    VisemeRuntime,
    shared_pool,
    shift,
)

# Streaming TTS websockets idle, and some send a tiny keepalive frame to hold the
# connection. Counting those as audio would shift every later cue by a fraction
# of a millisecond per idle gap, and the drift is cumulative over a turn.
KEEPALIVE_MAX_BYTES = 2

SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2

# The widget drops cues shorter than this (avatar docs/contract-protocol.md
# § Speech), except that a closure replaces the cue it collapses into: A and G
# carry the most lip-reading information of any shape.
MIN_CUE_MS = 30
CLOSURES = frozenset("AG")
SILENT = "X"

# The early leg, above. The splice point is how much of the turn's first
# sentence the fast leg is allowed to keep; the guard is how much of the
# recognised prefix is thrown away because `-cmn batch` normalised over a clip
# that ends mid-phone. `sentence_audio.EARLY_PARTIAL_BYTES` decides when this
# runs.
EARLY_SPLICE_MS = 500
EARLY_TAIL_GUARD_MS = 100

# Predicted cues are emitted this much *early*. See "Why the fast leg leads",
# above: the error is symmetric and the tolerance window is not.
FAST_LEAD_MS = 60

EmitCues = Callable[[str, int, list[Cue], bool], Awaitable[None]]


def join_audio_chunks(chunks: Sequence[bytes]) -> bytes:
    """Concatenate wire chunks, dropping keepalives."""
    return b"".join(chunk for chunk in chunks if len(chunk) > KEEPALIVE_MAX_BYTES)


def wire_ms(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> float:
    return len(pcm) / BYTES_PER_SAMPLE / sample_rate * 1000


def normalize_cues(cues: Sequence[Cue]) -> list[Cue]:
    """The widget's `normalizeCues`, applied server-side so we ship clean tracks.

    Deliberately a mirror of the client's rule rather than something stricter:
    if the two ever disagree, the disagreement is the bug, and having the same
    rule twice makes that visible in tests instead of on someone's face.
    """
    out: list[Cue] = []
    for cue in sorted(cues, key=lambda c: c.t):
        letter = cue.v if cue.v in ("A", "B", "C", "D", "E", "F", "G", "H", "X") else SILENT
        if out and out[-1].v == letter:
            continue
        if out and cue.t - out[-1].t < MIN_CUE_MS:
            if letter in CLOSURES:
                out[-1] = Cue(t=out[-1].t, v=letter)
            continue
        out.append(Cue(t=cue.t, v=letter))
    return out


def _shape_at(cues: Sequence[Cue], t_ms: int) -> str:
    """The mouth shape a track is showing at `t_ms` — the last cue at or before
    it. Silence before the first cue, which is what the widget assumes too."""
    shape = SILENT
    for cue in cues:
        if cue.t > t_ms:
            break
        shape = cue.v
    return shape


def lead_track(cues: Sequence[Cue], ms: int = FAST_LEAD_MS) -> list[Cue]:
    """Slide a predicted track earlier by `ms`, clamped at the turn's first sample.

    Clamped rather than truncated, and the distinction matters: a cue pushed
    past zero means "this shape is already in force when playout starts", so the
    shape in force at zero survives at zero and the ones it superseded are
    dropped. Clamping each cue to zero instead would keep the *earliest* of them
    — a shape that is already over — and `normalize_cues` would then discard the
    right one as too short.
    """
    moved = [Cue(t=cue.t - ms, v=cue.v) for cue in cues]
    if not moved or moved[0].t >= 0:
        return moved
    return [Cue(t=0, v=_shape_at(moved, 0)), *(cue for cue in moved if cue.t > 0)]


def cues_to_wire(cues: Sequence[Cue]) -> list[dict[str, Any]]:
    """`{t, v}` dicts, the shape the `cues` server-message carries."""
    return [{"t": cue.t, "v": cue.v} for cue in cues]


@dataclass
class _Sentence:
    """One sentence, from "handed to TTS" to "its audio is fully here"."""

    text: str
    est_speech_ms: int
    # Cues relative to this sentence's own start, kept so a corrected offset can
    # be re-emitted without re-running the leg.
    fast_cues: list[Cue] = field(default_factory=list)
    emitted_start_ms: int | None = None


@dataclass
class _Turn:
    ctx: str
    queue: asyncio.Queue[Callable[[], Awaitable[None]]]
    worker: asyncio.Task[None]
    pending: deque[_Sentence] = field(default_factory=deque)
    # Wire ms of every sentence whose audio has fully landed. Sentences resolve
    # in order, so this is also the next sentence's true start.
    resolved_wire_ms: float = 0.0
    closed: bool = False
    # The early leg runs at most once per turn: it exists for the first
    # sentence, and every sentence after it is accurate before it is played.
    early_done: bool = False


def build_viseme_engine(emit: EmitCues, *, sample_rate: int) -> VisemeEngine:
    """The engine, pre-warmed, leasing the worker's shared aligner pool.

    **Raises** `RhubarbUnavailableError` when the native aligner is not on this
    machine — the sdist, or a platform we publish no wheel for. This is the
    internal API: it says what is missing and where it looked. `AvatarProcessor`
    is the layer that decides that is survivable.

    The native half needs no configuration. The platform wheel carries the
    aligner and its model tree inside the package, so the common case is a
    `pip install` and nothing else; a source checkout of this repo is found by
    walking up to `native/avatarsync`.

    The runtime is a **lease on a worker-wide pool**, not a process of this
    session's own. `avatarsync` is ~86 MB of acoustic model answering requests
    that take 15-31 ms; per-session processes made memory scale with concurrency
    for no throughput gain at all.
    """
    paths = RhubarbPaths.locate()
    paths.check()
    engine = VisemeEngine(emit, shared_pool(paths).lease(), sample_rate=sample_rate)
    # Spawn `avatarsync` now, in the background. Lazily started it starts on the
    # call's first sentence — ~250 ms charged to exactly the window the fast leg
    # exists to cover, so the one turn that genuinely needs predicted cues is the
    # one that would not get them in time. Only the worker's first session pays
    # it now that the pool is shared; every later one finds the model loaded.
    engine.prewarm()
    return engine


class VisemeEngine:
    """Turns sentences and their audio into spliced cue chunks.

    One instance per session. `emit` is the only way anything leaves. The runtime
    is injected rather than defaulted — a silently self-constructed one is how a
    session ends up talking to a binary nobody chose; `build_viseme_engine` is
    the one place that chooses.

    Trailing silence some services append to each sentence needs no declaring:
    it is wire time like any other, and recognition returns `X` for it.
    """

    def __init__(
        self,
        emit: EmitCues,
        runtime: VisemeRuntime,
        *,
        sample_rate: int = SAMPLE_RATE,
    ) -> None:
        self._emit = emit
        self._runtime = runtime
        self._sample_rate = sample_rate
        self._turns: dict[str, _Turn] = {}
        self._prewarm_task: asyncio.Task[None] | None = None

    # ---- startup -----------------------------------------------------------

    def prewarm(self) -> asyncio.Task[None]:
        """Spawn `avatarsync` now rather than on the call's first sentence.

        Idempotent, and returns the task so a caller that genuinely wants to wait
        (a test) can. Nothing in a session ever does: the point is that setup
        does not block on a 250 ms process spawn, and a sentence that arrives
        first does not fail — `RhubarbRuntime.start()` and `_request()` share one
        lock, so an early request waits for this task's process instead of
        starting a second one.
        """
        if self._prewarm_task is None:
            self._prewarm_task = asyncio.create_task(self._start_runtime(), name="visemes:prewarm")
        return self._prewarm_task

    async def _start_runtime(self) -> None:
        try:
            await self._runtime.start()
        except Exception as exc:
            # Exactly as survivable as any other rhubarb failure: the first
            # sentence retries the spawn, and if that fails too the turn loses
            # its cues, not its audio.
            logger.warning(
                "avatar: lipsync runtime did not pre-warm ({}); it will start lazily", exc
            )

    # ---- entry points (never block the caller) -----------------------------

    async def on_sentence_queued(self, ctx: str, text: str) -> None:
        """A sentence has been handed to TTS. Emit fast-leg cues for it."""
        turn = self._turn(ctx)
        sentence = _Sentence(text=text, est_speech_ms=estimate_duration_ms(text))
        turn.queue.put_nowait(lambda: self._run_fast_leg(turn, sentence))

    async def on_sentence_audio(
        self, ctx: str, pcm: bytes | Sequence[bytes], *, sentences: int | None = 1
    ) -> None:
        """A chunk of the turn's audio has fully arrived. Emit corrected cues.

        `pcm` may be the raw wire chunks; keepalives are dropped here so the
        caller never has to remember to.

        `sentences` is how many queued sentences this chunk covers, oldest first.
        Normally one — the caller cuts at each sentence boundary — but a TTS
        service with no word timestamps offers no boundary until the end of the
        turn, and then one chunk retires everything predicted for it: `None`
        means *all of them*. Getting this wrong does not misplace the chunk
        (offsets are byte-derived); it strands the covered sentences in
        `pending`, where they would be re-emitted at offsets that have already
        been spoken.

        No chunk is `final`: whether one is the turn's last is not knowable here,
        and pretending otherwise is what made `final` a dead flag. That answer
        arrives separately, as `on_context_closed`.
        """
        audio = pcm if isinstance(pcm, bytes) else join_audio_chunks(pcm)
        turn = self._turn(ctx)
        turn.queue.put_nowait(lambda: self._run_audio_leg(turn, audio, sentences))

    async def on_sentence_partial(self, ctx: str, pcm: bytes | Sequence[bytes]) -> None:
        """A prefix of the turn's first sentence exists. Correct it early.

        Queued behind the fast leg that predicted this same sentence, which is
        what makes `turn.pending[0]` the sentence this audio belongs to.
        """
        audio = pcm if isinstance(pcm, bytes) else join_audio_chunks(pcm)
        turn = self._turn(ctx)
        turn.queue.put_nowait(lambda: self._run_early_leg(turn, audio))

    async def on_context_closed(self, ctx: str) -> None:
        """The TTS context is closed: no further sentence belongs to this turn.

        Queued rather than acted on, so it lands *behind* every leg already
        handed over — which is what makes `final` deterministic rather than a
        race between the last audio leg and the frame that says it was the last.
        """
        turn = self._turns.get(ctx)
        if turn is None:
            return
        turn.queue.put_nowait(lambda: self._close_turn(turn))

    async def end_turn(self, ctx: str) -> None:
        """The turn is over (clean or interrupted). Drop its bookkeeping."""
        turn = self._turns.pop(ctx, None)
        if turn is None:
            return
        turn.worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await turn.worker

    async def flush(self, ctx: str) -> None:
        """Wait until every leg handed over for this turn has emitted.

        Never call this from a `process_frame` — it is the one method here that
        does wait on viseme work. It exists for shutdown, and for tests, which
        would otherwise have to sleep and guess.
        """
        turn = self._turns.get(ctx)
        if turn is not None:
            await turn.queue.join()

    async def aclose(self) -> None:
        for ctx in list(self._turns):
            await self.end_turn(ctx)
        task, self._prewarm_task = self._prewarm_task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self._runtime.stop()

    # ---- the legs ----------------------------------------------------------

    def _turn(self, ctx: str) -> _Turn:
        turn = self._turns.get(ctx)
        if turn is None:
            queue: asyncio.Queue[Callable[[], Awaitable[None]]] = asyncio.Queue()
            # One worker per turn, so the legs run in the order they were
            # handed over. Ordering is not a nicety: the fast leg for sentence
            # k+1 needs the offsets the audio leg for sentence k just resolved.
            worker = asyncio.create_task(self._drain(queue), name=f"visemes:{ctx}")
            turn = _Turn(ctx=ctx, queue=queue, worker=worker)
            self._turns[ctx] = turn
        return turn

    async def _drain(self, queue: asyncio.Queue[Callable[[], Awaitable[None]]]) -> None:
        while True:
            job = await queue.get()
            try:
                await job()
            except RhubarbError as exc:
                # One sentence loses its cues. The call does not notice.
                logger.warning("viseme leg failed: {}", exc)
            except Exception:
                logger.exception("viseme leg raised")
            finally:
                queue.task_done()

    async def _run_fast_leg(self, turn: _Turn, sentence: _Sentence) -> None:
        start_ms = self._projected_start_ms(turn)
        cues = await self._runtime.text_cues(sentence.text, sentence.est_speech_ms)
        sentence.fast_cues = cues
        turn.pending.append(sentence)
        await self._emit_sentence(turn, sentence, start_ms)

    async def _run_early_leg(self, turn: _Turn, pcm: bytes) -> None:
        """Recognise a prefix of the turn's first sentence and splice it in.

        Everything this does *not* do is the interesting part. It does not pop
        the sentence, advance `resolved_wire_ms`, or close the mouth at the end
        of what it recognised — the sentence is still in flight, and a closing
        `X` here would shut the mouth mid-word. It only replaces predicted cues
        with recognised ones in a window that has not been played yet.
        """
        if turn.early_done or turn.resolved_wire_ms > 0 or not turn.pending:
            # Either the boundary beat us to it (a sentence shorter than the
            # trigger, or a slow worker), or this is not the first sentence.
            return
        turn.early_done = True

        start_ms = round(turn.resolved_wire_ms)
        # The prefix is raw wire, so it is speech: the 250 ms pad is appended
        # after the sentence, and we are nowhere near the end of it.
        end_ms = start_ms + round(wire_ms(pcm, self._sample_rate)) - EARLY_TAIL_GUARD_MS
        splice_ms = start_ms + EARLY_SPLICE_MS
        if end_ms - splice_ms < MIN_CUE_MS:
            # Nothing would survive the splice. Leave the fast cues alone.
            return

        cues = shift(await self._runtime.audio_cues(pcm, self._sample_rate), start_ms)
        if not cues:
            return
        # Open with the shape recognition says is in force *at* the splice, so
        # the mouth does not hold whatever the fast leg left there until the
        # next recognised cue happens to land.
        window = [
            Cue(t=splice_ms, v=_shape_at(cues, splice_ms)),
            *(cue for cue in cues if splice_ms < cue.t < end_ms),
        ]
        await self._emit(turn.ctx, splice_ms, normalize_cues(window), False)
        await self._resume_fast(turn, end_ms)

    async def _resume_fast(self, turn: _Turn, from_ms: int) -> None:
        """Put the predicted cues back after `from_ms`, which a splice just cut.

        `_reemit_pending` cannot do this job: it re-places sentences whose
        *offset* moved, and the early leg moves nobody's offset — it lands inside
        sentence one, which is still pending at the same start it always had. So
        that sentence needs its tail restored explicitly, and the ones after it
        need re-sending because `from_ms` discarded them wholesale.
        """
        cursor = turn.resolved_wire_ms
        for sentence in turn.pending:
            start_ms = round(cursor)
            cursor += sentence.est_speech_ms
            # `from_ms` is a recognised boundary, so predicted cues resume *at*
            # it and never before — including via the lead, which would
            # otherwise let a sentence starting near the splice overwrite the
            # last `FAST_LEAD_MS` of real recognition with a guess. Each
            # sentence gets its own `from_ms` so the second does not discard
            # the first.
            at = max(from_ms, start_ms - FAST_LEAD_MS)
            tail = [cue for cue in self._fast_track(sentence, start_ms) if cue.t >= at]
            if tail:
                # A sentence wholly behind the splice leaves nothing here.
                await self._emit(turn.ctx, at, normalize_cues(tail), False)

    async def _run_audio_leg(self, turn: _Turn, pcm: bytes, sentences: int | None) -> None:
        total_ms = wire_ms(pcm, self._sample_rate)
        start_ms = round(turn.resolved_wire_ms)

        # Every sentence this chunk covers is now resolved by measurement, so
        # none of them may be re-emitted from its estimate.
        n = len(turn.pending) if sentences is None else min(sentences, len(turn.pending))
        covered = [turn.pending.popleft() for _ in range(n)]
        turn.resolved_wire_ms += total_ms

        # The whole chunk, silence included. A service that pads its sentences
        # gets that pad recognised rather than declared: rhubarb reads it as the
        # silence it is and returns `X`, which is the cue we would have had to
        # synthesize anyway. Trimming it first would buy a base64 round trip on
        # 12 kB of zeros at the price of a number every caller has to measure.
        cues: list[Cue] = []
        if pcm:
            cues = await self._runtime.audio_cues(pcm, self._sample_rate)

        await self._emit_chunk(turn.ctx, start_ms, cues, round(total_ms))

        for sentence in covered:
            sentence.emitted_start_ms = start_ms
        await self._reemit_pending(turn)

    async def _close_turn(self, turn: _Turn) -> None:
        """Emit the chunk that completes the turn's track, and say so.

        Every sentence closes its own mouth at the end of its *speech*, one pad
        short of its wire. Nothing places the end of the turn's audio itself,
        which is where this lands a final `X` — the only cue in a track that
        describes the turn rather than a sentence in it.

        `final` rides it because a chunk is the only thing the wire has to hang
        it on, and this is the only chunk we can promise nothing follows.
        Deliberately absent from an interrupted turn: `end_turn` cancels this
        worker, so a turn that was cut never claims to have completed.
        """
        if turn.closed:
            return
        turn.closed = True
        # Past every sentence, resolved or still only estimated: a sentence whose
        # audio never arrived keeps its fast cues rather than being spliced away.
        end_ms = self._projected_start_ms(turn)
        await self._emit(turn.ctx, end_ms, [Cue(t=end_ms, v=SILENT)], True)

    # ---- offsets and emission ---------------------------------------------

    def _projected_start_ms(self, turn: _Turn) -> int:
        """Where the next sentence starts: measured wire so far, plus estimates."""
        return round(turn.resolved_wire_ms + sum(s.est_speech_ms for s in turn.pending))

    async def _reemit_pending(self, turn: _Turn) -> None:
        """Re-place still-pending sentences after a splice moved the ground.

        Emitting the accurate chunk with `from_ms = start` discards every queued
        cue at or after it — including the fast-leg cues for sentences that have
        not been spoken yet. Those are re-sent here at their corrected offsets,
        from cues we already hold, so a splice never leaves a gap. Silent when
        the estimate was right, which is the common case.
        """
        cursor = turn.resolved_wire_ms
        for sentence in turn.pending:
            start_ms = round(cursor)
            cursor += sentence.est_speech_ms
            if sentence.emitted_start_ms == start_ms:
                continue
            await self._emit_sentence(turn, sentence, start_ms)

    def _fast_track(self, sentence: _Sentence, start_ms: int) -> list[Cue]:
        """One sentence's predicted cues, on the turn timeline and led."""
        track = [
            *shift(sentence.fast_cues, start_ms),
            Cue(t=start_ms + sentence.est_speech_ms, v=SILENT),
        ]
        # The closing X leads with everything else. Holding it put would leave
        # the mouth open `FAST_LEAD_MS` longer at the end of every sentence,
        # which is the hanging-mouth artefact the X exists to prevent.
        return lead_track(track)

    async def _emit_sentence(self, turn: _Turn, sentence: _Sentence, start_ms: int) -> None:
        sentence.emitted_start_ms = start_ms
        track = self._fast_track(sentence, start_ms)
        # `from_ms` moves with the track: it means "discard from here", and cues
        # appended before it would sit behind what the client kept.
        await self._emit(turn.ctx, max(0, start_ms - FAST_LEAD_MS), normalize_cues(track), False)

    async def _emit_chunk(
        self, ctx: str, start_ms: int, cues: Sequence[Cue], chunk_ms: int
    ) -> None:
        """Shift a *recognised* track onto the turn timeline, close it, emit.

        No lead here — these times were measured against the audio they describe.
        Predicted tracks go out through `_emit_sentence`.

        Never `final`: a sentence's chunk cannot be the one that completes the
        turn, because a later sentence may still re-place it. Only `_close_turn`
        emits with `final` set.
        """
        # Close at the chunk's true end. Recognition normally lands an X on any
        # trailing silence itself, so this usually collapses into that one; it
        # matters when the chunk ends mid-shape, where without it the widget
        # holds the last cue open until the next sentence arrives.
        track = [*shift(cues, start_ms), Cue(t=start_ms + chunk_ms, v=SILENT)]
        await self._emit(ctx, start_ms, normalize_cues(track), False)
