//! 业务服务层：认证、通知、活动、看板模板等共享逻辑。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use sqlx::SqlitePool;

use crate::crypto::{generate_token, hash_password, sha256_hex, verify_password};
use crate::error::{AppError, AppResult};
use crate::middleware::{CurrentUser, CSRF_COOKIE, SESSION_COOKIE};
use crate::models::*;
use crate::repos;
use crate::state::AppState;

// ============ 登录限速 ============

struct LoginState {
    fails: u32,
    lock_until: Option<Instant>,
}

static LOGIN_ATTEMPTS: OnceLock<Mutex<HashMap<String, LoginState>>> = OnceLock::new();

fn attempts() -> &'static Mutex<HashMap<String, LoginState>> {
    LOGIN_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct RateLimitConfig {
    pub max_fail: u32,
    pub lock_minutes: i64,
}

pub fn check_locked(identity: &str, cfg: &RateLimitConfig) -> AppResult<()> {
    let map = attempts().lock().unwrap();
    if let Some(st) = map.get(&identity.to_lowercase()) {
        if let Some(until) = st.lock_until {
            if until > Instant::now() {
                let left = until.duration_since(Instant::now()).as_secs();
                return Err(AppError::Business(format!("账号已临时锁定，请 {left} 秒后重试")));
            }
        }
    }
    let _ = cfg;
    Ok(())
}

pub fn record_failure(identity: &str, cfg: &RateLimitConfig) {
    let mut map = attempts().lock().unwrap();
    let key = identity.to_lowercase();
    let entry = map.entry(key).or_insert(LoginState { fails: 0, lock_until: None });
    entry.fails += 1;
    if entry.fails >= cfg.max_fail {
        entry.lock_until = Some(Instant::now() + Duration::from_secs((cfg.lock_minutes * 60) as u64));
        entry.fails = 0;
    }
}

pub fn clear_failures(identity: &str) {
    let mut map = attempts().lock().unwrap();
    map.remove(&identity.to_lowercase());
}

// ============ 认证 ============

pub struct AuthOutput {
    pub user: UserDto,
    pub jar: CookieJar,
}

pub async fn login(
    pool: &SqlitePool,
    identity: &str,
    password: &str,
    remember: bool,
    ip: Option<&str>,
    ua: Option<&str>,
    cfg: &RateLimitConfig,
    session_ttl_hours: i64,
    remember_ttl_days: i64,
) -> AppResult<AuthOutput> {
    check_locked(identity, cfg)?;
    let user = repos::get_user_by_identity(pool, identity)
        .await?
        .ok_or_else(|| AppError::Unauthorized)?;

    if user.status != STATUS_ACTIVE {
        return Err(AppError::Unauthorized);
    }

    if !verify_password(password, &user.password_hash) {
        record_failure(identity, cfg);
        return Err(AppError::Unauthorized);
    }

    clear_failures(identity);

    let token = generate_token();
    let hash = sha256_hex(&token);
    let ttl = if remember {
        chrono::Duration::days(remember_ttl_days)
    } else {
        chrono::Duration::hours(session_ttl_hours)
    };
    repos::create_session(pool, user.id, &hash, ttl, ip, ua).await?;
    repos::update_last_login(pool, user.id, ip).await?;

    let jar = build_session_jar(&token, remember);
    Ok(AuthOutput { user: UserDto::from(user), jar })
}

