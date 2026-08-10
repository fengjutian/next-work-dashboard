//! HTTP + WebSocket server: mobile web UI, file transfer, WebRTC signaling.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Multipart, Path as AxPath, Query, State as AxState,
    },
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::protocol::Event;
use crate::security::TokenManager;
use crate::signaling::{SignalingFrame, SignalingHub};
use crate::state::SharedState;
use crate::transfer::{Hasher, TransferStatus};

pub const MOBILE_HTML: &str = include_str!("../web/index.html");

#[derive(Clone)]
pub struct HttpState {
    pub cfg: Arc<Config>,
    pub shared: Arc<SharedState>,
}

pub fn build_router(state: HttpState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .max_age(Duration::from_secs(3600));

    Router::new()
        .route("/", get(serve_mobile_ui))
        .route("/index.html", get(serve_mobile_ui))
        .route("/api/info", get(get_info))
        .route("/api/pair/request", post(post_pair_request))
        .route("/api/pair/complete", post(post_pair_complete))
        .route("/api/sessions", get(get_sessions))
        .route("/api/files", get(get_files))
        .route("/api/files/upload", post(post_upload))
        .route("/api/files/download/:id", get(get_download))
        .route("/api/transfers", get(get_transfers))
        .route("/ws", get(ws_upgrade))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024 * 1024)) // 2 GiB body cap
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn serve_mobile_ui() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], MOBILE_HTML)
}

async fn get_info(AxState(state): AxState<HttpState>) -> Json<serde_json::Value> {
    let pair_code = state.shared.tokens.active_pair_code();
    let sessions = state.shared.signaling.list_sessions();
    let transfers = state.shared.transfers.list();
    let lan_addrs = crate::security::enumerate_lan_addrs();
    Json(serde_json::json!({
        "device_id": state.cfg.device_id,
        "device_name": state.cfg.device_name,
        "platform": state.cfg.platform,
        "http_port": state.cfg.http_port,
        "ws_port": state.cfg.ws_port,
        "mdns_enabled": state.cfg.mdns_enabled,
        "version": env!("CARGO_PKG_VERSION"),
        "lan_addrs": lan_addrs.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
        "pair_code": pair_code,
        "sessions": sessions,
        "transfers": transfers.iter().take(20).collect::<Vec<_>>(),
    }))
}

#[derive(Debug, Deserialize)]
struct PairRequest {
    device_id: String,
    device_name: String,
    #[serde(default)]
    platform: Option<String>,
}

#[derive(Debug, Serialize)]
struct PairResponse {
    pair_code: String,
    expires_in_ms: u64,
    ws_url: String,
    http_url: String,
}

async fn post_pair_request(
    AxState(state): AxState<HttpState>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, ApiError> {
    if req.device_id.is_empty() || req.device_name.is_empty() {
        return Err(ApiError::bad_request("device_id 与 device_name 必填"));
    }
    let (token, pair_code, ttl) = state.shared.tokens.issue_pairing(None);
    let _ = token; // token is the bearer secret kept server-side
    tracing::info!(target: "mycast.http", phone = %req.device_id, name = %req.device_name, "pair request issued");
    let lan = crate::security::enumerate_lan_addrs()
        .into_iter()
        .find(|a| a.is_ipv4() && !a.is_loopback())
        .map(|a| a.to_string())
        .unwrap_or_else(|| state.cfg.bind_addr.to_string());
    Ok(Json(PairResponse {
        pair_code,
        expires_in_ms: ttl.as_millis() as u64,
        ws_url: format!("ws://{lan}:{}", state.cfg.ws_port),
        http_url: format!("http://{lan}:{}", state.cfg.http_port),
    }))
}

#[derive(Debug, Deserialize)]
struct PairComplete {
    device_id: String,
    device_name: String,
    pairing_code: String,
}

async fn post_pair_complete(
    AxState(state): AxState<HttpState>,
    Json(req): Json<PairComplete>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Phone only sees the 6-digit code; the long token is reconstructed from it.
    // We look up the active pairing entry by code, then promote it.
    let presented = lookup_token_by_code(&state.shared.tokens, &req.pairing_code)
        .ok_or_else(|| ApiError::unauthorized("配对码无效或已过期"))?;
    let session = state
        .shared
        .tokens
        .consume_pairing(&presented, &req.device_id, &req.device_name)
        .ok_or_else(|| ApiError::unauthorized("配对已失效"))?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "session_token": session.token,
        "device_id": session.device_id,
        "expires_in_ms": 0, // sessions are kept until daemon restart
    })))
}

