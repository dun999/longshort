'use client';
import { create } from 'zustand';
import { isCharacter, type CharacterId } from '@longshort/shared';
import { useSocket } from './socket';

/** This browser's character pick. Kept locally, and sent to the keeper (profile) whenever signed in. */
const KEY = 'ls.character';
const read = (): CharacterId | null => {
  try {
    const v = localStorage.getItem(KEY);
    return isCharacter(v) ? v : null;
  } catch {
    return null;
  }
};

export const useCharacter = create<{ id: CharacterId | null; pick: (id: CharacterId) => void }>((set) => ({
  id: typeof window === 'undefined' ? null : read(),
  pick: (id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {}
    set({ id });
    const s = useSocket.getState();
    if (s.verified) s.send({ t: 'character', id });
  },
}));

// a pick made before signing in reaches the keeper as soon as the connection is verified
if (typeof window !== 'undefined')
  useSocket.subscribe((s, prev) => {
    const id = useCharacter.getState().id;
    if (s.verified && !prev.verified && id) s.send({ t: 'character', id });
  });
