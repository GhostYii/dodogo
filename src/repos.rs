//! 数据访问层（Repos）：所有数据库读写集中于此，供 services 调用。
//! 时间约定：所有时间戳由 chrono 绑定/读取，禁止使用 SQLite `datetime('now')`。

use chrono::Utc;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::*;

fn now() -> chrono::DateTime<Utc> {
    Utc::now()
}

// ============ 用户 ============

pub async fn create_user(pool: &SqlitePool, u: &NewUser) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO users (username, email, password_hash, display_name, role, status, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&u.username)
    .bind(&u.email)
    .bind(&u.password_hash)
    .bind(&u.display_name)
    .bind(&u.role)
    .bind(STATUS_ACTIVE)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Unique("用户名或邮箱已存在".into())
        } else {
            AppError::from(e)
        }
    })?;
    Ok(id)
}

pub struct NewUser {
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
}

pub async fn get_user_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<User>> {
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(u)
}

pub async fn get_user_by_username(pool: &SqlitePool, username: &str) -> AppResult<Option<User>> {
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = ?")
        .bind(username)
        .fetch_optional(pool)
        .await?;
    Ok(u)
}

pub async fn get_user_by_email(pool: &SqlitePool, email: &str) -> AppResult<Option<User>> {
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
        .bind(email)
        .fetch_optional(pool)
        .await?;
    Ok(u)
}

pub async fn get_user_by_identity(pool: &SqlitePool, identity: &str) -> AppResult<Option<User>> {
    let u = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE username = ? OR email = ?",
    )
    .bind(identity)
    .bind(identity)
    .fetch_optional(pool)
    .await?;
    Ok(u)
}

pub async fn count_users(pool: &SqlitePool) -> AppResult<i64> {
    let n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(n)
}

pub async fn list_users(pool: &SqlitePool, offset: i64, limit: i64, q: Option<&str>) -> AppResult<Vec<User>> {
    let users = match q {
        Some(q) => {
            let like = format!("%{q}%");
            sqlx::query_as::<_, User>(
                "SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ? \
                 ORDER BY id LIMIT ? OFFSET ?",
            )
            .bind(&like)
            .bind(&like)
            .bind(&like)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY id LIMIT ? OFFSET ?")
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await?
        }
    };
    Ok(users)
}

pub async fn update_user_profile(
    pool: &SqlitePool,
    id: i64,
    display_name: &str,
    email: Option<&str>,
    avatar_path: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE users SET display_name = ?, email = ?, avatar_path = COALESCE(?, avatar_path), updated_at = ? WHERE id = ?",
    )
    .bind(display_name)
    .bind(email)
    .bind(avatar_path)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Unique("邮箱已被使用".into())
        } else {
            AppError::from(e)
        }
    })?;
    Ok(())
}

