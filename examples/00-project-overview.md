# Project Overview — Aurora Hub

**Team:** Aurora Labs, Hardware & Firmware Group
**Status:** Active development, targeting public launch
**Last updated:** 2026-06-15

## What is Aurora Hub?

Aurora Hub is a matchbox-sized smart home hub that bridges Zigbee, Thread, and Matter devices into a single local-first network. Unlike most hubs on the market, Aurora Hub does not require a cloud account to function — automations, device pairing, and voice routines all run on-device, with cloud sync being strictly optional (used only for remote access and firmware updates).

## Core value proposition

1. **Local-first**: the hub keeps working during internet outages; no vendor cloud dependency for core automations.
2. **One hub, three protocols**: Zigbee 3.0, Thread border router, and Matter controller in a single unit, removing the need for separate bridges.
3. **Privacy by default**: no telemetry is sent off-device unless the user explicitly opts in from Settings > Diagnostics.
4. **5-minute setup**: pairing flow was redesigned in Q2 to remove the account-creation step from the critical path (see decision log, DEC-014).

## Team

| Name | Role |
|---|---|
| Priya Nakamura | Product Lead |
| Ben Ostrowski | Firmware Engineering Lead |
| Diego Ferreira | Industrial Design Lead |
| Wren Callahan | QA Lead |
| Sam Okafor | Growth & Community |

## Target hardware specs (subject to change — see roadmap for current status)

- SoC: dual-core ARM Cortex-A7, 512MB RAM, 4GB eMMC
- Radios: Zigbee 3.0, Thread (802.15.4), Matter over Wi-Fi/Thread, BLE 5.2 for setup
- Power: USB-C, 5V/1A, no battery (always mains-powered)
- Dimensions: 58mm x 58mm x 22mm
- Target retail price: **$79**, no subscription required for core features

## Related documents

- `01-product-spec.md` — detailed functional and hardware spec
- `02-meeting-notes-2026-05-12-kickoff.md` — project kickoff notes
- `03-meeting-notes-2026-06-03-design-review.md` — design review and pairing flow decision
- `04-roadmap.md` — milestone plan
- `05-decision-log.md` — running log of major decisions with rationale
- `06-glossary.md` — internal terminology
- `07-known-issues.md` — current bugs and open risks
