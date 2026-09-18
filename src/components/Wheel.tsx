'use client';

import { useMemo } from 'react';

export interface Segment { id: string; displayName: string; color: string }

interface Props {
  segments: Segment[];
  /** Rotation in degrees, set once the server has decided the prize. */
  rotation: number;
  onSettled?: () => void;
}

const SIZE = 300;
const R = SIZE / 2;

/**
 * Purely presentational. The wheel never chooses anything — it is rotated to
 * the angle that matches the prize the server already allocated.
 */
export function Wheel({ segments, rotation, onSettled }: Props) {
  const paths = useMemo(() => {
    const count = Math.max(segments.length, 1);
    const step = 360 / count;
    return segments.map((segment, index) => {
      const start = index * step - 90;
      const end = start + step;
      const toXY = (angle: number) => {
        const rad = (angle * Math.PI) / 180;
        return [R + R * Math.cos(rad), R + R * Math.sin(rad)] as const;
      };
      const [x1, y1] = toXY(start);
      const [x2, y2] = toXY(end);
      const large = step > 180 ? 1 : 0;
      const mid = (start + end) / 2;
      const [lx, ly] = (() => {
        const rad = (mid * Math.PI) / 180;
        return [R + R * 0.62 * Math.cos(rad), R + R * 0.62 * Math.sin(rad)] as const;
      })();
      return { segment, d: `M${R},${R} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`, lx, ly, mid };
    });
  }, [segments]);

  return (
    <div className="relative mx-auto" style={{ width: SIZE, maxWidth: '100%' }}>
      {/* Pointer */}
      <svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"
           className="absolute left-1/2 top-[-12px] z-10 -translate-x-1/2 drop-shadow">
        <path d="M20 26 L4 2 H36 Z" fill="#C9A227" stroke="#0F2742" strokeWidth="2" strokeLinejoin="round" />
      </svg>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" role="img"
           aria-label={`Prize wheel with ${segments.length} prizes: ${segments.map((s) => s.displayName).join(', ')}`}>
        <circle cx={R} cy={R} r={R - 1} fill="#081727" />
        <g className="wheel" style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '50% 50%' }}
           onTransitionEnd={onSettled}>
          {paths.map(({ segment, d, lx, ly, mid }) => (
            <g key={segment.id}>
              <path d={d} fill={segment.color} stroke="#F7F9FB" strokeWidth="2" />
              <text x={lx} y={ly} fill="#FFFFFF" fontSize="13" fontWeight="600" textAnchor="middle"
                    dominantBaseline="middle" transform={`rotate(${mid + 90} ${lx} ${ly})`}>
                {segment.displayName.length > 14 ? `${segment.displayName.slice(0, 13)}…` : segment.displayName}
              </text>
            </g>
          ))}
        </g>
        <circle cx={R} cy={R} r={34} fill="#0F2742" stroke="#C9A227" strokeWidth="3" />
        <text x={R} y={R + 5} fill="#E6C75B" fontSize="15" fontWeight="700" textAnchor="middle"
              fontFamily="Fraunces, Georgia, serif">TOAP</text>
      </svg>
    </div>
  );
}

/**
 * Angle that brings the winning segment under the pointer, with a random
 * offset inside the segment so consecutive spins never look identical.
 */
export function rotationFor(segments: Segment[], prizeId: string, currentRotation: number, turns = 6): number {
  const index = segments.findIndex((s) => s.id === prizeId);
  if (index < 0) return currentRotation + turns * 360;
  const step = 360 / segments.length;
  const centre = index * step + step / 2;
  const jitter = (Math.random() - 0.5) * step * 0.6;
  const base = Math.ceil(currentRotation / 360) * 360;
  return base + turns * 360 - centre - jitter;
}
