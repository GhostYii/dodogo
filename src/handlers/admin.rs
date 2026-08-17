//! 管理后台接口（/api/admin/*，仅系统管理员）

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::middleware::RequireAdmin;
use crate::models::{AuditLogDto, UserDto};
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::services;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/users", get(list_users))
        .route("/users/{id}", axum::routing::patch(update_user).delete(delete_user))
        .route("/users/{id}/reset-password", post(reset_password))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/audit-logs", get(audit_logs))
        .route("/system-info", get(system_info))
        .route("/backups", get(list_backups).post(create_backup))
        .route("/backups/{name}", axum::routing::delete(delete_backup))
}

#[derive(Deserialize)]
pub struct ListUsersQuery {
    page: Option<i64>,
    page_size: Option<i64>,
    q: Option<String>,
}

async fn list_users(State(state): State<AppState>, _admin: RequireAdmin, Query(q): Query<ListUsersQuery>) -> AppResult<impl IntoResponse> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * page_size;
    let users = repos::list_users(&state.pool, offset, page_size, q.q.as_deref()).await?;
    let total = repos::count_users(&state.pool).await?;
    let items: Vec<UserDto> = users.into_iter().map(UserDto::from).collect();
    Ok(ok(json!({ "items": items, "total": total, "page": page, "pageSize": page_size })))
}

#[derive(Deserialize)]
pub struct UpdateUserReq {
    status: Option<String>,
    role: Option<String>,
    display_name: Option<String>,
    email: Option<String>,
}

async fn update_user(State(state): State<AppState>, admin: RequireAdmin, Path(id): Path<i64>, Json(req): Json<UpdateUserReq>) -> AppResult<impl IntoResponse> {
    if id == admin.0.id && req.status.as_deref() == Some(crate::models::STATUS_DISABLED) {
        return Err(AppError::Business("不能禁用自己的账号".into()));
    }
    if let Some(status) = req.status.as_deref() {
        repos::set_user_status(&state.pool, id, status).await?;
        if status == crate::models::STATUS_DISABLED {
            repos::delete_user_sessions(&state.pool, id).await?;
        }
    }
    if let Some(role) = req.role.as_deref() {
        repos::set_user_role(&state.pool, id, role).await?;
    }
    if req.display_name.is_some() || req.email.is_some() {
        let u = repos::get_user_by_id(&state.pool, id).await?.ok_or(AppError::NotFound)?;
        repos::update_user_profile(
            &state.pool,
            id,
            req.display_name.as_deref().unwrap_or(&u.display_name),
            req.email.as_deref().or(u.email.as_deref()),
            None,
        )
        .await?;
    }
    repos::create_audit(&state.pool, Some(admin.0.id), "admin.update_user", "user", &id.to_string(), "{}", "").await.ok();
    Ok(ok_empty())
}

