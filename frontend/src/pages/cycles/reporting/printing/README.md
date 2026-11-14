# Sent-report printing (#6094)

The native print/PDF copy of the admitted frozen report. It reads no API and
carries no shell or recipient-list content.

| File | Purpose |
| --- | --- |
| `ReportPrintButton.jsx` | Sent-report native Print or save as PDF control and recoverable failure. |
| `reportPrint.js` | Audience-scoped frozen projection and isolated text-only browser document. |
| `reportPrint.css` | Light A4 paper, wrapping and print page-break rules. |
