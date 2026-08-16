"""Serves the demo page and answers its WebRTC offer.

    cd py && uv run --group server python ../server/server.py
    open http://localhost:7860

Three jobs, and they are separate on purpose:

- **The page.** Served from this repo's working tree — `src/` and
  `client/dist/`, plus one pre-bundled copy of pipecat's browser packages, all
  with `Cache-Control: no-store`. Nothing of ours is bundled: `src/` is
  dependency-free ES modules by constraint and the browser loads it as-is. Edit
  a rig file, reload, see it.

  `no-store` is not paranoia. `python3 -m http.server` sends `Last-Modified`
  with no `Cache-Control`, browsers apply heuristic freshness, and they stop
  revalidating modules you have edited — that has cost this project three
  debugging sessions, one of which produced a module error that was a lie. See
  the repo's `authoring/serve.py`, which exists for the same reason.

- **The call.** `POST /api/offer` hands the SDP to pipecat's
  `SmallWebRTCRequestHandler`, which is also what the JS transport posts to by
  default. Each new peer connection starts one `run_bot` task; when the browser
  goes away the transport's disconnect handler cancels it.

- **The control plane.** `/api/lines`, `/api/say`, `/api/claim`, `/api/action`
  and `/api/misbehave`, all acting on the one call in progress. They live on the
  server because intent does: a page that could make the avatar nod by itself
  would be a client deciding what the agent is doing. See control.py, which also
  explains what each misbehaviour is trying to break.

Pipecat's own runner (`pipecat.runner.run`) would do the signalling half of this
in one line, but it serves its prebuilt client UI, and the page *is* what is
being demonstrated here.
"""

from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pydantic import BaseModel
from voqalize_avatar import AvatarAction, AvatarClaim

import control
from bot import DEFAULT_TTS, LINES, TTS_SERVICES, run_bot
from canned import CannedLines, CannedLLMService


class Say(BaseModel):
    id: str


class Claim(BaseModel):
    #: Absent or null clears the claim — see the endpoint.
    state: str | None = None


class Action(BaseModel):
    action: str


class Misbehave(BaseModel):
    kind: str


class Beats(BaseModel):
    """How long to hold each state before speaking. `0` skips one."""

    think_ms: int = 0
    work_ms: int = 0


HERE = Path(__file__).resolve().parent
REPO = HERE.parent


