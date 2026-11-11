### Grow campaign plans, Part A (#4447, part of #3722)

No page or canvas is implemented here; Distribution's campaign UI awaits DS1–DS11.
All routes are mounted under `/api/cycles/grow`, through the existing venture gate.

| Route | Purpose |
| --- | --- |
| `GET /campaigns?project=` | Campaign plans, segments, channels, item counts and attributed figures; venture readers |
| `POST /campaigns` | Create a draft plan; venture writers |
| `PATCH /campaigns/:uid` | Edit a plan and its status; venture writers |
| `PUT /campaigns/:uid/channels/:channelUid` | Link a venture channel and its nullable planned budget |
| `DELETE /campaigns/:uid/channels/:channelUid` | Remove the link |
| `POST /campaigns/:uid/items` | Link a venture content item or publish draft |
| `DELETE /campaigns/:uid/items/:kind/:itemUid` | Remove the item link |
| `DELETE /campaigns/:uid` | Archive a plan, preserving links |

Every write uses the existing write gate and `{ detail, field }` refusals.
A campaign sends nothing, posts nothing and moves no money. See D4447.
