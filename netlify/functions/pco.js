// Netlify Function: /.netlify/functions/pco
// Bridges the usher signup page to Planning Center Services.
//
// GET  ?email=...            -> services in window + which ones this usher is already on
// POST { email, keys: [...] } -> schedules the usher on each selected service
//
// Required env vars (Netlify → Site settings → Environment variables):
//   PCO_APP_ID, PCO_SECRET        Personal Access Token from api.planningcenteronline.com
//   PCO_SERVICE_TYPE_ID           Service Type that holds the usher plans
//   PCO_TEAM_ID                   "River Teams Ushers" team id
// Optional:
//   PCO_POSITION_NAME             team position to schedule into (default "Usher")
//   PCO_PLAN_STATUS               "C" = confirmed (default) or "U" = sends a request they must accept
//   ACCESS_CODE                   shared code ushers must enter (defaults to none)

import { buildCalendar, TZ } from './lib/calendar.js';

const API = 'https://api.planningcenteronline.com';
const env = (k, d) => process.env[k] ?? d;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// ---- PCO client ----------------------------------------------------------
function auth() {
  return 'Basic ' + Buffer.from(`${env('PCO_APP_ID')}:${env('PCO_SECRET')}`).toString('base64');
}

async function pco(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: auth(), 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.map((e) => e.detail || e.title).join('; ') || res.statusText;
    throw new Error(`PCO ${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

async function pcoAll(path) {
  const out = [];
  let next = path + (path.includes('?') ? '&' : '?') + 'per_page=100';
  while (next) {
    const page = await pco(next.replace(API, ''));
    out.push(...page.data);
    next = page.links?.next || null;
  }
  return out;
}

// ---- identity ------------------------------------------------------------
async function findUsher(email) {
  const e = email.trim().toLowerCase();
  const team = env('PCO_TEAM_ID');
  // Services people who are on the ushers team
  const members = await pcoAll(`/services/v2/teams/${team}/people`);
  // Match by email via People API (ids are shared across PCO apps)
  const people = await pco(`/people/v2/people?where[search_name_or_email]=${encodeURIComponent(e)}&per_page=25`);
  const ids = new Set(people.data.map((p) => p.id));
  const match = members.find((m) => ids.has(m.id));
  if (!match) return null;
  return { id: match.id, name: match.attributes.full_name || `${match.attributes.first_name} ${match.attributes.last_name}` };
}

// ---- plans ----------------------------------------------------------------
const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const localHour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date(iso))) % 24;

/** Map service.key -> existing PCO plan (matched on local date + AM/PM). */
async function loadPlans(services) {
  const st = env('PCO_SERVICE_TYPE_ID');
  const first = services[0]?.date, last = services[services.length - 1]?.date;
  if (!first) return new Map();
  const plans = await pcoAll(`/services/v2/service_types/${st}/plans?filter=after,before&after=${first}&before=${last}T23:59:59Z&include=plan_times`);
  const byKey = new Map();
  for (const plan of plans) {
    const times = (plan.relationships?.plan_times?.data || []).map((t) => t.id);
    const sort = plan.attributes.sort_date;
    if (!sort) continue;
    // Use sort_date's local date + hour to decide AM / PM
    const date = localDate(sort);
    const am = localHour(sort) < 14;
    for (const s of services) {
      if (s.date === date && (s.session === 'AM') === am) byKey.set(s.key, plan);
    }
  }
  return byKey;
}

async function ensurePlan(service) {
  const st = env('PCO_SERVICE_TYPE_ID');
  const created = await pco(`/services/v2/service_types/${st}/plans`, {
    method: 'POST',
    body: { data: { type: 'Plan', attributes: { title: `${service.name} (${service.session})`, public: false } } },
  });
  const plan = created.data;
  await pco(`/services/v2/service_types/${st}/plans/${plan.id}/plan_times`, {
    method: 'POST',
    body: { data: { type: 'PlanTime', attributes: { starts_at: service.startsAt, ends_at: service.endsAt, time_type: 'service', name: service.session } } },
  });
  return plan;
}

async function usherAssignments(planId, personId) {
  const st = env('PCO_SERVICE_TYPE_ID');
  const members = await pcoAll(`/services/v2/service_types/${st}/plans/${planId}/team_members?where[team_id]=${env('PCO_TEAM_ID')}`);
  const mine = members.find((m) => m.relationships?.person?.data?.id === personId);
  return { count: members.filter((m) => m.attributes.status !== 'D').length, mine };
}

async function schedule(planId, personId) {
  const st = env('PCO_SERVICE_TYPE_ID');
  return pco(`/services/v2/service_types/${st}/plans/${planId}/team_members`, {
    method: 'POST',
    body: {
      data: {
        type: 'PlanPerson',
        attributes: {
          person_id: personId,
          team_id: env('PCO_TEAM_ID'),
          team_position_name: env('PCO_POSITION_NAME', 'Usher'),
          status: env('PCO_PLAN_STATUS', 'C'),
        },
      },
    },
  });
}

// ---- handler ---------------------------------------------------------------
export default async (req) => {
  try {
    if (!env('PCO_APP_ID') || !env('PCO_SECRET') || !env('PCO_SERVICE_TYPE_ID') || !env('PCO_TEAM_ID')) {
      return json(500, { error: 'Server is missing Planning Center configuration.' });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const email = url.searchParams.get('email') || '';
      const code = url.searchParams.get('code') || '';
      if (env('ACCESS_CODE') && code !== env('ACCESS_CODE')) return json(403, { error: 'Access code is incorrect.' });
      if (!email) return json(400, { error: 'Email is required.' });

      const usher = await findUsher(email);
      if (!usher) return json(404, { error: 'We could not find you on the Ushers team. Please use the email Planning Center has on file, or contact your team leader.' });

      const services = buildCalendar();
      const plans = await loadPlans(services);
      const results = await Promise.all(services.map(async (s) => {
        const plan = plans.get(s.key);
        if (!plan) return { ...s, scheduled: false, count: 0 };
        const { count, mine } = await usherAssignments(plan.id, usher.id);
        return { ...s, scheduled: !!mine && mine.attributes.status !== 'D', count };
      }));
      return json(200, { usher, services: results });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      if (env('ACCESS_CODE') && body.code !== env('ACCESS_CODE')) return json(403, { error: 'Access code is incorrect.' });
      const usher = await findUsher(body.email || '');
      if (!usher) return json(404, { error: 'We could not find you on the Ushers team.' });

      const wanted = new Set(body.keys || []);
      const services = buildCalendar().filter((s) => wanted.has(s.key));
      if (!services.length) return json(400, { error: 'Pick at least one service.' });

      const plans = await loadPlans(services);
      const done = [], skipped = [];
      for (const s of services) {
        let plan = plans.get(s.key);
        if (!plan) plan = await ensurePlan(s);
        const { mine } = await usherAssignments(plan.id, usher.id);
        if (mine && mine.attributes.status !== 'D') { skipped.push(s.key); continue; }
        await schedule(plan.id, usher.id);
        done.push(s.key);
      }
      return json(200, { usher, done, skipped });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};

export const config = { path: '/api/pco' };
