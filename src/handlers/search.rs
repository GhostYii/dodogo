//! 全局搜索接口

use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::json;

use crate::error::AppResult;
use crate::middleware::RequireAuth;
use crate::repos;
use crate::response::ok;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new().route("/", get(search))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
}

async fn search(State(state): State<AppState>, user: RequireAuth, Query(q): Query<SearchQuery>) -> AppResult<impl IntoResponse> {
    let q = q.q.unwrap_or_default().trim().to_string();
    if q.is_empty() {
        return Ok(ok(Vec::<serde_json::Value>::new()));
    }
    // 单号精确匹配优先：形如 `DODG-12` 或 `#12`
    let mut exact: Option<serde_json::Value> = None;
    let cleaned = q.trim_start_matches('#');
    if let Some((key, no)) = cleaned.rsplit_once('-')
        && let Ok(no) = no.parse::<i64>()
            && let Some(project) = repos::get_project_by_key(&state.pool, key).await?
                && let Ok(Some(card)) = repos::get_card_by_no(&state.pool, project.id, no).await {
                    exact = Some(json!({
                        "id": card.id,
                        "no": card.no,
                        "number": format!("{}-{}", project.key, card.no),
                        "title": card.title,
                        "projectKey": project.key,
                        "projectName": project.name,
                    }));
                }

    let rows = repos::search_cards(&state.pool, user.0.id, &q).await?;
    let mut items: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.card_id,
                "no": r.card_no,
                "number": format!("{}-{}", r.project_key, r.card_no),
                "title": r.title,
                "projectKey": r.project_key,
                "projectName": r.project_name,
                "boardName": r.board_name,
                "columnName": r.column_name,
                "updatedAt": r.updated_at,
            })
        })
        .collect();

    if let Some(e) = exact {
        items.insert(0, e);
    }
    Ok(ok(items))
}
