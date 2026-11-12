/** Small helpers for calling flaky model APIs: per-request timeouts and backoff on 429 / 503. */

export class RequestTimeoutError extends Error {
  constructor(public readonly label: string, public readonly timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "RequestTimeoutError";
  }
}

/** The model answered, but with empty or non-JSON output. Retried once (see retryOnInvalidOutput). */
export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

export function isInvalidOutput(error: unknown): boolean {
  return error instanceof InvalidModelOutputError || (error as Error | undefined)?.name === "InvalidModelOutputError";
}

/** Run once more if the model returned empty or non-JSON output (one extra attempt, no backoff). */
export async function retryOnInvalidOutput<T>(label: string, run: (attempt: number) => Promise<T>): Promise<T> {
  try {
    return await run(1);
  } catch (error) {
    if (!isInvalidOutput(error)) throw error;
    console.warn(`${label}: ${(error as Error).message}; retrying once`);
    return run(2);
  }
}

/** An HTTP error that carries the status code (and optional Retry-After seconds). */
export class HttpStatusError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/** Statuses worth retrying: rate limited (429) and overloaded / unavailable (503, plus 529 used by some providers). */
export const TRANSIENT_STATUSES = new Set([429, 503, 529]);

/** Best-effort HTTP status from any SDK error shape (fetch, OpenAI SDK, @google/genai). */
export function statusOf(error: unknown): number | null {
  const e = error as any;
  const candidates = [e?.status, e?.statusCode, e?.code, e?.response?.status, e?.error?.code, e?.cause?.status];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  const match = String(e?.message || "").match(/^\s*(?:got status:\s*)?(\d{3})\b/i) || String(e?.message || "").match(/\((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

export function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  return status != null && TRANSIENT_STATUSES.has(status);
}

/** Race a promise against a timer. The losing request is not cancelled unless the caller wires `signal`. */
export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  label: string;
  maxAttempts: number;
  /** First backoff in ms; doubles each attempt, with jitter. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Retry `run` on transient errors (429 / 503) with exponential backoff; anything else fails at once. */
export async function retryTransient<T>(run: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const base = options.baseDelayMs ?? 5_000;
  const max = options.maxDelayMs ?? 60_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= options.maxAttempts || !isTransient(error)) throw error;
      const retryAfter = (error as HttpStatusError).retryAfterSeconds;
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const delayMs = Math.min(max, Math.max(retryAfter ? retryAfter * 1000 : 0, Math.round(backoff * (0.8 + Math.random() * 0.4))));
      options.onRetry?.({ attempt, delayMs, error });
      console.warn(`${options.label}: transient error (${statusOf(error)}) on attempt ${attempt}/${options.maxAttempts}; retrying in ${Math.round(delayMs / 1000)}s`);
      await sleep(delayMs);
    }
  }
}
