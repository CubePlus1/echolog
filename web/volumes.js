// Calendar volume boundaries are intentionally local-time based: the Web UI
// groups records by the user's calendar, not by UTC date boundaries.
export function volumeKey(year, month, period = null) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  return period == null ? `month:${monthKey}` : `period:${monthKey}:${period}`;
}

export function currentPeriod(date = new Date()) {
  const day = date.getDate();
  return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
}

export function periodBounds(year, month, period) {
  const startDay = [1, 8, 15, 22][period - 1];
  const endDay = period === 4
    ? new Date(year, month, 1)
    : new Date(year, month - 1, startDay + 7);
  return {
    start: new Date(year, month - 1, startDay),
    end: endDay,
  };
}
