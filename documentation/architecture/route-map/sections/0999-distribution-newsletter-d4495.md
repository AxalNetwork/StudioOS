### Distribution Newsletter (D4495, #4495; part of #3722)

`/grow/distribution/newsletter` uses #4484's Distribution shell; `CycleRoute`
renders `NewsletterTab.jsx` for `tab="newsletter"`. It is the not-connected
state, the only one until the Beehiiv connector (#2407) exists: Connect
Beehiiv is disabled with "Not offered yet", and Opens, Clicks and Unsubscribes
each read "Not recorded". The tab makes no request, so it has no Worker route
and draws no list, editor, send or subscriber. A founder's newsletter never
reads or writes `/api/newsletter` (D810, Axal's own newsletter). Lists, the
editor, sends and Beehiiv-reported results each get a mounted Worker route
once that connector exists.
