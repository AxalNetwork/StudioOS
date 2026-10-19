// D773 (#2099), PR 1 — every option the advisor's boards offer that runs a
// model, for the rail (D720 §11) and for D764 PR 3 (#2089), which gives each
// option the models that fit its kind.
//
// Each entry, in the shape #2097 set for the founder:
//   page    — the board's name in the canvas (`design/incoming/airail-every-page-data/canvas.json`, profiles.Advisor);
//   key     — `<verb>:<object>`, unique per page;
//   label   — what the control says;
//   kind    — one of the canvas's fourteen task kinds;
//   handler — how the option runs: `form` (a button or a submitted field),
//             `upload`, `draft` (a band that drafts on click), `transcribe`, or `none`.
// `route` and `source` (a file and a string found in it) are this file's own:
// `rail_options_d773.test.mjs` reads them to hold the list equal to the code.
//
// An option that runs no model (a CSV export, a calendar file, a manual write)
// is not listed: the rail does not offer it.

const INTERVIEW = 'components/advisor/PersonalAdvisor.jsx';

export const ADVISOR_RAIL_OPTIONS = [
  // Home — the Eadwyn interview (`StudioInterview` → `PersonalAdvisor`).
  { page: 'Home', route: '/studio', key: 'answer:interview', label: 'Answer the interview', kind: 'chat', handler: 'form',
    source: { file: INTERVIEW, marker: 'api.advisor.toolAuto(' } },
  { page: 'Home', route: '/studio', key: 'explain:question', label: 'Explain this question', kind: 'chat', handler: 'form',
    source: { file: INTERVIEW, marker: 'onExplain={() => openTutor(' } },
  { page: 'Home', route: '/studio', key: 'transcribe:voice-answer', label: 'Record a voice answer', kind: 'speech', handler: 'transcribe',
    source: { file: INTERVIEW, marker: 'api.advisor.transcribe(' } },

  // Practice
  { page: 'Opportunities', route: '/practice/opportunities', key: 'draft:terms', label: 'Draft the terms', kind: 'write', handler: 'draft',
    source: { file: 'pages/advisor/practice/OpportunitiesZone.jsx', marker: 'surface="practice/opportunities"' } },
  { page: 'Earnings', route: '/practice/earnings', key: 'draft:period-narrative', label: 'Draft it', kind: 'numbers', handler: 'draft',
    source: { file: 'pages/advisor/practice/EarningsZone.jsx', marker: 'api.aiWorkspaceExplain(' } },

  // Research
  { page: 'Ask', route: '/research/ask', key: 'ask:library', label: 'Ask', kind: 'research', handler: 'form',
    source: { file: 'pages/research/AskZone.jsx', marker: 'api.research.ask(' } },
  { page: 'Ask', route: '/research/ask', key: 'draft:session-brief', label: 'Draft the brief', kind: 'synth', handler: 'draft',
    source: { file: 'pages/research/AskZone.jsx', marker: 'surface="research/ask"' } },
  { page: 'Client prep', route: '/research/client-prep', key: 'draft:checkpoint-brief', label: 'Draft the brief', kind: 'synth', handler: 'draft',
    source: { file: 'pages/research/ClientPrepZone.jsx', marker: 'surface="research/client-prep"' } },
  { page: 'Companies', route: '/research/companies', key: 'analyze:competitors', label: 'Analyze competitors', kind: 'research', handler: 'form',
    source: { file: 'components/CompetitorAnalysis.jsx', marker: 'api.competitors.analyze(' } },
  { page: 'Companies', route: '/research/companies', key: 'rerun:analysis', label: 'Re-run', kind: 'research', handler: 'form',
    source: { file: 'components/CompetitorAnalysis.jsx', marker: 'api.competitors.rerun(' } },
  { page: 'Companies', route: '/research/companies', key: 'refresh:sources', label: 'Refresh sources', kind: 'research', handler: 'form',
    source: { file: 'components/CompetitorAnalysis.jsx', marker: 'api.competitors.refresh(' } },
  { page: 'Library', route: '/research/library', key: 'upload:document', label: 'Add to library', kind: 'search', handler: 'upload',
    source: { file: 'pages/research/LibraryZone.jsx', marker: 'type="file"' } },
  { page: 'Library', route: '/research/library', key: 'reindex:document', label: 'Re-index', kind: 'search', handler: 'form',
    source: { file: 'pages/research/LibraryZone.jsx', marker: 'api.research.reindex(' } },
  { page: 'Library', route: '/research/library', key: 'draft:index-gaps', label: 'Draft the gaps', kind: 'synth', handler: 'draft',
    source: { file: 'pages/research/LibraryZone.jsx', marker: 'surface="research/library"' } },
];
