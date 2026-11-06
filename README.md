# Ideas Match

A mobile app where people find each other through the ideas they want to talk about, then meet in person.

People swipe on a deck of topics: research areas, books, methods, and policy questions. Four people in one city picking the same topic opens a group chat automatically. People who share a topic also see each other as cards, and a mutual swipe opens a one-on-one chat with a conversation starter already in it. Any chat can propose a meetup in one tap.

The number that matters is meetups that actually happened, shown at the top of the `/admin` page.

## How it's built

| Path | What it is |
|---|---|
| `apps/mobile` | Expo and React Native app with expo-router, Reanimated, and Gesture Handler |
| `apps/api` | Cloudflare Worker with Hono and Drizzle on D1, two Durable Objects, and R2, sending email through Amazon SES |
| `packages/shared` | Matching rules, request schemas, and response types used by both |

The rules that decide who sees whom and who gets grouped are plain functions in `packages/shared/src/rules`.

- **`ChatRoom`** is one Durable Object per conversation. It holds the message log and the WebSockets.
- **`Cohort`** is one Durable Object per topic and city. It forms groups one join at a time, so simultaneous swipes can't split a group.
- **A cron sweep** every five minutes (`apps/api/src/cron.ts`) handles match nudges and expiry, meetup reminders, and did-you-meet check-ins.

## Run it locally

You need Node 24. This repo pins pnpm through `packageManager`. If `pnpm` on your machine is broken, `npx pnpm@11.1.3` works anywhere below.

```bash
pnpm install
```

Set up the API. This creates a local database and loads 200 topics and 16 localities.

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

```bash
pnpm --filter @ideas-match/api db:migrate:local
```

```bash
pnpm --filter @ideas-match/api seed:local
```

```bash
pnpm --filter @ideas-match/api dev
```

With that running, add 30 fake people in another terminal. It prints emails you can sign in with.

```bash
pnpm --filter @ideas-match/api seed:dev
```

Run the app. It needs a development build, because Expo Go can't do Universal Links.

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

```bash
pnpm --filter @ideas-match/mobile android
```

The API URL in `.env` is right for an Android emulator. For a physical phone, use your computer's LAN address in both `apps/mobile/.env` and `PUBLIC_ORIGIN` in `.dev.vars`. In development, the check-your-inbox screen shows the sign-in code and no email is sent.

React Native on Android needs JDK 17 or 21. Point `JAVA_HOME` at one if your default is newer. iOS builds need a Mac: `pnpm --filter @ideas-match/mobile ios`.

## Test it

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm --filter @ideas-match/api test:e2e
```

The end-to-end suite starts two real local Workers with throwaway databases. One runs in dev mode, and one has production settings, so it can check the protections dev mode turns off. It drives sign-in, swiping, matching, chat over WebSocket, group formation under concurrent load, meetups, the cron sweep, moderation, and account deletion.

To run the cron sweep by hand against a dev server:

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

To test timed jobs without waiting days, set `NUDGE_AFTER_MS`, `MATCH_EXPIRY_MS`, `MEETUP_REMINDER_LEAD_MS`, and `MEETUP_CHECKIN_DELAY_MS` in `.dev.vars`.

## Before the first deploy

Replace the `ideasmatch.example` placeholders in `apps/api/wrangler.jsonc` and `apps/mobile/eas.json`, then work through these.

1. **Create the resources.** Put the printed database id in `wrangler.jsonc`.

   ```bash
   npx wrangler d1 create ideas-match
   ```

   ```bash
   npx wrangler r2 bucket create ideas-match-avatars
   ```

2. **Set the sign-in secret.** Use a long random value.

   ```bash
   npx wrangler secret put AUTH_SECRET
   ```

3. **Set up sign-in email with Amazon SES.** Verify a domain in SES in a region with production access. Set `EMAIL_FROM` to an address on that domain and `SES_REGION` to that region. Then create an IAM user that can only call `ses:SendEmail` from that address, and store its keys as secrets.

   ```bash
   npx wrangler secret put SES_ACCESS_KEY_ID
   ```

   ```bash
   npx wrangler secret put SES_SECRET_ACCESS_KEY
   ```

4. **Protect the admin pages.** Create a Cloudflare Access application covering `/admin/*`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Until both are set, admin pages return 403 for everyone.

5. **Apply the database and deploy.**

   ```bash
   pnpm --filter @ideas-match/api db:migrate:remote
   ```

   ```bash
   pnpm --filter @ideas-match/api deploy
   ```

   Load the topics into the remote database too:

   ```bash
   npx wrangler d1 execute ideas-match --remote --file apps/api/seed/seed.sql
   ```

6. **Set up the app builds.** Run `eas init`, and set `EAS_PROJECT_ID` so push tokens can be issued. Android push also needs Firebase credentials, and iOS needs an Apple Developer account.

7. **Turn on sign-in links.** Set `APPLE_APP_ID` (team id and bundle id) and `ANDROID_CERT_SHA256` so Universal Links and App Links verify. Until then, the six-digit code still works.

## Decisions worth knowing

- **Cities come from a fixed list, not free text.** Matching needs one shared ID per city, or "Ottawa" and "ottawa on" would never meet. Places inside a metro area share its row, so people in Aylmer, Gatineau, and Ottawa end up together. Canada uses a radius per metro. Elsewhere, a place under 1 million people merges into a city at least twice its size within 20 km in the same country. City data comes from [GeoNames](https://www.geonames.org/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), filtered to cities over 300,000 people, or over 30,000 in Canada.

- **Stance never decides who meets whom.** People gather around topics. A question's stance only feeds the group's overall spread, and later the policy consultation export.
- **"More than friends" is private unless mutual.** Every response showing someone's chips goes through `visibleLookingFor`.
- **18 and over.** Date of birth is checked at onboarding, nothing is stored for anyone younger, and it can't be edited afterward.
- **Share pages hide names.** A meetup link shows the plan and uses an unguessable token, since venue and time can be sensitive.

## Not built yet

The policy consultation export comes next. Stances are already being collected, so it's reporting on data the app already has. Also deferred: a web client, institution-only communities, GPS location, and a public events feed.
