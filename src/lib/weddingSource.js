// Role-based floorplans data source (pure).
//
// The singleton `weddings` row's SELECT policy is couple-only
// (`weddings_select ... using (not is_helper())`, migration 0010), because RLS
// filters rows not columns and the row carries couple-only fields (budget,
// checklist, rsvp_pin, photowall_pin). The D-Day helper view still needs the
// floorplan snapshots (#162), so the helper reads them through the
// `get_wedding_floorplans` security-definer projection — which exposes ONLY the
// floorplans column — instead of a direct table select. This mirrors how the
// helper reads guests via `get_checkin_guests` (see `guestSource.js`).
//
// The network call lives in `AdminApp.jsx` (`loadWedding`); this pure helper
// just picks the path. Anything that isn't exactly the helper role (couple,
// role not yet resolved, unknown) takes the direct select: RLS is the real
// gate, so a wrong client-side guess degrades to an empty result, never a leak.
export function weddingFloorplansPlan(role) {
  return role === "helper"
    ? { kind: "rpc", fn: "get_wedding_floorplans" }
    : { kind: "select", table: "weddings", column: "floorplans" };
}
