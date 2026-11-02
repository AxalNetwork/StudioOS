import React from 'react';
import { CONFIDENTIAL } from './complianceModel';

/**
 * D1546 (#3790): a card's compliance chrome on the reader pages — its
 * footnotes (a projection's forward-looking line, proposed round terms) at
 * the foot, and "Confidential" in the corner. Drawn over the card, never in
 * its grid, so it moves no block.
 */
export default function CardCompliance({ chrome, size = 'screen', testId = 'card-compliance' }) {
  if (!chrome || (!chrome.confidential && !chrome.lines?.length)) return null;
  const print = size === 'print';
  return (
    <div aria-label="Compliance" data-testid={testId}
      style={{ position: 'absolute', left: print ? 96 : '4%', right: print ? 96 : '4%', bottom: print ? 20 : '2%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, pointerEvents: 'none', color: '#64748b' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(chrome.lines || []).map((l) => <span key={l} style={{ fontSize: print ? 18 : 'clamp(9px,0.9vw,12px)', fontStyle: 'italic' }} data-testid={`${testId}-line`}>{l}</span>)}
      </div>
      {chrome.confidential ? <span style={{ fontSize: print ? 18 : 'clamp(9px,0.9vw,11px)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }} data-testid={`${testId}-confidential`}>{CONFIDENTIAL}</span> : null}
    </div>
  );
}
