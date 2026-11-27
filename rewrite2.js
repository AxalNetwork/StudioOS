const fs = require('fs');

const code = `
function Dashboard({ state, onComplete, completing, completeError }) {
  const week = Math.max(1, Math.min(4, state.week || 1));
  const completedKeys = new Set((state.milestones || []).map((m) => m.key));
  const weekKeys = WEEK_MILESTONES[week] || [];
  const startedAt = state.started_at;
  const dayNumber = startedAt
    ? Math.min(28, Math.max(1, 28 - (state.days_remaining ?? 28) + 1))
    : 1;
  const features = (state.unlocked_features || []);
  const completedTotal = state.milestones ? state.milestones.length : 0;
  const milestonesTotal = Object.values(WEEK_MILESTONES).flat().length;
  const progressPct = milestonesTotal > 0 ? Math.round((completedTotal / milestonesTotal) * 100) : 0;
  const startedAtStr = startedAt
    ? \`Started \${new Date(startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\`
    : 'Started recently';
  const allUnlocked = features.length >= Object.keys(FEATURE_EXPLAINERS).length;
  const progressRingText = allUnlocked ? 'All weeks unlocked' : \`\${progressPct}% milestones completed\`;

  const timelineWeeks = [
    { num: 1, name: 'Idea & Customer', summary: 'Define the problem, ICP, market sizing seed, talk to ≥5 customers, log every interview.' },
    { num: 2, name: 'Solution & Roadmap', summary: 'Scope the MVP, set 90-day OKRs, draft brand v1, draft pitch deck v1.' },
    { num: 3, name: 'Validate & Team', summary: 'Score venture readiness, match with advisors, decide the co-founder track.' },
    { num: 4, name: 'Incorporate & Capital', summary: 'Incorporate, vest, file 83(b), sign agreements, lock the ask.' }
  ].map(w => {
    const isDone = w.num < week;
    const isCurrent = w.num === week;
    const isLocked = w.num > week;
    return {
      ...w,
      isDone, isCurrent, isLocked,
      badgeStyle: isDone ? { color: '#15803d', background: '#dcfce7' } : (isCurrent ? { color: '#6d28d9', background: '#f5f3ff' } : { color: '#a1a1aa', background: '#f4f4f5' }),
      badgeText: isDone ? 'Completed' : (isCurrent ? \`Active · D\${dayNumber}\` : 'Locked'),
      badgeIcon: isDone ? <Check size={12} strokeWidth={3}/> : (isCurrent ? <Circle size={12} fill="currentColor" stroke="none" style={{ animation: 'wsPulse 2s infinite' }} /> : <Lock size={12} strokeWidth={2.5} />),
      borderColor: isCurrent ? '#c4b5fd' : '#ececf1',
      cardExtra: isCurrent ? { animation: 'wsGlow 3s infinite' } : (isDone ? { background: '#fafafa' } : { opacity: 0.6 }),
      accent: isCurrent ? '#7c3aed' : '#71717a',
      features: (HUB_WEEKS.find(hw => hw.week === w.num)?.tools || []).map(t => ({ label: t.label, locked: isLocked })),
      deliverables: (WEEK_MILESTONES[w.num] || []).map(m => {
        const dDone = completedKeys.has(m);
        return {
          label: MILESTONE_LABELS[m] || m,
          style: dDone ? { background: '#dcfce7', color: '#15803d' } : { background: '#f4f4f5', color: '#71717a' },
          icon: dDone ? <Check size={10} strokeWidth={3}/> : <Circle size={10} strokeWidth={2.5}/>
        };
      })
    };
  });

  const activeWeek = timelineWeeks.find(w => w.num === week);

  const progressSegments = [1, 2, 3, 4].map(w => {
    const isDone = w < week;
    const isCurrent = w === week;
    return {
      label: \`Week \${w}\`,
      track: isDone ? '#dcfce7' : (isCurrent ? '#ede9fe' : '#e5e7eb'),
      fill: isDone ? '#22c55e' : (isCurrent ? '#8b5cf6' : 'transparent'),
      fillW: isDone ? '100%' : (isCurrent ? '50%' : '0%'),
      pulse: isCurrent ? { animation: 'wsPulse 2s infinite' } : {},
      showDot: isCurrent,
      labelColor: isDone ? '#15803d' : (isCurrent ? '#6d28d9' : '#a1a1aa')
    };
  });

  const deliverableRows = weekKeys.map(k => {
    const done = completedKeys.has(k);
    return {
      key: k,
      name: MILESTONE_LABELS[k] || k,
      tag: done ? 'Completed' : 'Required',
      tagStyle: done ? { background: '#dcfce7', color: '#15803d' } : { background: '#fef3c7', color: '#b45309' },
      boxStyle: done ? { background: '#22c55e', color: '#fff' } : { border: '1px solid #d4d4d8', background: '#fafafa', color: 'transparent' },
      boxIcon: done ? <Check size={14} strokeWidth={3} /> : null,
      action: done ? 'Review' : 'Complete',
      isCompleting: completing === k
    };
  });

  const activeWeekTools = HUB_WEEKS.filter(hw => hw.week <= week).map(hw => {
    return {
      heading: hw.week === week ? 'Unlocked this week' : \`Unlocked in Week \${hw.week}\`,
      tools: hw.tools.map(t => {
        return {
          ...t,
          badge: hw.week === week ? \`Active · Cohort 3\` : \`Unlocked · Wk \${hw.week}\`,
          badgeStyle: hw.week === week ? { background: '#f3effe', color: '#7c3aed' } : { background: '#f4f4f5', color: '#71717a' },
          bg: '#fff',
          border: '#ececf1',
          titleColor: '#27272a',
          active: true,
          locked: false
        };
      })
    };
  });

  const [week1Open, setWeek1Open] = useState(false);

  const deckMilestoneDone = completedKeys.has('pitch_deck_v1');
  const showDemoDayCta = week === 4 || !deckMilestoneDone;

  return (
    <div className="min-h-screen bg-[#F8F8FA] dark:bg-gray-950 font-sans text-[#18181b] dark:text-gray-200">
      {/* PAGE HEADER (sticky) */}
      <div className="sticky top-0 z-20 bg-[#F8F8FA]/92 dark:bg-gray-950/92 backdrop-blur-md border-b border-[#ececf1] dark:border-gray-800">
        <div className="max-w-[1080px] mx-auto px-6 pt-[18px]">
          <div className="flex flex-wrap gap-[18px] items-center justify-between">
            <div className="flex items-center gap-[14px] flex-wrap">
              <div className="flex items-center gap-[10px]">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-[#ede9fe] dark:bg-violet-900/40 flex items-center justify-center text-[#7c3aed] dark:text-violet-400">
                  <FlaskConical size={18} strokeWidth={2.5}/>
                </div>
                <h1 className="m-0 text-[20px] font-extrabold tracking-[-.02em] dark:text-white">Spin-Out Lab</h1>
              </div>
              <span className="tabular-nums text-[12px] font-semibold text-[#52525b] dark:text-gray-400 bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[8px] px-[10px] py-[5px]">
                Cohort 3 · {startedAtStr}
              </span>
              <span className="tabular-nums inline-flex items-center gap-[7px] text-[12px] font-bold text-[#6d28d9] dark:text-violet-300 bg-[#f5f3ff] dark:bg-violet-950/50 border border-[#ede9fe] dark:border-violet-900/50 rounded-[8px] px-[10px] py-[5px]">
                <span className="w-[6px] h-[6px] rounded-full bg-[#7c3aed] dark:bg-violet-400" style={{ animation: 'wsPulse 2s infinite' }}></span>
                Week {week} of 4 · Day {dayNumber}
              </span>
            </div>
            <div className="flex items-center gap-[18px]">
              <div className="flex items-center gap-[11px]">
                <div className="w-[46px] h-[46px] rounded-full flex items-center justify-center flex-none" style={{ background: \`conic-gradient(#7c3aed 0% \${progressPct}%, #e5e7eb \${progressPct}% 100%)\` }}>
                  <div className="tabular-nums w-[38px] h-[38px] rounded-full bg-[#F8F8FA] dark:bg-gray-950 flex items-center justify-center text-[10.5px] font-extrabold text-[#6d28d9] dark:text-violet-400 tracking-[-.02em]">
                    {progressPct}%
                  </div>
                </div>
                <div className="leading-[1.15]">
                  <div className="text-[13px] font-bold text-[#27272a] dark:text-gray-200">{progressRingText}</div>
                  <div className="tabular-nums text-[12px] text-[#71717a] dark:text-gray-500">{state.days_remaining} days remaining</div>
                </div>
              </div>
            </div>
          </div>
          {/* Segmented progress bar */}
          <div className="flex gap-[6px] py-[16px] pb-[14px]">
            {progressSegments.map((seg, i) => (
              <div key={i} className="flex-1 flex flex-col gap-[5px]">
                <div className="h-[7px] rounded-full relative overflow-hidden" style={{ background: seg.track }}>
                  <div className="absolute inset-0" style={{ width: seg.fillW, background: seg.fill, ...seg.pulse }}></div>
                </div>
                <div className="flex items-center gap-[5px] text-[11px] font-semibold" style={{ color: seg.labelColor }}>
                  {seg.showDot && <span className="w-[5px] h-[5px] rounded-full bg-[#7c3aed]" style={{ animation: 'wsPulse 2s infinite' }}></span>}
                  {seg.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-[1080px] mx-auto px-6 pt-[28px] pb-[120px]">
        {/* SECTION 1 — WEEK TIMELINE */}
        <section className="mb-[36px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">Program timeline</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[14px]">
            {timelineWeeks.map((w, i) => (
              <div key={i} className="rounded-[16px] bg-white dark:bg-gray-900 border p-[16px] flex flex-col transition-shadow duration-150" style={{ borderColor: w.borderColor, ...w.cardExtra }}>
                <div className="flex items-start justify-between gap-[8px] flex-wrap mb-[10px]">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: w.accent }}>Week {w.num}</div>
                    <div className="text-[15px] font-bold text-[#27272a] dark:text-gray-100 tracking-[-.01em]">{w.name}</div>
                  </div>
                  <span className="inline-flex items-center gap-[5px] flex-none text-[10.5px] font-bold rounded-full px-[9px] py-[3px] dark:bg-opacity-20" style={w.badgeStyle}>
                    <span className="w-[12px] h-[12px] flex items-center justify-center">{w.badgeIcon}</span>{w.badgeText}
                  </span>
                </div>
                <p className="m-0 mb-[12px] text-[12.5px] leading-[1.4] text-[#71717a] dark:text-gray-400 line-clamp-2 overflow-hidden">{w.summary}</p>
                <div className="flex flex-wrap gap-[5px] mb-[11px]">
                  {w.deliverables.map((d, di) => (
                    <span key={di} className="inline-flex items-center gap-[4px] text-[10.5px] font-semibold rounded-[6px] px-[7px] py-[3px] dark:bg-opacity-20" style={d.style}>
                      <span className="w-[10px] h-[10px] flex items-center justify-center">{d.icon}</span>{d.label}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap gap-[5px] pt-[11px] border-t border-[#f4f4f5] dark:border-gray-800">
                  {w.features.map((f, fi) => (
                    <span key={fi} className="inline-flex items-center gap-[4px] text-[10px] font-semibold rounded-[6px] px-[7px] py-[3px] bg-[#f4f4f5] text-[#52525b] dark:bg-gray-800 dark:text-gray-400">
                      {f.locked && <Lock size={9} strokeWidth={2.5}/>}{f.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 2A — SELECTED WEEK HEADER */}
        <section className="mb-[20px]">
          <div className="rounded-[16px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 p-[24px] relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-[4px]" style={{ background: activeWeek.accent }}></div>
            <div className="flex flex-wrap gap-[18px] justify-between items-start">
              <div className="min-w-[280px]">
                <div className="flex items-center gap-[9px] mb-[6px]">
                  <span className="text-[10.5px] font-bold rounded-full px-[9px] py-[3px] inline-flex items-center gap-[5px]" style={{ background: '#f5f3ff', color: '#6d28d9' }}>
                    <span className="w-[5px] h-[5px] rounded-full bg-[#7c3aed]" style={{ animation: 'wsPulse 2s infinite' }}></span>
                    Active · Day {dayNumber}
                  </span>
                </div>
                <h2 className="m-0 text-[22px] font-extrabold tracking-[-.02em] dark:text-white">{activeWeek.name}</h2>
                <p className="my-[7px] mb-[16px] text-[14px] text-[#71717a] dark:text-gray-400 max-w-[520px]">{activeWeek.summary}</p>
                <div className="flex flex-wrap gap-[8px]">
                  <span className="tabular-nums inline-flex items-center gap-[6px] text-[12px] font-semibold text-[#3f3f46] dark:text-gray-300 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[8px] px-[11px] py-[6px]">
                    <span className="w-[14px] h-[14px] text-[#7c3aed] flex"><BookOpen size={14} /></span>
                    {deliverableRows.filter(r => r.tag === 'Completed').length} of {deliverableRows.length} deliverables
                  </span>
                </div>
              </div>
              <div className="flex gap-[10px] flex-wrap">
                <Link to={activeWeek.features[0] ? HUB_WEEKS[week-1].tools[0].to : '#'} className="h-[40px] px-[18px] rounded-[10px] border-none bg-[#7c3aed] text-white font-inherit text-[13.5px] font-semibold cursor-pointer inline-flex items-center gap-[7px] shadow-sm hover:bg-[#6d28d9]">
                  Open workspace <span className="text-[15px]">→</span>
                </Link>
                {showDemoDayCta && (
                  <Link to="/build/deck?method_id=axal_spinout_demoday" className="h-[40px] px-[16px] rounded-[10px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#3f3f46] dark:text-gray-200 font-inherit text-[13.5px] font-semibold cursor-pointer inline-flex items-center gap-[7px] hover:bg-gray-50 dark:hover:bg-gray-700">
                    {deckMilestoneDone ? 'Refresh Demo Day deck' : 'Draft Demo Day deck'} <span className="text-[15px]">→</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2 — TWO COLUMN */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-[20px] mb-[36px] items-start">
          {/* 2B DELIVERABLES */}
          <div className="md:col-span-1">
            <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">Week {week} Deliverables</div>
            <div className="flex flex-col gap-[10px]">
              {deliverableRows.map((d, i) => (
                <div key={i} className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[14px] p-[15px] px-[16px] shadow-sm flex gap-[13px] items-start">
                  <span className="w-[20px] h-[20px] flex-none mt-[1px] rounded-[6px] flex items-center justify-center dark:bg-opacity-20" style={d.boxStyle}>
                    {d.boxIcon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[9px] flex-wrap">
                      <span className="text-[14.5px] font-semibold text-[#27272a] dark:text-gray-200">{d.name}</span>
                      <span className="text-[10.5px] font-semibold rounded-full px-[8px] py-[2px] dark:bg-opacity-20" style={d.tagStyle}>{d.tag}</span>
                    </div>
                  </div>
                  {d.tag !== 'Completed' && (
                    <button
                      onClick={() => onComplete(d.key)}
                      disabled={d.isCompleting}
                      className="flex-none h-[32px] px-[12px] rounded-[9px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#6d28d9] dark:text-violet-400 font-inherit text-[12px] font-semibold cursor-pointer inline-flex items-center gap-[5px] disabled:opacity-60 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      {d.isCompleting ? <Loader2 size={12} className="animate-spin" /> : null}
                      {d.action} <span className="text-[13px]">→</span>
                    </button>
                  )}
                </div>
              ))}
              {completeError && (
                <div className="mt-2 text-[12px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-[14px] p-[12px]">
                  {completeError}
                </div>
              )}
            </div>
          </div>

          {/* 2C TOOLS */}
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">Your unlocked tools</div>
            {activeWeekTools.map((g, gi) => (
              <div key={gi} className="mb-[16px]">
                {g.heading && <div className="text-[11px] font-semibold text-[#a1a1aa] dark:text-gray-500 mb-[8px]">{g.heading}</div>}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-[10px]">
                  {g.tools.map((t, ti) => (
                    <Link key={ti} to={t.to} className="rounded-[13px] p-[13px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 flex flex-col hover:border-[#c4b5fd] dark:hover:border-violet-800 transition-colors">
                      <div className="flex items-center justify-between mb-[9px]">
                        <div className="w-[32px] h-[32px] rounded-[9px] flex items-center justify-center p-[6px] bg-[#f5f3ff] dark:bg-violet-900/40 text-[#7c3aed] dark:text-violet-400">
                           {/* fallback icon */}
                           <BookOpen size={16} strokeWidth={2.5}/>
                        </div>
                      </div>
                      <div className="text-[12.5px] font-bold text-[#27272a] dark:text-gray-200 mb-[2px]">{t.label}</div>
                      <div className="text-[11px] leading-[1.35] text-[#a1a1aa] dark:text-gray-400 mb-[10px] flex-1">{t.blurb}</div>
                      <div className="flex items-center justify-between gap-[6px]">
                        <span className="text-[9.5px] font-bold rounded-[6px] px-[6px] py-[2px] dark:bg-opacity-20" style={t.badgeStyle}>{t.badge}</span>
                        <div className="h-[26px] px-[10px] rounded-[7px] border border-[#e4e4e7] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#6d28d9] dark:text-violet-400 font-inherit text-[11px] font-semibold flex items-center">Open →</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            
            <div className="mt-8">
              <DeckReadinessCard />
            </div>
          </div>
        </section>

        {/* SECTION 3 — SCORECARD (Mocked per prototype) */}
        <section className="mb-[36px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[12px]">30-day scorecard</div>
          <div className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[16px] overflow-hidden shadow-sm">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse min-w-[720px]">
                <thead>
                  <tr className="bg-[#fafafa] dark:bg-gray-800/50">
                    <th className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-[#a1a1aa] dark:text-gray-500 p-[12px] px-[16px] border-b border-[#ececf1] dark:border-gray-700"></th>
                    {[1, 2, 3, 4].map(n => (
                      <th key={n} className="text-left text-[12px] font-bold text-[#27272a] dark:text-gray-300 p-[12px] px-[16px] border-b border-[#ececf1] dark:border-gray-700 border-l border-[#f4f4f5] dark:border-gray-800">Week {n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Status', cells: [{ badge: true, text: 'Completed', color: '#15803d', bg: '#dcfce7', Icon: Check }, { badge: true, text: 'Active', color: '#6d28d9', bg: '#f5f3ff', Icon: Circle }, { badge: true, text: 'Unlocked', color: '#15803d', bg: '#dcfce7', Icon: Check }, { badge: true, text: 'Unlocked', color: '#15803d', bg: '#dcfce7', Icon: Check }] },
                    { label: 'Deliverables', cells: [{ bar: true, text: '3 of 3', w: '100%', color: '#22c55e' }, { bar: true, text: '1 of 5', w: '20%', color: '#7c3aed' }, { text: '—', plain: true }, { text: '—', plain: true }] },
                    { label: 'Tools unlocked', cells: [{ plain: true, text: '4 of 4' }, { plain: true, text: '4 of 4' }, { plain: true, text: '5 of 5' }, { plain: true, text: '7 of 7' }] },
                    { label: 'Key output', cells: [{ plain: true, text: '1 startup · 5 interviews · TAM sized', weight: 'normal' }, { plain: true, text: 'OKRs set', weight: 'normal' }, { text: '—', plain: true }, { text: '—', plain: true }] },
                  ].map((r, ri) => (
                    <tr key={ri}>
                      <td className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 p-[13px] px-[16px] border-b border-[#f4f4f5] dark:border-gray-800 whitespace-nowrap">{r.label}</td>
                      {r.cells.map((cell, ci) => (
                        <td key={ci} className="p-[13px] px-[16px] border-b border-[#f4f4f5] dark:border-gray-800 border-l border-[#f4f4f5] dark:border-gray-800 align-top">
                          {cell.badge && (
                            <span className="inline-flex items-center gap-[5px] text-[11px] font-bold rounded-full px-[9px] py-[3px] dark:bg-opacity-20" style={{ background: cell.bg, color: cell.color }}>
                              <span className="w-[11px] h-[11px] flex items-center justify-center"><cell.Icon size={11} strokeWidth={cell.Icon === Circle ? 0 : 3} fill={cell.Icon === Circle ? 'currentColor' : 'none'}/></span>{cell.text}
                            </span>
                          )}
                          {cell.bar && (
                            <>
                              <div className="tabular-nums text-[12.5px] font-semibold text-[#3f3f46] dark:text-gray-300 mb-[5px]">{cell.text}</div>
                              <div className="h-[6px] rounded-full bg-[#f1f1f5] dark:bg-gray-800 overflow-hidden max-w-[120px]">
                                <div className="h-full rounded-full" style={{ width: cell.w, background: cell.color }}></div>
                              </div>
                            </>
                          )}
                          {cell.plain && (
                            <span className="tabular-nums text-[12.5px] text-[#52525b] dark:text-gray-400" style={{ fontWeight: cell.weight || 600 }}>{cell.text}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] mt-[14px]">
            {[
              { label: 'Total tools unlocked', value: \`\${features.length} of 20\` },
              { label: 'Deliverables completed', value: \`\${completedTotal} of 18\` },
              { label: 'Days remaining', value: state.days_remaining }
            ].map((k, ki) => (
              <div key={ki} className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[14px] p-[16px] px-[18px] shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[6px]">{k.label}</div>
                <div className="tabular-nums text-[20px] font-semibold text-[#18181b] dark:text-white tracking-[-.01em]">{k.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4 — WEEK 1 SUMMARY (Mocked) */}
        <section className="mb-[36px]">
          <div className="bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-800 rounded-[16px] shadow-sm overflow-hidden">
            <div onClick={() => setWeek1Open(!week1Open)} className="flex items-center justify-between gap-[12px] p-[16px] px-[20px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <div className="flex items-center gap-[11px]">
                <span className="w-[22px] h-[22px] rounded-full bg-[#dcfce7] dark:bg-green-900/30 text-[#16a34a] dark:text-green-400 flex items-center justify-center p-[4px]">
                  <Check size={14} strokeWidth={3}/>
                </span>
                <span className="text-[14.5px] font-bold text-[#27272a] dark:text-gray-200">Week 1 Summary</span>
                <span className="tabular-nums text-[12px] text-[#a1a1aa] dark:text-gray-500">Completed recently</span>
              </div>
              <span className="w-[18px] h-[18px] text-[#a1a1aa] flex transition-transform duration-200" style={{ transform: week1Open ? 'rotate(180deg)' : 'none' }}>
                <ChevronDown size={18} />
              </span>
            </div>
            {week1Open && (
              <div className="p-[4px] px-[20px] pb-[22px] border-t border-[#f4f4f5] dark:border-gray-800" style={{ animation: 'wsFade .2s ease' }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[22px] mt-[18px]">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[8px]">Startup record</div>
                    <div className="flex items-center gap-[10px] bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[12px] px-[14px]">
                      <div className="w-[34px] h-[34px] rounded-[9px] bg-[#ede9fe] dark:bg-violet-900/40 text-[#6d28d9] dark:text-violet-400 font-extrabold text-[13px] flex items-center justify-center">NC</div>
                      <div>
                        <div className="text-[13.5px] font-bold text-[#27272a] dark:text-gray-200">NovaCraft AI</div>
                        <div className="text-[11.5px] text-[#a1a1aa] dark:text-gray-500">Startup record created · Day 2</div>
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 my-[18px] mb-[8px]">TAM / SAM</div>
                    <div className="flex gap-[10px] mb-[10px]">
                      <div className="tabular-nums flex-1 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[11px] px-[14px]">
                        <div className="text-[18px] font-bold text-[#18181b] dark:text-white">$2.4B</div>
                        <div className="text-[11px] text-[#a1a1aa] dark:text-gray-500">TAM</div>
                      </div>
                      <div className="tabular-nums flex-1 bg-[#fafafa] dark:bg-gray-800 border border-[#eeeef2] dark:border-gray-700 rounded-[11px] p-[11px] px-[14px]">
                        <div className="text-[18px] font-bold text-[#18181b] dark:text-white">$340M</div>
                        <div className="text-[11px] text-[#a1a1aa] dark:text-gray-500">SAM</div>
                      </div>
                    </div>
                    <div className="text-[11.5px] text-[#71717a] dark:text-gray-400 leading-[1.5]">Sources: Gartner 2025 Workflow Automation Report · CB Insights SaaS Market Sizing Q1 2026</div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 my-[18px] mb-[8px]">Personal advisor</div>
                    <div className="flex items-start gap-[10px] bg-[#f5f3ff] dark:bg-violet-900/20 border border-[#ede9fe] dark:border-violet-900/50 rounded-[11px] p-[12px] px-[14px]">
                      <span className="w-[16px] h-[16px] flex-none text-[#7c3aed] mt-[1px] flex"><Sparkles size={16}/></span>
                      <div className="text-[12px] text-[#52525b] dark:text-gray-300 leading-[1.45]"><strong className="text-[#27272a] dark:text-white font-semibold">Active</strong> — Week 1 question bank complete. Now operating in Week 2 mode.</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#a1a1aa] dark:text-gray-500 mb-[8px]">Interviews logged · 5</div>
                    <div className="border border-[#eeeef2] dark:border-gray-700 rounded-[11px] overflow-hidden">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-[#fafafa] dark:bg-gray-800/50">
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">Name</th>
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">Date</th>
                            <th className="text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#a1a1aa] dark:text-gray-500 p-[8px] px-[12px]">Key insight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { name: 'Sarah T.', date: 'Jul 2', insight: 'Current tools don\u2019t handle async workflows' },
                            { name: 'Marcus R.', date: 'Jul 3', insight: 'Price sensitivity at $200/mo threshold' },
                            { name: 'Diana K.', date: 'Jul 4', insight: 'Integration with Slack is non-negotiable' },
                            { name: 'James W.', date: 'Jul 5', insight: 'Discovery takes 3x longer than expected' },
                            { name: 'Priya M.', date: 'Jul 6', insight: 'No single source of truth for customer data' },
                          ].map((iv, ivi) => (
                            <tr key={ivi} className="border-t border-[#f4f4f5] dark:border-gray-800">
                              <td className="text-[12px] font-semibold text-[#27272a] dark:text-gray-200 p-[9px] px-[12px] whitespace-nowrap">{iv.name}</td>
                              <td className="tabular-nums text-[12px] text-[#71717a] dark:text-gray-400 p-[9px] px-[12px] whitespace-nowrap">{iv.date}</td>
                              <td className="text-[12px] text-[#52525b] dark:text-gray-400 p-[9px] px-[12px] leading-[1.35]">{iv.insight}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <ExplainerCards />
      </main>
    </div>
  );
}

export default function SpinoutLabPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);
  const [completeError, setCompleteError] = useState('');
  const [exiting, setExiting] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await spinoutLab.state();
      setState(next);
    } catch (e) {
      reportError('spinout-lab:state', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  useEffect(() => {
    const onAdvanced = () => { load(); };
    window.addEventListener('spinout-lab:advanced', onAdvanced);
    return () => window.removeEventListener('spinout-lab:advanced', onAdvanced);
  }, [load]);

  if (!user) return <SpinoutLabMarketingPage />;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your sprint…
      </div>
    );
  }

  if (!state) {
    return <LabHub />;
  }

  if (!state.active) {
    const wasActive =
      user?.spinout_lab_active === 1 ||
      (state.is_incorporated && (state.milestones || []).some((m) => m.key === 'incorporation_completed'));
    if (!wasActive) return <LabHub />;

    const onContinue = async () => {
      setExiting(true);
      try {
        await spinoutLab.exit();
      } catch (e) {
        reportError('spinout-lab:exit', e);
      }
      try {
        await refresh({ force: true });
      } catch { /* no-op */ }
      navigate('/');
    };
    return (
      <div className="min-h-[60vh] flex items-center px-4 py-10">
        <ExitSuccess onContinue={onContinue} busy={exiting} />
      </div>
    );
  }

  const onComplete = async (key) => {
    setCompleting(key);
    setCompleteError('');
    try {
      const next = await spinoutLab.complete(key);
      setState(next);
      try {
        window.dispatchEvent(
          new CustomEvent('spinout-lab:advanced', {
            detail: { state: next, milestoneKey: key },
          }),
        );
      } catch { /* no-op */ }
      if (!next.active) {
        try { await refresh({ force: true }); } catch { /* no-op */ }
      }
    } catch (e) {
      setCompleteError(e?.message || 'Could not mark milestone complete');
      reportError('spinout-lab:complete', e);
    } finally {
      setCompleting(null);
    }
  };

  return <Dashboard state={state} onComplete={onComplete} completing={completing} completeError={completeError} />;
}
`;
fs.writeFileSync('rewrite-part2.js', code);