fn lookup_token_by_code(tokens: &TokenManager, code: &str) -> Option<String> {
    // The token manager doesn't expose the underlying token by code; we mirror it
    // here by maintaining a side table. We use a thread-local shortcut: walk
    // through the manager's `list_sessions` (which hash-masks) is no good, so we
    // instead require the phone to also send the long token. As a convenience for
    // the QR flow, we re-derive the long token from code + device_id (HMAC-like).
    // The pair_request endpoint hands out the code; the mobile web UI uses it to
    // both confirm visually and as a deterministic seed for the bearer token.
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(code.as_bytes());
    h.update(b":nwd-mycast-pair-v1");
    Some(hex::encode(h.finalize()))
}

async fn get_sessions(AxState(state): AxState<HttpState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "sessions": state.shared.signaling.list_sessions() }))
}

async fn get_files(AxState(state): AxState<HttpState>) -> Json<serde_json::Value> {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let mut dir = tokio::fs::read_dir(&state.cfg.storage_dir).await.unwrap_or_else(|_| {
        let _ = std::fs::create_dir_all(&state.cfg.storage_dir);
        // re-open
        Box::leak(Box::new(()));
        tokio::fs::read_dir(&state.cfg.storage_dir).await.unwrap()
    });
    // We use a manual walk to keep this simple and to avoid pulling in walkdir.
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let id = crate::security::sha256_hex(&name);
        entries.push(serde_json::json!({
            "id": id,
            "name": name,
            "size": metadata.len(),
            "modified_at_ms": metadata.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            "kind": kind_from_name(&name),
        }));
    }
    entries.sort_by(|a, b| {
        let ma = a.get("modified_at_ms").and_then(|v| v.as_i64()).unwrap_or(0);
        let mb = b.get("modified_at_ms").and_then(|v| v.as_i64()).unwrap_or(0);
        mb.cmp(&ma)
    });
    Json(serde_json::json!({ "files": entries, "root": state.cfg.storage_dir.display().to_string() }))
}

fn kind_from_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".webp") || lower.ends_with(".gif") || lower.ends_with(".svg") {
        "image"
    } else if lower.ends_with(".mp4") || lower.ends_with(".mov") || lower.ends_with(".webm") || lower.ends_with(".mkv") {
        "video"
    } else if lower.ends_with(".mp3") || lower.ends_with(".wav") || lower.ends_with(".m4a") || lower.ends_with(".flac") {
        "audio"
    } else if lower.ends_with(".pdf") {
        "pdf"
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        "text"
    } else {
        "file"
    }
}

async fn get_transfers(AxState(state): AxState<HttpState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "transfers": state.shared.transfers.list() }))
}

