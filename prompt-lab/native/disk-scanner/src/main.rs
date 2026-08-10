use std::{
    collections::{HashMap, HashSet},
    env, fs,
    hash::{DefaultHasher, Hasher},
    io::{self, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetLogicalDrives() -> u32;
    fn GetDiskFreeSpaceExW(
        directory: *const u16,
        free_available: *mut u64,
        total: *mut u64,
        free_total: *mut u64,
    ) -> i32;
}

#[cfg(windows)]
fn emit_disks() {
    let mask = unsafe { GetLogicalDrives() };
    let mut disks = Vec::new();
    for index in 0..26 {
        if mask & (1 << index) == 0 { continue; }
        let letter = (b'A' + index as u8) as char;
        let root = format!("{letter}:\\");
        let wide = root.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
        let (mut available, mut total, mut free) = (0_u64, 0_u64, 0_u64);
        let success = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) };
        if success != 0 && total > 0 {
            disks.push(format!(r#"{{"path":"{letter}:\\","total":{total},"free":{available},"used":{}}}"#, total.saturating_sub(available)));
        }
    }
    emit(&format!(r#"{{"disks":[{}]}}"#, disks.join(",")));
}

#[cfg(not(windows))]
fn emit_disks() {
    emit(r#"{"disks":[]}"#);
}

#[derive(Clone)]
struct FileResult {
    path: String,
    size: u64,
    modified: u128,
    extension: String,
}

struct DuplicateGroup {
    size: u64,
    files: Vec<FileResult>,
}

fn content_hash(path: &Path) -> io::Result<u64> {
    let mut reader = BufReader::new(fs::File::open(path)?);
    let mut hasher = DefaultHasher::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.write(&buffer[..read]);
    }
    Ok(hasher.finish())
}

fn same_content(left: &Path, right: &Path) -> io::Result<bool> {
    let mut left = BufReader::new(fs::File::open(left)?);
    let mut right = BufReader::new(fs::File::open(right)?);
    let mut left_buffer = [0_u8; 128 * 1024];
    let mut right_buffer = [0_u8; 128 * 1024];
    loop {
        let left_read = left.read(&mut left_buffer)?;
        let right_read = right.read(&mut right_buffer)?;
        if left_read != right_read {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
    }
}

fn escape_json(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c.is_control() => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output
}

fn emit(line: &str) {
    println!("{line}");
    let _ = io::stdout().flush();
}

fn normalized_name(value: &str) -> String {
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value.to_owned()
    }
}

fn should_exclude(path: &Path, exclusions: &HashSet<String>) -> bool {
    path.file_name()
        .map(|name| exclusions.contains(&normalized_name(&name.to_string_lossy())))
        .unwrap_or(false)
}

fn scan(root: &Path, exclusions: &HashSet<String>, skip_duplicates: bool) -> io::Result<()> {
    let root = fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "root is not a directory",
        ));
    }
    let mut stack: Vec<PathBuf> = vec![root.clone()];
    let mut files = 0_u64;
    let mut bytes = 0_u64;
    let mut errors = 0_u64;
    let mut largest: Vec<FileResult> = Vec::with_capacity(50);
    let mut extensions: HashMap<String, u64> = HashMap::new();
    let mut by_size: HashMap<u64, Vec<FileResult>> = HashMap::new();
    let mut directory_bytes: HashMap<PathBuf, u64> = HashMap::new();
    while let Some(directory) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(value) => value,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(value) => value,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if should_exclude(&entry.path(), exclusions) {
                    continue;
                }
                stack.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            files += 1;
            bytes = bytes.saturating_add(metadata.len());
            let mut parent = entry.path().parent().map(Path::to_path_buf);
            while let Some(directory) = parent {
                if !directory.starts_with(&root) {
                    break;
                }
                let directory_total = directory_bytes.entry(directory.clone()).or_insert(0);
                *directory_total = directory_total.saturating_add(metadata.len());
                if directory == root {
                    break;
                }
                parent = directory.parent().map(Path::to_path_buf);
            }
            let modified = metadata
                .modified()
                .ok()
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .map(|v| v.as_millis())
                .unwrap_or(0);
            let extension = entry
                .path()
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_lowercase();
            let extension_bytes = extensions.entry(extension.clone()).or_insert(0);
            *extension_bytes = extension_bytes.saturating_add(metadata.len());
            let result = FileResult {
                path: entry.path().to_string_lossy().into_owned(),
                size: metadata.len(),
                modified,
                extension,
            };
            if result.size > 0 {
                by_size.entry(result.size).or_default().push(result.clone());
            }
            largest.push(result);
            largest.sort_unstable_by(|a, b| b.size.cmp(&a.size));
            largest.truncate(50);
            if files % 250 == 0 {
                emit(&format!(
                    r#"{{"type":"progress","files":{files},"bytes":{bytes},"errors":{errors}}}"#
                ));
            }
        }
    }
    for file in largest {
        emit(&format!(
            r#"{{"type":"file","path":"{}","size":{},"modifiedAt":{},"extension":"{}"}}"#,
            escape_json(&file.path),
            file.size,
            file.modified,
            escape_json(&file.extension)
        ));
    }
    for (extension, size) in extensions {
        emit(&format!(
            r#"{{"type":"extension","extension":"{}","size":{size}}}"#,
            escape_json(&extension)
        ));
    }
    let mut directories = directory_bytes.into_iter().collect::<Vec<_>>();
    directories.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    directories.truncate(500);
    for (directory, size) in directories {
        emit(&format!(
            r#"{{"type":"directory","path":"{}","size":{size}}}"#,
            escape_json(&directory.to_string_lossy())
        ));
    }
    if skip_duplicates {
        emit(&format!(
            r#"{{"type":"done","files":{files},"bytes":{bytes},"errors":{errors}}}"#
        ));
        return Ok(());
    }
    emit(r#"{"type":"duplicate-progress","stage":"hashing"}"#);
    let mut duplicate_groups = Vec::<DuplicateGroup>::new();
    for (size, candidates) in by_size.into_iter().filter(|(_, values)| values.len() > 1) {
        let mut by_hash: HashMap<u64, Vec<FileResult>> = HashMap::new();
        for candidate in candidates {
            match content_hash(Path::new(&candidate.path)) {
                Ok(hash) => by_hash.entry(hash).or_default().push(candidate),
                Err(_) => errors += 1,
            }
        }
        for hash_group in by_hash.into_values().filter(|values| values.len() > 1) {
            let mut exact_groups: Vec<Vec<FileResult>> = Vec::new();
            for candidate in hash_group {
                let mut matched = false;
                for group in &mut exact_groups {
                    match same_content(Path::new(&group[0].path), Path::new(&candidate.path)) {
                        Ok(true) => {
                            group.push(candidate.clone());
                            matched = true;
                            break;
                        }
                        Ok(false) => {}
                        Err(_) => errors += 1,
                    }
                }
                if !matched {
                    exact_groups.push(vec![candidate]);
                }
            }
            duplicate_groups.extend(
                exact_groups
                    .into_iter()
                    .filter(|values| values.len() > 1)
                    .map(|files| DuplicateGroup { size, files }),
            );
        }
    }
    duplicate_groups.sort_unstable_by(|a, b| {
        let left = a
            .size
            .saturating_mul(a.files.len().saturating_sub(1) as u64);
        let right = b
            .size
            .saturating_mul(b.files.len().saturating_sub(1) as u64);
        right.cmp(&left)
    });
    duplicate_groups.truncate(100);
    for (index, group) in duplicate_groups.iter().enumerate() {
        let files_json = group
            .files
            .iter()
            .map(|file| {
                format!(
                    r#"{{"path":"{}","size":{},"modifiedAt":{}}}"#,
                    escape_json(&file.path),
                    file.size,
                    file.modified
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        emit(&format!(
            r#"{{"type":"duplicate","groupId":"duplicate-{index}","size":{},"files":[{files_json}]}}"#,
            group.size
        ));
    }
    emit(&format!(
        r#"{{"type":"done","files":{files},"bytes":{bytes},"errors":{errors}}}"#
    ));
    Ok(())
}

fn main() {
    let mut args = env::args_os();
    let _binary = args.next();
    let command = args.next();
    if command.as_deref() == Some(std::ffi::OsStr::new("disks")) {
        emit_disks();
        return;
    }
    let root = args.next();
    let mut exclusions = HashSet::new();
    let mut skip_duplicates = false;
    while let Some(argument) = args.next() {
        if argument == std::ffi::OsStr::new("--exclude") {
            if let Some(value) = args.next() {
                exclusions.insert(normalized_name(&value.to_string_lossy()));
            }
        } else if argument == std::ffi::OsStr::new("--skip-duplicates") {
            skip_duplicates = true;
        }
    }
    if command.as_deref() != Some(std::ffi::OsStr::new("scan")) || root.is_none() {
        eprintln!("usage: nwd-disk-scanner scan <directory>");
        std::process::exit(2);
    }
    if let Err(error) = scan(Path::new(&root.unwrap()), &exclusions, skip_duplicates) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{content_hash, normalized_name, same_content, should_exclude};
    use std::collections::HashSet;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn hash_candidates_are_verified_byte_for_byte() {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("nwd-disk-scanner-{id}"));
        fs::create_dir_all(&directory).unwrap();
        let first = directory.join("first.txt");
        let second = directory.join("second.txt");
        let different = directory.join("different.txt");
        fs::write(&first, b"same content").unwrap();
        fs::write(&second, b"same content").unwrap();
        fs::write(&different, b"other content").unwrap();
        assert_eq!(
            content_hash(&first).unwrap(),
            content_hash(&second).unwrap()
        );
        assert!(same_content(&first, &second).unwrap());
        assert!(!same_content(&first, &different).unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn exclusion_matches_a_directory_name_only() {
        let exclusions = HashSet::from([normalized_name("node_modules")]);
        assert!(should_exclude(
            std::path::Path::new("project/node_modules"),
            &exclusions
        ));
        assert!(!should_exclude(
            std::path::Path::new("project/node_modules-old"),
            &exclusions
        ));
    }
}
