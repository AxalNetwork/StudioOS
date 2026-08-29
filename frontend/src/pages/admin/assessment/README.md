# pages/admin/assessment — the assessment game editor

The authoring surface for the gamified assessment: chapters, items, dimensions,
archetypes and badges, with a live preview.

| File | Tab |
| --- | --- |
| `AdminAssessmentPage.jsx` | The shell and tab router. |
| `ChaptersTab.jsx` | Chapter structure. |
| `ItemsTab.jsx` | Questions and their scoring. |
| `DimensionPalette.jsx` | The dimensions items score against. |
| `ArchetypesTab.jsx` | Archetype definitions. |
| `BadgesTab.jsx` | Badge rules. |
| `AnalyticsTab.jsx` | How the live assessment is performing. |
| `PreviewTab.jsx` | The candidate's view. |
| `GameEditor.jsx` | Shared editor scaffolding. |
| `forms.jsx`, `jsonFields.js` | Field components and JSON-column editing. |

## The rule

Editing content here changes what real candidates are asked and how they are
scored. `PreviewTab` exists so a change can be seen before it is saved — an edit
that cannot be previewed is worth being suspicious of.
