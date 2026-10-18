//! 软件目录 / 市场清单 / 镜像解析

use serde_json::{json, Value};

pub const CATALOG_JSON: &str = r#"[
  {"id":"node","name":"Node.js","ruleId":"node","category":"语言运行时","description":"Node.js JavaScript 运行时，含 npm；绿色版解压即用","versions":["22.11.0","20.18.0","18.20.4"],"installMode":"portable","sizeHint":"约 30 MB","requires":[],"official":"https://nodejs.org/dist/v{version}/node-v{version}-win-x64.zip","mirrorKey":"nodejs","mirrorTemplate":"{mirror}/v{version}/node-v{version}-win-x64.zip"},
  {"id":"python","name":"Python","ruleId":"python","category":"语言运行时","description":"Python 官方安装包，静默安装","versions":["3.13.0","3.12.7","3.11.9"],"installMode":"silent","silentArgs":"/quiet InstallAllUsers=0 PrependPath=0 Include_test=0 TargetDir={dir}","sizeHint":"约 25 MB","requires":[],"official":"https://www.python.org/ftp/python/{version}/python-{version}-amd64.exe","mirrorKey":"python","mirrorTemplate":"{mirror}/{version}/python-{version}-amd64.exe"},
  {"id":"go","name":"Go","ruleId":"go","category":"语言运行时","description":"Go 工具链，绿色版解压即用","versions":["1.23.2","1.22.8"],"installMode":"portable","sizeHint":"约 80 MB","requires":[],"official":"https://go.dev/dl/go{version}.windows-amd64.zip","mirrorKey":"golang","mirrorTemplate":"{mirror}/go{version}.windows-amd64.zip"},
  {"id":"jdk","name":"JDK (Temurin 17)","ruleId":"jdk","category":"语言运行时","description":"Eclipse Temurin OpenJDK 17，绿色版解压即用","versions":["jdk-17.0.12+7"],"installMode":"portable","sizeHint":"约 190 MB","requires":[],"official":"https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip","mirrorKey":"jdk","mirrorTemplate":"{mirror}/17/jdk/openjdk/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip"},
  {"id":"git","name":"Git for Windows","ruleId":"git","category":"构建&包管理","description":"Git 版本控制，静默安装","versions":["2.47.0"],"installMode":"silent","silentArgs":"/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /DIR={dir}","sizeHint":"约 65 MB","requires":[],"official":"https://github.com/git-for-windows/git/releases/download/v{version}.windows.1/Git-{version}-64-bit.exe","mirrorKey":"github","mirrorTemplate":"{mirror}/git-for-windows/git/releases/download/v{version}.windows.1/Git-{version}-64-bit.exe"},
  {"id":"maven","name":"Maven","ruleId":"maven","category":"构建&包管理","description":"Apache Maven 构建工具，绿色版解压即用","versions":["3.9.9","3.8.8"],"installMode":"portable","sizeHint":"约 9 MB","requires":["jdk"],"official":"https://dlcdn.apache.org/maven/maven-3/{version}/binaries/apache-maven-{version}-bin.zip","mirrorKey":"maven","mirrorTemplate":"{mirror}/maven-3/{version}/binaries/apache-maven-{version}-bin.zip"},
  {"id":"gradle","name":"Gradle","ruleId":"gradle","category":"构建&包管理","description":"Gradle 构建工具，绿色版解压即用","versions":["8.10.2","7.6.4"],"installMode":"portable","sizeHint":"约 130 MB","requires":["jdk"],"official":"https://services.gradle.org/distributions/gradle-{version}-bin.zip","mirrorKey":"gradle","mirrorTemplate":"{mirror}/gradle-{version}-bin.zip"},
  {"id":"7zip","name":"7-Zip","ruleId":"7zip","category":"IDE与工具","description":"高压缩比文件压缩工具","versions":["24.08"],"installMode":"silent","silentArgs":"/S /D={dir}","sizeHint":"约 1.6 MB","requires":[],"official":"https://www.7-zip.org/a/7z2408-x64.exe"},
  {"id":"vscode","name":"VS Code","ruleId":"vscode","category":"IDE与工具","description":"Visual Studio Code 编辑器（用户版静默安装）","versions":["1.95.0"],"installMode":"silent","silentArgs":"/VERYSILENT /NORESTART /MERGETASKS=!runcode /DIR={dir}","sizeHint":"约 100 MB","requires":[],"official":"https://update.code.visualstudio.com/{version}/win32-x64-user/stable"},
  {"id":"kubectl","name":"kubectl","ruleId":"kubectl","category":"容器虚拟化","description":"Kubernetes 命令行工具","versions":["1.31.2"],"installMode":"portable","sizeHint":"约 55 MB","requires":[],"official":"https://dl.k8s.io/release/v{version}/bin/windows/amd64/kubectl.exe"},
  {"id":"terraform","name":"Terraform","ruleId":"terraform","category":"容器虚拟化","description":"HashiCorp 基础设施即代码工具","versions":["1.9.8"],"installMode":"portable","sizeHint":"约 30 MB","requires":[],"official":"https://releases.hashicorp.com/terraform/{version}/terraform_{version}_windows_amd64.zip"},
  {"id":"ffmpeg","name":"FFmpeg","ruleId":"ffmpeg","category":"多媒体编译","description":"音视频处理工具","versions":["7.1"],"installMode":"portable","sizeHint":"约 90 MB","requires":[],"official":"https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"},
  {"id":"nginx","name":"Nginx","ruleId":"nginx","category":"运维网络","description":"高性能 Web 服务器 / 反向代理","versions":["1.27.2"],"installMode":"portable","sizeHint":"约 2 MB","requires":[],"official":"https://nginx.org/download/nginx-{version}.zip"},
  {"id":"cmake","name":"CMake","ruleId":"cmake","category":"构建&包管理","description":"跨平台构建系统生成器","versions":["3.30.5"],"installMode":"silent","silentArgs":"/S /D={dir}","sizeHint":"约 30 MB","requires":[],"official":"https://github.com/Kitware/CMake/releases/download/v{version}/cmake-{version}-windows-x86_64.zip","mirrorKey":"github","mirrorTemplate":"{mirror}/Kitware/CMake/releases/download/v{version}/cmake-{version}-windows-x86_64.zip"},
  {"id":"redis","name":"Redis (Windows)","ruleId":"redis","category":"数据库中间件","description":"Redis Windows 移植版，支持注册服务","versions":["5.0.14.1"],"installMode":"portable","registerService":true,"postInstallScript":"redis-server.exe --service-install redis.windows.conf","sizeHint":"约 8 MB","requires":[],"official":"https://github.com/tporadowski/redis/releases/download/v{version}/Redis-x64-{version}.zip","mirrorKey":"github","mirrorTemplate":"{mirror}/tporadowski/redis/releases/download/v{version}/Redis-x64-{version}.zip"},
  {"id":"sqlite","name":"SQLite","ruleId":"sqlite","category":"数据库中间件","description":"SQLite 命令行工具","versions":["3.46.1"],"installMode":"portable","sizeHint":"约 5 MB","requires":[],"official":"https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip"},
  {"id":"nssm","name":"NSSM","ruleId":"nssm","category":"运维网络","description":"把任意 exe 注册为 Windows 服务的工具","versions":["2.24"],"installMode":"portable","sizeHint":"约 300 KB","requires":[],"official":"https://nssm.cc/release/nssm-2.24.zip"}
]"#;

