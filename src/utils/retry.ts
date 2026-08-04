// Retries an async operation a few times with a short backoff. Used to absorb
// transient Assembly API failures during a server render (a single blip would
// otherwise crash the whole page into the error boundary).
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 300,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

// True when an error is Assembly's HTTP 429 "rate limit exceeded".
export function isRateLimit(e: unknown): boolean {
  const err = e as {
    status?: number;
    body?: { code?: string };
    message?: string;
  };
  return (
    err?.status === 429 ||
    err?.body?.code === 'rate_limit_exceeded' ||
    (typeof err?.message === 'string' && err.message.includes('429'))
  );
}

// Retries ONLY on a 429, backing off exponentially (0.5s, 1s, 2s, 4s…). Any
// other error is re-thrown immediately so real failures aren't delayed. Used to
// self-throttle bursts of Assembly writes (e.g. a bulk delete) instead of
// giving up the moment we hit the rate limit.
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  attempts = 6,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRateLimit(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}
