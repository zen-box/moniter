import { useCallback, useEffect, useRef, useState } from "react";
import { API, requestError } from "./lib";

/** Keep the last successful result visible while refreshing or retrying. */
export function useAdminResource<T>(path: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const value = await API(path, { signal: controller.signal });
      if (!controller.signal.aborted) { setData(value); setError(""); }
    } catch (error) {
      if (!controller.signal.aborted) setError(requestError(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void reload(); return () => pending.current?.abort(); }, [reload]);
  return { data, setData, error, loading, reload };
}
