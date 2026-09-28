# Trandence Tick Downloader — plan

A small desktop app that downloads Databento MBP-10 tick data for a stock and a
day, with the user's own API key, straight to their computer. The files are the
same ones the Databento portal gives, with the same names, so they import into
Trandence Market Replay as they are — and work anywhere else too.

Unofficial; not affiliated with Databento.

## Why a desktop app

Trandence cannot call Databento from the browser: the API answers CORS
preflights only for `https://databento.com` ("Disallowed CORS origin" for any
other origin, checked 2026-09-28). Going through a Trandence server is ruled
out — Trandence never touches the data or the key. A desktop app has no CORS.

## Version 1

1. **API key.** Entered once, kept in the OS credential store (Windows
   Credential Manager / macOS Keychain). Sent only to `hist.databento.com`.
2. **Stock and days.** A symbol and one day or a range of days. Whole days
   only — no hour selection.
3. **Price per exchange.** As soon as symbol and days are set, the app asks
   Databento for the cost of each exchange and lists them with checkboxes,
   largest share of volume first:

   | Exchange | Databento dataset | Share of volume* |
   |---|---|---|
   | ARCX | `ARCX.PILLAR`  | ~41% |
   | XNAS | `XNAS.ITCH`    | ~21% |
   | EDGX | `EDGX.PITCH`   | ~18% |
   | MEMX | `MEMX.MEMOIR`  | ~7%  |
   | BATS | `BATS.PITCH`   | ~5%  |

   Buttons: *Select all*, *Top 3*. A total at the bottom.
   \*Measured on 22 trading days in September 2026; shares vary by stock and day.
4. **Folder.** Chosen once and remembered; can be changed any time.
5. **Download.** One streaming request per exchange and day. Each file shows
   a status — queued, downloading (bytes so far), done, failed — no
   percentage.

### Files

Schema `mbp-10`, CSV, zstd-compressed, with readable prices and timestamps and
a symbol column — the portal's defaults. Names as Databento writes them:
`<dataset>-<yyyymmdd>.mbp-10.csv.zst`, e.g. `xnas-itch-20260926.mbp-10.csv.zst`.
Trandence's import recognises exactly this pattern.

### Days and UTC

Databento splits days in UTC; a US trading day, 04:00–20:00 ET, crosses into
the next UTC day in winter (20:00 EST = 01:00 UTC). The app requests the
trading day's own window, converted to UTC, and saves it under the trading
day's date. Checked on NBIS: the window and the whole UTC day cost the same and
have the same billable size, in summer and in winter — so this is about
getting the right day, not about price.

## Stack

Tauri 2 with a TypeScript UI. HTTP to Databento from the Rust side (or Tauri's
HTTP plugin), files streamed to disk; key via the OS keyring.

## Distribution

- Public repository (this one), MIT.
- GitHub Actions builds installers — Windows (.msi / .exe) and macOS (.dmg) —
  on every tag and attaches them to a Release. The Trandence help article links
  to the latest release.
- Tauri's updater checks Releases for new versions.
- Code signing: not in v1. Unsigned builds trigger Windows SmartScreen and
  macOS Gatekeeper warnings; the README explains how to allow the app. Apple
  signing costs $99/yr; a Windows certificate is bought separately.

## API checks (2026-09-28, NBIS, `scripts/probe-api.mjs`)

`metadata.get_cost` and `metadata.get_billable_size` — free, nothing downloaded.

| Dataset | 2026-09-25 | 2026-01-15 |
|---|---|---|
| ARCX.PILLAR | $0.0304, 81.7 MB  | $0.0126, 33.9 MB  |
| XNAS.ITCH   | $0.1039, 278.8 MB | $0.0415, 111.3 MB |
| EDGX.PITCH  | $0.0328, 87.9 MB  | $0.0121, 32.4 MB  |
| BATS.PITCH  | $0.0360, 96.6 MB  | $0.0159, 42.7 MB  |

- Costs per exchange and day are cents; the list shows them to the cent, or
  "< $0.01".
- The trading-day window and the whole UTC day are identical in cost and size.
- `MEMX.MEMOIRS` is not a dataset; the code is `MEMX.MEMOIR` (as in the
  Trandence server's DEFAULT_DATABENTO_DATASET). With it MEMX prices and
  downloads normally.
- Billable size is known up front. It is most likely the uncompressed binary
  size, not the size of the zstd CSV on disk — not checked against a real
  download. v1 shows bytes downloaded, no percentage, so it does not matter yet.
- Streaming download of a full day: about 10 minutes through the API
  (founder's experience).

## End-to-end check (2026-09-28)

NBIS, 2026-09-08, all five exchanges, downloaded by the app ($0.22 for the top
three, plus MEMX and BATS). The CSV header is identical to a portal file's; the
ARCX file decompresses to 311,768 records. Imported into trandence.com Market
Replay as they were (1,841,570 records, ~60 MB) and played back.

Lesson from that check: the import reads files when it analyses and saves them,
not when they are dropped — deleting or moving them in between fails with
`NotFoundError`. No need to decompress: the import takes `.csv.zst`.

