import { useCallback, useEffect, useRef, useState } from "react";
import { API, type ServerNode } from "../lib";

export type LiveConnection = "connecting" | "live" | "reconnecting" | "paused";

export function useLiveNodes(initialNodes: ServerNode[]) {
  const [nodes, setNodes] = useState(initialNodes);
  const [loaded, setLoaded] = useState(initialNodes.length > 0);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const lifecycle = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const request = useRef(0);
  const streaming = useRef(false);

  const refresh = useCallback(async (manual = false) => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted) return;
    const version = revision.current;
    const sequence = ++request.current;
    if (manual) setRefreshing(true);
    try {
      const next = await API("/api/v1/servers", { signal: controller.signal });
      if (!Array.isArray(next)) throw new Error("Invalid node snapshot");
      if (!controller.signal.aborted && sequence === request.current) {
        // A slower HTTP response must not replace a newer pushed snapshot.
        if (version === revision.current) setNodes(next);
        setError(false);
      }
    } catch {
      if (!controller.signal.aborted && sequence === request.current && !streaming.current) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        if (manual) setRefreshing(false);
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let fallback: number | undefined;
    let watchdog: number | undefined;
    let polling = false;
    let delay = 1000;
    const active = () => !disposed && !document.hidden;

    function disconnect() {
      clearTimeout(watchdog);
      if (socket) {
        socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
        socket = null;
      }
      streaming.current = false;
    }

    async function poll() {
      if (!active() || streaming.current || polling) return;
      polling = true;
      await refresh();
      polling = false;
      if (active() && !streaming.current) {
        fallback = window.setTimeout(() => { fallback = undefined; void poll(); }, 5000);
      }
    }

    function scheduleRetry() {
      if (!active()) return;
      setConnection("reconnecting");
      if (retry === undefined) {
        retry = window.setTimeout(() => { retry = undefined; connect(); }, delay);
        delay = Math.min(delay * 2, 30000);
      }
      if (fallback === undefined) void poll();
    }

    function lost(candidate: WebSocket) {
      if (socket !== candidate || !active()) return;
      disconnect();
      scheduleRetry();
    }

    function connect() {
      if (!active() || socket) return;
      const url = new URL("/ws/client", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      let candidate: WebSocket;
      try { candidate = new WebSocket(url); }
      catch { scheduleRetry(); return; }
      socket = candidate;
      const watch = () => {
        clearTimeout(watchdog);
        watchdog = window.setTimeout(() => lost(candidate), 10000);
      };
      watch();
      candidate.onmessage = event => {
        if (!active() || socket !== candidate) return;
        try {
          const next = JSON.parse(event.data);
          if (!Array.isArray(next)) throw new Error("Invalid node snapshot");
          revision.current++;
          streaming.current = true;
          delay = 1000;
          clearTimeout(retry); retry = undefined;
          clearTimeout(fallback); fallback = undefined;
          setNodes(next);
          setLoaded(true);
          setError(false);
          setConnection("live");
          watch();
        } catch { lost(candidate); }
      };
      candidate.onclose = () => lost(candidate);
      candidate.onerror = () => lost(candidate);
    }

    function resume() {
      if (!active()) return;
      if (lifecycle.current?.signal.aborted !== false) lifecycle.current = new AbortController();
      if (!streaming.current) {
        setConnection("connecting");
        clearTimeout(retry); retry = undefined;
        connect();
        if (fallback === undefined) void poll();
      }
    }

    function visibility() {
      if (!document.hidden) { resume(); return; }
      clearTimeout(retry); retry = undefined;
      clearTimeout(fallback); fallback = undefined;
      disconnect();
      lifecycle.current?.abort();
      setRefreshing(false);
      setConnection("paused");
    }

    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", resume);
    if (document.hidden) setConnection("paused"); else resume();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", resume);
      clearTimeout(retry);
      clearTimeout(fallback);
      disconnect();
      lifecycle.current?.abort();
    };
  }, [refresh]);

  return { nodes, loaded, error, refreshing, connection, refresh };
}
