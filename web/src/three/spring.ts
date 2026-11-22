// Semi-implícito, sin asignaciones y sin three. El tope de 3 subpasos
// aguanta un stall de ~80 ms sin producir NaN.
export function stepSpring(
  p: number,
  v: number,
  target: number,
  dt: number,
  omega: number,
  zeta: number,
): readonly [number, number] {
  if (dt <= 0) return [p, v];
  const steps = Math.min(3, Math.max(1, Math.ceil(dt / (1 / 60))));
  const h = dt / steps;
  let pos = p;
  let vel = v;
  for (let i = 0; i < steps; i += 1) {
    const a = -omega * omega * (pos - target) - 2 * zeta * omega * vel;
    vel = vel + a * h;
    pos = pos + vel * h;
  }
  return [pos, vel] as const;
}