async fn post_upload(
    AxState(state): AxState<HttpState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    // The phone's session token (sent via Authorization: Bearer ...) authenticates
    // uploads. Without it, we reject.
    let device_id = require_session(&state, &headers)?;
    let upload_id = uuid::Uuid::new_v4().to_string();
    let mut target_name: Option<String> = None;
    let mut bytes_written: u64 = 0;
    let mut declared_size: u64 = 0;
    let mut target_path: Option<PathBuf> = None;
    let mut hasher = Hasher::new();
    let started = std::time::Instant::now();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad_request(format!("multipart 解析失败: {e}")))?
    {
        let field_name = field.name().unwrap_or("file").to_string();
        if field_name == "size" {
            if let Some(text) = field.text().await.map_err(|e| ApiError::bad_request(e.to_string()))? {
                declared_size = text.parse().unwrap_or(0);
            }
            continue;
        }
        if field_name == "filename" {
            if let Some(text) = field.text().await.map_err(|e| ApiError::bad_request(e.to_string()))? {
                target_name = Some(sanitize_filename(&text));
            }
            continue;
        }
        if field_name == "file" {
            let name = target_name
                .clone()
                .or_else(|| field.file_name().map(|s| sanitize_filename(s)))
                .unwrap_or_else(|| format!("upload-{upload_id}.bin"));
            let path = state.cfg.storage_dir.join(&name);
            let file = File::create(&path)
                .await
                .map_err(|e| ApiError::internal(format!("无法创建文件: {e}")))?;
            let mut writer = BufWriter::new(file);
            state
                .shared
                .transfers
                .begin_upload(&upload_id, &name, declared_size, path.clone());
            let mut field = field;
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|e| ApiError::bad_request(format!("读取分片失败: {e}")))?
            {
                writer
                    .write_all(&chunk)
                    .await
                    .map_err(|e| ApiError::internal(format!("写入失败: {e}")))?;
                hasher.update(&chunk);
                bytes_written += chunk.len() as u64;
                if bytes_written % (256 * 1024) < chunk.len() as u64 {
                    state.shared.transfers.update_progress(&upload_id, bytes_written);
                }
            }
            writer.flush().await.ok();
            target_path = Some(path);
        }
    }
    let final_path = target_path.ok_or_else(|| ApiError::bad_request("未找到 file 字段"))?;
    let final_name = final_path.file_name().and_then(|s| s.to_str()).unwrap_or("upload").to_string();
    let sha = hasher.finalize_hex();
    let rec = state
        .shared
        .transfers
        .finish_upload(&upload_id, sha.clone(), true, None);
    let elapsed = started.elapsed().as_millis().max(1) as u64;
    let speed_bps = (bytes_written as u128 * 1000 / elapsed as u128) as u64;
    tracing::info!(
        target: "mycast.transfer",
        device = %device_id, name = %final_name, bytes = bytes_written, sha = %sha, "upload complete"
    );
    Ok(Json(serde_json::json!({
        "ok": true,
        "upload_id": upload_id,
        "name": final_name,
        "size": bytes_written,
        "sha256": sha,
        "speed_bps": speed_bps,
        "elapsed_ms": elapsed,
        "record": rec,
    })))
}

#[derive(Debug, Deserialize)]
struct DownloadQuery {
    #[serde(default)]
    inline: Option<bool>,
}

async fn get_download(
    AxState(state): AxState<HttpState>,
    headers: HeaderMap,
    AxPath(id): AxPath<String>,
    Query(q): Query<DownloadQuery>,
) -> Result<Response, ApiError> {
    let _ = require_session(&state, &headers)?;
    // Map id (sha256 of filename) -> filename.
    let mut dir = tokio::fs::read_dir(&state.cfg.storage_dir)
        .await
        .map_err(|e| ApiError::internal(format!("无法读取目录: {e}")))?;
    let mut target: Option<PathBuf> = None;
    while let Ok(Some(entry)) = dir.next_entry().await {
        if !entry.path().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if crate::security::sha256_hex(&name) == id {
            target = Some(entry.path());
            break;
        }
    }
    let path = target.ok_or_else(|| ApiError::not_found("文件不存在"))?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| ApiError::internal(format!("stat 失败: {e}")))?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| ApiError::internal(format!("读取失败: {e}")))?;
    let mut resp_headers = HeaderMap::new();
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    resp_headers.insert(header::CONTENT_TYPE, mime.essence_str().parse().unwrap());
    let disposition = if q.inline.unwrap_or(false) { "inline" } else { "attachment" };
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("download");
    resp_headers.insert(
        header::CONTENT_DISPOSITION,
        format!("{disposition}; filename=\"{}\"", name.replace('"', "_")).parse().unwrap(),
    );
    resp_headers.insert(header::CONTENT_LENGTH, metadata.len().to_string().parse().unwrap());
    Ok((resp_headers, bytes).into_response())
}

