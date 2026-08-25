import { describe, expect, it } from 'vitest';
import { CALL_CAMERA, viewBoxForHead } from '../src/camera.js';
import { FACES } from '../src/faces.js';

describe('shared call camera', () => {
  it('derives the approved 4:3 / 6-70-24 composition in native art units', () => {
    const crownY = 117;
    const chinY = 597;
    const camera = viewBoxForHead({ centerX: 380, crownY, chinY });

    expect(camera.w / camera.h).toBeCloseTo(4 / 3, 12);
    expect((crownY - camera.y) / camera.h).toBeCloseTo(0.06, 12);
    expect((chinY - crownY) / camera.h).toBeCloseTo(0.70, 12);
    expect((camera.y + camera.h - chinY) / camera.h).toBeCloseTo(0.24, 12);
    expect(CALL_CAMERA.headroom + CALL_CAMERA.head + CALL_CAMERA.body).toBe(1);
  });

  it.each(Object.entries(FACES))('%s ships an exact 4:3 intrinsic camera', (_name, face) => {
    expect(face.meta.viewBox.w / face.meta.viewBox.h).toBeCloseTo(4 / 3, 12);
  });

  it('rejects landmarks that cannot describe a head', () => {
    expect(() => viewBoxForHead({ centerX: 0, crownY: 10, chinY: 10 })).toThrow();
  });
});
