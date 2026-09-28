'use client';
import { useEffect, useState, useCallback } from 'react';
import { API_URL } from './config';

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await res.json();
  if (json?.error) throw new Error(json.error);
  return json;
}

export function useApi<T = any>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    if (!path) return;
    api<T>(path).then(setData, (e) => setError(e.message));
  }, [path]);
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}
