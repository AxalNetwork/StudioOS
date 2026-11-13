// #3661 (D1370): the page the preflight acceptance run opens in a real browser
// (`scripts/pitch-preflight-acceptance.mjs` bundles it). It is the product's own
// code — `usePreflight`, `PreflightMeasure`, `PreflightPanel`, `FindingStrip`,
// `PreflightOverlay` and `PreflightGate` — run on the deliberately defective
// synthetic deck, so the slides are drawn at export size and measured by the
// browser's real layout, not a fake page. It reads and draws only: no fetch, no
// write. `window.__pf` exposes the result for the run to read.
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import usePreflight from '../frontend/src/pages/raise/pitch/usePreflight.js';
import { FindingStrip, PreflightGate, PreflightMeasure, PreflightPanel } from '../frontend/src/pages/raise/pitch/PreflightPanel.jsx';
import PreflightOverlay from '../frontend/src/pages/raise/pitch/PreflightOverlay.jsx';
import { gateOf, overlayOf, stepOf } from '../frontend/src/pages/raise/pitch/preflightUiModel.js';
import { DEFECTIVE } from '../frontend/test/fixtures/pitch_preflight_defective.mjs';

function App() {
  const pf = usePreflight({ deck: DEFECTIVE });
  const [finding, setFinding] = useState(null);
  const [view, setView] = useState('panel');
  useEffect(() => { pf.run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = pf.groups ? [...pf.groups.fix, ...pf.groups.look, ...pf.groups.unchecked] : [];
  const step = finding ? stepOf(rows, finding) : null;
  const row = step ? rows[step.index] : null;
  const ov = row ? overlayOf(row, { n: step.index + 1, aspect: '16:9', current: pf.current }) : null;
  const gate = useMemo(() => (pf.groups ? gateOf(pf.groups, 'export') : null), [pf.groups]);

  useEffect(() => {
    window.__pf = { done: Boolean(pf.result) && !pf.running, findings: pf.result?.findings ?? [], groups: pf.groups, failed: pf.failed, retrying: pf.retrying };
    window.__show = (id) => { setFinding(id); setView('slide'); };
    window.__view = setView;
    window.__retry = (i) => pf.retry(i);
  });

  return (
    <div style={{ padding: 16 }}>
      {view === 'slide' && row ? (
        <>
          <FindingStrip rows={rows} id={finding} onStep={(r) => setFinding(r.id)} onBack={() => setView('panel')} onClose={() => setView('panel')} />
          {ov ? <PreflightOverlay overlay={ov} card={pf.snapshot?.slides?.[ov.card]} theme={pf.snapshot?.theme} kit={null} /> : null}
        </>
      ) : null}
      {view === 'panel' ? <PreflightPanel pf={pf} version={DEFECTIVE.version} onShow={(r) => { setFinding(r.id); setView('slide'); }} onClose={() => {}} /> : null}
      {view === 'gate' && gate ? <PreflightGate gate={gate} version={DEFECTIVE.version} onShow={(r) => { setFinding(r.id); setView('slide'); }} onFix={() => setView('panel')} onAnyway={() => { window.__exported = true; }} onClose={() => setView('panel')} /> : null}
      {pf.running && pf.running.done < pf.running.total ? (
        <PreflightMeasure key={pf.running.done} card={pf.running.snapshot.slides[pf.running.done]} index={pf.running.done} theme={pf.running.snapshot.theme} kit={null} onMeasured={pf.onMeasured} />
      ) : null}
      {!pf.running && pf.retrying && pf.snapshot ? (
        <PreflightMeasure key={`retry-${pf.retrying.index}`} card={pf.snapshot.slides[pf.retrying.index]} index={pf.retrying.index} theme={pf.snapshot.theme} kit={null} onMeasured={pf.onRetried} />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
