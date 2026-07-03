# Product Spec — Aurora Hub v1.0

**Owner:** Ben Ostrowski (Firmware) / Diego Ferreira (Hardware)
**Status:** Frozen for v1.0, changes require sign-off from Priya
**Last updated:** 2026-06-10

## 1. Hardware

- **SoC:** ARM Cortex-A7 dual-core @ 1.2GHz, 512MB LPDDR3, 4GB eMMC storage
- **Radios:**
  - Zigbee 3.0 (concurrent with Thread, separate radio chip)
  - Thread 1.3 border router
  - Matter controller (Wi-Fi + Thread commissioning)
  - Bluetooth LE 5.2, used only during initial setup, disabled afterward by default
- **Connectivity:** Wi-Fi 5 (802.11ac), Gigabit Ethernet port (recommended for reliability)
- **Power:** USB-C, 5V/1A input; no internal battery — the hub is mains-powered only. A battery-backed variant was discussed but rejected (see DEC-009).
- **Enclosure:** matte polycarbonate, two color options (Cloud White, Slate Gray)
- **Status LED:** single RGB LED, ring around the base; breathing blue = pairing mode, solid green = online, amber = offline/local-only mode, red = firmware update in progress

## 2. Software architecture

- **OS:** Linux-based, read-only root filesystem with an A/B partition scheme for atomic OTA updates
- **Automation engine:** runs entirely on-device; rules are stored as YAML and evaluated by a local rules engine (no cloud round-trip)
- **Local API:** REST + WebSocket API exposed on the LAN, used by the mobile app and any third-party integrations
- **Cloud sync (optional):** end-to-end encrypted backup of automation rules and device metadata; used for remote access and multi-hub sync. Disabled by default until the user explicitly enables it in onboarding step 5.

## 3. Setup flow (post DEC-014 redesign)

1. Plug in hub, wait for breathing blue LED (~15 seconds)
2. Open Aurora app, tap "Add Hub"
3. App discovers hub via BLE, transfers Wi-Fi credentials
4. Hub joins network, LED turns solid green
5. (Optional) User chooses whether to enable cloud sync — **no account required to skip this step**
6. User begins pairing Zigbee/Thread/Matter devices

Target: complete setup in under 5 minutes for a first-time user with 3 devices to pair.

## 4. Device capacity (v1.0 targets)

| Protocol | Max paired devices | Notes |
|---|---|---|
| Zigbee 3.0 | 80 | Mesh-extending devices (plugs, bulbs) count toward this limit |
| Thread | 64 | Shared radio budget with Matter-over-Thread devices |
| Matter (Wi-Fi) | 32 | Limited by local network table size |

These numbers are conservative estimates pending the Beta 2 stress test (see roadmap).

## 5. Out of scope for v1.0

- Voice assistant hardware (mic/speaker) — deferred to v2, see roadmap
- Battery backup — rejected, see DEC-009
- Multi-hub mesh (more than one Aurora Hub per household) — planned for v1.1
