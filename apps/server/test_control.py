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
from voqalize_avatar import AvatarAction, AvatarControlFrame, AvatarState

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
    # The static mounts refuse to start without `packages/avatar/dist` and `apps/server/vendor`,
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


async def test_a_state_reaches_the_pipeline_as_a_control_frame(
    session: control.Session,
) -> None:
    await session.state(AvatarState.WORKING)
    await session.state(None)

    assert sent(session) == [
        {"type": "avatar", "cmd": "state", "state": "WORKING"},
        {"type": "avatar", "cmd": "state", "state": None},
    ]


async def test_say_speaks_the_line_asked_for_not_the_next_one(
    session: control.Session, lines: CannedLines
) -> None:
    """The round-robin is what a call does on its own; `/api/say` is a person
    pointing at one line, and the two must not fight."""
    wanted = lines.lines[3]
    assert wanted is not lines.lines[0], "pick a line the round-robin would not"

    session.beats(think_ms=0, work_ms=0)
    await session.say(wanted.id)
    assert spoken(session) == [s.text for s in wanted.sentences]


async def test_saying_a_line_by_hand_still_runs_the_beats(session: control.Session) -> None:
    """Pointing at a line does not make it a different kind of speech. The
    states an application would be in before it talks are in front of this one
    too, or the panel that sets them would be showing something the only button
    that speaks never does.

    What goes on the wire is the ordinary frames those states are inferred
    *from* — no avatar command is authored here at all — so the assertion is on
    the completion's shape rather than on a `state` message.
    """
    session.beats(think_ms=1, work_ms=1)
    await session.say(session.lines.lines[0].id)

    kinds = [type(f).__name__ for f in session.worker.frames]  # type: ignore[attr-defined]
    assert kinds.index("LLMFullResponseStartFrame") == 0
    assert kinds.index("FunctionCallInProgressFrame") < kinds.index("LLMTextFrame")
    assert kinds.index("FunctionCallResultFrame") < kinds.index("LLMTextFrame")
    assert sent(session) == [], "the beats are inferred, not sent"


async def test_muting_puts_pipecat_frames_on_the_pipeline_and_nothing_else(
    session: control.Session,
) -> None:
    """The claim being made is that "has muted you" costs no wire verb.

    So the assertion is about what is *absent*: the avatar library says nothing
    here, and the face changes — if it does — because stock mute frames reached
    the browser through the RTVI observer.
    """
    await session.mute(True)
    await session.mute(False)

    kinds = [type(f).__name__ for f in session.worker.frames]  # type: ignore[attr-defined]
    assert kinds == ["UserMuteStartedFrame", "UserMuteStoppedFrame"]
    assert sent(session) == []


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


async def test_the_unrenderable_ones_are_really_unrenderable(session: control.Session) -> None:
    """The whole value of these two is being outside what the other end has.
    `unknown-state` is malformed — that list is closed — while `unknown-action`
    is a legal message with a name nothing here can render, which is the open
    vocabulary's own forward-compatibility rule pointed at the face. If either
    name becomes something this server offers, they stop testing anything."""
    await session.misbehave("unknown-action")
    await session.misbehave("unknown-state")

    wire = sent(session)
    actions = {m["id"] for m in wire if m["cmd"] == "action"}
    states = {m["state"] for m in wire if m["cmd"] == "state"}

    assert actions and not actions & ({str(a) for a in AvatarAction} | set(control.RENDERER_ACTIONS))
    assert states and not states & {str(c) for c in AvatarState}


async def test_the_storm_is_a_storm(session: control.Session) -> None:
    await session.misbehave("action-storm")
    assert len([m for m in sent(session) if m["cmd"] == "action"]) == 12


async def test_the_state_arrives_after_the_speech_it_contradicts(
    session: control.Session,
) -> None:
    """Order is the entire point of `state-during-speech`: the same message sent
    *before* the line would be an ordinary state, and the renderer would be
    right to honour it."""
    await session.misbehave("state-during-speech")

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
    assert body["states"] == [str(c) for c in AvatarState]
    assert body["actions"] == [str(a) for a in AvatarAction] + control.RENDERER_ACTIONS
    assert body["misbehaviours"] == control.MISBEHAVIOURS
    assert body["beats"] == {
        "think_ms": CannedLLMService.DEFAULT_THINK_MS,
        "work_ms": CannedLLMService.DEFAULT_WORK_MS,
    }
    assert {v["name"] for v in body["voices"]} == {"female", "male"}
    assert body["voice"] in {v["name"] for v in body["voices"]}


