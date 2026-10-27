// Service calendar for River Teams Ushers (Ministry of Helps)
// Single source of truth for which services can be self-scheduled.
// All dates are interpreted in America/New_York.

const TZ = 'America/New_York';

// ---- Service times (24h, local) --------------------------------------
// TODO: confirm actual start/end times with the Ushers leadership.
const TIMES = {
  AM: { start: [10, 0], end: [12, 30], label: 'AM' },
  PM: { start: [19, 0], end: [21, 0], label: 'PM' },
  WED: { start: [19, 0], end: [21, 0], label: 'Wed PM' },
};

// ---- Annual conferences: last full Sunday-to-Sunday week of the month --
// Interpretation: the week runs from the second-to-last Sunday through the
// last Sunday of the month (8 days, AM + PM = 16 services).
// To override a year, add an explicit entry to CONFERENCE_OVERRIDES below.
const ANNUAL_CONFERENCES = [
  { month: 1, name: 'Prayer Conference – Winter Camp-Meeting' },
  { month: 5, name: 'Spring Ministers & Leaders Conference' },
  { month: 7, name: 'Summer Camp Meeting – 3 in 1 Family Fire Conference' },
  { month: 10, name: 'Fall Ministers & Leaders Conference – Faith Conference' },
];

// { '2027-01': { start: '2027-01-24', end: '2027-01-31' } } — only if the
// computed week is wrong for a given year.
const CONFERENCE_OVERRIDES = {};

// ---- Explicitly dated services ----------------------------------------
// Each entry: date (YYYY-MM-DD), sessions ['AM','PM'], name.
const SPECIAL_SERVICES = [
  { date: '2026-12-20', sessions: ['AM', 'PM'], name: 'Christmas Sunday' },
  { date: '2026-12-24', sessions: ['PM'], name: 'Christmas Eve Service' },
  { date: '2026-12-31', sessions: ['PM'], name: "New Year's Eve Service" },

  { date: '2027-03-31', sessions: ['PM'], name: "Covenant Women's Conference 2027" },
  { date: '2027-04-01', sessions: ['AM', 'PM'], name: "Covenant Women's Conference 2027" },
  { date: '2027-04-02', sessions: ['AM', 'PM'], name: "Covenant Women's Conference 2027" },
  { date: '2027-04-03', sessions: ['AM'], name: "Covenant Women's Conference 2027" },

  { date: '2027-09-01', sessions: ['PM'], name: "Men's Conference 2027" },
  { date: '2027-09-02', sessions: ['AM', 'PM'], name: "Men's Conference 2027" },
  { date: '2027-09-03', sessions: ['AM', 'PM'], name: "Men's Conference 2027" },
  { date: '2027-09-04', sessions: ['PM'], name: "Men's Conference 2027" },
];

const SCHEDULE_WINDOW_DAYS = 45; // "a month and a half"

// ---- helpers ------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function todayInTZ() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return fromYmd(`${get('year')}-${get('month')}-${get('day')}`);
}

function lastSundayOfMonth(year, month /* 1-12 */) {
  const last = new Date(Date.UTC(year, month, 0)); // last day of month
  return addDays(last, -last.getUTCDay());
}

function conferenceWeek(year, month) {
  const key = `${year}-${pad(month)}`;
  if (CONFERENCE_OVERRIDES[key]) {
    return { start: fromYmd(CONFERENCE_OVERRIDES[key].start), end: fromYmd(CONFERENCE_OVERRIDES[key].end) };
  }
  const end = lastSundayOfMonth(year, month);
  return { start: addDays(end, -7), end };
}

// Convert a local (America/New_York) wall-clock time to an ISO UTC string.
function localToISO(dateStr, [hh, mm]) {
  const guess = new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  const offset = asLocal - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

function makeService(dateStr, sessionKey, name, kind) {
  const t = TIMES[sessionKey];
  const d = fromYmd(dateStr);
  return {
    key: `${dateStr}_${sessionKey}`,
    date: dateStr,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()],
    session: t.label,
    name,
    kind, // 'regular' | 'conference' | 'special'
    startsAt: localToISO(dateStr, t.start),
    endsAt: localToISO(dateStr, t.end),
    startLabel: `${((t.start[0] + 11) % 12) + 1}:${pad(t.start[1])} ${t.start[0] < 12 ? 'AM' : 'PM'}`,
  };
}

/** Returns the schedulable services from today through today + window. */
function buildCalendar({ from = todayInTZ(), days = SCHEDULE_WINDOW_DAYS } = {}) {
  const to = addDays(from, days);
  const byDate = new Map(); // date -> services[] (conference/special replace regular)

  // 1. Conference weeks that touch the window
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    for (const c of ANNUAL_CONFERENCES) {
      const { start, end } = conferenceWeek(y, c.month);
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const ds = ymd(d);
        byDate.set(ds, ['AM', 'PM'].map((s) => makeService(ds, s, c.name, 'conference')));
      }
    }
  }

  // 2. Explicitly dated services (override conference/regular for that date)
  for (const s of SPECIAL_SERVICES) {
    byDate.set(s.date, s.sessions.map((sess) => makeService(s.date, sess, s.name, 'special')));
  }

  // 3. Regular services where nothing else is scheduled
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ds = ymd(d);
    if (byDate.has(ds)) continue;
    const dow = d.getUTCDay();
    if (dow === 0) byDate.set(ds, [makeService(ds, 'AM', 'Sunday AM Service', 'regular'), makeService(ds, 'PM', 'Sunday PM Service', 'regular')]);
    if (dow === 3) byDate.set(ds, [makeService(ds, 'WED', 'Wednesday PM Service', 'regular')]);
  }

  const fromS = ymd(from), toS = ymd(to);
  return [...byDate.entries()]
    .filter(([ds]) => ds >= fromS && ds <= toS)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([, list]) => list);
}

export { buildCalendar, todayInTZ, SCHEDULE_WINDOW_DAYS, TZ };
