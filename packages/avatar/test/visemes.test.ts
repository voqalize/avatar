import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LEAD_MS, VisemeTrack, normalizeCues } from "../src/visemes.js";

const NORMALIZATION_FIXTURE = new URL("./fixtures/viseme-normalization.json", import.meta.url);

describe("VisemeTrack presentation timing", () => {
  it("matches the shared Python/browser visible-cue normalization fixture", async () => {
    const fixture = JSON.parse(await readFile(NORMALIZATION_FIXTURE, "utf8"));
    for (const sample of fixture.cases) {
      const actual = normalizeCues(sample.input).map(({ t, v }) => ({ t, v }));
      expect(actual, sample.name).toEqual(sample.output);
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
});
