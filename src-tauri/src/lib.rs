mod databento;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

const KEYRING_SERVICE: &str = "Trandence Tick Downloader";
const KEYRING_USER: &str = "databento-api-key";

struct Http(reqwest::Client);

// ── API key: in the OS credential store; the UI only ever learns whether one is saved ──

fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {e}"))
}

fn api_key() -> Result<String, String> {
    match key_entry()?.get_password() {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => Err("Enter your Databento API key first.".into()),
        Err(e) => Err(format!("Could not read the saved key: {e}")),
    }
}

#[tauri::command]
fn key_saved() -> Result<bool, String> {
    match key_entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Could not read the saved key: {e}")),
    }
}

#[tauri::command]
fn key_save(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    key_entry()?.set_password(key).map_err(|e| format!("Could not save the key: {e}"))
}

#[tauri::command]
fn key_forget() -> Result<(), String> {
    match key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}

// ── Databento ──

/// Price in USD of one exchange's data for one trading day. Free to ask.
#[tauri::command]
async fn get_cost(http: State<'_, Http>, symbol: String, day: String, dataset: String) -> Result<f64, String> {
    databento::check_symbol(&symbol)?;
    databento::check_dataset(&dataset)?;
    let day = databento::parse_day(&day)?;
    let resp = http
        .0
        .post(format!("{}/metadata.get_cost", databento::API))
        .basic_auth(api_key()?, Some(""))
        .form(&databento::query(&dataset, &symbol, day))
        .send()
        .await
        .map_err(|e| format!("Could not reach Databento: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("Could not read Databento's answer: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(databento::error_message(status, &body));
    }
    body.trim().parse::<f64>().map_err(|_| format!("Unexpected cost from Databento: {body}"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Downloaded {
    file: String,
    bytes: u64,
    /// The file was already in the folder, so nothing was downloaded or paid for.
    skipped: bool,
}

/// Download one exchange's data for one trading day into `folder`, streaming
/// to `<name>.part` and renaming when complete. Emits `download-progress`
/// with the bytes written so far.
#[tauri::command]
async fn download(
    app: AppHandle,
    http: State<'_, Http>,
    id: String,
    symbol: String,
    day: String,
    dataset: String,
    folder: String,
) -> Result<Downloaded, String> {
    databento::check_symbol(&symbol)?;
    databento::check_dataset(&dataset)?;
    let day = databento::parse_day(&day)?;
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err("The download folder does not exist.".into());
    }

    let name = databento::file_name(&dataset, day);
    let target = folder.join(&name);
    if let Ok(meta) = tokio::fs::metadata(&target).await {
        if meta.len() > 0 {
            return Ok(Downloaded { file: name, bytes: meta.len(), skipped: true });
        }
    }

    let mut form = databento::query(&dataset, &symbol, day);
    form.extend(databento::DOWNLOAD_OPTIONS.iter().map(|(k, v)| (*k, v.to_string())));
    let resp = http
        .0
        .post(format!("{}/timeseries.get_range", databento::API))
        .basic_auth(api_key()?, Some(""))
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Could not reach Databento: {e}"))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        let body = resp.text().await.unwrap_or_default();
        return Err(databento::error_message(status, &body));
    }

    let part = folder.join(format!("{name}.part"));
    let result = write_stream(&app, &id, resp, &part).await;
    match result {
        Ok(bytes) => {
            tokio::fs::rename(&part, &target).await.map_err(|e| format!("Could not save {name}: {e}"))?;
            Ok(Downloaded { file: name, bytes, skipped: false })
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

async fn write_stream(app: &AppHandle, id: &str, resp: reqwest::Response, part: &PathBuf) -> Result<u64, String> {
    let mut file = tokio::fs::File::create(part).await.map_err(|e| format!("Could not create the file: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut bytes: u64 = 0;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download was interrupted: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| format!("Could not write the file: {e}"))?;
        bytes += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let _ = app.emit("download-progress", Progress { id: id.to_string(), bytes });
            last_emit = Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("Could not write the file: {e}"))?;
    let _ = app.emit("download-progress", Progress { id: id.to_string(), bytes });
    Ok(bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("trandence-tick-downloader/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("HTTP client");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Http(http))
        .invoke_handler(tauri::generate_handler![key_saved, key_save, key_forget, get_cost, download])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
