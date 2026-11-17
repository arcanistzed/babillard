/**
 * A topic link opened before someone signed in or finished setting up. The route guard
 * keeps it while they do, then takes them there instead of the deck.
 *
 * Kept in memory, which is enough for the trip through sign-in, the emailed link and
 * onboarding. If Android closes the app in between, they land on the deck instead.
 */
let pending: string | null = null;

/** Only topic links wait. Everything else, invites included, ends up on the deck anyway. */
export function keepLink(pathname: string): void {
  if (/^\/t\/[^/]+$/.test(pathname)) pending = pathname;
}

/** The kept link, once. Taking it clears it, so it can't send someone back there again. */
export function takeLink(): string | null {
  const link = pending;
  pending = null;
  return link;
}
