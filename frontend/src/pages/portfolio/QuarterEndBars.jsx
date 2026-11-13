/**
 * D4817 part 3 (#5311, canvas PF-03): the bars of NAV at each quarter-end,
 * drawn with the chart library the Performance page already used (recharts).
 * Loaded lazily by `QuarterEndChart` once its box has a width, so the library
 * never loads for a page that has nothing to draw.
 *
 * `rows` is `chartRowsOf(series)`: a quarter-end that was not read carries a
 * null value and recharts draws no bar for it. No axis, grid or line is drawn:
 * the columns' words under the plot are HTML in the same order, and the bars
 * fill the same equal columns (no margin, no axis width).
 */
import { Bar, BarChart, XAxis, YAxis } from 'recharts';

export default function QuarterEndBars({ rows, width, height }) {
  return (
    <BarChart width={width} height={height} data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="24%">
      <XAxis dataKey="date" hide />
      <YAxis hide domain={[0, 'dataMax']} />
      <Bar dataKey="nav" fill="currentColor" radius={[4, 4, 0, 0]} isAnimationActive={false} />
    </BarChart>
  );
}
