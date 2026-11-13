export const AD_MONEY_BANNER = 'Spend is charged by each ad platform to your own account. Axal never holds ad money.';
export const LATER_COPY = 'Creating ads, pausing them and rules are not offered yet.';
export const PLATFORMS = ['Google Ads', 'YouTube', 'Meta', 'X'];
export const PLACEMENTS = [
  { key:'google_search_text', name:'Google Search · text', field:'body' },
  { key:'youtube_16_9', name:'YouTube · 16:9', field:'script' },
  { key:'meta_feed_4_5', name:'Meta · feed 4:5', field:'body' },
  { key:'x_promoted_post', name:'X · promoted post', field:'body' },
];
export const sliderAmount = (percent, budget) => budget == null ? null : Math.round(Math.max(0,Math.min(100,Number(percent)||0))*budget/100);
export const amountSlider = (amount,budget) => !budget || amount==null ? 0 : Math.min(100,amount/budget*100);
export function budgetTotal(channels) {
  if(!channels.length || channels.some(c=>c.planned_budget_cents==null)) return null;
  return channels.reduce((sum,c)=>sum+c.planned_budget_cents,0);
}
export function chartMonths(channel,campaign) {
  if(!campaign.starts_on || !campaign.ends_on) return [];
  const from=campaign.starts_on.slice(0,7), to=campaign.ends_on.slice(0,7);
  const found=new Map(channel.months.map(m=>[m.month,m]));
  const rows=[];
  for(let m=from; m<=to;) {
    const row=found.get(m), blank=!row;
    rows.push({label:m,blank,values:blank ? [] : [row.spend_cents/100,channel.budget_type==='daily' ? null : channel.planned_budget_cents==null ? null : channel.planned_budget_cents/100],source:row?.source ?? null,note:blank ? `${m}: Not recorded — no spend was entered.` : null});
    const [y,n]=m.split('-').map(Number); m=n===12 ? `${y+1}-01` : `${y}-${String(n+1).padStart(2,'0')}`;
  }
  return rows;
}
