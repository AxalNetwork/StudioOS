### Deck card status and assignments (D1579, #3826)

`deck_card_status.ts` reads `GET /api/decks/:id/card-status?status=&assignee=`
for whoever may read the deck, with matching cards, people and the not-Done
count. It registers before `decks` through the generated route registry.
`PUT /api/decks/:id` saves status and assignee as version-document fields,
checks new assignees against the deck's people, and notifies new assignments.
Public deck reads strip these fields.

The existing Cards strip filters the cards on screen and edits status and
assignee. The home deck card shows the not-Done count. The single pre-share
confirm combines the not-Done warning with approval; the warning permits
Share, while an outstanding required approval still holds it.
