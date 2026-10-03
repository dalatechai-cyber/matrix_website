'use strict';

/**
 * An in-memory Google Calendar that behaves like the real API where the
 * booking code depends on it:
 *
 *   - events.insert with an id that exists — even a deleted (cancelled) one —
 *     fails 409, as Google does;
 *   - events.get returns a deleted event with status 'cancelled' (404 only for
 *     an id never used);
 *   - events.patch merges, and setting status 'confirmed' brings a deleted
 *     event back;
 *   - events.delete marks the event cancelled; deleting it again is 410;
 *   - events.list returns events overlapping [timeMin, timeMax), hides
 *     cancelled ones unless showDeleted, and honours privateExtendedProperty;
 *   - freebusy.query reports opaque, non-cancelled events (plus `extraBusy`).
 *
 * `created` is stamped from a clock that starts at the real time and advances
 * 1 ms per write, so "created after" comparisons are deterministic.
 */
function createFakeCalendar() {
  const calendars = new Map(); // calendarId -> Map(eventId -> event)
  const log = [];
  const extraBusy = new Map(); // calendarId -> [{ start, end }]
  let clock = Date.now();
  // Real time, but strictly increasing per write.
  const tick = () => { clock = Math.max(Date.now(), clock + 1); return clock; };
  let auto = 0;
  const hooks = {};

  const store = (calendarId) => {
    if (!calendars.has(calendarId)) calendars.set(calendarId, new Map());
    return calendars.get(calendarId);
  };
  const err = (code, message) => Object.assign(new Error(message), { code });
  const copy = (e) => JSON.parse(JSON.stringify(e));
  const t = (x) => new Date(x.dateTime || `${x.date}T00:00:00+08:00`).getTime();

  const events = {
    async insert({ calendarId, requestBody }) {
      log.push(['insert', calendarId, requestBody.id]);
      if (hooks.beforeInsert) await hooks.beforeInsert({ calendarId, requestBody });
      const s = store(calendarId);
      // Google: an event id is 5–1024 characters of base32hex (a–v, 0–9).
      if (requestBody.id && !/^[a-v0-9]{5,1024}$/.test(requestBody.id)) throw err(400, 'Invalid resource id value.');
      const id = requestBody.id || `auto${++auto}`;
      if (s.has(id)) throw err(409, 'The requested identifier already exists.');
      const now = new Date(tick()).toISOString();
      const ev = { status: 'confirmed', ...copy(requestBody), id, created: now, updated: now };
      s.set(id, ev);
      if (hooks.afterInsert) await hooks.afterInsert({ calendarId, event: ev });
      return { data: copy(ev) };
    },
    async get({ calendarId, eventId }) {
      if (!/^[a-v0-9]{5,1024}$/.test(eventId) && !/^auto\d+$/.test(eventId)) throw err(400, 'Invalid resource id value.');
      const ev = store(calendarId).get(eventId);
      if (!ev) throw err(404, 'Not Found');
      return { data: copy(ev) };
    },
    async patch({ calendarId, eventId, requestBody }) {
      log.push(['patch', calendarId, eventId]);
      const s = store(calendarId);
      const ev = s.get(eventId);
      if (!ev) throw err(404, 'Not Found');
      const next = { ...ev, ...copy(requestBody), id: eventId, created: ev.created, updated: new Date(tick()).toISOString() };
      s.set(eventId, next);
      return { data: copy(next) };
    },
    async delete({ calendarId, eventId }) {
      log.push(['delete', calendarId, eventId]);
      const ev = store(calendarId).get(eventId);
      if (!ev) throw err(404, 'Not Found');
      if (ev.status === 'cancelled') throw err(410, 'Resource has been deleted');
      ev.status = 'cancelled';
      ev.updated = new Date(tick()).toISOString();
      return { data: '' };
    },
    async list({ calendarId, timeMin, timeMax, showDeleted, privateExtendedProperty, q, updatedMin }) {
      const lo = timeMin ? Date.parse(timeMin) : -Infinity;
      const hi = timeMax ? Date.parse(timeMax) : Infinity;
      const [pk, pv] = privateExtendedProperty ? privateExtendedProperty.split('=') : [];
      const items = [...store(calendarId).values()].filter((e) => {
        // As Google: with updatedMin, deleted events come back whatever showDeleted says.
        if (!showDeleted && !updatedMin && e.status === 'cancelled') return false;
        if (updatedMin && Date.parse(e.updated || 0) < Date.parse(updatedMin)) return false;
        if (!(t(e.start) < hi && t(e.end) > lo)) return false;
        if (pk && !(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private[pk] === pv)) return false;
        if (q && !JSON.stringify([e.summary, e.description]).includes(q)) return false;
        return true;
      });
      return { data: { items: items.map(copy) } };
    },
  };

  const freebusy = {
    async query({ requestBody }) {
      const lo = Date.parse(requestBody.timeMin);
      const hi = Date.parse(requestBody.timeMax);
      const calendarsOut = {};
      for (const { id } of requestBody.items) {
        const busy = [...store(id).values()]
          .filter((e) => e.status !== 'cancelled' && e.transparency !== 'transparent' && t(e.start) < hi && t(e.end) > lo)
          .map((e) => ({ start: new Date(t(e.start)).toISOString(), end: new Date(t(e.end)).toISOString() }))
          .concat(extraBusy.get(id) || []);
        calendarsOut[id] = { busy };
      }
      return { data: { calendars: calendarsOut } };
    },
  };

  return {
    api: { events, freebusy },
    log,
    hooks,
    /** Live (not cancelled) events on a calendar. */
    live: (calendarId) => [...store(calendarId).values()].filter((e) => e.status !== 'cancelled').map(copy),
    all: (calendarId) => [...store(calendarId).values()].map(copy),
    addBusy: (calendarId, start, end) => extraBusy.set(calendarId, [...(extraBusy.get(calendarId) || []), { start, end }]),
    put: (calendarId, ev) => { store(calendarId).set(ev.id, { status: 'confirmed', created: new Date(tick()).toISOString(), ...copy(ev) }); },
    reset: () => { calendars.clear(); extraBusy.clear(); log.length = 0; for (const k of Object.keys(hooks)) delete hooks[k]; },
  };
}

/** A stand-in for the `googleapis` module that hands out this calendar. */
function googleapisWith(fake) {
  return {
    google: {
      auth: { JWT: class { async authorize() { return {}; } }, GoogleAuth: class { async getClient() { return {}; } } },
      calendar: () => fake.api,
    },
  };
}

module.exports = { createFakeCalendar, googleapisWith };
