'use client';
import { create } from 'zustand';
import { CLASSES, type CharacterId } from '@longshort/shared';

export type Shot = 'title' | 'lobby' | 'queue' | 'select' | 'vs' | 'arena' | 'result' | 'podium' | 'backdrop';
export interface Slot {
  /** who this is (address): a figure follows its player when seats are reshuffled */
  id?: string;
  name?: string;
  character?: CharacterId;
  color: string;
  leverage?: number;
  team?: number;
  me?: boolean;
  empty?: boolean;
  out?: boolean;
  lead?: number; // -1..1 relative performance → avatar pose/glow
}

interface SceneState {
  shot: Shot;
  slots: Slot[];
  intensity: number; // 0..1 arena energy (drives ring speed / bloom)
  outcome: 'win' | 'loss' | 'draw' | null;
  shakeAt: number;
  flash: string | null;
  set: (p: Partial<Omit<SceneState, 'set' | 'shake'>>) => void;
  shake: (color?: string) => void;
}

export const useScene = create<SceneState>((set) => ({
  shot: 'title',
  slots: [],
  intensity: 0.2,
  outcome: null,
  shakeAt: 0,
  flash: null,
  set: (p) => set(p),
  shake: (color = 'rgba(210,90,85,0.5)') => set({ shakeAt: performance.now(), flash: color }),
}));

const CLASS_TONE = { tank: '#6f9fc0', scout: '#b3a27a', sniper: '#c46a5e' } as const;
/** Colour by leverage, from the active class table (live 5/10/15, virtual 10/25/50). */
export const CLASS_COLOR: Record<number, string> = Object.fromEntries(
  (Object.keys(CLASSES) as (keyof typeof CLASSES)[]).map((id) => [CLASSES[id].leverage, CLASS_TONE[id]]),
);
export const TEAM_COLOR = ['#6f8fd0', '#cf8a52'];
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