pub fn builtin_catalog() -> Value {
    serde_json::from_str(CATALOG_JSON).unwrap_or(json!([]))
}

pub fn load_catalog() -> Value {
    let builtin = builtin_catalog();
    let mut list = builtin.as_array().cloned().unwrap_or_default();
    let user = crate::store::read_json_file(&user_catalog_file(), json!({ "items": [] }));
    if let Some(items) = user["items"].as_array() {
        for i in items {
            let id = i["id"].as_str().unwrap_or("");
            if let Some(pos) = list.iter().position(|x| x["id"].as_str() == Some(id)) {
                list[pos] = i.clone();
            } else {
                list.push(i.clone());
            }
        }
    }
    Value::Array(list)
}

fn user_catalog_file() -> PathBuf {
    crate::store::app_data_dir().join("catalog.json")
}

use std::path::PathBuf;

pub const MIRRORS: &[(&str, &str)] = &[
    ("nodejs", "https://npmmirror.com/mirrors/node"),
    ("python", "https://npmmirror.com/mirrors/python"),
    ("golang", "https://mirrors.aliyun.com/golang"),
    ("jdk", "https://mirrors.tuna.tsinghua.edu.cn/Adoptium"),
    ("maven", "https://mirrors.tuna.tsinghua.edu.cn/apache/maven"),
    ("gradle", "https://mirrors.cloud.tencent.com/gradle"),
    ("github", "https://ghfast.top/https://github.com"),
];

pub fn resolve_url(item: &Value, version: &str, source: &str, custom_mirror: Option<&str>) -> String {
    let mut tpl = item["official"].as_str().unwrap_or("").to_string();
    if source == "mirror" {
        let key = item["mirrorKey"].as_str().unwrap_or("");
        let base = custom_mirror
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| MIRRORS.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string()))
            .unwrap_or_default();
        let mt = item["mirrorTemplate"].as_str().unwrap_or("");
        if !mt.is_empty() && !base.is_empty() {
            tpl = mt.replace("{mirror}", base.trim_end_matches('/'));
        } else if !base.is_empty() {
            if let Some(pos) = tpl.find("://") {
                if let Some(slash) = tpl[pos + 3..].find('/') {
                    let host = &tpl[pos + 3..pos + 3 + slash];
                    tpl = tpl.replacen(host, &base.trim_end_matches('/'), 1);
                }
            }
        }
    }
    tpl.replace("{version}", version).replace("{arch}", "win-x64")
}
