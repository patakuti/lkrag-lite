# Roadmap — Aurora Hub

**Owner:** Priya Nakamura
**Last updated:** 2026-06-15

## Milestones

| Milestone | Target date | Status | Notes |
|---|---|---|---|
| Kickoff | 2026-05-12 | ✅ Done | Scope, pricing, and workstream owners agreed |
| Firmware architecture doc | 2026-05-26 | ✅ Done | Owned by Ben |
| Enclosure concepts (3 options) | 2026-05-20 | ✅ Done | Narrowed to 2 colors at design review |
| Alpha build (internal only) | 2026-06-30 | 🔄 In progress | Setup flow redesign (DEC-014) landing in Alpha 2, not Alpha 1 |
| Matter certification submitted | 2026-06-15 | ✅ Done | Wren started this immediately after kickoff per timeline risk flag |
| Beta 2 device-capacity stress test | 2026-07-14 | ⏳ Planned | Validates the 80/64/32 device targets in the product spec |
| Closed Beta (50 households) | 2026-08-03 | ⏳ Planned | Recruiting via community waitlist, owned by Sam |
| Beta feedback review | 2026-09-01 | ⏳ Planned | Go/no-go checkpoint for public launch scope |
| Public launch | Q4 2026 (target: 2026-11-10) | ⏳ Planned | Retail price locked at $79 pending Beta feedback |

## Deferred to v1.1 / v2

- **v1.1:** Multi-hub mesh support (more than one Aurora Hub per household)
- **v2:** Voice assistant hardware (mic/speaker), possible battery-backup SKU (enclosure already leaves room for this per Diego's design)

## Known schedule risks

1. **Matter certification lead time** — flagged at kickoff as the biggest single risk to the Q4 date. Submitted early (2026-06-15) to buy buffer.
2. **Setup flow rework (DEC-014)** — landing in Alpha 2 instead of Alpha 1 pushes some internal QA cycles later than originally planned; Wren is monitoring whether this compresses the Beta 2 stress-test window.
3. **Beta household recruitment** — Sam's waitlist currently has ~600 signups against a target of 50 selected households; not considered a risk at this time but tracked in `07-known-issues.md`.
