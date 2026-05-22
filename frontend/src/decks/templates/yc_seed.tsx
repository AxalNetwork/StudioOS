import React from 'react';
import { Slide16x9, Editable, DeckProps, v } from '../DeckBase';

// ─────────────────────────────────────────────────────────────────
// YC Seed — 10-slide investor deck. Each slide is wrapped in the
// shared <Slide16x9> (fixed 1920×1080) so PDF export geometry is
// identical to the other 11 templates. Per-slide chrome (logo +
// counter + orange bottom rail) is rendered locally via <Frame>.
// SVG primitives + sample-friendly placeholder defaults are inlined
// because they're self-contained.
// NOTE: Field-name deviations from the attachment to avoid clobbering
// other templates that read string keys with the same name:
//   milestones  → milestone_events  (kawasaki reads milestones:string)
//   roadmap     → roadmap_phases    (multiple templates read roadmap:string)
//   use_of_funds → use_of_funds_breakdown (several templates read it:string)
// ─────────────────────────────────────────────────────────────────

const ORANGE = '#FF6600';
const INK = '#0A0A0A';
const SUBTLE = '#737373';
const HAIRLINE = '#E5E5E5';
const PAPER = '#FFFFFF';
const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Display", Helvetica, Arial, sans-serif';

const fmtUSD = (n?: any) => {
  if (n == null || n === '' || (typeof n === 'number' && isNaN(n))) return '—';
  const num = typeof n === 'number' ? n : Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
};
const fmtNum = (n?: any) => {
  if (n == null || n === '') return '—';
  const num = typeof n === 'number' ? n : Number(n);
  return isNaN(num) ? String(n) : num.toLocaleString();
};
const fmtPct = (n?: any) => {
  if (n == null || n === '') return '—';
  const num = typeof n === 'number' ? n : Number(n);
  return isNaN(num) ? String(n) : `${num}%`;
};

// ── SVG primitives ───────────────────────────────────────────────

const Logo: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
    <rect x="4" y="4" width="56" height="56" rx="14" fill={ORANGE} />
    <path d="M20 44 L32 18 L44 44 M24.5 36 H39.5" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HeroOrb: React.FC = () => (
  <svg viewBox="0 0 800 600" width="100%" height="100%" aria-hidden>
    <defs>
      <radialGradient id="orb-g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFB380" stopOpacity="0.9" />
        <stop offset="60%" stopColor={ORANGE} stopOpacity="0.5" />
        <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="orb-h" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="500" cy="300" r="260" fill="url(#orb-g)" />
    <circle cx="500" cy="300" r="180" fill="none" stroke={ORANGE} strokeOpacity="0.25" />
    <circle cx="500" cy="300" r="240" fill="none" stroke={ORANGE} strokeOpacity="0.15" />
    <circle cx="500" cy="300" r="300" fill="none" stroke={ORANGE} strokeOpacity="0.08" />
    <circle cx="430" cy="240" r="40" fill="url(#orb-h)" />
    {[...Array(8)].map((_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const x = 500 + Math.cos(a) * 220;
      const y = 300 + Math.sin(a) * 220;
      return <circle key={i} cx={x} cy={y} r="6" fill={ORANGE} />;
    })}
  </svg>
);

const LineChart: React.FC<{ data: { month: string; v: number }[]; height?: number; color?: string; fill?: boolean }> = ({
  data, height = 240, color = ORANGE, fill = true,
}) => {
  if (!data?.length) return <div style={{ color: '#A3A3A3' }}>[No data yet]</div>;
  const W = 720, H = height, pad = 40;
  const max = Math.max(...data.map((d) => d.v));
  const min = Math.min(0, ...data.map((d) => d.v));
  const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (W - pad * 2);
  const y = (vv: number) => H - pad - ((vv - min) / (max - min || 1)) * (H - pad * 2);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.v)}`).join(' ');
  const area = path + ` L${x(data.length - 1)} ${H - pad} L${x(0)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden>
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <line key={i} x1={pad} x2={W - pad} y1={H - pad - t * (H - pad * 2)} y2={H - pad - t * (H - pad * 2)}
          stroke={HAIRLINE} strokeDasharray="3 3" />
      ))}
      {fill && <path d={area} fill={color} fillOpacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.v)} r="4" fill={color} />
          <text x={x(i)} y={H - pad + 18} textAnchor="middle" fontSize="11" fill={SUBTLE} fontFamily={FONT}>{d.month}</text>
        </g>
      ))}
    </svg>
  );
};

