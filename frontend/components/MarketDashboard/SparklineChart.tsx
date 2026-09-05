'use client';

import { useId } from 'react';

interface Props {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}

export default function SparklineChart({ data, color, width = 80, height = 32, strokeWidth = 1.5 }: Props) {
  // Stable, SSR-safe unique id. ``Math.random()`` produced a different id on
  // every render and could collide between sibling cards, breaking the
  // gradient fill in subtle ways.
  const reactId = useId();
  const gradientId = `sparkline_grad_${reactId.replace(/[:]/g, '')}`;

  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  const firstPoint = points[0];

  // Build fill path — anchor to the bottom of the viewport for a clean area fill.
  const fillPath = `M ${firstPoint} L ${points.join(' L ')} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Fill */}
      <path d={fillPath} fill={`url(#${gradientId})`} />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last dot */}
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r="2"
        fill={color}
      />
    </svg>
  );
}
