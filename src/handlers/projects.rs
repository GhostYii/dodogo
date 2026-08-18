//! 项目与成员接口（/api/projects/*）

use axum::extract::{Multipart, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::middleware::RequireAuth;
use crate::models::{MemberDto, ProjectDto};
use crate::permission;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::services;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(list_projects).post(create_project))
        .route("/{key}", get(get_project).patch(update_project))
        .route("/{key}/archive", post(toggle_archive))
        .route("/{key}/icon", post(upload_icon).delete(remove_icon))
        .route("/{key}", axum::routing::delete(delete_project))
        .route("/{key}/members", get(list_members).post(add_members))
        .route("/{key}/members/{user_id}", axum::routing::patch(update_member).delete(remove_member))
}

#[derive(Deserialize)]
pub struct CreateProjectReq {
    key: String,
    name: String,
    description: Option<String>,
    icon_color: Option<String>,
    icon_text: Option<String>,
    #[serde(default)]
    template: String,
}

async fn create_project(
    State(state): State<AppState>,
    user: RequireAuth,
    Json(req): Json<CreateProjectReq>,
) -> AppResult<impl IntoResponse> {
    services::validate_project_key(&req.key)?;
    if req.name.is_empty() || req.name.chars().count() > 60 {
        return Err(AppError::Param("项目名称需为 1-60 字符".into()));
    }
    let icon_text = req.icon_text.clone().unwrap_or_else(|| initials(&req.name));
    let id = repos::create_project(
        &state.pool,
        &req.key,
        &req.name,
        req.description.as_deref().unwrap_or(""),
        req.icon_color.as_deref().unwrap_or("#3B82F6"),
        &icon_text,
        user.0.id,
    )
    .await?;
    repos::add_member(&state.pool, id, user.0.id, permission::ROLE_OWNER).await?;
    services::apply_board_template(&state.pool, id, &req.template).await?;
    let project = repos::get_project_by_id(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    repos::create_audit(&state.pool, Some(user.0.id), "project.create", "project", &id.to_string(), &req.key, "").await.ok();
    Ok(ok(project_dto(&project, Some(permission::ROLE_OWNER.to_string()))))
}

fn project_dto(p: &crate::models::Project, role: Option<String>) -> ProjectDto {
    ProjectDto {
        id: p.id,
        key: p.key.clone(),
        name: p.name.clone(),
        description: p.description.clone(),
        icon_color: p.icon_color.clone(),
        icon_path: p.icon_path.clone(),
        icon_text: p.icon_text.clone(),
        owner_id: p.owner_id,
        status: p.status.clone(),
        role,
        created_at: p.created_at,
    }
}

async fn list_projects(State(state): State<AppState>, user: RequireAuth) -> AppResult<impl IntoResponse> {
    let projects = repos::list_projects_for_user(&state.pool, user.0.id).await?;
    let mut items = Vec::new();
    for p in projects {
        let role = repos::get_member_role(&state.pool, p.id, user.0.id).await?;
        items.push(project_dto(&p, role));
    }
    Ok(ok(items))
}

async fn load_project(state: &AppState, key: &str, user: &crate::middleware::CurrentUser) -> AppResult<crate::models::Project> {
    let project = repos::get_project_by_key(&state.pool, key).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &project, user).await?;
    Ok(project)
}

async fn get_project(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    let role = repos::get_member_role(&state.pool, p.id, user.0.id).await?;
    Ok(ok(project_dto(&p, role)))
}

#[derive(Deserialize)]
pub struct UpdateProjectReq {
    name: String,
    description: Option<String>,
    icon_color: Option<String>,
    icon_text: Option<String>,
}

async fn update_project(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
    Json(req): Json<UpdateProjectReq>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::update_project(
        &state.pool,
        p.id,
        &req.name,
        req.description.as_deref().unwrap_or(""),
        req.icon_color.as_deref().unwrap_or("#3B82F6"),
        req.icon_text.as_deref().unwrap_or(""),
    )
    .await?;
    let p = repos::get_project_by_id(&state.pool, p.id).await?.ok_or(AppError::NotFound)?;
    let role = repos::get_member_role(&state.pool, p.id, user.0.id).await?;
    Ok(ok(project_dto(&p, role)))
}

/// 项目名称首字母（图标文字默认值）。
fn initials(name: &str) -> String {
    let name = name.trim();
    let mut chars = name.chars();
    let first = chars.next().unwrap_or('?');
    match chars.next() {
        Some(s) => format!("{first}{s}"),
        None => first.to_string(),
    }
}

