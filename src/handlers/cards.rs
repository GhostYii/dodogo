//! 卡片与协作内容接口（评论/清单/标签/活动）

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::markdown;
use crate::middleware::RequireAuth;
use crate::models::*;
use crate::permission;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::services;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/columns/{id}/cards", post(create_card))
        .route("/cards/{id}", get(get_card).patch(patch_card))
        .route("/cards/{id}/move", post(move_card))
        .route("/cards/{id}/copy", post(copy_card))
        .route("/cards/{id}/archive", post(toggle_archive))
        .route("/cards/{id}", axum::routing::delete(delete_card))
        .route("/cards/{id}/comments", post(add_comment))
        .route("/comments/{id}", axum::routing::patch(update_comment).delete(delete_comment))
        .route("/cards/{id}/checklists", post(create_checklist))
        .route("/checklists/{id}", axum::routing::delete(delete_checklist))
        .route("/checklists/{id}/items", post(create_checklist_item))
        .route("/checklist-items/{id}", axum::routing::patch(update_checklist_item).delete(delete_checklist_item))
        .route("/projects/{key}/labels", get(list_labels).post(create_label))
        .route("/labels/{id}", axum::routing::delete(delete_label))
        .route("/cards/{id}/labels", axum::routing::put(set_card_labels))
        .route("/cards/{id}/activities", get(list_activities))
}

// ============ 卡片 ============

async fn load_card_project(
    state: &AppState,
    card_id: i64,
    user: &crate::middleware::CurrentUser,
) -> AppResult<(Card, crate::models::Project)> {
    let card = repos::get_card(&state.pool, card_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &project, user).await?;
    Ok((card, project))
}

#[derive(Deserialize)]
pub struct CreateCardReq {
    title: String,
    description: Option<String>,
    priority: Option<String>,
    assignee_id: Option<i64>,
    due_date: Option<chrono::NaiveDate>,
    milestone_id: Option<i64>,
    version_id: Option<i64>,
    #[serde(default)]
    template_id: Option<i64>,
}

