// Arc math for the team ring (T13): a part-of-whole meter drawn as one SVG circle with a
// dash that covers `fraction` of the circumference. Pure, so it is unit-tested.

/** Share of the ring that is filled, clamped to [0, 1]; 0 when the target is not positive. */
export function ringFraction(done: number, target: number): number {
  if (!(target > 0) || !Number.isFinite(done)) return 0;
  return Math.min(1, Math.max(0, done / target));
}

export interface RingArc {
  radius: number;
  circumference: number;
  /** `stroke-dasharray` value: the full circumference, so one dash plus one gap covers the ring. */
  dashArray: number;
  /** `stroke-dashoffset`: the part of the circumference left unfilled (0 = full ring). */
  dashOffset: number;
  fraction: number;
}

/**
 * Geometry for a ring of `size` px with a stroke of `stroke` px. The radius keeps the whole
 * stroke inside the box so round caps are never clipped.
 */
export function ringArc(done: number, target: number, size: number, stroke: number): RingArc {
  const radius = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const fraction = ringFraction(done, target);
  const dashOffset = round(circumference * (1 - fraction));
  return { radius, circumference: round(circumference), dashArray: round(circumference), dashOffset, fraction };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "27 of 90 team days logged" for the ring's accessible name. */
export function ringDescription(done: number, target: number): string {
  return `${done} of ${target} team days logged`;
}
