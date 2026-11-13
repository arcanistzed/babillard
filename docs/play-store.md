# Google Play

The app is ready for Play, apart from the parts only the account owner can do. The `production` build profile makes the App Bundle Play needs. That build never offers the APK from babillard.app, because Play forbids apps from updating themselves outside Play. Instead, a version too old to work sends people to the Play listing.

## Steps

1. **Register** at play.google.com/console as a personal developer: a one-time US$25 fee and an identity check. The same registration covers Android's developer verification for sideloaded apps.
2. **Create the app.** Name: Babillard. Default language: English (Canada), with a French (Canada) translation. It's an app, free, with no ads.
3. **Build the bundle:**
   ```bash
   cd apps/mobile && npx eas-cli build --platform android --profile production
   ```
   Upload the first bundle by hand in the Console: Google's API can't create an app's first release.
4. **Add Play's signing key to two places.** Play re-signs the app with its own key, so the fingerprints change:
   - Copy the SHA-256 under Test and release > App integrity > App signing into `ANDROID_CERT_SHA256` in `apps/api/wrangler.jsonc`, after the current one and a comma, and deploy. Otherwise sign-in links won't open the app.
   - Add its SHA-1 to the Android API key's restrictions in Google Cloud > Credentials. Otherwise push token registration fails.
5. **Run the closed test.** A new personal account needs 12 testers opted in for 14 days in a row before the app can go public, so about three weeks.
6. **Let EAS upload later builds.** In Google Cloud, create a service account with access to the app in Play Console, download its JSON key, and save it as `apps/mobile/play-service-account.json`. Git ignores that file. Then:
   ```bash
   cd apps/mobile && npx eas-cli submit --platform android --profile production
   ```
   That uploads to the internal track, and you promote it in the Console.

People who installed the APK from babillard.app can't update to the Play version in place, because the signatures differ. They uninstall and install from Play, then sign in again. Messages from before only come back if they saved a backup.

## Listing

**Short description**

- English: Pick topics, match with people in your city, and meet in person.
- French: Choisissez des sujets et rencontrez en personne des gens de votre ville.

**Full description (English)**

Babillard is for people who want to talk about ideas face to face.

Swipe through topics, from reading groups and research to the questions your city is arguing about. When enough people near you pick the same topic, a small group forms and you plan a meetup together. You can also match one on one with someone who picked the same things.

- Groups of 4 to 8 people, formed around one topic in your city.
- End-to-end encrypted chat. We can't read your messages.
- Your stance on a question is never shown as yours.
- Choose the ages you want to meet. Others see your age, never your birth date.
- In English and French.

Babillard is for people 18 and over. It's free, with no ads, and we don't sell your information.

**Full description (French)**

Babillard est pour les gens qui veulent discuter d'idées en personne.

Parcourez des sujets, des cercles de lecture à la recherche, jusqu'aux questions qui animent votre ville. Quand assez de gens près de vous choisissent le même sujet, un petit groupe se forme et vous planifiez une rencontre ensemble. Vous pouvez aussi être jumelé avec une personne qui a fait les mêmes choix.

- Des groupes de 4 à 8 personnes, formés autour d'un sujet dans votre ville.
- Des conversations chiffrées de bout en bout. Nous ne pouvons pas lire vos messages.
- Votre position sur une question n'est jamais présentée comme la vôtre.
- Choisissez l'âge des personnes que vous voulez rencontrer. Les autres voient votre âge, jamais votre date de naissance.
- En français et en anglais.

Babillard est réservé aux personnes de 18 ans et plus. L'application est gratuite, sans publicité, et nous ne vendons pas vos renseignements.

**Links**

- Privacy policy: https://babillard.app/privacy
- Account deletion: https://babillard.app/privacy. The "Deleting your account" section explains the in-app steps and gives privacy@babillard.app for requests without the app.

## App content answers

- **Target audience:** 18 and over only.
- **Content rating:** people can talk to each other, meet in person, and share photos. No violence, gambling, or purchases.
- **Ads:** none.
- **Data safety:** these come from the privacy policy. Check them against it before submitting.

| Data | Collected | Why | Optional |
| --- | --- | --- | --- |
| Email address | Yes | Account, sign-in | No |
| Name | Yes | App functionality | No |
| Date of birth (other personal info) | Yes | Age check, shown as age | No |
| Photos | Yes | Profile picture | Yes |
| Messages | No | End-to-end encrypted, so we can't read them | |
| App interactions (topics, swipes, meetups) | Yes | App functionality | No |
| Crash logs | Yes | Fixing problems, no account ID | No |
| Device or other IDs (push token) | Yes | Notifications | Yes |
| Location | No | The city is chosen on the phone, coordinates never leave it | |

- Data is encrypted in transit, nothing is sold or shared for advertising, and people can delete their account in the app.
- Cloudflare, Amazon, Expo, Google, Apple, and Anthropic process data for us as service providers, which Play doesn't count as sharing.
