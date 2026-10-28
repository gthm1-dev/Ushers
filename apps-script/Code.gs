// River Teams Ushers — Self-Scheduling (Google Apps Script web app)
// Bound to the Google Sheet that stores sign-ups. See README.md for setup.

const TZ = 'America/New_York';
const SCHEDULE_WINDOW_DAYS = 45; // "a month and a half"

// ---- Service times ------------------------------------------------------
// TODO: confirm actual start times with the Ushers leadership.
const TIMES = {
  AM: { label: 'AM', time: '10:00 AM' },
  PM: { label: 'PM', time: '7:00 PM' },
  WED: { label: 'Wed PM', time: '7:00 PM' },
};

// ---- Annual conferences: last full Sunday-to-Sunday week of the month ----
// The week runs from the second-to-last Sunday through the last Sunday of the
// month (8 days, AM + PM = 16 services). Override a year in CONFERENCE_OVERRIDES.
// `needed` = ushers needed per session: a number, or { AM: n, PM: n }.
const ANNUAL_CONFERENCES = [
  { month: 1, name: 'Prayer Conference – Winter Camp-Meeting', needed: 50 },
  { month: 5, name: 'Spring Ministers & Leaders Conference', needed: 50 },
  { month: 7, name: 'Summer Camp Meeting – 3 in 1 Family Fire Conference', needed: 50 },
  { month: 10, name: 'Fall Ministers & Leaders Conference – Faith Conference', needed: 50 },
];

// { '2027-01': { start: '2027-01-24', end: '2027-01-31' } } — only if the
// computed week is wrong for a given year.
const CONFERENCE_OVERRIDES = {};

// ---- Explicitly dated services --------------------------------------------
// These replace the regular / conference services on that date.
const WOMENS_2027 = "Covenant Women's Conference 2027", MENS_2027 = "Men's Conference 2027";
const CONF_NEEDED = { AM: 40, PM: 50 };
const SPECIAL_SERVICES = [
  { date: '2026-12-20', sessions: ['AM', 'PM'], name: 'Christmas Sunday', needed: 30 },
  { date: '2026-12-24', sessions: ['PM'], name: 'Christmas Eve Service', needed: 30 },
  { date: '2026-12-31', sessions: ['PM'], name: "New Year's Eve Service", needed: 30 },

  { date: '2027-03-31', sessions: ['PM'], name: WOMENS_2027, needed: CONF_NEEDED },
  { date: '2027-04-01', sessions: ['AM', 'PM'], name: WOMENS_2027, needed: CONF_NEEDED },
  { date: '2027-04-02', sessions: ['AM', 'PM'], name: WOMENS_2027, needed: CONF_NEEDED },
  { date: '2027-04-03', sessions: ['AM'], name: WOMENS_2027, needed: CONF_NEEDED },

  { date: '2027-09-01', sessions: ['PM'], name: MENS_2027, needed: CONF_NEEDED },
  { date: '2027-09-02', sessions: ['AM', 'PM'], name: MENS_2027, needed: CONF_NEEDED },
  { date: '2027-09-03', sessions: ['AM', 'PM'], name: MENS_2027, needed: CONF_NEEDED },
  { date: '2027-09-04', sessions: ['PM'], name: MENS_2027, needed: CONF_NEEDED },
];

// Ushers needed at regular Sunday AM / Sunday PM / Wednesday PM services.
// null = no limit (the page just shows how many have signed up).
const REGULAR_NEEDED = { AM: null, PM: null, WED: null };

// ---- Sheet layout ---------------------------------------------------------
const SIGNUPS = 'Signups';
const SCHEDULE = 'Schedule';
const COVERAGE = 'Coverage';
const HEADERS = ['Timestamp', 'Service Date', 'Day', 'Session', 'Time', 'Service', 'Type',
  'Name', 'Email', 'Phone', 'Key', 'Status'];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));
const SCHEDULED = 'Scheduled', CANCELLED = 'Cancelled';

