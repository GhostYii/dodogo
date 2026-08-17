//! 配置加载：默认值 < config.toml < 环境变量（DODOGO_ 前缀）
//! 优先级见《02-技术设计文档》§4.1

use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub server: ServerConfig,
    pub data_dir: String,
    pub database: DatabaseConfig,
    pub security: SecurityConfig,
    pub upload: UploadConfig,
    pub gitlab: GitlabConfig,
    pub backup: BackupConfig,
    pub smtp: SmtpConfig,
    pub log: LogConfig,
    pub master_key_file: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { host: "127.0.0.1".into(), port: 8080 }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct DatabaseConfig {
    pub kind: String,
    pub url: String,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self { kind: "sqlite".into(), url: String::new() }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct SecurityConfig {
    pub session_ttl_hours: i64,
    pub remember_ttl_days: i64,
    pub login_max_fail: u32,
    pub login_lock_minutes: i64,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            session_ttl_hours: 12,
            remember_ttl_days: 30,
            login_max_fail: 5,
            login_lock_minutes: 15,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct UploadConfig {
    pub max_image_mb: usize,
    pub max_file_mb: usize,
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self { max_image_mb: 10, max_file_mb: 100 }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct GitlabConfig {
    pub sync_interval_minutes: u64,
    pub default_regex: String,
}

impl Default for GitlabConfig {
    fn default() -> Self {
        Self {
            sync_interval_minutes: 5,
            default_regex: "(?i)(?:#|{KEY}-)(\\d+)".into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct BackupConfig {
    pub enabled: bool,
    pub interval_days: u32,
    pub keep: u32,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self { enabled: true, interval_days: 1, keep: 7 }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct SmtpConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl Default for SmtpConfig {
    fn default() -> Self {
        Self { enabled: false, host: String::new(), port: 587, username: String::new(), password: String::new() }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct LogConfig {
    pub level: String,
    pub file: String,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self { level: "info".into(), file: String::new() }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            data_dir: "./data".into(),
            database: DatabaseConfig::default(),
            security: SecurityConfig::default(),
            upload: UploadConfig::default(),
            gitlab: GitlabConfig::default(),
            backup: BackupConfig::default(),
            smtp: SmtpConfig::default(),
            log: LogConfig::default(),
            master_key_file: String::new(),
        }
    }
}

impl Config {
    /// 加载配置：读取可选 config.toml，再用环境变量覆盖。
    pub fn load(path: Option<&Path>) -> anyhow::Result<Self> {
        let mut cfg = Config::default();
        if let Some(p) = path {
            if p.exists() {
                let text = std::fs::read_to_string(p)?;
                let file_cfg: Config = toml::from_str(&text)?;
                cfg = file_cfg;
            }
        }
        cfg.apply_env();
        Ok(cfg)
    }

    fn apply_env(&mut self) {
        use std::env;
        fn set_str(target: &mut String, name: &str) {
            if let Ok(v) = env::var(format!("DODOGO_{name}")) {
                *target = v;
            }
        }
        fn set_u16(target: &mut u16, name: &str) {
            if let Ok(v) = env::var(format!("DODOGO_{name}")) {
                if let Ok(n) = v.parse() {
                    *target = n;
                }
            }
        }
        fn set_usize(target: &mut usize, name: &str) {
            if let Ok(v) = env::var(format!("DODOGO_{name}")) {
                if let Ok(n) = v.parse() {
                    *target = n;
                }
            }
        }
        set_str(&mut self.server.host, "SERVER_HOST");
        set_u16(&mut self.server.port, "SERVER_PORT");
        set_str(&mut self.data_dir, "DATA_DIR");
        set_str(&mut self.database.url, "DATABASE_URL");
        set_usize(&mut self.upload.max_image_mb, "UPLOAD_MAX_IMAGE_MB");
        set_usize(&mut self.upload.max_file_mb, "UPLOAD_MAX_FILE_MB");
        set_str(&mut self.master_key_file, "MASTER_KEY_FILE");
        if let Ok(v) = env::var("DODOGO_LOG_LEVEL") {
            self.log.level = v;
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        PathBuf::from(&self.data_dir)
    }

    pub fn uploads_dir(&self) -> PathBuf {
        self.data_dir().join("uploads")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir().join("backups")
    }

    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir().join("tmp")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.data_dir().join("logs")
    }

    pub fn db_path(&self) -> PathBuf {
        if !self.database.url.is_empty() {
            PathBuf::from(&self.database.url)
        } else {
            self.data_dir().join("dodogo.db")
        }
    }

    /// 首个管理员账号是否已存在（初始化向导判定）。
    pub fn master_key_file_path(&self) -> PathBuf {
        if !self.master_key_file.is_empty() {
            PathBuf::from(&self.master_key_file)
        } else {
            self.data_dir().join(".master_key")
        }
    }

    pub fn ensure_dirs(&self) -> anyhow::Result<()> {
        for d in [
            self.data_dir(),
            self.uploads_dir(),
            self.backups_dir(),
            self.tmp_dir(),
            self.logs_dir(),
        ] {
            std::fs::create_dir_all(&d)?;
        }
        Ok(())
    }
}