pub async fn update_user_password(pool: &SqlitePool, id: i64, hash: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET password_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?")
        .bind(hash)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_user_status(pool: &SqlitePool, id: i64, status: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_user_role(pool: &SqlitePool, id: i64, role: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
        .bind(role)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_last_login(pool: &SqlitePool, id: i64, ip: Option<&str>) -> AppResult<()> {
    sqlx::query("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?")
        .bind(now())
        .bind(ip)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_user(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM users WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ 会话 ============

pub async fn create_session(
    pool: &SqlitePool,
    user_id: i64,
    token_hash: &str,
    ttl: chrono::Duration,
    ip: Option<&str>,
    ua: Option<&str>,
) -> AppResult<i64> {
    let expires = now() + ttl;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent, created_at) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user_id)
    .bind(token_hash)
    .bind(expires)
    .bind(ip)
    .bind(ua)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn delete_session_by_hash(pool: &SqlitePool, token_hash: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_session_by_id(pool: &SqlitePool, id: i64, user_id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_user_sessions(pool: &SqlitePool, user_id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_sessions(pool: &SqlitePool, user_id: i64) -> AppResult<Vec<Session>> {
    let s = sqlx::query_as::<_, Session>(
        "SELECT id, user_id, token_hash, expires_at, ip, user_agent, created_at \
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(s)
}

pub async fn delete_expired_sessions(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE expires_at < ?")
        .bind(now())
        .execute(pool)
        .await?;
    Ok(())
}

// ============ 系统设置 ============

pub async fn get_setting(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let v = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(v)
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_all_settings(pool: &SqlitePool) -> AppResult<Vec<(String, String)>> {
    let rows = sqlx::query_as::<_, (String, String)>("SELECT key, value FROM settings ORDER BY key")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

// ============ 项目 ============

pub async fn create_project(
    pool: &SqlitePool,
    key: &str,
    name: &str,
    description: &str,
    icon_color: &str,
    owner_id: i64,
) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO projects (key, name, description, icon_color, owner_id, next_card_no, status, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id",
    )
    .bind(key)
    .bind(name)
    .bind(description)
    .bind(icon_color)
    .bind(owner_id)
    .bind(STATUS_ACTIVE)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Unique("项目 Key 已存在".into())
        } else {
            AppError::from(e)
        }
    })?;
    Ok(id)
}

pub async fn get_project_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<Project>> {
    let p = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(p)
}

pub async fn get_project_by_key(pool: &SqlitePool, key: &str) -> AppResult<Option<Project>> {
    let p = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(p)
}

pub async fn list_projects_for_user(pool: &SqlitePool, user_id: i64) -> AppResult<Vec<Project>> {
    let rows = sqlx::query_as::<_, Project>(
        "SELECT p.* FROM projects p \
         JOIN project_members m ON m.project_id = p.id AND m.user_id = ? \
         WHERE p.status = 'active' ORDER BY p.updated_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 全部活动项目（后台 GitLab 轮询用）。
pub async fn list_projects_for_user_poll(pool: &SqlitePool) -> AppResult<Vec<Project>> {
    let rows = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE status = 'active'")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn update_project(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    description: &str,
    icon_color: &str,
) -> AppResult<()> {
    sqlx::query("UPDATE projects SET name = ?, description = ?, icon_color = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(description)
        .bind(icon_color)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_project_status(pool: &SqlitePool, id: i64, status: &str) -> AppResult<()> {
    sqlx::query("UPDATE projects SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(if status == STATUS_DELETED { Some(now()) } else { None::<chrono::DateTime<Utc>> })
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn transfer_project(pool: &SqlitePool, id: i64, new_owner_id: i64) -> AppResult<()> {
    sqlx::query("UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = ?")
        .bind(new_owner_id)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 原子递增单号计数器并返回新单号（并发安全）。
pub async fn next_card_no(pool: &SqlitePool, project_id: i64) -> AppResult<i64> {
    let no = sqlx::query_scalar::<_, i64>(
        "UPDATE projects SET next_card_no = next_card_no + 1 WHERE id = ? RETURNING next_card_no",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    Ok(no)
}

// ============ 项目成员 ============

pub async fn add_member(pool: &SqlitePool, project_id: i64, user_id: i64, role: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(role)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_member_role(pool: &SqlitePool, project_id: i64, user_id: i64) -> AppResult<Option<String>> {
    let r = sqlx::query_scalar::<_, String>(
        "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(r)
}

#[derive(sqlx::FromRow)]
pub struct MemberRow {
    pub user_id: i64,
    pub role: String,
    pub joined_at: chrono::DateTime<Utc>,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
}

pub async fn list_members(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<MemberRow>> {
    let rows = sqlx::query_as::<_, MemberRow>(
        "SELECT m.user_id AS user_id, m.role AS role, m.joined_at AS joined_at, \
         u.username AS username, u.display_name AS display_name, u.avatar_path AS avatar_path \
         FROM project_members m JOIN users u ON u.id = m.user_id \
         WHERE m.project_id = ? ORDER BY m.joined_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_member_role(pool: &SqlitePool, project_id: i64, user_id: i64, role: &str) -> AppResult<()> {
    sqlx::query("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?")
        .bind(role)
        .bind(project_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_member(pool: &SqlitePool, project_id: i64, user_id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
        .bind(project_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============ 看板与列 ============

pub async fn create_board(pool: &SqlitePool, project_id: i64, name: &str, color: &str, position: i32) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO boards (project_id, name, color, position, status, created_at, updated_at) \
         VALUES (?, ?, ?, ?, 'active', ?, ?) RETURNING id",
    )
    .bind(project_id)
    .bind(name)
    .bind(color)
    .bind(position)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn get_board(pool: &SqlitePool, id: i64) -> AppResult<Option<Board>> {
    let b = sqlx::query_as::<_, Board>("SELECT * FROM boards WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(b)
}

pub async fn list_boards(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<Board>> {
    let rows = sqlx::query_as::<_, Board>(
        "SELECT * FROM boards WHERE project_id = ? AND status = 'active' ORDER BY position",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_board(pool: &SqlitePool, id: i64, name: &str, color: &str) -> AppResult<()> {
    sqlx::query("UPDATE boards SET name = ?, color = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(color)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_board_status(pool: &SqlitePool, id: i64, status: &str) -> AppResult<()> {
    sqlx::query("UPDATE boards SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_column(
    pool: &SqlitePool,
    board_id: i64,
    name: &str,
    position: i32,
    color: &str,
    wip_limit: i32,
    is_done: bool,
) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO board_columns (board_id, name, position, color, wip_limit, is_done, status, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) RETURNING id",
    )
    .bind(board_id)
    .bind(name)
    .bind(position)
    .bind(color)
    .bind(wip_limit)
    .bind(is_done)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn get_column(pool: &SqlitePool, id: i64) -> AppResult<Option<Column>> {
    let c = sqlx::query_as::<_, Column>("SELECT * FROM board_columns WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn list_columns(pool: &SqlitePool, board_id: i64) -> AppResult<Vec<Column>> {
    let rows = sqlx::query_as::<_, Column>(
        "SELECT * FROM board_columns WHERE board_id = ? AND status = 'active' ORDER BY position",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_column(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    color: &str,
    wip_limit: i32,
    is_done: bool,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE board_columns SET name = ?, color = ?, wip_limit = ?, is_done = ?, updated_at = ? WHERE id = ?",
    )
    .bind(name)
    .bind(color)
    .bind(wip_limit)
    .bind(is_done)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_column_position(pool: &SqlitePool, id: i64, position: i32) -> AppResult<()> {
    sqlx::query("UPDATE board_columns SET position = ?, updated_at = ? WHERE id = ?")
        .bind(position)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_column(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("UPDATE board_columns SET status = 'archived' WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============ 卡片 ============

pub async fn create_card(pool: &SqlitePool, c: &NewCard) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO cards (project_id, board_id, column_id, no, title, description, assignee_id, priority, \
         start_date, due_date, estimate_hours, milestone_id, version_id, position, status, created_by, updated_by, \
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?) RETURNING id",
    )
    .bind(c.project_id)
    .bind(c.board_id)
    .bind(c.column_id)
    .bind(c.no)
    .bind(&c.title)
    .bind(&c.description)
    .bind(c.assignee_id)
    .bind(&c.priority)
    .bind(c.start_date)
    .bind(c.due_date)
    .bind(c.estimate_hours)
    .bind(c.milestone_id)
    .bind(c.version_id)
    .bind(c.position)
    .bind(c.created_by)
    .bind(c.created_by)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub struct NewCard {
    pub project_id: i64,
    pub board_id: i64,
    pub column_id: i64,
    pub no: i64,
    pub title: String,
    pub description: String,
    pub assignee_id: Option<i64>,
    pub priority: String,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub estimate_hours: Option<f64>,
    pub milestone_id: Option<i64>,
    pub version_id: Option<i64>,
    pub position: i64,
    pub created_by: i64,
}

pub async fn get_card(pool: &SqlitePool, id: i64) -> AppResult<Option<Card>> {
    let c = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn get_card_by_no(pool: &SqlitePool, project_id: i64, no: i64) -> AppResult<Option<Card>> {
    let c = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE project_id = ? AND no = ?")
        .bind(project_id)
        .bind(no)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn list_cards_by_board(pool: &SqlitePool, board_id: i64) -> AppResult<Vec<Card>> {
    let rows = sqlx::query_as::<_, Card>(
        "SELECT * FROM cards WHERE board_id = ? AND status = 'active' ORDER BY column_id, position",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_cards_by_column(pool: &SqlitePool, column_id: i64) -> AppResult<Vec<Card>> {
    let rows = sqlx::query_as::<_, Card>(
        "SELECT * FROM cards WHERE column_id = ? AND status = 'active' ORDER BY position",
    )
    .bind(column_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn count_cards_in_column(pool: &SqlitePool, column_id: i64) -> AppResult<i64> {
    let n = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cards WHERE column_id = ? AND status = 'active'",
    )
    .bind(column_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn update_card_title(pool: &SqlitePool, id: i64, title: &str, user_id: i64) -> AppResult<()> {
    sqlx::query("UPDATE cards SET title = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(user_id)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub struct CardPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub assignee_id: Option<Option<i64>>,
    pub priority: Option<String>,
    pub start_date: Option<Option<chrono::NaiveDate>>,
    pub due_date: Option<Option<chrono::NaiveDate>>,
    pub estimate_hours: Option<Option<f64>>,
    pub milestone_id: Option<Option<i64>>,
    pub version_id: Option<Option<i64>>,
}

pub async fn patch_card(pool: &SqlitePool, id: i64, patch: &CardPatch, user_id: i64) -> AppResult<()> {
    // 逐字段构建更新，简单起见用固定 SQL 与 COALESCE 语义。
    sqlx::query(
        "UPDATE cards SET \
         title = COALESCE(?, title), \
         description = COALESCE(?, description), \
         assignee_id = COALESCE(?, assignee_id), \
         priority = COALESCE(?, priority), \
         start_date = COALESCE(?, start_date), \
         due_date = COALESCE(?, due_date), \
         estimate_hours = COALESCE(?, estimate_hours), \
         milestone_id = COALESCE(?, milestone_id), \
         version_id = COALESCE(?, version_id), \
         updated_by = ?, updated_at = ? WHERE id = ?",
    )
    .bind(patch.title.as_deref())
    .bind(patch.description.as_deref())
    .bind(patch.assignee_id)
    .bind(patch.priority.as_deref())
    .bind(patch.start_date)
    .bind(patch.due_date)
    .bind(patch.estimate_hours)
    .bind(patch.milestone_id)
    .bind(patch.version_id)
    .bind(user_id)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn move_card(
    pool: &SqlitePool,
    id: i64,
    column_id: i64,
    position: i64,
    user_id: i64,
) -> AppResult<()> {
    sqlx::query("UPDATE cards SET column_id = ?, position = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(column_id)
        .bind(position)
        .bind(user_id)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_card_status(pool: &SqlitePool, id: i64, status: &str) -> AppResult<()> {
    sqlx::query("UPDATE cards SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(if status == STATUS_DELETED { Some(now()) } else { None::<chrono::DateTime<Utc>> })
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_cards_assigned(pool: &SqlitePool, user_id: i64) -> AppResult<Vec<Card>> {
    let rows = sqlx::query_as::<_, Card>(
        "SELECT * FROM cards WHERE assignee_id = ? AND status = 'active' ORDER BY due_date IS NULL, due_date, id DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ============ 标签 ============

pub async fn create_label(pool: &SqlitePool, project_id: i64, name: &str, color: &str) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO labels (project_id, name, color, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(project_id)
    .bind(name)
    .bind(color)
    .bind(now())
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::Unique("同名标签已存在".into())
        } else {
            AppError::from(e)
        }
    })?;
    Ok(id)
}

pub async fn list_labels(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<Label>> {
    let rows = sqlx::query_as::<_, Label>(
        "SELECT * FROM labels WHERE project_id = ? ORDER BY name",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_label(pool: &SqlitePool, id: i64) -> AppResult<Option<Label>> {
    let l = sqlx::query_as::<_, Label>("SELECT * FROM labels WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(l)
}

pub async fn delete_label(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM labels WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

pub async fn set_card_labels(pool: &SqlitePool, card_id: i64, label_ids: &[i64]) -> AppResult<()> {
    sqlx::query("DELETE FROM card_labels WHERE card_id = ?")
        .bind(card_id)
        .execute(pool)
        .await?;
    for lid in label_ids {
        sqlx::query("INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)")
            .bind(card_id)
            .bind(lid)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn get_card_label_ids(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<i64>> {
    let rows = sqlx::query_scalar::<_, i64>("SELECT label_id FROM card_labels WHERE card_id = ?")
        .bind(card_id)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

// ============ 评论 ============

pub async fn create_comment(pool: &SqlitePool, card_id: i64, user_id: i64, content: &str) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO comments (card_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(card_id)
    .bind(user_id)
    .bind(content)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_comments(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<Comment>> {
    let rows = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE card_id = ? ORDER BY created_at",
    )
    .bind(card_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_comment(pool: &SqlitePool, id: i64) -> AppResult<Option<Comment>> {
    let c = sqlx::query_as::<_, Comment>("SELECT * FROM comments WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn update_comment(pool: &SqlitePool, id: i64, content: &str) -> AppResult<()> {
    sqlx::query("UPDATE comments SET content = ?, updated_at = ? WHERE id = ?")
        .bind(content)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_comment(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM comments WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ 附件 ============

pub async fn create_attachment(
    pool: &SqlitePool,
    card_id: i64,
    file_name: &str,
    file_path: &str,
    file_size: i64,
    mime_type: &str,
    uploader_id: i64,
) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO attachments (card_id, file_name, file_path, file_size, mime_type, uploader_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(card_id)
    .bind(file_name)
    .bind(file_path)
    .bind(file_size)
    .bind(mime_type)
    .bind(uploader_id)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_attachments(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<Attachment>> {
    let rows = sqlx::query_as::<_, Attachment>(
        "SELECT * FROM attachments WHERE card_id = ? ORDER BY created_at DESC",
    )
    .bind(card_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_attachment(pool: &SqlitePool, id: i64) -> AppResult<Option<Attachment>> {
    let a = sqlx::query_as::<_, Attachment>("SELECT * FROM attachments WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(a)
}

pub async fn delete_attachment(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM attachments WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ 清单 ============

pub async fn create_checklist(pool: &SqlitePool, card_id: i64, title: &str, position: i32) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO checklists (card_id, title, position, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(card_id)
    .bind(title)
    .bind(position)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_checklists(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<Checklist>> {
    let rows = sqlx::query_as::<_, Checklist>(
        "SELECT * FROM checklists WHERE card_id = ? ORDER BY position",
    )
    .bind(card_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_checklist(pool: &SqlitePool, id: i64) -> AppResult<Option<Checklist>> {
    let c = sqlx::query_as::<_, Checklist>("SELECT * FROM checklists WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn delete_checklist(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM checklists WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

pub async fn create_checklist_item(pool: &SqlitePool, checklist_id: i64, title: &str, position: i32) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO checklist_items (checklist_id, title, done, position, created_at, updated_at) \
         VALUES (?, ?, 0, ?, ?, ?) RETURNING id",
    )
    .bind(checklist_id)
    .bind(title)
    .bind(position)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_checklist_items(pool: &SqlitePool, checklist_id: i64) -> AppResult<Vec<ChecklistItem>> {
    let rows = sqlx::query_as::<_, ChecklistItem>(
        "SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position",
    )
    .bind(checklist_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_checklist_item(pool: &SqlitePool, id: i64, title: Option<&str>, done: Option<bool>) -> AppResult<()> {
    sqlx::query(
        "UPDATE checklist_items SET title = COALESCE(?, title), done = COALESCE(?, done), updated_at = ? WHERE id = ?",
    )
    .bind(title)
    .bind(done)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_checklist_item(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM checklist_items WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ 活动 ============

pub async fn create_activity(
    pool: &SqlitePool,
    project_id: i64,
    card_id: i64,
    user_id: Option<i64>,
    action: &str,
    detail: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO activities (project_id, card_id, user_id, action, detail_json, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(project_id)
    .bind(card_id)
    .bind(user_id)
    .bind(action)
    .bind(detail)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_activities(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<Activity>> {
    let rows = sqlx::query_as::<_, Activity>(
        "SELECT * FROM activities WHERE card_id = ? ORDER BY created_at",
    )
    .bind(card_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ============ 里程碑 / 版本 ============

pub async fn create_milestone(pool: &SqlitePool, project_id: i64, m: &MilestoneInput) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO milestones (project_id, name, description, start_date, due_date, status, color, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(project_id)
    .bind(&m.name)
    .bind(&m.description)
    .bind(m.start_date)
    .bind(m.due_date)
    .bind(&m.status)
    .bind(&m.color)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub struct MilestoneInput {
    pub name: String,
    pub description: String,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub color: String,
}

pub async fn list_milestones(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<Milestone>> {
    let rows = sqlx::query_as::<_, Milestone>(
        "SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date IS NULL, due_date, id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_milestone(pool: &SqlitePool, id: i64) -> AppResult<Option<Milestone>> {
    let m = sqlx::query_as::<_, Milestone>("SELECT * FROM milestones WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(m)
}

pub async fn update_milestone(pool: &SqlitePool, id: i64, m: &MilestoneInput) -> AppResult<()> {
    sqlx::query(
        "UPDATE milestones SET name = ?, description = ?, start_date = ?, due_date = ?, status = ?, color = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&m.name)
    .bind(&m.description)
    .bind(m.start_date)
    .bind(m.due_date)
    .bind(&m.status)
    .bind(&m.color)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_milestone(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("UPDATE cards SET milestone_id = NULL WHERE milestone_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM milestones WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

pub async fn create_version(pool: &SqlitePool, project_id: i64, v: &VersionInput) -> AppResult<i64> {
    let ts = now();
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO versions (project_id, name, description, release_date, status, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(project_id)
    .bind(&v.name)
    .bind(&v.description)
    .bind(v.release_date)
    .bind(&v.status)
    .bind(ts)
    .bind(ts)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub struct VersionInput {
    pub name: String,
    pub description: String,
    pub release_date: Option<chrono::NaiveDate>,
    pub status: String,
}

pub async fn list_versions(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<Version>> {
    let rows = sqlx::query_as::<_, Version>(
        "SELECT * FROM versions WHERE project_id = ? ORDER BY release_date IS NULL, release_date DESC, id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_version(pool: &SqlitePool, id: i64) -> AppResult<Option<Version>> {
    let v = sqlx::query_as::<_, Version>("SELECT * FROM versions WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(v)
}

pub async fn update_version(pool: &SqlitePool, id: i64, v: &VersionInput) -> AppResult<()> {
    sqlx::query(
        "UPDATE versions SET name = ?, description = ?, release_date = ?, status = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&v.name)
    .bind(&v.description)
    .bind(v.release_date)
    .bind(&v.status)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_version(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("UPDATE cards SET version_id = NULL WHERE version_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM versions WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ GitLab ============

pub async fn get_gitlab_config(pool: &SqlitePool, project_id: i64) -> AppResult<Option<GitlabConfig>> {
    let c = sqlx::query_as::<_, GitlabConfig>("SELECT * FROM gitlab_configs WHERE project_id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    Ok(c)
}

pub async fn upsert_gitlab_config(pool: &SqlitePool, project_id: i64, cfg: &GitlabConfigInput) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO gitlab_configs (project_id, base_url, token_encrypted, main_repo, match_regex, auto_complete, \
         sync_interval_minutes, webhook_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(project_id) DO UPDATE SET base_url = excluded.base_url, token_encrypted = excluded.token_encrypted, \
         main_repo = excluded.main_repo, match_regex = excluded.match_regex, auto_complete = excluded.auto_complete, \
         sync_interval_minutes = excluded.sync_interval_minutes, webhook_secret = excluded.webhook_secret, \
         updated_at = excluded.updated_at",
    )
    .bind(project_id)
    .bind(&cfg.base_url)
    .bind(&cfg.token_encrypted)
    .bind(&cfg.main_repo)
    .bind(&cfg.match_regex)
    .bind(cfg.auto_complete)
    .bind(cfg.sync_interval_minutes)
    .bind(&cfg.webhook_secret)
    .bind(ts)
    .bind(ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub struct GitlabConfigInput {
    pub base_url: String,
    pub token_encrypted: String,
    pub main_repo: String,
    pub match_regex: String,
    pub auto_complete: bool,
    pub sync_interval_minutes: i64,
    pub webhook_secret: String,
}

pub async fn update_gitlab_sync_status(
    pool: &SqlitePool,
    project_id: i64,
    status: &str,
    error: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE gitlab_configs SET last_sync_at = ?, last_sync_status = ?, last_sync_error = ?, updated_at = ? WHERE project_id = ?",
    )
    .bind(now())
    .bind(status)
    .bind(error)
    .bind(now())
    .bind(project_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 幂等插入提交记录（commit_sha 唯一，冲突忽略）。
pub async fn insert_git_commit(pool: &SqlitePool, c: &GitCommitInput) -> AppResult<bool> {
    let res = sqlx::query(
        "INSERT OR IGNORE INTO git_commits (project_id, card_id, repo, commit_sha, author_name, author_email, \
         message, committed_at, commit_url, mr_url, matched_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(c.project_id)
    .bind(c.card_id)
    .bind(&c.repo)
    .bind(&c.commit_sha)
    .bind(&c.author_name)
    .bind(&c.author_email)
    .bind(&c.message)
    .bind(c.committed_at)
    .bind(&c.commit_url)
    .bind(&c.mr_url)
    .bind(c.matched_no)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

pub struct GitCommitInput {
    pub project_id: i64,
    pub card_id: Option<i64>,
    pub repo: String,
    pub commit_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub message: String,
    pub committed_at: Option<chrono::DateTime<Utc>>,
    pub commit_url: String,
    pub mr_url: String,
    pub matched_no: Option<i64>,
}

pub async fn list_git_commits_for_card(pool: &SqlitePool, card_id: i64) -> AppResult<Vec<GitCommit>> {
    let rows = sqlx::query_as::<_, GitCommit>(
        "SELECT * FROM git_commits WHERE card_id = ? ORDER BY committed_at DESC, id DESC",
    )
    .bind(card_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ============ 通知 ============

pub async fn create_notification(
    pool: &SqlitePool,
    user_id: i64,
    type_: &str,
    title: &str,
    body: &str,
    link: &str,
) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO notifications (user_id, type, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?) RETURNING id",
    )
    .bind(user_id)
    .bind(type_)
    .bind(title)
    .bind(body)
    .bind(link)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_notifications(pool: &SqlitePool, user_id: i64, limit: i64, offset: i64) -> AppResult<Vec<Notification>> {
    let rows = sqlx::query_as::<_, Notification>(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn count_unread_notifications(pool: &SqlitePool, user_id: i64) -> AppResult<i64> {
    let n = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn mark_notification_read(pool: &SqlitePool, id: i64, user_id: i64) -> AppResult<()> {
    sqlx::query("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_all_notifications_read(pool: &SqlitePool, user_id: i64) -> AppResult<()> {
    sqlx::query("UPDATE notifications SET read = 1 WHERE user_id = ?")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ============ 审计 ============

pub async fn create_audit(
    pool: &SqlitePool,
    user_id: Option<i64>,
    action: &str,
    target_type: &str,
    target_id: &str,
    detail: &str,
    ip: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, detail_json, ip, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(detail)
    .bind(ip)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_audit_logs(pool: &SqlitePool, limit: i64, offset: i64) -> AppResult<Vec<AuditLog>> {
    let rows = sqlx::query_as::<_, AuditLog>(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ============ 搜索 ============

#[derive(sqlx::FromRow)]
pub struct SearchRow {
    pub card_id: i64,
    pub card_no: i64,
    pub title: String,
    pub project_key: String,
    pub project_name: String,
    pub board_name: String,
    pub column_name: String,
    pub updated_at: chrono::DateTime<Utc>,
}

pub async fn search_cards(pool: &SqlitePool, user_id: i64, q: &str) -> AppResult<Vec<SearchRow>> {
    let like = format!("%{q}%");
    let rows = sqlx::query_as::<_, SearchRow>(
        "SELECT c.id AS card_id, c.no AS card_no, c.title, p.key AS project_key, p.name AS project_name, \
         b.name AS board_name, col.name AS column_name, c.updated_at \
         FROM cards c \
         JOIN project_members m ON m.project_id = c.project_id AND m.user_id = ? \
         JOIN projects p ON p.id = c.project_id \
         JOIN boards b ON b.id = c.board_id \
         JOIN board_columns col ON col.id = c.column_id \
         WHERE c.status = 'active' AND (c.title LIKE ? OR c.description LIKE ?) \
         ORDER BY c.updated_at DESC LIMIT 100",
    )
    .bind(user_id)
    .bind(&like)
    .bind(&like)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ============ 统计辅助 ============

pub struct MilestoneStats {
    pub total: i64,
    pub done: i64,
}

pub async fn milestone_stats(pool: &SqlitePool, milestone_id: i64) -> AppResult<MilestoneStats> {
    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cards WHERE milestone_id = ? AND status = 'active'",
    )
    .bind(milestone_id)
    .fetch_one(pool)
    .await?;
    let done = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cards c JOIN board_columns col ON col.id = c.column_id \
         WHERE c.milestone_id = ? AND c.status = 'active' AND col.is_done = 1",
    )
    .bind(milestone_id)
    .fetch_one(pool)
    .await?;
    Ok(MilestoneStats { total, done })
}

pub async fn version_stats(pool: &SqlitePool, version_id: i64) -> AppResult<MilestoneStats> {
    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cards WHERE version_id = ? AND status = 'active'",
    )
    .bind(version_id)
    .fetch_one(pool)
    .await?;
    let done = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM cards c JOIN board_columns col ON col.id = c.column_id \
         WHERE c.version_id = ? AND c.status = 'active' AND col.is_done = 1",
    )
    .bind(version_id)
    .fetch_one(pool)
    .await?;
    Ok(MilestoneStats { total, done })
}

pub async fn checklist_progress(pool: &SqlitePool, card_id: i64) -> AppResult<(i64, i64)> {
    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id WHERE c.card_id = ?",
    )
    .bind(card_id)
    .fetch_one(pool)
    .await?;
    let done = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id \
         WHERE c.card_id = ? AND i.done = 1",
    )
    .bind(card_id)
    .fetch_one(pool)
    .await?;
    Ok((done, total))
}

// ============ 卡片模板 / 保存视图 ============

pub async fn create_card_template(pool: &SqlitePool, project_id: i64, name: &str, title: &str, description: &str, label_names: &str) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO card_templates (project_id, name, title, description, label_names, created_at) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(project_id)
    .bind(name)
    .bind(title)
    .bind(description)
    .bind(label_names)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn list_card_templates(pool: &SqlitePool, project_id: i64) -> AppResult<Vec<CardTemplate>> {
    let rows = sqlx::query_as::<_, CardTemplate>(
        "SELECT * FROM card_templates WHERE project_id = ? ORDER BY id",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_saved_views(pool: &SqlitePool, user_id: i64, board_id: i64) -> AppResult<Vec<SavedView>> {
    let rows = sqlx::query_as::<_, SavedView>(
        "SELECT * FROM saved_views WHERE user_id = ? AND board_id = ? ORDER BY id",
    )
    .bind(user_id)
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create_saved_view(pool: &SqlitePool, user_id: i64, board_id: i64, name: &str, filter_json: &str) -> AppResult<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO saved_views (user_id, board_id, name, filter_json, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(user_id)
    .bind(board_id)
    .bind(name)
    .bind(filter_json)
    .bind(now())
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn delete_saved_view(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM saved_views WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

// ============ 工具 ============

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.message().contains("UNIQUE") || db.message().contains("unique"))
}
