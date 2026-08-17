-- DoDoGo v1.0 initial schema (SQLite)
-- 对应《01-软件设计文档》§6.2 核心表结构

PRAGMA foreign_keys = ON;

-- ============ 账号与会话 ============

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    email           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT '',
    avatar_path     TEXT,
    role            TEXT NOT NULL DEFAULT 'user',       -- system_admin | user
    status          TEXT NOT NULL DEFAULT 'active',     -- active | disabled | pending
    must_change_pw  INTEGER NOT NULL DEFAULT 0,
    last_login_at   TEXT,
    last_login_ip   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ============ 系统设置（KV） ============

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- ============ 项目与成员 ============

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    icon_color      TEXT NOT NULL DEFAULT '#3B82F6',
    owner_id        INTEGER NOT NULL REFERENCES users(id),
    next_card_no    INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'active',     -- active | archived | deleted
    deleted_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',         -- owner | admin | member | viewer
    joined_at   TEXT NOT NULL,
    UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);

-- ============ 看板与列 ============

CREATE TABLE IF NOT EXISTS boards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active',         -- active | archived
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boards_project ON boards(project_id);

CREATE TABLE IF NOT EXISTS board_columns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    color       TEXT NOT NULL DEFAULT '',
    wip_limit   INTEGER NOT NULL DEFAULT 0,
    is_done     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active',         -- active | archived
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns(board_id);

-- ============ 卡片 ============

CREATE TABLE IF NOT EXISTS cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    board_id        INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id       INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    no              INTEGER NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    priority        TEXT NOT NULL DEFAULT 'p2',         -- p0 | p1 | p2 | p3
    start_date      TEXT,
    due_date        TEXT,
    estimate_hours  REAL,
    milestone_id    INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
    version_id      INTEGER REFERENCES versions(id) ON DELETE SET NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',     -- active | archived | deleted
    deleted_at      TEXT,
    created_by      INTEGER NOT NULL REFERENCES users(id),
    updated_by      INTEGER NOT NULL REFERENCES users(id),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (project_id, no)
);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
CREATE INDEX IF NOT EXISTS idx_cards_assignee ON cards(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_milestone ON cards(milestone_id);
CREATE INDEX IF NOT EXISTS idx_cards_version ON cards(version_id);

-- ============ 标签 ============

CREATE TABLE IF NOT EXISTS labels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#3B82F6',
    created_at  TEXT NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS card_labels (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    UNIQUE (card_id, label_id)
);

-- ============ 评论 ============

CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at);

-- ============ 附件 ============

CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    file_name   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_size   INTEGER NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT '',
    uploader_id INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);

-- ============ 清单 ============

CREATE TABLE IF NOT EXISTS checklists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklists_card ON checklists(card_id);

CREATE TABLE IF NOT EXISTS checklist_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_checklist ON checklist_items(checklist_id);

-- ============ 卡片活动时间线 ============

CREATE TABLE IF NOT EXISTS activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_card ON activities(card_id, created_at);

-- ============ 里程碑与版本 ============

CREATE TABLE IF NOT EXISTS milestones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date  TEXT,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'open',           -- open | in_progress | done | overdue
    color       TEXT NOT NULL DEFAULT '#3B82F6',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    release_date TEXT,
    status      TEXT NOT NULL DEFAULT 'planned',        -- planned | dev | frozen | released | archived
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- ============ GitLab 联动 ============

CREATE TABLE IF NOT EXISTS gitlab_configs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id            INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    base_url              TEXT NOT NULL DEFAULT '',
    token_encrypted       TEXT NOT NULL DEFAULT '',
    main_repo             TEXT NOT NULL DEFAULT '',
    match_regex           TEXT NOT NULL DEFAULT '',
    auto_complete         INTEGER NOT NULL DEFAULT 0,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 5,
    webhook_secret        TEXT NOT NULL DEFAULT '',
    last_sync_at          TEXT,
    last_sync_status      TEXT NOT NULL DEFAULT '',
    last_sync_error       TEXT NOT NULL DEFAULT '',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS git_commits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id      INTEGER REFERENCES cards(id) ON DELETE CASCADE,
    repo         TEXT NOT NULL DEFAULT '',
    commit_sha   TEXT NOT NULL UNIQUE,
    author_name  TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT '',
    message      TEXT NOT NULL DEFAULT '',
    committed_at TEXT,
    commit_url   TEXT NOT NULL DEFAULT '',
    mr_url       TEXT NOT NULL DEFAULT '',
    matched_no   INTEGER,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commits_card ON git_commits(card_id);
CREATE INDEX IF NOT EXISTS idx_commits_project ON git_commits(project_id);

-- ============ 通知 ============

CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    link        TEXT NOT NULL DEFAULT '',
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);

-- ============ 审计日志 ============

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id   TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    ip          TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============ 保存的筛选视图（个人级） ============

CREATE TABLE IF NOT EXISTS saved_views (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    filter_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
);

-- ============ 卡片模板（项目级） ============

CREATE TABLE IF NOT EXISTS card_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    label_names TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
