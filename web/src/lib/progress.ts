'use client';
/*
 * What PLAY is doing right now, as it happens: each step starts when its request or transaction is sent
 * and ends when it confirms. The lobby lists them while it queues, so a wait always has a real reason.
 */
import { create } from 'zustand';

export type StepId = 'verify' | 'find' | 'key' | 'approve' | 'account';
export interface Step {
  id: StepId;
  /** performance.now() when it began */
  at: number;
  /** measured duration once it finished */
  ms?: number;
  /** approve only: this call also carries the account's one-time gas-free delegation */
  setup?: boolean;
}

export const useSteps = create<{ active: boolean; steps: Step[] }>(() => ({ active: false, steps: [] }));

/** Record steps from now on (PLAY pressed). */
export const startSteps = () => useSteps.setState({ active: true, steps: [] });
export const stopSteps = () => useSteps.setState({ active: false, steps: [] });

/** Runs `fn` as a step when PLAY is queueing; otherwise just runs it. A failed step is dropped from the list. */
export async function step<T>(id: StepId, fn: () => Promise<T>, extra?: Pick<Step, 'setup'>): Promise<T> {
  if (!useSteps.getState().active) return fn();
  const at = performance.now();
  useSteps.setState((s) => ({ steps: [...s.steps.filter((x) => x.id !== id), { id, at, ...extra }] }));
  const settle = (ms?: number) =>
    useSteps.setState((s) => ({ steps: ms === undefined ? s.steps.filter((x) => x.at !== at) : s.steps.map((x) => (x.at === at ? { ...x, ms } : x)) }));
  try {
    const out = await fn();
    settle(Math.round(performance.now() - at));
    return out;
  } catch (e) {
    settle();
    throw e;
  }
}
