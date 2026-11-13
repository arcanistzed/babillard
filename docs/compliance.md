# Privacy and safety compliance

This is the working record behind the public policy, terms, and safety pages. It's our best reading of the rules, not legal advice, so have a lawyer review it before the store listings go live.

Daniel Thorp is the privacy officer. Requests go to privacy@babillard.app, and safety concerns to safety@babillard.app.

## What applies

| Law | Status on November 7, 2026 | Effect on Babillard |
|---|---|---|
| PIPEDA | In force | The main privacy law for this app |
| Quebec Law 25, Consumer Protection Act, Charter of the French Language | In force | Applies because the Ottawa region includes Gatineau and Quebec users can join |
| CASL | In force | Low exposure. The app sends no marketing |
| Bill C-36, Protecting Privacy and Consumer Data Act | At second reading | Would replace PIPEDA's privacy rules. Prepared for below |
| Bill C-34, Safe Social Media Act | In committee | Probably won't apply soon. Prepared for below |

Check both bills on [LEGISinfo](https://www.parl.ca/legisinfo/en/bills?parlsession=45-1) before relying on this table. They can change before they pass, and much of the detail is left to regulations.

## Bill C-36

| What it asks for | What we do | Still to do |
|---|---|---|
| Consent in plain language, with express consent as the default | A tick box at sign-up, linking to a plain-language policy | Nothing |
| A right to have personal information deleted | Delete account in the app, and by email request | Nothing |
| An explanation of automated decisions with a significant effect | Ranking is explained in the policy, and moderation decisions are made by people | Nothing unless ranking starts to have significant effects |
| A documented privacy program, scaled to the data held | This file | Review it once a year |
| A privacy impact assessment before sending data outside Canada | The transfer notes below | Redo them if a provider changes |
| Higher standards for children's data | The app is 18 and over, and closes accounts of anyone younger | Nothing |
| Data mobility | Copies by email request | Wait for the regulations that define the framework |

## Bill C-34

Regulated services are defined by a user count that regulations will set, or by designation. An adults-only app of this size is unlikely to qualify soon. Private messaging features are excluded, which covers our chats. If it does come to apply:

| What it asks for | What we do | Still to do |
|---|---|---|
| Keep people under 16 off social media, using age checks | 18 and over, by date of birth at sign-up | A self-declared date of birth wouldn't count as an age check. Add age assurance if the app becomes regulated |
| Ways to block people and flag harmful content | Both are in the app | Nothing |
| Remove child sexual abuse material and intimate images shared without consent within 24 hours, with a chance to respond and ask for reconsideration | Dedicated urgent report reasons, a 24-hour target, photo removal for moderators, and a written route to reconsideration | Nothing |
| Published user guidelines and a designated contact | The terms and the Safety page | Nothing |
| A public digital safety plan | The Safety page covers the basics | Write the full plan if the app becomes regulated |
| Label synthetic media | The app has no AI generation, and photos are profile pictures only | Nothing |
| Chatbot duties | The app has no chatbot | Nothing |

## Where data goes

| Provider | What it holds | Where | Why it's acceptable |
|---|---|---|---|
| Cloudflare | The database, encrypted messages, photos, and request logs | Global, possibly the United States | Messages are ciphertext. The rest is what the service needs, and the policy says so |
| Amazon SES | Email addresses and email text | The region set in `SES_REGION` | Needed for sign-in. Report alerts carry no names |
| Expo, Google, Apple | Push tokens, sender names, and "New message" | United States | Push text never holds the message |
| Anthropic | The text of suggested topics, and a city and province name for the moderator's scope suggestion | United States | Never messages, names, or contact details. Anthropic doesn't train on API data |

## Retention

The cron sweep in `apps/api/src/cron.ts` enforces the schedule in the policy, including the two-year limits on closed reports, moderation history, and inactive accounts. A banned person's record stays while the ban lasts.

Meetup outcome answers and takeaway lines (`meetup_outcomes`) have no separate limit. They're the data behind each topic's percentages, so the sweep leaves them alone, and they go when the person deletes their account or the inactive-account sweep removes it. Deleting a row also takes an approved takeaway off the topic page. Takeaways aren't end-to-end encrypted: a moderator approves each one before it appears publicly without a name, and the in-app form says so before anyone writes one.

## If there's a breach

1. Work out what was exposed and contain it: rotate `AUTH_SECRET` and any keys, and end sessions if needed.
2. Decide whether it creates a real risk of significant harm.
3. If it does, tell the people affected and the Privacy Commissioner of Canada as soon as possible, and the Commission d'accès à l'information for Quebec users.
4. Keep a record of every breach for two years, even a minor one.

## If a report involves a child

Ban the account, keep the evidence, and report it to Cybertip.ca, as the mandatory reporting law requires. Call police if a child is in immediate danger.

## Known gaps

- City and region names are English only, and topics people suggest appear as written.
- A lawyer hasn't reviewed the French or English text.
- The policy doesn't mention the right to complain to a privacy regulator. That was a deliberate choice, and the right exists either way. If someone complains to us, tell them about it, since PIPEDA expects that. Ask the lawyer whether the policy should say so too.
