# Meeting Notes — Aurora Hub Kickoff

**Date:** 2026-05-12
**Attendees:** Priya, Ben, Diego, Wren, Sam
**Type:** Project kickoff

## Agenda

1. Confirm scope for v1.0
2. Agree on target price point
3. Assign workstream owners
4. Discuss timeline constraints

## Discussion

**Scope.** Priya proposed keeping v1.0 tightly focused on the "three protocols, one hub, no cloud lock-in" story rather than trying to also ship a voice assistant in the same box. Ben agreed, noting that adding a mic/speaker would push the BOM cost up by roughly $18/unit and delay firmware certification. Group consensus: voice hardware is a v2 conversation.

**Pricing.** Sam presented competitor pricing (most local-first hubs on the market range $90–$140, cloud-dependent hubs are often bundled free with a subscription). Group agreed to target **$79 retail**, positioned as "no subscription needed," to undercut the local-first competitors while still being a paid product upfront (no ad-supported or data-monetization model).

**Battery backup.** Diego raised the idea of an internal battery so the hub survives short power outages. Ben pushed back — a battery adds cost, thermal complexity, and a wear-out component in a device meant to run 24/7 for years. Decision deferred to next design review; see `05-decision-log.md` DEC-009 for the final call.

**Workstream owners:**
- Firmware & automation engine: Ben
- Hardware & enclosure: Diego
- QA & certification (Zigbee/Thread/Matter compliance): Wren
- Go-to-market & community beta: Sam
- Overall product & timeline: Priya

**Timeline.** Target Alpha build by end of June, closed Beta (50 households) in August, public launch targeted for Q4. Wren flagged that Matter certification lead times are the biggest schedule risk and should be started immediately rather than after Alpha.

## Action items

- [ ] Ben: draft firmware architecture doc by 2026-05-26
- [ ] Diego: enclosure concepts (3 options) by 2026-05-20
- [ ] Wren: kick off Matter certification paperwork this week
- [ ] Sam: competitive pricing deep-dive shared in #aurora-hub by 2026-05-15
