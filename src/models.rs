//! 领域模型：数据库行结构体（FromRow）与 API 响应 DTO（Serialize）
//! 字段命名：数据库列 snake_case；对外 JSON 统一 camelCase。

use serde::Serialize;
use sqlx::FromRow;

pub const ROLE_SYSTEM_ADMIN: &str = "system_admin";
pub const ROLE_USER: &str = "user";

pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_ARCHIVED: &str = "archived";
pub const STATUS_DELETED: &str = "deleted";
pub const STATUS_DISABLED: &str = "disabled";
pub const STATUS_PENDING: &str = "pending";

// ============ 用户 ============

#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub role: String,
    pub status: String,
    pub must_change_pw: bool,
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_login_ip: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub role: String,
    pub status: String,
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for UserDto {
    fn from(u: User) -> Self {
        UserDto {
            id: u.id,
            username: u.username,
            email: u.email,
            display_name: u.display_name,
            avatar_path: u.avatar_path,
            role: u.role,
            status: u.status,
            last_login_at: u.last_login_at,
            created_at: u.created_at,
        }
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct Session {
    pub id: i64,
    pub user_id: i64,
    pub token_hash: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ============ 项目 ============

#[derive(Debug, Clone, FromRow)]
pub struct Project {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: String,
    pub icon_color: String,
    pub icon_path: String,
    pub icon_text: String,
    pub owner_id: i64,
    pub next_card_no: i64,
    pub status: String,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: String,
    pub icon_color: String,
    pub icon_path: String,
    pub icon_text: String,
    pub owner_id: i64,
    pub status: String,
    pub role: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProjectMember {
    pub id: i64,
    pub project_id: i64,
    pub user_id: i64,
    pub role: String,
    pub joined_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDto {
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub role: String,
    pub joined_at: chrono::DateTime<chrono::Utc>,
}

// ============ 看板与列 ============

#[derive(Debug, Clone, FromRow)]
pub struct Board {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct Column {
    pub id: i64,
    pub board_id: i64,
    pub name: String,
    pub position: i32,
    pub color: String,
    pub wip_limit: i32,
    pub is_done: bool,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDto {
    pub id: i64,
    pub name: String,
    pub position: i32,
    pub color: String,
    pub wip_limit: i32,
    pub is_done: bool,
}

impl From<Column> for ColumnDto {
    fn from(c: Column) -> Self {
        ColumnDto {
            id: c.id,
            name: c.name,
            position: c.position,
            color: c.color,
            wip_limit: c.wip_limit,
            is_done: c.is_done,
        }
    }
}

// ============ 卡片 ============

#[derive(Debug, Clone, FromRow)]
pub struct Card {
    pub id: i64,
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
    pub status: String,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_by: i64,
    pub updated_by: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl Card {
    pub fn number(&self, project_key: &str) -> String {
        format!("{}-{}", project_key, self.no)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeDto {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummaryDto {
    pub id: i64,
    pub no: i64,
    pub number: String,
    pub title: String,
    pub column_id: i64,
    pub position: i64,
    pub priority: String,
    pub assignee: Option<AssigneeDto>,
    pub label_ids: Vec<i64>,
    pub milestone_id: Option<i64>,
    pub milestone_name: Option<String>,
    pub version_id: Option<i64>,
    pub version_name: Option<String>,
    pub due_date: Option<chrono::NaiveDate>,
    pub checklist_done: i64,
    pub checklist_total: i64,
    pub cover_url: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelDto {
    pub id: i64,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct Label {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub color: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<Label> for LabelDto {
    fn from(l: Label) -> Self {
        LabelDto { id: l.id, name: l.name, color: l.color }
    }
}

// ============ 评论 ============

#[derive(Debug, Clone, FromRow)]
pub struct Comment {
    pub id: i64,
    pub card_id: i64,
    pub user_id: i64,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentDto {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub content_html: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

// ============ 附件 ============

#[derive(Debug, Clone, FromRow)]
pub struct Attachment {
    pub id: i64,
    pub card_id: i64,
    pub file_name: String,
    pub file_path: String,
    pub file_size: i64,
    pub mime_type: String,
    pub uploader_id: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDto {
    pub id: i64,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub uploader_id: i64,
    pub uploader_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ============ 清单 ============

#[derive(Debug, Clone, FromRow)]
pub struct Checklist {
    pub id: i64,
    pub card_id: i64,
    pub title: String,
    pub position: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ChecklistItem {
    pub id: i64,
    pub checklist_id: i64,
    pub title: String,
    pub done: bool,
    pub position: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItemDto {
    pub id: i64,
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistDto {
    pub id: i64,
    pub title: String,
    pub items: Vec<ChecklistItemDto>,
}

// ============ 活动 ============

#[derive(Debug, Clone, FromRow)]
pub struct Activity {
    pub id: i64,
    pub project_id: i64,
    pub card_id: i64,
    pub user_id: Option<i64>,
    pub action: String,
    pub detail_json: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDto {
    pub id: i64,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub avatar_path: Option<String>,
    pub action: String,
    pub detail: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ============ 里程碑 / 版本 ============

#[derive(Debug, Clone, FromRow)]
pub struct Milestone {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub description: String,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub color: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub color: String,
    pub total_cards: i64,
    pub done_cards: i64,
    pub percent: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct Version {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub description: String,
    pub release_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub release_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub total_cards: i64,
    pub done_cards: i64,
    pub percent: i32,
}

/// 里程碑/版本详情页中的卡片摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaCardDto {
    pub id: i64,
    pub no: i64,
    pub number: String,
    pub title: String,
    pub column_name: String,
    pub done: bool,
    pub priority: String,
    pub due_date: Option<chrono::NaiveDate>,
}

/// 里程碑详情（含关联卡片）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDetailDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub color: String,
    pub total_cards: i64,
    pub done_cards: i64,
    pub percent: i32,
    pub cards: Vec<MetaCardDto>,
}

/// 版本详情（含关联卡片）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetailDto {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub release_date: Option<chrono::NaiveDate>,
    pub status: String,
    pub total_cards: i64,
    pub done_cards: i64,
    pub percent: i32,
    pub cards: Vec<MetaCardDto>,
}

// ============ GitLab ============

#[derive(Debug, Clone, FromRow)]
pub struct GitlabConfig {
    pub id: i64,
    pub project_id: i64,
    pub base_url: String,
    pub token_encrypted: String,
    pub main_repo: String,
    pub match_regex: String,
    pub auto_complete: bool,
    pub sync_interval_minutes: i64,
    pub webhook_secret: String,
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_sync_status: String,
    pub last_sync_error: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct GitCommit {
    pub id: i64,
    pub project_id: i64,
    pub card_id: Option<i64>,
    pub repo: String,
    pub commit_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub message: String,
    pub committed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub commit_url: String,
    pub mr_url: String,
    pub matched_no: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDto {
    pub id: i64,
    pub short_sha: String,
    pub author_name: String,
    pub message: String,
    pub committed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub commit_url: String,
    pub mr_url: String,
}

// ============ 通知 ============

#[derive(Debug, Clone, FromRow)]
pub struct Notification {
    pub id: i64,
    pub user_id: i64,
    #[sqlx(rename = "type")]
    pub type_: String,
    pub title: String,
    pub body: String,
    pub link: String,
    pub read: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDto {
    pub id: i64,
    #[serde(rename = "type")]
    pub type_: String,
    pub title: String,
    pub body: String,
    pub link: String,
    pub read: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<Notification> for NotificationDto {
    fn from(n: Notification) -> Self {
        NotificationDto {
            id: n.id,
            type_: n.type_,
            title: n.title,
            body: n.body,
            link: n.link,
            read: n.read,
            created_at: n.created_at,
        }
    }
}

// ============ 审计 ============

#[derive(Debug, Clone, FromRow)]
pub struct AuditLog {
    pub id: i64,
    pub user_id: Option<i64>,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub detail_json: String,
    pub ip: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogDto {
    pub id: i64,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub detail: String,
    pub ip: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ============ 保存视图 / 卡片模板 ============

#[derive(Debug, Clone, FromRow)]
pub struct SavedView {
    pub id: i64,
    pub user_id: i64,
    pub board_id: i64,
    pub name: String,
    pub filter_json: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct CardTemplate {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub title: String,
    pub description: String,
    pub label_names: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ============ 聚合响应 ============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFull {
    pub board: BoardDto,
    pub columns: Vec<ColumnDto>,
    pub cards: Vec<CardSummaryDto>,
    pub labels: Vec<LabelDto>,
    pub members: Vec<AssigneeDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardDto {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub status: String,
}

impl From<Board> for BoardDto {
    fn from(b: Board) -> Self {
        BoardDto { id: b.id, name: b.name, color: b.color, position: b.position, status: b.status }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDetail {
    pub id: i64,
    pub no: i64,
    pub number: String,
    pub title: String,
    pub description: String,
    pub description_html: String,
    pub column_id: i64,
    pub column_name: String,
    pub board_id: i64,
    pub priority: String,
    pub assignee: Option<AssigneeDto>,
    pub labels: Vec<LabelDto>,
    pub start_date: Option<chrono::NaiveDate>,
    pub due_date: Option<chrono::NaiveDate>,
    pub estimate_hours: Option<f64>,
    pub milestone: Option<MilestoneDto>,
    pub version: Option<VersionDto>,
    pub status: String,
    pub created_by: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub comments: Vec<CommentDto>,
    pub checklists: Vec<ChecklistDto>,
    pub attachments: Vec<AttachmentDto>,
    pub activities: Vec<ActivityDto>,
    pub git_commits: Vec<GitCommitDto>,
}
