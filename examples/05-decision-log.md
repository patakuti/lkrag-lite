# Decision Log — Aurora Hub

Running log of major product decisions. Each entry includes the decision, the date, who made the call, and the rationale. Referenced by ID (e.g. DEC-009) from other documents.

---

### DEC-001 — Target three protocols in one hub (Zigbee, Thread, Matter)
**Date:** 2026-05-12 · **Owner:** Priya
Core differentiation vs. single-protocol competitors. See `00-project-overview.md`.

### DEC-002 — No cloud account required for core functionality
**Date:** 2026-05-12 · **Owner:** Priya
Central to the "local-first" positioning. Cloud sync remains available but opt-in.

### DEC-003 — Target retail price: $79, no subscription
**Date:** 2026-05-12 · **Owner:** Sam, ratified by Priya
Based on competitive analysis presented at kickoff; undercuts local-first competitors ($90–$140) while avoiding a subscription/ad-supported model.

### DEC-009 — No internal battery backup in v1.0
**Date:** 2026-06-03 (finalized; first raised 2026-05-12) · **Owner:** Ben, ratified by Priya
Adding a 2000mAh battery would add $6.40 to BOM cost, 4mm to enclosure thickness, and ~5 weeks of additional UL certification time — incompatible with the Q4 launch target. Enclosure design leaves room for a battery module in a possible future SKU (v2 candidate).

### DEC-011 — Enclosure colors: Cloud White and Slate Gray only
**Date:** 2026-06-03 · **Owner:** Diego
Terracotta option cut; it would have required a separate injection mold tool, adding cost without a clear differentiation benefit.

### DEC-014 — Move account creation out of the critical setup path
**Date:** 2026-06-03 · **Owner:** Ben, ratified by Priya
Alpha dogfooding showed 6 of 8 testers dropped off or got confused at a mandatory "create an Aurora account" step before device pairing. Account creation (for optional cloud sync) is now presented after the hub is online and functional, and can be skipped entirely. Reflected in `01-product-spec.md` section 3. Lands in Alpha 2 rather than Alpha 1, per `04-roadmap.md`.

### DEC-018 — Voice assistant hardware deferred to v2
**Date:** 2026-05-12 · **Owner:** Priya
Adding a mic/speaker would raise BOM cost by roughly $18/unit and delay firmware certification; doesn't fit the v1.0 "three protocols, no cloud lock-in" scope.
