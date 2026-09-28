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
2. **Stock and days.** A ticker and a day, or a range of weekdays (up to 31).
3. **Exchanges.** All 13 US exchanges with full depth of book, each priced by
   Databento for your stock and days. All are selected at first; untick the
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

MIT
