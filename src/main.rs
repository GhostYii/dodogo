//! DoDoGo 入口：配置加载、日志、数据库、后台任务、HTTP 服务。

use std::path::PathBuf;

use dodogo::config::Config;
use dodogo::db::init_pool;
use dodogo::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 解析命令行参数（支持 --config /path）
    let config_path = parse_config_path();

    let config = Config::load(config_path.as_deref())?;
    config.ensure_dirs()?;

    init_logging(&config);

    let master_key = dodogo::crypto::load_or_create_master_key(&config.master_key_file_path())?;
    let pool = init_pool(&config).await?;
    let state = AppState::new(pool, config.clone(), master_key);

    // 后台任务
    spawn_background(state.clone());

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    // 绑定后取实际端口（配置 port=0 时由系统自动分配空闲端口）
    let actual_port = listener.local_addr()?.port();
    // 将实际端口写入数据目录，便于桌面客户端/脚本发现
    let port_file = config.data_dir().join("server.port");
    let _ = std::fs::write(&port_file, actual_port.to_string());
    tracing::info!("DoDoGo 已启动: http://{}:{actual_port}", config.server.host);

    let router = dodogo::routes::build(state);
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn parse_config_path() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--config" || a == "-c")
        && let Some(v) = args.get(pos + 1) {
            return Some(PathBuf::from(v));
        }
    Some(PathBuf::from("config/config.toml"))
}

fn init_logging(config: &Config) {
    use tracing_subscriber::EnvFilter;
    let level = config.log.level.clone();
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&level));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).with_target(false).try_init();
}

fn spawn_background(state: AppState) {
    // 会话清理（每小时）
    let s1 = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(e) = dodogo::repos::delete_expired_sessions(&s1.pool).await {
                tracing::warn!("会话清理失败: {e}");
            }
        }
    });

    // GitLab 定时同步（每分钟扫描）
    let s2 = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            sync_gitlab_projects(&s2).await;
        }
    });
}

async fn sync_gitlab_projects(state: &AppState) {
    let projects = match dodogo::repos::list_projects_for_user_poll(&state.pool).await {
        Ok(p) => p,
        Err(_) => return,
    };
    for project in projects {
        let Ok(Some(cfg)) = dodogo::repos::get_gitlab_config(&state.pool, project.id).await else {
            continue;
        };
        if cfg.base_url.is_empty() || cfg.main_repo.is_empty() {
            continue;
        }
        let due = cfg.last_sync_at.map(|t| {
            chrono::Utc::now() - t > chrono::Duration::minutes(cfg.sync_interval_minutes.max(1))
        });
        if due.unwrap_or(true)
            && let Err(e) = dodogo::gitlab::sync_project(state, project.id).await {
                let _ = dodogo::repos::update_gitlab_sync_status(&state.pool, project.id, &e.code().to_string(), &e.to_string()).await;
            }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("监听 Ctrl+C 失败");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("监听 SIGTERM 失败")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("正在优雅停机…");
}
