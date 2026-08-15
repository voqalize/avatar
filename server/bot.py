"""The voice agent the page talks to — a stock pipecat cascade with one extra seat.

    transport.input() → vad → turn → llm → tts → AvatarProcessor() → transport.output()

That seat is the entire integration. Nothing else in this file knows the avatar
exists: no callbacks reach into the TTS service, no wiring correlates text with
audio, and the pipeline would run identically with the line deleted — minus the
face. If that is not what you observe when you run this, the library is wrong,
not the server.

**It runs with no API key, no model download and no account.** The default LLM
and TTS are `server/canned.py`: a fixed corpus of sentences with a WAV recorded
for each. That is a deliberate trade — this server exists to show the avatar,
and the avatar is byte-identical whichever vendor spoke. Requiring a credential
before anyone can look at a talking head was the largest thing standing between
this repo and a reader.

There is no STT and no LLM context. Turn-taking is VAD and a timeout, so the
agent takes its turn when you stop talking rather than answering what you said —
which is the honest description of a canned corpus, and enough to exercise every
avatar state the wire has.

`--tts` is still a real swap, and it is the one that matters: the TTS is the only
service whose output the avatar's accurate leg consumes, so a different vendor
means different frame sizes, a different sample rate and different word timing.
The canned service cannot reproduce a live generator's *arrival* timing — its
audio already exists when synthesis starts — so verifying lipsync properly still
means `--tts google`. See README § Verifying lipsync.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.services.tts_service import TTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_start.vad_user_turn_start_strategy import VADUserTurnStartStrategy
from pipecat.turns.user_stop.speech_timeout_user_turn_stop_strategy import (
    SpeechTimeoutUserTurnStopStrategy,
)
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from voqalize_avatar import AvatarProcessor

from canned import CannedLines, CannedLLMService, CannedTTSService

#: The corpus. Sentences plus the WAV recorded for each; see canned.py.
LINES = Path(__file__).parent / "lines.json"


def _canned(lines: CannedLines) -> TTSService:
    """The default: play the clip recorded for each sentence. No credential."""
    return CannedTTSService(lines=lines)


def _google_streaming(lines: CannedLines) -> TTSService:
    """Google Cloud TTS over its streaming API — the realistic shape.

    Audio arrives in many small frames while the sentence is still being
    synthesised, which is the cadence the accurate viseme leg is built around.
    Streaming is Chirp 3 HD and Journey voices only; anything else needs the HTTP
    service below. Authenticates off `gcloud auth application-default login`.
    """
    from pipecat.services.google.tts import GoogleTTSService

    return GoogleTTSService(
        settings=GoogleTTSService.Settings(voice="en-US-Chirp3-HD-Charon"),
    )


def _google_http(lines: CannedLines) -> TTSService:
    """The same vendor over its batch endpoint — every voice, coarser frames.

    Here as the fallback for a project that has not enabled the streaming voices,
    and as a second cadence to watch the avatar under: the whole sentence's audio
    lands at once, so the accurate leg overwrites the predicted one in a single
    correction instead of a stream of them.
    """
    from pipecat.services.google.tts import GoogleHttpTTSService

    return GoogleHttpTTSService(
        voice_id="en-US-Neural2-D",
        settings=GoogleHttpTTSService.Settings(),
    )


#: How long the vql-speech credential stays valid. Minted once per process here
#: rather than per session as PyGato does — this serves one call at a time, and
#: an hour outlives any of them.
_VQL_SPEECH_TTL_SECONDS = 3600

#: vql-speech wire constants, not product config. Its TTS route gates on
#: `cartesia_version`, and it emits 24 kHz. Both mirror PyGato's `session.py`;
#: if the handshake starts 403-ing, that is the file to re-read.
_VQL_SPEECH_CARTESIA_VERSION = "2025-11-04"
_VQL_SPEECH_SAMPLE_RATE = 24_000


def _vql_speech_token() -> str:
    """Sign the credential vql-speech expects: an RS256 JWT, not a static key.

    The key is a path in `VQL_SPEECH_KEY_PEM` and is never read from this repo —
    everything committed here is public. vql-speech trusts a specific public key,
    so this has to be the private half of one it already knows; a key it has not
    been told about fails closed at the handshake with a 403.
    """
    key_path = os.environ.get("VQL_SPEECH_KEY_PEM")
    if not key_path:
        raise RuntimeError(
            "vql-speech needs a signing key: set VQL_SPEECH_KEY_PEM to the path "
            "of a PEM whose public half vql-speech trusts."
        )

    import jwt

    now = datetime.now(UTC)
    return jwt.encode(
        {
            "iss": "pygato",
            "aud": "vql-speech",
            "sub": "pygato",
            "iat": now,
            "exp": now + timedelta(seconds=_VQL_SPEECH_TTL_SECONDS),
        },
        Path(key_path).expanduser().read_bytes(),
        algorithm="RS256",
    )


def _vql_speech(lines: CannedLines) -> TTSService:
    """Voqalize's own TTS — Cartesia's protocol, a different host and credential.

    Worth having because it is the one TTS whose audio the avatar will meet in
    production, and because it is a genuinely different cadence again: omnivoice
    streams its own frame sizes at 24 kHz, which is the accurate leg's real
    workload rather than a stand-in for it.

    `url` has no default. vql-speech is not a public service, so a hostname baked
    in here would be a wrong guess for every reader of this repo except us — and
    this repo is public.
    """
    from pipecat.services.cartesia.tts import CartesiaTTSService
    from pipecat.transcriptions.language import Language

    url = os.environ.get("VQL_SPEECH_WS_URL")
    if not url:
        raise RuntimeError(
            "vql-speech needs a host: set VQL_SPEECH_WS_URL (its websocket base, "
            "e.g. wss://speech.<env>.example.com)."
        )

    return CartesiaTTSService(
        api_key=_vql_speech_token(),
        url=f"{url.rstrip('/')}/tts/websocket",
        cartesia_version=_VQL_SPEECH_CARTESIA_VERSION,
        sample_rate=_VQL_SPEECH_SAMPLE_RATE,
        # Everything through `settings=`. `CartesiaTTSService.__init__` applies
        # the deprecated `params=` only when `settings` is absent, so passing
        # both silently drops the language and leaves pipecat's hardcoded EN on
        # the wire — inaudible in English, wrong in anything else, because
        # vql-speech reads `language` to pick the voice-cloning reference clip.
        settings=CartesiaTTSService.Settings(
            voice=os.environ.get("VQL_SPEECH_VOICE", "omnivoice/gaurav"),
            model="sonic-2",
            language=Language.EN,
        ),
    )


#: The swap seam. Add a vendor by adding a factory here; the pipeline below
#: neither knows nor cares which one ran. Every vendor import is inside its own
#: factory, so `--tts canned` runs on a dependency set that has none of them.
TTS_SERVICES: dict[str, Callable[[CannedLines], TTSService]] = {
    "canned": _canned,
    "google": _google_streaming,
    "google-http": _google_http,
    "vql-speech": _vql_speech,
}

#: Zero credentials is the default, because the first run is the one that decides
#: whether there is a second.
DEFAULT_TTS = "canned"


def _turn_strategies() -> UserTurnStrategies:
    """Turn-taking with no STT in the pipeline.

    Both defaults have to go. `UserTurnStrategies` defaults its stop strategy to
    a downloaded smart-turn model — a 100 MB fetch on first run, which is the
    kind of surprise this server exists to avoid — and its start strategies
    include one keyed on transcriptions, which are never produced here. VAD in,
    a timeout out, and `wait_for_transcript=False` because otherwise the turn
    never ends: the strategy waits for a transcript that nothing will emit.
    """
    return UserTurnStrategies(
        start=[VADUserTurnStartStrategy()],
        stop=[SpeechTimeoutUserTurnStopStrategy(wait_for_transcript=False)],
    )


async def run_bot(connection: SmallWebRTCConnection, tts_name: str = DEFAULT_TTS) -> None:
    """One call, start to finish. Returns when the pipeline ends."""
    lines = CannedLines.load(LINES)
    logger.info("corpus: {} lines from {}", len(lines), LINES.name)

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    llm = CannedLLMService(lines=lines)
    tts = TTS_SERVICES[tts_name](lines)

    # The whole of the integration. It sits between the TTS and the output
    # transport, because that is where both halves of the lipsync exist at
    # generation speed: the sentence text on its way to synthesis, and the
    # samples on their way to the browser. See voqalize_avatar/processor.py.
    avatar = AvatarProcessor()

    pipeline = Pipeline(
        [
            transport.input(),
            # VAD detects speech; the turn processor decides what it means. Split
            # in two because only the second broadcasts interruptions, and an
            # avatar that keeps talking over you is the demo failing at the one
            # thing a listening face is for.
            VADProcessor(vad_analyzer=SileroVADAnalyzer()),
            UserTurnProcessor(user_turn_strategies=_turn_strategies()),
            llm,
            tts,
            avatar,
            transport.output(),
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # The browser's data channel is up. Everything the avatar said before it
        # existed went nowhere, so re-announce the current state — that is the
        # widget's opening pose — and only then start talking.
        await avatar.on_client_ready()
        await llm.say_next()

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("client disconnected")
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()