fn require_session(state: &HttpState, headers: &HeaderMap) -> Result<String, ApiError> {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("缺少 Authorization 头"))?;
    let bearer = auth.strip_prefix("Bearer ").ok_or_else(|| ApiError::unauthorized("需要 Bearer token"))?;
    state
        .shared
        .tokens
        .validate_session(bearer)
        .ok_or_else(|| ApiError::unauthorized("session token 无效"))
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        format!("upload-{}.bin", &uuid::Uuid::new_v4().to_string()[..8])
    } else if trimmed.len() > 200 {
        format!("{}.bin", &trimmed[..200])
    } else {
        trimmed
    }
}

async fn ws_upgrade(
    AxState(state): AxState<HttpState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    // Optional auth: client may include a "Sec-WebSocket-Protocol: bearer, <token>".
    let proto = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let token = proto
        .as_deref()
        .and_then(|p| p.split(',').nth(1).map(|s| s.trim().to_string()));
    if let Some(t) = token.as_deref() {
        if state.shared.tokens.validate_session(t).is_none() {
            return Err(ApiError::unauthorized("session token 无效"));
        }
    }
    Ok(ws.on_upgrade(move |socket| ws_connection(socket, state, token)))
}

async fn ws_connection(socket: WebSocket, state: HttpState, _auth_token: Option<String>) {
    let (mut tx, mut rx) = socket.split();
    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<SignalingFrame>();
    let mut phone_device: Option<String> = None;

    // Pump outbound frames into the socket.
    let write_task = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            let text = match serde_json::to_string(&frame) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = rx.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<SignalingFrame>(&text) {
                    Ok(frame) => {
                        // First frame must be a Hello to identify the phone.
                        if phone_device.is_none() {
                            if let SignalingFrame::Hello { ref device_id, .. } = frame {
                                phone_device = Some(device_id.clone());
                                state.shared.signaling.register_phone(device_id, frame_tx.clone());
                            } else {
                                tracing::warn!(target: "mycast.ws", "received frame before Hello");
                                continue;
                            }
                        }
                        let device = phone_device.clone().unwrap_or_default();
                        state.shared.signaling.handle_phone_frame(&device, frame);
                    }
                    Err(e) => tracing::warn!(target: "mycast.ws", "bad frame: {e}"),
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    if let Some(device) = phone_device.as_deref() {
        state.shared.signaling.unregister_phone(device);
    }
    write_task.abort();
}

// ── API error type ─────────────────────────────────────────────────────────

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self { Self { status: StatusCode::BAD_REQUEST, message: msg.into() } }
    pub fn unauthorized(msg: impl Into<String>) -> Self { Self { status: StatusCode::UNAUTHORIZED, message: msg.into() } }
    pub fn not_found(msg: impl Into<String>) -> Self { Self { status: StatusCode::NOT_FOUND, message: msg.into() } }
    pub fn internal(msg: impl Into<String>) -> Self { Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: msg.into() } }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({ "ok": false, "error": self.message }));
        (self.status, body).into_response()
    }
}

impl std::fmt::Debug for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ApiError({}): {}", self.status, self.message)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ApiError {}

/// Bind and serve. Returns the bound SocketAddrs for the parent to log.
pub async fn serve(addr: SocketAddr, state: HttpState) -> anyhow::Result<()> {
    let router = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(target: "mycast.http", %addr, "http+ws listening");
    axum::serve(listener, router).await?;
    Ok(())
}
