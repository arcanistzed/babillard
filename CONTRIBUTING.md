# Contributing

Thanks for helping. A few things before you open a pull request:

- **Agreement.** Every contribution is covered by the [contributor licence agreement](CLA.md). Opening a pull request means you agree to it, and the pull request template asks you to confirm.
- **Setup.** The README's "Run it locally" section covers the API, the app, and the emulator.
- **Checks.** Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before you push. Changes to the API also need the end-to-end tests in `apps/api` (`pnpm --filter @babillard/api test:e2e`).
- **Both languages.** Every string people see has English and French, written with `t(english, french)`. French is Canadian French, with no space before `?`, `!`, or `:`.
- **Privacy.** Don't add tracking, analytics, or anything that sends personal information to a new company without discussing it in an issue first. The privacy policy in `apps/api/src/legal/content.ts` has to describe what the app does.
- **Security problems** go to privacy@babillard.app, not a public issue.

The name and logo aren't covered by the code's licence. See [TRADEMARKS.md](TRADEMARKS.md).
