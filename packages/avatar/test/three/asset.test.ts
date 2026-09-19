import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HARD_BUDGET, pixelRatioFor } from "../../client/three/budgets.js";
// `packages/avatar/src/params.js` is a dependency-free ES module and the one
// definition of the pose vocabulary; see the tara block below for why this test
// compares against it rather than a copy.
import { CHANNELS, REST } from "../../src/params.js";

/** `scripts/morphs.NECK_QUAD` — the suffix on a neck field's second-order half. */
const NECK_QUAD = "_q";

interface Accessor {
  count: number;
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  type?: string;
  sparse?: unknown;
}
interface Primitive {
  indices?: number;
  mode?: number;
  attributes?: { POSITION?: number; _MOTION_DEPTH?: number };
  targets?: Array<{ POSITION?: number }>;
}
interface Mesh {
  name?: string;
  primitives?: Primitive[];
  weights?: number[];
  extras?: { targetNames?: string[] };
}
interface GltfJson {
  asset?: { copyright?: string; generator?: string };
  scenes?: Array<{ extras?: Record<string, unknown> }>;
  accessors?: Accessor[];
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
  animations?: Array<{ name?: string }>;
  meshes?: Mesh[];
  nodes?: Array<{ name?: string; extras?: Record<string, unknown> }>;
  skins?: Array<{ joints?: number[] }>;
}

function jsonChunk(glb: Buffer): GltfJson {
  expect(glb.readUInt32LE(0)).toBe(0x46546c67); // glTF
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.byteLength);
  const length = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // JSON
  return JSON.parse(glb.subarray(20, 20 + length).toString("utf8").trim()) as GltfJson;
}

function binChunk(glb: Buffer): Buffer {
  const json = glb.readUInt32LE(12);
  const start = 20 + json;
  expect(glb.readUInt32LE(start + 4)).toBe(0x004e4942); // BIN
  return glb.subarray(start + 8, start + 8 + glb.readUInt32LE(start));
}

/** The mean of one vec3 float accessor, as [x, y, z] in glTF axes. */
function meanVec3(json: GltfJson, bin: Buffer, index: number): [number, number, number] {
  const accessor = json.accessors?.[index];
  expect(accessor, `accessor ${index}`).toBeDefined();
  expect(accessor?.type).toBe("VEC3");
  expect(accessor?.componentType).toBe(5126); // FLOAT
  expect(accessor?.sparse, "sparse morph accessor").toBeUndefined();
  const view = json.bufferViews?.[accessor?.bufferView ?? -1];
  expect(view, "bufferView").toBeDefined();
  const base = (view?.byteOffset ?? 0) + (accessor?.byteOffset ?? 0);
  const sum: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < (accessor?.count ?? 0); i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      sum[axis] += bin.readFloatLE(base + i * 12 + axis * 4);
    }
  }
  return sum.map((total) => total / (accessor?.count ?? 1)) as [number, number, number];
}

/** Every element of one tightly packed FLOAT or index accessor, flattened. */
function readAccessor(json: GltfJson, bin: Buffer, index: number): number[] {
  const accessor = json.accessors?.[index];
  expect(accessor, `accessor ${index}`).toBeDefined();
  expect(accessor?.sparse, `accessor ${index} is sparse`).toBeUndefined();
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor?.type ?? ""] ?? 0;
  const view = json.bufferViews?.[accessor?.bufferView ?? -1];
  expect(view, "bufferView").toBeDefined();
  const base = (view?.byteOffset ?? 0) + (accessor?.byteOffset ?? 0);
  const read: Record<number, [number, (at: number) => number]> = {
    5126: [4, (at) => bin.readFloatLE(at)],
    5125: [4, (at) => bin.readUInt32LE(at)],
    5123: [2, (at) => bin.readUInt16LE(at)],
  };
  const [size, get] = read[accessor?.componentType ?? 0] ?? [0, () => NaN];
  expect(size, `accessor ${index} component type`).toBeGreaterThan(0);
  return Array.from({ length: (accessor?.count ?? 0) * width }, (_, i) => get(base + i * size));
}

