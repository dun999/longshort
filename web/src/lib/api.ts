'use client';
import { useEffect, useState, useCallback } from 'react';
import { API_URL } from './config';
import { handleGateResponse } from './gate-client';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  handleGateResponse(res);
  const json = await res.json();
  if (!res.ok || json?.error) throw new ApiError(json?.error || `Request failed (${res.status})`, res.status, json?.code);
  return json;
}

export function useApi<T = any>(path: string | null, refreshMs?: number) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: T }>();
  const [failure, setFailure] = useState<{ path: string; error: string }>();
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    if (!path) return;
    let inFlight = false;
    const fetchData = async () => {
      if (inFlight) return;
      inFlight = true;
      try { const value = await api<T>(path); if (active) { setSnapshot({ path, data: value }); setFailure(undefined); } }
      catch (e) { if (active) setFailure({ path, error: (e as Error).message }); }
      finally { inFlight = false; }
    };
    void fetchData();
    const timer = refreshMs ? setInterval(fetchData, refreshMs) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [path, refreshMs, generation]);
  return { data: snapshot?.path === path ? snapshot.data : undefined, error: failure?.path === path ? failure.error : undefined, reload: load };
}
