### Distribution Newsletter (D4495, #4495; part of #3722)

`/grow/distribution/newsletter` uses #4484's Distribution shell; `CycleRoute`
renders `NewsletterTab` for `tab="newsletter"`. It draws only the
not-connected state: Connect Beehiiv disabled with "Not offered yet", and
Opens, Clicks and Unsubscribes each "Not recorded". The tab makes no request,
so it has no Worker route; a founder's newsletter never reads or writes
`/api/newsletter` (D810, Axal's own newsletter). Lists, the editor, sends and
Beehiiv-reported results each get a mounted Worker route once the Beehiiv
connector (#2407) exists.
