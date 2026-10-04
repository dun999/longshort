'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ClassId } from '@longshort/shared';

/*
 * The arena cast: one low-poly, rigged character per class (built in Blender from web/art/cast, exported to
 * /models/<class>.glb with its foothold). Faces carry one flat colour each (COLOR_0); the "Accent" faces take
 * the player's colour. Clips: idle, win, out.
 */

export const CAST_URL = (cls: ClassId) => `/models/${cls}.glb`;
/** Footholds are modelled below the feet (top at 0); lift a cast copy by this much to stand it on the floor. */
export const FOOT_H = 0.3;
export type CastClip = 'idle' | 'win' | 'out';

const body = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
const glow = new THREE.MeshBasicMaterial({ color: '#ffcf7a', toneMapped: false });
const accents = new Map<string, THREE.MeshStandardMaterial>();
function accent(color: string) {
  if (!accents.has(color)) accents.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0 }));
  return accents.get(color)!;
}

/** A private copy of a class's character + foothold, with its materials set for this player's colour. */
export function useCast(cls: ClassId, color: string, clipName: CastClip = 'idle', speed = 1) {
  const gltf = useGLTF(CAST_URL(cls));
  const scene = useMemo(() => {
    const s = cloneSkinned(gltf.scene) as THREE.Group;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false; // skinned bounds don't follow the pose
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => (mat.name.startsWith('Accent') ? accent(color) : mat.name.startsWith('Glow') ? glow : body));
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    return s;
  }, [gltf.scene, color]);

  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const current = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    const clip = gltf.animations.find((a) => a.name === clipName) ?? gltf.animations.find((a) => a.name === 'idle');
    if (!clip) return;
    const next = mixer.clipAction(clip);
    next.reset().setEffectiveTimeScale(speed).fadeIn(0.35).play();
    // start each copy at a different point of its loop so a row of the same class doesn't breathe in unison
    if (!current.current) next.time = Math.random() * clip.duration;
    current.current?.fadeOut(0.35);
    current.current = next;
  }, [clipName, gltf.animations, mixer, speed]);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);
  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1)));
  return scene;
}

export const preloadCast = () => (['tank', 'scout', 'sniper'] as ClassId[]).forEach((c) => useGLTF.preload(CAST_URL(c)));
