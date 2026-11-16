import { GROUP_AGE_SPREAD, GROUP_MAX_SIZE, GROUP_MIN_SIZE, GROUP_SIZE_RANGES, type GroupSize, type Stance } from "../constants";

export interface Waiter {
  userId: string;
  stance: Stance | null;
  joinedAt: number;
  /** Null or missing when unknown, which leaves the person out of the age preference. */
  age?: number | null;
  /** Missing means any size. */
  groupSize?: GroupSize;
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

/** The sizes a group of these people can be, from the size each one asked for. Empty when min is above max. */
export function sizeBounds(sizes: (GroupSize | undefined)[]): { min: number; max: number } {
  let min = GROUP_MIN_SIZE;
  let max = GROUP_MAX_SIZE;
  for (const size of sizes) {
    const [low, high] = GROUP_SIZE_RANGES[size ?? "any"];
    min = Math.max(min, low);
    max = Math.min(max, high);
  }
  return { min, max };
}

/** True when this many people, with these size choices, makes a group size everyone asked for. */
export function sizeSuits(sizes: (GroupSize | undefined)[], count: number): boolean {
  const { min, max } = sizeBounds(sizes);
  return min <= max && count >= min && count <= max;
}

/**
 * Picks the members of a new group, or returns null when no group can form yet.
 *
 * People join in the order they arrived, skipping anyone who has a block with
 * someone already picked, or whose size choice can't fit with theirs. If the
 * earliest arrivals' choices clash, it tries again with only the people who'd
 * take a small group, then only those who'd take a larger one. Stance is only a soft preference: when a question's
 * group would be unanimous and someone with a different view is waiting, that
 * person replaces the newest member. Age is a soft preference too: someone far
 * from the group's middle age is swapped for a closer-aged person who is waiting.
 * Neither ever holds a group back.
 */
export function formGroups(input: FormGroupsInput): string[] | null {
  const minSize = input.minSize ?? GROUP_MIN_SIZE;
  const maxSize = input.maxSize ?? GROUP_MAX_SIZE;
  const ordered = [...input.waiting].sort((a, b) => a.joinedAt - b.joinedAt);

  for (const target of [undefined, "small", "medium"] as const) {
    const candidates = target ? ordered.filter((waiter) => sizeSuits([waiter.groupSize, target], sizeBounds([waiter.groupSize, target]).min)) : ordered;
    const picked = pickInOrder(candidates, input.blocks, minSize, maxSize);
    if (!picked) continue;
    preferSimilarAges(picked, candidates, input.blocks);
    if (input.topicKind === "question") diversifyStances(picked, candidates, input.blocks);
    return picked.map((waiter) => waiter.userId);
  }
  return null;
}

function pickInOrder(ordered: Waiter[], blocks: BlockPair[], minSize: number, maxSize: number): Waiter[] | null {
  const picked: Waiter[] = [];
  for (const waiter of ordered) {
    const next = [...picked, waiter];
    const { min, max } = sizeBounds(next.map((p) => p.groupSize));
    if (min > max || next.length > Math.min(max, maxSize)) continue;
    if (canJoin(waiter.userId, picked.map((p) => p.userId), blocks)) picked.push(waiter);
  }
  const { min } = sizeBounds(picked.map((p) => p.groupSize));
  return picked.length >= Math.max(minSize, min) ? picked : null;
}

/** True when swapping `replacement` in for picked[index] keeps everyone's size choice satisfied. */
function swapKeepsSize(picked: Waiter[], index: number, replacement: Waiter): boolean {
  const sizes = picked.map((waiter, i) => (i === index ? replacement.groupSize : waiter.groupSize));
  return sizeSuits(sizes, picked.length);
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
      canJoin(waiter.userId, others, blocks) &&
      swapKeepsSize(picked, picked.length - 1, waiter),
  );
  if (replacement) picked[picked.length - 1] = replacement;
}

function middleAge(waiters: Waiter[]): number | null {
  const ages = waiters.map((waiter) => waiter.age).filter((age): age is number => age != null).sort((a, b) => a - b);
  if (ages.length === 0) return null;
  const mid = Math.floor(ages.length / 2);
  return ages.length % 2 ? ages[mid]! : (ages[mid - 1]! + ages[mid]!) / 2;
}

/** Swaps the member furthest from the group's middle age for a waiting person within the spread, one at a time. */
function preferSimilarAges(picked: Waiter[], ordered: Waiter[], blocks: BlockPair[]): void {
  for (let round = 0; round < picked.length; round++) {
    const middle = middleAge(picked);
    if (middle === null) return;
    const distance = (waiter: Waiter) => (waiter.age == null ? 0 : Math.abs(waiter.age - middle));
    const outlierIndex = picked.reduce((worst, waiter, index) => (distance(waiter) > distance(picked[worst]!) ? index : worst), 0);
    if (distance(picked[outlierIndex]!) <= GROUP_AGE_SPREAD) return;

    const pickedIds = new Set(picked.map((waiter) => waiter.userId));
    const others = picked.filter((_, index) => index !== outlierIndex).map((waiter) => waiter.userId);
    const replacement = ordered.find(
      (waiter) =>
        !pickedIds.has(waiter.userId) &&
        waiter.age != null &&
        distance(waiter) <= GROUP_AGE_SPREAD &&
        canJoin(waiter.userId, others, blocks) &&
        swapKeepsSize(picked, outlierIndex, waiter),
    );
    if (!replacement) return;
    picked[outlierIndex] = replacement;
  }
}
