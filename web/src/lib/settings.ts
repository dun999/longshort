'use client';
import { create } from 'zustand';

export const useSettings = create<{ allowBots: boolean; setAllowBots: (value: boolean) => void }>((set) => ({
  allowBots: false,
  setAllowBots: (allowBots) => {
    try { localStorage.setItem('ls.allowBots', String(allowBots)); } catch {}
    set({ allowBots });
  },
}));

export function initSettings() {
  try { useSettings.setState({ allowBots: localStorage.getItem('ls.allowBots') === 'true' }); } catch {}
}
