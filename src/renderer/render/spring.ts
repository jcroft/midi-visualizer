// Critically damped spring, solved exactly per step (no overshoot, stable at any dt).
export interface Spring {
  x: number;
  v: number;
}

export function stepSpring(s: Spring, target: number, omega: number, dt: number): void {
  const c1 = s.x - target;
  const c2 = s.v + omega * c1;
  const e = Math.exp(-omega * dt);
  const k = c1 + c2 * dt;
  s.x = target + k * e;
  s.v = (c2 - omega * k) * e;
}

/** Shortest-way-round version of `target` relative to `cur` (angles in radians). */
export function nearestAngle(cur: number, target: number): number {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d;
}
