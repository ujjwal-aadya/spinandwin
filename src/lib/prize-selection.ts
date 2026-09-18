/**
 * Reference implementation of the weighted draw that allocate_spin() performs
 * in SQL. Production allocation happens in the database; this module exists so
 * the selection rule is unit-testable and documented in one place.
 */
export interface Weighted { id: string; weight: number; remaining: number; isActive: boolean }

export function allocatable<T extends Weighted>(prizes: T[]): T[] {
  return prizes.filter((p) => p.isActive && p.remaining > 0 && p.weight > 0);
}

export function totalWeight(prizes: Weighted[]): number {
  return allocatable(prizes).reduce((sum, p) => sum + p.weight, 0);
}

/**
 * @param pick integer in [0, totalWeight) — supplied by the caller so the
 *             randomness source stays injectable and testable.
 */
export function selectPrize<T extends Weighted>(prizes: T[], pick: number): T | null {
  const pool = allocatable(prizes).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = pool.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return null;
  const target = ((pick % total) + total) % total;
  let cursor = 0;
  for (const prize of pool) {
    cursor += prize.weight;
    if (target < cursor) return prize;
  }
  return pool[pool.length - 1] ?? null;
}