async fn create_card(State(state): State<AppState>, user: RequireAuth, Path(column_id): Path<i64>, Json(req): Json<CreateCardReq>) -> AppResult<impl IntoResponse> {
    let col = repos::get_column(&state.pool, column_id).await?.ok_or(AppError::NotFound)?;
    let board = repos::get_board(&state.pool, col.board_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    let role = permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;

    let title = if req.title.trim().is_empty() { "未命名卡片".to_string() } else { req.title.trim().to_string() };

    // 套用卡片模板（可选）
    let mut description = req.description.unwrap_or_default();
    if let Some(tid) = req.template_id
        && let Some(tpl) = load_template(&state, tid).await
            && description.is_empty() {
                description = tpl.description;
            }

    let no = repos::next_card_no(&state.pool, project.id).await?;
    let cards = repos::list_cards_by_column(&state.pool, column_id).await?;
    let position = cards.last().map(|c| c.position + 1024).unwrap_or(1024);

    let id = repos::create_card(
        &state.pool,
        &repos::NewCard {
            project_id: project.id,
            board_id: board.id,
            column_id,
            no,
            title: title.clone(),
            description,
            assignee_id: req.assignee_id,
            priority: req.priority.unwrap_or_else(|| "p2".into()),
            start_date: None,
            due_date: req.due_date,
            estimate_hours: None,
            milestone_id: req.milestone_id,
            version_id: req.version_id,
            position,
            created_by: user.0.id,
        },
    )
    .await?;

    services::log_activity(&state, project.id, id, &user.0, "created", &format!("创建卡片 {}-{}", project.key, no)).await.ok();
    if let Some(aid) = req.assignee_id
        && aid != user.0.id {
            services::notify(&state, aid, "assigned", "你被指派了新任务", &format!("{}-{} {}", project.key, no, title), &format!("/p/{}/card/{}", project.key, id)).await.ok();
        }
    let card = repos::get_card(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    state.broadcast(&format!("board:{}", board.id), "card.created", json!({ "cardId": id, "boardId": board.id, "columnId": column_id }));
    Ok(ok(json!({ "id": card.id, "no": card.no, "number": card.number(&project.key), "role": role })))
}

async fn load_template(state: &AppState, id: i64) -> Option<CardTemplate> {
    // 模板按项目校验在服务层，此处简单加载。
    sqlx::query_as::<_, CardTemplate>("SELECT * FROM card_templates WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
}

async fn get_card(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let detail = assemble_card_detail(&state, id, &user.0).await?;
    Ok(ok(detail))
}

async fn assemble_card_detail(state: &AppState, id: i64, user: &crate::middleware::CurrentUser) -> AppResult<CardDetail> {
    let (card, project) = load_card_project(state, id, user).await?;
    let column = repos::get_column(&state.pool, card.column_id).await?.ok_or(AppError::NotFound)?;

    let assignee = match card.assignee_id {
        Some(aid) => {
            let u = repos::get_user_by_id(&state.pool, aid).await?;
            u.map(|u| AssigneeDto { id: u.id, username: u.username, display_name: u.display_name, avatar_path: u.avatar_path })
        }
        None => None,
    };

    let labels: Vec<LabelDto> = {
        let ids = repos::get_card_label_ids(&state.pool, id).await?;
        let mut out = Vec::new();
        for lid in ids {
            if let Some(l) = repos::get_label(&state.pool, lid).await? {
                out.push(LabelDto::from(l));
            }
        }
        out
    };

    let milestone = match card.milestone_id {
        Some(mid) => {
            let m = repos::get_milestone(&state.pool, mid).await?;
            let stats = repos::milestone_stats(&state.pool, mid).await?;
            m.map(|m| MilestoneDto {
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
            })
        }
        None => None,
    };

    let version = match card.version_id {
        Some(vid) => {
            let v = repos::get_version(&state.pool, vid).await?;
            let stats = repos::version_stats(&state.pool, vid).await?;
            v.map(|v| VersionDto {
                id: v.id,
                name: v.name,
                description: v.description,
                release_date: v.release_date,
                status: v.status,
                total_cards: stats.total,
                done_cards: stats.done,
                percent: percent(stats.done, stats.total),
            })
        }
        None => None,
    };

    let comments: Vec<CommentDto> = {
        let rows = repos::list_comments(&state.pool, id).await?;
        let mut out = Vec::new();
        for c in rows {
            let u = repos::get_user_by_id(&state.pool, c.user_id).await?;
            out.push(CommentDto {
                id: c.id,
                user_id: c.user_id,
                username: u.as_ref().map(|u| u.username.clone()).unwrap_or_else(|| "已删除用户".into()),
                display_name: u.as_ref().map(|u| u.display_name.clone()).unwrap_or_else(|| "已删除用户".into()),
                avatar_path: u.as_ref().and_then(|u| u.avatar_path.clone()),
                content_html: markdown::render(&c.content),
                created_at: c.created_at,
                updated_at: c.updated_at,
            });
        }
        out
    };

    let checklists: Vec<ChecklistDto> = {
        let rows = repos::list_checklists(&state.pool, id).await?;
        let mut out = Vec::new();
        for c in rows {
            let items = repos::list_checklist_items(&state.pool, c.id).await?;
            out.push(ChecklistDto {
                id: c.id,
                title: c.title,
                items: items.into_iter().map(|i| ChecklistItemDto { id: i.id, title: i.title, done: i.done }).collect(),
            });
        }
        out
    };

    let attachments: Vec<AttachmentDto> = {
        let rows = repos::list_attachments(&state.pool, id).await?;
        let mut out = Vec::new();
        for a in rows {
            let u = repos::get_user_by_id(&state.pool, a.uploader_id).await?;
            out.push(AttachmentDto {
                id: a.id,
                file_name: a.file_name,
                file_size: a.file_size,
                mime_type: a.mime_type,
                uploader_id: a.uploader_id,
                uploader_name: u.as_ref().map(|u| u.username.clone()).unwrap_or_default(),
                created_at: a.created_at,
            });
        }
        out
    };

    let activities: Vec<ActivityDto> = {
        let rows = repos::list_activities(&state.pool, id).await?;
        let mut out = Vec::new();
        for a in rows {
            let u = match a.user_id {
                Some(uid) => repos::get_user_by_id(&state.pool, uid).await?,
                None => None,
            };
            out.push(ActivityDto {
                id: a.id,
                user_id: a.user_id,
                username: u.as_ref().map(|u| u.username.clone()),
                display_name: u.as_ref().map(|u| u.display_name.clone()),
                action: a.action,
                detail: a.detail_json,
                created_at: a.created_at,
            });
        }
        out
    };

    let git_commits: Vec<GitCommitDto> = {
        let rows = repos::list_git_commits_for_card(&state.pool, id).await?;
        rows.into_iter()
            .map(|g| GitCommitDto {
                id: g.id,
                short_sha: g.commit_sha.chars().take(8).collect(),
                author_name: g.author_name,
                message: g.message,
                committed_at: g.committed_at,
                commit_url: g.commit_url,
                mr_url: g.mr_url,
            })
            .collect()
    };

    Ok(CardDetail {
        id: card.id,
        no: card.no,
        number: card.number(&project.key),
        title: card.title,
        description: card.description.clone(),
        description_html: markdown::render(&card.description),
        column_id: card.column_id,
        column_name: column.name,
        board_id: card.board_id,
        priority: card.priority,
        assignee,
        labels,
        start_date: card.start_date,
        due_date: card.due_date,
        estimate_hours: card.estimate_hours,
        milestone,
        version,
        status: card.status,
        created_by: card.created_by,
        created_at: card.created_at,
        updated_at: card.updated_at,
        comments,
        checklists,
        attachments,
        activities,
        git_commits,
    })
}

fn percent(done: i64, total: i64) -> i32 {
    if total == 0 {
        0
    } else {
        ((done as f64 / total as f64) * 100.0).round() as i32
    }
}

#[derive(Deserialize)]
pub struct PatchCardReq {
    title: Option<String>,
    description: Option<String>,
    assignee_id: Option<Option<i64>>,
    priority: Option<String>,
    start_date: Option<Option<chrono::NaiveDate>>,
    due_date: Option<Option<chrono::NaiveDate>>,
    estimate_hours: Option<Option<f64>>,
    milestone_id: Option<Option<i64>>,
    version_id: Option<Option<i64>>,
    #[serde(default)]
    updated_at: Option<String>,
}

async fn patch_card(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<PatchCardReq>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;

    // 乐观锁：请求携带 updatedAt 时校验
    if let Some(expected) = &req.updated_at {
        let cur = card.updated_at.to_rfc3339();
        if &cur != expected {
            return Err(AppError::Conflict);
        }
    }

    let patch = repos::CardPatch {
        title: req.title,
        description: req.description.clone(),
        assignee_id: req.assignee_id,
        priority: req.priority,
        start_date: req.start_date,
        due_date: req.due_date,
        estimate_hours: req.estimate_hours,
        milestone_id: req.milestone_id,
        version_id: req.version_id,
    };
    repos::patch_card(&state.pool, id, &patch, user.0.id).await?;

    // 指派变更通知
    if let Some(Some(new_assignee)) = patch.assignee_id
        && Some(new_assignee) != card.assignee_id && new_assignee != user.0.id {
            services::notify(&state, new_assignee, "assigned", "你被指派了新任务", &format!("{}-{} {}", project.key, card.no, card.title), &format!("/p/{}/card/{}", project.key, id)).await.ok();
        }

    let changes = describe_changes(&patch);
    services::log_activity(&state, project.id, id, &user.0, "updated", &format!("更新了卡片：{}", changes)).await.ok();
    state.broadcast(&format!("board:{}", card.board_id), "card.updated", json!({ "cardId": id }));
    let detail = assemble_card_detail(&state, id, &user.0).await?;
    Ok(ok(detail))
}

fn describe_changes(_p: &repos::CardPatch) -> String {
    "字段变更".to_string()
}

#[derive(Deserialize)]
pub struct MoveCardReq {
    column_id: i64,
    before_card_id: Option<i64>,
    after_card_id: Option<i64>,
}

async fn move_card(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<MoveCardReq>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;

    let target_col = repos::get_column(&state.pool, req.column_id).await?.ok_or(AppError::NotFound)?;
    if target_col.board_id != card.board_id {
        return Err(AppError::Business("目标列不属于同一看板".into()));
    }

    // WIP 检查（项目设置决定是否阻止）
    if target_col.wip_limit > 0 {
        let count = repos::count_cards_in_column(&state.pool, req.column_id).await?;
        if target_col.id != card.column_id && count >= target_col.wip_limit as i64 {
            let wip_mode = repos::get_setting(&state.pool, "wip_mode").await?.unwrap_or_else(|| "warn".into());
            if wip_mode == "block" {
                return Err(AppError::Business("目标列已达到 WIP 上限".into()));
            }
        }
    }

    // 整列重排
    let cards = repos::list_cards_by_column(&state.pool, req.column_id).await?;
    let mut target_cards: Vec<i64> = cards.iter().filter(|c| c.id != id).map(|c| c.id).collect();
    let insert_at = if let Some(after_id) = req.after_card_id {
        target_cards.iter().position(|cid| *cid == after_id).map(|p| p + 1).unwrap_or(target_cards.len())
    } else if let Some(before_id) = req.before_card_id {
        target_cards.iter().position(|cid| *cid == before_id).unwrap_or(target_cards.len())
    } else {
        target_cards.len()
    };
    target_cards.insert(insert_at, id);

    let mut tx = state.pool.begin().await?;
    for (i, cid) in target_cards.iter().enumerate() {
        let pos = ((i + 1) as i64) * 1024;
        sqlx::query("UPDATE cards SET column_id = ?, position = ?, updated_by = ?, updated_at = ? WHERE id = ?")
            .bind(req.column_id)
            .bind(pos)
            .bind(user.0.id)
            .bind(chrono::Utc::now())
            .bind(cid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let from_col_name = repos::get_column(&state.pool, card.column_id).await?.map(|c| c.name).unwrap_or_default();
    let to_col_name = target_col.name.clone();
    if card.column_id != req.column_id {
        services::log_activity(&state, project.id, id, &user.0, "moved", &format!("从「{}」移动到「{}」", from_col_name, to_col_name)).await.ok();
    }
    state.broadcast(&format!("board:{}", card.board_id), "card.moved", json!({ "cardId": id, "fromColumn": card.column_id, "toColumn": req.column_id }));
    Ok(ok_empty())
}

async fn copy_card(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    let no = repos::next_card_no(&state.pool, project.id).await?;
    let new_id = repos::create_card(
        &state.pool,
        &repos::NewCard {
            project_id: card.project_id,
            board_id: card.board_id,
            column_id: card.column_id,
            no,
            title: format!("{} (副本)", card.title),
            description: card.description.clone(),
            assignee_id: None,
            priority: card.priority.clone(),
            start_date: card.start_date,
            due_date: card.due_date,
            estimate_hours: card.estimate_hours,
            milestone_id: card.milestone_id,
            version_id: card.version_id,
            position: card.position + 1,
            created_by: user.0.id,
        },
    )
    .await?;
    Ok(ok(json!({ "id": new_id, "no": no })))
}

async fn toggle_archive(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    let role = permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    if card.created_by != user.0.id && !permission::role_at_least(&role, permission::ROLE_ADMIN) {
        return Err(AppError::Forbidden);
    }
    let new_status = if card.status == STATUS_ARCHIVED { STATUS_ACTIVE } else { STATUS_ARCHIVED };
    repos::set_card_status(&state.pool, id, new_status).await?;
    state.broadcast(&format!("board:{}", card.board_id), "card.deleted", json!({ "cardId": id }));
    Ok(ok_empty())
}

async fn delete_card(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    let role = permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    if card.created_by != user.0.id && !permission::role_at_least(&role, permission::ROLE_ADMIN) {
        return Err(AppError::Forbidden);
    }
    repos::set_card_status(&state.pool, id, STATUS_DELETED).await?;
    state.broadcast(&format!("board:{}", card.board_id), "card.deleted", json!({ "cardId": id }));
    Ok(ok_empty())
}

// ============ 评论 ============

#[derive(Deserialize)]
pub struct CommentReq {
    content: String,
}

async fn add_comment(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<CommentReq>) -> AppResult<impl IntoResponse> {
    let (card, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    if req.content.trim().is_empty() {
        return Err(AppError::Param("评论内容不能为空".into()));
    }
    let cid = repos::create_comment(&state.pool, id, user.0.id, &req.content).await?;
    services::log_activity(&state, project.id, id, &user.0, "commented", "添加了评论").await.ok();
    state.broadcast(&format!("board:{}", card.board_id), "comment.added", json!({ "cardId": id, "commentId": cid }));
    Ok(ok(json!({ "id": cid })))
}

async fn update_comment(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<CommentReq>) -> AppResult<impl IntoResponse> {
    let comment = repos::get_comment(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let card = repos::get_card(&state.pool, comment.card_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    let role = permission::require_member(&state.pool, &project, &user.0).await?;
    if comment.user_id != user.0.id && !permission::role_at_least(&role, permission::ROLE_ADMIN) {
        return Err(AppError::Forbidden);
    }
    repos::update_comment(&state.pool, id, &req.content).await?;
    Ok(ok_empty())
}

async fn delete_comment(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let comment = repos::get_comment(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let card = repos::get_card(&state.pool, comment.card_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    let role = permission::require_member(&state.pool, &project, &user.0).await?;
    if comment.user_id != user.0.id && !permission::role_at_least(&role, permission::ROLE_ADMIN) {
        return Err(AppError::Forbidden);
    }
    repos::delete_comment(&state.pool, id).await?;
    Ok(ok_empty())
}

// ============ 清单 ============

#[derive(Deserialize)]
pub struct ChecklistReq {
    title: String,
}

async fn create_checklist(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<ChecklistReq>) -> AppResult<impl IntoResponse> {
    let (_, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    let checklists = repos::list_checklists(&state.pool, id).await?;
    let cid = repos::create_checklist(&state.pool, id, &req.title, checklists.len() as i32).await?;
    Ok(ok(json!({ "id": cid })))
}

async fn delete_checklist(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let cl = repos::get_checklist(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let (_, project) = load_card_project(&state, cl.card_id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    repos::delete_checklist(&state.pool, id).await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct ChecklistItemReq {
    title: String,
}

async fn create_checklist_item(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<ChecklistItemReq>) -> AppResult<impl IntoResponse> {
    let cl = repos::get_checklist(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let (_, project) = load_card_project(&state, cl.card_id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    let items = repos::list_checklist_items(&state.pool, id).await?;
    let iid = repos::create_checklist_item(&state.pool, id, &req.title, items.len() as i32).await?;
    Ok(ok(json!({ "id": iid })))
}

#[derive(Deserialize)]
pub struct ChecklistItemPatchReq {
    title: Option<String>,
    done: Option<bool>,
}

async fn update_checklist_item(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<ChecklistItemPatchReq>) -> AppResult<impl IntoResponse> {
    // 通过 checklist_item → checklist → card 找项目校验权限
    let item = sqlx::query_as::<_, ChecklistItem>("SELECT * FROM checklist_items WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let cl = repos::get_checklist(&state.pool, item.checklist_id).await?.ok_or(AppError::NotFound)?;
    let (_, project) = load_card_project(&state, cl.card_id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    repos::update_checklist_item(&state.pool, id, req.title.as_deref(), req.done).await?;
    Ok(ok_empty())
}

async fn delete_checklist_item(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let item = sqlx::query_as::<_, ChecklistItem>("SELECT * FROM checklist_items WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let cl = repos::get_checklist(&state.pool, item.checklist_id).await?.ok_or(AppError::NotFound)?;
    let (_, project) = load_card_project(&state, cl.card_id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    repos::delete_checklist_item(&state.pool, id).await?;
    Ok(ok_empty())
}

// ============ 标签 ============

async fn list_labels(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = repos::get_project_by_key(&state.pool, &key).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, &user.0).await?;
    let labels = repos::list_labels(&state.pool, p.id).await?;
    Ok(ok(labels.into_iter().map(LabelDto::from).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct LabelReq {
    name: String,
    color: Option<String>,
}

async fn create_label(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<LabelReq>) -> AppResult<impl IntoResponse> {
    let p = repos::get_project_by_key(&state.pool, &key).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let id = repos::create_label(&state.pool, p.id, &req.name, req.color.as_deref().unwrap_or("#3B82F6")).await?;
    Ok(ok(json!({ "id": id })))
}

async fn delete_label(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let label = repos::get_label(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, label.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::delete_label(&state.pool, id).await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct SetLabelsReq {
    label_ids: Vec<i64>,
}

async fn set_card_labels(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<SetLabelsReq>) -> AppResult<impl IntoResponse> {
    let (_, project) = load_card_project(&state, id, &user.0).await?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;
    repos::set_card_labels(&state.pool, id, &req.label_ids).await?;
    Ok(ok_empty())
}

// ============ 活动 ============

async fn list_activities(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let (_, _project) = load_card_project(&state, id, &user.0).await?;
    let rows = repos::list_activities(&state.pool, id).await?;
    let mut out = Vec::new();
    for a in rows {
        let u = match a.user_id {
            Some(uid) => repos::get_user_by_id(&state.pool, uid).await?,
            None => None,
        };
        out.push(ActivityDto {
            id: a.id,
            user_id: a.user_id,
            username: u.as_ref().map(|u| u.username.clone()),
            display_name: u.as_ref().map(|u| u.display_name.clone()),
            action: a.action,
            detail: a.detail_json,
            created_at: a.created_at,
        });
    }
    Ok(ok(out))
}
