import React from "react";

interface Props {
  fillPct: number;   // 0–100
  currentGal: number;
  maxGal: number;
}

export const FillMeter: React.FC<Props> = ({ fillPct, currentGal, maxGal }) => {
  const size = 200;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2;

  const describeArc = (startAngle: number, endAngle: number) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(toRad(startAngle));
    const y1 = cy + radius * Math.sin(toRad(startAngle));
    const x2 = cx + radius * Math.cos(toRad(endAngle));
    const y2 = cy + radius * Math.sin(toRad(endAngle));
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Arc sweeps left (180°) → right (360°), top-facing half circle
  const bgPath   = describeArc(180, 360);
  const fillAngle = 180 + (fillPct / 100) * 180;
  const fillPath  = fillPct > 0 ? describeArc(180, fillAngle) : "";

  const color = fillPct < 25 ? "#ef4444"
              : fillPct < 50 ? "#f59e0b"
              : fillPct < 75 ? "#3b82f6"
              : "#2563eb";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg
        width={size}
        height={size / 2 + strokeWidth}
        viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}
      >
        <path d={bgPath} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} strokeLinecap="round" />
        {fillPct > 0 && (
          <path d={fillPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="32" fontWeight="700" fill="#111827">
          {fillPct.toFixed(1)}%
        </text>
      </svg>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0 0" }}>
        {currentGal.toFixed(1)} / {maxGal} gal
      </p>
    </div>
  );
};
