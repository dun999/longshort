import type { ReactNode } from 'react';

/** The rule and index line that opens each landing section, so every section has a visible start. */
export function Chapter({ n, name, aside }: { n: string; name: string; aside?: ReactNode }) {
  return (
    <div className="lp-chapter">
      <b>{n}</b>
      <span>{name}</span>
      {aside && <em>{aside}</em>}
    </div>
  );
}
