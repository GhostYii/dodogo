//! 里程碑与版本接口

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::middleware::RequireAuth;
use crate::models::{MetaCardDto, MilestoneDetailDto, MilestoneDto, VersionDetailDto, VersionDto};
use crate::permission;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/projects/{key}/milestones", get(list_milestones).post(create_milestone))
        .route("/milestones/{id}", get(get_milestone).patch(update_milestone).delete(delete_milestone))
        .route("/projects/{key}/releases", get(list_releases).post(create_release))
        .route("/releases/{id}", get(get_release).patch(update_release).delete(delete_release))
}

async fn load_project(state: &AppState, key: &str, user: &crate::middleware::CurrentUser) -> AppResult<crate::models::Project> {
    let p = repos::get_project_by_key(&state.pool, key).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, user).await?;
    Ok(p)
}

// ============ 里程碑 ============

#[derive(Deserialize)]
pub struct MilestoneReq {
    name: String,
    description: Option<String>,
    start_date: Option<chrono::NaiveDate>,
    due_date: Option<chrono::NaiveDate>,
    status: Option<String>,
    color: Option<String>,
}

fn milestone_input(req: &MilestoneReq) -> repos::MilestoneInput {
    repos::MilestoneInput {
        name: req.name.clone(),
        description: req.description.clone().unwrap_or_default(),
        start_date: req.start_date,
        due_date: req.due_date,
        status: req.status.clone().unwrap_or_else(|| "open".into()),
        color: req.color.clone().unwrap_or_else(|| "#3B82F6".into()),
    }
}

async fn list_milestones(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    let rows = repos::list_milestones(&state.pool, p.id).await?;
    let mut items = Vec::new();
    for m in rows {
        let stats = repos::milestone_stats(&state.pool, m.id).await?;
        items.push(MilestoneDto {
            id: m.id,
            name: m.name,
            description: m.description,
            start_date: m.start_date,
            due_date: m.due_date,
            status: m.status,
            color: m.color,
            total_cards: stats.total,
            done_cards: stats.done,
            percent: percent(stats.done, stats.total),
        });
    }
    Ok(ok(items))
}

fn percent(done: i64, total: i64) -> i32 {
    if total == 0 {
        0
    } else {
        ((done as f64 / total as f64) * 100.0).round() as i32
    }
}

fn meta_cards(rows: Vec<repos::MetaCardRow>, project_key: &str) -> Vec<MetaCardDto> {
    rows.into_iter()
        .map(|r| MetaCardDto {
            number: format!("{}-{}", project_key, r.no),
            id: r.id,
            no: r.no,
            title: r.title,
            column_name: r.column_name,
            done: r.done,
            priority: r.priority,
            due_date: r.due_date,
        })
        .collect()
}

async fn get_milestone(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let m = repos::get_milestone(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, m.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, &user.0).await?;
    let stats = repos::milestone_stats(&state.pool, id).await?;
    let cards = repos::list_cards_for_milestone(&state.pool, id).await?;
    Ok(ok(MilestoneDetailDto {
        id: m.id,
        name: m.name,
        description: m.description,
        start_date: m.start_date,
        due_date: m.due_date,
        status: m.status,
        color: m.color,
        total_cards: stats.total,
        done_cards: stats.done,
        percent: percent(stats.done, stats.total),
        cards: meta_cards(cards, &p.key),
    }))
}

async fn get_release(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let v = repos::get_version(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, v.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, &user.0).await?;
    let stats = repos::version_stats(&state.pool, id).await?;
    let cards = repos::list_cards_for_version(&state.pool, id).await?;
    Ok(ok(VersionDetailDto {
        id: v.id,
        name: v.name,
        description: v.description,
        release_date: v.release_date,
        status: v.status,
        total_cards: stats.total,
        done_cards: stats.done,
        percent: percent(stats.done, stats.total),
        cards: meta_cards(cards, &p.key),
    }))
}

async fn create_milestone(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<MilestoneReq>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let id = repos::create_milestone(&state.pool, p.id, &milestone_input(&req)).await?;
    Ok(ok(serde_json::json!({ "id": id })))
}

async fn update_milestone(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<MilestoneReq>) -> AppResult<impl IntoResponse> {
    let m = repos::get_milestone(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, m.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::update_milestone(&state.pool, id, &milestone_input(&req)).await?;
    Ok(ok_empty())
}

async fn delete_milestone(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let m = repos::get_milestone(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, m.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::delete_milestone(&state.pool, id).await?;
    Ok(ok_empty())
}

// ============ 版本 ============

#[derive(Deserialize)]
pub struct ReleaseReq {
    name: String,
    description: Option<String>,
    release_date: Option<chrono::NaiveDate>,
    status: Option<String>,
}

fn version_input(req: &ReleaseReq) -> repos::VersionInput {
    repos::VersionInput {
        name: req.name.clone(),
        description: req.description.clone().unwrap_or_default(),
        release_date: req.release_date,
        status: req.status.clone().unwrap_or_else(|| "planned".into()),
    }
}

async fn list_releases(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    let rows = repos::list_versions(&state.pool, p.id).await?;
    let mut items = Vec::new();
    for v in rows {
        let stats = repos::version_stats(&state.pool, v.id).await?;
        items.push(VersionDto {
            id: v.id,
            name: v.name,
            description: v.description,
            release_date: v.release_date,
            status: v.status,
            total_cards: stats.total,
            done_cards: stats.done,
            percent: percent(stats.done, stats.total),
        });
    }
    Ok(ok(items))
}

async fn create_release(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<ReleaseReq>) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let id = repos::create_version(&state.pool, p.id, &version_input(&req)).await?;
    Ok(ok(serde_json::json!({ "id": id })))
}

async fn update_release(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<ReleaseReq>) -> AppResult<impl IntoResponse> {
    let v = repos::get_version(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, v.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::update_version(&state.pool, id, &version_input(&req)).await?;
    Ok(ok_empty())
}

async fn delete_release(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let v = repos::get_version(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, v.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::delete_version(&state.pool, id).await?;
    Ok(ok_empty())
}
