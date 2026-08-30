// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createFaceShell } from "../src/face-core.js";

describe("createFaceShell", () => {
  // The memo used to key on `node.id + attr`, which is just `attr` for any
  // element with no id — so two id-less nodes shared one slot and the second
  // never got written. Every animated element in the shipped faces happens to
  // carry an id, so this was latent; a shared feature emitting its own marks
  // is precisely what would spring it.
  it("memoizes per node, not per id, so id-less elements cannot collide", () => {
    const mount = document.createElement("div");
    const { svg, set } = createFaceShell(
      mount,
      "shell",
      `<svg id="shell" xmlns="http://www.w3.org/2000/svg">
         <path class="a"/><path class="b"/>
       </svg>`,
    );
    const a = svg.querySelector<SVGPathElement>(".a")!;
    const b = svg.querySelector<SVGPathElement>(".b")!;
    expect(a.id).toBe("");
    expect(b.id).toBe("");

    set(a, "d", "M0 0");
    set(b, "d", "M0 0");

    expect(a.getAttribute("d")).toBe("M0 0");
    expect(b.getAttribute("d")).toBe("M0 0");
  });

  it("still skips redundant writes to the same node and attribute", () => {
    const mount = document.createElement("div");
    const { svg, set } = createFaceShell(
      mount,
      "shell",
      `<svg id="shell" xmlns="http://www.w3.org/2000/svg"><path id="shell-p"/></svg>`,
    );
    const node = svg.querySelector<SVGPathElement>("#shell-p")!;
    let writes = 0;
    const real = node.setAttribute.bind(node);
    node.setAttribute = (name: string, value: string) => { writes++; real(name, value); };

    set(node, "d", "M1 1");
    set(node, "d", "M1 1");
    set(node, "d", "M2 2");

    expect(writes).toBe(2);
    expect(node.getAttribute("d")).toBe("M2 2");
  });
});
