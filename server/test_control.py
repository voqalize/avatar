"""The control plane, against what it puts on the wire.

The endpoints are the easy half and are tested for their edges — a typo must be
a 404, no call must be a 409. The half worth the file is `MISBEHAVIOURS`: every
one of them exists to send something *wrong*, and a misbehaviour that is quietly
well-formed proves nothing while looking like it proved something. So each is
run and its frames inspected, and the ones that claim to be malformed are
checked for being malformed in the specific way they advertise.

    cd server && uv run --project ../py --group server python -m pytest
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pipecat.frames.frames import Frame, LLMTextFrame
from voqalize_avatar import AvatarAction, AvatarClaim, AvatarControlFrame

import control
import server
from canned import CannedLines, CannedLLMService

LINES = Path(__file__).parent / "lines.json"


class FakeWorker:
    """Stands in for the pipeline: records what was queued at its head."""

    def __init__(self) -> None:
        self.frames: list[Frame] = []

    async def queue_frame(self, frame: Frame, direction=None) -> None:
        self.frames.append(frame)


class FakeLLM(CannedLLMService):
    """A real `CannedLLMService` with its push wired to the recorder.

    Subclassed rather than mocked because `say()` is the thing under test on the
    `/api/say` path, and a mock of it would assert that the test's own idea of a
    completion is correct.
    """

    def __init__(self, *, lines: CannedLines, worker: FakeWorker) -> None:
        super().__init__(lines=lines)
        self._worker = worker

    async def push_frame(self, frame: Frame, direction=None) -> None:
        self._worker.frames.append(frame)


@pytest.fixture
def lines() -> CannedLines:
    return CannedLines.load(LINES)


@pytest.fixture
def session(lines: CannedLines) -> control.Session:
    worker = FakeWorker()
    return control.Session(lines=lines, llm=FakeLLM(lines=lines, worker=worker), worker=worker)


@pytest.fixture
def live(session: control.Session):
    """Register `session` as the call in progress, and take it back down.

    The registry is module state — one server, one call — so a test that left it
    populated would make the next one's 409 assertion pass for the wrong reason.
    """
    control.register(session)
    yield session
    control.unregister(session)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # The static mounts refuse to start without `client/dist` and `server/vendor`,
    # neither of which a unit test should need built.
    monkeypatch.setattr(server, "MOUNTS", {})
    return TestClient(server.build_app("canned"))


def sent(session: control.Session) -> list[dict]:
    """Every avatar command the session queued, as it goes on the wire."""
    return [
        f.message.to_wire()
        for f in session.worker.frames  # type: ignore[attr-defined]
        if isinstance(f, AvatarControlFrame)
    ]


def spoken(session: control.Session) -> list[str]:
    return [
        f.text.strip()
        for f in session.worker.frames  # type: ignore[attr-defined]
        if isinstance(f, LLMTextFrame)
    ]


# --- the session ------------------------------------------------------------


async def test_a_claim_reaches_the_pipeline_as_a_control_frame(
    session: control.Session,
) -> None:
    await session.claim(AvatarClaim.WORKING)
    await session.claim(None)

    assert sent(session) == [
        {"type": "avatar", "cmd": "claim", "state": "WORKING"},
        {"type": "avatar", "cmd": "claim", "state": None},
    ]


async def test_say_speaks_the_line_asked_for_not_the_next_one(
    session: control.Session, lines: CannedLines
) -> None:
    """The round-robin is what a call does on its own; `/api/say` is a person
    pointing at one line, and the two must not fight."""
    wanted = lines.lines[3]
    assert wanted is not lines.lines[0], "pick a line the round-robin would not"

    await session.say(wanted.id)
    assert spoken(session) == [s.text for s in wanted.sentences]


async def test_an_unknown_line_is_an_error_not_a_silence(session: control.Session) -> None:
    with pytest.raises(KeyError):
        await session.say("no-such-line")


# --- the misbehaviours ------------------------------------------------------


@pytest.mark.parametrize("kind", sorted(control.MISBEHAVIOURS))
async def test_every_misbehaviour_actually_sends_something(
    session: control.Session, kind: str
) -> None:
    """A misbehaviour that emits nothing is a button that proves nothing."""
    await session.misbehave(kind)
    assert sent(session) or spoken(session), kind


async def test_the_malformed_ones_are_really_malformed(session: control.Session) -> None:
    """The whole value of these two is being outside the vocabulary. If the
    enums grow to include them, they stop testing anything and must be changed."""
    await session.misbehave("unknown-action")
    await session.misbehave("unknown-claim")

    wire = sent(session)
    actions = {m["id"] for m in wire if m["cmd"] == "action"}
    claims = {m["state"] for m in wire if m["cmd"] == "claim"}

    assert actions and not actions & {str(a) for a in AvatarAction}
    assert claims and not claims & {str(c) for c in AvatarClaim}


async def test_the_storm_is_a_storm(session: control.Session) -> None:
    await session.misbehave("action-storm")
    assert len([m for m in sent(session) if m["cmd"] == "action"]) == 12


async def test_the_claim_arrives_after_the_speech_it_contradicts(
    session: control.Session,
) -> None:
    """Order is the entire point of `claim-during-speech`: a claim sent *before*
    the line would be an ordinary claim, and the renderer would be right to
    honour it."""
    await session.misbehave("claim-during-speech")

    kinds = [
        type(f).__name__
        for f in session.worker.frames  # type: ignore[attr-defined]
        if isinstance(f, (LLMTextFrame, AvatarControlFrame))
    ]
    assert kinds[0] == "LLMTextFrame"
    assert kinds[-1] == "AvatarControlFrame"


# --- the endpoints ----------------------------------------------------------


def test_the_corpus_endpoint_describes_the_whole_surface(
    client: TestClient, lines: CannedLines
) -> None:
    """A page builds its buttons from this, so anything missing here is a
    control that cannot be reached from any UI."""
    body = client.get("/api/lines").json()

    assert [n["id"] for n in body["lines"]] == [n.id for n in lines.lines]
    assert body["claims"] == [str(c) for c in AvatarClaim]
    assert body["actions"] == [str(a) for a in AvatarAction]
    assert body["misbehaviours"] == control.MISBEHAVIOURS


def test_the_corpus_is_readable_with_no_call_in_progress(client: TestClient) -> None:
    """The page loads before it dials."""
    assert client.get("/api/lines").status_code == 200


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/say", {"id": "greet"}),
        ("/api/claim", {"state": "THINKING"}),
        ("/api/action", {"action": "ACK_NOD"}),
        ("/api/misbehave", {"kind": "action-storm"}),
    ],
)
def test_driving_a_call_that_is_not_happening_is_a_409(
    client: TestClient, path: str, body: dict
) -> None:
    assert client.post(path, json=body).status_code == 409


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/say", {"id": "no-such-line"}),
        ("/api/claim", {"state": "NAPPING"}),
        ("/api/action", {"action": "GESTURE_SOMERSAULT"}),
        ("/api/misbehave", {"kind": "explode"}),
    ],
)
def test_a_name_the_server_does_not_know_is_a_404(
    client: TestClient, live: control.Session, path: str, body: dict
) -> None:
    """Including on `/api/action`, whose whole neighbour endpoint exists to send
    an unknown action deliberately — a typo here must not become that."""
    assert client.post(path, json=body).status_code == 404


def test_the_endpoints_drive_the_live_call(client: TestClient, live: control.Session) -> None:
    assert client.post("/api/claim", json={"state": "WORKING"}).status_code == 200
    assert client.post("/api/action", json={"action": "ACK_NOD"}).status_code == 200
    assert client.post("/api/claim", json={}).status_code == 200

    assert sent(live) == [
        {"type": "avatar", "cmd": "claim", "state": "WORKING"},
        {"type": "avatar", "cmd": "action", "id": "ACK_NOD"},
        {"type": "avatar", "cmd": "claim", "state": None},
    ]


def test_a_new_call_replaces_the_old_one(
    client: TestClient, live: control.Session, lines: CannedLines
) -> None:
    """One call at a time is a decision, not an accident — so the second one
    wins and the first stops receiving, rather than both getting everything."""
    worker = FakeWorker()
    second = control.Session(lines=lines, llm=FakeLLM(lines=lines, worker=worker), worker=worker)
    control.register(second)
    try:
        client.post("/api/action", json={"action": "ACK_NOD"})
        assert sent(second) and not sent(live)

        # And the older call hanging up must not take the newer one's slot.
        control.unregister(live)
        assert control.live() is second
    finally:
        control.unregister(second)
