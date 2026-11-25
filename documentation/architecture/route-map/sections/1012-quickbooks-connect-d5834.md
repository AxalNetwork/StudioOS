### QuickBooks Online connect and sync (#5834, D5834 part 2)

No page or canvas is implemented here. Signing in, reconnecting and
disconnecting go through `/api/integrations` with provider `quickbooks`
(`integrations/providers/quickbooks.ts`). The founder's two routes are mounted
under `/api/quickbooks` by `routes/quickbooks.ts`; both require sign-in and
read only the caller's own connection. The client module is
`frontend/src/lib/api/quickbooks.js`.

| Route | Purpose |
| --- | --- |
| `GET /connection` | The caller's QuickBooks connection: status, whether a realm is bound (not its id), the venture, the environment, the last complete sync and the last error code |
| `POST /connection/:id/sync` | Sync the P&L and balance sheets for `{ project_id, statements, basis }` into the D5833 store; a token failure keeps its own code |
