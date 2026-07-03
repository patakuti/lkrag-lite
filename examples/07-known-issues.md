# Known Issues & Open Risks — Aurora Hub

**Owner:** Wren Callahan (QA)
**Last updated:** 2026-06-15

## Open issues

### ISSUE-022 — Zigbee mesh degrades above ~60 devices in Alpha 1 build
Internal testing found response latency increasing noticeably once more than ~60 Zigbee devices were paired, short of the 80-device target in the product spec. Suspected cause: mesh routing table size in the current firmware build. Ben is investigating whether this is a firmware tuning issue or a hardware radio limitation before the Beta 2 stress test on 2026-07-14. If unresolved, the 80-device target in `01-product-spec.md` may need to be revised downward.

### ISSUE-027 — BLE pairing occasionally times out on Android 12 devices
A subset of Alpha testers on older Android versions report the BLE handshake during setup (`01-product-spec.md`, setup flow step 3) timing out and requiring a retry. Not yet reproduced on iOS or newer Android versions. Low priority unless it recurs in Beta.

### ISSUE-031 — Waitlist oversubscribed relative to Closed Beta capacity
Sam's community waitlist has approximately 600 signups against a target of 50 selected households for Closed Beta (`04-roadmap.md`). Not a technical risk, but Sam and Priya need to agree on selection criteria (geographic diversity, existing device ecosystems, etc.) before invitations go out.

### ISSUE-034 — Status LED amber state is hard to distinguish from solid green in bright rooms
Diego flagged that the amber ("offline/local-only mode") and green ("online") LED states are difficult to tell apart under strong ambient light. Being evaluated as either a firmware fix (add a blink pattern to amber) or a hardware fix (higher-intensity LED) — decision expected before Beta.

## Resolved issues

### ISSUE-014 (Resolved 2026-06-03) — Confusing mandatory account creation during setup
Root cause of Alpha dogfooding drop-off; resolved by DEC-014 (see `05-decision-log.md`), which moved account creation out of the critical setup path. Fix targeted for Alpha 2.

### ISSUE-019 (Resolved 2026-05-20) — Terracotta enclosure color required a second mold tool
Identified during enclosure costing; resolved by cutting the Terracotta option (DEC-011), keeping only Cloud White and Slate Gray for v1.0.
