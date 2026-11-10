# Babillard

A mobile app where people find each other through the ideas they want to talk about, then meet in person.

People swipe on a deck of topics: research areas, books, methods, and policy questions. Four people in one city picking the same topic opens a group chat automatically. People who share a topic also see each other as cards, and a mutual swipe opens a one-on-one chat with a conversation starter already in it. Any chat can propose a meetup in one tap.

What we measure is how many meetups actually happened, shown at the top of the `/admin` page.

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
- **A cron sweep** runs every five minutes (`apps/api/src/cron.ts`). It sends match nudges and expires silent matches, sends meetup reminders and did-you-meet check-ins, and removes old sign-in codes, sessions, and crash reports.

## Run it locally

You need Node 24. This repo pins pnpm through `packageManager`. If `pnpm` on your machine is broken, `npx pnpm@11.1.3` works anywhere below.

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

With that running, add 30 fake people from another terminal. It prints emails you can sign in with.

```bash
pnpm --filter @babillard/api seed:dev
```

To start over, stop the server and delete `apps/api/.wrangler/state` completely. Deleting only the database leaves the Durable Objects behind, and they'll still remember conversations and cohorts that no longer exist.

Now run the app, either way:

- **Expo Go** is the quickest. It can't receive push notifications or open sign-in links, but the six-digit code works. Run `cd apps/mobile && npx expo start --go`, and pick the version of Expo Go that matches SDK 58.
- **A development build** does everything, and takes longer the first time. Run `cp apps/mobile/.env.example apps/mobile/.env`, then `pnpm --filter @babillard/mobile android`. React Native on Android needs JDK 17 or 21, so point `JAVA_HOME` at one if your default is newer. iOS needs a Mac.

The default API URL works on an Android emulator. For a physical phone, use your computer's LAN address in both `apps/mobile/.env` and `PUBLIC_ORIGIN` in `.dev.vars`. In development, the check-your-inbox screen shows the sign-in code and no email goes out.

## Share a build

Android testers don't need any of the setup above. This makes an APK and a link to share:

```bash
cd apps/mobile && npx eas-cli build --platform android --profile preview
```

EAS removes its copy after about two weeks, so invite pages serve the APK from R2 at `/download/android`. After each new build, download the APK and upload it:

```bash
cd apps/api && npx wrangler r2 object put babillard/releases/babillard.apk --file <path-to-apk> --remote
```

### iPhone testing without an Apple Developer account

