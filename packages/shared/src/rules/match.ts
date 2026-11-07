export function orderedPair(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

export function isMutualMatch(mine: "right" | "left", theirs: "right" | "left" | null | undefined): boolean {
  return mine === "right" && theirs === "right";
}

export function pickOpener(openers: string[], random: () => number = Math.random): string {
  if (openers.length === 0) return "What pulled you toward this topic?";
  return openers[Math.floor(random() * openers.length)] ?? openers[0]!;
}

/** Question topics are full sentences, so they need quoting to sit inside another sentence. */
export function topicPhrase(topicTitle: string): string {
  return topicTitle.endsWith("?") ? `\u201c${topicTitle}\u201d` : topicTitle;
}

export function matchOpenerMessage(topicTitle: string, opener: string): string {
  const stop = topicTitle.endsWith("?") ? "" : ".";
  return `You both want to dig into ${topicPhrase(topicTitle)}${stop} ${opener}`;
}

/** Starting points for a newly approved topic. A moderator can edit them before approving. */
export function defaultOpeners(kind: "interest" | "question", title: string): string[] {
  return kind === "question"
    ? ["Where do you land on this, and why?", "What would change your mind?"]
    : [`What got you interested in ${title}?`, "What should I read or look at first?"];
}
