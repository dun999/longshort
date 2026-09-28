/*
 * Mode card key art: how each format is won, as a live mini-graphic (SVG + CSS, no characters).
 * Duel: two equity lines race to the bell. Squad: a team tug-of-war on summed equity.
 * Royale: eight equity bars, the lowest one is cut.
 */

// deterministic wiggly equity path across a 360-wide plot
function walk(seed: number, drift: number) {
  let y = 150;
  const pts: string[] = [];
  for (let i = 0; i <= 36; i++) {
    const x = 20 + i * 10;
    y += Math.sin(i * 0.9 + seed) * 7 + Math.sin(i * 0.37 + seed * 2) * 5 - drift;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return { d: `M${pts.join(' L')}`, end: pts.at(-1)!.split(',').map(Number) as [number, number] };
}
const YOU = walk(1.2, 1.9);
const RIVAL = walk(4.1, -0.6);

function Duel() {
  return (
    <svg viewBox="0 0 400 300" className="lpv" aria-hidden>
      {[60, 110, 160, 210, 260].map((y) => (
        <line key={y} x1="20" x2="380" y1={y} y2={y} className="lpv-grid" />
      ))}
      <text x="22" y="34" className="lpv-label">
        60s · 1v1
      </text>
      {/* faint full trace underneath so the card never reads empty while the lines redraw */}
      <path d={RIVAL.d} className="lpv-ghost lpv-short" />
      <path d={YOU.d} className="lpv-ghost lpv-long" />
      <path d={RIVAL.d} className="lpv-line lpv-short" pathLength={1} />
      <path d={YOU.d} className="lpv-line lpv-long" pathLength={1} />
      <circle cx={YOU.end[0]} cy={YOU.end[1]} r="5" className="lpv-dot lpv-long-f" />
      <circle cx={RIVAL.end[0]} cy={RIVAL.end[1]} r="5" className="lpv-dot lpv-short-f" />
      <text x={YOU.end[0] - 14} y={YOU.end[1] - 22} textAnchor="end" className="lpv-tag lpv-long-f">
        YOU +12.4%
      </text>
      <text x={RIVAL.end[0] - 6} y={RIVAL.end[1] + 24} textAnchor="end" className="lpv-tag lpv-short-f">
        RIVAL −3.1%
      </text>
    </svg>
  );
}

function Squad() {
  return (
    <svg viewBox="0 0 400 300" className="lpv" aria-hidden>
      <text x="22" y="34" className="lpv-label">
        team equity · 3v3
      </text>
      {/* the rope: alpha pulls from the left, bravo from the right, the knot swings */}
      <rect x="20" y="138" width="360" height="24" className="lpv-track" />
      <g className="lpv-tug">
        <rect x="20" y="138" width="190" height="24" className="lpv-alpha" />
        <rect x="210" y="138" width="170" height="24" className="lpv-bravo" />
        <rect x="206" y="126" width="8" height="48" className="lpv-knot" />
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={30 + i * 44} y={196} width="34" height="10" className="lpv-pip lpv-alpha" style={{ animationDelay: `${i * -0.7}s` }} />
          <rect x={336 - i * 44} y={196} width="34" height="10" className="lpv-pip lpv-bravo" style={{ animationDelay: `${i * -0.5 - 0.3}s` }} />
        </g>
      ))}
      <text x="22" y="236" className="lpv-tag lpv-alpha-f">
        ALPHA +8.2%
      </text>
      <text x="378" y="236" textAnchor="end" className="lpv-tag lpv-bravo-f">
        BRAVO −4.9%
      </text>
    </svg>
  );
}

function Royale() {
  const bars = [0.62, 0.84, 0.47, 0.95, 0.71, 0.38, 0.8, 0.22];
  return (
    <svg viewBox="0 0 400 300" className="lpv" aria-hidden>
      <text x="22" y="34" className="lpv-label">
        round 3 · lowest is cut
      </text>
      {bars.map((h, i) => {
        const cut = i === 7;
        const x = 34 + i * 43;
        return (
          <g key={i}>
            <rect x={x} y={250 - h * 180} width="28" height={h * 180} className={`lpv-bar ${cut ? 'cut' : ''}`} style={{ animationDelay: `${i * -0.45}s`, transformOrigin: `${x + 14}px 250px` }} />
            {cut && (
              <text x={x + 14} y={250 - h * 180 - 12} textAnchor="middle" className="lpv-cut">
                CUT
              </text>
            )}
          </g>
        );
      })}
      <line x1="20" x2="380" y1="250" y2="250" className="lpv-base" />
    </svg>
  );
}

export function ModeViz({ mode }: { mode: 'duel' | 'squad' | 'royale' }) {
  return mode === 'duel' ? <Duel /> : mode === 'squad' ? <Squad /> : <Royale />;
}
