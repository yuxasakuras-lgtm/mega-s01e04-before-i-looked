import { describe, expect, it } from 'vitest';
import { countNight } from '../src/digest/counts.js';

describe('countNight', () => {
  it('counts log lines by status', () => {
    expect(countNight('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(countNight('runs', '2026-10-27')).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('is null for a missing night', () => {
    expect(countNight('runs', '2026-01-01')).toBeNull();
  });
});
