//! 全局共享状态与 SSE 广播事件

use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::config::Config;

/// SSE 广播事件（客户端按 channel 过滤）。
#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub channel: String,
    pub event: String,
    pub data: String,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub tx: broadcast::Sender<StreamEvent>,
    /// 主密钥（32 字节，用于 GitLab Token AES-256-GCM 加密）。
    pub master_key: Arc<[u8; 32]>,
    /// 进程启动时间。
    pub started_at: chrono::DateTime<chrono::Utc>,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: Config, master_key: [u8; 32]) -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self {
            pool,
            config: Arc::new(config),
            tx,
            master_key: Arc::new(master_key),
            started_at: chrono::Utc::now(),
        }
    }

    /// 发布 SSE 事件到指定频道。
    pub fn broadcast(&self, channel: &str, event: &str, data: impl Serialize) {
        let data = serde_json::to_string(&data).unwrap_or_else(|_| "{}".into());
        let _ = self.tx.send(StreamEvent {
            channel: channel.into(),
            event: event.into(),
            data,
        });
    }
}
