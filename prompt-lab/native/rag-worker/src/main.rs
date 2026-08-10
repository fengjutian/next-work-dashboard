use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i64 = 1;

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct Response {
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentInput {
    id: String,
    name: String,
    kind: String,
    source_path: Option<String>,
    file_size: i64,
    content_hash: Option<String>,
    parser_version: String,
    chunker_version: String,
    #[serde(default)]
    chunks: Vec<ChunkInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkInput {
    id: String,
    content: String,
    chunk_index: i64,
    section_title: Option<String>,
    page: Option<i64>,
    start_offset: Option<i64>,
    end_offset: Option<i64>,
    content_hash: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeywordSearchInput {
    query: String,
    top_k: Option<i64>,
    #[serde(default)]
    document_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankedList {
    #[serde(default)]
    ids: Vec<String>,
    weight: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuseInput {
    #[serde(default)]
    lists: Vec<RankedList>,
    top_k: Option<usize>,
    rank_constant: Option<f64>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn hash_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS schema_version (
           version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS documents (
           id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, source_path TEXT,
           file_size INTEGER NOT NULL, content_hash TEXT NOT NULL, parser_version TEXT NOT NULL,
           chunker_version TEXT NOT NULL, status TEXT NOT NULL, error_message TEXT,
           created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chunks (
           id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
           content TEXT NOT NULL, content_hash TEXT NOT NULL, section_title TEXT, page INTEGER,
           start_offset INTEGER, end_offset INTEGER, created_at INTEGER NOT NULL,
           FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);
         CREATE TABLE IF NOT EXISTS index_jobs (
           id TEXT PRIMARY KEY, document_id TEXT, operation TEXT NOT NULL, status TEXT NOT NULL,
           stage TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
           error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_index_jobs_status ON index_jobs(status, updated_at);
         CREATE TABLE IF NOT EXISTS index_outbox (
           id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, chunk_id TEXT,
           document_id TEXT, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL,
           retry_count INTEGER NOT NULL DEFAULT 0, error_message TEXT,
           created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_index_outbox_status ON index_outbox(status, id);
         CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
           chunk_id UNINDEXED, document_id UNINDEXED, title, content, tokenize='unicode61'
         );"
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_version(version, applied_at, description) VALUES(?1, ?2, ?3)",
        params![SCHEMA_VERSION, now_ms(), "initial RAG worker schema"],
    )?;
    Ok(())
}

fn queue_outbox(
    tx: &Transaction<'_>,
    operation: &str,
    chunk_id: Option<&str>,
    document_id: &str,
    payload: Value,
) -> rusqlite::Result<()> {
    let now = now_ms();
    tx.execute(
        "INSERT INTO index_outbox(operation, chunk_id, document_id, payload, status, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
        params![operation, chunk_id, document_id, payload.to_string(), now],
    )?;
    Ok(())
}

fn upsert_document(connection: &mut Connection, input: DocumentInput) -> Result<Value, String> {
    let now = now_ms();
    let job_id = format!("import:{}:{}", input.id, now);
    let document_hash = input.content_hash.unwrap_or_else(|| {
        hash_text(
            &input
                .chunks
                .iter()
                .map(|chunk| chunk.content.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        )
    });
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let unchanged = tx.query_row(
        "SELECT content_hash = ?2 AND parser_version = ?3 AND chunker_version = ?4 FROM documents WHERE id = ?1",
        params![input.id, document_hash, input.parser_version, input.chunker_version],
        |row| row.get::<_, bool>(0),
    ).optional().map_err(|error| error.to_string())?.unwrap_or(false);
    if unchanged {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(json!({ "documentId": input.id, "unchanged": true, "jobId": Value::Null }));
    }

    tx.execute(
        "INSERT INTO index_jobs(id, document_id, operation, status, stage, completed, total, created_at, updated_at)
         VALUES(?1, ?2, 'upsert', 'running', 'saving', 0, ?3, ?4, ?4)",
        params![job_id, input.id, input.chunks.len() as i64, now],
    ).map_err(|error| error.to_string())?;
    let old_ids = {
        let mut statement = tx
            .prepare("SELECT id FROM chunks WHERE document_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![input.id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for chunk_id in &old_ids {
        queue_outbox(&tx, "delete_vector", Some(chunk_id), &input.id, json!({}))
            .map_err(|error| error.to_string())?;
    }
    tx.execute(
        "DELETE FROM chunks_fts WHERE document_id = ?1",
        params![input.id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM chunks WHERE document_id = ?1",
        params![input.id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO documents(id, name, kind, source_path, file_size, content_hash, parser_version, chunker_version, status, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'indexing', ?9, ?9)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, source_path=excluded.source_path,
         file_size=excluded.file_size, content_hash=excluded.content_hash, parser_version=excluded.parser_version,
         chunker_version=excluded.chunker_version, status='indexing', error_message=NULL, updated_at=excluded.updated_at",
        params![input.id, input.name, input.kind, input.source_path, input.file_size, document_hash,
            input.parser_version, input.chunker_version, now],
    ).map_err(|error| error.to_string())?;
    for chunk in &input.chunks {
        let chunk_hash = chunk
            .content_hash
            .clone()
            .unwrap_or_else(|| hash_text(&chunk.content));
        tx.execute(
            "INSERT INTO chunks(id, document_id, chunk_index, content, content_hash, section_title, page, start_offset, end_offset, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![chunk.id, input.id, chunk.chunk_index, chunk.content, chunk_hash, chunk.section_title,
                chunk.page, chunk.start_offset, chunk.end_offset, now],
        ).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO chunks_fts(chunk_id, document_id, title, content) VALUES(?1, ?2, ?3, ?4)",
            params![chunk.id, input.id, chunk.section_title, chunk.content],
        )
        .map_err(|error| error.to_string())?;
        queue_outbox(&tx, "upsert_vector", Some(&chunk.id), &input.id,
            json!({ "content": chunk.content, "sectionTitle": chunk.section_title, "page": chunk.page }))
            .map_err(|error| error.to_string())?;
    }
    tx.execute(
        "UPDATE index_jobs SET status='completed', stage='saved', completed=total, updated_at=?2 WHERE id=?1",
        params![job_id, now_ms()],
    ).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(
        json!({ "documentId": input.id, "unchanged": false, "jobId": job_id, "chunks": input.chunks.len() }),
    )
}

fn keyword_search(connection: &Connection, input: KeywordSearchInput) -> Result<Value, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(json!({ "hits": [] }));
    }
    let limit = input.top_k.unwrap_or(50).clamp(1, 200);
    let allowed: HashSet<&str> = input.document_ids.iter().map(String::as_str).collect();
    let mut statement = connection.prepare(
        "SELECT f.chunk_id, f.document_id, c.content, c.section_title, c.page, bm25(chunks_fts) AS score
         FROM chunks_fts f JOIN chunks c ON c.id = f.chunk_id
         WHERE chunks_fts MATCH ?1 ORDER BY score LIMIT ?2"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![query, if allowed.is_empty() { limit } else { 1000 }], |row| {
        Ok(json!({
            "chunkId": row.get::<_, String>(0)?, "documentId": row.get::<_, String>(1)?,
            "content": row.get::<_, String>(2)?, "sectionTitle": row.get::<_, Option<String>>(3)?,
            "page": row.get::<_, Option<i64>>(4)?, "score": -row.get::<_, f64>(5)?
        }))
    }).map_err(|error| error.to_string())?;
    let hits = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|hit| {
            allowed.is_empty()
                || hit
                    .get("documentId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| allowed.contains(id))
        })
        .take(limit as usize)
        .collect::<Vec<_>>();
    Ok(json!({ "hits": hits }))
}

fn fuse(input: FuseInput) -> Value {
    let k = input.rank_constant.unwrap_or(60.0).max(1.0);
    let mut scores: HashMap<String, f64> = HashMap::new();
    for list in input.lists {
        let weight = list.weight.unwrap_or(1.0);
        for (index, id) in list.ids.into_iter().enumerate() {
            *scores.entry(id).or_default() += weight / (k + index as f64 + 1.0);
        }
    }
    let mut ranked = scores.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    let hits = ranked.into_iter().take(input.top_k.unwrap_or(10).clamp(1, 200))
        .enumerate().map(|(index, (chunk_id, score))| json!({ "chunkId": chunk_id, "score": score, "rank": index + 1 }))
        .collect::<Vec<_>>();
    json!({ "hits": hits })
}

fn dispatch(connection: &mut Connection, request: &Request) -> Result<Value, String> {
    match request.method.as_str() {
        "ping" => {
            Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "schemaVersion": SCHEMA_VERSION }))
        }
        "upsert_document" => upsert_document(
            connection,
            serde_json::from_value(request.params.clone()).map_err(|error| error.to_string())?,
        ),
        "keyword_search" => keyword_search(
            connection,
            serde_json::from_value(request.params.clone()).map_err(|error| error.to_string())?,
        ),
        "fuse_results" => Ok(fuse(
            serde_json::from_value(request.params.clone()).map_err(|error| error.to_string())?,
        )),
        "delete_document" => {
            let document_id = request
                .params
                .get("documentId")
                .and_then(Value::as_str)
                .ok_or("documentId is required")?;
            let tx = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            queue_outbox(&tx, "delete_document", None, document_id, json!({}))
                .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM chunks_fts WHERE document_id=?1",
                params![document_id],
            )
            .map_err(|error| error.to_string())?;
            let deleted = tx
                .execute("DELETE FROM documents WHERE id=?1", params![document_id])
                .map_err(|error| error.to_string())?;
            tx.commit().map_err(|error| error.to_string())?;
            Ok(json!({ "deleted": deleted > 0 }))
        }
        "get_pending_outbox" => {
            let limit = request
                .params
                .get("limit")
                .and_then(Value::as_i64)
                .unwrap_or(100)
                .clamp(1, 1000);
            let mut statement = connection.prepare("SELECT id, operation, chunk_id, document_id, payload, retry_count FROM index_outbox WHERE status='pending' ORDER BY id LIMIT ?1").map_err(|error| error.to_string())?;
            let rows = statement.query_map(params![limit], |row| {
                let payload: String = row.get(4)?;
                Ok(json!({ "id": row.get::<_, i64>(0)?, "operation": row.get::<_, String>(1)?,
                    "chunkId": row.get::<_, Option<String>>(2)?, "documentId": row.get::<_, Option<String>>(3)?,
                    "payload": serde_json::from_str::<Value>(&payload).unwrap_or(json!({})), "retryCount": row.get::<_, i64>(5)? }))
            }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
            Ok(json!({ "operations": rows }))
        }
        "complete_outbox" => {
            let id = request
                .params
                .get("id")
                .and_then(Value::as_i64)
                .ok_or("id is required")?;
            connection.execute("UPDATE index_outbox SET status='completed', error_message=NULL, updated_at=?2 WHERE id=?1", params![id, now_ms()]).map_err(|error| error.to_string())?;
            Ok(json!({ "completed": true }))
        }
        "fail_outbox" => {
            let id = request
                .params
                .get("id")
                .and_then(Value::as_i64)
                .ok_or("id is required")?;
            let error = request
                .params
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("INDEX_OPERATION_FAILED");
            connection.execute("UPDATE index_outbox SET retry_count=retry_count+1, error_message=?2, updated_at=?3 WHERE id=?1", params![id, error, now_ms()]).map_err(|error| error.to_string())?;
            Ok(json!({ "failed": true }))
        }
        "get_status" => {
            let documents: i64 = connection
                .query_row("SELECT count(*) FROM documents", [], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            let chunks: i64 = connection
                .query_row("SELECT count(*) FROM chunks", [], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            let pending: i64 = connection
                .query_row(
                    "SELECT count(*) FROM index_outbox WHERE status='pending'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            Ok(json!({ "documents": documents, "chunks": chunks, "pendingOutbox": pending }))
        }
        "check_integrity" => {
            let result: String = connection
                .query_row("PRAGMA integrity_check", [], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            Ok(json!({ "ok": result == "ok", "detail": result }))
        }
        _ => Err(format!("unknown method: {}", request.method)),
    }
}

fn database_path() -> PathBuf {
    env::args()
        .skip(1)
        .find_map(|argument| argument.strip_prefix("--database=").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("rag.db"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = database_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(path)?;
    migrate(&connection)?;
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(error) => {
                eprintln!("stdin error: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => match dispatch(&mut connection, &request) {
                Ok(result) => Response {
                    id: request.id,
                    result: Some(result),
                    error: None,
                },
                Err(message) => Response {
                    id: request.id,
                    result: None,
                    error: Some(ErrorBody {
                        code: "RAG_WORKER_ERROR".into(),
                        message,
                    }),
                },
            },
            Err(error) => Response {
                id: Value::Null,
                result: None,
                error: Some(ErrorBody {
                    code: "INVALID_REQUEST".into(),
                    message: error.to_string(),
                }),
            },
        };
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(&mut stdout)?;
        stdout.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_searches_and_queues_vectors() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        let result = upsert_document(
            &mut connection,
            DocumentInput {
                id: "doc-1".into(),
                name: "manual.pdf".into(),
                kind: "pdf".into(),
                source_path: None,
                file_size: 10,
                content_hash: None,
                parser_version: "pdfjs-1".into(),
                chunker_version: "char-1".into(),
                chunks: vec![ChunkInput {
                    id: "chunk-1".into(),
                    content: "refund policy and support".into(),
                    chunk_index: 0,
                    section_title: Some("Policy".into()),
                    page: Some(1),
                    start_offset: None,
                    end_offset: None,
                    content_hash: None,
                }],
            },
        )
        .unwrap();
        assert_eq!(result["chunks"], 1);
        let found = keyword_search(
            &connection,
            KeywordSearchInput {
                query: "refund".into(),
                top_k: Some(5),
                document_ids: vec![],
            },
        )
        .unwrap();
        assert_eq!(found["hits"][0]["chunkId"], "chunk-1");
        let pending: i64 = connection
            .query_row(
                "SELECT count(*) FROM index_outbox WHERE status='pending'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 1);
    }

    #[test]
    fn rrf_rewards_results_present_in_both_lists() {
        let result = fuse(FuseInput {
            lists: vec![
                RankedList {
                    ids: vec!["a".into(), "b".into()],
                    weight: None,
                },
                RankedList {
                    ids: vec!["b".into(), "c".into()],
                    weight: None,
                },
            ],
            top_k: Some(3),
            rank_constant: Some(60.0),
        });
        assert_eq!(result["hits"][0]["chunkId"], "b");
    }
}
