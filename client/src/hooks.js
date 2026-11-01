import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data and re-fetches on an interval while `shouldPoll(data)` is true. */
export function useLoad(fn, deps = [], { shouldPoll, intervalMs = 2500 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload, ...deps]);

  useEffect(() => {
    if (!shouldPoll || !data || !shouldPoll(data)) return undefined;
    const t = setTimeout(reload, intervalMs);
    return () => clearTimeout(t);
  }, [data, shouldPoll, reload, intervalMs]);

  return { data, error, loading, reload };
}
