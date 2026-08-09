use std::{env, fs, io::{self, Write}, path::{Path, PathBuf}, time::UNIX_EPOCH};

fn escape_json(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""), '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"), '\r' => output.push_str("\\r"), '\t' => output.push_str("\\t"),
            c if c.is_control() => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output
}

fn emit(line: &str) { println!("{line}"); let _ = io::stdout().flush(); }

fn scan(root: &Path) -> io::Result<()> {
    let root = fs::canonicalize(root)?;
    if !root.is_dir() { return Err(io::Error::new(io::ErrorKind::InvalidInput, "root is not a directory")); }
    let mut stack: Vec<PathBuf> = vec![root];
    let mut files = 0_u64;
    let mut bytes = 0_u64;
    let mut errors = 0_u64;
    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) { Ok(value) => value, Err(_) => { errors += 1; continue; } };
        for entry in entries {
            let entry = match entry { Ok(value) => value, Err(_) => { errors += 1; continue; } };
            let file_type = match entry.file_type() { Ok(value) => value, Err(_) => { errors += 1; continue; } };
            if file_type.is_symlink() { continue; }
            if file_type.is_dir() { stack.push(entry.path()); continue; }
            if !file_type.is_file() { continue; }
            let metadata = match entry.metadata() { Ok(value) => value, Err(_) => { errors += 1; continue; } };
            files += 1;
            bytes = bytes.saturating_add(metadata.len());
            let modified = metadata.modified().ok().and_then(|v| v.duration_since(UNIX_EPOCH).ok()).map(|v| v.as_millis()).unwrap_or(0);
            let path = escape_json(&entry.path().to_string_lossy());
            let extension = escape_json(entry.path().extension().and_then(|v| v.to_str()).unwrap_or(""));
            emit(&format!(r#"{{"type":"file","path":"{path}","size":{},"modifiedAt":{modified},"extension":"{extension}"}}"#, metadata.len()));
            if files % 250 == 0 { emit(&format!(r#"{{"type":"progress","files":{files},"bytes":{bytes},"errors":{errors}}}"#)); }
        }
    }
    emit(&format!(r#"{{"type":"done","files":{files},"bytes":{bytes},"errors":{errors}}}"#));
    Ok(())
}

fn main() {
    let mut args = env::args_os();
    let _binary = args.next();
    let command = args.next();
    let root = args.next();
    if command.as_deref() != Some(std::ffi::OsStr::new("scan")) || root.is_none() {
        eprintln!("usage: nwd-disk-scanner scan <directory>");
        std::process::exit(2);
    }
    if let Err(error) = scan(Path::new(&root.unwrap())) { eprintln!("{error}"); std::process::exit(1); }
}