async fn delete_user(State(state): State<AppState>, admin: RequireAdmin, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    if id == admin.0.id {
        return Err(AppError::Business("不能删除自己的账号".into()));
    }
    repos::delete_user(&state.pool, id).await?;
    repos::create_audit(&state.pool, Some(admin.0.id), "admin.delete_user", "user", &id.to_string(), "{}", "").await.ok();
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct ResetPasswordReq {
    new_password: String,
}

async fn reset_password(State(state): State<AppState>, admin: RequireAdmin, Path(id): Path<i64>, Json(req): Json<ResetPasswordReq>) -> AppResult<impl IntoResponse> {
    services::validate_password(&req.new_password)?;
    let hash = crate::crypto::hash_password(&req.new_password)?;
    repos::update_user_password(&state.pool, id, &hash).await?;
    repos::delete_user_sessions(&state.pool, id).await?;
    repos::create_audit(&state.pool, Some(admin.0.id), "admin.reset_password", "user", &id.to_string(), "{}", "").await.ok();
    Ok(ok_empty())
}

async fn get_settings(State(state): State<AppState>, _admin: RequireAdmin) -> AppResult<impl IntoResponse> {
    let rows = repos::get_all_settings(&state.pool).await?;
    let map: serde_json::Map<String, serde_json::Value> = rows
        .into_iter()
        .map(|(k, v)| {
            let parsed = serde_json::from_str::<serde_json::Value>(&v).unwrap_or_else(|_| serde_json::Value::String(v));
            (k, parsed)
        })
        .collect();
    Ok(ok(map))
}

async fn put_settings(State(state): State<AppState>, admin: RequireAdmin, Json(req): Json<serde_json::Map<String, serde_json::Value>>) -> AppResult<impl IntoResponse> {
    for (k, v) in req {
        repos::set_setting(&state.pool, &k, &v.to_string()).await?;
    }
    repos::create_audit(&state.pool, Some(admin.0.id), "admin.update_settings", "settings", "", "{}", "").await.ok();
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct AuditQuery {
    page: Option<i64>,
    page_size: Option<i64>,
}

async fn audit_logs(State(state): State<AppState>, _admin: RequireAdmin, Query(q): Query<AuditQuery>) -> AppResult<impl IntoResponse> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * page_size;
    let rows = repos::list_audit_logs(&state.pool, page_size, offset).await?;
    let mut items = Vec::new();
    for a in rows {
        let u = match a.user_id {
            Some(uid) => repos::get_user_by_id(&state.pool, uid).await?,
            None => None,
        };
        items.push(AuditLogDto {
            id: a.id,
            user_id: a.user_id,
            username: u.map(|u| u.username),
            action: a.action,
            target_type: a.target_type,
            target_id: a.target_id,
            detail: a.detail_json,
            ip: a.ip,
            created_at: a.created_at,
        });
    }
    Ok(ok(items))
}

async fn system_info(State(state): State<AppState>, _admin: RequireAdmin) -> AppResult<impl IntoResponse> {
    let db_size = tokio::fs::metadata(state.config.db_path()).await.map(|m| m.len()).unwrap_or(0);
    let uploads_size = dir_size(&state.config.uploads_dir());
    let sessions = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE expires_at > ?")
        .bind(chrono::Utc::now())
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    Ok(ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "dbKind": "sqlite",
        "dbSize": db_size,
        "uploadsSize": uploads_size,
        "onlineSessions": sessions,
        "startedAt": state.started_at,
    })))
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_size(&entry.path());
                }
            }
        }
    }
    total
}

async fn list_backups(State(state): State<AppState>, _admin: RequireAdmin) -> AppResult<impl IntoResponse> {
    let mut items = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(state.config.backups_dir()).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if meta.is_file() {
                    items.push(json!({
                        "name": entry.file_name().to_string_lossy(),
                        "size": meta.len(),
                        "modifiedAt": meta.modified().ok().map(|t| {
                            chrono::DateTime::<chrono::Utc>::from(t)
                        }),
                    }));
                }
            }
        }
    }
    items.sort_by(|a, b| b["modifiedAt"].to_string().cmp(&a["modifiedAt"].to_string()));
    Ok(ok(items))
}

async fn create_backup(State(state): State<AppState>, admin: RequireAdmin) -> AppResult<impl IntoResponse> {
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let name = format!("dodogo-backup-{ts}.db");
    let target = state.config.backups_dir().join(&name);
    // 先 checkpoint 使 WAL 内容落盘，再复制数据库文件生成快照
    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&state.pool).await;
    tokio::fs::copy(state.config.db_path(), &target).await.map_err(|e| AppError::Internal(e.into()))?;
    repos::create_audit(&state.pool, Some(admin.0.id), "admin.backup", "backup", &name, "{}", "").await.ok();
    Ok(ok(json!({ "name": name })))
}

async fn delete_backup(State(state): State<AppState>, _admin: RequireAdmin, Path(name): Path<String>) -> AppResult<impl IntoResponse> {
    let name = name.replace("..", "");
    let target = state.config.backups_dir().join(&name);
    let _ = tokio::fs::remove_file(&target).await;
    Ok(ok_empty())
}
