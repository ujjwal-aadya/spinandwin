import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('CSV export', () => {
  it('quotes separators, quotes and newlines', () => {
    const csv = toCsv(['Name', 'Company'], [['Santos, Maria', 'He said "hi"'], ['Line\nbreak', null]]);
    expect(csv).toContain('"Santos, Maria"');
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain('"Line\nbreak"');
  });

  it('defuses spreadsheet formula injection', () => {
    const csv = toCsv(['X'], [['=cmd|calc']]);
    expect(csv).toContain("'=cmd|calc");
  });

  it('renders empty cells for null and undefined', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('A,B\r\n,');
  });
});
