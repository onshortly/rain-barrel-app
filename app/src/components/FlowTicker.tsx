import React from "react";

const GPM_PER_LPM = 0.2642;

interface Props {
  flowLpm: number;
}

export const FlowTicker: React.FC<Props> = ({ flowLpm }) => {
  const flowGpm = flowLpm * GPM_PER_LPM;
  return (
    <div style={{ marginTop: 10, fontSize: 14, color: "#475569" }}>
      <span style={{ fontWeight: 600 }}>Flow:</span>{" "}
      {flowGpm > 0 ? `${flowGpm.toFixed(2)} GPM` : "—"}
    </div>
  );
};
