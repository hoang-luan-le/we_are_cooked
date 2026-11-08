// Circle-versus-rectangle movement on the ground plane. No three.js here, so it can be tested on its own.
export type Rect = { name: string; minX: number; maxX: number; minZ: number; maxZ: number };

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
