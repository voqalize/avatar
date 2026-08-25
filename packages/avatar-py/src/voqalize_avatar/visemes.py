"""The two-leg viseme engine: predicted cues now, recognised cues as audio arrives.

## Why two legs

Recognition needs audio, and the mouth has to move on the first sample. So:

- **Fast leg**, the moment a sentence is handed to TTS: predict a phone timeline
  from the text plus an estimated duration (`durations.py`), animate it, ~0.15 ms.
  Cues exist before the first audio sample does. This is the guarantee — audio
  never plays against a still face, whatever else fails.
- **Accurate leg**, from the first audio frame onward: a live decode fed as the
  frames arrive, read back mid-utterance, re-emitted every frame. It overwrites
  the predicted track from wherever recognition has reached.

The second leg used to wait for a whole sentence and decode it in one go, which
made the fast leg's coverage a function of sentence length: a long opening
sentence played entirely off an estimated duration whose median 8% error read as
a slip that "caught up" at sentence two. Streaming replaces that with a
correction that arrives continuously, roughly every 200 ms, from the moment there
is any audio at all.

## Overwrite, do not merge

Every emission from the accurate leg is *the whole track from a point*, never a
delta: `emit(ctx, from_ms, cues, final)` means discard queued cues at or after
`from_ms`, then append these. A cue the decoder later revises costs the frames
already drawn and nothing else.

That is deliberate and it is the reason there is no splice bookkeeping left here.
Merging a correction into a track means reasoning about which cues are the same
cue, and the answer is genuinely undecidable when a phone boundary moves — the
old code had a `_reemit_pending` step that existed only to put back the predicted
cues an accurate splice had knocked out. There may be a perceptible jump at the
instant recognition disagrees with the estimate. A jump is a bounded, one-frame
cost; a merge that drifts is unbounded.

## The hold-back

The decoder's own last few frames are not settled — a live phone loop backtraces
from the current frame, and the tail of that backtrace still moves as evidence
arrives. `ACCURATE_CUE_HOLD_BACK_MS` is how far behind the fed edge the accurate
track stops.
Measured on the corpus, a segment stops moving within 100 ms of the edge 85.2% of
the time, 200 ms 98.2%, 300 ms 99.6%.

100 ms rather than 200 because the remaining churn is not a cost here — the
overwrite absorbs it — while the lag is: generation runs 1.6-2.3x realtime, so
the client's playhead sits well behind the fed edge and every millisecond of
hold-back is a millisecond of that margin spent. Past the hold-back the predicted
track takes over, so there is never a hole; it is a question of which leg covers
audio that has not been played yet.

## Why the fast leg leads

The browser renders directly against its utterance clock, anchored by Pipecat's
`botStartedSpeaking` output-lifecycle event; it applies no renderer-wide lead.
Predicted cues need a **60 ms presentation lead**: their
duration error scatters either side of the truth, while a late mouth is much
less forgivable than an early one. The server therefore emits that explicit
60 ms cushion for the predicted leg only. Accurate cues receive no shift.

The distinction is intentional. A visual lead is not a substitute for
data-channel/media skew: the lifecycle epoch is the best clock the public
Pipecat seam exposes, and moving every cue cannot turn it into device playout.

## The turn timeline

Cue `t` is milliseconds from the turn's **first audio sample**, and the client
maps t=0 to Pipecat's `botStartedSpeaking` output epoch. The live decode is fed
that same audio from that same first sample, so its timeline *is* the turn
timeline — there is no offset arithmetic on the accurate leg at all, which is
most of what this module used to be. Offsets remain only on the predicted leg,
where a sentence's start has to be guessed until its audio has been counted.

Every wire byte counts the same whether it carries speech or silence. A service
that pads its sentences gets that pad recognised rather than declared: it is
silence in the PCM and comes back as `X`.

## Latching

The accurate leg is contingent. It gives up — permanently, for the turn — when

- the decoder pool refuses (`open_stream` returns None): every decoder is out,
  which is the pool's hard memory ceiling doing its job; or
- decode stops keeping up: cumulative decode time passes the configured accurate
  realtime-ratio threshold
  it has consumed, measured only once a turn is long enough for the numbers to
  mean anything.

Either way the turn finishes on predicted cues, which is a degradation and not a
failure — audio still plays against a moving mouth. There is no un-latch: a turn
that flips back and forth between legs would look worse than either. That
includes the turn's closing emission, which abandons an open stream rather than
finishing it — otherwise every latched turn would un-latch on its last message,
which is the most visible place for a seam to fall.

## Emission

Everything leaves through one injected callback. `AvatarProcessor` supplies it;
nothing here knows about pipecat frames, RTVI, or the transport.

## Fail fast

This is the internal API and it behaves like a library: `build_viseme_engine`
raises when the native aligner is not there, naming the path it looked at. The
pipecat wrapper is the layer that decides a missing library should cost the call
its lipsync rather than its audio — see `AvatarProcessor._start_visemes`.

## The latency rule

Nothing in this module may be awaited inline by a `process_frame`. Every entry
point hands work to a per-turn worker task and returns. An `AvatarsyncError`
costs one turn its accurate leg and never the call.

The same rule is why the runtime is pre-warmed (`prewarm()`): loading
`libavatarsync` costs ~250 ms (a 125k-entry dictionary, an 82 MB acoustic model
and a decoder warmup), and left to load lazily it loads *on the first sentence of
the call* — inside the very window the fast leg exists to cover. Pre-warming
happens in a background task, so it delays neither session setup nor a sentence
that beats it: a request arriving mid-load blocks on the engine's own start lock
and is served when the model is up.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from .durations import estimate_duration_ms
from .avatarsync import (
    AvatarsyncError,
    AvatarsyncPaths,
    Cue,
    VisemeRuntime,
    VisemeStream,
    shared_engine,
    shift,
)
from .timing import (
    ACCURATE_CUE_HOLD_BACK_MS,
    ACCURATE_CUE_LATCH_MIN_MS,
    ACCURATE_CUE_LATCH_RTF,
    MIN_VISIBLE_CUE_MS,
    PREDICTED_CUE_LEAD_MS,
)

# Streaming TTS websockets idle, and some send a tiny keepalive frame to hold the
# connection. Counting those as audio would shift every later cue by a fraction
# of a millisecond per idle gap, and the drift is cumulative over a turn.
KEEPALIVE_MAX_BYTES = 2

SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2

CLOSURES = frozenset("AG")
SILENT = "X"

EmitCues = Callable[[str, int, list[Cue], bool], Awaitable[None]]

# Wakes a turn's worker so it can retire. Not a job — it runs even when the turn
# has been abandoned, which is the whole reason it is distinguishable.
_STOP: Any = object()


def wire_ms(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> float:
    return len(pcm) / BYTES_PER_SAMPLE / sample_rate * 1000


def normalize_cues(cues: Sequence[Cue]) -> list[Cue]:
    """The widget's `normalizeCues`, applied server-side so we ship clean tracks.

    Deliberately a mirror of the client's rule rather than something stricter:
    if the two ever disagree, the disagreement is the bug, and having the same
    rule twice makes that visible in tests instead of on someone's face.

    **Deduplication is by shape, not by phone**, for that same reason — the
    client's rule is the one being mirrored and it has never seen a phone. So a
    run of cues sharing a shape collapses to its first, and that cue's `p` is the
    phone at the moment the *shape* changed. A renderer that wants the phone
    transitions inside a held shape (shape `B` covering S → T, say) is asking for
    a rule the client does not have yet, and getting it means changing both
    sides in lockstep. Until then this loses nothing the wire could carry.
    """
    out: list[Cue] = []
    for cue in sorted(cues, key=lambda c: c.t):
        letter = cue.v if cue.v in ("A", "B", "C", "D", "E", "F", "G", "H", "X") else SILENT
        if out and out[-1].v == letter:
            continue
        if out and cue.t - out[-1].t < MIN_VISIBLE_CUE_MS:
            if letter in CLOSURES:
                # A short closure can replace an intervening shape between two
                # copies of itself (G → F → G). The mouth never visibly left G,
                # so remove the swallowed middle cue rather than leaving a
                # duplicate G for the wire/client to rediscover.
                if len(out) > 1 and out[-2].v == letter:
                    out.pop()
                else:
                    out[-1] = Cue(t=out[-1].t, v=letter, p=cue.p)
            continue
        out.append(Cue(t=cue.t, v=letter, p=cue.p))
    return out


def _cue_at(cues: Sequence[Cue], t_ms: int) -> Cue | None:
    """The cue a track is showing at `t_ms` — the last one at or before it, or
    `None` before the first, which the widget reads as silence."""
    found: Cue | None = None
    for cue in cues:
        if cue.t > t_ms:
            break
        found = cue
    return found


def clip_track(cues: Sequence[Cue], from_ms: int) -> list[Cue]:
    """A track from `from_ms` onward, keeping the shape already in force there.

    The shape is carried rather than dropped because the caller is about to
    discard everything from `from_ms` on: a track that begins at the first
    *change* after that point leaves the mouth holding whatever preceded it for
    however long the next change takes to arrive, which on a held vowel is
    hundreds of milliseconds of visibly wrong face.
    """
    later = [cue for cue in cues if cue.t > from_ms]
    held = _cue_at(cues, from_ms)
    if held is None:
        return later
    return [Cue(t=from_ms, v=held.v, p=held.p), *later]


def lead_track(cues: Sequence[Cue], ms: int = PREDICTED_CUE_LEAD_MS) -> list[Cue]:
    """Slide a predicted track earlier by `ms`, clamped at the turn's first sample.

    Clamped rather than truncated, and the distinction matters: a cue pushed
    past zero means "this shape is already in force when playout starts", so the
    shape in force at zero survives at zero and the ones it superseded are
    dropped. Clamping each cue to zero instead would keep the *earliest* of them
    — a shape that is already over — and `normalize_cues` would then discard the
    right one as too short.
    """
    moved = [Cue(t=cue.t - ms, v=cue.v, p=cue.p) for cue in cues]
    if not moved or moved[0].t >= 0:
        return moved
    return clip_track(moved, 0)


def cues_to_wire(cues: Sequence[Cue]) -> list[dict[str, Any]]:
    """`{t, v, p?}` dicts, the shape the `cues` server-message carries.

    `p` is omitted during silence rather than sent as null — the wire cue is one
    per shape change in a stream of them, and a key that is absent half the time
    is smaller than one that is null half the time.
    """
    return [
        {"t": cue.t, "v": cue.v} if cue.p is None else {"t": cue.t, "v": cue.v, "p": cue.p}
        for cue in cues
    ]


@dataclass
class _Sentence:
    """One sentence, from "handed to TTS" until its audio has been counted."""

    text: str
    est_speech_ms: int
    # Cues relative to this sentence's own start, kept so the predicted tail can
    # be re-placed behind a moving accurate edge without re-running the leg.
    fast_cues: list[Cue] = field(default_factory=list)


@dataclass
class _Turn:
    ctx: str
    queue: asyncio.Queue[Any]
    worker: asyncio.Task[None]
    # Sentences announced whose audio has not been counted yet. These are what
    # the predicted tail is built from.
    pending: deque[_Sentence] = field(default_factory=deque)
    # Wire ms of every sentence whose audio has fully landed — the next
    # sentence's true start. Only moves on a boundary the caller supplies.
    resolved_wire_ms: float = 0.0

    sample_rate: int = 0
    stream: VisemeStream | None = None
    # None until the first audio frame; False once the accurate leg has given up
    # for this turn (pool refusal or falling behind), and it never goes back.
    accurate: bool | None = None
    # Every wire byte fed to the decoder, and how long decoding them took.
    fed_ms: float = 0.0
    decode_ms: float = 0.0
    # Nothing before this needs re-sending: it is settled, and on the accurate
    # leg it has also already been played.
    published_ms: int = 0

    closed: bool = False
    aborted: bool = False


def build_viseme_engine(emit: EmitCues, *, sample_rate: int = SAMPLE_RATE) -> VisemeEngine:
    """The engine, pre-warmed, leasing the worker's shared aligner.

    **Raises** `AvatarsyncUnavailableError` when the native aligner is not on
    this machine — the sdist, or a platform we publish no wheel for. This is the
    internal API: it says what is missing and where it looked. `AvatarProcessor`
    is the layer that decides that is survivable.

    The native half needs no configuration. The platform wheel carries the
    library and its model tree inside the package, so the common case is a
    `pip install` and nothing else; a source checkout of this repo is found by
    walking up to `native/avatarsync`.

    `sample_rate` is only a fallback for a turn that emits no audio. The real
    rate comes off each `TTSAudioRawFrame`, because that is the one place it is
    true: the pipeline's configured output rate is what the *transport* wants,
    and a TTS service is free to hand over something else and let pipecat
    resample it.

    The runtime is a **lease on a worker-wide engine**, not a model of this
    session's own. That is ~86 MB of acoustic model plus a bounded pool of live
    decoders; per-session copies made memory scale with concurrency for no
    throughput gain at all.
    """
    paths = AvatarsyncPaths.locate()
    paths.check()
    engine = VisemeEngine(emit, shared_engine(paths).lease(), sample_rate=sample_rate)
    # Load the library now, in the background. Lazily it loads on the call's
    # first sentence — ~250 ms charged to exactly the window the fast leg exists
    # to cover, so the one turn that genuinely needs predicted cues is the one
    # that would not get them in time. Only the worker's first session pays it;
    # every later one finds the model loaded.
    engine.prewarm()
    return engine


class VisemeEngine:
    """Turns sentences and their audio into cue tracks.

    One instance per session. `emit` is the only way anything leaves. The runtime
    is injected rather than defaulted — a silently self-constructed one is how a
    session ends up talking to a binary nobody chose; `build_viseme_engine` is
    the one place that chooses.
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
        # Workers of turns that have been abandoned and are still winding down.
        # They hold the only reference to their own stream, and dropping that on
        # the floor is how a decoder leaks.
        self._retiring: set[asyncio.Task[None]] = set()
        self._prewarm_task: asyncio.Task[None] | None = None

    # ---- startup -----------------------------------------------------------

    def prewarm(self) -> asyncio.Task[None]:
        """Load the model now rather than on the call's first sentence.

        Idempotent, and returns the task so a caller that genuinely wants to wait
        (a test) can. Nothing in a session ever does: the point is that setup
        does not block on a 250 ms model load, and a sentence that arrives first
        does not fail — `AvatarsyncEngine.start()` holds a lock that a request
        arriving mid-load waits on, rather than starting a second load.
        """
        if self._prewarm_task is None:
            self._prewarm_task = asyncio.create_task(self._start_runtime(), name="visemes:prewarm")
        return self._prewarm_task

    async def _start_runtime(self) -> None:
        try:
            await self._runtime.start()
        except Exception as exc:
            # Exactly as survivable as any other aligner failure: the first
            # sentence retries the load, and if that fails too the turn loses
            # its cues, not its audio.
            logger.warning(
                "avatar: lipsync runtime did not pre-warm ({}); it will start lazily", exc
            )

    # ---- entry points (never block the caller) -----------------------------

    async def on_sentence_queued(self, ctx: str, text: str) -> None:
        """A sentence has been handed to TTS. Predict its cues now."""
        turn = self._turn(ctx)
        sentence = _Sentence(text=text, est_speech_ms=estimate_duration_ms(text))
        turn.queue.put_nowait(lambda: self._run_fast_leg(turn, sentence))

    async def on_audio(self, ctx: str, pcm: bytes, *, sample_rate: int | None = None) -> None:
        """One TTS audio frame. Feed the decode and re-emit what it now knows.

        Called per frame, not per sentence: providers deliver 200-500 ms pieces
        and the whole point of the live decode is that it does not wait for a
        boundary. Keepalive frames are dropped here so no caller has to remember
        to.
        """
        if len(pcm) <= KEEPALIVE_MAX_BYTES:
            return
        turn = self._turn(ctx)
        if turn.sample_rate == 0:
            turn.sample_rate = sample_rate or self._sample_rate
        turn.queue.put_nowait(lambda: self._run_accurate_leg(turn, pcm))

    async def on_sentence_spoken(self, ctx: str) -> None:
        """Every sample of the oldest un-counted sentence has now been sent.

        This is a *bookkeeping* signal, not a decode trigger — it moves the point
        the predicted tail is laid out from, so later sentences stop being placed
        behind an estimate that has since been measured. A TTS service with no
        word timestamps never sends it; there the tail keeps its estimated
        offsets, which is what it had before any of this.
        """
        turn = self._turns.get(ctx)
        if turn is None:
            return
        turn.queue.put_nowait(lambda: self._resolve_sentence(turn))

    async def on_context_closed(self, ctx: str) -> None:
        """The TTS context is closed: no further audio belongs to this turn.

        Queued rather than acted on, so it lands *behind* every frame already
        handed over — which is what makes `final` deterministic rather than a
        race between the last audio frame and the frame that says it was the last.
        """
        turn = self._turns.get(ctx)
        if turn is None:
            return
        turn.queue.put_nowait(lambda: self._close_turn(turn))

    async def end_turn(self, ctx: str) -> None:
        """The turn is over (clean or interrupted). Drop its bookkeeping.

        Does not cancel the worker, and that is not laziness. A cancelled
        `run_in_executor` stops the *await*, not the thread: the decoder would
        still be inside a foreign call on this turn's stream while we freed it,
        which is a segfault rather than an exception. So the turn is flagged —
        every queued job becomes a no-op from here — and the worker is asked to
        retire, which it does after whatever call is already in flight returns.
        Nothing waits for that; the cost of a barge-in is one more decode nobody
        reads.
        """
        turn = self._turns.pop(ctx, None)
        if turn is None:
            return
        turn.aborted = True
        turn.queue.put_nowait(_STOP)
        self._retiring.add(turn.worker)
        turn.worker.add_done_callback(self._retiring.discard)

    async def flush(self, ctx: str) -> None:
        """Wait until every job handed over for this turn has run.

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
        # Retiring workers own the only reference to their decoder, so the
        # session is not closed until they have handed it back.
        if self._retiring:
            await asyncio.gather(*list(self._retiring), return_exceptions=True)
        task, self._prewarm_task = self._prewarm_task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self._runtime.stop()

    # ---- the worker --------------------------------------------------------

    def _turn(self, ctx: str) -> _Turn:
        turn = self._turns.get(ctx)
        if turn is None:
            queue: asyncio.Queue[Any] = asyncio.Queue()
            placeholder: Any = None
            turn = _Turn(ctx=ctx, queue=queue, worker=placeholder)
            # One worker per turn, so jobs run in the order they were handed
            # over. Ordering is not a nicety: a sentence's predicted offset
            # depends on how much audio has been counted, and the audio frames
            # doing the counting are in this same queue.
            turn.worker = asyncio.create_task(self._drain(turn), name=f"visemes:{ctx}")
            self._turns[ctx] = turn
        return turn

    async def _drain(self, turn: _Turn) -> None:
        try:
            while True:
                job = await turn.queue.get()
                try:
                    if job is _STOP:
                        return
                    if turn.aborted:
                        continue
                    await job()
                except AvatarsyncError as exc:
                    # The turn loses its accurate leg. The call does not notice.
                    logger.warning("viseme leg failed: {}", exc)
                    self._latch(turn, str(exc))
                except Exception:
                    logger.exception("viseme leg raised")
                finally:
                    turn.queue.task_done()
        finally:
            # The only place a stream is released. It runs after every job this
            # worker will ever run, on the same task that made the calls, so
            # there is no window in which the decoder is freed under a thread
            # still using it.
            stream, turn.stream = turn.stream, None
            if stream is not None:
                with contextlib.suppress(Exception):
                    await stream.close()

    # ---- the legs ----------------------------------------------------------

    async def _run_fast_leg(self, turn: _Turn, sentence: _Sentence) -> None:
        start_ms = self._projected_start_ms(turn)
        sentence.fast_cues = await self._runtime.text_cues(sentence.text, sentence.est_speech_ms)
        turn.pending.append(sentence)

        # Not emitted at all when recognition has already reached past this
        # sentence's projected start — its audio is here and decoded, so a
        # predicted track over it would be a correction in the wrong direction.
        track = clip_track(self._fast_track(sentence, start_ms), turn.published_ms)
        from_ms = max(0, start_ms - PREDICTED_CUE_LEAD_MS, turn.published_ms)
        if start_ms + sentence.est_speech_ms <= turn.published_ms or not track:
            return
        await self._emit(turn.ctx, from_ms, normalize_cues(track), False)

    async def _run_accurate_leg(self, turn: _Turn, pcm: bytes) -> None:
        turn.fed_ms += wire_ms(pcm, turn.sample_rate)
        stream = await self._ensure_stream(turn)
        if stream is None:
            return

        began = time.monotonic()
        await stream.feed(pcm)
        # The hold-back is applied here rather than inside the read so both
        # halves of the emission agree on where recognition stops and prediction
        # takes over. `edge_ms` is what has been *fed*; the decoder's own edge
        # trails it by under a millisecond at any rate we accept.
        edge_ms = max(0, round(turn.fed_ms) - ACCURATE_CUE_HOLD_BACK_MS)
        # The whole current sentence is rewritten every time, not just the stretch
        # past the last accurate edge. Publishing only forward would freeze each
        # 100 ms window under whatever the decoder believed when that window was
        # the live edge — and the live edge is the decoder at its worst, with the
        # least right context and the least converged CMN. Measured: rewriting
        # forward-only costs 11 points of frame agreement against a batch decode
        # of the same audio, and makes the result depend on the TTS frame size
        # (200 ms scored 8-12 points below 500 ms purely because it froze more
        # windows). Rewriting from the sentence start, the two cadences agree
        # exactly.
        #
        # The sentence and not the turn, because the cost is the emission: a
        # 46 s turn rewritten from zero on every frame is 65k cues and 1.7 MB on
        # the wire, and grows with the square of the turn. Per sentence it is
        # bounded by one sentence's cues and linear in the turn.
        splice_ms = round(turn.resolved_wire_ms)
        cues = await stream.cues(splice_ms, ACCURATE_CUE_HOLD_BACK_MS)
        turn.decode_ms += (time.monotonic() - began) * 1000

        # `cues` empty means recognition has nothing at all past what is already
        # published, so there is nothing to overwrite it *with*: emitting anyway
        # would discard the predicted cues covering that stretch and replace them
        # with a tail that starts later, leaving a hole.
        if edge_ms > turn.published_ms and cues:
            # One emission, both legs: recognised up to the edge, predicted after
            # it. They go together because the wire primitive discards from
            # `from_ms` — appending only the recognised part would silently take
            # the predicted tail with it, which is what the old `_reemit_pending`
            # existed to undo.
            track = [*cues, *self._predicted_tail(turn, edge_ms)]
            await self._emit(turn.ctx, splice_ms, normalize_cues(track), False)
            turn.published_ms = edge_ms

        if (
            turn.fed_ms >= ACCURATE_CUE_LATCH_MIN_MS
            and turn.decode_ms > turn.fed_ms * ACCURATE_CUE_LATCH_RTF
        ):
            self._latch(
                turn,
                f"decode is at {turn.decode_ms / turn.fed_ms:.2f}x realtime over "
                f"{turn.fed_ms / 1000:.1f}s",
            )

    async def _ensure_stream(self, turn: _Turn) -> VisemeStream | None:
        """The turn's live decode, opened on its first audio frame.

        `None` means this turn runs on predicted cues — either the pool refused,
        or something already made that decision.
        """
        if turn.accurate is False:
            return None
        if turn.stream is not None:
            return turn.stream
        stream = await self._runtime.open_stream(turn.sample_rate or self._sample_rate)
        if stream is None:
            self._latch(turn, "every decoder is in use")
            return None
        turn.stream = stream
        turn.accurate = True
        return stream

    def _latch(self, turn: _Turn, why: str) -> None:
        """Give up on the accurate leg for this turn, permanently.

        Permanently because a turn that flipped between legs would show the seam
        every time it flipped, and the predicted track is continuous. The stream
        is not closed here — the turn's end owns that, and closing it out from
        under a decode in flight is the one thing that is not survivable.
        """
        if turn.accurate is False:
            return
        turn.accurate = False
        logger.info("avatar: turn {} is on predicted cues — {}", turn.ctx, why)

    async def _resolve_sentence(self, turn: _Turn) -> None:
        if turn.pending:
            turn.pending.popleft()
        turn.resolved_wire_ms = turn.fed_ms

    async def _close_turn(self, turn: _Turn) -> None:
        """Emit the track that completes the turn, and say so.

        `final` rides it because this is the only emission we can promise nothing
        follows. Deliberately absent from an interrupted turn: `end_turn` flags
        the turn, so a turn that was cut never claims to have completed.
        """
        if turn.closed:
            return
        turn.closed = True

        stream, turn.stream = turn.stream, None
        # A latched turn does not finish its stream, it abandons it. `finish()`
        # is one more decode, and this turn latched precisely because decodes
        # were not arriving in time to be worth having — so its result would land
        # over audio that has already played, which is the correction-as-twitch
        # the latch exists to prevent. It would also be the turn's *last*
        # emission, so the seam would fall at the end of every latched turn, and
        # "there is no un-latch" would be true everywhere except where it shows.
        if stream is not None and turn.accurate is False:
            await stream.close()
            stream = None
        if stream is not None:
            try:
                # No hold-back: there is no more evidence coming, so the tail of
                # the backtrace is as settled as it will ever be.
                cues = await stream.finish()
            finally:
                await stream.close()
            end_ms = round(turn.fed_ms)
            track = clip_track([*cues, Cue(t=end_ms, v=SILENT)], turn.published_ms)
            await self._emit(turn.ctx, turn.published_ms, normalize_cues(track), True)
            turn.published_ms = end_ms
            return

        # Predicted all the way. Past every sentence, so a turn whose audio never
        # arrived keeps its predicted cues rather than being closed over them.
        end_ms = max(round(turn.fed_ms), self._projected_start_ms(turn), turn.published_ms)
        await self._emit(turn.ctx, end_ms, [Cue(t=end_ms, v=SILENT)], True)

    # ---- offsets and emission ---------------------------------------------

    def _projected_start_ms(self, turn: _Turn) -> int:
        """Where the next sentence starts: counted wire so far, plus estimates."""
        return round(turn.resolved_wire_ms + sum(s.est_speech_ms for s in turn.pending))

    def _predicted_tail(self, turn: _Turn, from_ms: int) -> list[Cue]:
        """Predicted cues for audio recognition has not reached yet.

        Laid out from the last counted boundary, so the estimate only has to
        cover the sentences after it rather than accumulating across the turn.
        """
        track: list[Cue] = []
        cursor = turn.resolved_wire_ms
        for sentence in turn.pending:
            track.extend(self._fast_track(sentence, round(cursor)))
            cursor += sentence.est_speech_ms
        if not track:
            return []
        return clip_track(track, from_ms)

    def _fast_track(self, sentence: _Sentence, start_ms: int) -> list[Cue]:
        """One sentence's predicted cues, on the turn timeline and led."""
        track = [
            *shift(sentence.fast_cues, start_ms),
            Cue(t=start_ms + sentence.est_speech_ms, v=SILENT),
        ]
        # The closing X gets the same server share of the lead as every other
        # cue. Holding it put would leave the mouth open for that extra interval
        # at the end of every sentence, creating a hanging-mouth artefact.
        return lead_track(track, PREDICTED_CUE_LEAD_MS)
