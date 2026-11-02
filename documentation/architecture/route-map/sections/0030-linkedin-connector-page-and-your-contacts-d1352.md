### LinkedIn connector page and Your contacts (D1352, #3567)

`/account/connectors/linkedin` claims no API: its tagline is "Sign in with
LinkedIn, then import your connections from LinkedIn's data download.", and
its tools are `read_identity` and `import_connections`. Connected, the page's
provider slot mounts `pages/account/LinkedInSection.jsx`: the granted scopes in
words, what Axal can and cannot do, LinkedIn's download link, the upload with a
preview that writes nothing (`POST /api/contacts/import/linkedin-csv?preview=1`),
Import, and the pending duplicates with Merge (only where `can_merge`), Keep
both and Dismiss. `GET /api/linkedin/status` carries `imported: { linkedin_only,
kept }`; the Disconnect dialog's "Also delete" says both counts before it is
pressed, and `POST /api/linkedin/disconnect` `{ delete_imported }` answers
`kept_imported` (null without `delete_imported`).
`GET /api/contacts/book?q=&page=` (`routes/contact_imports.ts`): the member's
own `network_connections`, 50 a page, each row with its distinct `sources`, its
note count and its open follow-ups; `q` matches name or company with `%` and
`_` literal. Network › Relationships lazy-mounts `pages/NetworkContacts.jsx`
("Your contacts": search, "From LinkedIn" / "From a spreadsheet" / "Added by
hand" chips, notes and follow-ups) under the relationship requests.

