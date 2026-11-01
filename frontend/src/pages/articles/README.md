# pages/articles — writing an article (D1408, #3694)

The member's own articles, from the Article Authoring canvas
(`design/incoming/Article Authoring Page.dc.html`, boards AR1–AR6, and its
boards wrapper `Article Authoring · Boards.dc.html`). `../ArticleAuthorPage.jsx`
mounts these at `/articles/draft` (the library) and `/articles/edit/:id` (the
editor), inside the page's rail (`<Profile> · Articles`). It keeps the store,
the autosave, the submit and the D1292 publish chain.

| File | What it is |
| --- | --- |
| `articleCanvas.js` | The canvas's rules, pure: library tabs and stats, the eight writing actions and their inputs, the cost lines, placing a proposal, the format bar's Markdown edits, the image ask, the search preview. Tested by `frontend/test/article_authoring_d1408.test.mjs`. |
| `articleBlocks.js` | D1410: the divider, callout and link card as the editor's preview and the admin drawer draw them — a remark plugin for `react-markdown` that draws the same HTML as the Worker's `renderMarkdown`. `articleCanvas.js`'s `ARTICLE_BLOCKS` lists them for the Insert… menu. Tested by `frontend/test/article_render_blocks_d1410.test.mjs`. |
| `ArticleLibrary.jsx` | AR1: tabs by status, search, tag and sort, two stat cards, the table. |
| `ArticleWritingPanel.jsx` | AR3: Eadwyn's writing panel (D1409's options), beside the article until the shared Ask panel (#3706) exists. |
| `ArticleImageSheet.jsx` | AR4: "Generate an image" (D1409 part 2), for the cover or the body. |
| `ArticlePublishSheet.jsx` | AR5: Publish… — address, search title and description, the search preview, sector, tags, canonical address, Send for review. |

## Rules

- **Nothing here writes the article.** A proposal is decided through
  `railProposalsApi.decide`; the page's own save (`PUT /api/articles/:id`)
  writes what the member placed.
- **Every request has a Worker route** (`routes/articles.ts`,
  `routes/article_assist.ts`, `routes/ai_rail_proposals.ts`).
- **A canvas row with no store is not drawn** (D1408 §3 lists them); add it
  in the PR that adds its store.
