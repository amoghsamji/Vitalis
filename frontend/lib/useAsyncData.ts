import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

export function useAsyncData<T>(fetcher: () => Promise<T> | null, deps: unknown[], options?: { pollMs?: number }) {
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

  const pollMs = options?.pollMs;
  useEffect(() => {
    if (!pollMs) return;
    let cancelled = false;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const promise = fetcher();
      if (!promise) return;
      promise.then((result) => {
        if (!cancelled) setData(result);
      }, () => {});
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs]);

  return { data, setData, loading, error, reload };
}
