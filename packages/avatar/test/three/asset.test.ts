import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HARD_BUDGET, pixelRatioFor } from "../../client/three/budgets.js";
// The rig's fallbacks for the facts the asset now carries. A stamp that has
// drifted from them is the hand-copy this test exists to make impossible.
import { HEAD_PARTS, PIVOT, ROLL_PIVOT } from "../../client/three/character-rig.js";
// `packages/avatar/src/params.js` is a dependency-free ES module and the one
// definition of the pose vocabulary; see the tara block below for why this test
// compares against it rather than a copy.
import { CHANNELS, REST } from "../../src/params.js";
// The viseme table is the library's own, for the same reason: a letter's pose
// retyped here would be a test of the retyping.
import { shapeFor } from "../../src/visemes.js";

/** `scripts/morphs.NECK_QUAD` — the suffix on a neck field's second-order half. */
const NECK_QUAD = "_q";

interface Accessor {
  count: number;
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  type?: string;
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
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

const COMPONENT: Record<number, [number, (bin: Buffer, at: number) => number]> = {
  5126: [4, (bin, at) => bin.readFloatLE(at)],
  5125: [4, (bin, at) => bin.readUInt32LE(at)],
  5123: [2, (bin, at) => bin.readUInt16LE(at)],
};

/** Every element of one tightly packed view, flattened. */
function readView(json: GltfJson, bin: Buffer, view: number, byteOffset: number,
                  count: number, width: number, componentType: number): number[] {
  const bufferView = json.bufferViews?.[view];
  expect(bufferView, "bufferView").toBeDefined();
  const base = (bufferView?.byteOffset ?? 0) + byteOffset;
  const [size, get] = COMPONENT[componentType] ?? [0, () => NaN];
  expect(size, `component type ${componentType}`).toBeGreaterThan(0);
  return Array.from({ length: count * width }, (_, i) => get(bin, base + i * size));
}

/**
 * Every element of one accessor, flattened.
 *
 * Sparse is not an exotic case to tolerate here, it is how the exporter writes
 * the shell's morph targets: a viseme moves the lips and leaves the skull, the
 * ears and the hairline alone, so most of the target is zero and glTF stores
 * only the rest. The mouth's own bands move every vertex they have and come out
 * dense, which is why the check that reads only those never met one.
 */
function readAccessor(json: GltfJson, bin: Buffer, index: number): number[] {
  const accessor = json.accessors?.[index];
  expect(accessor, `accessor ${index}`).toBeDefined();
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor?.type ?? ""] ?? 0;
  const count = accessor?.count ?? 0;
  const dense = accessor?.bufferView !== undefined
    ? readView(json, bin, accessor.bufferView, accessor.byteOffset ?? 0, count, width,
               accessor?.componentType ?? 0)
    : new Array<number>(count * width).fill(0);
  const sparse = accessor?.sparse;
  if (!sparse) return dense;
  const at = readView(json, bin, sparse.indices.bufferView, sparse.indices.byteOffset ?? 0,
                      sparse.count, 1, sparse.indices.componentType);
  const values = readView(json, bin, sparse.values.bufferView, sparse.values.byteOffset ?? 0,
                          sparse.count, width, accessor?.componentType ?? 0);
  at.forEach((vertex, k) => {
    for (let c = 0; c < width; c += 1) dense[vertex * width + c] = values[k * width + c];
  });
  return dense;
}

/**
 * One mesh's vertices at a pose, in glTF axes — so +z is toward the viewer and
 * +y is up.
 *
 * The weight is the plain influence law, `(value - rest) / (1 - rest)`, which
 * is what `character-rig` applies to every channel but the lids, the squints and the
 * neck's pair — and none of those is a mouth channel. A rig's copy of the law
 * is not what is under test here; the geometry it drives is.
 */
