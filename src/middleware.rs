//! 会话认证与 CSRF 中间件

use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum_extra::extract::cookie::CookieJar;

use crate::crypto::sha256_hex;
use crate::state::AppState;

pub const SESSION_COOKIE: &str = "dodogo_session";
pub const CSRF_COOKIE: &str = "dodogo_csrf";

#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub role: String,
    pub status: String,
    /// true 表示本次请求通过 Bearer Token 认证（免 CSRF）。
    pub via_bearer: bool,
}

impl CurrentUser {
    pub fn is_admin(&self) -> bool {
        self.role == crate::models::ROLE_SYSTEM_ADMIN
    }
}

/// 从请求中提取当前用户（供处理器使用）。
pub async fn current_user(req: &mut Parts) -> Option<CurrentUser> {
    if let Some(ext) = req.extensions.get::<CurrentUser>() {
        return Some(ext.clone());
    }
    None
}

/// 会话中间件：解析 Cookie/Bearer → 查库 → 注入 CurrentUser。
pub async fn session_mw(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let (bearer, cookie) = {
        let jar = CookieJar::from_headers(req.headers());
        let bearer = req
            .headers()
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());
        let cookie = jar.get(SESSION_COOKIE).map(|c| c.value().to_string());
        (bearer, cookie)
    };

    let (token, via_bearer) = match (&bearer, &cookie) {
        (Some(t), _) => (t.clone(), true),
        (None, Some(t)) => (t.clone(), false),
        (None, None) => {
            let res = next.run(req).await;
            return res;
        }
    };

    let hash = sha256_hex(&token);
    let session = sqlx::query_as::<_, crate::models::Session>(
        "SELECT id, user_id, token_hash, expires_at, ip, user_agent, created_at \
         FROM sessions WHERE token_hash = ?",
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let mut user = None;
    if let Some(s) = session {
        let now = chrono::Utc::now();
        if s.expires_at > now {
            user = sqlx::query_as::<_, crate::models::User>(
                "SELECT id, username, email, password_hash, display_name, avatar_path, \
                 role, status, must_change_pw, last_login_at, last_login_ip, created_at, updated_at \
                 FROM users WHERE id = ?",
            )
            .bind(s.user_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
        }
    }

    match user {
        Some(u) if u.status == crate::models::STATUS_ACTIVE => {
            req.extensions_mut().insert(CurrentUser {
                id: u.id,
                username: u.username,
                display_name: u.display_name,
                avatar_path: u.avatar_path,
                role: u.role,
                status: u.status,
                via_bearer,
            });
        }
        _ => {}
    }

    next.run(req).await
}

/// CSRF 双提交校验：仅对 Cookie 会话的写请求生效。
pub async fn csrf_mw(State(_state): State<AppState>, req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let is_safe = matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS");

    if is_safe {
        return next.run(req).await;
    }

    // 仅 Cookie 会话需要 CSRF 校验；Bearer 请求跳过。
    let via_bearer = req
        .extensions()
        .get::<CurrentUser>()
        .map(|u| u.via_bearer)
        .unwrap_or(true);

    if !via_bearer {
        let jar = CookieJar::from_headers(req.headers());
        let cookie_csrf = jar.get(CSRF_COOKIE).map(|c| c.value().to_string());
        let header_csrf = req
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // 若 Cookie 存在但请求未携带匹配的 token，则拒绝。
        let valid = match (&cookie_csrf, &header_csrf) {
            (Some(c), Some(h)) => constant_time_eq(c.as_bytes(), h.as_bytes()),
            _ => false,
        };
        if !valid {
            return crate::error::AppError::Forbidden.into_response();
        }
    }

    next.run(req).await
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 便捷提取器：要求已登录，否则返回 401。
pub struct RequireAuth(pub CurrentUser);

impl<S> FromRequestParts<S> for RequireAuth
where
    S: Send + Sync,
{
    type Rejection = crate::error::AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match current_user(parts).await {
            Some(u) => Ok(RequireAuth(u)),
            None => Err(crate::error::AppError::Unauthorized),
        }
    }
}

/// 便捷提取器：要求系统管理员。
pub struct RequireAdmin(pub CurrentUser);

impl<S> FromRequestParts<S> for RequireAdmin
where
    S: Send + Sync,
{
    type Rejection = crate::error::AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match current_user(parts).await {
            Some(u) if u.is_admin() => Ok(RequireAdmin(u)),
            Some(_) => Err(crate::error::AppError::Forbidden),
            None => Err(crate::error::AppError::Unauthorized),
        }
    }
}
