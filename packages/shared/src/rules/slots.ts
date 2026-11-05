export interface MeetupSlot {
  label: string;
  startsAt: number;
  endsAt: number;
}

const SLOT_MS = 2 * 60 * 60 * 1000;
const WINDOWS = [
  { label: "lunch", hour: 12 },
  { label: "evening", hour: 18 },
];
const WEEKEND_WINDOWS = [
  { label: "morning", hour: 10 },
  { label: "afternoon", hour: 14 },
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LOOKAHEAD_DAYS = 8;

function at(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
}

/**
 * Ready-made times, so proposing a meetup takes one tap instead of a date
 * picker. Uses the device's local time, skips anything less than an hour away,
 * and always reaches the coming weekend.
 */
export function suggestMeetupSlots(now: Date = new Date(), count = 6): MeetupSlot[] {
  const earliest = now.getTime() + 60 * 60 * 1000;
  const slots: MeetupSlot[] = [];

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const weekday = day.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const name = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : DAY_NAMES[weekday];

    for (const window of isWeekend ? WEEKEND_WINDOWS : WINDOWS) {
      const start = at(day, window.hour).getTime();
      if (start < earliest) continue;
      slots.push({ label: `${name} ${window.label}`, startsAt: start, endsAt: start + SLOT_MS });
    }
  }

  const soonest = slots.slice(0, Math.max(count - 2, 1));
  const weekend = slots.filter((slot) => {
    const weekday = new Date(slot.startsAt).getDay();
    return (weekday === 0 || weekday === 6) && !soonest.includes(slot);
  });
  return [...soonest, ...weekend.slice(0, count - soonest.length)].sort((a, b) => a.startsAt - b.startsAt);
}
