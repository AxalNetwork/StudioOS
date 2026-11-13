/**
 * What Eadwyn says first, to someone who has never used it.
 *
 * A newcomer arriving from onboarding met an empty panel and a question. The
 * question is the assessment's first item, and out of context it reads as a
 * form with no explanation — so the one surface that exists to save a reader
 * from walking into every module and typing into forms opened by asking them
 * to type into one.
 *
 * IT IS THE NAME, ALWAYS. "Eadwyn", never "the chatbox" and never "the
 * chatbot". Task #120 already renamed the panel's title for the same reason and
 * `eadwyn_naming.test.mjs` holds this file to it: Eadwyn is the platform
 * assistant, and a product that calls its own assistant a chatbot has told the
 * reader it is a widget.
 *
 * WRITTEN, NOT GENERATED, and that is a cost decision as much as a copy one.
 * Every other Eadwyn turn runs the router and spends the reader's own budget
 * against their own cap. A first touch is the worst possible place to spend
 * money nobody has agreed to spend — the same reasoning `ui/eadwynConfig.js`
 * gives for keeping the rail off `OnboardingChatPage`. So this is assembled
 * from facts the page already holds: the reader's role, how far the assessment
 * has got, and whether a company is linked. No call, no tokens, no wait.
 *
 * ONCE, BY THE TRANSCRIPT RATHER THAN BY A FLAG. It renders only when the
 * conversation has no turns at all. That needs no new column, no migration and
 * no `localStorage` — which would reappear on a second device and vanish on a
 * cleared cache — and it is right by construction: a reader with history is not
 * a newcomer, and the moment they answer anything it is gone for good.
 *
 * THE ORDER IS THE USER'S, AND IT HAS A REASON BEHIND IT. The assessment comes
 * first because a profile is what makes matching possible: skills, values and
 * archetype are what another member is matched against, so every later
 * introduction is worth more once it is done. Account and company settings come
 * after, because they describe you to the platform rather than to other people.
 *
 * WHERE THE ASSESSMENT LIVES, since two plausible destinations are wrong.
 * `/skills` and `/values` are both `<Navigate to="/studio" replace />`, and the
 * gamified "Play & Discover" player was removed (`api.js` says so where its
 * methods used to be). Eadwyn's OWN profiling bank is the live one — the
 * questions `POST /api/advisor/start` already returns into this very panel — so
 * the first step is not a link at all. It is the next question, right here.
 */

/**
 * "a" or "an" for a word Eadwyn is about to use.
 *
 * RENDERING FOUND THIS, which is the only way it gets found: the sentence reads
 * "as a ${who}", and `admin` and `investor` both begin with a vowel, so two of
 * the six licences opened with "as a admin". A sentence that cannot agree with
 * its own noun tells the reader the assistant was assembled rather than written.
 */
const article = (word) => (/^[aeiou]/i.test(String(word)) ? 'an' : 'a');

/** Eadwyn's own name for each licence, in the reader's terms. */
const ROLE_WORD = {
  founder: 'founder',
  investor: 'investor',
  partner: 'service partner',
  advisor: 'advisor',
  admin: 'admin',
  exploring: 'member',
};

/**
 * The steps, in order, for one reader.
 *
 * Each is `{ key, title, body, done }`. `done` is read from the reader's own
 * state, never assumed — a step already finished is shown as finished rather
 * than hidden, so the list reads as a map of where they are rather than as a
 * shrinking pile of chores.
 */
export function orientationSteps({ role, progress, hasCompany } = {}) {
  const answered = Number(progress?.answered) || 0;
  const assessmentDone = progress?.complete === true;
  const assessmentStarted = answered > 0;
  const steps = [
    {
      key: 'assessment',
      title: assessmentDone
        ? 'Your profile is recorded'
        : assessmentStarted
          ? 'Finish your profile'
          : 'Start with your profile',
      body: assessmentDone
        ? 'Skills, values and working archetype are on file, so you can be matched against other members.'
        : 'A short set of questions about skills, values and how you work. It is first because it is what'
          + ' matching runs on — until it is answered nobody can be matched to you, and every introduction'
          + ' the platform could make has nothing to work from. Answer them here; there is no separate page for it.',
      done: assessmentDone,
    },
    {
      key: 'account',
      title: 'Then the basics',
      body: 'Your account details — name, how to reach you, how you sign in. Ask me and I will fill in what'
        + ' I can from what you have already told the platform.',
      done: false,
      route: '/settings/account',
    },
  ];
  // A company step for a reader who could have one. An investor's fund and an
  // advisor's practice are not companies in this sense, and offering the step
  // to them would be a chore they cannot complete.
  if (role === 'founder' || role === 'partner' || role === 'admin') {
    steps.push({
      key: 'company',
      title: hasCompany ? 'Your company is linked' : 'Your company, if you have one',
      body: hasCompany
        ? 'Company settings are where the details everything else reads from live — legal name, jurisdiction, team.'
        : 'If you are working on a company, linking it is what lets the rest of the product describe it: the deck,'
          + ' the cap table and the data room all read from the same record.',
      done: !!hasCompany,
      route: '/settings/company',
    });
  }
  return steps;
}

/**
 * The opening turn, as plain text.
 *
 * ONE MESSAGE, NOT A SEQUENCE. A panel that opens with four bubbles has staged
 * a performance at someone who came to get something done. The steps are a
 * short list inside one turn, and the question Eadwyn was going to ask anyway
 * follows it as the next turn — so the first thing the reader sees is why they
 * are being asked, and the second is the asking.
 *
 * WHAT IT PROMISES IS WHAT IT DOES. Two capabilities are named — filling in
 * blanks instead of walking into every form, and saying which task is urgent —
 * and nothing else. It does not offer to do things Eadwyn cannot, which is the
 * failure every `unbuilt` reason in this repo exists to refuse, arriving in
 * copy instead of in a control.
 */
export function orientationMessage({ role, progress, hasCompany, name } = {}) {
  const who = ROLE_WORD[role] || 'member';
  const first = String(name || '').trim().split(/\s+/)[0];
  const steps = orientationSteps({ role, progress, hasCompany });
  const lines = [
    `${first ? `${first}, I'm` : "I'm"} Eadwyn — the assistant for this platform, here for every part of it`
      + ` rather than one page.`,
    '',
    `Two things I am useful for. Instead of opening each module and typing into its form, tell me and I will`
      + ` fill in what I can, from what the platform already knows about you and your work. And when several`
      + ` things are outstanding I will say which one actually matters first, as ${article(who)} ${who}.`,
    '',
    'Where to start:',
  ];
  steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title}${step.done ? ' — done' : ''}. ${step.body}`);
  });
  lines.push('');
  lines.push('Anything on screen you do not recognise, ask me what it is and I will walk you through it.');
  return lines.join('\n');
}

/**
 * Should Eadwyn open with this?
 *
 * Only for a reader with NO conversation history — see the docblock above on
 * why the transcript is the signal rather than a stored flag. `ready` guards
 * the moment before `/start` has answered, when an empty array means "not
 * loaded" rather than "nothing said".
 */
export function shouldOrient({ ready, messageCount } = {}) {
  return ready === true && Number(messageCount) === 0;
}
