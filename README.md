# Trandence Tick Downloader

Download Databento MBP-10 tick data — the full 10-level order book and every
trade — for a US stock and a day, with your own Databento API key. You see the
price of each exchange before you buy, choose which ones you want, and the files
go straight to a folder on your computer.

The files are the ones the Databento portal would give you, with the same
names (`xnas-itch-20260926.mbp-10.csv.zst`), so they import into
[Trandence](https://trandence.com) Market Replay as they are, and work with any
other tool that reads Databento data.

Unofficial — not affiliated with Databento.

## Install

Download the installer for your system from the
[latest release](../../releases/latest):

- **Windows:** `.msi` or `-setup.exe`
- **macOS:** `.dmg`

The installers are not code-signed yet. On first launch:

- **Windows** shows "Windows protected your PC" — click *More info*, then *Run anyway*.
- **macOS** says the app cannot be opened — right-click it in Applications,
  choose *Open*, then *Open* again.

## Use

1. **API key.** Paste your Databento API key (portal → API Keys) and save it.
   It is kept in your system's credential store (Windows Credential Manager or
   macOS Keychain) and sent only to Databento.
2. **Stock and day.** A ticker and one trading day — a replay is one day.
3. **Exchanges.** All 13 US exchanges with full depth of book, each priced by
   Databento for your stock and day. All are selected at first; untick the
   ones you do not want — the app remembers your choice.
4. **Folder.** Choose where the files go; the app remembers it.
5. **Download.** The button shows how many files and what they cost. Anything
   missing is highlighted when you press it. Each file shows its status and
   size as it arrives; files already in the folder are skipped, so nothing is
   bought twice.

Each file covers the trading day's session, 04:00–20:00 New York time.
Days the market was closed have no data and are left out.

## What it costs

You pay Databento directly, at their usage-based prices; the app shows the
price before you download. For a typical mid-cap stock one exchange-day is a
few cents.

## Privacy

The app collects no data and has no telemetry, analytics or crash reporting.

- **Your Databento API key** is kept in your system's credential store (Windows
  Credential Manager or macOS Keychain). It is sent only to Databento
  (`hist.databento.com`), with the requests the app makes on your behalf.
- **Your choices** — the folder and the exchanges — are stored on your computer only.
- **Your requests and files** go between your computer and Databento only.
  Trandence and the authors of this app never receive your key, your requests,
  your files or any information about you.

Databento's own handling of your account and requests is governed by
Databento's privacy policy and terms, not by this app.

## Disclaimer

This app is provided **"as is", without warranty of any kind**, as set out in the
[MIT License](LICENSE). By using it you accept that:

- **You use it at your own risk.** The authors and Trandence are not liable for
  any loss or damage arising from its use or inability to use it — including
  charges, incomplete or incorrect data, lost files, or decisions made with the
  data.
- **Databento charges you, not us.** Purchases are made with your own Databento
  account and API key, at Databento's prices. The prices shown come from
  Databento and may differ from what you are finally charged. Check your
  Databento account; all billing questions and refunds are between you and
  Databento.
- **You are responsible for complying with Databento's terms** and with the
  licences of the exchanges whose data you download, including any limits on
  use, storage, redistribution or display of that data.
- **Nothing here is financial or investment advice.** The app only downloads
  data; what you do with it is your decision and your responsibility.
- **It is unofficial.** The app is not affiliated with, endorsed by or
  supported by Databento or any exchange. Databento and exchange names are
  trademarks of their respective owners and are used only to describe what the
  app connects to.

## Build from source

Needs Node.js 24 and Rust (with the MSVC build tools on Windows).

```bash
npm install
npm run tauri dev     # run
npm run tauri build   # installer in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml
```

Releases are built by GitHub Actions when a `v*` tag is pushed.

## License

[MIT](LICENSE) — free to use, modify and distribute, with no warranty.
