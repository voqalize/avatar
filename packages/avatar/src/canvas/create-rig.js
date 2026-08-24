/**
 * Private Canvas2D AvatarRig adapter.
 *
 * The package boundary remains `createAvatar({ mount, client })`. This module
 * only translates the mixer's already-resolved frame into the code-authored
 * round face; it never infers a state, emotion, or viseme from pose values.
 */

import { Rig } from './src/rig.js';
import { Renderer2D } from './src/render2d.js';
import { createLive } from './src/live.js';

async function loadPackagedRig(url, imageUrls) {
  const base = new URL(url, location.href);
  const dataResponse = await fetch(base);
  if (!dataResponse.ok) throw new Error(`loadRig: ${base} returned ${dataResponse.status}`);
  const data = await dataResponse.json();
  const images = await Promise.all(data.images.map(async (image) => {
    // The entry point names every wardrobe URL literally. That makes the
    // complete identity visible to Vite/Rollup/Webpack's static asset graph;
    // constructing `img/${image.file}` here would work in source and disappear
    // from a production bundle.
    const imageUrl = imageUrls[image.file];
    if (!imageUrl) throw new Error(`loadRig: no packaged URL for ${image.file}`);
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`loadRig: image ${image.file} returned ${response.status}`);
    return createImageBitmap(await response.blob());
  }));
  return new Rig(data, images);
}

export function createCanvasRig({ url, images, face, label }) {
  let canvas = null;
  let presenceFilter = '';

  return {
    setPresenceFilter(filter) {
      presenceFilter = filter;
      if (canvas) canvas.style.filter = filter;
    },

    factory(mount) {
      const ownCanvas = document.createElement('canvas');
      ownCanvas.style.cssText = 'display:block;width:100%;height:100%';
      ownCanvas.style.transition = 'filter .5s ease';
      ownCanvas.style.filter = presenceFilter;
      ownCanvas.setAttribute('role', 'img');
      ownCanvas.setAttribute('aria-label', label);
      mount.appendChild(ownCanvas);
      canvas = ownCanvas;

      let rig = null;
      let renderer = null;
      let live = null;
      let destroyed = false;
      let dpr = window.devicePixelRatio || 1;

      const resize = () => {
        if (renderer) renderer.resize(dpr = window.devicePixelRatio || 1);
      };
      const Observer = globalThis.ResizeObserver;
      const observer = Observer ? new Observer(resize) : null;
      if (observer) observer.observe(mount);
      else window.addEventListener('resize', resize);

      Promise.all([loadPackagedRig(url, images), face()]).then(([loadedRig, faceModule]) => {
        if (destroyed) return;
        rig = loadedRig;
        if (!rig.meta.live) {
          throw new Error(`createAvatar: ${url} has no live face metadata`);
        }
        renderer = new Renderer2D(ownCanvas, rig);
        renderer.resize(dpr);
        live = createLive(rig, faceModule);
      }).catch((error) => {
        if (!destroyed) console.error('[voqalize avatar] canvas rig failed to load', error);
      });

      return {
        apply(frame) {
          if (!live || !renderer) return;
          // No baked pose weights or ambient tracks: the upstream mixer owns
          // all 30 channels and the gesture clock, and sends the complete frame.
          live.apply(frame.pose, {}, null, frame.hand);
          renderer.draw();
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          if (observer) observer.disconnect();
          else window.removeEventListener('resize', resize);
          if (live) live.destroy();
          ownCanvas.remove();
          if (canvas === ownCanvas) canvas = null;
          rig = renderer = live = null;
        },
      };
    },
  };
}
