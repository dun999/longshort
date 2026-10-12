'use client';
import { create } from 'zustand';

// On by default: a lone player gets a labelled bot after ~12 s instead of an empty lobby that times out.
export const useSettings = create<{ allowBots: boolean; setAllowBots: (value: boolean) => void }>((set) => ({
  allowBots: true,
  setAllowBots: (allowBots) => {
    try { localStorage.setItem('ls.allowBots', String(allowBots)); } catch {}
    set({ allowBots });
  },
}));

export function initSettings() {
  try { useSettings.setState({ allowBots: localStorage.getItem('ls.allowBots') !== 'false' }); } catch {}
}
