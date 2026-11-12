# 0002. Load lifecycle and billing status

**Status:** accepted, open to revision after dispatcher interviews (blueprint 20.18)

## Decision

A load has an **operational status** and a separate **billing status**.

Operational: `draft`, `planned`, `assigned`, `dispatched`, `at_pickup`, `in_transit`, `at_delivery`,
`delivered`, `pod_review`, `completed`, `on_hold`, `cancelled`.

Billing: `unbilled`, `invoiced`, `paid`. It is changed only by invoice and payment actions.

| Action | From | To | Requires |
| --- | --- | --- | --- |
| Mark ready | draft | planned | Active customer, at least one pickup then one delivery |
| Assign | planned | assigned | Eligible driver, truck and (if needed) trailer; no overlapping work |
| Unassign | assigned | planned | |
| Dispatch | assigned | dispatched | Active assignment |
| Arrive at a pickup | dispatched, in_transit | at_pickup | Previous stop completed |
| Arrive at a delivery | in_transit | at_delivery | Previous stop completed |
| Depart a stop | at_pickup, at_delivery | in_transit, or delivered after the last stop | Arrival recorded |
| POD uploaded | delivered | pod_review | Automatic |
| Approve POD | pod_review | completed | A POD on file |
| Reject POD | pod_review | delivered | Reason |
| Hold | planned, assigned, dispatched | on_hold | Reason |
| Release | on_hold | the status it was held from | |
| Cancel | draft, planned, assigned, dispatched, on_hold | cancelled | Reason |

Every change goes through one backend function, appends an immutable status event, and increments the load's
`version`. Clients send the version they last saw; a stale version is rejected with `VERSION_CONFLICT`.

## Notes

- The blueprint's proposed "Picked up" state is folded into `in_transit`: on a multi-stop load the two are
  indistinguishable, and the stop itself records the pickup time.
- A load can be invoiced once `completed`. Rates and charges can be edited until it is invoiced; stops can be
  edited until it is dispatched.
- Two assignments conflict when a driver, truck or trailer is on another load that is in progress, or whose
  pickup-to-delivery window overlaps this one.
