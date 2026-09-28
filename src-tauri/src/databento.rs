//! Everything that talks to Databento, and the rules for what to ask it.

use chrono::{NaiveDate, NaiveTime, TimeZone};
use chrono_tz::America::New_York;

pub const API: &str = "https://hist.databento.com/v0";
pub const SCHEMA: &str = "mbp-10";

/// The exchanges offered, largest share of volume first. Each is a separate
/// Databento dataset, priced and downloaded on its own.
pub const DATASETS: [&str; 5] = ["ARCX.PILLAR", "XNAS.ITCH", "EDGX.PITCH", "MEMX.MEMOIR", "BATS.PITCH"];

pub fn parse_day(day: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| format!("Not a date: {day}"))
}

pub fn check_dataset(dataset: &str) -> Result<(), String> {
    if DATASETS.contains(&dataset) {
        Ok(())
    } else {
        Err(format!("Unknown exchange dataset: {dataset}"))
    }
}

/// US ticker as Databento's raw symbols write it: letters, digits and a dot (BRK.B).
pub fn check_symbol(symbol: &str) -> Result<(), String> {
    let ok = !symbol.is_empty()
        && symbol.len() <= 10
        && symbol.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '.');
    if ok {
        Ok(())
    } else {
        Err(format!("Not a ticker: {symbol}"))
    }
}

/// The trading day's own window, 04:00–20:00 in New York, as UTC timestamps.
///
/// Databento splits days in UTC; in winter 20:00 EST is 01:00 UTC the next
/// day, so a plain UTC day would cut the last post-market hour. Checked on
/// NBIS: the window and the UTC day cost the same, so this is only about
/// getting the right day.
pub fn trading_window(day: NaiveDate) -> (String, String) {
    let at = |h: u32| {
        // 04:00 and 20:00 are never inside a DST switch (those happen at 02:00).
        New_York
            .from_local_datetime(&day.and_time(NaiveTime::from_hms_opt(h, 0, 0).unwrap()))
            .single()
            .expect("04:00 and 20:00 New York time are unambiguous")
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    };
    (at(4), at(20))
}

/// The name the Databento portal gives the same file, e.g.
/// `xnas-itch-20260926.mbp-10.csv.zst`. Trandence's import recognises it.
pub fn file_name(dataset: &str, day: NaiveDate) -> String {
    format!(
        "{}-{}.{SCHEMA}.csv.zst",
        dataset.to_lowercase().replace('.', "-"),
        day.format("%Y%m%d")
    )
}

/// Form fields shared by the cost query and the download.
pub fn query(dataset: &str, symbol: &str, day: NaiveDate) -> Vec<(&'static str, String)> {
    let (start, end) = trading_window(day);
    vec![
        ("dataset", dataset.to_string()),
        ("symbols", symbol.to_string()),
        ("stype_in", "raw_symbol".to_string()),
        ("schema", SCHEMA.to_string()),
        ("start", start),
        ("end", end),
    ]
}

/// Download options that match the portal's defaults: CSV, zstd, readable
/// prices and timestamps, and a symbol column.
pub const DOWNLOAD_OPTIONS: [(&str, &str); 5] = [
    ("encoding", "csv"),
    ("compression", "zstd"),
    ("pretty_px", "true"),
    ("pretty_ts", "true"),
    ("map_symbols", "true"),
];

/// Databento's own explanation from an error body, or the status if there is none.
pub fn error_message(status: u16, body: &str) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let detail = parsed.as_ref().and_then(|v| v.get("detail"));
    let text = detail
        .and_then(|d| d.get("message").and_then(|m| m.as_str()).or_else(|| d.as_str()))
        .map(str::to_string);
    match (status, text) {
        (401, _) => "Databento rejected the API key.".to_string(),
        (_, Some(t)) => t,
        (s, None) => format!("Databento answered HTTP {s}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    #[test]
    fn summer_window_ends_at_midnight_utc() {
        assert_eq!(
            trading_window(day("2026-09-25")),
            ("2026-09-25T08:00:00Z".into(), "2026-09-26T00:00:00Z".into())
        );
    }

    #[test]
    fn winter_window_runs_into_the_next_utc_day() {
        assert_eq!(
            trading_window(day("2026-01-15")),
            ("2026-01-15T09:00:00Z".into(), "2026-01-16T01:00:00Z".into())
        );
    }

    #[test]
    fn file_names_match_the_portal() {
        assert_eq!(file_name("XNAS.ITCH", day("2026-09-26")), "xnas-itch-20260926.mbp-10.csv.zst");
        assert_eq!(file_name("MEMX.MEMOIR", day("2026-01-05")), "memx-memoir-20260105.mbp-10.csv.zst");
    }

    #[test]
    fn symbols_and_datasets_are_checked() {
        assert!(check_symbol("BRK.B").is_ok());
        assert!(check_symbol("nbis").is_err());
        assert!(check_symbol("").is_err());
        assert!(check_symbol("A&B").is_err());
        assert!(check_dataset("MEMX.MEMOIR").is_ok());
        assert!(check_dataset("MEMX.MEMOIRS").is_err());
    }

    #[test]
    fn error_messages_come_from_the_body() {
        let body = r#"{"detail":{"case":"validation_failed","message":"Invalid `dataset`"}}"#;
        assert_eq!(error_message(400, body), "Invalid `dataset`");
        assert_eq!(error_message(422, r#"{"detail":"No data"}"#), "No data");
        assert_eq!(error_message(500, "oops"), "Databento answered HTTP 500.");
        assert_eq!(error_message(401, body), "Databento rejected the API key.");
    }
}
