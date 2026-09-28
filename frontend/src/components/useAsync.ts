"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { data: T | null; error: unknown; loading: boolean };

/** Load on mount and whenever `deps` change, with a manual reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    fnRef.current().then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (error) => { if (live) setState((s) => ({ ...s, error, loading: false })); },
    );
    return () => { live = false; };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Wall-clock seconds, ticking - read in an effect, never during render. */
export function useNow(everyMs = 5000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, everyMs);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [everyMs]);
  return now;
}
