//! 后台任务队列（部署 / 卸载 / 校验），进度通过 Tauri 事件推送

use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Task {
    pub id: String,
    pub name: String,
    #[allow(dead_code)]
    pub kind: String,
    pub params: serde_json::Value,
    pub status: String, // queued | running | paused | success | failed | cancelled
    pub progress: f64,
    pub received: u64,
    pub total: u64,
    pub speed: u64,
    pub error: String,
    pub result: serde_json::Value,
    pub logs: Vec<serde_json::Value>,
    pub created_at: i64,
    #[allow(dead_code)]
    pub retries: u32,
}

pub struct TaskManager {
    pub tasks: Arc<Mutex<Vec<Arc<Mutex<Task>>>>>,
    pub signals: Arc<Mutex<HashMap<String, Arc<Mutex<TaskSignal>>>>>,
    pub max_concurrent: Arc<Mutex<usize>>,
}

#[derive(Default)]
pub struct TaskSignal {
    pub paused: bool,
    pub cancelled: bool,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(Vec::new())),
            signals: Arc::new(Mutex::new(HashMap::new())),
            max_concurrent: Arc::new(Mutex::new(2)),
        }
    }

    pub fn list(&self) -> Vec<serde_json::Value> {
        self.tasks
            .lock()
            .unwrap()
            .iter()
            .map(|t| serialize(&t.lock().unwrap()))
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<serde_json::Value> {
        self.tasks
            .lock()
            .unwrap()
            .iter()
            .find(|t| t.lock().unwrap().id == id)
            .map(|t| serialize(&t.lock().unwrap()))
    }

    pub fn create(&self, name: &str, kind: &str, params: serde_json::Value) -> serde_json::Value {
        let task = Task {
            id: format!("t-{}-{:x}", chrono::Local::now().format("%Y%m%d%H%M%S"), uuid::Uuid::new_v4().as_u128() as u16),
            name: name.to_string(),
            kind: kind.to_string(),
            params,
            status: "queued".into(),
            progress: 0.0,
            received: 0,
            total: 0,
            speed: 0,
            error: String::new(),
            result: serde_json::Value::Null,
            logs: vec![json!({ "at": chrono::Utc::now().timestamp_millis(), "level": "info", "text": "任务已创建，等待调度" })],
            created_at: chrono::Utc::now().timestamp_millis(),
            retries: 0,
        };
        let id = task.id.clone();
        let arc = Arc::new(Mutex::new(task));
        {
            let mut list = self.tasks.lock().unwrap();
            list.insert(0, arc.clone());
        }
        let signals = self.signals.clone();
        signals.lock().unwrap().insert(id.clone(), Arc::new(Mutex::new(TaskSignal::default())));
        let guard = arc.lock().unwrap();
        let snapshot = serialize(&guard);
        drop(guard);
        snapshot
    }

    pub fn update(&self, id: &str, f: &mut dyn FnMut(&mut Task)) {
        if let Some(t) = self.tasks.lock().unwrap().iter().find(|x| x.lock().unwrap().id == id) {
            let mut guard = t.lock().unwrap();
            f(&mut guard);
        }
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(s) = self.signals.lock().unwrap().get(id) {
            s.lock().unwrap().cancelled = true;
            s.lock().unwrap().paused = false;
            return true;
        }
        self.update(id, &mut |t: &mut Task| {
            if ["queued", "paused"].contains(&t.status.as_str()) {
                t.status = "cancelled".into();
                t.error = "任务已取消".into();
            }
        });
        true
    }

    pub fn pause(&self, id: &str) -> bool {
        if let Some(s) = self.signals.lock().unwrap().get(id) {
            s.lock().unwrap().paused = true;
            self.update(id, &mut |t: &mut Task| t.status = "paused".into());
            return true;
        }
        false
    }

    pub fn resume(&self, id: &str) -> bool {
        if let Some(s) = self.signals.lock().unwrap().get(id) {
            s.lock().unwrap().paused = false;
            self.update(id, &mut |t: &mut Task| t.status = "running".into());
            return true;
        }
        false
    }

    pub fn clear_finished(&self) -> usize {
        let mut tasks = self.tasks.lock().unwrap();
        let before = tasks.len();
        tasks.retain(|t| {
            let s = t.lock().unwrap().status.clone();
            !["success", "cancelled"].contains(&s.as_str())
        });
        before - tasks.len()
    }

    pub fn set_concurrency(&self, n: usize) -> usize {
        let v = n.clamp(1, 5);
        *self.max_concurrent.lock().unwrap() = v;
        v
    }

    pub fn concurrency(&self) -> usize {
        *self.max_concurrent.lock().unwrap()
    }

    pub fn list_handle(&self) -> Arc<Mutex<Vec<Arc<Mutex<Task>>>>> {
        self.tasks.clone()
    }

    pub fn log(&self, id: &str, text: &str, level: &str) {
        self.update(id, &mut |t: &mut Task| {
            t.logs.push(json!({ "at": chrono::Utc::now().timestamp_millis(), "level": level, "text": text }));
            if t.logs.len() > 500 {
                t.logs.remove(0);
            }
        });
        crate::store::write_log(level, &format!("[任务] {}", text), None);
    }

    pub fn progress(&self, id: &str, percent: f64, phase: &str) {
        self.update(id, &mut |t: &mut Task| {
            t.progress = percent.clamp(0.0, 100.0);
            if !phase.is_empty() {
                t.params["phase"] = json!(phase);
            }
        });
    }
}

