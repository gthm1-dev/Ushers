# River Teams Ushers — Self-Scheduling App

A mobile-friendly link ushers open from Signal, pick the services they can serve
(today → 6 weeks out), and get placed directly on the Planning Center schedule.

```
public/index.html                  the sign-up page
netlify/functions/pco.js           Planning Center bridge (runs server-side, holds the token)
netlify/functions/lib/calendar.js  which services exist on which dates
netlify.toml · package.json
```

## 1. Planning Center setup (one time)

1. **Service Type** — note the ID from the URL when you open it in Services
   (`.../service_types/123456/...`). All usher plans live here.
2. **Team** — "River Teams Ushers" inside that Service Type. Note its ID
   (`.../teams/789012`). Add every usher as a member with at least one position.
3. **Position** — the position the app schedules people into. Default name is
   `Usher`; change `PCO_POSITION_NAME` if yours differs. Every usher must be
   assigned to that position.
4. **Personal Access Token** — go to https://api.planningcenteronline.com,
   *Personal Access Tokens* → *Create one now*. Copy the **Application ID** and
   **Secret**. Create it from an account with Services *Editor* (or higher)
   rights and People *Viewer* rights.

## 2. Deploy to Netlify

1. Push this folder to GitHub (or drag-drop in Netlify).
2. Site settings → **Environment variables**:

   | Variable | Value |
   |---|---|
   | `PCO_APP_ID` | from the token |
   | `PCO_SECRET` | from the token |
   | `PCO_SERVICE_TYPE_ID` | e.g. `123456` |
   | `PCO_TEAM_ID` | e.g. `789012` |
   | `PCO_POSITION_NAME` | optional, default `Usher` |
   | `PCO_PLAN_STATUS` | optional — `C` confirms immediately (default); `U` sends a request they must accept |
   | `ACCESS_CODE` | optional shared code ushers type in (recommended since the link is public) |

3. Deploy. Your link is `https://<site>.netlify.app` — post that in the Signal group.
   (Rename the site or add a custom domain like `ushers.revival.com` if you like.)
   If you set `ACCESS_CODE`, post `https://<site>.netlify.app/?code=YOURCODE` so
   ushers never have to type it. The page remembers their email on their phone.

> **Never put your Planning Center username/password in this app or in Netlify.**
> The app only uses the Personal Access Token above, which you can revoke at any time.

## 3. How it works

- Usher enters the email Planning Center has for them. The function checks they
  are on the Ushers team; anyone else gets a friendly "not found" message.
- The function builds the service list from `calendar.js`, matches each one to an
  existing PCO plan by **local date + AM/PM**, and shows what they're already on.
- On submit, for each selected service it **finds or creates** the plan (with a
  service time), then adds the person as a confirmed `PlanPerson`. Duplicates are
  skipped.

## 4. Editing the calendar (`lib/calendar.js`)

- **Service times** — `TIMES` at the top. AM 10:00–12:30, PM 7:00–9:00 are
  placeholders; set the real times.
- **Annual conferences** — computed as the last full Sunday→Sunday week of
  Jan / May / Jul / Oct (8 days, AM + PM). If a year's dates differ, add an entry
  to `CONFERENCE_OVERRIDES`, e.g. `'2027-10': { start: '2027-10-24', end: '2027-10-31' }`.
- **Dated services** — `SPECIAL_SERVICES` holds Dec 20/24/31 2026, Women's
  Conference 2027 and Men's Conference 2027. Add future years there.
- **Window** — `SCHEDULE_WINDOW_DAYS = 45`.

On conference / special dates the regular Sun AM, Sun PM and Wed PM services are
replaced by the conference sessions.

## 5. Things to confirm before going live

- **One plan per service.** The app matches PCO plans by date + AM/PM (anything
  starting before 2 PM counts as AM). If your Sunday is one plan with both AM and
  PM service times, the PM signup will create a separate plan — either split
  Sunday into AM and PM plans (or service types), or adjust `loadPlans`.
- **Service times** in `calendar.js` (`TIMES`).
- **Position name** matches what ushers are assigned to in the team.
- Do a test signup with your own email, then check the plan in Services.

## Local test

```
npm i -g netlify-cli
netlify dev     # http://localhost:8888 — uses a .env file for the variables
```
