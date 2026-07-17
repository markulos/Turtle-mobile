# Maestro E2E flows

On-device end-to-end tests for flows that can't be verified off-device (native
share sheets, real downloads, the OS UI). Run against a **dev build on a
simulator or device** — Maestro drives the real app.

## Install & run

```sh
# one-time: install Maestro (https://maestro.mobile.dev)
curl -Ls "https://get.maestro.mobile.dev" | bash

# with the app installed on a booted simulator/emulator or connected device:
cd mobile-app
maestro test .maestro/batch-share.yaml
```

## Flows

### `batch-share.yaml` — vault batch-select share
Verifies the exact path the "share multiple photos from the vault" feature takes:
Photos vault → Select mode → pick several photos → **Share** → gather overlay
(downloads originals) → **one** native OS share sheet with the whole selection.

Covers the layers that cannot be checked off-device (the data path — resolve →
backfill evicted items via `POST /api/media/by-ids` → download — is already
verified against the live server and with a Node test; this flow closes the
native-presentation leg).

**Prerequisites:** dev build that includes `react-native-share`; logged in +
connected to the Turtle server; ≥4 photos in the vault. See the header comments
in the flow for selector/locale tuning notes.

## Stable selectors (testIDs) this relies on
| testID | Element |
|---|---|
| `tab-photos` | Photos vault bottom-tab (App.js) |
| `gallery-select-toggle` | Select / Cancel toggle |
| `gallery-cell-<index>` | A photo grid cell |
| `gallery-share-button` | Share action in the select bar |
| `share-preparing-overlay` | "Preparing N photos…" gather overlay |
| `gallery-section-select` | Section-select (tap-first/tap-last) toggle |