function primitiveTriangles(primitive: Primitive, accessors: Accessor[]): number {
  const accessor = primitive.indices ?? primitive.attributes?.POSITION;
  const count = accessor === undefined ? 0 : accessors[accessor]?.count ?? 0;
  switch (primitive.mode ?? 4) {
    case 4: return count / 3; // TRIANGLES
    case 5: return Math.max(0, count - 2); // TRIANGLE_STRIP
    case 6: return Math.max(0, count - 2); // TRIANGLE_FAN
    default: return 0;
  }
}

describe("drawing-buffer ceiling", () => {
  it("caps both DPR and oversized consumer mounts", () => {
    expect(pixelRatioFor(400, 300, 3)).toBe(2);
    expect(pixelRatioFor(800, 600, 2)).toBe(1);
    expect(pixelRatioFor(1600, 1200, 2)).toBe(0.5);
  });
});

/**
 * Every 3-D character's GLB passes the same checks; what differs is a row here.
 * The interior boxes surround the eyes, mouth and nose, in glTF x/y, and come
 * from each character's `landmarks.py` — tara's in `scripts/`, tushar's in
 * `characters/tushar/`, tanya's in `characters/tanya/`.
 *
 * The third character answered the question this table was holding open: none
 * of the interior boxes are per-face. All three carry the same three, because
 * they are generous bounds on where a feature may sit and not measurements of
 * where it does — a face whose eyes left this box would be a fitting error, not
 * a different face. The rows stay separate so a fourth character can disagree
 * without editing the other three, but the values are no longer TARA-SPECIFIC.
 */
