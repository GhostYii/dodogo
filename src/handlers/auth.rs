//! 认证与用户资料接口（/api/auth/*）

use axum::extract::{Multipart, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::middleware::{CurrentUser, RequireAuth, SESSION_COOKIE};
use crate::models::UserDto;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::services;
use crate::state::AppState;

use axum::routing::Router;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", axum::routing::post(register))
        .route("/login", axum::routing::post(login))
        .route("/logout", axum::routing::post(logout))
        .route("/me", axum::routing::get(me))
        .route("/me", axum::routing::patch(update_me))
        .route("/password", axum::routing::put(change_password))
        .route("/sessions", axum::routing::get(list_sessions))
        .route("/sessions/{id}", axum::routing::delete(revoke_session))
        .route("/avatar", axum::routing::post(upload_avatar))
}

#[derive(Deserialize)]
pub struct RegisterReq {
    username: String,
    email: Option<String>,
    password: String,
    display_name: Option<String>,
}

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterReq>,
) -> AppResult<impl IntoResponse> {
    let allow = repos::get_setting(&state.pool, "allow_registration").await?.unwrap_or_else(|| "1".into());
    if allow != "1" {
        return Err(AppError::Forbidden);
    }
    let user = services::register(
        &state.pool,
        &req.username,
        req.email.as_deref(),
        &req.password,
        req.display_name.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(ok(user))
}

#[derive(Deserialize)]
pub struct LoginReq {
    identity: String,
    password: String,
    #[serde(default)]
    remember: bool,
}

async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginReq>,
) -> AppResult<impl IntoResponse> {
    let cfg = services::RateLimitConfig {
        max_fail: state.config.security.login_max_fail,
        lock_minutes: state.config.security.login_lock_minutes,
    };
    let out = services::login(
        &state.pool,
        &req.identity,
        &req.password,
        req.remember,
        None,
        None,
        &cfg,
        state.config.security.session_ttl_hours,
        state.config.security.remember_ttl_days,
    )
    .await?;

    repos::create_audit(&state.pool, Some(out.user.id), "login", "user", &out.user.id.to_string(), "{}", "").await.ok();

    // 合并会话 Cookie 与（如缺失的）CSRF Cookie
    let mut response_jar = out.jar;
    if jar.get(crate::middleware::CSRF_COOKIE).is_none() {
        let token = crate::crypto::generate_token();
        response_jar = response_jar.add(
            Cookie::build((crate::middleware::CSRF_COOKIE, token))
                .path("/")
                .http_only(false)
                .same_site(axum_extra::extract::cookie::SameSite::Lax)
                .build(),
        );
    }

    Ok((response_jar, ok(out.user)))
}

