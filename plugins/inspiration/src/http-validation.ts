const OFFSET_AWARE_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Parse an ISO 8601 timestamp only when its timezone is explicit.
 *
 * This intentionally does not use a host-local fallback: callers must provide
 * either `Z` or a numeric `±HH:mm` offset. Calendar and offset components are
 * checked before constructing the Date so values such as February 30 or
 * `+24:00` cannot be normalized into a different instant.
 */
export function parseOffsetAwareIso(value: string): Date | null {
  const match = OFFSET_AWARE_ISO_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);

  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function isOffsetAwareIso(value: unknown): value is string {
  return typeof value === "string" && parseOffsetAwareIso(value) !== null;
}
