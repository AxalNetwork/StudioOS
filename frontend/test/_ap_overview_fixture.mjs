export const recorded = value => ({ available: true, recorded: true, value });
export function apOverviewFixture() {
  const counts = { people: recorded(8), by_kind: recorded([{kind:'advisor',count:3},{kind:'operating_partner',count:3},{kind:'deck_only',count:2}]),
    by_stage: recorded([{kind:'advisor',stage:'active',count:2},{kind:'advisor',stage:'onboarding',count:1},{kind:'operating_partner',stage:'paused',count:1},{kind:'operating_partner',stage:'ended',count:2},{kind:'deck_only',stage:null,count:2}]),
    firms: recorded({total:3,listed:2}), lab_hosts: recorded({approved:14,pending:3}), cohort_assignments: recorded(2) };
  const settlements = recorded({currency:'usd', count:2, to_member_cents:12500, from_member_cents:4000, rows:[{id:81,deal_id:71,direction:'to_member',amount_cents:12500,due_on:'2026-11-01'},{id:82,deal_id:72,direction:'from_member',amount_cents:4000,due_on:'2026-11-03'}]});
  return {scope:'hq',timezone:'America/New_York',as_of:'2026-10-25T12:00:00Z',counts,
    sessions:recorded({this_month:17,timezone:'America/New_York',weeks:[{week:'2026-10-12',partial:false,booked:0,completed:4,no_show:1},{week:'2026-10-19',partial:true,booked:3,completed:2,no_show:0}]}),
    deals:recorded({total:3,ending_soon:2,by_type:[{type:'capital_partnership',count:2,soonest_end:'2026-11-01 00:00:00'},{type:'custom',count:1,soonest_end:null}]}),
    skills:recorded({supply:[{skill:'Synthetic operations',count:5},{skill:'Synthetic research',count:0}],demand:{available:true,recorded:false,reason:'Founder demand has no matching store.'}}),settlements,
    needs_you:{unattached_partners:recorded([{ref:'user:10',name:'Synthetic partner'}]),missing_advisor_profiles:recorded([{ref:'user:11',name:'Synthetic advisor'}]),ending_deals:recorded([{id:71,ends_at:'2026-11-01 00:00:00'}]),pending_hosts:recorded([{id:91},{id:92},{id:93}]),missing_deck_photos:recorded([{ref:'roster:7',name:'Synthetic deck card'}]),settlements},unreadable:[]};
}
