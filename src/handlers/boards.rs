//! 看板与列接口

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::middleware::RequireAuth;
use crate::models::{AssigneeDto, BoardFull, BoardDto, CardSummaryDto, ColumnDto, LabelDto};
use crate::permission;
use crate::repos;
use crate::response::{ok, ok_empty};
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/projects/{key}/boards", get(list_boards).post(create_board))
        .route("/boards/{id}", get(get_board).patch(update_board).delete(delete_board))
        .route("/boards/{id}/columns", post(create_column))
        .route("/columns/{id}", axum::routing::patch(update_column).delete(delete_column))
        .route("/columns/{id}/move", post(move_column))
}

// ============ 看板 ============

async fn load_project_and_check(state: &AppState, key: &str, user: &crate::middleware::CurrentUser) -> AppResult<crate::models::Project> {
    let p = repos::get_project_by_key(&state.pool, key).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &p, user).await?;
    Ok(p)
}

async fn list_boards(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>) -> AppResult<impl IntoResponse> {
    let p = load_project_and_check(&state, &key, &user.0).await?;
    let boards = repos::list_boards(&state.pool, p.id).await?;
    let items: Vec<BoardDto> = boards.into_iter().map(BoardDto::from).collect();
    Ok(ok(items))
}

#[derive(Deserialize)]
pub struct CreateBoardReq {
    name: String,
    color: Option<String>,
}

