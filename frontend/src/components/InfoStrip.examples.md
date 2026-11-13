# InfoStrip — usage cheatsheet

Compact, accessible, inline informational help strip used by every page that
needs a brief contextual tip directly under its `<h1>`.

## When to use
- Page-level help placed directly below a `<h1>` or section heading.
- Tips, process reminders, or contextual notices.
- System notices (e.g. "signed in with Google") — use `inline={false}`.

## When NOT to use
- Errors, validation feedback, toasts, or action alerts → use the existing
  rose/amber `AlertCircle` blocks, `ErrorState`, or Toast patterns instead.
- Interactive `bg-violet-*` elements (chips, tabs, selection states) — those
  are not info banners.

## Basic usage (page help via PageExplainer)

All pages registered in `lib/explainers.js` get their strip automatically:

```jsx
<h1>Metrics</h1>
<PageExplainer pageKey="metrics" />
```

## InfoStrip directly

```jsx
import InfoStrip from '../components/InfoStrip';

{/* Default: info variant, dismissible, inline */}
<InfoStrip
  title="Clean Room Architecture"
  body="Private data stays in the database. Your Jekyll site fetches only what the user's JWT permits."
  dismissible={false}
/>

{/* Tip variant */}
<InfoStrip
  variant="tip"
  body="Tip: connect Google Calendar once to surface all Axal VC commitments automatically."
  storageKey="calendar-tip-v1"
/>

{/* Warning — non-inline banner with rich content */}
<InfoStrip variant="warning" inline={false} onDismiss={() => setNotice(false)}>
  <strong>You're signed in with Google.</strong> If you're on a shared device,
  also sign out of Google in this browser.
</InfoStrip>
```

## Props reference

| Prop          | Type                            | Default   | Notes                                              |
|---------------|---------------------------------|-----------|----------------------------------------------------|
| `title`       | `string?`                       | —         | Bold prefix; optional                              |
| `body`        | `string?`                       | —         | Required unless `children` provided                |
| `variant`     | `'info'\|'tip'\|'warning'`      | `'info'`  |                                                    |
| `icon`        | `LucideIcon?`                   | variant   | Override default icon                              |
| `dismissible` | `boolean`                       | `true`    | Show × button                                      |
| `storageKey`  | `string?`                       | —         | Persist dismissal to localStorage                  |
| `onDismiss`   | `() => void`                    | —         | Called on dismiss (use for controlled visibility)  |
| `inline`      | `boolean`                       | `true`    | `false` for taller banner/notice strips            |
| `children`    | `ReactNode?`                    | —         | Replaces `body` when richer markup is needed       |
