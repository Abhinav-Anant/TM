/**
 * Pointer-tracked 3D tilt for glass panels.
 *
 * Spread onto any element that also has `.tilt`:
 *   <div className="panel tilt" {...tilt}>
 *
 * Plain handlers rather than a hook: this writes CSS custom properties
 * straight to the node, so tilting a card never re-renders React.
 */

const MAX_DEG = 5;

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const onPointerMove = (event) => {
  // Touch has no hover state to track, and a tilt under a finger just hides
  // the content behind it.
  if (event.pointerType !== 'mouse' || reduced()) return;

  const el = event.currentTarget;
  const { left, top, width, height } = el.getBoundingClientRect();
  const x = (event.clientX - left) / width;
  const y = (event.clientY - top) / height;

  el.style.setProperty('--tilt-y', `${(x - 0.5) * 2 * MAX_DEG}deg`);
  el.style.setProperty('--tilt-x', `${(0.5 - y) * 2 * MAX_DEG}deg`);
  el.style.setProperty('--spec-x', `${x * 100}%`);
  el.style.setProperty('--spec-y', `${y * 100}%`);
  el.dataset.tilting = 'true';
};

const onPointerLeave = (event) => {
  const el = event.currentTarget;
  el.dataset.tilting = 'false';
  el.style.setProperty('--tilt-x', '0deg');
  el.style.setProperty('--tilt-y', '0deg');
};

export const tilt = { onPointerMove, onPointerLeave };

export default tilt;
