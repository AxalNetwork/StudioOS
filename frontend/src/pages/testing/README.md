# frontend/src/pages/testing — product testing, the owner's side (D815)

A testing programme is owned by HQ or by a partner firm (D812). Its owner writes it, sends it for review (a partner), and picks testers from its applicants. Two pages do that, and they share everything here:

- the partner's zone, `../partner/offers/TestingZone.jsx`, at `/offers/testing`;
- HQ's console, `../admin/consoles/ProductTestingConsole.jsx`, at `/admin?tab=product-testing`.

| File | What it is |
| --- | --- |
| `programmeModel.js` | Pure rules: status labels and tones, the places line, which actions a status allows, the form's checks and its body for D812, and refusals in words. |
| `ProgrammeForm.jsx` | "New programme" and editing a draft. The caller passes `onSave` and its accent classes. |
| `ProgrammeApplicants.jsx` | One programme's applicants with their answers, Pick and Decline, the "[n] of [n] places filled" counter, and the Mail note. It shows no email address. |

**The rule for adding here:** only what both owners use. A page's own layout stays in its page. The data comes from `lib/api/productTesting.js`; add no `/api/*` method here.
