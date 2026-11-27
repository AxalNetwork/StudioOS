### Deck v2 E5: tagged PDF, PowerPoint reading order and AI marking (D1578, #3825)

- **No new route.** `POST /api/decks/:id/export` for PDF, PowerPoint, HTML and .odp, and the Google Slides export, change behind their existing routes.
- **PDF:**
  - Chrome's tagged print is finished by `finishTaggedPdf`: title, language, MarkInfo, and XMP with the PDF/UA-1 identifier and the AI marking;
  - it is then checked for PDF/UA by `checkDeckPdf`'s `ua` codes: `not_tagged`, `no_language`, `no_title`, `no_pdfua_id`, `figure_without_alt`, `ai_unmarked`.
- **PowerPoint:**
  - areas in reading order (D1574);
  - decor and filter washes marked decorative;
  - the file's title and language in `docProps/core.xml`.
- **AI marking:** every embedding export reads its images through `markedImages`, so each AI-drawn picture carries IPTC DigitalSourceType and the model id in its file. The PDF lists them in its XMP. Uploads are never marked.