const CHARACTERS = [
  {
    name: "tara",
    interior: [
      { name: "eyes", u: 0.30, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
  {
    name: "tushar",
    interior: [
      { name: "eyes", u: 0.30, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
  {
    name: "tanya",
    // The only one of the three whose hair hangs past the jaw, and so the only
    // one with the `Hair` shell's roll pair. It is read from where her drawing's
    // hair ends and not set (`morphs.hair_hangs`): hair beside the temple is
    // stuck to the head, and a hank on a shoulder is not.
    hair: true,
    interior: [
      { name: "eyes", u: 0.30, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
];

describe.each(CHARACTERS)("$name GLB", ({ name, interior, hair }) => {
  const asset = new URL(`../../assets/${name}.glb`, import.meta.url);

  // The code in this package is MIT and the three binaries beside it are not:
  // they are artwork, CC-BY 4.0 (`assets/README.md`). A published GLB is copied
  // out of a dependency tree, renamed and handed on, so the terms are written
  // into the file itself — `scripts/build_tara.COPYRIGHT`, through the glTF
  // exporter's copyright field. Nothing else can check this: a licence that
  // lives only in a manifest is a licence the file loses on its first copy.
  it("carries its own licence", async () => {
    const copyright = jsonChunk(await readFile(asset)).asset?.copyright ?? "";
    expect(copyright).toMatch(/Voqalize/);
    expect(copyright).toMatch(/CC-BY-4\.0/);
  });

  // The reach across the package wall is the point of the test. tara's morph
  // targets are not named after Rhubarb letters or after anything invented
  // here — they *are* the SVG rig's pose channels, so that one `pose` object
  // drives either renderer and every existing clip, viseme and co-articulation
  // rule keeps working (`scripts/morphs.py`, module docstring). A test that
  // compared the GLB against a list retyped in this file would prove only that
  // the list was retyped. `scripts/validate_morphs.py` asserts the same
  // property on the Python side, before the mesh is ever built.
  it("names every morph target after a real pose channel", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const channels = new Set(CHANNELS as string[]);

    const authored = new Map<string, string[]>();
    for (const mesh of json.meshes ?? []) {
      const names = mesh.extras?.targetNames ?? [];
      const targets = mesh.primitives?.[0]?.targets?.length ?? 0;
      // three.js builds `morphTargetDictionary` from `extras.targetNames`, and
      // silently falls back to indices when they are missing or short — the
      // rig would then drive whatever channel happened to be authored third.
      expect(names.length, `${mesh.name}: named targets`).toBe(targets);
      if (targets) authored.set(mesh.name ?? "", names);
      for (const name of names) {
        // The neck's second-order fields are the one target name that is not a
        // channel, and they are checked as a *pair* rather than exempted by
        // pattern: each is the `A^2 P` half of the rotation whose `A P` half is
        // the channel it is suffixed from, so a stray `_q` with no partner is
        // still a failure. `scripts/morphs.neck_targets` has the identity.
        if (name.endsWith(NECK_QUAD)) {
          const base = name.slice(0, -NECK_QUAD.length);
          expect(channels, `${mesh.name}: ${name} pairs with a channel`).toContain(base);
          expect(names, `${mesh.name}: ${name} without ${base}`).toContain(base);
          continue;
        }
        expect(channels, mesh.name).toContain(name);
      }
    }

    expect(Object.fromEntries(authored)).toEqual({
      Head: [
        "jaw", "mouthOpen", "mouthWidth", "mouthRound", "mouthPress", "mouthTuck",
        "teethUpper", "mouthCornerL", "mouthCornerR",
        "lidL", "lidR", "squintL", "squintR",
        "browRaiseL", "browRaiseR", "browAngleL", "browAngleR",
        "browInnerL", "browInnerR",
      ],
      Cavity: ["mouthOpen", "jaw", "teethUpper", "tongue"],
      Teeth_Lower: ["jaw", "mouthTuck"],
      Tongue: ["tongue", "jaw"],
      // The head channels on the neck, each with the second half of its own
      // rotation. A rigid turn is `sin(th)` of one fixed field plus
      // `1 - cos(th)` of another, so two targets per axis reproduce it exactly
      // at any angle where one reproduced it only near zero — which is what let
      // the envelope open up for a nod that lands without the throat stretching
      // away from the pivot. It is also why the asset no longer depends on the
      // envelope at all: these fields carry no angle.
      Neck: ["headYaw", "headPitch", "headRoll",
             "headYaw_q", "headPitch_q", "headRoll_q"],
      // Four fields on one shell, and all four deform the torso rather than
      // move it. The shrug: a card that slides lifts the chest at the frame's
      // lower edge with the shoulders, and a photograph shows that as the whole
      // body hopping (`morphs.py`, "the shoulders").
      //
      // The trunk's two were transforms in the rig until 2026-09-16, and that
      // is what the note here used to say. A lean rendered as a scale of the
      // whole figure, with the orthographic camera outside the group it scaled,
      // is arithmetically a zoom — fit the displacement as a linear map and its
      // singular values come back equal with no residual
      // (`tools/motion-audit/torso_travel.py`). The card-slide prohibition was
      // always against a *free* hem rather than against a field: both trunk
      // fields ramp to exactly zero at the frame's lower edge and the shell
      // runs 0.14 below it, so they satisfy it by construction. Only the breath
      // and the hip sway are still transforms.
      Body: ["shoulderL", "shoulderR", "torsoLean", "torsoTurn"],
      // A hank of hair lying on a shoulder does not tilt when the head does, so
      // the hair shell gives up its share of a roll rather than rotating rigidly
      // with the skull and lifting off the collar (`morphs.hair_targets`). The
      // same two names as the neck's roll pair, deliberately: it is the same
      // channel driving the same rotation, and only the angle the rig hands them
      // differs — held back at rest, and swinging either side of that while it
      // settles (`tara-rig.HAIR_ROLL`).
      ...(hair ? { Hair: ["headRoll", "headRoll_q"] } : {}),
    });
  });

  it("rests at the neutral pose on load", async () => {
    const glb = await readFile(asset);
    // `shape_key_add()` hands back a key already at 1.0, so an unposed build
    // exports `weights` that render every morph at once — a face wrong for one
    // frame on every load, and wrong in the still that reviews it. Found by
    // eye, guarded here.
    for (const mesh of jsonChunk(glb).meshes ?? []) {
      const targets = mesh.primitives?.[0]?.targets?.length ?? 0;
      if (!targets) continue;
      // Asserted present, not just all-zero: an exporter that dropped the array
      // would make an `every(w === 0)` check pass by having nothing to check.
      expect(mesh.weights, `${mesh.name}: default weights`).toHaveLength(targets);
      for (const weight of mesh.weights ?? []) expect(weight, mesh.name).toBe(0);
    }
  });

  // The head channels are displacements, and the export is where a sign gets
  // lost: Blender (x, y, z) leaves as glTF (x, z, -y), so +X and +Z survive
  // intact and only +Y flips. Both copies of the yaw negated it anyway — in
  // `build_tara.py` and in `src/tara-rig.ts` together — so neither disagreed
  // with the other and tara turned her head away from her own eyes, because
  // `gaze.js` feeds `pupilX` and `headYaw` one aversion term. This reads the
  // shipped asset in the frame three.js reads it in, and asserts what
  // `params.js` says the channels mean, from the viewer's side of the screen.
  it("carries the throat the way the head turns", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const bin = binChunk(glb);
    const neck = (json.meshes ?? []).find((mesh) => mesh.name === "Neck");
    expect(neck, "the Neck mesh").toBeDefined();
    const names = neck?.extras?.targetNames ?? [];
    const targets = neck?.primitives?.[0]?.targets ?? [];
    const mean = (channel: string) => {
      const at = names.indexOf(channel);
      expect(at, `Neck target ${channel}`).toBeGreaterThanOrEqual(0);
      const position = targets[at]?.POSITION;
      expect(position, `${channel} POSITION`).toBeDefined();
      return meanVec3(json, bin, position as number);
    };
    // glTF x is the viewer's right and y is up, so these are the three
    // sentences in `packages/avatar/src/params.js` read off the asset.
    expect(mean("headYaw")[0], "+headYaw takes the throat right").toBeGreaterThan(0.002);
    expect(mean("headPitch")[1], "+headPitch takes it down").toBeLessThan(-0.002);
    expect(mean("headRoll")[0], "+headRoll takes it left").toBeLessThan(-0.001);
  });

  /**
   * What the asset still declares, now that the envelope is not part of it.
   *
   * The neck's follow used to be one linear field per head axis, built from the
   * degrees a channel unit turns the head — so the throat tracked the skull
   * only for the envelope the GLB was compiled against, and moving that number
   * in the rig without rebuilding drew a second jawline across the throat. This
   * test used to guard exactly that. It no longer needs to:
   * `scripts/morphs.neck_targets` authors the rotation's two angle-free terms
   * (`A P` and `A^2 P`) and `tara-rig.neckInfluence` supplies `sin(th)` and
   * `1 - cos(th)`, so the follow is exact at any angle and the envelope is a
   * runtime number the asset never sees.
   *
   * Keeping the old assertion would have been the restating mistake one level
   * up: a test comparing the GLB to a constant the GLB does not depend on,
   * failing on every legitimate envelope change and proving nothing.
   */
  it("declares the spec it was compiled to", async () => {
    const glb = await readFile(asset);
    const extras = jsonChunk(glb).scenes?.[0]?.extras ?? {};
    expect(extras.avatar_spec, "the asset declares a spec version").toBe("1");
    expect(extras.face_height_units, "one unit is one face height").toBe(true);
    expect(extras.head_degrees_per_unit,
      "the envelope is the rig's, not the asset's — see neck_targets").toBeUndefined();
  });

  /**
   * The influence law is `(pose - rest) / (1 - rest)`, so every expression this
   * asset can draw is measured from the rest values it was authored at. Editing
   * one in `params.js` without rebuilding puts every pose on that channel off
   * by a constant — silently, and by an amount no single frame reveals.
   * `validate_morphs.py` already asserts the Python copy against `params.js`;
   * this asserts the *asset* against it, which is the copy a browser loads.
   */
  it("was authored at the rest pose the library sends it", async () => {
    const glb = await readFile(asset);
    const extras = jsonChunk(glb).scenes?.[0]?.extras ?? {};
    const stamped = extras.rest as Record<string, number>;
    expect(stamped, "the asset declares its rest pose").toBeDefined();
    for (const [channel, value] of Object.entries(stamped)) {
      expect(CHANNELS, `${channel} is a pose channel`).toContain(channel);
      expect(value, `${channel}: rebuild ${name}.glb after moving params.REST`)
        .toBeCloseTo((REST as Record<string, number>)[channel], 9);
    }
  });

  /**
   * The motion-depth field (`scripts/head_mesh.motion_depth`), which is what
   * makes a nod read as a rotation rather than a drop.
   *
   * The failure this guards against is silent. An exporter run without
   * `export_attributes` drops the field, the shader then finds nothing to
   * read, and she renders a perfect rest pose that turns the old way.
   * The feature interior is checked for exactly zero because the teeth are a
   * separate mesh with no field: any offset on the lips would slide the two
   * apart under a turn.
   *
   * The globes do carry it, and for the opposite reason. Stamped from the
   * *shell's* depth at their own (u, v), only their hidden skirt gets any field
   * at all — the visible cap reaches x 0.684 of the outline half-width, inside
   * the 0.75 the field is exactly zero within — so the iris, the lids and gaze
   * are untouched, while the skirt turns with the skin that hides it instead of
   * sliding out past the temple as a flat grey lozenge.
   *
   * The slope bound catches a step between neighbouring vertices, which under a
   * turn shows as a tear in the skin.
   */
  it("turns its frame at the motion depth, and never its features", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const bin = binChunk(glb);
    const carriers = new Set<string>();
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const field = primitive.attributes?._MOTION_DEPTH;
        if (field === undefined) continue;
        carriers.add(mesh.name ?? "");
        const dz = readAccessor(json, bin, field);
        const xyz = readAccessor(json, bin, primitive.attributes?.POSITION ?? -1);
        expect(dz.length, `${mesh.name}: one Δz per vertex`).toBe(xyz.length / 3);
        // Only ever deeper, and never past the back of the skull.
        for (const value of dz) {
          expect(value, `${mesh.name}: Δz ≤ 0`).toBeLessThanOrEqual(0);
          expect(value, `${mesh.name}: Δz bounded`).toBeGreaterThanOrEqual(-0.5);
        }
        const tri = readAccessor(json, bin, primitive.indices ?? -1);
        let steepest = 0;
        for (let t = 0; t < tri.length; t += 3) {
          for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]], [tri[t + 2], tri[t]]]) {
            const length = Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1]);
            steepest = Math.max(steepest, Math.abs(dz[a] - dz[b]) / Math.max(length, 1e-6));
          }
        }
        // 5.3 as built (tara; tushar 4.3, tanya 6.6): the steepest band is the
        // lateral onset, 0.25 of a half-width wide, on the lower jaw just above
        // `MOTION_OUTLINE_V`'s bound, where that half-width narrows toward the
        // chin. The bound is each face's own — the height at which the jaw is as
        // wide as the neck — so a narrow neck puts it lower, where the jaw
        // narrows fastest, and the same fraction of a half-width spans less
        // surface. That is tanya, and it is geometry, not a seam: a seam would
        // read in the hundreds.
        expect(steepest, `${mesh.name}: Δz per unit of surface`).toBeLessThan(8);
        if (mesh.name !== "Head") continue;
        // The character's own boxes (`CHARACTERS` above).
        for (const box of interior) {
          let inside = 0;
          for (let i = 0; i < dz.length; i += 1) {
            const [u, v] = [Math.abs(xyz[3 * i]), xyz[3 * i + 1]];
            if (u >= box.u || v <= box.v[0] || v >= box.v[1]) continue;
            inside += 1;
            expect(dz[i], `Head: Δz on the ${box.name}`).toBe(0);
          }
          expect(inside, `Head: vertices in the ${box.name} box`).toBeGreaterThan(100);
        }
      }
    }
    // The shells of the frame and the two globes, and not the neck: it shares
    // the shells' material, and its follow is morphs, not this. The ear is a
    // shell only where the face has one to stand off — on a face whose hair is
    // the silhouette at ear height it is drawn in the atlas and the hair shell
    // carries it (`face_texture.EAR_SHELL`), so what must be checked is that
    // every shell that exists carries the field, not that a fixed five do.
    const globes = ["Eye_L", "Eye_R", "Hair", "Head"];
    const shells = new Set((json.meshes ?? []).map((mesh) => mesh.name));
    expect([...carriers].sort()).toEqual(
      shells.has("Ears") ? ["Ears", ...globes] : globes);
  });

  /**
   * The jaw's shadow, lifted out of the albedo so it can follow the jaw
   * (`scripts/project_albedo.lift_jaw_shadow`). The rig lays it back only when
   * the neck says where it lives, and falls back to nothing — so an exporter
   * that dropped the node extras would ship a neck with no shadow under the
   * chin at all, a paler throat than the photograph, and no error anywhere.
   */
  it("tells the neck where the jaw's shadow is", async () => {
    const glb = await readFile(asset);
    const node = (jsonChunk(glb).nodes ?? []).find((n) => n.name === "Neck");
    const extras = node?.extras ?? {};
    const uv = extras.jaw_shadow_uv as number[] | undefined;
    expect(uv, "Neck extras.jaw_shadow_uv").toHaveLength(4);
    // One face unit spans more than no texels and less than the whole atlas,
    // and glTF's v runs down the image while face-space v runs up.
    expect(uv?.[1]).toBeGreaterThan(0);
    expect(uv?.[1]).toBeLessThan(1);
    expect(uv?.[3]).toBeLessThan(0);
    // The rig clamps its lookup to this, (u0, u1, v0, v1) in face space.
    const extent = extras.jaw_shadow_extent as number[] | undefined;
    expect(extent, "Neck extras.jaw_shadow_extent").toHaveLength(4);
    expect(extent?.[0]).toBeLessThan(extent?.[1] ?? -Infinity);
    expect(extent?.[2]).toBeLessThan(extent?.[3] ?? -Infinity);
    // TARA-SPECIFIC: her jaw's rim turns about 0.11 in front of the face plane.
    expect(extras.jaw_shadow_rim_z as number).toBeGreaterThan(0.05);
    expect(extras.jaw_shadow_rim_z as number).toBeLessThan(0.2);
  });

  /**
   * The expression maps (`scripts/expression_maps.py`), on the carrier the rig
   * takes out of the scene (`tara-rig.ts`, `expressive`). The rig reads the
   * strip only through these extras, and a strip read with the wrong layout
   * shifts every map onto its neighbour's face — a raised brow's lines on a
   * smiling cheek — with no error. That the image itself survived the exporter
   * is `characters/tushar/validate.py`'s check, which can decode it.
   */
  it("lays out its expression maps the way the rig reads them", async () => {
    const glb = await readFile(asset);
    const node = (jsonChunk(glb).nodes ?? []).find((n) => n.name === "Expression");
    const extras = node?.extras ?? {};
    const maps = extras.expression_maps as string[] | undefined;
    expect(maps?.slice(0, 3), "Expression extras.expression_maps").toEqual(["smile", "raise", "knit"]);
    const [width, height, pad, stripWidth, stripHeight] = extras.expression_layout as number[];
    expect(stripWidth).toBe((maps?.length ?? 0) * (width + pad) + pad);
    expect(stripHeight).toBe(height + 2 * pad);
    expect(extras.expression_unity).toBe(128);
    // Atlas UV into a tile is an affine that magnifies: the tile spans less
    // of the face than the atlas does.
    const tile = extras.expression_tile as number[];
    expect(tile).toHaveLength(4);
    expect(tile[1]).toBeGreaterThan(1);
    expect(tile[3]).toBeGreaterThan(1);
    // Face-space u from the atlas's s, centred on the midline the sides split at.
    const [u0, du] = extras.expression_u as number[];
    expect(u0).toBeLessThan(0);
    expect(u0 + du).toBeGreaterThan(0);
  });

  it("keeps the shipping asset inside its budgets", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
    const triangles = primitives.reduce(
      (sum, primitive) => sum + primitiveTriangles(primitive, json.accessors ?? []),
      0,
    );
    const targets = primitives.reduce(
      (sum, primitive) => sum + (primitive.targets?.length ?? 0), 0);

    expect(glb.byteLength).toBeLessThanOrEqual(HARD_BUDGET.assetBytes);
    expect(primitives.length).toBeLessThanOrEqual(HARD_BUDGET.drawCalls);
    expect(triangles).toBeLessThanOrEqual(HARD_BUDGET.triangles);
    // Per-mesh is what a GPU pays for; the total is what an author maintains.
    // Both are held, because 19 targets on one shell is cheap and 40 scattered
    // over five meshes is not maintainable.
    for (const primitive of primitives) {
      expect(primitive.targets?.length ?? 0).toBeLessThanOrEqual(HARD_BUDGET.morphTargets);
    }
    expect(targets).toBeLessThanOrEqual(HARD_BUDGET.morphTargets);
  });
});
