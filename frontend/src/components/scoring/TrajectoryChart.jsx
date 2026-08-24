// Score trajectory — SVG plus the design's HTML footer axis row
// (Scoring Engine.dc.html L205–216). All scaling comes from
// trajectoryGeometry() in lib/scoringViewModel.js.
//
// Solid polyline = real snapshot history. Practice (sandbox) runs are drawn as
// hollow amber dots so a self-entered slider run is never mistaken for a
// signed official one, and their <title> says "practice". The dashed
// projection only appears when the ETA cleared every guard in the adapter —
// and the adapter computes it from OFFICIAL runs only, so the dashed line
// never rests on practice data.

export default function TrajectoryChart({ trajectory }) {
  if (!trajectory || trajectory.mode !== 'chart') return null;
  const { viewBox, W, polyline, projPoints, dots, readyY, readyLabelY, readyLabel, axis } = trajectory;

  return (
    <>
      <svg
        viewBox={viewBox}
        className="w-full h-auto"
        role="img"
        aria-label="Score trajectory across your real scoring runs"
        data-testid="scoring-trajectory"
      >
        <line x1="0" y1={readyY} x2={W} y2={readyY} stroke="#22c55e" strokeWidth="1" strokeDasharray="3 3" />
        <text x="2" y={readyLabelY} fontSize="9" fontWeight="600" fill="#16a34a">{readyLabel}</text>
        {polyline && <polyline points={polyline} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" />}
        {projPoints && (
          <polyline
            points={projPoints}
            fill="none"
            stroke="#7c3aed"
            strokeWidth="2"
            strokeDasharray="4 3"
            opacity="0.5"
            data-testid="trajectory-projection"
          />
        )}
        {dots.map((p, i) => (
          <circle
            key={`pt-${i}`}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="#fff"
            stroke={p.sandbox ? '#d97706' : '#7c3aed'}
            strokeWidth="2"
            strokeDasharray={p.sandbox ? '2 1.6' : undefined}
            data-testid={p.sandbox ? 'trajectory-dot-practice' : 'trajectory-dot-official'}
          >
            <title>{p.title}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10.5px] text-gray-400 dark:text-gray-500 mt-1" data-testid="trajectory-axis">
        <span>{axis.left}</span>
        <span>{axis.now}</span>
        <span>{axis.right}</span>
      </div>
    </>
  );
}
