/**
 * Stands in for the `n8ao` package (next.config.ts aliases it here). @react-three/postprocessing ships as
 * one file that imports n8ao for its <N8AO> effect, which the arena does not use; the real package adds
 * ~70 KB gzipped of neural-denoiser weights to the 3D chunk.
 */
export class N8AOPostPass {
  constructor() {
    throw new Error('N8AO is not bundled; see next.config.ts');
  }
}
