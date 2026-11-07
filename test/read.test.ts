import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');
  const row = (job: string) => digest?.rows.find((r) => r.job === job);

  it('gives 5 jobs, sorted by job, and 1 bad line', () => {
    expect(digest).not.toBeNull();
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('folds fixtures/refresh: 4 runs, 3 retries, ends ok, keeps the last error', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a failed job and a null owner', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null, lastStatus: 'ok' });
  });

  it('keeps the offset in first and last time', () => {
    expect(row('rig/rotate-logs')?.firstAt).toBe('2026-10-28T23:00:02+01:00');
    expect(row('lane/sync')?.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });
});

describe('readNight on a temp runs dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-read-'));
  const night = (name: string, lines: string[]) => writeFileSync(join(dir, `${name}.jsonl`), lines.join('\n'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for anything that is not YYYY-MM-DD', () => {
    night('2026-01-02', ['']);
    expect(readNight(dir, '../2026-01-02')).toBeNull();
    expect(readNight(dir, '2026-01-02.jsonl')).toBeNull();
    expect(readNight(join(dir, 'x'), '../2026-01-02')).toBeNull();
  });

  it('gives empty rows for an empty file', () => {
    night('2026-01-03', []);
    expect(readNight(dir, '2026-01-03')).toEqual({ night: '2026-01-03', rows: [], badLines: 0 });
  });

  it('counts bad lines, skips blank ones, and never throws', () => {
    night('2026-01-04', [
      '{"at":"2026-01-04T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '',
      'not json',
      '{"at":"2026-01-04T01:00:00+01:00","job":"a","status":"maybe","owner":"x"}',
      '{"at":"2026-01-04T01:00:00+01:00","job":"a","status":"ok"}',
      '{"at":"nope","job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-04T01:00:00+01:00","job":"a","status":"ok","owner":"x","error":42}',
      '[1,2]',
      '',
    ]);
    expect(readNight(dir, '2026-01-04')).toEqual({
      night: '2026-01-04',
      badLines: 6,
      rows: [
        {
          job: 'a',
          owner: 'x',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-01-04T01:00:00+01:00',
          lastAt: '2026-01-04T01:00:00+01:00',
        },
      ],
    });
  });

  it('orders lines by instant across offsets, not by log order or string', () => {
    night('2026-01-05', [
      '{"at":"2026-01-05T02:00:00+01:00","job":"b","status":"fail","owner":"late","error":"boom"}',
      '{"at":"2026-01-05T00:30:00Z","job":"b","status":"retry","owner":"early","error":"first"}',
      '{"at":"2026-01-05T01:00:00Z","job":"b","status":"ok","owner":"tie-a"}',
      '{"at":"2026-01-05T02:00:00+01:00","job":"b","status":"ok","owner":"tie-b"}',
    ]);
    // 00:30Z < 01:00Z == 02:00+01:00 (twice); ties keep log order, so the tie-b line is last.
    expect(readNight(dir, '2026-01-05')?.rows[0]).toEqual({
      job: 'b',
      owner: 'tie-b',
      runs: 4,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'boom',
      firstAt: '2026-01-05T00:30:00Z',
      lastAt: '2026-01-05T02:00:00+01:00',
    });
  });
});