class NoStore(StaticFiles):
    """`StaticFiles` with the cache turned off — see the module docstring."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        return response


# Where each URL prefix comes from. `client/dist/*.js` imports `../../src/*.js`
# by relative path, so the first two mounts have to keep that shape: the browser
# resolves `/client/dist/createAvatar.js` → `/src/avatar.js` on its own. Both are
# served from the working tree — edit a rig file, reload, see it.
#
# `/vendor` is the exception, and it is third-party only: pipecat's browser
# packages ship ESM that still contains bare specifiers, so they are pre-bundled
# by `pnpm run server:vendor`. See vendor.entry.js.
MOUNTS = {
    "/src": REPO / "src",
    "/client/dist": REPO / "client" / "dist",
    "/vendor": HERE / "vendor",
}

MISSING = {
    "/src": "the repo looks incomplete",
    "/client/dist": "run `npm install && npm run build`",
    "/vendor": "run `pnpm run server:vendor`",
}


def build_app(tts_name: str) -> FastAPI:
    handler = SmallWebRTCRequestHandler()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await handler.close()

    app = FastAPI(lifespan=lifespan)

    for url, path in MOUNTS.items():
        if not path.is_dir():
            raise SystemExit(f"missing {path} — {MISSING[url]} (in {REPO})")
        app.mount(url, NoStore(directory=path), name=url)

    @app.get("/")
    async def page():
        return FileResponse(
            HERE / "index.html",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )

    @app.post("/api/offer")
    async def offer(request: SmallWebRTCRequest, background: BackgroundTasks):
        async def start(connection: SmallWebRTCConnection) -> None:
            # Queued rather than awaited: the SDP answer has to go back on this
            # request, and the call outlives it by minutes.
            background.add_task(run_bot, connection, tts_name)

        return await handler.handle_web_request(request, start)

    @app.patch("/api/offer")
    async def trickle(request: SmallWebRTCPatchRequest):
        await handler.handle_patch_request(request)
        return {"status": "success"}

    # ─── The control plane ──────────────────────────────────────────────
    #
    # The server owns intent, so driving the avatar by hand is an HTTP request
    # to the server — not a message the page invents. A page that could make the
    # avatar nod on its own would be a client deciding what the agent is doing,
    # which is the one thing this project does not allow (CLAUDE.md § Constraints).
    # These endpoints are also what the wire panel drives; see control.py.

    @app.get("/api/lines")
    async def corpus():
        """What this call can say, and what it can be told to do wrong."""
        lines = CannedLines.load(LINES)
        return {
            "lines": [
                {"id": n.id, "tag": n.tag, "text": n.text, "ms": sum(s.ms for s in n.sentences)}
                for n in lines.lines
            ],
            "claims": [str(c) for c in AvatarClaim],
            "actions": [str(a) for a in AvatarAction],
            "misbehaviours": control.MISBEHAVIOURS,
            # What a fresh call will do before it speaks, so a page can show the
            # real setting on load instead of a guess that disagrees with it.
            "beats": {
                "think_ms": CannedLLMService.DEFAULT_THINK_MS,
                "work_ms": CannedLLMService.DEFAULT_WORK_MS,
            },
        }

    def _live() -> control.Session:
        session = control.live()
        if session is None:
            raise HTTPException(status_code=409, detail="no call in progress")
        return session

    @app.post("/api/say")
    async def say(body: Say):
        try:
            line = await _live().say(body.id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"no line {body.id!r}") from None
        return {"said": line.id, "text": line.text}

    @app.post("/api/claim")
    async def claim(body: Claim):
        # `None` clears. That is a real command, not a missing one, which is why
        # the field is optional rather than the endpoint being two endpoints.
        try:
            state = AvatarClaim(body.state) if body.state else None
        except ValueError:
            raise HTTPException(status_code=404, detail=f"no claim {body.state!r}") from None
        await _live().claim(state)
        return {"claimed": body.state}

    @app.post("/api/action")
    async def action(body: Action):
        # Rejected here rather than passed through, because the endpoint that
        # sends an unknown action on purpose is `/api/misbehave` — a typo in this
        # one should be a 404, not an unwitting conformance test.
        try:
            action = AvatarAction(body.action)
        except ValueError:
            raise HTTPException(status_code=404, detail=f"no action {body.action!r}") from None
        await _live().action(action)
        return {"acted": body.action}

    @app.post("/api/beats")
    async def beats(body: Beats):
        """Change what the next turn does before it speaks.

        Takes effect on the next turn rather than this instant, which is why it
        answers with what it set and not with anything about the call: there is
        nothing to observe until somebody talks.
        """
        _live().beats(think_ms=body.think_ms, work_ms=body.work_ms)
        return {"think_ms": max(0, body.think_ms), "work_ms": max(0, body.work_ms)}

    @app.post("/api/misbehave")
    async def misbehave(body: Misbehave):
        try:
            await _live().misbehave(body.kind)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"no misbehaviour {body.kind!r}") from None
        return {"misbehaved": body.kind, "watch": control.MISBEHAVIOURS[body.kind]}

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--host", default="localhost")
    parser.add_argument(
        "--tts",
        choices=sorted(TTS_SERVICES),
        default=DEFAULT_TTS,
        help="which text-to-speech service the bot speaks with",
    )
    args = parser.parse_args()

    logger.info("avatar demo on http://{}:{} — tts {}", args.host, args.port, args.tts)
    uvicorn.run(build_app(args.tts), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