async fn logout(State(state): State<AppState>, jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> AppResult<impl IntoResponse> {
    let mut response_jar = CookieJar::new();
    if let Some(token) = jar.get(SESSION_COOKIE).map(|c| c.value().to_string()) {
        response_jar = services::logout(&state.pool, &token).await?;
    }
    if let Some(axum::Extension(u)) = user {
        repos::create_audit(&state.pool, Some(u.id), "logout", "user", &u.id.to_string(), "{}", "").await.ok();
    }
    Ok((response_jar, ok_empty()))
}

async fn me(user: RequireAuth) -> AppResult<impl IntoResponse> {
    Ok(ok(json!({
        "id": user.0.id,
        "username": user.0.username,
        "displayName": user.0.display_name,
        "avatarPath": user.0.avatar_path,
        "role": user.0.role,
    })))
}

#[derive(Deserialize)]
pub struct UpdateMeReq {
    display_name: Option<String>,
    email: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    user: RequireAuth,
    Json(req): Json<UpdateMeReq>,
) -> AppResult<impl IntoResponse> {
    if let Some(e) = &req.email {
        services::validate_email(e)?;
    }
    repos::update_user_profile(
        &state.pool,
        user.0.id,
        req.display_name.as_deref().unwrap_or(&user.0.display_name),
        req.email.as_deref(),
        None,
    )
    .await?;
    let u = repos::get_user_by_id(&state.pool, user.0.id).await?.ok_or(AppError::NotFound)?;
    Ok(ok(UserDto::from(u)))
}

#[derive(Deserialize)]
pub struct ChangePasswordReq {
    old_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<AppState>,
    user: RequireAuth,
    Json(req): Json<ChangePasswordReq>,
) -> AppResult<impl IntoResponse> {
    let u = repos::get_user_by_id(&state.pool, user.0.id).await?.ok_or(AppError::NotFound)?;
    if !crate::crypto::verify_password(&req.old_password, &u.password_hash) {
        return Err(AppError::Business("旧密码不正确".into()));
    }
    services::validate_password(&req.new_password)?;
    let hash = crate::crypto::hash_password(&req.new_password)?;
    repos::update_user_password(&state.pool, user.0.id, &hash).await?;
    Ok(ok_empty())
}

async fn list_sessions(State(state): State<AppState>, user: RequireAuth) -> AppResult<impl IntoResponse> {
    let sessions = repos::list_sessions(&state.pool, user.0.id).await?;
    let items: Vec<_> = sessions
        .into_iter()
        .map(|s| {
            json!({
                "id": s.id,
                "ip": s.ip,
                "userAgent": s.user_agent,
                "expiresAt": s.expires_at,
                "createdAt": s.created_at,
            })
        })
        .collect();
    Ok(ok(items))
}

async fn revoke_session(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(id): Path<i64>,
) -> AppResult<impl IntoResponse> {
    repos::delete_session_by_id(&state.pool, id, user.0.id).await?;
    Ok(ok_empty())
}

async fn upload_avatar(
    State(state): State<AppState>,
    user: RequireAuth,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::Param(e.to_string()))? {
        if field.name() == Some("file") {
            let file_name = field.file_name().unwrap_or("avatar").to_string();
            let data = field.bytes().await.map_err(|e| AppError::Param(e.to_string()))?;
            let max = state.config.upload.max_image_mb * 1024 * 1024;
            if data.len() > max {
                return Err(AppError::Param("图片超过大小限制".into()));
            }
            let ext = file_name.rsplit('.').next().unwrap_or("png").to_lowercase();
            let safe_ext = if ["jpg", "jpeg", "png", "gif", "webp"].contains(&ext.as_str()) { ext } else { "png".into() };
            let hash = crate::crypto::sha256_hex(&String::from_utf8_lossy(&data));
            let rel = format!("avatars/{}.{}", &hash[..32], safe_ext);
            let abs = state.config.uploads_dir().join(&rel);
            if let Some(parent) = abs.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| AppError::Internal(e.into()))?;
            }
            tokio::fs::write(&abs, &data).await.map_err(|e| AppError::Internal(e.into()))?;
            repos::update_user_profile(&state.pool, user.0.id, &user.0.display_name, None, Some(&rel)).await?;
            let u = repos::get_user_by_id(&state.pool, user.0.id).await?.ok_or(AppError::NotFound)?;
            return Ok(ok(json!({ "avatarPath": u.avatar_path })));
        }
    }
    Err(AppError::Param("缺少文件字段".into()))
}

#[derive(Deserialize)]
pub struct SearchUsersQuery {
    q: String,
}

/// 模糊搜索用户（用于添加成员自动匹配 / @提及）。
pub async fn search_users(
    State(state): State<AppState>,
    _user: RequireAuth,
    Query(q): Query<SearchUsersQuery>,
) -> AppResult<impl IntoResponse> {
    let q = q.q.trim();
    if q.is_empty() {
        return Ok(ok(Vec::<serde_json::Value>::new()));
    }
    let users = repos::search_users(&state.pool, q, 20).await?;
    let items: Vec<_> = users
        .into_iter()
        .map(|u| {
            json!({
                "id": u.id,
                "username": u.username,
                "displayName": u.display_name,
                "avatarPath": u.avatar_path,
                "email": u.email,
            })
        })
        .collect();
    Ok(ok(items))
}

/// 查看某用户的公开信息（用于成员个人主页）。
pub async fn get_user(
    State(state): State<AppState>,
    _user: RequireAuth,
    Path(id): Path<i64>,
) -> AppResult<impl IntoResponse> {
    let u = repos::get_user_by_id(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    Ok(ok(json!({
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "avatarPath": u.avatar_path,
        "role": u.role,
        "createdAt": u.created_at,
    })))
}
