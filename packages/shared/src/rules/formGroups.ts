import { GROUP_MAX_SIZE, GROUP_MIN_SIZE, type Stance } from "../constants";

export interface Waiter {
  userId: string;
  stance: Stance | null;
  joinedAt: number;
}

export type BlockPair = readonly [string, string];

export interface FormGroupsInput {
  waiting: Waiter[];
  topicKind: "interest" | "question";
  blocks: BlockPair[];
  minSize?: number;
  maxSize?: number;
}

function blockChecker(blocks: BlockPair[]): (a: string, b: string) => boolean {
  const pairs = new Set(blocks.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  return (a, b) => pairs.has(`${a}|${b}`);
}

/** True when someone can join these members without sitting next to a person they blocked or were blocked by. */
export function canJoin(userId: string, members: string[], blocks: BlockPair[]): boolean {
  const blocked = blockChecker(blocks);
  return members.every((member) => !blocked(userId, member));
}

/**
 * Picks the members of a new group, or returns null when no group can form yet.
 *
 * People join in the order they arrived, skipping anyone who has a block with
 * someone already picked. Stance is only a soft preference: when a question's
 * group would be unanimous and someone with a different view is waiting, that
 * person replaces the newest member. It never holds a group back.
 */
export function formGroups(input: FormGroupsInput): string[] | null {
  const minSize = input.minSize ?? GROUP_MIN_SIZE;
  const maxSize = input.maxSize ?? GROUP_MAX_SIZE;
  const ordered = [...input.waiting].sort((a, b) => a.joinedAt - b.joinedAt);

  const picked: Waiter[] = [];
  for (const waiter of ordered) {
    if (picked.length === maxSize) break;
    if (canJoin(waiter.userId, picked.map((p) => p.userId), input.blocks)) picked.push(waiter);
  }
  if (picked.length < minSize) return null;

  if (input.topicKind === "question") diversifyStances(picked, ordered, input.blocks);
  return picked.map((waiter) => waiter.userId);
}

function diversifyStances(picked: Waiter[], ordered: Waiter[], blocks: BlockPair[]): void {
  const stances = new Set(picked.map((waiter) => waiter.stance).filter((stance) => stance !== null));
  if (stances.size !== 1) return;
  const [shared] = stances;

  const pickedIds = new Set(picked.map((waiter) => waiter.userId));
  const others = picked.slice(0, -1).map((waiter) => waiter.userId);
  const replacement = ordered.find(
    (waiter) =>
      !pickedIds.has(waiter.userId) &&
      waiter.stance !== null &&
      waiter.stance !== shared &&
      canJoin(waiter.userId, others, blocks),
  );
  if (replacement) picked[picked.length - 1] = replacement;
}
