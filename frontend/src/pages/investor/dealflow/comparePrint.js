/**
 * D6149 (#6149) — Compare's print stylesheet, so the page can be taken to a
 * partner meeting. Only the comparison prints (the shell, the controls and
 * Eadwyn's buttons do not), the venture cards keep their colours, the chart is
 * left out because the table beside it holds the same bands, and the table
 * prints whole with its venture header repeated on each page.
 */
export const COMPARE_PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden; }
  [data-compare-print], [data-compare-print] * { visibility: visible; }
  [data-compare-print] { position: absolute; left: 0; top: 0; width: 100%; color: #111 !important; background: #fff !important; }
  [data-compare-print] * { color: #111 !important; border-color: #ccc !important; box-shadow: none !important; }
  [data-compare-print] :not([data-print-swatch]) { background-color: transparent !important; }
  [data-compare-print] [data-print-swatch] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  [data-compare-print] [data-print="hide"], [data-compare-print] button { display: none !important; }
  [data-compare-print] [data-print="cards"] { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
  [data-compare-print] #compare-table { max-height: none !important; overflow: visible !important; }
  [data-compare-print] thead { position: static !important; display: table-header-group; }
  [data-compare-print] tr, [data-compare-print] li { break-inside: avoid; }
}
`;
