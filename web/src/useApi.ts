import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Fetch again, keeping the current data on screen while it loads. */
  reload: () => Promise<void>;
}

/** Loads once per `key` and exposes reload for after an action. Stale responses are dropped. */
export function useApi<T>(load: () => Promise<T>, key: string | number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    void run();
  }, [key, run]);

  return { data, error, loading, reload: run };
}
