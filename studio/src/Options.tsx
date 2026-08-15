/**
 * The option surface of `createAvatar`, as controls.
 *
 * These are the whole of `SvgAvatarOptions` past `mount` and `client`, and
 * turning them is the reason Studio is a build rather than a static page: they
 * are what a product developer tunes, and there is nowhere else in the repo you
 * can turn them against a live call.
 *
 * The gains are clamped 0..2 by `createAvatar` itself, which throws a
 * `RangeError` at construction — so the sliders carry the same range rather
 * than a wider one that would make the IDE a way to discover an exception.
 */

import { FACE_NAMES, GAINS, isFaceName, type Look } from "./look";

export function Options({
  look,
  compare,
  onLook,
  onCompare,
}: {
  look: Look;
  compare: boolean;
  onLook: (next: Look) => void;
  onCompare: (next: boolean) => void;
}) {
  const set = <K extends keyof Look>(key: K, value: Look[K]) => onLook({ ...look, [key]: value });

  return (
    <section className="options">
      <h2>Avatar options</h2>
      <p className="muted signature"><code>createAvatar({"{ mount, client, … }"})</code></p>

      <label className="field">
        <span>face</span>
        <select
          value={look.face}
          disabled={compare}
          onChange={(e) => isFaceName(e.target.value) && set("face", e.target.value)}
        >
          {FACE_NAMES.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>

      <label className="check">
        <input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
        <span>all three, one client</span>
      </label>

      {GAINS.map(([key, label, why]) => (
        <label className="field slider" key={key} title={why}>
          <span>{label}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={look[key] as number}
            onChange={(e) => set(key, Number(e.target.value) as never)}
          />
          <b>{(look[key] as number).toFixed(2)}</b>
        </label>
      ))}

      <label className="check">
        <input type="checkbox" checked={look.hand} onChange={(e) => set("hand", e.target.checked)} />
        <span>hand</span>
      </label>

      <label className="field">
        <span>side</span>
        <select
          value={String(look.handSide)}
          disabled={!look.hand}
          onChange={(e) => set("handSide", Number(e.target.value) === -1 ? -1 : 1)}
        >
          <option value="1">viewer's right</option>
          <option value="-1">viewer's left</option>
        </select>
      </label>

      <p className="muted">
        Changing any of these destroys the avatar and builds a new one — the
        published surface is <code>{"{ destroy }"}</code> and has no setters. The
        call is untouched; the client outlives every avatar mounted on it.
      </p>
    </section>
  );
}
