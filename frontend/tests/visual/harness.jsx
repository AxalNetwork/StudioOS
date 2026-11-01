// D1511 (#3762, deck v2 A18) — the integrated Pitch deck editor at HEAD,
// mounted for the visual-regression and axe suites (`deck_editor.visual.spec.js`).
//
// It is the real `PitchEditor` (GridStage, CardsStrip, AreaLightbox,
// InstructionBox, DeckToolbar, DeckMoreMenu, DeckAsk), not a canvas built for
// the test. Only its reads are stubbed, from `window.__DECK_HARNESS__`, which
// the spec builds from the Worker's own catalogue and themes. Fonts are the
// pinned @fontsource files, never a font host, so a screenshot depends on the
// container alone. Nothing here is served by the app: it runs on the Vite dev
// server the visual config starts. Every venture and figure is synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '../../src/index.css';
import { api } from '../../src/lib/api.js';
import { deckEditorApi } from '../../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../../src/lib/api/deckSources.js';
import { deckImagesApi } from '../../src/lib/api/deckImages.js';
import { deckCheckApi } from '../../src/lib/api/deckCheck.js';
import { deckGridApi } from '../../src/lib/api/deckGrid.js';
import { railProposalsApi } from '../../src/lib/api/railProposals.js';
import { cyclesApi } from '../../src/lib/api/cycles.js';
import { AuthProvider } from '../../src/hooks/useAuthSync.jsx';
import PitchEditor from '../../src/pages/raise/pitch/PitchEditor.jsx';
import PitchStudio from '../../src/pages/raise/pitch/PitchStudio.jsx';

const h = window.__DECK_HARNESS__;
if (!h) throw new Error('window.__DECK_HARNESS__ is not set');
const ok = (v) => async () => structuredClone(v);

Object.assign(api, {
  getMe: ok(h.user), listProjects: ok([{ id: h.deck.project_id, name: 'Synthetic Labs' }]),
  deckListVersions: ok({ versions: [{ id: h.deck.id, version: h.deck.version, is_current: true, title: h.deck.title, created_at: h.deck.created_at }] }),
  deckGet: ok(h.deck), deckExportList: ok({ exports: [] }),
  deckEngagement: ok({ views: [], analytics: { available: false, reason: 'No views yet.' } }),
});
Object.assign(deckEditorApi, { model: ok(h.model), brandKit: ok({ kit: null }), chartSeries: ok({ series: [], types: [] }) });
Object.assign(deckSourcesApi, { refresh: ok({ rows: [] }), list: ok({ project_id: h.deck.project_id, items: [], coverage: { slots: 0, filled: 0, by_grade: {}, not_recorded: 0, unreadable: 0 } }) });
Object.assign(deckImagesApi, { list: ok({ images: [] }) });
Object.assign(deckCheckApi, { read: ok({ checked: false, claims: [], can_check: false }), versions: ok({ versions: [] }) });
Object.assign(deckGridApi, { grid: ok(h.grid) });
Object.assign(railProposalsApi, { list: ok({ proposals: [] }) });
Object.assign(cyclesApi, { module: ok({ card: null, records: [] }) });

localStorage.setItem('user', JSON.stringify(h.user));
if (h.dark) document.documentElement.classList.add('dark');

// `studio` mounts the studio home (StudioHome inside PitchStudio); otherwise the editor.
const studio = h.page === 'studio';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[studio ? `/raise/pitch?project_id=${h.deck.project_id}` : `/raise/pitch/edit?project_id=${h.deck.project_id}`]}>
    <AuthProvider>{studio ? <PitchStudio /> : <PitchEditor />}</AuthProvider>
  </MemoryRouter>,
);