pub fn serialize(t: &Task) -> serde_json::Value {
    let mut logs = t.logs.clone();
    if logs.len() > 30 {
        logs = logs.split_off(logs.len() - 30);
    }
    json!({
        "id": t.id, "name": t.name, "type": t.kind, "status": t.status,
        "progress": t.progress, "received": t.received, "total": t.total, "speed": t.speed,
        "error": t.error, "result": t.result, "logs": logs, "createdAt": t.created_at
    })
}

/* ------------------------------ 部署执行 ------------------------------ */

/// 下载文件（支持进度回调、暂停、取消、断点续传）
pub fn download_file(
    url: &str,
    dest: &Path,
    signal: &Arc<Mutex<TaskSignal>>,
    on_progress: &dyn Fn(u64, u64, u64),
) -> Result<(u64, String), String> {
    let mut received: u64 = 0;
    if let Ok(meta) = std::fs::metadata(dest) {
        received = meta.len();
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .build();
    let resp = loop {
        if signal.lock().unwrap().cancelled {
            return Err("任务已取消".into());
        }
        while signal.lock().unwrap().paused {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if signal.lock().unwrap().cancelled {
                return Err("任务已取消".into());
            }
        }
        let mut req = agent.get(url);
        if received > 0 {
            req = req.set("Range", &format!("bytes={}-", received));
        }
        match req.call() {
            Ok(r) => break r,
            Err(ureq::Error::Status(code, _)) if (300..400).contains(&code) => {
                return Err(format!("HTTP {} 需要重定向支持", code))
            }
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(2));
                continue;
            }
        }
    };

    let total_header = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let append = resp.status() == 206 && received > 0;
    if !(append) {
        received = 0;
    }
    let total = if total_header > 0 { total_header + received } else { 0 };

    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(append)
        .open(dest)
        .map_err(|e| format!("创建文件失败：{}", e))?;

    let mut reader = resp.into_reader();
    let mut buf = [0u8; 65536];
    let mut last = std::time::Instant::now();
    let mut last_received = received;
    loop {
        if signal.lock().unwrap().cancelled {
            return Err("任务已取消".into());
        }
        while signal.lock().unwrap().paused {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if signal.lock().unwrap().cancelled {
                return Err("任务已取消".into());
            }
        }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                use std::io::Write;
                received += n as u64;
                if file.write_all(&buf[..n]).is_err() {
                    return Err("写入文件失败".into());
                }
                let now = std::time::Instant::now();
                if now.duration_since(last).as_millis() >= 400 {
                    let speed = ((received - last_received) as f64 / now.duration_since(last).as_secs_f64()) as u64;
                    last = now;
                    last_received = received;
                    on_progress(received, total, speed);
                }
            }
            Err(e) => return Err(format!("下载中断：{}", e)),
        }
    }
    on_progress(received, total, 0);

    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    use std::io::Read;
    if let Ok(mut f) = std::fs::File::open(dest) {
        let mut chunk = [0u8; 65536];
        loop {
            match f.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => hasher.update(&chunk[..n]),
                Err(_) => break,
            }
        }
    }
    Ok((size, hex(&hasher.finalize())))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn flatten_single_dir(dir: &Path) {
    let entries: Vec<_> = std::fs::read_dir(dir).map(|r| r.flatten().collect()).unwrap_or_default();
    if entries.len() == 1 && entries[0].path().is_dir() {
        let inner = entries[0].path();
        let tmp = dir.parent().unwrap_or(Path::new(".")).join(format!(".wem-tmp-{}", uuid::Uuid::new_v4()));
        if std::fs::rename(&inner, &tmp).is_ok() {
            let _ = std::fs::remove_dir_all(dir);
            let _ = std::fs::rename(&tmp, dir);
        }
    }
}

pub fn find_exe_in(dir: &str, exe_name: &str) -> String {
    if exe_name.is_empty() {
        return String::new();
    }
    for sub in ["", "bin", "cmd"] {
        let p = if sub.is_empty() {
            PathBuf::from(dir).join(exe_name)
        } else {
            PathBuf::from(dir).join(sub).join(exe_name)
        };
        if p.exists() {
            return p.display().to_string();
        }
    }
    String::new()
}

pub use sha2::Digest as _ShaDigest;
use sha2::Sha256;
