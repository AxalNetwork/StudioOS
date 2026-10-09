# pages/connect — connecting an outside client to StudioOS

| File | What it holds |
| --- | --- |
| `assistantConsentModel.js` | D668: the consent page's pure rules: its states, the fixed scopes, what Approve sends, the sign-in return path and the redirects it will follow |
| `ConnectAssistantPage.jsx` | D668: `/connect/assistant?request=:id`, where a founder approves an AI assistant (D665) for the companies they tick |

## Rules

- **The redirect host is always shown, larger than the client's name.** A
  client names itself; the host is where the connection goes.
- **Approve sends exactly the ticked companies** the request offered.
- **Nothing here is mounted until #1496's routes are on `main`.** Until then
  the views render from fixtures in `frontend/test/assistant_connect_d668.test.mjs`.
