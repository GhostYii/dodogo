//! 通知接口

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::AppResult;
use crate::middleware::RequireAuth;
use crate::models::NotificationDto;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(list).post(mark_read))
        .route("/unread-count", get(unread_count))
        .route("/read-all", post(read_all))
        .route("/{id}/read", post(mark_one_read))
        .route("/preferences", get(get_preferences).put(put_preferences))
}

#[derive(Deserialize)]
pub struct ListQuery {
    page: Option<i64>,
    page_size: Option<i64>,
}

async fn list(State(state): State<AppState>, user: RequireAuth, Query(q): Query<ListQuery>) -> AppResult<impl IntoResponse> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * page_size;
    let rows = repos::list_notifications(&state.pool, user.0.id, page_size, offset).await?;
    let items: Vec<NotificationDto> = rows.into_iter().map(NotificationDto::from).collect();
    Ok(ok(items))
}

async fn unread_count(State(state): State<AppState>, user: RequireAuth) -> AppResult<impl IntoResponse> {
    let n = repos::count_unread_notifications(&state.pool, user.0.id).await?;
    Ok(ok(json!({ "count": n })))
}

#[derive(Deserialize)]
pub struct MarkReadReq {
    ids: Option<Vec<i64>>,
}

async fn mark_read(State(state): State<AppState>, user: RequireAuth, Json(req): Json<MarkReadReq>) -> AppResult<impl IntoResponse> {
    if let Some(ids) = req.ids {
        for id in ids {
            repos::mark_notification_read(&state.pool, id, user.0.id).await?;
        }
    }
    Ok(ok_empty())
}

async fn mark_one_read(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    repos::mark_notification_read(&state.pool, id, user.0.id).await?;
    Ok(ok_empty())
}

async fn read_all(State(state): State<AppState>, user: RequireAuth) -> AppResult<impl IntoResponse> {
    repos::mark_all_notifications_read(&state.pool, user.0.id).await?;
    Ok(ok_empty())
}

async fn get_preferences(State(state): State<AppState>, user: RequireAuth) -> AppResult<impl IntoResponse> {
    let key = format!("notify_prefs:{}", user.0.id);
    let raw = repos::get_setting(&state.pool, &key).await?.unwrap_or_else(|| default_prefs());
    let prefs: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::from_str(&default_prefs()).unwrap());
    Ok(ok(prefs))
}

async fn put_preferences(State(state): State<AppState>, user: RequireAuth, Json(req): Json<serde_json::Value>) -> AppResult<impl IntoResponse> {
    let key = format!("notify_prefs:{}", user.0.id);
    repos::set_setting(&state.pool, &key, &req.to_string()).await?;
    Ok(ok_empty())
}

fn default_prefs() -> String {
    json!({
        "assigned": true,
        "mentioned": true,
        "comment": true,
        "moved": true,
        "due_soon": true,
        "milestone": true,
        "gitlab": true,
        "member": true
    })
    .to_string()
}
