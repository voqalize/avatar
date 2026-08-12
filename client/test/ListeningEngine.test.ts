import { describe, expect, it, vi } from "vitest";
import { ListeningEngine } from "../../src/idle.js";

describe("ListeningEngine", () => {
  it("never autonomously emits a facial acknowledgement", () => {
    const emit = vi.fn();
    const engine = new ListeningEngine(emit);
    engine.enabled = true;
    engine.setUserSpeaking(true);
    for (let i = 0; i < 80; i += 1) engine.update(0.1);
    engine.setUserSpeaking(false);
    for (let i = 0; i < 120; i += 1) engine.update(0.1);

    expect(emit).not.toHaveBeenCalled();
    expect(engine.engage).toBeGreaterThan(0);
  });
});
