// Plan morning-digest § 1. The contract the digest page, the JSON route, the board link and the
// route tests build against. Types only: the reader itself is issue #2, in `src/digest/read.ts`.

/** A run's outcome, as the log writes it. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * One line of `runs/<night>.jsonl`, after it has been parsed and checked. A line that is not
 * valid JSON, or lacks one of these fields, never becomes a `LogLine`: it is counted in
 * `NightDigest.badLines` instead.
 */
export type LogLine = {
  /** ISO 8601 time with the log's own offset, e.g. `2026-10-28T23:00:02+01:00`. */
  at: string;
  /** Job name, e.g. `lane/sync`. */
  job: string;
  status: RunStatus;
  /** Whose job it is. `null` is allowed and kept: the row stays, the view shows `—`. */
  owner: string | null;
  /** Error text, usually on `retry` or `fail` lines. */
  error?: string;
};

/** One job's night, folded from all its log lines. */
export type DigestRow = {
  job: string;
  /** Owner from the job's last line. `null` when unknown; views render it as `—`. */
  owner: string | null;
  /** Number of log lines for this job (every attempt, whatever its status). */
  runs: number;
  /** Number of those lines with status `retry`. */
  retries: number;
  /** Status of the job's last line, by `at`. */
  lastStatus: RunStatus;
  /** `error` of the job's last line that has one; `null` if no line had one. Views render `null` as `—`. */
  lastError: string | null;
  /** `at` of the job's first line, exactly as in the log: offset kept, never converted to UTC. */
  firstAt: string;
  /** `at` of the job's last line, exactly as in the log: offset kept, never converted to UTC. */
  lastAt: string;
};

/**
 * What reading one night gives back when its file exists.
 *
 * - An empty file (nothing ran) is `{ rows: [], badLines: 0 }`, not `null`: the page renders
 *   "nothing ran", the JSON returns it with status 200.
 * - "No file for this night" is not a `NightDigest`: `readNight` returns `null`, and routes
 *   answer 404.
 */
export type NightDigest = {
  /** The night asked for, `YYYY-MM-DD`. */
  night: string;
  /** One row per job, sorted by `job` (plain string order). */
  rows: DigestRow[];
  /** Lines that did not parse (bad JSON or missing/invalid fields). Counted, never thrown. */
  badLines: number;
};

/**
 * Reads `<runsDir>/<night>.jsonl`. Returns `null` when that file does not exist (route: 404),
 * otherwise a `NightDigest` (an empty file gives empty `rows`). Bad lines never throw.
 *
 * Implemented in issue #2 as `export const readNight: ReadNight` in `src/digest/read.ts`.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
