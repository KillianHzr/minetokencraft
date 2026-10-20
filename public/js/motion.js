// Reduced motion, when the system asks for it (prefers-reduced-motion): no lightning flashes, no swaying grass, still
// water, fewer decorative particles, no blinking, a camera that moves without easing. Every state stays visible.
const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');

export function reducedMotion() {
  return Boolean(query?.matches);
}

// Share of the decorative particles kept in reduced motion.
export const REDUCED_PARTICLES = 0.3;