// ===========================================================================
// Web app entry point
// ===========================================================================
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.code = (e && e.parameter && e.parameter.code) || '';
  return t.evaluate()
    .setTitle('River Teams Ushers — Sign Up')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Services in the window, plus which ones this email is already on. */
function getServices(email, code) {
  checkCode_(code);
  email = normEmail_(email);
  const services = buildCalendar_();
  const rows = readRows_();
  const counts = {}, mine = new Set();
  for (const r of rows) {
    if (r[COL.Status] !== SCHEDULED) continue;
    const key = String(r[COL.Key]);
    counts[key] = (counts[key] || 0) + 1;
    if (normEmail_(r[COL.Email]) === email) mine.add(key);
  }
  return {
    services: services.map((s) => Object.assign({}, s, { scheduled: mine.has(s.key), count: counts[s.key] || 0 })),
  };
}

/** Adds and/or removes this usher on the given service keys. */
function saveSignup(form) {
  checkCode_(form.code);
  const name = String(form.name || '').trim();
  const email = normEmail_(form.email);
  const phone = String(form.phone || '').trim();
  if (!name) throw new Error('Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');

  const byKey = new Map(buildCalendar_().map((s) => [s.key, s]));
  const add = (form.add || []).filter((k) => byKey.has(k));
  const remove = new Set((form.remove || []).filter((k) => byKey.has(k)));
  if (!add.length && !remove.size) throw new Error('Pick at least one service.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ensureSheets_();
    const rows = readRows_();
    const now = new Date();
    // row index (in sheet) of this usher's existing entry per key
    const existing = new Map(), counts = {};
    rows.forEach((r, i) => {
      if (r[COL.Status] === SCHEDULED) counts[r[COL.Key]] = (counts[r[COL.Key]] || 0) + 1;
      if (normEmail_(r[COL.Email]) === email) existing.set(String(r[COL.Key]), { row: i + 2, status: r[COL.Status] });
    });

    const added = [], already = [], removed = [], full = [], append = [];
    for (const key of add) {
      const s = byKey.get(key), ex = existing.get(key);
      if (ex && ex.status === SCHEDULED) { already.push(key); continue; }
      if (s.needed && (counts[key] || 0) >= s.needed) { full.push(key); continue; }
      counts[key] = (counts[key] || 0) + 1;
      const values = rowFor_(s, now, name, email, phone);
      if (ex) sheet.getRange(ex.row, 1, 1, HEADERS.length).setValues([values]);
      else append.push(values);
      added.push(key);
    }
    for (const key of remove) {
      const ex = existing.get(key);
      if (!ex || ex.status !== SCHEDULED) continue;
      sheet.getRange(ex.row, COL.Timestamp + 1).setValue(now);
      sheet.getRange(ex.row, COL.Status + 1).setValue(CANCELLED);
      removed.push(key);
    }
    if (append.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, append.length, HEADERS.length).setValues(append);
    }
    return { added, already, removed, full };
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor (or let the first sign-up do it) to create the tabs. */
function setup() {
  ensureSheets_();
}

// ===========================================================================
// Sheet helpers
// ===========================================================================
function ensureSheets_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SIGNUPS);
  if (!sheet) {
    sheet = ss.insertSheet(SIGNUPS);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('m/d/yyyy h:mm am/pm');
    sheet.getRange('B:B').setNumberFormat('ddd, mmm d, yyyy');
    sheet.getRange('C:L').setNumberFormat('@'); // keep times / phones as typed
    sheet.getRange('A1:L1').setNumberFormat('@');
  }
  if (!ss.getSheetByName(SCHEDULE)) {
    const view = ss.insertSheet(SCHEDULE);
    view.getRange('A1').setFormula(
      `=QUERY(${SIGNUPS}!A:L, "select B, C, D, E, F, H, J, I where L = '${SCHEDULED}' order by B, D, H", 1)`);
    view.getRange('A:A').setNumberFormat('ddd, mmm d, yyyy');
    view.setFrozenRows(1);
  }
  if (!ss.getSheetByName(COVERAGE)) {
    const view = ss.insertSheet(COVERAGE);
    view.getRange('A1').setFormula(
      `=QUERY(${SIGNUPS}!A:L, "select B, D, F, count(H) where L = '${SCHEDULED}' group by B, D, F order by B, D label count(H) 'Ushers Scheduled'", 1)`);
    view.getRange('A:A').setNumberFormat('ddd, mmm d, yyyy');
    view.setFrozenRows(1);
  }
  return sheet;
}

