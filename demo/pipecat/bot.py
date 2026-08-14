"""The voice agent the demo page talks to — a stock pipecat cascade with one extra seat.

    transport.input() → stt → user → llm → tts → AvatarProcessor() → transport.output()

That seat is the entire integration. Nothing else in this file knows the avatar
exists: no callbacks reach into the TTS service, no wiring correlates text with
audio, and the pipeline would run identically with the line deleted — minus the
face. If that is not what you observe when you run this, the library is wrong,
not the demo.

Services are Google, and all three authenticate off one Application Default
Credentials login (`gcloud auth application-default login`). The LLM is Vertex
rather than the Gemini API precisely because Vertex takes ADC and the Gemini API
wants a separate key; one credential for the whole demo is the point.

The TTS is behind `TTS_SERVICES` because it is the one service the avatar's
accurate leg actually consumes — a different vendor means different frame sizes,
a different sample rate and different word timing, which is exactly the axis
worth being able to swap on the command line. STT and the LLM are not behind a
flag: nothing downstream of them can tell which one ran.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.google.stt import GoogleSTTService
from pipecat.services.google.tts import GoogleHttpTTSService, GoogleTTSService
from pipecat.services.google.vertex.llm import GoogleVertexLLMService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

from voqalize_avatar import AvatarProcessor

SYSTEM_INSTRUCTION = """\
You are on a live voice call and your replies are spoken aloud, so write for the
ear: short sentences, no lists, no markdown, no emoji, no stage directions.

Keep it to a sentence or two at a time and hand the turn back. When you need a
moment, say so out loud — "one moment", "let me think" — rather than going quiet.
Open by introducing yourself in one sentence and asking what they would like to
talk about.
"""


def _google_streaming() -> TTSService:
    """Google Cloud TTS over its streaming API — the realistic shape.

    Audio arrives in many small frames while the sentence is still being
    synthesised, which is the cadence the accurate viseme leg is built around.
    Streaming is Chirp 3 HD and Journey voices only; anything else needs the HTTP
    service below.
    """
    return GoogleTTSService(
        settings=GoogleTTSService.Settings(voice="en-US-Chirp3-HD-Charon"),
    )


def _google_http() -> TTSService:
    """The same vendor over its batch endpoint — every voice, coarser frames.

    Here as the fallback for a project that has not enabled the streaming voices,
    and as a second cadence to watch the avatar under: the whole sentence's audio
    lands at once, so the accurate leg overwrites the predicted one in a single
    correction instead of a stream of them.
    """
    return GoogleHttpTTSService(
        voice_id="en-US-Neural2-D",
        settings=GoogleHttpTTSService.Settings(),
    )


#: How long the vql-speech credential stays valid. Minted once per process here
#: rather than per session as PyGato does — this is a demo with one call at a
#: time, and an hour outlives any of them.
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


def _vql_speech() -> TTSService:
    """Voqalize's own TTS — Cartesia's protocol, a different host and credential.

    Worth having in the demo because it is the one TTS whose audio the avatar
    will meet in production, and because it is a genuinely different cadence
    again: omnivoice streams its own frame sizes at 24 kHz, which is the
    accurate leg's real workload rather than a stand-in for it.

    `url` has no default. vql-speech is not a public service, so a hostname
    baked in here would be a wrong guess for every reader of this repo except
    us — and this repo is public.
    """
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


#: The swap seam. Add a vendor by adding a zero-argument factory here; the
#: pipeline below neither knows nor cares which one ran.
TTS_SERVICES: dict[str, Callable[[], TTSService]] = {
    "google": _google_streaming,
    "google-http": _google_http,
    "vql-speech": _vql_speech,
}

DEFAULT_TTS = "google"


def project_id() -> str:
    """The GCP project for Vertex, which — unlike STT and TTS — must be named.

    Three sources, most-explicit first. The middle one matters: ADC's own
    `quota_project_id` is what `gcloud auth application-default
    set-quota-project` writes, whereas `default()`'s returned project falls back
    to the *CLI's* configured project — a different setting that drifts from ADC
    the moment you point one of them somewhere else. The credential the calls
    actually authenticate with is the better answer, so it wins.
    """
    value = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if value:
        return value

    from google.auth import default

    credentials, discovered = default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    resolved = getattr(credentials, "quota_project_id", None) or discovered
    if not resolved:
        raise RuntimeError(
            "No GCP project. Set GOOGLE_CLOUD_PROJECT, or re-run "
            "`gcloud auth application-default login` in a project."
        )
    return resolved


async def run_bot(connection: SmallWebRTCConnection, tts_name: str = DEFAULT_TTS) -> None:
    """One call, start to finish. Returns when the pipeline ends."""
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    stt = GoogleSTTService()
    tts = TTS_SERVICES[tts_name]()
    llm = GoogleVertexLLMService(
        project_id=project_id(),
        settings=GoogleVertexLLMService.Settings(
            model="gemini-2.5-flash",
            system_instruction=SYSTEM_INSTRUCTION,
        ),
    )

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    # The whole of the integration. It sits between the TTS and the output
    # transport, because that is where both halves of the lipsync exist at
    # generation speed: the sentence text on its way to synthesis, and the
    # samples on their way to the browser. See voqalize_avatar/processor.py.
    avatar = AvatarProcessor()

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            avatar,
            transport.output(),
            assistant_aggregator,
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
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("client disconnected")
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()
