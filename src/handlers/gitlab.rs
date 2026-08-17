//! GitLab 配置与同步接口

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::gitlab;
use crate::middleware::RequireAuth;
use crate::permission;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/projects/{key}/gitlab", get(get_config).put(put_config))
        .route("/projects/{key}/gitlab/sync", post(sync))
        .route("/projects/{key}/gitlab/test", post(test))
}

async fn load_project(state: &AppState, key: &str, user: &crate::middleware::CurrentUser) -> AppResult<crate::models::Project> {
    let p = repos::get_project_by_key(&state.pool, key).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, user).await?;
    Ok(p)
}

async fn get_config(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let cfg = repos::get_gitlab_config(&state.pool, p.id).await?;
    match cfg {
        Some(c) => Ok(ok(json!({
            "configured": true,
            "baseUrl": c.base_url,
            "mainRepo": c.main_repo,
            "matchRegex": if c.match_regex.is_empty() { gitlab::default_regex(&p.key) } else { c.match_regex },
            "autoComplete": c.auto_complete,
            "syncIntervalMinutes": c.sync_interval_minutes,
            "hasToken": !c.token_encrypted.is_empty(),
            "lastSyncAt": c.last_sync_at,
            "lastSyncStatus": c.last_sync_status,
            "lastSyncError": c.last_sync_error,
        }))),
        None => Ok(ok(json!({
            "configured": false,
            "baseUrl": "",
            "mainRepo": "",
            "matchRegex": gitlab::default_regex(&p.key),
            "autoComplete": false,
            "syncIntervalMinutes": 5,
            "hasToken": false,
            "lastSyncStatus": "",
        }))),
    }
}

#[derive(Deserialize)]
pub struct GitlabConfigReq {
    base_url: String,
    token: Option<String>,
    main_repo: String,
    match_regex: Option<String>,
    auto_complete: Option<bool>,
    sync_interval_minutes: Option<i64>,
    webhook_secret: Option<String>,
}

async fn put_config(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<GitlabConfigReq>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    gitlab::validate_base_url(&req.base_url)?;

    // 校验正则
    let match_regex = req.match_regex.clone().unwrap_or_else(|| gitlab::default_regex(&p.key));
    gitlab::compile_regex(&match_regex, &p.key)?;

    // 若提供了新令牌则加密，否则保留旧令牌
    let token_encrypted = match req.token.as_deref() {
        Some(t) if !t.is_empty() => crate::crypto::encrypt(&state.master_key, t)?,
        _ => {
            let old = repos::get_gitlab_config(&state.pool, p.id).await?;
            old.map(|c| c.token_encrypted).unwrap_or_default()
        }
    };

    repos::upsert_gitlab_config(
        &state.pool,
        p.id,
        &repos::GitlabConfigInput {
            base_url: req.base_url.trim().trim_end_matches('/').to_string(),
            token_encrypted,
            main_repo: req.main_repo.trim().to_string(),
            match_regex,
            auto_complete: req.auto_complete.unwrap_or(false),
            sync_interval_minutes: req.sync_interval_minutes.unwrap_or(5).max(1),
            webhook_secret: req.webhook_secret.unwrap_or_default(),
        },
    )
    .await?;
    Ok(ok_empty())
}

async fn sync(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_MEMBER).await?;
    match gitlab::sync_project(&state, p.id).await {
        Ok(report) => Ok(ok(report)),
        Err(e) => {
            let (status, error) = (e.code().to_string(), e.to_string());
            let _ = repos::update_gitlab_sync_status(&state.pool, p.id, &status, &error).await;
            Err(e)
        }
    }
}

async fn test(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<GitlabConfigReq>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    gitlab::validate_base_url(&req.base_url)?;
    let token = req.token.clone().unwrap_or_default();
    let client = gitlab::GitlabClient::new(&req.base_url, &token)?;
    client.test().await?;
    Ok(ok(json!({ "ok": true })))
}
