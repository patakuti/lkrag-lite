# Meeting Notes — Design Review: Setup Flow & Enclosure

**Date:** 2026-06-03
**Attendees:** Priya, Ben, Diego, Wren
**Type:** Design review

## Agenda

1. Review Alpha setup flow feedback
2. Finalize enclosure color options
3. Battery backup — final decision
4. Device capacity targets for Beta stress test

## Discussion

**Setup flow.** Wren shared internal dogfooding feedback: 6 of 8 testers dropped off or got confused at the "create an Aurora account" step before they could even start pairing devices. Ben proposed moving account creation to *after* the hub is online and functional, making it fully optional if the user doesn't want cloud sync. Priya approved this as a scope change for Alpha 2. This is now tracked as **DEC-014** in the decision log — the setup flow in `01-product-spec.md` section 3 reflects the new order.

**Enclosure.** Diego presented three color concepts. Group selected two for production: Cloud White and Slate Gray. The third option ("Terracotta") was cut for cost reasons — it required a different injection mold tool. Diego to update the industrial design doc accordingly.

**Battery backup — final decision.** Revisiting DEC-009 from the kickoff: Ben presented updated numbers. Adding a 2000mAh backup battery would add $6.40 to BOM cost, 4mm to enclosure thickness, and require a new UL certification pass, adding an estimated 5 weeks to the certification timeline. Given the Q4 launch target, the group decided **not** to include a battery in v1.0. Diego noted the enclosure design leaves room for a battery module in a possible future SKU. Decision finalized: no battery, mains-powered only.

**Device capacity.** Wren proposed stress-testing the hub with a target of 80 Zigbee devices, 64 Thread devices, and 32 Matter-over-Wi-Fi devices simultaneously, to validate the numbers in the product spec before they're locked for v1.0. Test scheduled for Beta 2 (see roadmap).

## Action items

- [ ] Ben: update setup flow diagrams and hand off to app team by 2026-06-10
- [ ] Diego: finalize Cloud White / Slate Gray tooling, drop Terracotta
- [ ] Wren: design the Beta 2 device-capacity stress test protocol
- [ ] Priya: communicate the no-battery decision to marketing (Sam) before Beta announcement copy goes out
