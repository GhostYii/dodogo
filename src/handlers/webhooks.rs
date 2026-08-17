//! GitLab Webhook 回调（签名校验 + 提交关联）

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::gitlab;
use crate::repos::{self, GitCommitInput};
use crate::response::ok;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::post;
    axum::Router::new().route("/webhooks/gitlab/{project_id}", post(handle))
}

#[derive(Deserialize)]
struct WebhookPayload {
    #[serde(default)]
    object_kind: String,
    #[serde(default)]
    commits: Vec<WebhookCommit>,
    #[serde(default)]
    repository: Option<WebhookRepo>,
}

#[derive(Deserialize)]
struct WebhookRepo {
    #[serde(default)]
    name: String,
    #[serde(default)]
    homepage: String,
}

#[derive(Deserialize)]
struct WebhookCommit {
    id: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    author: Option<WebhookAuthor>,
    #[serde(default)]
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct WebhookAuthor {
    #[serde(default)]
    name: String,
    #[serde(default)]
    email: String,
}

async fn handle(
    State(state): State<AppState>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
    Json(payload): Json<WebhookPayload>,
) -> AppResult<impl IntoResponse> {
    let project = repos::get_project_by_id(&state.pool, project_id).await?.ok_or(AppError::NotFound)?;
    let Some(cfg) = repos::get_gitlab_config(&state.pool, project_id).await? else {
        return Err(AppError::NotFound);
    };

    // 校验签名
    let provided = headers.get("x-gitlab-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    if cfg.webhook_secret.is_empty() || provided != cfg.webhook_secret {
        return Err(AppError::Forbidden);
    }

    if payload.object_kind == "push" {
        let regex = gitlab::compile_regex(&cfg.match_regex, &project.key)?;
        let repo = payload.repository.as_ref().map(|r| r.name.clone()).unwrap_or_else(|| cfg.main_repo.clone());
        let homepage = payload.repository.as_ref().map(|r| r.homepage.clone()).unwrap_or_default();
        for c in &payload.commits {
            let Some(no) = gitlab::match_card_no(&c.message, &regex) else {
                continue;
            };
            let card = repos::get_card_by_no(&state.pool, project_id, no).await?;
            let committed_at = c
                .timestamp
                .as_deref()
                .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                .map(|d| d.with_timezone(&chrono::Utc));
            let commit_url = if c.url.is_empty() {
                format!("{}/-/commit/{}", homepage.trim_end_matches('/'), c.id)
            } else {
                c.url.clone()
            };
            repos::insert_git_commit(
                &state.pool,
                &GitCommitInput {
                    project_id,
                    card_id: card.as_ref().map(|c| c.id),
                    repo: repo.clone(),
                    commit_sha: c.id.clone(),
                    author_name: c.author.as_ref().map(|a| a.name.clone()).unwrap_or_default(),
                    author_email: c.author.as_ref().map(|a| a.email.clone()).unwrap_or_default(),
                    message: c.message.clone(),
                    committed_at,
                    commit_url,
                    mr_url: String::new(),
                    matched_no: Some(no),
                },
            )
            .await?;
        }
        repos::update_gitlab_sync_status(&state.pool, project_id, "ok", "").await?;
    }

    Ok(ok(json!({ "received": true })))
}
