//! 私有化 GitLab 集成：HTTP 客户端、单号匹配、增量同步。
//!
//! v1.0 仅支持自托管（私有化部署）的 GitLab CE/EE（基于 REST API v4）。
//! GitLab.com / GitHub.com 等公有云平台不在本模块范围（见设计文档 §4.7）。

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::repos::{self, GitCommitInput};
use crate::state::AppState;

// ============ 地址校验 ============

/// 校验 GitLab 地址，拒绝公有云平台域名。
pub fn validate_base_url(base_url: &str) -> AppResult<()> {
    let url = base_url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err(AppError::Param("请输入 GitLab 地址".into()));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Param("地址需以 http:// 或 https:// 开头".into()));
    }
    let host = url
        .split("://")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase();
    if host == "gitlab.com" || host.ends_with(".gitlab.com") || host == "github.com" || host.ends_with(".github.com") {
        return Err(AppError::Business("v1.0 仅支持私有化部署的 GitLab，公有云平台（gitlab.com / github.com）支持将在后续版本提供".into()));
    }
    Ok(())
}

// ============ 单号匹配 ============

/// 默认匹配规则（KEY 替换为项目 Key）。
pub fn default_regex(key: &str) -> String {
    format!(r"(?i)(?:^|[^0-9A-Za-z-])(?:#|{key}-)(\d+)\b")
}

/// 编译匹配正则。
pub fn compile_regex(pattern: &str, key: &str) -> Result<Regex, AppError> {
    let pattern = if pattern.is_empty() { default_regex(key) } else { pattern.to_string() };
    Regex::new(&pattern).map_err(|e| AppError::Param(format!("正则表达式无效: {e}")))
}

/// 从提交消息中解析出单号。
pub fn match_card_no(message: &str, regex: &Regex) -> Option<i64> {
    regex
        .captures(message)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<i64>().ok())
}

// ============ GitLab REST 客户端 ============

#[derive(Debug, Clone, Deserialize)]
pub struct GitlabCommit {
    pub id: String,
    #[serde(default)]
    pub short_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub author_email: String,
    #[serde(default)]
    pub committed_date: Option<DateTime<Utc>>,
    #[serde(default)]
    pub web_url: String,
}

pub struct GitlabClient {
    pub base_url: String,
    token: String,
    http: reqwest::Client,
}

impl GitlabClient {
    pub fn new(base_url: &str, token: &str) -> Result<Self, AppError> {
        validate_base_url(base_url)?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("DoDoGo/1.0")
            .build()
            .map_err(|e| AppError::Internal(anyhow::anyhow!("HTTP 客户端初始化失败: {e}")))?;
        Ok(Self {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            token: token.to_string(),
            http,
        })
    }

    /// 测试连接：GET /api/v4/user 校验令牌有效性。
    pub async fn test(&self) -> AppResult<()> {
        let url = format!("{}/api/v4/user", self.base_url);
        let resp = self
            .http
            .get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send()
            .await
            .map_err(|e| AppError::GitlabUnavailable(e.to_string()))?;
        match resp.status().as_u16() {
            200 => Ok(()),
            401 => Err(AppError::GitlabUnauthorized),
            s => Err(AppError::GitlabUnavailable(format!("GitLab 返回状态码 {s}"))),
        }
    }

    /// 拉取仓库提交（增量，按 since 时间，分页）。
    pub async fn list_commits(
        &self,
        repo: &str,
        since: Option<DateTime<Utc>>,
        page: u32,
    ) -> AppResult<Vec<GitlabCommit>> {
        let encoded = repo.replace('/', "%2F");
        let mut url = format!("{}/api/v4/projects/{encoded}/repository/commits?per_page=100&page={page}", self.base_url);
        if let Some(s) = since {
            url.push_str(&format!("&since={}", s.to_rfc3339()));
        }
        let resp = self
            .http
            .get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send()
            .await
            .map_err(|e| AppError::GitlabUnavailable(e.to_string()))?;
        let status = resp.status().as_u16();
        if status == 401 {
            return Err(AppError::GitlabUnauthorized);
        }
        if status == 404 {
            return Err(AppError::GitlabUnavailable("仓库不存在或无权限访问".into()));
        }
        if status != 200 {
            return Err(AppError::GitlabUnavailable(format!("GitLab 返回状态码 {status}")));
        }
        let commits: Vec<GitlabCommit> = resp
            .json()
            .await
            .map_err(|e| AppError::GitlabUnavailable(format!("解析响应失败: {e}")))?;
        Ok(commits)
    }
}

// ============ 同步 ============

/// 同步单个项目的 GitLab 提交（手动/轮询调用）。
pub async fn sync_project(state: &AppState, project_id: i64) -> AppResult<SyncReport> {
    let project = repos::get_project_by_id(&state.pool, project_id).await?.ok_or(AppError::NotFound)?;
    let Some(cfg) = repos::get_gitlab_config(&state.pool, project_id).await? else {
        return Err(AppError::Business("尚未配置 GitLab".into()));
    };
    if cfg.base_url.is_empty() || cfg.main_repo.is_empty() {
        return Err(AppError::Business("GitLab 地址或关联仓库未配置".into()));
    }
    let token = crate::crypto::decrypt(&state.master_key, &cfg.token_encrypted)?;
    let client = GitlabClient::new(&cfg.base_url, &token)?;
    let regex = compile_regex(&cfg.match_regex, &project.key)?;

    let mut report = SyncReport::default();
    let mut page = 1u32;
    loop {
        let commits = client.list_commits(&cfg.main_repo, cfg.last_sync_at, page).await?;
        if commits.is_empty() {
            break;
        }
        for c in &commits {
            report.total += 1;
            let Some(no) = match_card_no(&c.message, &regex) else {
                report.unmatched += 1;
                continue;
            };
            let card = repos::get_card_by_no(&state.pool, project_id, no).await?;
            let commit_url = if c.web_url.is_empty() {
                format!("{}/{}/-/commit/{}", cfg.base_url, cfg.main_repo, c.id)
            } else {
                c.web_url.clone()
            };
            let inserted = repos::insert_git_commit(
                &state.pool,
                &GitCommitInput {
                    project_id,
                    card_id: card.as_ref().map(|c| c.id),
                    repo: cfg.main_repo.clone(),
                    commit_sha: c.id.clone(),
                    author_name: c.author_name.clone(),
                    author_email: c.author_email.clone(),
                    message: c.message.clone(),
                    committed_at: c.committed_date,
                    commit_url,
                    mr_url: String::new(),
                    matched_no: Some(no),
                },
            )
            .await?;
            if inserted {
                report.matched += 1;
                if let Some(card) = card {
                    // 通知指派人
                    if let Some(assignee) = card.assignee_id {
                        crate::services::notify(
                            state,
                            assignee,
                            "gitlab",
                            "关联卡片出现新提交",
                            &format!("{}-{} {}", project.key, card.no, card.title),
                            &format!("/p/{}/card/{}", project.key, card.id),
                        )
                        .await
                        .ok();
                    }
                }
            }
        }
        if commits.len() < 100 {
            break;
        }
        page += 1;
        if page > 5 {
            break; // 单次同步上限 500 条
        }
    }

    repos::update_gitlab_sync_status(&state.pool, project_id, "ok", "").await?;
    Ok(report)
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub total: i64,
    pub matched: i64,
    pub unmatched: i64,
}
