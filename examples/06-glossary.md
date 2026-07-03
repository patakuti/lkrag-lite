# Glossary — Aurora Hub Internal Terms

**Last updated:** 2026-06-10

**Aurora Hub**
The product itself: a local-first smart home hub supporting Zigbee, Thread, and Matter. See `00-project-overview.md`.

**Alpha / Alpha 2**
Internal-only build milestones before Beta. "Alpha 2" specifically refers to the build that includes the DEC-014 setup flow rework; Alpha 1 shipped without it.

**BOM**
Bill of Materials — the total component cost per unit. Used when discussing how a feature (e.g. battery backup, voice hardware) affects unit economics.

**Border router**
The Thread networking role the hub plays: it connects the local Thread mesh network to the rest of the household's IP network (Wi-Fi/Ethernet).

**Closed Beta**
The 50-household external test phase, targeted for 2026-08-03, recruited from Sam's community waitlist.

**Cloud sync**
Optional, end-to-end encrypted backup of automation rules and device metadata, used for remote access and multi-hub sync. Explicitly opt-in; not required for core hub functionality (see DEC-002).

**Local-first**
Aurora Labs' core positioning: automations and device control run entirely on-device without depending on a vendor's cloud service to function.

**Matter**
A cross-vendor smart home connectivity standard the hub supports as a controller, alongside Zigbee and Thread.

**Rules engine**
The on-device software component that evaluates YAML-defined automation rules locally, without a cloud round-trip.

**SKU**
Stock Keeping Unit — used when discussing potential future product variants, e.g. a hypothetical "battery-backup SKU" mentioned as a v2 candidate in the decision log.

**Terracotta**
A cut enclosure color option (see DEC-011). Not part of the v1.0 lineup.

**v1.0 / v1.1 / v2**
Version scoping shorthand. v1.0 is the initial public launch scope; v1.1 is the next planned update (multi-hub mesh); v2 is the longer-term scope (voice hardware, possible battery SKU).
