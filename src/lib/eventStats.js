// Per-event RSVP statistics for the admin RSVP tab. Pure aggregation over the
// `guest_event_rsvps` rows (all bodies × events). Headcount per event = the
// confirmed body count, mirroring the legacy "headcount = confirmed guest rows".

/**
 * @param {Array<{id:string,name?:string}>} events
 * @param {Array<{event_id:string,status:string,meal_choice?:string,invited?:boolean}>} rsvpRows
 * @returns {Array<{eventId:string,name:string,confirmed:number,declined:number,pending:number,invited:number,mealCounts:Record<string,number>}>}
 *   One entry per event, in the input event order.
 */
export function aggregateEventStats(events, rsvpRows) {
  const evs = Array.isArray(events) ? events : [];
  const rows = Array.isArray(rsvpRows) ? rsvpRows : [];

  const byEvent = new Map(evs.map((e) => [e.id, {
    eventId: e.id,
    name: e.name ?? '',
    confirmed: 0,
    declined: 0,
    pending: 0,
    invited: 0,
    mealCounts: {},
  }]));

  for (const row of rows) {
    if (row.invited === false) continue;
    const stat = byEvent.get(row.event_id);
    if (!stat) continue;
    stat.invited += 1;
    if (row.status === 'confirmed') {
      stat.confirmed += 1;
      const meal = (row.meal_choice ?? '').trim();
      if (meal) stat.mealCounts[meal] = (stat.mealCounts[meal] || 0) + 1;
    } else if (row.status === 'declined') {
      stat.declined += 1;
    } else {
      stat.pending += 1;
    }
  }

  return evs.map((e) => byEvent.get(e.id));
}
