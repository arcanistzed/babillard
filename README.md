# Babillard

A mobile app where people find each other through the ideas they want to talk about, then meet in person.

People swipe on a deck of topics: research areas, books, methods, and policy questions. When four people in one city pick the same topic, a group chat opens on its own. People who share a topic also see each other as cards, and a mutual swipe opens a one-on-one chat with a conversation starter already in it. Any chat can propose a meetup in one tap.

## How it's built

| Path | What it is |
|---|---|
| `apps/mobile` | Expo and React Native app with expo-router, Reanimated, and Gesture Handler |
| `apps/api` | Cloudflare Worker with Hono and Drizzle on D1, two Durable Objects, and R2. It sends email through Amazon SES and push through Expo |
| `packages/shared` | Matching rules, request schemas, and response types used by both |
| `apps/site` | The landing page at babillard.app. The API Worker serves its built files |

The rules that decide who sees whom and who gets grouped are plain functions in `packages/shared/src/rules`.

- **`ChatRoom`** is one Durable Object per conversation. It holds the message log and the WebSockets.
- **`Cohort`** is one Durable Object per topic and city. It forms groups one join at a time, so simultaneous swipes can't split a group.
- **A cron sweep** runs every five minutes (`apps/api/src/cron.ts`). It nudges and expires silent matches, sends meetup reminders and did-you-meet check-ins, and removes old sign-in codes, sessions, and crash reports.

## Run it locally

You need Node 24. The repo pins pnpm 11 through `packageManager`, so `corepack enable` or `npx pnpm@11.1.3` gets the right version.

```bash
pnpm install
```

Set up the API. This creates a local database and loads the topics and cities.

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

```bash
pnpm --filter @babillard/api db:migrate:local
```

```bash
pnpm --filter @babillard/api seed:local
```

```bash
pnpm --filter @babillard/api dev
```

With that running, add 30 sample people from another terminal. It prints emails you can sign in with.

```bash
pnpm --filter @babillard/api seed:dev
```

To start over, stop the server and delete `apps/api/.wrangler/state`. Deleting only the database leaves the Durable Objects behind, still holding conversations and cohorts that no longer exist.

Then run the app, either way:

- **Expo Go** is the quickest. It can't receive push notifications or open sign-in links, but the six-digit code works. Run `cd apps/mobile && npx expo start --go` with the Expo Go version for SDK 58.
- **A development build** does everything, and takes longer the first time. Run `cp apps/mobile/.env.example apps/mobile/.env`, then `pnpm --filter @babillard/mobile android`. React Native on Android needs JDK 17 or 21, so point `JAVA_HOME` at one if your default is newer. iOS needs a Mac.

The default API URL works on an Android emulator. For a physical phone, put your computer's LAN address in `apps/mobile/.env` and in `PUBLIC_ORIGIN` in `.dev.vars`. In development, the check-your-inbox screen shows the sign-in code and no email goes out.

## Share a build

Android testers don't need any of the setup above. This makes an APK and a link to share:

```bash
cd apps/mobile && npx eas-cli build --platform android --profile preview
```

