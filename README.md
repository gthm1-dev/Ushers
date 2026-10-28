# River Teams Ushers — Self-Scheduling

River at Tampa Bay Church · River Teams Ushers · Ministry of Helps Department

A mobile-friendly link ushers open from Signal. They pick the services they can
serve (today → 45 days out), and each sign-up is saved as a row in a Google Sheet
in your Google Drive. Ushers can come back with the same email to see what they're
on, add more, or remove themselves.

Everything runs inside Google (Google Sheets + Apps Script). No other hosting,
accounts or passwords are needed.

```
apps-script/Code.gs          server code: calendar rules + saving to the sheet
apps-script/Index.html       the sign-up page ushers see
apps-script/appsscript.json  project settings (Eastern time zone, public web app)
```

## Setup (about 10 minutes, on a computer)

1. **Create the spreadsheet.** Go to https://sheets.new while signed in to the
   Google account that should own the data. Name it e.g. *River Teams Ushers Schedule*.
2. **Open the script editor.** In the sheet: **Extensions → Apps Script**.
3. **Add the code.**
   - In the editor, `Code.gs` is already there. Replace everything in it with the
     contents of `apps-script/Code.gs`.
   - Click **+** next to *Files* → **HTML**, name it `Index` (exactly), and replace its
     contents with `apps-script/Index.html`.
   - Click the ⚙️ **Project Settings** gear, set *Time zone* to
     **(GMT-05:00) Eastern Time - New York**.
   - Click 💾 **Save**.
4. **Create the tabs.** At the top of the editor pick the function **`setup`** and
   click **Run**. Google will ask you to authorize the script — choose your account,
   then *Advanced → Go to (project name) → Allow*. (It only needs access to this
   spreadsheet.) Two tabs appear in the sheet: **Signups** and **Schedule**.
5. **Publish the link.** **Deploy → New deployment** → gear ⚙️ → **Web app**.
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
6. **Post the URL in the Signal group.** That's the link ushers tap. They don't need
   a Google account.

### Optional: team access code (recommended — the link is public)

In the Apps Script editor: ⚙️ **Project Settings → Script Properties → Add script
property**: `ACCESS_CODE` = your code (e.g. `river2026`). Then post the link as
`https://script.google.com/macros/s/…/exec?code=river2026` so ushers never type it.
Anyone opening the plain link without the code will be asked for it.

## The spreadsheet

- **Signups** — one row per usher per service: timestamp, service date, day,
  session (AM / PM / Wed PM), time, service name, type (Regular / Conference /
  Special), name, email, phone, key, and status. When an usher removes themselves
  the status changes to **Cancelled** (the row is kept for your records).
- **Schedule** — a live view of everyone *Scheduled*, sorted by date and session.
- **Coverage** — how many ushers are scheduled for each service.
  Use the filter (**Data → Create a filter**) to see a single day.

Don't rename the tabs or reorder the Signups columns — the script relies on them.
You can add extra tabs, colours, or share the sheet with other leaders freely.

## Editing the calendar (top of `Code.gs`)

- **Service times** — `TIMES` (10:00 AM / 7:00 PM are placeholders — set the real ones).
- **Annual conferences** — computed as the last Sunday→Sunday week of Jan / May /
  Jul / Oct (8 days, AM + PM). If a year's dates differ, add it to
  `CONFERENCE_OVERRIDES`, e.g. `'2027-10': { start: '2027-10-24', end: '2027-10-31' }`.
- **Dated services** — `SPECIAL_SERVICES` holds Dec 20/24/31 2026, Covenant Women's
  Conference 2027 and Men's Conference 2027. Add future dates there.
- **How far ahead** — `SCHEDULE_WINDOW_DAYS = 45`.
- **Ushers needed** — `needed` on each conference / special service (a number, or
  `{ AM: 40, PM: 50 }`), and `REGULAR_NEEDED` for regular services (`null` = no
  limit). The page shows "38 ushers still needed"; once a service is full
  it shows **Full** and takes no more sign-ups.

On conference / special dates the regular Sunday AM, Sunday PM and Wednesday PM
services are replaced by those sessions.

**After any code change**, publish it to the same link: **Deploy → Manage
deployments → ✏️ Edit → Version: New version → Deploy**. (A *New deployment*
would create a different URL.)
