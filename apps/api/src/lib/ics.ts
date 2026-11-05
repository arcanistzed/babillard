function escapeText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n");
}

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(event: { uid: string; startsAt: number; endsAt: number; summary: string; location: string; url: string }): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ideas Match//Meetups//EN",
    "BEGIN:VEVENT",
    `UID:${event.uid}@ideasmatch`,
    `DTSTAMP:${formatUtc(Date.now())}`,
    `DTSTART:${formatUtc(event.startsAt)}`,
    `DTEND:${formatUtc(event.endsAt)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `LOCATION:${escapeText(event.location)}`,
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