def test_the_corpus_is_readable_with_no_call_in_progress(client: TestClient) -> None:
    """The page loads before it dials."""
    assert client.get("/api/lines").status_code == 200


def test_choosing_a_voice_needs_no_call(client: TestClient) -> None:
    """The one control that works *only* while disconnected.

    Everything else here 409s without a call because it drives one. This is the
    opposite: the voice decides which recordings a call loads, so it is settled
    before there is a pipeline to tell — and asking mid-call would mean one
    sentence in one voice and the next in another."""
    assert client.post("/api/voice", json={"name": "male"}).json() == {"voice": "male"}
    assert client.get("/api/lines").json()["voice"] == "male"
    assert client.post("/api/voice", json={"name": "nobody"}).status_code == 404


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/say", {"id": "greet"}),
        ("/api/state", {"state": "THINKING"}),
        ("/api/action", {"action": "ACKNOWLEDGE"}),
        ("/api/misbehave", {"kind": "action-storm"}),
        ("/api/beats", {"think_ms": 500, "work_ms": 0}),
        ("/api/mute", {"on": True}),
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
        ("/api/state", {"state": "NAPPING"}),
        ("/api/action", {"action": "somersault please"}),
        ("/api/misbehave", {"kind": "explode"}),
    ],
)
def test_a_name_the_server_does_not_know_is_a_404(
    client: TestClient, live: control.Session, path: str, body: dict
) -> None:
    """Except on `/api/action`, where the 404 is only about the id's *shape*:
    the action vocabulary is open, so a well-formed name this server has never
    heard of is a legal message and the next test sends one."""
    assert client.post(path, json=body).status_code == 404


def test_an_action_this_server_never_published_is_still_sent(
    client: TestClient, live: control.Session
) -> None:
    """A caller driving a Blender avatar's own `NOD_ASSESS` is the case.

    This server cannot see which face is mounted — Studio picks one, and the
    name is resolved there — so validating against the list in `/api/lines`
    would have been this server inventing a closed vocabulary the wire does not
    have. What it still refuses is an id no avatar could own."""
    assert client.post("/api/action", json={"action": "NOD_ASSESS"}).status_code == 200
    assert {m["id"] for m in sent(live) if m["cmd"] == "action"} == {"NOD_ASSESS"}


def test_the_endpoints_drive_the_live_call(client: TestClient, live: control.Session) -> None:
    assert client.post("/api/state", json={"state": "WORKING"}).status_code == 200
    assert client.post("/api/action", json={"action": "ACKNOWLEDGE"}).status_code == 200
    # A name from the mounted renderer's own catalogue, which the endpoint takes
    # for the same reason the wire does: the server knows what is on the end.
    assert client.post("/api/action", json={"action": "GESTURE_WAIT"}).status_code == 200
    assert client.post("/api/state", json={}).status_code == 200

    assert sent(live) == [
        {"type": "avatar", "cmd": "state", "state": "WORKING"},
        {"type": "avatar", "cmd": "action", "id": "ACKNOWLEDGE"},
        {"type": "avatar", "cmd": "action", "id": "GESTURE_WAIT"},
        {"type": "avatar", "cmd": "state", "state": None},
    ]


def test_the_beats_endpoint_arms_the_next_turn(client: TestClient, live: control.Session) -> None:
    body = client.post("/api/beats", json={"think_ms": 250, "work_ms": 900})
    assert body.json() == {"think_ms": 250, "work_ms": 900}
    assert (live.llm.think_ms, live.llm.work_ms) == (250, 900)


def test_a_beat_cannot_be_negative(client: TestClient, live: control.Session) -> None:
    """A toggle that is off sends `0`; a slider that has been dragged past its
    own floor must land on off too, not on a `sleep` that returns instantly
    while the state it wraps still goes out."""
    assert client.post("/api/beats", json={"think_ms": -1, "work_ms": -1}).json() == {
        "think_ms": 0,
        "work_ms": 0,
    }
    assert (live.llm.think_ms, live.llm.work_ms) == (0, 0)


def test_a_new_call_replaces_the_old_one(
    client: TestClient, live: control.Session, lines: CannedLines
) -> None:
    """One call at a time is a decision, not an accident — so the second one
    wins and the first stops receiving, rather than both getting everything."""
    worker = FakeWorker()
    second = control.Session(lines=lines, llm=FakeLLM(lines=lines, worker=worker), worker=worker)
    control.register(second)
    try:
        client.post("/api/action", json={"action": "ACKNOWLEDGE"})
        assert sent(second) and not sent(live)

        # And the older call hanging up must not take the newer one's slot.
        control.unregister(live)
        assert control.live() is second
    finally:
        control.unregister(second)