function posed(json: GltfJson, bin: Buffer, mesh: Mesh, pose: Record<string, number>): number[] {
  const primitive = mesh.primitives?.[0];
  expect(primitive?.attributes?.POSITION, `${mesh.name} POSITION`).toBeDefined();
  const out = readAccessor(json, bin, primitive!.attributes!.POSITION!);
  (mesh.extras?.targetNames ?? []).forEach((channel, at) => {
    const value = pose[channel];
    const position = primitive!.targets?.[at]?.POSITION;
    if (value === undefined || position === undefined) return;
    const rest = (REST as Record<string, number>)[channel] ?? 0;
    const weight = (value - rest) / (1 - rest);
    const delta = readAccessor(json, bin, position);
    for (let i = 0; i < out.length; i += 1) out[i] += weight * delta[i];
  });
  return out;
}

/** A band's midline column as `[height, depth]` pairs, nearest the viewer last. */
function midline(vertices: number[]): Array<[number, number]> {
  const column: Array<[number, number]> = [];
  for (let i = 0; i < vertices.length; i += 3) {
    if (Math.abs(vertices[i]) < 1e-6) column.push([vertices[i + 1], vertices[i + 2]]);
  }
  return column.sort((a, b) => b[0] - a[0]);
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
 * from each character's `landmarks.py` — tara's in `scripts/`, everyone else's
 * in `characters/<name>/`.
 *
 * The character after tara answered the question this table was holding open:
 * the boxes are not per-face because they are generous bounds on where a feature
 * may sit and not measurements of where it does — a face whose eyes left one
 * would be a fitting error, not a different face. The rows stayed separate so a
 * new character could disagree without editing the others, and tess is the first
 * to: the eyes box is bounded from the *outside* as well, by the frame field's
 * lateral onset, and on a narrower face that onset moves in while the box does
 * not. Her row says so. The values are no longer TARA-SPECIFIC.
 */
/** What every shipped GLB's copyright field must carry besides our own grant. */
const OWED = [/MediaPipe/, /Apache-2\.0/, /modified/i, /ICT-FaceKit/, /MIT/];

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
    // The only one whose hair hangs past the jaw, and so the only one with the
    // `Hair` shell's roll pair. It is read from where her drawing's
    // hair ends and not set (`morphs.hair_hangs`): hair beside the temple is
    // stuck to the head, and a hank on a shoulder is not.
    hair: true,
    interior: [
      { name: "eyes", u: 0.30, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
  {
    // Her hair is a low tail that clears both ears, so she is back inside
    // tara's atlas window and nothing of hers hangs past the jaw: her `Hair`
    // shell is rigid like tara's — see `characters/tess/`.
    name: "tess",
    interior: [
      // The one box anyone has had to move, and it is her face's width and not
      // her eyes. The frame field turns nothing until |u| passes 0.75 of the
      // outline's half-width (`head_mesh.MOTION_LATERAL`), held at its v 0.55
      // value above the cheekbone — which is |u| 0.3032 on tara and 0.2921 on
      // her, because her head is narrower in absolute units at every height.
      // The shared 0.30 hangs over that by 0.008 of cheek, so it caught the
      // first millimetre of the onset (Δz -0.0055) on skin no eye is anywhere
      // near. Her outer corner is at |u| 0.2670, x 0.6855 of her half-width —
      // the same fraction as tara's 0.6802 and tanya's 0.6882, which is the
      // fraction `MOTION_LATERAL` was set against. So 0.28: clear of her eye by
      // 0.013 and inside her onset by 0.012, and it is her face that is narrow,
      // not her fitting that is off.
      { name: "eyes", u: 0.28, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
  {
    // Under her hair she is tess's shape - ears clear, a rigid `Hair` shell -
    // because the hair that hangs is not on the head at all: it is a
    // `HairLayer` of its own, present because her directory holds
    // `hair-layer.png` (`scripts/hair_layer.py`).
    name: "tanvi",
    hairLayer: true,
    interior: [
      { name: "eyes", u: 0.30, v: [0.52, 0.68] },
      { name: "mouth", u: 0.20, v: [0.12, 0.30] },
      { name: "nose", u: 0.12, v: [0.33, 0.60] },
    ],
  },
];

describe.each(CHARACTERS)("$name GLB", ({ name, interior, hair, hairLayer }) => {
  const asset = new URL(`../../assets/${name}.glb`, import.meta.url);

  // The code in this package is MIT and the binaries beside it are not:
  // they are artwork, CC-BY 4.0 (`assets/README.md`). A published GLB is copied
  // out of a dependency tree, renamed and handed on, so the terms are written
  // into the file itself — `scripts/build_character.COPYRIGHT`, through the glTF
  // exporter's copyright field. Nothing else can check this: a licence that
  // lives only in a manifest is a licence the file loses on its first copy.
  it("carries its own licence", async () => {
    const copyright = jsonChunk(await readFile(asset)).asset?.copyright ?? "";
    expect(copyright).toMatch(/Voqalize/);
    expect(copyright).toMatch(/CC-BY-4\.0/);
  });

  // The same argument run the other way, and it is the stricter one: our grant
  // travelling in the file is a courtesy, and someone else's notice travelling
  // in the file is a condition of using their mesh at all. A rebuild that drops
  // it — `scripts/head_mesh.NOTICES` going missing, an exporter argument going
  // back to the bare constant — breaks that silently and publishes.
  //
  // It is asserted on every character because every character now incurs it:
  // the shell is MediaPipe's canonical mesh and the arch is measured off
  // ICT-FaceKit, for all of them (`canonical/mediapipe/README.md`). It was one
  // row's field while one face stood on published work, and a per-row field is
  // the shape that goes quietly wrong the day a second face does.
  it("carries what it owes others", async () => {
    const copyright = jsonChunk(await readFile(asset)).asset?.copyright ?? "";
    for (const pattern of OWED) expect(copyright).toMatch(pattern);
  });

  // Behind the lips are four surfaces and nothing but their depth order, and
  // the order is invisible to every other check in this suite: a cavity that
  // has come out in front of the tongue still mounts, still has finite targets,
  // still passes the conformance sweep, and draws an open mouth as a flat dark
  // hole. It shipped that way. The cavity's lower rows followed the lip down
  // the chin still carrying the depth of the lip bump they started on
  // (`scripts/morphs.cavity_targets`), so C had no tongue in it at all, H's L
  // was a stub, and D wore the crossover between the two surfaces as a hard
  // scalloped edge.
  //
  // D is the widest aperture and H is the L — the two tiles where the tongue is
  // most of what a viewer sees. At the midline both bands have a column of
  // their own, which is where they can be compared without interpolating twice.
  it.each(["D", "H"])("shows tongue rather than dark at viseme %s", async (letter) => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const bin = binChunk(glb);
    const pose = shapeFor(letter) as Record<string, number>;
    const column = (part: string) => {
      const mesh = (json.meshes ?? []).find((m) => m.name === part);
      expect(mesh, part).toBeDefined();
      return midline(posed(json, bin, mesh!, pose));
    };
    const cavity = column("Cavity");
    const tongue = column("Tongue");
    const depthAt = (height: number): number => {
      for (let i = 1; i < cavity.length; i += 1) {
        const [above, back] = cavity[i - 1];
        const [below, front] = cavity[i];
        if (height <= above && height >= below) {
          return back + (front - back) * ((height - above) / (below - above));
        }
      }
      return NaN;
    };
    const inside = tongue.filter(([height]) => Number.isFinite(depthAt(height)));
    expect(inside.length, "tongue rows inside the cavity's band").toBeGreaterThan(1);
    for (const [height, depth] of inside) {
      expect(depth - depthAt(height), `at height ${height.toFixed(3)}`).toBeGreaterThan(0);
    }
  });

  // What is seen of the lower arch is a difference between two much larger
  // travels — the lip peeling off it on `mouthOpen`, the mandible carrying it
  // down on `jaw` — so it is the one surface in the mouth that a small change
  // anywhere can close up entirely, and nothing else here would notice. It has
  // gone twice. Once in the asset: tess's arch sat deeper behind her lip than
  // tara's and never cleared it, which `morphs.OPEN_DN`'s floor now corrects
  // per character. Once in a driver: mocap composed `jaw` off ARKit's raw
  // `jawOpen` instead of `JAW_OF_OPEN` of it, and the mandible fell as fast as
  // the lip uncovering it, so the mouth opened wide with no lower teeth in it
  // at any aperture.
  //
  // So the check is against `shapeFor`'s own pairing, not against numbers
  // retyped here: the asset owes a visible crown to the composition the library
  // actually sends it, and D is the widest aperture it sends.
  it("uncovers the lower arch as the mouth opens", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const bin = binChunk(glb);
    const named = (part: string) => {
      const mesh = (json.meshes ?? []).find((m) => m.name === part);
      expect(mesh, part).toBeDefined();
      return mesh!;
    };
    const head = named("Head");
    const arch = named("Teeth_Lower");

    // The lower lip's inner rim, identified by what it does rather than by an
    // index: of the vertices near the midline it is the one the peel alone
    // carries furthest down.
    const shut = posed(json, bin, head, {});
    const peeled = posed(json, bin, head, { mouthOpen: 1 });
    let rim = -1;
    let furthest = 0;
    for (let i = 0; i < shut.length; i += 3) {
      if (Math.abs(shut[i]) > 0.012) continue;
      const fell = shut[i + 1] - peeled[i + 1];
      if (fell > furthest) [rim, furthest] = [i, fell];
    }
    expect(rim, "a midline vertex that the lip peel moves").toBeGreaterThanOrEqual(0);

    const clearance = (pose: Record<string, number>) => {
      const lip = posed(json, bin, head, pose)[rim + 1];
      const crown = midline(posed(json, bin, arch, pose))[0]?.[0] ?? NaN;
      return crown - lip;
    };

    // The peel, against a mandible held still: how far the lip travels past an
    // arch that has not moved. This is the one number the characters are built
    // to hold in common — `morphs.OPEN_DN` carries tara's, and its floor adds
    // back whatever more of their own lip a character has to peel through — so
    // it is the one that catches an arch set too deep to be uncovered at all.
    expect(clearance({ mouthOpen: 1 }), "the lip peels past a still arch")
      .toBeGreaterThan(0.05);

    // And the composition the library actually sends has to uncover rather than
    // cover. Their difference is what collapses when a driver picks its own
    // ratio: `jaw` at 1:1 with the aperture leaves a third of this on tara,
    // which is a mouth that opens wide with no lower teeth in it.
    //
    // Per unit of D's aperture, because the defect is a ratio and the table's
    // size is not this test's business: a D calibrated smaller shows less arch
    // and is still a mouth with teeth in it. 0.018 is the 0.015 this held at
    // an absolute when D opened 0.83 past rest; 1:1 leaves a third of what a
    // healthy asset shows.
    const d = shapeFor("D") as Record<string, number>;
    const x = shapeFor("X") as Record<string, number>;
    const speaking = (clearance(d) - clearance(x)) / (d.mouthOpen - x.mouthOpen);
    expect(speaking, "arch D shows over silence, per unit of D's aperture")
      .toBeGreaterThan(0.018);
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
      // singular values come back equal with no residual, which is what the
      // travel audit measures. The card-slide prohibition was
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
      // settles (`character-rig.HAIR_ROLL`).
      ...(hair ? { Hair: ["headRoll", "headRoll_q"] } : {}),
      // Hair lying over the body, on a layer of its own: the same roll hold as
      // a hanging `Hair` shell, a hold on the yaw as well - its inner edge is
      // the neck's outline, which does not turn - and below the chin the shrug
      // of the shoulders it lies on (`morphs.hair_layer_targets`).
      ...(hairLayer ? { HairLayer: ["headRoll", "headRoll_q", "headYaw", "headYaw_q",
                                    "shoulderL", "shoulderR"] } : {}),
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
  // `build_character.py` and in `src/character-rig.ts` together — so neither disagreed
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
   * (`A P` and `A^2 P`) and `character-rig.neckInfluence` supplies `sin(th)` and
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
   * Where this head turns and tilts, and what rides its skull.
   *
   * These are facts about *this* head — the jaw angle, the chin, the parts the
   * build grouped — so the asset carries them and the rig reads them
   * (`stamp_abi`). Until 2026-09-23 they were typed into `character-rig.ts` by
   * hand, through a frame conversion (Blender x, y, z is glTF x, z, −y), with
   * nothing on either side to catch a disagreement: the audit tool that reads
   * both reads the pivots out of the rig alone, so it would have reported
   * agreement with a build that used something else entirely.
   *
   * Held against the rig's own fallbacks, which is the point. They are what an
   * asset built before the stamp is driven by, so the day they stop matching is
   * the day one character moves and the character beside it does not — and the
   * only difference a viewer sees is that a small turn stops swinging the chin.
   */
  it("says where its head turns, and hands the rig the same numbers", async () => {
    const glb = await readFile(asset);
    const json = jsonChunk(glb);
    const extras = json.scenes?.[0]?.extras ?? {};
    for (const [key, fallback] of [["head_pivot", PIVOT], ["roll_pivot", ROLL_PIVOT]] as const) {
      const stamped = extras[key] as number[] | undefined;
      expect(stamped, `${name}.glb stamps ${key} — rebuild it`).toHaveLength(3);
      expect(stamped, `${key}: the rig's fallback and the build have parted`)
        .toEqual([fallback.x, fallback.y, fallback.z].map((n) => expect.closeTo(n, 6)));
    }
    // What this head has, in the rig's own order — so it is the asset being
    // asked and not the rig's list copied back. tanya's hair covers her ears
    // and she is built without them; a skull part left behind in the body's
    // frame does not fail, it just stops turning with the head, which is the
    // silence this closes.
    const nodes = new Set((json.nodes ?? []).map((n) => n.name));
    expect(extras.head_parts, `${name}.glb stamps head_parts — rebuild it`)
      .toEqual(HEAD_PARTS.filter((part) => nodes.has(part)));
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
    // A hair layer turns with the skull as the shells do.
    const globes = ["Eye_L", "Eye_R", "Hair", ...(hairLayer ? ["HairLayer"] : []), "Head"];
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
    // And how far that rim goes down at a full jaw, without which the shadow
    // rotates with the head but stays banded across the throat while the chin
    // descends through it. It has to be a real share of the rim's own travel
    // and stay inside the tile the lookup is clamped to, or the shadow would
    // slide off the bottom of its own map at an open mouth.
    const drop = extras.jaw_shadow_drop as number | undefined;
    expect(drop, "Neck extras.jaw_shadow_drop").toBeGreaterThan(0.03);
    expect(drop).toBeLessThan((extent?.[3] ?? 0) - (extent?.[2] ?? 0));
  });

  /**
   * The expression maps (`scripts/expression_maps.py`), on the carrier the rig
   * takes out of the scene (`character-rig.ts`, `expressive`). The rig reads the
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
    // Both are held, because the face's targets on one shell are cheap and the
    // whole budget scattered over every mesh is not maintainable.
    for (const primitive of primitives) {
      expect(primitive.targets?.length ?? 0).toBeLessThanOrEqual(HARD_BUDGET.morphTargets);
    }
    expect(targets).toBeLessThanOrEqual(HARD_BUDGET.morphTargets);
  });
});