Expo Go runs the app on a real iPhone. Start the server below, then scan its QR code with the iPhone camera:

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=https://babillard.app npx expo start --go
```

The phone must be on the same network as this computer. Add `--tunnel` if it isn't. Push notifications and sign-in links don't work this way. This project was tested with Expo Go 58.0.7 on iOS.

For the iOS Simulator on a Mac, this build also needs no Apple account:

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

The end-to-end suite starts two local Workers with throwaway databases. One runs in dev mode. The other has production settings, so it can check the protections dev mode turns off, such as sign-in rate limits and the locked admin pages. It covers sign-in, swiping, matching, chat over WebSocket, group formation under concurrent load, meetups, the cron sweep, moderation, crash reports, and account deletion. On a busy machine, raise `--testTimeout` before you blame the code. GitHub Actions runs all of these on every push to `main` and on pull requests.

To run the cron sweep by hand against a dev server:

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

To test timed jobs without waiting days, set `NUDGE_AFTER_MS`, `MATCH_EXPIRY_MS`, `MEETUP_REMINDER_LEAD_MS`, and `MEETUP_CHECKIN_DELAY_MS` in `.dev.vars`.

## Moderation

The `/admin` pages live behind Cloudflare Access.

- **Overview** shows meetups that happened and the current queues.
- **Reports** is the queue. Safety and underage reports go first and also email `ADMIN_EMAIL` right away. A report shows only the messages the reporter's phone shared. The server deletes closed reports and moderation history after two years.
- **Topics** lets a moderator fix the wording, kind, fields, and conversation openers of a suggestion before approving it.
- **Takeaways** holds the one-line takeaways people write after a meetup. An approved line appears on the topic's public page without a name.
- **People** finds an account by name or email, with its report history, its photo and a button to remove it, and a ban button.
- **History** records every action and who took it, using the email Access verified.
- **Crashes** groups reports from the app by error message for 30 days. Stack traces from release builds are minified, so they show roughly where a crash happened, not the original line.

## How people lean

Question cards show how the city leans, as percentages, once someone picks a stance. The totals stay hidden below 10 answers and when everyone agrees, because then they would reveal each person's answer. Topic cards also show how many meetups were confirmed as held, from 5 up. Stance never decides who meets whom.

## After a meetup

Once someone says a meetup happened, the app asks three private questions: did anyone change their mind, did the group mostly agree, split, or mostly disagree, and would they meet again on this topic. Each topic's card and public page show the answers as percentages once 5 people have answered. Anyone who later says the meetup didn't happen drops out of the totals. People can also write one optional line about what they took away. That line isn't end-to-end encrypted. It waits in the Takeaways queue, and only approved lines appear on the topic page.

## Languages

The app is in English and French, and follows the phone's language. Text in the app uses `t("English", "Français")` from `apps/mobile/src/i18n.ts`, and it sends the language with each request. The server uses that to pick topic text, and to send push and email in each person's language. Each seeded topic carries its French in `seed/topics.json`. Topics people suggest show as written, and city names stay in English.

## Message encryption

People's messages are end-to-end encrypted, so the server stores only ciphertext. The code is in `packages/shared/src/e2ee.ts`, built on the audited `@noble` libraries, which are pure JavaScript and run in Expo Go.

Each phone creates an X25519 key pair at sign-in. The private key stays in `expo-secure-store`, and the public key goes to the server. To send, the phone encrypts the text with XChaCha20-Poly1305 under a fresh random key, then encrypts that key once for every current device in the chat. The server rejects a message that leaves out a current device, and the phone then fetches the latest list and tries again. Each message is bound to its chat and sender, so the server can't move it elsewhere or credit it to someone else.

What this changes elsewhere:

- **Previews and push.** The server can't write a preview, so the phone decrypts the latest message for the inbox. Push notifications say only who wrote and "New message", because push services can read them.
- **Reports.** The reporter's phone reveals the keys for the reported message and its neighbours. The server decrypts the stored ciphertext with those keys, which proves the text is what was sent, and keeps that text with the report. Nothing else in the chat becomes readable.
- **New phones.** A new phone, or a reinstall, can read messages from then on, and shows older ones as unreadable unless it restores a backup.
- **Key backup.** Back up messages, under You, saves a file holding this phone's keys, encrypted with XChaCha20-Poly1305 under a scrypt-derived key from a passphrase. The phone's share sheet saves it wherever the person chooses, including Google Drive. The file never reaches our servers, and a lost passphrase can't be recovered. Restored keys only open older messages, and the phone keeps its own key for new ones.
- **Groups.** Someone who joins reads from then on. Someone who leaves stops being included.

Not encrypted: messages the app writes itself (such as "Sam proposed a meetup"), meetup times and places (the server sends reminders and share pages from them), profiles, and swipes.

Known limits:

- **No forward secrecy.** Keys don't ratchet, so someone who extracts a phone's private key can read everything that phone could read. A double ratchet would fix this at the cost of much more state, especially in groups.
- **The server hands out public keys.** A malicious server could add a device of its own. The security code under About this chat changes when that happens, but only if people compare it.
- **Metadata stays visible:** who talks to whom, and when.

Plain text stored before encryption is removed the first time each chat wakes up.

## Privacy and safety

The policy, terms, and Safety page are public at `/privacy`, `/terms`, and `/safety`, and in French at `/confidentialite`, `/conditions`, and `/securite`. Their text is in `apps/api/src/legal/content.ts`. When a change needs people to agree again, bump `LEGAL_VERSION` in `packages/shared/src/constants.ts`, and the app will ask them on next launch.

[docs/compliance.md](docs/compliance.md) records how the app lines up with PIPEDA, Quebec law, CASL, and Bills C-34 and C-36, plus what to do after a breach, and the known gaps.

## Abuse limits

Each one is a value in `apps/api/wrangler.jsonc`.

| Limit | Value | What happens past it |
|---|---|---|
| Sign-in requests per network | 10 per minute | The app asks the person to wait a minute |
| Code checks per network | 30 per minute | Same |
| Crash reports per network | 20 per minute | Reports are dropped |
| Wording suggestions per person | 10 per minute | The app says to wait a minute |
| Sign-in emails, everyone combined | `LOGIN_EMAIL_HOURLY_CAP`, 500 per hour | Sign-in fails and logs `login_email_cap_reached`. Raise it as real traffic grows |

There are also per-address limits on sign-in email, and daily limits on reports and topic suggestions. Dev mode skips the sign-in limits, because the seed script signs in many people at once.

## Deploy

The Worker runs on the dedicated Babillard Cloudflare account. Use its `babillard` `wrangler` profile, and check `npx wrangler whoami` first if you have other accounts.

For a normal release, apply new migrations, then deploy:

```bash
pnpm --filter @babillard/api db:migrate:remote
```

```bash
pnpm --filter @babillard/api deploy
```

The deploy also publishes the landing page. The API Worker serves the files in `apps/site/public` at `/`, `/fr/`, and `/site/*`, and every other path goes to the API. Edit the page text in `apps/site/src/copy.ts`, not the generated HTML.

To release a new Android build, build the `preview` profile (EAS numbers each build), upload the APK to R2 as `releases/babillard.apk`, then set `ANDROID_LATEST_BUILD` in `wrangler.jsonc` to its build number and deploy. Older installs then offer the update once per launch. Raise `ANDROID_MIN_BUILD` too when old builds would break against the API; installs below it show a screen that only offers the download.

When topics or cities change, run `pnpm --filter @babillard/api seed:sql`, then load the result. It's safe to run again, and it moves people out of any city that was merged into another. Seeded topics take their wording, place, and starter order from `seed/topics.json` on every load, and a seeded topic removed from the file becomes `retired` rather than deleted, so its groups keep working.

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

2. **Set the secrets.** `AUTH_SECRET` is a long random value, and `ADMIN_EMAIL` receives report alerts.

   ```bash
   npx wrangler secret put AUTH_SECRET
   ```

   ```bash
   npx wrangler secret put ADMIN_EMAIL
   ```

3. **Set up sign-in email with Amazon SES.** Verify a domain in a region with production access. Set `EMAIL_FROM` to an address on that domain and `SES_REGION` to that region. Create an IAM user that can only call `ses:SendEmail` from that address, and store its keys as secrets.

   ```bash
   npx wrangler secret put SES_ACCESS_KEY_ID
   ```

   ```bash
   npx wrangler secret put SES_SECRET_ACCESS_KEY
   ```

4. **Protect the admin pages.** Create a self-hosted Cloudflare Access application with a public hostname destination of `<your-worker-host>/admin`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (the AUD tag is under the application's Additional settings). Until both are set, admin pages return 403 for everyone. Don't use a Workers destination or "Protect this Worker", because that locks the whole API and the app stops working.

5. **Migrate, deploy, and seed** as described above.

6. **Set up the app builds.** The EAS project ID is in `apps/mobile/app.config.ts`. Android push needs a Firebase project, with `google-services.json` in `apps/mobile` and an FCM V1 key uploaded through `eas credentials`. iOS push needs an Apple Developer account.

7. **Sign-in links.** `ANDROID_CERT_SHA256` is set, so Android verifies App Links on the `PUBLIC_ORIGIN` host. iOS still needs `APPLE_APP_ID` (team ID and bundle ID). Emails leave out links on `workers.dev` hosts, because mail filters treat those as phishing.

## Decisions worth knowing

- **Cities come from a fixed list, not free text.** Matching needs one shared ID per city, or "Ottawa" and "ottawa on" would never meet. Places inside a metro area share its row, so people in Aylmer, Gatineau, and Ottawa end up together. Canada uses a radius per metro. Elsewhere, a place under 1 million people merges into a city at least twice its size within 20 km in the same country. The list has 1,778 cities from [GeoNames](https://www.geonames.org/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), filtered to cities over 300,000 people, or over 30,000 in Canada.
- **Location stays on the phone.** The location button finds the nearest city on the device and sends only that city.
- **Moving city carries your picks.** Your right-swiped topics join the cohorts in the new city, so you can land in a group there. The topics you already joined stay yours, and existing chats stay open.
- **Topics have a place.** A topic's `place` is empty for everywhere, a country code (`CA`), a province (`CA:Ontario`), or a city ID (`ottawa-08-ca`). The deck and swipes only reach people inside it. Suggested topics stay in the suggester's city, approved or not, so each area's deck grows from what people there propose. The seeded questions lean toward Ottawa, Ontario, and Canada, since that's where the app starts, and worldwide debates stay worldwide.
- **AI only helps with topic wording.** With the `OPENAI_API_KEY` secret set, someone suggesting a topic can ask for clearer wording, and moderators get a "Draft with AI" link that fills in tidier English, French, openers, and a recommended place. Only the topic's text goes to OpenAI, with `store: false`, never messages or anything about a person. People never pick a topic's place themselves: suggestions start in their city, and the moderator widens it when approving. `OPENAI_MODEL` picks the model.
- **Newcomers share an opening deck.** Until someone has swiped 20 topics, their deck leads with a fixed set of broad starter topics (`starter` in `seed/topics.json`). The first people in a city then overlap within minutes instead of scattering across 250 topics, before field overlap and nearby groups take over the ranking.
- **Stance never decides who meets whom.** People gather around topics. A question's stance only feeds the group's overall spread, and later the policy consultation export.
- **"Open to dating" is private unless mutual.** Every response showing someone's chips goes through `visibleLookingFor`.
- **18 and over.** Date of birth is checked at onboarding, nothing is stored for anyone younger, and it can't be edited afterward.
- **Share pages hide names.** A meetup link shows the plan and uses an unguessable token, since venue and time can be sensitive.
- **Messages are end-to-end encrypted.** See [Message encryption](#message-encryption) for what that covers and what it doesn't.
- **Crash reports carry no identity.** The endpoint is open, because a crash can happen before sign-in, and it takes no user ID.

## Not built yet

The policy consultation export comes next. Stances are already being collected, so it's reporting on data the app already has. Also deferred: a web client, institution-only communities, and a public events feed.
