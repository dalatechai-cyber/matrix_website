'use strict';

/**
 * Setup check for connecting a branch's calendars — PREVIEW DEPLOYMENTS ONLY
 * (and local runs). On Production every route here answers 404.
 *
 *   GET /api/setup/check
 *     The service account every stylist calendar must be shared with
 *     («Make changes to events»), each hairdresser's calendar variable and
 *     whether the site can read that calendar, and each branch's readiness.
 *
 *   GET /api/setup/prove?stylist=Saraa[&date=YYYY-MM-DD]
 *     Парк Од hairdressers only. Proves, on the real calendar, the path a
 *     booking takes: reads the hairdresser's free times, writes one marked
 *     test event into the calendar her variable names, reads it back there,
 *     checks the free times now leave that hour out, and deletes the event
 *     (always, even when a step fails). Яармаг's live calendars are only ever
 *     read here.
 *
 * Nothing here takes payment or touches QPay.
 */

const express = require('express');
const http = require('http');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG, teamOf } = require('../config/stylists');
const { BRANCH_IDS, branchReadiness, qpayAccountFor, alertChatFor } = require('../config/branches');

const router = express.Router();
const TEST_MARK = 'taraSetupTest';

function previewOnly(req, res, next) {
  const onVercel = !!process.env.VERCEL;
  if (onVercel && process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'Not found' });
  return next();
}
router.use(previewOnly);

/** Each branch's current hairdressers (the team list, retired ones left out). */
function peopleOf(branch) {
  return teamOf(branch).map((name) => ({ name, variable: STYLIST_CONFIG[name].calendarEnv, cfg: STYLIST_CONFIG[name] }));
}

async function readable(calendar, calendarId) {
  if (!calendarId) return { ok: false, error: 'no calendar id' };
  try {
    const r = await calendar.calendars.get({ calendarId });
    return { ok: true, calendarName: r.data.summary || null, timeZone: r.data.timeZone || null };
  } catch (err) {
    return { ok: false, error: `${(err.response && err.response.status) || ''} ${err.message}`.trim() };
  }
}

router.get('/check', async (_req, res) => {
  const out = {
    serviceAccount: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim() || null,
    shareWith: 'Share each calendar with the service account above: «Make changes to events».',
    branches: {},
  };
  let calendar = null;
  try { calendar = await getCalendarClient(); } catch (err) { out.calendarError = err.message; }
  for (const branch of BRANCH_IDS) {
    const stylists = [];
    const ids = [];
    for (const p of peopleOf(branch)) {
      const calendarId = p.cfg && p.cfg.calendarId;
      const read = calendar ? await readable(calendar, calendarId) : { ok: false };
      stylists.push({
        name: p.name,
        variable: p.variable,
        set: !!calendarId,
        readable: read.ok,
        calendarName: read.calendarName || null,
        timeZone: read.timeZone || null,
      });
      ids.push(calendarId);
    }
    const setIds = ids.filter(Boolean);
    const account = qpayAccountFor(branch);
    out.branches[branch] = {
      readiness: branchReadiness(branch),
      bankAccountComplete: !!(account && account.complete),
      alertChatSet: !!alertChatFor(branch),
      // Two hairdressers on one calendar would book over each other.
      calendarsDistinct: new Set(setIds).size === setIds.length,
      stylists,
    };
  }
  res.json(out);
});

/** Call this same app's own availability endpoint in-process. */
function ownSlots(app, { date, stylistId, branch }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const q = new URLSearchParams({ date, stylistId, branch });
      http.get({ host: '127.0.0.1', port: server.address().port, path: `/api/calendar/available-slots?${q}` }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => {
          server.close();
          try { resolve({ status: r.statusCode, body: JSON.parse(body) }); } catch (e) { reject(e); }
        });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

function nextWeekday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0);
  return d.toISOString().slice(0, 10);
}

router.get('/prove', async (req, res) => {
  const name = String(req.query.stylist || '');
  const cfg = STYLIST_CONFIG[name];
  if (!cfg || cfg.person !== name || cfg.branch !== 'parkod') {
    return res.status(400).json({ error: 'stylist must be one of Парк Од\'s hairdressers, by name' });
  }
  if (!cfg.calendarId) return res.status(409).json({ error: `${name}'s calendar variable is not set` });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : nextWeekday();
  const steps = { stylist: name, date };
  let calendar;
  let eventId = null;
  try {
    calendar = await getCalendarClient();
    const before = await ownSlots(req.app, { date, stylistId: name, branch: 'parkod' });
    steps.slotsBefore = before.body;
    if (before.status !== 200 || !(before.body.availableSlots || []).length) {
      return res.status(409).json({ ...steps, error: 'no free times to test with (branch not ready, or the day is full)' });
    }
    const time = before.body.availableSlots[Math.floor(before.body.availableSlots.length / 2)];
    const start = new Date(`${date}T${time}:00+08:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const inserted = await calendar.events.insert({
      calendarId: cfg.calendarId,
      requestBody: {
        summary: 'ТЕСТ — Tara вэбсайтын шалгалт (автоматаар устгагдана)',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        extendedProperties: { private: { [TEST_MARK]: '1' } },
      },
    });
    eventId = inserted.data.id;
    steps.testEvent = { time, minutes: 60 };
    const readBack = await calendar.events.get({ calendarId: cfg.calendarId, eventId });
    steps.landedInHerCalendar = readBack.data.id === eventId && readBack.data.status !== 'cancelled';
    const after = await ownSlots(req.app, { date, stylistId: name, branch: 'parkod' });
    steps.slotsAfter = after.body;
    steps.hourNoLongerOffered = !(after.body.availableSlots || []).includes(time);
  } catch (err) {
    steps.error = `${(err.response && err.response.status) || ''} ${err.message}`.trim();
  } finally {
    if (eventId) {
      try {
        await calendar.events.delete({ calendarId: cfg.calendarId, eventId });
        steps.testEventDeleted = true;
      } catch (err) {
        steps.testEventDeleted = false;
        steps.deleteError = err.message;
      }
    }
  }
  const ok = !steps.error && steps.landedInHerCalendar && steps.hourNoLongerOffered && steps.testEventDeleted;
  return res.status(ok ? 200 : 500).json({ ok, ...steps });
});

module.exports = router;
