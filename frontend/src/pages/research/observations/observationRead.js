// Country observation readings and export field labels (D7718).
export const fieldGroups = {
  'What it measures': {
    metric_label: 'Metric', metric_key: 'Metric key', value: 'Value', unit: 'Unit', statistical_unit: 'What it counts',
    scale: 'Scale', currency: 'Currency', price_basis: 'Price basis', industry_scheme: 'Industry classification',
    industry_code: 'Industry code', size_band: 'Size band', geography_type: 'Geography type', geography_code: 'Geography code',
  },
  'When': { period: 'Period measured', published_at: 'Published', retrieved_at: 'Retrieved' },
  'Status and edition': { observation_status: 'Status', vintage: 'Edition', confidence: 'Confidence' },
  'Source': {
    source_name: 'Source', source_id: 'Source ID', source_url: 'Source link', source_dataset_or_edition: 'Source dataset or edition',
    methodology_url: 'Methodology link', license_or_usage_note: 'Usage note', series_id: 'Series ID',
    supporting_passage: 'Supporting passage', applicability_note: 'Applicability', limitations: 'Limitations',
  },
  'Revisions': { supersedes_observation_id: 'Replaced observation' },
};

export function reading(key, value) {
  if (value == null || value === '') return null;
  if (key === 'observation_status') {
    if (value === 'axal_derived') return 'Axal-derived · computed by Axal';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return String(value);
}

export function externalLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

// The Worker orders current vintages by period then id. Keep its last period
// for each distinct series, including multiple industry/size strata.
export async function countryFigures(api, geography) {
  const { items: metrics } = await api.metrics();
  const rows = [];
  const keys = [...new Set(metrics.map(m => m.metric_key))];
  // Bound concurrent D1 reads independently of the size of the catalogue.
  for (let i = 0; i < keys.length; i += 4) {
    const groups = await Promise.all(keys.slice(i, i + 4).map(async metric => {
      const latest = new Map();
      let offset = 0;
      let coverage;
      for (;;) {
        const page = await api.list({ geography, metric, offset, limit: 100, vintages: 'current' });
        coverage ??= page.coverage;
        for (const o of page.items) {
          const series = [o.source_id, o.series_id, o.industry_scheme, o.industry_code, o.size_band, o.unit, o.currency, o.statistical_unit, o.scale, o.price_basis];
          latest.set(JSON.stringify(series), o);
        }
        offset += page.items.length;
        if (offset >= page.total) break;
        if (!page.items.length) throw new Error('Country observations could not be read.');
      }
      const catalog = metrics.filter(m => m.metric_key === metric);
      if (!coverage) throw new Error('Country coverage could not be read.');
      if (!latest.size) return [{ metric: catalog[0], state: coverage.state }];
      return [...latest.values()].map(observation => ({
        observation, metric: catalog.find(m => m.source_id === observation.source_id),
        state: coverage.latest?.source_id === observation.source_id ? coverage.state : null,
      }));
    }));
    rows.push(...groups.flat());
  }
  return rows;
}
