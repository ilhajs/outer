/**
 * Live queries — the dialect-agnostic seam.
 *
 * A `LiveProvider` turns a compiled SQL statement into a stream of result sets
 * that re-runs whenever the underlying rows change. Only PGlite implements it
 * today (see `pglite()`), but nothing here is PGlite-specific: a Postgres
 * provider over `LISTEN`/`NOTIFY`, or a polling provider for dialects with no
 * change feed, satisfies the same three-method contract.
 *
 * Core never imports a driver — the provider is handed to `new Outer({ db })`
 * alongside the dialect, exactly like the dialect itself.
 */
export type LiveProvider = {
  /**
   * Subscribes to `sql`. Emits the full result set once immediately, then again
   * on every change affecting it. Aborting `signal` releases the subscription
   * and ends the iterable.
   */
  subscribe(args: {
    sql: string;
    parameters: readonly unknown[];
    signal?: AbortSignal | undefined;
  }): AsyncIterable<Record<string, unknown>[]>;
};

/**
 * Bridges a callback-style subscription to an `AsyncIterable`.
 *
 * Coalescing is deliberate: a live query's payload is a *snapshot*, not an
 * event log, so a slow consumer wants the newest result set rather than a
 * backlog of stale ones. Ticks that arrive while the consumer is busy collapse
 * into one, which bounds memory no matter how fast writes land.
 */
export function liveIterable<T>(
  start: (emit: (rows: T[]) => void) => Promise<() => void | Promise<void>>,
  signal?: AbortSignal,
): AsyncGenerator<T[], void, undefined> {
  // Returns the generator itself, not `{ [Symbol.asyncIterator] }` — oRPC's
  // `eventIterator()` output schema validates that the handler returned a real
  // async iterator (with `next`/`return`), and a bare iterable fails it.
  return (async function* () {
    if (signal?.aborted) return;

    let latest: T[] | undefined;
    let notify: (() => void) | undefined;
    let done = false;

    const wake = () => {
      const n = notify;
      notify = undefined;
      n?.();
    };

    const onAbort = () => {
      done = true;
      wake();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const stop = await start((rows) => {
      latest = rows;
      wake();
    });

    try {
      while (!done) {
        if (latest === undefined) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          continue;
        }
        const rows = latest;
        latest = undefined;
        yield rows;
      }
    } finally {
      // Runs on break/return/throw as well as abort, so a consumer that walks
      // away never leaks the underlying subscription.
      signal?.removeEventListener("abort", onAbort);
      await stop();
    }
  })();
}
