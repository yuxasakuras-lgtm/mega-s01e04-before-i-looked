import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Routes: GET /digest/:night (page) and GET /api/digest/:night (JSON). Each night below is a file
// in a temp runs dir; runs/ is only read (to copy the real night), never written.
const NORMAL = '2026-10-28';
const EMPTY = '2026-10-30';
const BAD = '2026-10-31';
const MISSING = '2026-10-29';

const JOBS = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];

type DigestJson = { night: string; rows: { job: string; lastStatus: string }[]; badLines: number };

let runsDir = '';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  const source = readFileSync(fileURLToPath(new URL('../runs/2026-10-28.jsonl', import.meta.url)), 'utf8');
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), source);
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      '{"at":"2026-10-31T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      'not json',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

// Job names in the order of the page's table body (first cell of each row).
function tableJobs(html: string): string[] {
  return [...html.matchAll(/<tr(?: [^>]*)?>\s*<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
}

// Job names of the rows marked `class="warn"`, in table order.
function warnJobs(html: string): string[] {
  return [...html.matchAll(/<tr class="warn"[^>]*>\s*<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('GET /digest/:night (page)', () => {
  it('200 for a normal night: the job names and a warn row', async () => {
    const res = await app().request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of JOBS) expect(html).toContain(job);
    expect(html).toContain('class="warn"');
    expect(warnJobs(html)).toEqual(['fixtures/refresh', 'notes/backup']);
  });

  it('404 for a night with no file', async () => {
    const res = await app().request(`/digest/${MISSING}`);
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for');
  });

  it('renders "nothing ran" for an empty night', async () => {
    const res = await app().request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('shows "bad lines: 1" for a night with one bad line', async () => {
    const res = await app().request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('bad lines: 1');
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 for a normal night: 5 rows and 1 bad line', async () => {
    const res = await app().request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = await json<DigestJson>(res);
    expect(body.night).toBe(NORMAL);
    expect(body.rows).toHaveLength(5);
    expect(body.badLines).toBe(1);
  });

  it('404 for a night with no file', async () => {
    const res = await app().request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'no run log', night: MISSING });
  });

  it('200 with no rows for an empty night', async () => {
    const res = await app().request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('200 with badLines 1 for a night with one bad line', async () => {
    const res = await app().request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = await json<DigestJson>(res);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync']);
  });
});

describe('page and JSON agree', () => {
  it('the job order in the page table equals the JSON rows order', async () => {
    const page = await app().request(`/digest/${NORMAL}`);
    const html = await page.text();
    const api = await app().request(`/api/digest/${NORMAL}`);
    const body = await json<DigestJson>(api);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(tableJobs(html)).toEqual(body.rows.map((r) => r.job));
  });
});
