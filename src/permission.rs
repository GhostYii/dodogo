//! 权限系统：系统角色 + 项目角色判定（对应《01-软件设计文档》§3.3）

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::{Project, ROLE_SYSTEM_ADMIN};

pub const ROLE_OWNER: &str = "owner";
pub const ROLE_ADMIN: &str = "admin";
pub const ROLE_MEMBER: &str = "member";
pub const ROLE_VIEWER: &str = "viewer";

pub fn role_rank(role: &str) -> u8 {
    match role {
        ROLE_OWNER => 4,
        ROLE_ADMIN => 3,
        ROLE_MEMBER => 2,
        ROLE_VIEWER => 1,
        _ => 0,
    }
}

pub fn role_at_least(role: &str, min: &str) -> bool {
    role_rank(role) >= role_rank(min)
}

/// 查询用户在项目中的角色。
pub async fn member_role(pool: &SqlitePool, project_id: i64, user_id: i64) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

/// 校验用户对项目的访问角色，返回项目。未登录 → 401，非成员 → 403。
pub async fn require_member(
    pool: &SqlitePool,
    project: &Project,
    user: &crate::middleware::CurrentUser,
) -> AppResult<String> {
    if user.role == ROLE_SYSTEM_ADMIN {
        return Ok(ROLE_OWNER.to_string());
    }
    match member_role(pool, project.id, user.id).await {
        Some(role) => Ok(role),
        None => Err(AppError::Forbidden),
    }
}

/// 校验用户角色不低于指定级别。
pub async fn require_role(
    pool: &SqlitePool,
    project: &Project,
    user: &crate::middleware::CurrentUser,
    min_role: &str,
) -> AppResult<String> {
    let role = require_member(pool, project, user).await?;
    if role_at_least(&role, min_role) {
        Ok(role)
    } else {
        Err(AppError::Forbidden)
    }
}
