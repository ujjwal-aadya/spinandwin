import { describe, expect, it } from 'vitest';
import { allocatable, selectPrize, totalWeight } from '@/lib/prize-selection';

const prizes = [
  { id: 'a-pen', weight: 100, remaining: 100, isActive: true },
  { id: 'b-cap', weight: 50, remaining: 50, isActive: true },
  { id: 'c-powerbank', weight: 20, remaining: 20, isActive: true },
  { id: 'd-earphones', weight: 10, remaining: 10, isActive: true },
];

describe('weighted prize selection', () => {
  it('ignores inactive, sold-out and zero-weight prizes', () => {
    const pool = allocatable([
      ...prizes,
      { id: 'e-mug', weight: 5, remaining: 0, isActive: true },
      { id: 'f-shirt', weight: 5, remaining: 5, isActive: false },
      { id: 'g-bag', weight: 0, remaining: 5, isActive: true },
    ]);
    expect(pool.map((p) => p.id)).toEqual(['a-pen', 'b-cap', 'c-powerbank', 'd-earphones']);
    expect(totalWeight(prizes)).toBe(180);
  });

  it('maps each weight band to the right prize', () => {
    expect(selectPrize(prizes, 0)?.id).toBe('a-pen');
    expect(selectPrize(prizes, 99)?.id).toBe('a-pen');
    expect(selectPrize(prizes, 100)?.id).toBe('b-cap');
    expect(selectPrize(prizes, 149)?.id).toBe('b-cap');
    expect(selectPrize(prizes, 150)?.id).toBe('c-powerbank');
    expect(selectPrize(prizes, 169)?.id).toBe('c-powerbank');
    expect(selectPrize(prizes, 170)?.id).toBe('d-earphones');
    expect(selectPrize(prizes, 179)?.id).toBe('d-earphones');
  });

  it('returns null when nothing can be allocated', () => {
    expect(selectPrize([], 3)).toBeNull();
    expect(selectPrize([{ id: 'x', weight: 10, remaining: 0, isActive: true }], 3)).toBeNull();
  });

  it('is proportional to the configured weights over many draws', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 18_000; i++) {
      const prize = selectPrize(prizes, i)!;      // sweep every band evenly
      counts.set(prize.id, (counts.get(prize.id) ?? 0) + 1);
    }
    expect(counts.get('a-pen')).toBe(10_000);
    expect(counts.get('b-cap')).toBe(5_000);
    expect(counts.get('c-powerbank')).toBe(2_000);
    expect(counts.get('d-earphones')).toBe(1_000);
  });

  it('is stable regardless of the order prizes arrive in', () => {
    const shuffled = [...prizes].reverse();
    expect(selectPrize(shuffled, 100)?.id).toBe(selectPrize(prizes, 100)?.id);
  });
});