const Funnel: React.FC<{ stages: { stage: string; v: number }[] }> = ({ stages }) => {
  if (!stages?.length) return null;
  const max = Math.max(...stages.map((s) => s.v));
  const W = 720, rowH = 60;
  return (
    <svg viewBox={`0 0 ${W} ${stages.length * rowH + 20}`} width="100%" aria-hidden>
      {stages.map((s, i) => {
        const w = (s.v / max) * (W - 220);
        const y = i * rowH + 10;
        return (
          <g key={i}>
            <rect x={100} y={y} width={w} height={rowH - 16} rx={6} fill={ORANGE} fillOpacity={1 - i * 0.15} />
            <text x={92} y={y + (rowH - 16) / 2 + 5} fontSize="14" fill={INK} textAnchor="end" fontFamily={FONT} fontWeight={500}>{s.stage}</text>
            <text x={100 + w + 12} y={y + (rowH - 16) / 2 + 5} fontSize="14" fill={INK} fontFamily={FONT} fontWeight={700}>{fmtNum(s.v)}</text>
          </g>
        );
      })}
    </svg>
  );
};

const Donut: React.FC<{ data: { label: string; pct: number }[] }> = ({ data }) => {
  if (!data?.length) return null;
  const palette = [ORANGE, '#FF8533', '#FFB380', '#FFD9B3', '#FFE9D6'];
  const r = 100, cx = 120, cy = 120;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
      <svg viewBox="0 0 240 240" width={240} height={240} aria-hidden>
        {data.map((d, i) => {
          const start = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          acc += d.pct;
          const end = (acc / 100) * Math.PI * 2 - Math.PI / 2;
          const large = d.pct > 50 ? 1 : 0;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          return <path key={i} d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={palette[i % palette.length]} />;
        })}
        <circle cx={cx} cy={cy} r={56} fill={PAPER} />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: palette[i % palette.length] }} />
            <span style={{ color: '#404040', fontWeight: 500 }}>{d.label}</span>
            <span style={{ color: INK, fontWeight: 700, marginLeft: 'auto' }}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const MarketCircles: React.FC<{ tam?: number; sam?: number; som?: number }> = ({ tam, sam, som }) => {
  const maxR = 220;
  const tamR = maxR;
  const samR = sam && tam ? maxR * Math.sqrt(sam / tam) : maxR * 0.66;
  const somR = som && tam ? maxR * Math.sqrt(som / tam) : maxR * 0.33;
  return (
    <svg viewBox="0 0 600 480" width="100%" aria-hidden>
      <circle cx="300" cy="240" r={tamR} fill={ORANGE} fillOpacity="0.08" stroke={ORANGE} />
      <circle cx="300" cy="240" r={samR} fill={ORANGE} fillOpacity="0.18" stroke={ORANGE} />
      <circle cx="300" cy="240" r={somR} fill={ORANGE} fillOpacity="0.4" stroke={ORANGE} />
      <text x="300" y="55" textAnchor="middle" fontSize="14" fill={SUBTLE} fontFamily={FONT}>TAM</text>
      <text x="300" y="76" textAnchor="middle" fontSize="22" fill={INK} fontFamily={FONT} fontWeight={700}>{fmtUSD(tam)}</text>
      <text x="300" y={240 - 50} textAnchor="middle" fontSize="12" fill={SUBTLE} fontFamily={FONT}>SAM</text>
      <text x="300" y={240 - 28} textAnchor="middle" fontSize="18" fill={INK} fontFamily={FONT} fontWeight={700}>{fmtUSD(sam)}</text>
      <text x="300" y={240 + 8} textAnchor="middle" fontSize="11" fill="#FFFFFF" fontFamily={FONT}>SOM</text>
      <text x="300" y={240 + 30} textAnchor="middle" fontSize="16" fill="#FFFFFF" fontFamily={FONT} fontWeight={700}>{fmtUSD(som)}</text>
    </svg>
  );
};