function readRows_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SIGNUPS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
}

function rowFor_(s, now, name, email, phone) {
  // Service Date is written as yyyy-mm-dd so Sheets stores a real date (no time-zone shift).
  return [now, s.date, s.weekday, s.session, s.time, s.name, s.kindLabel, name, email, phone, s.key, SCHEDULED];
}

function checkCode_(code) {
  const required = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (required && String(code || '').trim() !== required) throw new Error('ACCESS_CODE: Access code is incorrect.');
}

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }

// ===========================================================================
// Calendar
// ===========================================================================
const pad_ = (n) => String(n).padStart(2, '0');
const ymd_ = (d) => `${d.getUTCFullYear()}-${pad_(d.getUTCMonth() + 1)}-${pad_(d.getUTCDate())}`;
const fromYmd_ = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays_ = (d, n) => new Date(d.getTime() + n * 86400000);
const todayInTZ_ = () => fromYmd_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));

function conferenceWeek_(year, month) {
  const o = CONFERENCE_OVERRIDES[`${year}-${pad_(month)}`];
  if (o) return { start: fromYmd_(o.start), end: fromYmd_(o.end) };
  const last = new Date(Date.UTC(year, month, 0)); // last day of month
  const end = addDays_(last, -last.getUTCDay()); // last Sunday
  return { start: addDays_(end, -7), end };
}

function makeService_(dateStr, sessionKey, name, kind, needed) {
  const t = TIMES[sessionKey];
  if (needed && typeof needed === 'object') needed = needed[sessionKey === 'WED' ? 'PM' : sessionKey];
  return {
    key: `${dateStr}_${sessionKey}`,
    date: dateStr,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][fromYmd_(dateStr).getUTCDay()],
    session: t.label,
    time: t.time,
    name,
    kind, // 'regular' | 'conference' | 'special'
    kindLabel: { regular: 'Regular', conference: 'Conference', special: 'Special' }[kind],
    needed: needed || null,
  };
}

/** Schedulable services from today through today + window. */
function buildCalendar_(from, days) {
  from = from || todayInTZ_();
  const to = addDays_(from, days || SCHEDULE_WINDOW_DAYS);
  const byDate = new Map();

  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    for (const c of ANNUAL_CONFERENCES) {
      const { start, end } = conferenceWeek_(y, c.month);
      for (let d = start; d <= end; d = addDays_(d, 1)) {
        const ds = ymd_(d);
        byDate.set(ds, ['AM', 'PM'].map((s) => makeService_(ds, s, c.name, 'conference', c.needed)));
      }
    }
  }
  for (const s of SPECIAL_SERVICES) {
    byDate.set(s.date, s.sessions.map((sess) => makeService_(s.date, sess, s.name, 'special', s.needed)));
  }
  for (let d = from; d <= to; d = addDays_(d, 1)) {
    const ds = ymd_(d);
    if (byDate.has(ds)) continue;
    const dow = d.getUTCDay();
    if (dow === 0) byDate.set(ds, [makeService_(ds, 'AM', 'Sunday AM Service', 'regular', REGULAR_NEEDED.AM), makeService_(ds, 'PM', 'Sunday PM Service', 'regular', REGULAR_NEEDED.PM)]);
    if (dow === 3) byDate.set(ds, [makeService_(ds, 'WED', 'Wednesday PM Service', 'regular', REGULAR_NEEDED.WED)]);
  }

  const fromS = ymd_(from), toS = ymd_(to);
  return [...byDate.entries()]
    .filter(([ds]) => ds >= fromS && ds <= toS)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([, list]) => list);
}
