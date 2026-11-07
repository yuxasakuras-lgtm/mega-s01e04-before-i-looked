// Plan morning-digest § 1, issue #2. Reads one night's run log into one row per job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, LogLine, NightDigest, ReadNight, RunStatus } from './types.js';

// Only `YYYY-MM-DD` is a night. Anything else (`../x`, `a/b`, `2026-10-28.jsonl`) never reaches the
// file system: it reads as "no such night".
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/**
 * Parses one non-blank log line. Returns `null` for a bad line: not JSON, not an object, or a
 * missing/invalid field. `owner` is required (string or `null`); a line without an `owner` key is
 * bad, as types.ts says of any missing field. `error`, when present, must be a string. `at` must
 * parse to an instant, since rows are ordered by it.
 */
export function parseLine(text: string): { line: LogLine; instant: number } | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const { at, job, status, owner, error } = v;
  if (typeof at !== 'string' || typeof job !== 'string' || !isStatus(status)) return null;
  if (!('owner' in v) || (owner !== null && typeof owner !== 'string')) return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const instant = Date.parse(at);
  if (Number.isNaN(instant)) return null;
  const line: LogLine = { at, job, status, owner };
  if (error !== undefined) line.error = error;
  return { line, instant };
}

type Entry = { line: LogLine; instant: number; index: number };

// Lines are ordered by the instant `at` names (offsets compared, strings kept as written); equal
// instants keep log order.
function byTime(a: Entry, b: Entry): number {
  return a.instant - b.instant || a.index - b.index;
}

function foldJob(job: string, entries: Entry[]): DigestRow {
  const sorted = [...entries].sort(byTime);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  let lastError: string | null = null;
  for (const e of sorted) if (e.line.error !== undefined) lastError = e.line.error;
  return {
    job,
    owner: last.line.owner,
    runs: sorted.length,
    retries: sorted.filter((e) => e.line.status === 'retry').length,
    lastStatus: last.line.status,
    lastError,
    firstAt: first.line.at,
    lastAt: last.line.at,
  };
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isRecord(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readFileOrNull(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const byJob = new Map<string, Entry[]>();
  let badLines = 0;
  let index = 0;
  for (const raw of text.split('\n')) {
    // Blank lines (a trailing newline, an empty line, a stray `\r`) are not log lines: skipped,
    // not counted as bad.
    if (raw.trim() === '') continue;
    const parsed = parseLine(raw);
    if (parsed === null) {
      badLines++;
      continue;
    }
    const entries = byJob.get(parsed.line.job) ?? [];
    entries.push({ ...parsed, index: index++ });
    byJob.set(parsed.line.job, entries);
  }

  const rows = [...byJob.entries()]
    .map(([job, entries]) => foldJob(job, entries))
    // Plain string order, as types.ts asks (not locale order).
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines };
};
