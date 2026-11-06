### Distribution Channels (D4486, #4486; part of #3722)

`/grow/distribution/channels` uses #4484's Distribution shell and mounts the channel reader with the existing name Ask. Overview's duplicate channel table is removed on desktop and phone. The venture
read is `GET /api/grow/channels?project=`, mounted by `grow_channels.ts`.
Add and Edit retain `POST /api/cycles/grow/channels` and
`PATCH /api/cycles/grow/channels/:uid`; channel name Ask remains #4046.
The table reads channel details, observed activity and attributed leads, with
campaign links from D4447's existing store. Connection cards read existing
private grants for their caller only and never mutate them. Confirmation
routes to `/email` or `/account/connectors` and its provider settings.
The three doors stay `/grow/launch`, `/build/brand`, `/comarketing`.
Unsupported providers show a disabled Connect control and a reason.
