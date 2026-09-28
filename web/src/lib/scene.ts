'use client';
import { create } from 'zustand';

export type Shot = 'title' | 'lobby' | 'queue' | 'select' | 'vs' | 'arena' | 'result' | 'podium' | 'backdrop';
export interface Slot {
  name?: string;
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

export const CLASS_COLOR: Record<number, string> = { 10: '#6f9fc0', 25: '#b3a27a', 50: '#c46a5e' };
export const TEAM_COLOR = ['#6f8fd0', '#cf8a52'];
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
