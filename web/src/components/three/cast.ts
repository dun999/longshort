'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterId } from '@longshort/shared';

/*
 * The arena cast: low-poly, rigged characters (built in Blender from web/art/cast, exported to
 * /models/<id>.glb with a foothold and, for the lounge pose, props). Faces carry one flat colour each
 * (COLOR_0); the "Accent" faces take the player's colour. Clips: idle, cheer (a victory dance), sulk (defeat), lounge.
 */

export const CAST_URL = (id: CharacterId) => `/models/${id}.glb`;
/** Footholds are modelled below the feet (top at 0); lift a cast copy by this much to stand it on the floor. */
export const FOOT_H = 0.3;
export type CastClip = 'idle' | 'cheer' | 'sulk' | 'lounge';

const body = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
const glow = new THREE.MeshBasicMaterial({ color: '#ffcf7a', toneMapped: false });
const accents = new Map<string, THREE.MeshStandardMaterial>();
function accent(color: string) {
  if (!accents.has(color)) accents.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0 }));
  return accents.get(color)!;
}

/** A private copy of a character + foothold, with its materials set for this player's colour.
 * Props only show in the lounge pose; `base: false` drops the foothold (landing stills). */
export function useCast(id: CharacterId, color: string, clipName: CastClip = 'idle', speed = 1, at?: number, base = true) {
  const gltf = useGLTF(CAST_URL(id));
  const scene = useMemo(() => {
    const s = cloneSkinned(gltf.scene) as THREE.Group;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false; // skinned bounds don't follow the pose
      if (m.name.includes('Prop')) m.userData.prop = true;
      if (m.name.includes('Base')) m.userData.base = true;
      m.userData.mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => mat.name);
    });
    return s;
  }, [gltf.scene]);
  // colour and visibility change in place: a new leverage colour must not re-clone (and restart) the figure
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (m.userData.mats as string[]).map((n) => (n.startsWith('Accent') ? accent(color) : n.startsWith('Glow') ? glow : body));
      m.material = mats.length > 1 ? mats : mats[0];
      if (m.userData.base) m.visible = base;
      if (m.userData.prop) m.visible = clipName === 'lounge';
    });
  }, [scene, color, base, clipName]);

  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const current = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    const clip = gltf.animations.find((a) => a.name === clipName) ?? gltf.animations.find((a) => a.name === 'idle');
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (at !== undefined) {
      // a held frame (stills for 2D cards): full weight at once, no crossfade
      mixer.stopAllAction();
      next.reset().play();
      next.time = at;
      next.paused = true;
      mixer.update(0);
      current.current = next;
      return;
    }
    next.reset().setEffectiveTimeScale(speed).fadeIn(0.35).play();
    // start each copy at a different point of its loop so a row of the same class doesn't breathe in unison
    if (!current.current) next.time = Math.random() * clip.duration;
    current.current?.fadeOut(0.35);
    current.current = next;
  }, [clipName, gltf.animations, mixer, speed, at]);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);
  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1)));
  return scene;
}

export const preloadCast = (ids: CharacterId[]) => ids.forEach((c) => useGLTF.preload(CAST_URL(c)));