async fn create_board(State(state): State<AppState>, user: RequireAuth, Path(key): Path<String>, Json(req): Json<CreateBoardReq>) -> AppResult<impl IntoResponse> {
    let p = load_project_and_check(&state, &key, &user.0).await?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if req.name.is_empty() {
        return Err(AppError::Param("看板名称不能为空".into()));
    }
    let boards = repos::list_boards(&state.pool, p.id).await?;
    let position = boards.len() as i32;
    let id = repos::create_board(&state.pool, p.id, &req.name, req.color.as_deref().unwrap_or(""), position).await?;
    let board = repos::get_board(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    Ok(ok(BoardDto::from(board)))
}

async fn update_board(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<CreateBoardReq>) -> AppResult<impl IntoResponse> {
    let board = repos::get_board(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::update_board(&state.pool, id, &req.name, req.color.as_deref().unwrap_or("")).await?;
    Ok(ok_empty())
}

async fn delete_board(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let board = repos::get_board(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::set_board_status(&state.pool, id, crate::models::STATUS_ARCHIVED).await?;
    Ok(ok_empty())
}

// ============ 看板全量数据 ============

async fn get_board(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let board = repos::get_board(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &project, &user.0).await?;

    let columns = repos::list_columns(&state.pool, id).await?;
    let cards = repos::list_cards_by_board(&state.pool, id).await?;
    let labels = repos::list_labels(&state.pool, project.id).await?;
    let members = repos::list_members(&state.pool, project.id).await?;

    // 里程碑/版本名称映射（卡片徽标）
    let milestones = repos::list_milestones(&state.pool, project.id).await?;
    let versions = repos::list_versions(&state.pool, project.id).await?;
    let milestone_name_map: HashMap<i64, String> = milestones.iter().map(|m| (m.id, m.name.clone())).collect();
    let version_name_map: HashMap<i64, String> = versions.iter().map(|v| (v.id, v.name.clone())).collect();

    // 封面图映射（卡片 → 首个图片附件 ID）
    let cover_map: HashMap<i64, i64> = repos::card_cover_map(&state.pool, id).await?.into_iter().collect();

    // 标签聚合
    let mut card_labels: HashMap<i64, Vec<LabelDto>> = HashMap::new();
    for label in &labels {
        let _ = label;
    }
    let cl_rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN cards c ON c.id = cl.card_id WHERE c.board_id = ?",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let label_map: HashMap<i64, LabelDto> = labels.iter().map(|l| (l.id, LabelDto::from(l.clone()))).collect();
    for (card_id, label_id) in cl_rows {
        if let Some(l) = label_map.get(&label_id) {
            card_labels.entry(card_id).or_default().push(l.clone());
        }
    }

    // 清单进度聚合
    let prog_rows: Vec<(i64, i64, i64)> = sqlx::query_as(
        "SELECT c.id, COALESCE(SUM(CASE WHEN i.done = 1 THEN 1 ELSE 0 END), 0), COUNT(i.id) \
         FROM cards c LEFT JOIN checklists cl ON cl.card_id = c.id LEFT JOIN checklist_items i ON i.checklist_id = cl.id \
         WHERE c.board_id = ? GROUP BY c.id",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let mut progress: HashMap<i64, (i64, i64)> = HashMap::new();
    for (card_id, done, total) in prog_rows {
        progress.insert(card_id, (done, total));
    }

    // 成员（指派显示）
    let mut member_map: HashMap<i64, AssigneeDto> = HashMap::new();
    for m in &members {
        member_map.insert(
            m.user_id,
            AssigneeDto {
                id: m.user_id,
                username: m.username.clone(),
                display_name: m.display_name.clone(),
                avatar_path: m.avatar_path.clone(),
            },
        );
    }

    let card_dtos: Vec<CardSummaryDto> = cards
        .into_iter()
        .map(|c| {
            let (done, total) = progress.get(&c.id).copied().unwrap_or((0, 0));
            CardSummaryDto {
                id: c.id,
                no: c.no,
                number: c.number(&project.key),
                title: c.title,
                column_id: c.column_id,
                position: c.position,
                priority: c.priority,
                assignee: c.assignee_id.and_then(|aid| member_map.get(&aid).cloned()),
                label_ids: card_labels.get(&c.id).map(|v| v.iter().map(|l| l.id).collect()).unwrap_or_default(),
                milestone_id: c.milestone_id,
                milestone_name: c.milestone_id.and_then(|mid| milestone_name_map.get(&mid).cloned()),
                version_id: c.version_id,
                version_name: c.version_id.and_then(|vid| version_name_map.get(&vid).cloned()),
                due_date: c.due_date,
                checklist_done: done,
                checklist_total: total,
                cover_url: cover_map.get(&c.id).map(|att_id| format!("/api/attachments/{att_id}/download")),
                updated_at: c.updated_at,
            }
        })
        .collect();

    let full = BoardFull {
        board: BoardDto::from(board),
        columns: columns.into_iter().map(ColumnDto::from).collect(),
        cards: card_dtos,
        labels: labels.into_iter().map(LabelDto::from).collect(),
        members: members
            .into_iter()
            .map(|m| AssigneeDto { id: m.user_id, username: m.username, display_name: m.display_name, avatar_path: m.avatar_path })
            .collect(),
    };
    Ok(ok(full))
}

// ============ 列 ============

#[derive(Deserialize)]
pub struct CreateColumnReq {
    name: String,
    color: Option<String>,
    wip_limit: Option<i32>,
    is_done: Option<bool>,
}

async fn create_column(State(state): State<AppState>, user: RequireAuth, Path(board_id): Path<i64>, Json(req): Json<CreateColumnReq>) -> AppResult<impl IntoResponse> {
    let board = repos::get_board(&state.pool, board_id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    if req.name.is_empty() || req.name.chars().count() > 30 {
        return Err(AppError::Param("列名需为 1-30 字符".into()));
    }
    let columns = repos::list_columns(&state.pool, board_id).await?;
    let position = columns.len() as i32;
    let id = repos::create_column(&state.pool, board_id, &req.name, position, req.color.as_deref().unwrap_or(""), req.wip_limit.unwrap_or(0), req.is_done.unwrap_or(false)).await?;
    let col = repos::get_column(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    Ok(ok(ColumnDto::from(col)))
}

async fn update_column(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<CreateColumnReq>) -> AppResult<impl IntoResponse> {
    let col = repos::get_column(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let board = repos::get_board(&state.pool, col.board_id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    repos::update_column(&state.pool, id, &req.name, req.color.as_deref().unwrap_or(""), req.wip_limit.unwrap_or(0), req.is_done.unwrap_or(false)).await?;
    Ok(ok_empty())
}

async fn delete_column(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let col = repos::get_column(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let board = repos::get_board(&state.pool, col.board_id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    let count = repos::count_cards_in_column(&state.pool, id).await?;
    if count > 0 {
        return Err(AppError::Business("列内仍有卡片，请先转移或删除".into()));
    }
    repos::delete_column(&state.pool, id).await?;
    Ok(ok_empty())
}

#[derive(Deserialize)]
pub struct MoveColumnReq {
    position: i32,
}

async fn move_column(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>, Json(req): Json<MoveColumnReq>) -> AppResult<impl IntoResponse> {
    let col = repos::get_column(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let board = repos::get_board(&state.pool, col.board_id).await?.ok_or(AppError::NotFound)?;
    let p = repos::get_project_by_id(&state.pool, board.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &p, &user.0, permission::ROLE_ADMIN).await?;
    // 整列重排
    let mut columns = repos::list_columns(&state.pool, col.board_id).await?;
    if let Some(pos) = columns.iter().position(|c| c.id == id) {
        let item = columns.remove(pos);
        let insert = req.position.clamp(0, columns.len() as i32) as usize;
        columns.insert(insert, item);
    }
    for (i, c) in columns.iter().enumerate() {
        repos::update_column_position(&state.pool, c.id, i as i32).await?;
    }
    Ok(ok_empty())
}
