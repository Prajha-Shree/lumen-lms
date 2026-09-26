export { ChartCard, Legend, type TableView } from './ChartCard';
export { Heatmap, heatmapTable, type HeatCell } from './Heatmap';
export { HistogramChart } from './HistogramChart';
export { TrendChart, type Series } from './TrendChart';

/** Browser timezone for server-side day bucketing. */
export const viewerTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