pub fn build_session_jar(token: &str, remember: bool) -> CookieJar {
    let max_age = if remember {
        chrono::Duration::days(365)
    } else {
        chrono::Duration::hours(12)
    };
    let mut jar = CookieJar::new();
    let cookie = Cookie::build((SESSION_COOKIE, token.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::seconds(max_age.num_seconds()))
        .build();
    jar = jar.add(cookie);
    jar
}

pub async fn logout(pool: &SqlitePool, token: &str) -> AppResult<CookieJar> {
    repos::delete_session_by_hash(pool, &sha256_hex(token)).await?;
    let mut jar = CookieJar::new();
    jar = jar.add(Cookie::build((SESSION_COOKIE, "")).path("/").build());
    Ok(jar)
}

pub async fn register(
    pool: &SqlitePool,
    username: &str,
    email: Option<&str>,
    password: &str,
    display_name: &str,
) -> AppResult<UserDto> {
    validate_username(username)?;
    validate_password(password)?;
    if let Some(e) = email {
        validate_email(e)?;
    }
    let hash = hash_password(password)?;
    // 首个注册账号自动成为系统管理员（初始化向导）。
    let is_first = repos::count_users(pool).await? == 0;
    let role = if is_first { ROLE_SYSTEM_ADMIN.to_string() } else { ROLE_USER.to_string() };
    let id = repos::create_user(
        pool,
        &repos::NewUser {
            username: username.to_string(),
            email: email.map(|s| s.to_string()),
            password_hash: hash,
            display_name: if display_name.is_empty() { username.to_string() } else { display_name.to_string() },
            role,
        },
    )
    .await?;
    let user = repos::get_user_by_id(pool, id).await?.ok_or(AppError::NotFound)?;
    Ok(UserDto::from(user))
}

pub fn validate_username(username: &str) -> AppResult<()> {
    let n = username.chars().count();
    if !(3..=32).contains(&n) {
        return Err(AppError::Param("用户名长度需为 3-32 字符".into()));
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::Param("用户名仅支持字母/数字/下划线/连字符".into()));
    }
    Ok(())
}

pub fn validate_password(password: &str) -> AppResult<()> {
    let n = password.chars().count();
    if !(8..=64).contains(&n) {
        return Err(AppError::Param("密码长度需为 8-64 字符".into()));
    }
    let has_alpha = password.chars().any(|c| c.is_alphabetic());
    let has_digit = password.chars().any(|c| c.is_numeric());
    if !has_alpha || !has_digit {
        return Err(AppError::Param("密码需同时包含字母与数字".into()));
    }
    Ok(())
}

pub fn validate_email(email: &str) -> AppResult<()> {
    if email.contains('@') && email.contains('.') && email.len() <= 255 {
        Ok(())
    } else {
        Err(AppError::Param("邮箱格式不正确".into()))
    }
}

pub fn validate_project_key(key: &str) -> AppResult<()> {
    let n = key.len();
    if !(2..=6).contains(&n) {
        return Err(AppError::Param("项目 Key 需为 2-6 位".into()));
    }
    if !key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return Err(AppError::Param("项目 Key 仅支持大写字母/数字".into()));
    }
    Ok(())
}

// ============ CSRF ============

pub fn ensure_csrf(jar: &CookieJar) -> CookieJar {
    let mut jar = jar.clone();
    if jar.get(CSRF_COOKIE).is_none() {
        let token = generate_token();
        jar = jar.add(
            Cookie::build((CSRF_COOKIE, token))
                .path("/")
                .http_only(false)
                .same_site(SameSite::Lax)
                .build(),
        );
    }
    jar
}

pub fn csrf_token(jar: &CookieJar) -> String {
    jar.get(CSRF_COOKIE).map(|c| c.value().to_string()).unwrap_or_default()
}

// ============ 通知 ============

pub async fn notify(
    state: &AppState,
    user_id: i64,
    type_: &str,
    title: &str,
    body: &str,
    link: &str,
) -> AppResult<()> {
    let id = repos::create_notification(&state.pool, user_id, type_, title, body, link).await?;
    let payload = serde_json::json!({ "notificationId": id, "type": type_, "title": title });
    state.broadcast(&format!("user:{user_id}"), "notification.new", payload);
    Ok(())
}

// ============ 活动 ============

pub async fn log_activity(
    state: &AppState,
    project_id: i64,
    card_id: i64,
    user: &CurrentUser,
    action: &str,
    detail: &str,
) -> AppResult<()> {
    repos::create_activity(&state.pool, project_id, card_id, Some(user.id), action, detail).await
}

// ============ 看板模板 ============

/// 项目创建时按模板生成看板与列。
pub async fn apply_board_template(pool: &SqlitePool, project_id: i64, template: &str) -> AppResult<i64> {
    let columns: Vec<(&str, bool)> = match template {
        "dev" => vec![
            ("需求", false),
            ("开发", false),
            ("测试", false),
            ("发布", true),
        ],
        "todo" => vec![("待办", false), ("进行中", false), ("已完成", true)],
        _ => vec![("待办", false), ("已完成", true)],
    };
    let board_id = repos::create_board(pool, project_id, "默认看板", "", 0).await?;
    for (i, (name, is_done)) in columns.into_iter().enumerate() {
        repos::create_column(pool, board_id, name, i as i32, "", 0, is_done).await?;
    }
    Ok(board_id)
}