// ── Frame: shared chrome inside every Slide16x9 ──────────────────

const Frame: React.FC<React.PropsWithChildren<{ index: number; total?: number; company?: string }>> = ({
  index, total = 10, company, children,
}) => (
  <Slide16x9 font={FONT} ink={INK}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={32} />
        <span style={{ fontSize: 16, fontWeight: 600, color: INK, letterSpacing: -0.2 }}>{company || 'Company'}</span>
      </div>
      <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', fontWeight: 500 }}>
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </div>
    </div>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{children}</div>
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: ORANGE }} />
  </Slide16x9>
);

const SectionEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 3, fontWeight: 700, color: ORANGE }}>{children}</div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{ marginTop: 12, fontSize: 52, fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: INK }}>{children}</h2>
);

// ─────────────────────────────────────────────────────────────────
// Deck
// ─────────────────────────────────────────────────────────────────

export const Deck_yc_seed: React.FC<DeckProps> = ({ data, editable, onEdit }) => {
  const company = v(data, 'company') || undefined;

  // Pre-resolve arrays with placeholder fallbacks
  const problems: { title: string; body: string; metric?: string }[] = (data?.problems?.length ? data.problems : [
    { title: '[Problem #1]', body: '[Why it hurts]', metric: '—' },
    { title: '[Problem #2]', body: '[Why it hurts]', metric: '—' },
    { title: '[Problem #3]', body: '[Why it hurts]', metric: '—' },
  ]);
  const before: string[] = data?.before?.length ? data.before : ['[Manual step]', '[Switch tools]', '[Reconcile]', '[Lose time]'];
  const after: string[] = data?.after?.length ? data.after : ['[One workflow]', '[Auto-synced]', '[Audit trail]', '[Done in seconds]'];
  const pillars: { title: string; body: string }[] = data?.product_pillars?.length ? data.product_pillars : [
    { title: '[Pillar #1]', body: '[Why it works]' },
    { title: '[Pillar #2]', body: '[Why it works]' },
    { title: '[Pillar #3]', body: '[Why it works]' },
  ];
  const trends: string[] = data?.market_trends?.length ? data.market_trends : [
    '[Trend driving demand]', '[Trend driving demand]', '[Trend driving demand]',
  ];
  const tiers: { name: string; price: string; bullets: string[] }[] = data?.pricing_tiers?.length ? data.pricing_tiers : [
    { name: 'Starter', price: '[$ / mo]', bullets: ['[Feature]', '[Feature]'] },
    { name: 'Growth', price: '[$ / mo]', bullets: ['[Feature]', '[Feature]'] },
    { name: 'Enterprise', price: 'Contact', bullets: ['[Feature]', '[Feature]'] },
  ];
  const mrrSeries: { month: string; v: number }[] = data?.mrr_series?.length ? data.mrr_series : [
    { month: 'Jan', v: 4 }, { month: 'Feb', v: 7 }, { month: 'Mar', v: 11 },
    { month: 'Apr', v: 16 }, { month: 'May', v: 24 }, { month: 'Jun', v: 34 },
  ];
  const userSeries: { month: string; v: number }[] = data?.user_series?.length ? data.user_series : [
    { month: 'Jan', v: 120 }, { month: 'Feb', v: 240 }, { month: 'Mar', v: 410 },
    { month: 'Apr', v: 680 }, { month: 'May', v: 1050 }, { month: 'Jun', v: 1640 },
  ];
  const milestoneEvents: { date: string; label: string }[] = data?.milestone_events?.length ? data.milestone_events : [
    { date: 'Q1', label: '[Milestone]' },
    { date: 'Q2', label: '[Milestone]' },
    { date: 'Q3', label: '[Milestone]' },
    { date: 'Q4', label: '[Milestone]' },
  ];
  const funnel: { stage: string; v: number }[] = data?.funnel?.length ? data.funnel : [
    { stage: 'Visitors', v: 10000 }, { stage: 'Signups', v: 1800 },
    { stage: 'Activated', v: 720 }, { stage: 'Paying', v: 180 }, { stage: 'Expanded', v: 64 },
  ];
  const channels: { name: string; share_pct: number }[] = data?.channels?.length ? data.channels : [
    { name: 'Inbound / SEO', share_pct: 35 }, { name: 'Founder network', share_pct: 25 },
    { name: 'Partnerships', share_pct: 20 }, { name: 'Outbound', share_pct: 12 }, { name: 'Community', share_pct: 8 },
  ];
  const founders: { name: string; role: string; pedigree: string[]; initials?: string }[] = data?.founders?.length ? data.founders : [
    { name: '[Founder name]', role: 'CEO', pedigree: ['[Prior role]', '[Notable win]'], initials: 'F1' },
    { name: '[Founder name]', role: 'CTO', pedigree: ['[Prior role]', '[Notable win]'], initials: 'F2' },
  ];
  const timeline: { year: string; event: string }[] = data?.team_timeline?.length ? data.team_timeline : [
    { year: '2018', event: '[Built first product]' },
    { year: '2021', event: '[Shipped at scale]' },
    { year: '2024', event: '[Started this company]' },
  ];
  const roadmap: { quarter: string; goal: string }[] = data?.roadmap_phases?.length ? data.roadmap_phases : [
    { quarter: 'Now', goal: '[Live in production]' },
    { quarter: '+6 mo', goal: '[Reach $X ARR]' },
    { quarter: '+12 mo', goal: '[Expand to Y]' },
    { quarter: '+24 mo', goal: '[Define the category]' },
  ];
  const uof: { label: string; pct: number }[] = data?.use_of_funds_breakdown?.length ? data.use_of_funds_breakdown : [
    { label: 'Engineering', pct: 45 }, { label: 'GTM', pct: 30 }, { label: 'Ops + Infra', pct: 15 }, { label: 'Reserve', pct: 10 },
  ];

  return <>
    {/* ── 01 Cover ─────────────────────────────────────────────── */}
    <Frame index={0} company={company}>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
            <Logo size={88} />
            <Editable as="span" path="company" value={v(data, 'company')} editable={editable} onEdit={onEdit}
              placeholder="[Company]" style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2 }} />
          </div>
          <Editable path="vision" value={v(data, 'vision')} editable={editable} onEdit={onEdit}
            placeholder="[One-line vision — what becomes possible.]"
            style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.25, color: INK }} />
          <Editable path="tagline" value={v(data, 'tagline')} editable={editable} onEdit={onEdit}
            placeholder="[Category. Audience. Disruption.]"
            style={{ fontSize: 20, color: SUBTLE, marginTop: 24 }} />
          <div style={{ marginTop: 56, display: 'flex', alignItems: 'center', gap: 24, fontSize: 13, textTransform: 'uppercase', letterSpacing: 3, color: '#737373' }}>
            <span style={{ color: ORANGE, fontWeight: 700 }}>● Seed</span>
            <span>{new Date().getFullYear()}</span>
            <span>{v(data, 'domain') || 'company.com'}</span>
          </div>
        </div>
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <HeroOrb />
        </div>
      </div>
    </Frame>

    {/* ── 02 Problem ───────────────────────────────────────────── */}
    <Frame index={1} company={company}>
      <SectionEyebrow>Problem</SectionEyebrow>
      <SectionTitle>The status quo wastes time, money, and trust.</SectionTitle>
      <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, flex: 1 }}>
        {problems.slice(0, 3).map((p, i) => (
          <div key={i} style={{ padding: 28, borderRadius: 16, border: `1px solid ${HAIRLINE}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, marginBottom: 20, background: '#FFF1E8' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2 L22 20 L2 20 Z" stroke={ORANGE} strokeWidth="2.2" strokeLinejoin="round" />
                <path d="M12 10 V14" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1.2" fill={ORANGE} />
              </svg>
            </div>
            <Editable as="h3" value={p.title} path={`problems.${i}.title`} editable={editable} onEdit={onEdit}
              style={{ fontSize: 24, fontWeight: 700 }} />
            <Editable value={p.body} path={`problems.${i}.body`} editable={editable} onEdit={onEdit}
              style={{ fontSize: 15, color: SUBTLE, marginTop: 10, lineHeight: 1.5, flex: 1 }} />
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #F5F5F5' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: '#A3A3A3' }}>Impact</div>
              <Editable value={p.metric} path={`problems.${i}.metric`} editable={editable} onEdit={onEdit}
                style={{ fontSize: 24, fontWeight: 800, color: ORANGE, marginTop: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </Frame>

    {/* ── 03 Solution ──────────────────────────────────────────── */}
    <Frame index={2} company={company}>
      <SectionEyebrow>Solution</SectionEyebrow>
      <SectionTitle>One workflow that removes the friction.</SectionTitle>
      <Editable value={v(data, 'solution_summary')} path="solution_summary" editable={editable} onEdit={onEdit}
        placeholder="[Two-sentence description of how the product collapses the chain of pain into a single action.]"
        style={{ fontSize: 20, color: SUBTLE, marginTop: 16, maxWidth: 1100 }} />
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, flex: 1 }}>
        <div style={{ padding: 28, borderRadius: 16, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 16 }}>Before</div>
          {before.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < before.length - 1 ? '1px solid #F5F5F5' : 'none' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: '#F5F5F5', color: '#A3A3A3', fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
              <Editable value={b} path={`before.${i}`} editable={editable} onEdit={onEdit}
                style={{ fontSize: 16, color: '#525252' }} />
            </div>
          ))}
        </div>
        <div style={{ padding: 28, borderRadius: 16, border: `2px solid ${ORANGE}`, background: '#FFFBF5' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 3, fontWeight: 700, color: ORANGE, marginBottom: 16 }}>After</div>
          {after.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < after.length - 1 ? '1px solid #FFE5D1' : 'none' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: ORANGE, color: '#FFF', fontSize: 14, fontWeight: 700 }}>✓</span>
              <Editable value={b} path={`after.${i}`} editable={editable} onEdit={onEdit}
                style={{ fontSize: 16, color: INK, fontWeight: 500 }} />
            </div>
          ))}
        </div>
      </div>
    </Frame>

    {/* ── 04 Product ───────────────────────────────────────────── */}
    <Frame index={3} company={company}>
      <SectionEyebrow>Product</SectionEyebrow>
      <SectionTitle>Built for the way work actually happens.</SectionTitle>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 24, background: '#FAFAFA' }}>
          <svg viewBox="0 0 600 340" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden>
            <rect x="0" y="0" width="600" height="340" rx="14" fill="#FFFFFF" stroke={HAIRLINE} />
            <rect x="0" y="0" width="600" height="44" rx="14" fill="#FAFAFA" />
            <circle cx="22" cy="22" r="5" fill="#FF6B6B" />
            <circle cx="42" cy="22" r="5" fill="#FFD93D" />
            <circle cx="62" cy="22" r="5" fill="#6BCB77" />
            <rect x="20" y="68" width="160" height="252" rx="10" fill="#FAFAFA" />
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x="32" y={88 + i * 36} width="136" height="22" rx="6" fill={i === 1 ? ORANGE : '#EEE'} />
            ))}
            <rect x="200" y="68" width="380" height="60" rx="10" fill="#FAFAFA" />
            <text x="216" y="105" fontSize="14" fontWeight={700} fontFamily={FONT} fill={INK}>{company || 'Product'} · Overview</text>
            <rect x="200" y="144" width="180" height="176" rx="10" fill="#FAFAFA" />
            <rect x="220" y="164" width="140" height="14" rx="4" fill="#E5E5E5" />
            <rect x="220" y="186" width="100" height="10" rx="4" fill="#EEEEEE" />
            <rect x="220" y="220" width="140" height="80" rx="6" fill={ORANGE} opacity="0.15" />
            <path d="M225 290 L260 250 L290 270 L325 235 L355 260" stroke={ORANGE} strokeWidth="2.5" fill="none" />
            <rect x="400" y="144" width="180" height="84" rx="10" fill={ORANGE} />
            <text x="416" y="178" fontSize="13" fontFamily={FONT} fill="#FFE5D1">This week</text>
            <text x="416" y="206" fontSize="28" fontWeight={800} fontFamily={FONT} fill="#FFFFFF">+27%</text>
            <rect x="400" y="238" width="180" height="82" rx="10" fill="#FAFAFA" />
            <rect x="416" y="256" width="100" height="10" rx="4" fill="#E5E5E5" />
            <rect x="416" y="274" width="148" height="10" rx="4" fill="#EEE" />
            <rect x="416" y="292" width="120" height="10" rx="4" fill="#EEE" />
          </svg>
        </div>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr 1fr', gap: 16 }}>
          {pillars.slice(0, 3).map((p, i) => (
            <div key={i} style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: '#FFF1E8', color: ORANGE, fontSize: 14, fontWeight: 700 }}>{i + 1}</span>
                <Editable as="div" value={p.title} path={`product_pillars.${i}.title`} editable={editable} onEdit={onEdit}
                  style={{ fontSize: 18, fontWeight: 700 }} />
              </div>
              <Editable value={p.body} path={`product_pillars.${i}.body`} editable={editable} onEdit={onEdit}
                style={{ fontSize: 14, color: SUBTLE, marginTop: 8, lineHeight: 1.5 }} />
            </div>
          ))}
        </div>
      </div>
    </Frame>

    {/* ── 05 Market ────────────────────────────────────────────── */}
    <Frame index={4} company={company}>
      <SectionEyebrow>Market</SectionEyebrow>
      <SectionTitle>A large, fast-growing category.</SectionTitle>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, flex: 1, alignItems: 'center' }}>
        <MarketCircles tam={Number(v(data, 'tam_usd')) || undefined} sam={Number(v(data, 'sam_usd')) || undefined} som={Number(v(data, 'som_usd')) || undefined} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#A3A3A3', letterSpacing: 3 }}>TAM</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtUSD(v(data, 'tam_usd'))}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#A3A3A3', letterSpacing: 3 }}>SAM</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtUSD(v(data, 'sam_usd'))}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 16, background: ORANGE, color: '#FFF' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, opacity: 0.8 }}>SOM</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtUSD(v(data, 'som_usd'))}</div>
            </div>
          </div>
          <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>CAGR</div>
            <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6, color: ORANGE }}>{fmtPct(v(data, 'market_cagr_pct'))}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 12 }}>Key trends</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {trends.slice(0, 3).map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: ORANGE }} />
                  <Editable value={t} path={`market_trends.${i}`} editable={editable} onEdit={onEdit}
                    style={{ color: INK }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Frame>

    {/* ── 06 Business Model ───────────────────────────────────── */}
    <Frame index={5} company={company}>
      <SectionEyebrow>Business Model</SectionEyebrow>
      <SectionTitle>Software margins. Predictable revenue.</SectionTitle>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {tiers.slice(0, 3).map((t, i) => {
            const featured = i === 1;
            return (
              <div key={i} style={{ borderRadius: 16, padding: 22, border: featured ? `2px solid ${ORANGE}` : `1px solid ${HAIRLINE}`, background: featured ? '#FFFBF5' : '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: featured ? ORANGE : SUBTLE }}>{t.name}</div>
                <Editable value={t.price} path={`pricing_tiers.${i}.price`} editable={editable} onEdit={onEdit}
                  style={{ fontSize: 30, fontWeight: 800, marginTop: 10 }} />
                <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                  {(t.bullets || []).slice(0, 4).map((b, j) => (
                    <div key={j} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ marginTop: 7, width: 6, height: 6, borderRadius: 999, background: ORANGE, flexShrink: 0 }} />
                      <Editable value={b} path={`pricing_tiers.${i}.bullets.${j}`} editable={editable} onEdit={onEdit}
                        style={{ color: '#525252' }} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Revenue flow</div>
          <svg viewBox="0 0 300 320" width="100%" style={{ marginTop: 16, flex: 1 }} preserveAspectRatio="xMidYMid meet" aria-hidden>
            {[
              { y: 20, label: 'Customer signs up' },
              { y: 90, label: 'Activates workflow' },
              { y: 160, label: 'Subscribes (MRR)' },
              { y: 230, label: 'Expands seats / usage' },
            ].map((n, i) => (
              <g key={i}>
                <rect x="40" y={n.y} width="220" height="44" rx="10" fill={i === 2 ? ORANGE : '#FAFAFA'} stroke={HAIRLINE} />
                <text x="150" y={n.y + 28} textAnchor="middle" fontSize="13" fontFamily={FONT}
                  fontWeight={i === 2 ? 700 : 500} fill={i === 2 ? '#FFFFFF' : INK}>{n.label}</text>
                {i < 3 && (
                  <path d={`M150 ${n.y + 50} L150 ${n.y + 84} M144 ${n.y + 78} L150 ${n.y + 84} L156 ${n.y + 78}`}
                    stroke={ORANGE} strokeWidth="2" fill="none" />
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
    </Frame>

    {/* ── 07 Traction ──────────────────────────────────────────── */}
    <Frame index={6} company={company}>
      <SectionEyebrow>Traction</SectionEyebrow>
      <SectionTitle>Compounding momentum.</SectionTitle>
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>MRR</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtUSD(v(data, 'mrr_usd'))}</div>
        </div>
        <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Paying customers</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtNum(v(data, 'paying_customers'))}</div>
        </div>
        <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>MoM growth</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: ORANGE }}>{fmtPct(v(data, 'growth_mom_pct'))}</div>
        </div>
        <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Logos</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtNum(v(data, 'paying_customers'))}</div>
        </div>
      </div>
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>MRR (k USD)</div>
          <LineChart data={mrrSeries} color={ORANGE} />
        </div>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Active users</div>
          <LineChart data={userSeries} color={INK} fill={false} />
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 12 }}>Milestones</div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 1, background: HAIRLINE }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {milestoneEvents.slice(0, 4).map((m, i) => (
              <div key={i} style={{ position: 'relative', paddingTop: 32 }}>
                <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 4, width: 12, height: 12, borderRadius: 999, background: ORANGE }} />
                <div style={{ fontSize: 12, textAlign: 'center', fontWeight: 700, color: ORANGE }}>{m.date}</div>
                <Editable value={m.label} path={`milestone_events.${i}.label`} editable={editable} onEdit={onEdit}
                  style={{ fontSize: 13, textAlign: 'center', color: '#525252', marginTop: 4 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>

    {/* ── 08 Go-To-Market ─────────────────────────────────────── */}
    <Frame index={7} company={company}>
      <SectionEyebrow>Go-To-Market</SectionEyebrow>
      <SectionTitle>Repeatable. Defensible. Compounding.</SectionTitle>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Acquisition funnel</div>
          <Funnel stages={funnel} />
        </div>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Channels</div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {channels.map((c, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  <span style={{ color: '#737373' }}>{c.share_pct}%</span>
                </div>
                <div style={{ marginTop: 4, height: 8, borderRadius: 999, background: '#F5F5F5', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 999, width: `${c.share_pct}%`, background: ORANGE, opacity: 1 - i * 0.12 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 24, borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 12 }}>Flywheel</div>
        <svg viewBox="0 0 720 110" width="100%" aria-hidden>
          {['New user', 'Activates fast', 'Shares output', 'Brings teammate', 'Expands seats'].map((s, i, arr) => {
            const x = 60 + i * 150;
            return (
              <g key={i}>
                <rect x={x - 60} y="30" width="120" height="50" rx="12" fill={i === 0 ? ORANGE : '#FAFAFA'} stroke={HAIRLINE} />
                <text x={x} y="60" textAnchor="middle" fontSize="13" fontFamily={FONT}
                  fontWeight={i === 0 ? 700 : 500} fill={i === 0 ? '#FFFFFF' : INK}>{s}</text>
                {i < arr.length - 1 && (
                  <path d={`M${x + 60} 55 L${x + 90} 55 M${x + 84} 50 L${x + 90} 55 L${x + 84} 60`}
                    stroke={ORANGE} strokeWidth="2" fill="none" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </Frame>

    {/* ── 09 Team ──────────────────────────────────────────────── */}
    <Frame index={8} company={company}>
      <SectionEyebrow>Team</SectionEyebrow>
      <SectionTitle>Founder–market fit is the moat.</SectionTitle>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {founders.slice(0, 2).map((f, i) => (
            <div key={i} style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 22, fontWeight: 800, background: ORANGE }}>
                  {f.initials || (f.name ? f.name.slice(0, 2).toUpperCase() : '··')}
                </div>
                <div>
                  <Editable as="div" value={f.name} path={`founders.${i}.name`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 20, fontWeight: 700 }} />
                  <Editable value={f.role} path={`founders.${i}.role`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 13, color: SUBTLE }} />
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                {(f.pedigree || []).map((p, j) => (
                  <div key={j} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ marginTop: 7, width: 6, height: 6, borderRadius: 999, background: ORANGE, flexShrink: 0 }} />
                    <Editable value={p} path={`founders.${i}.pedigree.${j}`} editable={editable} onEdit={onEdit}
                      style={{ color: '#525252' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Expertise map</div>
          <svg viewBox="0 0 260 240" width="100%" style={{ marginTop: 12, flex: 1 }} preserveAspectRatio="xMidYMid meet" aria-hidden>
            {['Product', 'GTM', 'AI', 'Ops', 'Capital', 'Design'].map((skill, i, arr) => {
              const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
              const x = 130 + Math.cos(a) * 95;
              const y = 120 + Math.sin(a) * 95;
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="6" fill={ORANGE} />
                  <text x={x} y={y - 12} fontSize="11" fill={INK} textAnchor="middle" fontFamily={FONT} fontWeight={600}>{skill}</text>
                </g>
              );
            })}
            <polygon points="130,40 220,90 220,160 130,200 40,160 40,90" fill={ORANGE} fillOpacity="0.15" stroke={ORANGE} strokeWidth="1.5" />
          </svg>
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 12 }}>Track record</div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 1, background: HAIRLINE }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {timeline.slice(0, 3).map((t, i) => (
              <div key={i} style={{ position: 'relative', paddingTop: 32, textAlign: 'center' }}>
                <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 4, width: 12, height: 12, borderRadius: 999, background: ORANGE }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: ORANGE }}>{t.year}</div>
                <Editable value={t.event} path={`team_timeline.${i}.event`} editable={editable} onEdit={onEdit}
                  style={{ fontSize: 13, color: '#525252', marginTop: 4 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>

    {/* ── 10 Vision · The Ask ─────────────────────────────────── */}
    <Frame index={9} company={company}>
      <SectionEyebrow>Vision · The Ask</SectionEyebrow>
      <h2 style={{ marginTop: 12, fontSize: 52, fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: INK }}>
        Raising <span style={{ color: ORANGE }}>{fmtUSD(v(data, 'ask_amount_usd'))}</span> to build the next category leader.
      </h2>
      <Editable value={v(data, 'closing_line')} path="closing_line" editable={editable} onEdit={onEdit}
        placeholder="[One-sentence closing — what becomes true if this works.]"
        style={{ fontSize: 20, color: SUBTLE, marginTop: 16, maxWidth: 1200 }} />
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, flex: 1, minHeight: 0 }}>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 24 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Roadmap</div>
          <div style={{ position: 'relative', marginTop: 24 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 1, background: HAIRLINE }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {roadmap.slice(0, 4).map((r, i) => (
                <div key={i} style={{ position: 'relative', paddingTop: 32 }}>
                  <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 4, width: 12, height: 12, borderRadius: 999, background: ORANGE }} />
                  <div style={{ fontSize: 12, textAlign: 'center', fontWeight: 700, color: ORANGE }}>{r.quarter}</div>
                  <Editable value={r.goal} path={`roadmap_phases.${i}.goal`} editable={editable} onEdit={onEdit}
                    style={{ fontSize: 13, textAlign: 'center', color: '#525252', marginTop: 4 }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ borderRadius: 12, padding: 16, background: ORANGE, color: '#FFF' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, opacity: 0.8 }}>Raising</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{fmtUSD(v(data, 'ask_amount_usd'))}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Runway</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{v(data, 'runway_months') ? `${v(data, 'runway_months')} mo` : '—'}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 16, border: `1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3' }}>Contact</div>
              <Editable value={v(data, 'contact')} path="contact" editable={editable} onEdit={onEdit}
                placeholder="founders@company.com"
                style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }} />
            </div>
          </div>
        </div>
        <div style={{ borderRadius: 16, border: `1px solid ${HAIRLINE}`, padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, color: '#A3A3A3', marginBottom: 12 }}>Use of funds</div>
          <Donut data={uof} />
        </div>
      </div>
    </Frame>
  </>;
};