EAS deletes its copy after about two weeks, so invite pages serve the APK from R2 at `/download/android`. The release script puts it there, and every released version is also kept on [GitHub Releases](https://github.com/arcanistzed/babillard/releases) (see Deploy).

### iPhone without an Apple Developer account

Expo Go runs the app on a real iPhone. Start this, then scan the QR code with the iPhone camera:

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=https://babillard.app npx expo start --go
```

The phone has to be on the same network as the computer, or add `--tunnel`. Push notifications and sign-in links don't work this way.

The iOS Simulator on a Mac needs no Apple account either:

```bash
cd apps/mobile && npx eas-cli build --platform ios --profile ios-simulator
```

TestFlight and the App Store need the Apple Developer Program.

## Test it

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm --filter @babillard/api test:e2e
```

The end-to-end suite starts two local Workers with throwaway databases. One runs in dev mode. The other has production settings, so it can check what dev mode turns off, such as sign-in rate limits and the locked admin pages. It covers sign-in, swiping, matching, age ranges, chat over WebSocket, group formation under concurrent load, meetups, the cron sweep, moderation, crash reports, and account deletion. On a slow machine, raise `--testTimeout`. GitHub Actions runs all four on every push to `main` and on pull requests.

To run the cron sweep by hand against a dev server:

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

To test timed jobs without waiting days, set `NUDGE_AFTER_MS`, `MATCH_EXPIRY_MS`, `MEETUP_REMINDER_LEAD_MS`, and `MEETUP_CHECKIN_DELAY_MS` in `.dev.vars`.

## Moderation

The `/admin` pages sit behind Cloudflare Access.

- **Overview** shows how many meetups happened and the current queues.
- **Reports** is the queue. Safety and underage reports go first, and they also email `ADMIN_EMAIL` right away. A report shows only the messages the reporter's phone shared. Closed reports and moderation history are deleted after two years.
- **Topics** lets a moderator fix a suggestion's wording, kind, fields, and conversation openers before approving it.
- **Takeaways** holds the one-line takeaways people write after a meetup. An approved line appears on the topic's public page without a name.
- **People** finds an account by name or email and shows its report history. It can remove the photo or ban the account.
- **History** records every action and who took it, using the email Access verified.
- **Crashes** groups the app's crash reports by error message for 30 days. Release builds are minified, so a stack trace shows roughly where a crash happened, not the original line.

## How people lean

Once someone picks a stance on a question, its card shows how the city leans, as percentages. The totals stay hidden below 10 answers and when everyone agrees, because then they'd reveal each person's answer. Topic cards also show how many meetups were held, once there are 5. Stance never decides who meets whom.

## After a meetup

Once someone says a meetup happened, the app asks three private questions: did anyone change their mind, did the group mostly agree, split, or mostly disagree, and would they meet again on this topic. Each topic's card and public page show the answers as percentages once 5 people have answered. Anyone who later says the meetup didn't happen drops out of the totals.

People can also write one optional line about what they took away. That line isn't end-to-end encrypted. It waits in the Takeaways queue, and only approved lines appear on the topic page.

## Languages

The app is in English and French, and follows the phone's language. Text in the app uses `t("English", "Français")` from `apps/mobile/src/i18n.ts`, and every request carries the language. The server uses it to pick topic text and to send push and email in each person's language. Each seeded topic has its French in `seed/topics.json`. Topics people suggest show as written, and city names stay in English.

## Message encryption

Messages are end-to-end encrypted, so the server stores only ciphertext. The code is in `packages/shared/src/e2ee.ts`, built on the audited `@noble` libraries, which are pure JavaScript and run in Expo Go.

Each phone creates an X25519 key pair at sign-in. The private key stays in `expo-secure-store`, and the public key goes to the server. To send, the phone encrypts the text with XChaCha20-Poly1305 under a fresh random key, then encrypts that key once for every current device in the chat. The server rejects a message that leaves out a current device, and the phone fetches the latest list and tries again. Each message is bound to its chat and sender, so the server can't move it to another chat or credit it to someone else.

What this changes elsewhere:

- **Previews and push.** The server can't write a preview, so the phone decrypts the latest message for the inbox. Push notifications say only who wrote and "New message", because push services can read them.
- **Reports.** The reporter's phone reveals the keys for the reported message and its neighbours. The server decrypts the stored ciphertext with those keys, which proves the text is what was sent, and keeps it with the report. Nothing else in the chat becomes readable.
- **New phones.** A new phone, or a reinstall, reads messages from then on. Older ones show as unreadable unless it restores a backup.
- **Key backup.** Back up messages, under You, saves a file of this phone's keys, encrypted with XChaCha20-Poly1305 under a key derived from a passphrase with scrypt. The share sheet saves it wherever the person chooses. The file never reaches our servers, and a lost passphrase can't be recovered.
- **Groups.** Someone who joins reads from then on. Someone who leaves stops being included.

Not encrypted: messages the app writes itself (such as "Sam proposed a meetup"), meetup times and places (the server sends reminders and share pages from them), profiles, and swipes.

Known limits:

- **No forward secrecy.** Keys don't ratchet, so someone who extracts a phone's private key can read everything that phone could read.
- **The server hands out public keys.** A malicious server could add a device of its own. The security code under About this chat changes when that happens, but only helps if people compare it.
- **Metadata stays visible.** The server knows who talks to whom, and when.

## Privacy and safety

The policy, terms, and Safety page are public at `/privacy`, `/terms`, and `/safety`, and in French at `/confidentialite`, `/conditions`, and `/securite`. Their text lives in `apps/api/src/legal/content.ts`. When a change needs people to agree again, raise `LEGAL_VERSION` in `packages/shared/src/constants.ts`, and the app asks them on next launch.

[docs/compliance.md](docs/compliance.md) records how the app lines up with PIPEDA, Quebec law, CASL, and Bills C-34 and C-36, what to do after a breach, and the known gaps.

## Abuse limits

| Limit | Value | Past it |
|---|---|---|
| Sign-in requests per network | 10 a minute | The app asks the person to wait a minute |
| Code checks per network | 30 a minute | Same |
| Sign-in emails per address | 3 every 15 minutes | No more emails go out, and the app still says one was sent |
| Sign-in emails, everyone combined | 500 an hour (`LOGIN_EMAIL_HOURLY_CAP`) | Sign-in fails and logs `login_email_cap_reached` |
| Crash reports per network | 20 a minute | Reports are dropped |
| Wording suggestions per person | 10 a minute | The app asks the person to wait a minute |
| Reports per person | 10 a day | The app says that's the limit, and to call 911 if they're in danger |
| Topic suggestions per person | 5 a day | The app says to suggest more tomorrow |

The per-network limits are rate-limit bindings in `apps/api/wrangler.jsonc`. Dev mode skips the sign-in limits, because the seed script signs in many people at once.

## Deploy

Check `npx wrangler whoami` first: the Worker deploys to the account in `account_id` in `apps/api/wrangler.jsonc`.

For a normal release, apply new migrations, then deploy:

```bash
pnpm --filter @babillard/api db:migrate:remote
```

```bash
pnpm --filter @babillard/api deploy
```

The deploy also publishes the landing page. The Worker serves `apps/site/public` at `/`, `/fr/`, and `/site/*`, and sends every other path to the API. Edit the page text in `apps/site/src/copy.ts`, not the generated HTML.

To release a new Android version:

1. Raise `version` in `apps/mobile/app.config.ts` and commit it. Android's version code comes from it (0.3.2 is 302, 1.0.0 is 10000), so it's the only number to change.
2. Build: `npx eas-cli build --platform android --profile preview` from `apps/mobile`.
3. Release: `node scripts/release-android.ts` from `apps/mobile`. It refuses a version that isn't newer than the one out, uploads the APK to R2 as `releases/babillard.apk`, sets `ANDROID_LATEST_VERSION` in `apps/api/wrangler.jsonc`, and deploys. Then it publishes the APK as a [GitHub release](https://github.com/arcanistzed/babillard/releases), tagged on the build's commit, with notes from the `feat` and `fix` commits since the last one. That step needs the GitHub CLI signed in and the commit pushed. Commit the `wrangler.jsonc` change.

Older installs then offer the update once per launch. When old versions would break against the API, also set `ANDROID_MIN_VERSION`. Installs below it show a screen that only offers the download.

[docs/play-store.md](docs/play-store.md) covers publishing on Google Play instead.

When topics or cities change, run `pnpm --filter @babillard/api seed:sql`, then load the result. It's safe to run again, and it moves people out of any city that was merged into another. Seeded topics take their wording, place, and starter order from `seed/topics.json` on every load. A seeded topic removed from the file becomes `retired` rather than deleted, so its groups keep working.

```bash
cd apps/api && npx wrangler d1 execute babillard --remote --file seed/seed.sql
```

### Setting it up from nothing

1. **Create the resources.** Put the printed database ID in `wrangler.jsonc`.

   ```bash
   npx wrangler d1 create babillard
   ```

   ```bash
   npx wrangler r2 bucket create babillard
   ```

2. **Set the secrets.** `AUTH_SECRET` is a long random value, and `ADMIN_EMAIL` receives report alerts. `ANTHROPIC_API_KEY` is optional and turns on wording help for topics.

   ```bash
   npx wrangler secret put AUTH_SECRET
   ```

   ```bash
   npx wrangler secret put ADMIN_EMAIL
   ```

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

3. **Set up sign-in email with Amazon SES.** Verify a domain in a region with production access. Set `EMAIL_FROM` to an address on that domain and `SES_REGION` to that region. Create an IAM user that can only call `ses:SendEmail` from that address, and store its keys as secrets.

   ```bash
   npx wrangler secret put SES_ACCESS_KEY_ID
   ```

   ```bash
   npx wrangler secret put SES_SECRET_ACCESS_KEY
   ```

4. **Protect the admin pages.** Create a self-hosted Cloudflare Access application for `<your-worker-host>/admin`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (the AUD tag is under the application's Additional settings). Until both are set, admin pages return 403 for everyone. Don't protect the whole Worker, or the app stops working.

5. **Migrate, deploy, and seed** as described above.

6. **Set up the app builds.** The EAS project ID is in `apps/mobile/app.config.ts`. Android push needs a Firebase project, with `google-services.json` in `apps/mobile` and an FCM V1 key uploaded through `eas credentials`. iOS push needs an Apple Developer account.

7. **Sign-in links.** Android verifies App Links on the `PUBLIC_ORIGIN` host against `ANDROID_CERT_SHA256`, a comma-separated list of signing key fingerprints. iOS needs `APPLE_APP_ID` (team ID and bundle ID). Emails leave out links on `workers.dev` hosts, because mail filters treat those as phishing.

## Decisions worth knowing

- **Cities come from a fixed list, not free text.** Matching needs one shared ID per city, or "Ottawa" and "ottawa on" would never meet. Places inside a metro area share its entry, so people in Aylmer, Gatineau, and Ottawa end up together. Canada uses a radius per metro. Elsewhere, a place under 1 million people merges into a city at least twice its size within 20 km in the same country. The list has 1,778 cities from [GeoNames](https://www.geonames.org/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): those over 300,000 people, or over 30,000 in Canada.
- **Location stays on the phone.** The location button finds the nearest city on the device and sends only that city.
- **Moving city carries your picks.** Your right-swiped topics join the cohorts in the new city, so you can land in a group there. Existing chats stay open.
- **Topics have a place.** A topic's `place` is empty for everywhere, a country code (`CA`), a province (`CA:Ontario`), or a city ID (`ottawa-08-ca`). Only people inside it see the topic. Suggested topics start in the suggester's city, and a moderator can widen the place when approving. The seeded questions lean toward Ottawa, Ontario, and Canada, where the app starts.
- **AI only helps with topic wording.** With `ANTHROPIC_API_KEY` set, someone suggesting a topic can ask for clearer wording, and moderators get a "Draft with AI" link that fills in tidier English, French, openers, and a recommended place. Only the topic's text goes to Anthropic, never messages or anything about a person. `ANTHROPIC_MODEL` picks the model.
- **Newcomers share an opening deck.** Until someone has swiped 20 topics, their deck leads with 12 broad starter topics (`starter` in `seed/topics.json`). The first people in a city then overlap within minutes instead of scattering across 250 topics.
- **Stance never decides who meets whom.** People gather around topics. A question's stance only adds variety to a group, so it isn't unanimous when someone with another view is waiting.
- **"Open to dating" is private unless mutual.** Every response that shows someone's chips goes through `visibleLookingFor`.
- **18 and over.** The date of birth is checked at sign-up, nothing is stored for anyone younger, and it can't be edited afterward. Others see the age it gives, never the date.
- **Age ranges go both ways.** People can set the ages they want to meet, and someone appears in suggestions only when each person's age is in the other's range. Ranges start open. Groups ignore them, but lean toward similar ages when forming.
- **Share pages hide names.** A meetup link shows the plan behind an unguessable token, since venue and time can be sensitive.
- **Crash reports carry no identity.** The endpoint is open, because a crash can happen before sign-in, and it takes no user ID.

## Licence

Copyright (C) 2026 Daniel Thorp. Babillard is free software under the [GNU Affero General Public License](LICENSE), version 3 or later. Anyone who runs a modified version as a service has to publish their changes. Contributions are covered by the [contributor licence agreement](CLA.md), and the name and logo by [TRADEMARKS.md](TRADEMARKS.md).