/// 上传项目自定义图标（图片）。
async fn upload_icon(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::Param(e.to_string()))? {
        if field.name() == Some("file") {
            let file_name = field.file_name().unwrap_or("icon").to_string();
            let data = field.bytes().await.map_err(|e| AppError::Param(e.to_string()))?;
            if data.len() > state.config.upload.max_image_mb * 1024 * 1024 {
                return Err(AppError::Param("图片超过大小限制".into()));
            }
            let ext = file_name.rsplit('.').next().unwrap_or("png").to_lowercase();
            let safe_ext = if ["jpg", "jpeg", "png", "gif", "webp"].contains(&ext.as_str()) { ext } else { "png".into() };
            let hash = crate::crypto::sha256_hex(&String::from_utf8_lossy(&data));
            let rel = format!("icons/project-{}-{}.{}", p.id, &hash[..16], safe_ext);
            let abs = state.config.uploads_dir().join(&rel);
            if let Some(parent) = abs.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| AppError::Internal(e.into()))?;
            }
            tokio::fs::write(&abs, &data).await.map_err(|e| AppError::Internal(e.into()))?;
            repos::set_project_icon(&state.pool, p.id, &rel).await?;
            return Ok(ok(json!({ "iconPath": rel })));
        }
    }
    Err(AppError::Param("缺少文件字段".into()))
}

/// 移除项目自定义图标，切回「颜色 + 文字」模式。
async fn remove_icon(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if !p.icon_path.is_empty() {
        let abs = state.config.uploads_dir().join(&p.icon_path);
        let _ = tokio::fs::remove_file(&abs).await;
    }
    repos::set_project_icon(&state.pool, p.id, "").await?;
    Ok(ok_empty())
}

async fn toggle_archive(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let new_status = if p.status == crate::models::STATUS_ARCHIVED { crate::models::STATUS_ACTIVE } else { crate::models::STATUS_ARCHIVED };
    repos::set_project_status(&state.pool, p.id, new_status).await?;
    Ok(ok_empty())
}

async fn delete_project(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
    Query(q): Query<DeleteQuery>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    if p.owner_id != user.0.id && user.0.role != crate::models::ROLE_SYSTEM_ADMIN {
        return Err(AppError::Forbidden);
    }
    if q.confirm_key.as_deref() != Some(p.key.as_str()) {
        return Err(AppError::Business("请输入项目 Key 确认删除".into()));
    }
    repos::set_project_status(&state.pool, p.id, crate::models::STATUS_DELETED).await?;
    repos::create_audit(&state.pool, Some(user.0.id), "project.delete", "project", &p.id.to_string(), &p.key, "").await.ok();
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    confirm_key: Option<String>,
}

async fn list_members(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    let rows = repos::list_members(&state.pool, p.id).await?;
    let items: Vec<MemberDto> = rows
        .into_iter()
        .map(|m| MemberDto {
            user_id: m.user_id,
            username: m.username,
            display_name: m.display_name,
            avatar_path: m.avatar_path,
            role: m.role,
            joined_at: m.joined_at,
        })
        .collect();
    Ok(ok(items))
}

#[derive(Deserialize)]
pub struct AddMemberReq {
    identity: String,
    role: String,
}

async fn add_members(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(key): Path<String>,
    Json(req): Json<AddMemberReq>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if !permission::role_at_least(&req.role, permission::ROLE_VIEWER) || permission::role_rank(&req.role) > permission::role_rank(permission::ROLE_OWNER) {
        return Err(AppError::Param("无效的角色".into()));
    }
    let target = repos::get_user_by_identity(&state.pool, &req.identity).await?.ok_or(AppError::NotFound)?;
    if req.role == permission::ROLE_OWNER {
        return Err(AppError::Business("不能直接指定所有者为他人".into()));
    }
    repos::add_member(&state.pool, p.id, target.id, &req.role).await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct UpdateMemberReq {
    role: String,
}

async fn update_member(
    State(state): State<AppState>,
    user: RequireAuth,
    Path((key, user_id)): Path<(String, i64)>,
    Json(req): Json<UpdateMemberReq>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if user_id == p.owner_id && req.role != permission::ROLE_OWNER {
        return Err(AppError::Business("不能降级项目所有者".into()));
    }
    repos::update_member_role(&state.pool, p.id, user_id, &req.role).await?;
    Ok(ok_empty())
}

async fn remove_member(
    State(state): State<AppState>,
    user: RequireAuth,
    Path((key, user_id)): Path<(String, i64)>,
) -> AppResult<impl IntoResponse> {
    let p = load_project(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if user_id == p.owner_id {
        return Err(AppError::Business("不能移除项目所有者".into()));
    }
    repos::remove_member(&state.pool, p.id, user_id).await?;
    // 清空其在该项目卡片上的指派
    sqlx::query("UPDATE cards SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?")
        .bind(p.id)
        .bind(user_id)
        .execute(&state.pool)
        .await?;
    Ok(ok_empty())
}
