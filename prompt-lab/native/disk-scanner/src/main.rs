use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
    env, fs,
    hash::{DefaultHasher, Hasher},
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    thread,
    time::{Instant, UNIX_EPOCH},
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
    fn CreateFileW(name: *const u16, access: u32, share: u32, security: *mut std::ffi::c_void, creation: u32, flags: u32, template: isize) -> isize;
    fn DeviceIoControl(handle: isize, code: u32, input: *const std::ffi::c_void, input_size: u32, output: *mut std::ffi::c_void, output_size: u32, returned: *mut u32, overlapped: *mut std::ffi::c_void) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct UsnJournalData {
    journal_id: u64,
    first_usn: i64,
    next_usn: i64,
    lowest_valid_usn: i64,
    max_usn: i64,
    maximum_size: u64,
    allocation_delta: u64,
}

#[cfg(windows)]
fn emit_usn_via_fsutil(drive: char) -> io::Result<()> {
    let result = std::process::Command::new("fsutil.exe").args(["usn", "queryjournal", &format!("{}:", drive.to_ascii_uppercase())]).output()?;
    if !result.status.success() { return Err(io::Error::new(io::ErrorKind::PermissionDenied, String::from_utf8_lossy(&result.stderr))); }
    let text = String::from_utf8_lossy(&result.stdout);
    let values = text.split_whitespace().filter_map(|token| token.strip_prefix("0x").and_then(|hex| u64::from_str_radix(hex, 16).ok())).collect::<Vec<_>>();
    if values.len() < 7 { return Err(io::Error::new(io::ErrorKind::InvalidData, "unable to parse fsutil USN response")); }
    emit(&format!(r#"{{"supported":true,"method":"fsutil","volume":"{}:\\","journalId":{},"firstUsn":{},"nextUsn":{},"lowestValidUsn":{},"maxUsn":{},"maximumSize":{},"allocationDelta":{}}}"#, drive.to_ascii_uppercase(), values[0], values[1], values[2], values[3], values[4], values[5], values[6]));
    Ok(())
}

#[cfg(windows)]
fn emit_usn_info(root: &Path) -> io::Result<()> {
    let root_text = root.to_string_lossy();
    let drive = root_text.chars().next().filter(|_| root_text.chars().nth(1) == Some(':')).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "USN requires a drive-letter path"))?;
    let volume = format!(r"\\.\{}:", drive.to_ascii_uppercase());
    let wide = volume.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let handle = unsafe { CreateFileW(wide.as_ptr(), 0x8000_0000, 0x0000_0007, std::ptr::null_mut(), 3, 0, 0) };
    if handle == -1 { return emit_usn_via_fsutil(drive); }
    let mut output = [0_u8; 128]; let mut returned = 0_u32;
    let success = unsafe { DeviceIoControl(handle, 0x0009_00f4, std::ptr::null(), 0, output.as_mut_ptr() as *mut std::ffi::c_void, output.len() as u32, &mut returned, std::ptr::null_mut()) };
    unsafe { CloseHandle(handle); }
    if success == 0 { return emit_usn_via_fsutil(drive); }
    if returned < std::mem::size_of::<UsnJournalData>() as u32 { return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "short USN journal response")); }
    let data = unsafe { std::ptr::read_unaligned(output.as_ptr() as *const UsnJournalData) };
    emit(&format!(r#"{{"supported":true,"method":"native","volume":"{}:\\","journalId":{},"firstUsn":{},"nextUsn":{},"lowestValidUsn":{},"maxUsn":{},"maximumSize":{},"allocationDelta":{}}}"#, drive.to_ascii_uppercase(), data.journal_id, data.first_usn, data.next_usn, data.lowest_valid_usn, data.max_usn, data.maximum_size, data.allocation_delta));
    Ok(())
}

#[cfg(not(windows))]
fn emit_usn_info(_root: &Path) -> io::Result<()> { emit(r#"{"supported":false}"#); Ok(()) }

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

/// 只按 size 排序的 wrapper —— BinaryHeap 不能直接对 FileResult 排序（会落到 path
/// 等无关字段）。Reverse<BySize> 配合 BinaryHeap 形成 size 最小在堆顶的 min-heap，
/// 便于在 O(log n) 内维护 TopN。
#[allow(dead_code)]
struct BySize(pub FileResult);

impl PartialEq for BySize {
    fn eq(&self, other: &Self) -> bool {
        self.0.size == other.0.size
    }
}
impl Eq for BySize {}
impl PartialOrd for BySize {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for BySize {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.size.cmp(&other.0.size)
    }
}

struct DuplicateGroup {
    size: u64,
    files: Vec<FileResult>,
}

#[allow(dead_code)]
fn retain_largest(heap: &mut BinaryHeap<Reverse<BySize>>, candidate: FileResult, limit: usize) {
    let item = Reverse(BySize(candidate));
    if heap.len() < limit {
        heap.push(item);
        return;
    }
    // BinaryHeap<Reverse<BySize>> 的 peek 是 size 最小者；新候选 size 更大才替换。
    if let Some(min) = heap.peek() {
        if item.0.0.size > min.0.0.size {
            heap.pop();
            heap.push(item);
        }
    }
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

/// 攒批 emit `files` 事件：把 buffer 里的 FileResult 序列化为单个 JSON 数组。
/// 减少 IPC 流量与 setState 频率，渲染端的 TopN 在收到批次后一次性 bulk push。
fn emit_files_batch(buffer: &mut Vec<FileResult>) {
    if buffer.is_empty() { return; }
    let mut out = String::with_capacity(buffer.len() * 96);
    out.push_str(r#"{"type":"files","items":["#);
    for (index, file) in buffer.iter().enumerate() {
        if index > 0 { out.push(','); }
        out.push_str(&format!(
            r#"{{"path":"{}","size":{},"modifiedAt":{},"extension":"{}"}}"#,
            escape_json(&file.path),
            file.size,
            file.modified,
            escape_json(&file.extension),
        ));
    }
    out.push_str("]}");
    emit(&out);
    buffer.clear();
}

/// 攒批 emit `directories` 事件：与 files 同理。
fn emit_directories_batch(buffer: &mut Vec<(String, u64)>) {
    if buffer.is_empty() { return; }
    let mut out = String::with_capacity(buffer.len() * 96);
    out.push_str(r#"{"type":"directories","items":["#);
    for (index, (path, size)) in buffer.iter().enumerate() {
        if index > 0 { out.push(','); }
        out.push_str(&format!(
            r#"{{"path":"{}","size":{size}}}"#,
            escape_json(path),
        ));
    }
    out.push_str("]}");
    emit(&out);
    buffer.clear();
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

fn error_category(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::PermissionDenied => "permission-denied",
        io::ErrorKind::NotFound => "not-found",
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => "busy",
        _ => {
            // Windows 上 ERROR_SHARING_VIOLATION (32) 与 ERROR_LOCK_VIOLATION (33) 表示
            // 目标文件正被其他进程占用（常用于日志、pdb、锁文件）。这两个错误在 std 里
            // 不映射为 WouldBlock/TimedOut，必须按 raw_os_error 额外识别。
            #[cfg(windows)]
            {
                if let Some(code) = error.raw_os_error() {
                    if code == 32 || code == 33 {
                        return "busy";
                    }
                }
            }
            "io"
        }
    }
}

fn scan(root: &Path, exclusions: &HashSet<String>, skip_duplicates: bool, min_duplicate_size: u64, paused: Arc<AtomicBool>) -> io::Result<()> {
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
    let mut reported_errors = 0_u64;
    let mut directories_scanned = 0_u64;
    let started = Instant::now();
    let mut extensions: HashMap<String, u64> = HashMap::new();
    let mut by_size: HashMap<u64, Vec<FileResult>> = HashMap::new();
    let mut directory_bytes: HashMap<PathBuf, u64> = HashMap::new();
    // 攒批 buffer：每 256 个文件 flush 一次 `files` 事件，避免每文件一次 IPC。
    // 渲染端按 TopN 自己算 largest，这里不再维护 largest heap。
    let mut file_buffer: Vec<FileResult> = Vec::with_capacity(256);
    const FILE_BATCH_SIZE: usize = 256;
    while let Some(directory) = stack.pop() {
        while paused.load(Ordering::Relaxed) { thread::sleep(std::time::Duration::from_millis(100)); }
        directories_scanned += 1;
        if directories_scanned == 1 || directories_scanned % 25 == 0 {
            emit(&format!(r#"{{"type":"scan-status","currentPath":"{}","directories":{directories_scanned},"files":{files},"bytes":{bytes},"elapsedMs":{}}}"#, escape_json(&directory.to_string_lossy()), started.elapsed().as_millis()));
        }
        let entries = match fs::read_dir(&directory) {
            Ok(value) => value,
            Err(error) => {
                errors += 1;
                if reported_errors < 100 {
                    emit(&format!(r#"{{"type":"scan-error","path":"{}","category":"{}","message":"{}"}}"#, escape_json(&directory.to_string_lossy()), error_category(&error), escape_json(&error.to_string())));
                    reported_errors += 1;
                }
                continue;
            }
        };
        for entry in entries {
            while paused.load(Ordering::Relaxed) { thread::sleep(std::time::Duration::from_millis(100)); }
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
            if let Some(parent) = entry.path().parent() { let total = directory_bytes.entry(parent.to_path_buf()).or_insert(0); *total = total.saturating_add(metadata.len()); }
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
            if !skip_duplicates && result.size >= min_duplicate_size {
                by_size.entry(result.size).or_default().push(result.clone());
            }
            file_buffer.push(result);
            if file_buffer.len() >= FILE_BATCH_SIZE {
                emit_files_batch(&mut file_buffer);
            }
            if files % 2_000 == 0 {
                emit_files_batch(&mut file_buffer);
                emit(&format!(
                    r#"{{"type":"progress","files":{files},"bytes":{bytes},"errors":{errors}}}"#
                ));
            }
        }
    }
    // 主循环结束，flush 剩余的 files 批次。
    emit_files_batch(&mut file_buffer);
    for (extension, size) in extensions {
        emit(&format!(
            r#"{{"type":"extension","extension":"{}","size":{size}}}"#,
            escape_json(&extension)
        ));
    }
    let direct_directories = directory_bytes.keys().cloned().collect::<Vec<_>>();
    for directory in direct_directories {
        let mut parent = directory.parent().map(Path::to_path_buf);
        while let Some(ancestor) = parent {
            if !ancestor.starts_with(&root) { break; }
            directory_bytes.entry(ancestor.clone()).or_insert(0);
            if ancestor == root { break; }
            parent = ancestor.parent().map(Path::to_path_buf);
        }
    }
    let mut rollup_order = directory_bytes.keys().cloned().collect::<Vec<_>>();
    rollup_order.sort_unstable_by_key(|path| std::cmp::Reverse(path.components().count()));
    for directory in rollup_order {
        if directory == root { continue; }
        let size = *directory_bytes.get(&directory).unwrap_or(&0);
        if let Some(parent) = directory.parent() { if let Some(total) = directory_bytes.get_mut(parent) { *total = total.saturating_add(size); } }
    }
    let mut directories = directory_bytes.into_iter().collect::<Vec<_>>();
    directories.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    directories.truncate(500);
    // 目录也攒批发：渲染端一次性接收 top 500 目录。
    let mut directory_buffer: Vec<(String, u64)> = directories
        .into_iter()
        .map(|(path, size)| (path.to_string_lossy().into_owned(), size))
        .collect();
    emit_directories_batch(&mut directory_buffer);
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
    if command.as_deref() == Some(std::ffi::OsStr::new("usn-info")) {
        if let Some(root) = root { if let Err(error) = emit_usn_info(Path::new(&root)) { eprintln!("{error}"); std::process::exit(1); } return; }
    }
    let mut exclusions = HashSet::new();
    let mut skip_duplicates = false;
    let mut min_duplicate_size = 4_096_u64;
    while let Some(argument) = args.next() {
        if argument == std::ffi::OsStr::new("--exclude") {
            if let Some(value) = args.next() {
                exclusions.insert(normalized_name(&value.to_string_lossy()));
            }
        } else if argument == std::ffi::OsStr::new("--skip-duplicates") {
            skip_duplicates = true;
        } else if argument == std::ffi::OsStr::new("--min-duplicate-size") {
            if let Some(value) = args.next() { min_duplicate_size = value.to_string_lossy().parse().unwrap_or(4_096); }
        }
    }
    if command.as_deref() != Some(std::ffi::OsStr::new("scan")) || root.is_none() {
        eprintln!("usage: nwd-disk-scanner scan <directory>");
        std::process::exit(2);
    }
    let paused = Arc::new(AtomicBool::new(false));
    let command_flag = Arc::clone(&paused);
    thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            match line.trim() {
                "pause" => command_flag.store(true, Ordering::Relaxed),
                "resume" => command_flag.store(false, Ordering::Relaxed),
                _ => {}
            }
        }
    });
    if let Err(error) = scan(Path::new(&root.unwrap()), &exclusions, skip_duplicates, min_duplicate_size, paused) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{content_hash, normalized_name, retain_largest, same_content, should_exclude, BySize, FileResult};
    use std::cmp::Reverse;
    use std::collections::{BinaryHeap, HashSet};
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

    #[test]
    fn top_files_remain_bounded_for_large_streams() {
        let mut largest: BinaryHeap<Reverse<BySize>> = BinaryHeap::with_capacity(50);
        for size in 0..1_000_000_u64 {
            retain_largest(&mut largest, FileResult { path: size.to_string(), size, modified: 0, extension: String::new() }, 50);
        }
        // 验证堆容量始终为 50（不再依赖 Vec 长度收缩）
        assert_eq!(largest.len(), 50);
        let mut sorted = largest.into_sorted_vec();
        sorted.reverse();
        assert_eq!(sorted.len(), 50);
        // sorted[i] 是 Reverse<BySize<FileResult>>，解构出 FileResult
        let Reverse(BySize(top)) = &sorted[0];
        let Reverse(BySize(bottom)) = &sorted[49];
        assert_eq!(top.size, 999_999);
        assert_eq!(bottom.size, 999_950);
    }
}
