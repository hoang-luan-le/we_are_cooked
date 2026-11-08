// Circle-versus-rectangle movement on the ground plane. No three.js here, so it can be tested on its own.
export type Rect = { name: string; minX: number; maxX: number; minZ: number; maxZ: number; maxY?: number };

export function overlaps(x: number, z: number, radius: number, rect: Rect) {
  const dx = x - Math.max(rect.minX, Math.min(x, rect.maxX));
  const dz = z - Math.max(rect.minZ, Math.min(z, rect.maxZ));
  return dx * dx + dz * dz < radius * radius - 1e-9;
}

export function isFree(x: number, z: number, radius: number, rects: readonly Rect[]) {
  return !rects.some(rect => overlaps(x, z, radius, rect));
}

/** Pushes the circle out of every rectangle. Repeats so corners between two rectangles settle. */
export function resolve(x: number, z: number, radius: number, rects: readonly Rect[]) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const rect of rects) {
      if (!overlaps(x, z, radius, rect)) continue;
      const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
      const nearestZ = Math.max(rect.minZ, Math.min(z, rect.maxZ));
      const dx = x - nearestX;
      const dz = z - nearestZ;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-6) {
        x = nearestX + (dx / distance) * radius;
        z = nearestZ + (dz / distance) * radius;
      } else {
        // The centre is inside the rectangle, so leave through the closest side.
        const exits = [
          { d: x - rect.minX + radius, x: rect.minX - radius, z },
          { d: rect.maxX - x + radius, x: rect.maxX + radius, z },
          { d: z - rect.minZ + radius, x, z: rect.minZ - radius },
          { d: rect.maxZ - z + radius, x, z: rect.maxZ + radius },
        ].sort((a, b) => a.d - b.d)[0];
        x = exits.x;
        z = exits.z;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** True when the straight ground segment crosses a rectangle (slab test). Used for line of sight. */
export function segmentHits(ax: number, az: number, bx: number, bz: number, rect: Rect) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [d, a, min, max] of [[dx, ax, rect.minX, rect.maxX], [dz, az, rect.minZ, rect.maxZ]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (a < min || a > max) return false;
      continue;
    }
    let near = (min - a) / d, far = (max - a) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * How far a camera arm can extend from a pivot before it would enter geometry.
 * `n` is the number of steps and `r` the rectangles, so this is O(n·r) once per frame in third person.
 */
export function freeArmLength(
  pivot: readonly [number, number, number], back: readonly [number, number, number], want: number,
  rects: readonly Rect[], ceilingY: number, margin: number, step = 0.06,
) {
  const blocked = (d: number) => {
    const x = pivot[0] + back[0] * d, y = pivot[1] + back[1] * d, z = pivot[2] + back[2] * d;
    if (y > ceilingY - margin || y < margin) return true;
    return rects.some(rect => !(rect.maxY !== undefined && y > rect.maxY + margin) && overlaps(x, z, margin, rect));
  };
  let last = 0;
  for (let d = step; d <= want + 1e-6; d += step) {
    if (blocked(d)) {
      // Refine, so the arm length changes continuously instead of in whole steps.
      let hi = d;
      for (let i = 0; i < 6; i++) { const mid = (last + hi) / 2; if (blocked(mid)) hi = mid; else last = mid; }
      return last;
    }
    last = d;
  }
  return want;
}

/** Breadth-first reachability on a grid. `n` is the number of cells visited, each step is O(rects). */
export function reachable(from: [number, number], to: [number, number], radius: number, rects: readonly Rect[], step = 0.08) {
  const key = (i: number, j: number) => `${i},${j}`;
  const toCell = (v: number) => Math.round(v / step);
  const target = [toCell(to[0]), toCell(to[1])] as const;
  const queue: [number, number][] = [[toCell(from[0]), toCell(from[1])]];
  const seen = new Set([key(queue[0][0], queue[0][1])]);
  for (let head = 0; head < queue.length && head < 400_000; head++) {
    const [i, j] = queue[head];
    if (Math.abs(i - target[0]) <= 1 && Math.abs(j - target[1]) <= 1) return true;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + a, nj = j + b, k = key(ni, nj);
      if (seen.has(k) || !isFree(ni * step, nj * step, radius, rects)) continue;
      seen.add(k);
      queue.push([ni, nj]);
    }
  }
  return false;
}
