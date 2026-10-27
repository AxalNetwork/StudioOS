# Publish (D1321, #3482)

Founder publishing to an outside service, from the owner's canvases `design/incoming/Publish Sheet Page.dc.html` and `Publish · Boards.dc.html` (PUB1–PUB12, landed by D1318). Every read and write is part 1's `publishApi` (`../../../lib/api/publish.js`, D1319).

| File | What it is |
|---|---|
| `publishModel.js` | The pure rules and words: Grow's place names, providers and their tiles, destinations (nothing pre-ticked, an off place muted with its reason), the check's findings and their highlights, the counter and its text equivalent, Review and send's state, the confirm's rows and keys, the statuses, the result's line, a history row, the detail's facts and the retract note |
| `SendParts.jsx` | What the sheet and the history share: the tile, the status pill, the confirm (PUB4, PUB10B), Mark as not sent (PUB6), Retract (PUB7), and one send's actions |
| `PublishSheet.jsx` | Publish to… on D1317's `Sheet` at 560px (PUB1, PUB3, PUB10A, PUB12), its confirm, and its result (PUB5, PUB6) |
| `PublishedOutside.jsx` | "Published outside" (PUB9, PUB11): the second list on the Reporting desk's History, its filters, and a row's detail as a `Sheet` at `?sent=<uid>` |

**Adding to it:** nothing here sends on its own. A send is `publishApi.confirm`, called only from the confirm dialog the founder presses, with one key per place made when that dialog opens. An outcome that is not known is never offered Retry. A finding always blocks: there is no override. Every dialog is the page's own, never a browser pop-up, and every target is 44px on a phone.
