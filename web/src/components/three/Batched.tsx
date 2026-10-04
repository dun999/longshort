'use client';
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draws its static children as one mesh per material. A prop built from many small parts (the gate is
 * ~80) costs a draw call per part in the arena pass and again in the floor's reflection pass, which on a
 * phone keeps the main thread busy enough to delay taps. The parts stay in the tree, hidden, so React
 * still owns and disposes them. Anything that moves on its own (a flickering flame) goes in a group with
 * `userData={{ animated: true }}` and is drawn as it is; a moving group can hold its own <Batched>.
 */
export function Batched({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.updateMatrixWorld(true);
    const toRoot = root.matrixWorld.clone().invert();
    const parts = new Map<THREE.Material, { meshes: THREE.Mesh[]; geos: THREE.BufferGeometry[] }>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material) || mesh.material.transparent) return;
      for (let p = mesh.parent; p && p !== root; p = p.parent) if (p.userData.animated) return;
      const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(toRoot.clone().multiply(mesh.matrixWorld));
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo.clearGroups();
      const entry = parts.get(mesh.material) ?? { meshes: [], geos: [] };
      entry.meshes.push(mesh);
      entry.geos.push(geo);
      parts.set(mesh.material, entry);
    });
    const merged: THREE.Mesh[] = [];
    for (const [material, { meshes, geos }] of parts) {
      const geo = meshes.length > 1 ? mergeGeometries(geos) : null;
      if (!geo) {
        geos.forEach((g) => g.dispose()); // a single part, or parts that can't share a buffer: drawn as they are
        continue;
      }
      geos.forEach((g) => g.dispose());
      meshes.forEach((m) => (m.visible = false));
      const mesh = new THREE.Mesh(geo, material);
      root.add(mesh);
      merged.push(mesh);
    }
    return () => {
      for (const mesh of merged) {
        root.remove(mesh);
        mesh.geometry.dispose();
      }
      parts.forEach(({ meshes }) => meshes.forEach((m) => (m.visible = true)));
    };
  }, []);
  return <group ref={ref}>{children}</group>;
}
