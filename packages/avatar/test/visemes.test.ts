import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LEAD_MS, VisemeTrack, normalizeCues } from "../src/visemes.js";

const NORMALIZATION_FIXTURE = new URL("./fixtures/viseme-normalization.json", import.meta.url);

describe("VisemeTrack presentation timing", () => {
  it("matches the shared Python/browser visible-cue normalization fixture", async () => {
    const fixture = JSON.parse(await readFile(NORMALIZATION_FIXTURE, "utf8"));
    for (const sample of fixture.cases) {
      // Compared on the keys the case declares, so a shape case stays about
      // shapes and only the phone cases assert a `p`. The browser also defaults
      // an absent `i` locally, which no case is about.
      const keys = [...new Set(sample.output.flatMap((cue: object) => Object.keys(cue)))];
      const project = (cue: Record<string, unknown>) =>
        Object.fromEntries(keys.map((k) => [k, cue[k] ?? null]));
      const actual = normalizeCues(sample.input).map(project);
      expect(actual, sample.name).toEqual(sample.output.map(project));
    }
  });

  it("uses the supplied utterance clock directly, without a renderer-wide visual lead", () => {
    expect(LEAD_MS).toBe(0);
    let clockMs = 0;
    const track = new VisemeTrack();
    track.start([
      { t: 0, v: "X" },
      { t: 500, v: "C" },
    ], () => clockMs);

    clockMs = 499;
    expect(track.sample()?.letter).toBe("X");

    clockMs = 500;
    expect(track.sample()?.letter).toBe("C");
  });

  it("carries a cue's phone through normalization and out of sample()", () => {
    // The nine letters are a lossy projection and nothing in this package
    // reads the finer signal, so the only way it can be wrong is by being
    // dropped — which is exactly what used to happen, one layer up.
    let clockMs = 0;
    const track = new VisemeTrack();
    track.start([
      { t: 0, v: "X" },
      { t: 100, v: "B", p: "TH" },
      { t: 200, v: "A" },
    ], () => clockMs);

    clockMs = 100;
    expect(track.sample()).toMatchObject({ letter: "B", phone: "TH" });
    clockMs = 200;
    expect(track.sample()).toMatchObject({ letter: "A", phone: null });
  });

  it("resumes when a later sentence's cues arrive after the track played out", () => {
    // OmniVoice's next sentence routinely lands after the previous one's tail,
    // and a track that stayed stopped froze the mouth through audible speech.
    let clockMs = 0;
    const track = new VisemeTrack();
    track.start([
      { t: 0, v: "C" },
      { t: 200, v: "X" },
    ], () => clockMs);

    clockMs = 100;
    expect(track.sample()?.letter).toBe("C");
    clockMs = 200 + track.tailMs + 1;
    expect(track.sample()).toBeNull();

    track.push([
      { t: 1000, v: "D" },
      { t: 1300, v: "X" },
    ]);
    clockMs = 1100;
    expect(track.sample()?.letter).toBe("D");
  });

  it("draws a closure on its own cue, not ahead of it", () => {
    // The server starts every closure early; a second lead here doubled it.
    let clockMs = 0;
    const track = new VisemeTrack();
    track.start([
      { t: 0, v: "D" },
      { t: 200, v: "A" },
      { t: 300, v: "X" },
    ], () => clockMs);

    clockMs = 180;
    expect(track.sample()?.letter).toBe("D");
    clockMs = 200;
    expect(track.sample()?.letter).toBe("A");
  });
});
