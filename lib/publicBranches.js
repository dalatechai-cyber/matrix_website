'use strict';

const data = require('../data/branches.json');
const { STYLIST_CONFIG } = require('../config/stylists');
const { branchReadiness, stylistsOf } = require('../config/branches');

/**
 * Both branches as the booking page sees them. Hairdressers are listed only
 * for a branch that takes online bookings; nothing server-only (calendar ids,
 * QPay accounts) is included.
 */
function publicBranches() {
  return data.order.map((id) => {
    const b = data.branches[id];
    const { ready } = branchReadiness(id);
    return {
      id,
      name: b.name,
      short: b.short,
      address: b.address,
      phones: b.phones || [],
      hoursText: b.hoursText,
      workHours: b.workHours,
      ready,
      stylists: ready ? stylistsOf(id).map((name) => {
        const cfg = STYLIST_CONFIG[name];
        return { id: name, level: cfg.level, title: cfg.title, deposit: cfg.price, gender: cfg.gender, photo: cfg.photo || null, photo2x: cfg.photo2x || null };
      }) : [],
    };
  });
}

module.exports = { publicBranches };
