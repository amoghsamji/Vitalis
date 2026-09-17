import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

/**
 * Shared loading/error/data trio for pages with a single straightforward
 * fetch. `fetcher` returning `null` means "not ready yet" (e.g. session
 * still loading) — skips the fetch and stays in the loading state.
 */
export function useAsyncData<T>(fetcher: () => Promise<T> | null, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    const promise = fetcher();
    if (!promise) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    promise
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick]);

  return { data, setData, loading, error, reload };
}
