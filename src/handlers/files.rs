//! 附件与头像上传/下载接口

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::HeaderValue;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::middleware::RequireAuth;
use crate::models::STATUS_DELETED;
use crate::permission;
use crate::repos;
use crate::response::ok;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/cards/{id}/attachments", post(upload_attachment))
        .route("/attachments/{id}", axum::routing::delete(delete_attachment))
        .route("/attachments/{id}/download", get(download_attachment))
        .route("/avatars/{user_id}", get(serve_avatar))
}

async fn upload_attachment(
    State(state): State<AppState>,
    user: RequireAuth,
    Path(id): Path<i64>,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    let card = repos::get_card(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    if card.status == STATUS_DELETED {
        return Err(AppError::NotFound);
    }
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_role(&state.pool, &project, &user.0, permission::ROLE_MEMBER).await?;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::Param(e.to_string()))? {
        if field.name() == Some("file") {
            let file_name = field.file_name().unwrap_or("file").to_string();
            let content_type = field.content_type().map(|s| s.to_string()).unwrap_or_default();
            let data = field.bytes().await.map_err(|e| AppError::Param(e.to_string()))?;
            let max = state.config.upload.max_file_mb * 1024 * 1024;
            if data.len() > max {
                return Err(AppError::Param("文件超过大小限制".into()));
            }
            let ext = file_name.rsplit('.').next().unwrap_or("bin").to_lowercase();
            let safe_ext: String = ext.chars().filter(|c| c.is_alphanumeric()).take(10).collect();
            let hash = crate::crypto::sha256_hex(&String::from_utf8_lossy(&data));
            let rel = format!("uploads/{}/{}.{}", chrono::Utc::now().format("%Y%m"), &hash[..40], safe_ext);
            let abs = state.config.uploads_dir().join(&rel);
            if let Some(parent) = abs.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| AppError::Internal(e.into()))?;
            }
            tokio::fs::write(&abs, &data).await.map_err(|e| AppError::Internal(e.into()))?;
            let aid = repos::create_attachment(&state.pool, id, &file_name, &rel, data.len() as i64, &content_type, user.0.id).await?;
            return Ok(ok(json!({ "id": aid, "fileName": file_name, "fileSize": data.len() })));
        }
    }
    Err(AppError::Param("缺少文件字段".into()))
}

async fn delete_attachment(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<impl IntoResponse> {
    let a = repos::get_attachment(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let card = repos::get_card(&state.pool, a.card_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    let role = permission::require_member(&state.pool, &project, &user.0).await?;
    if a.uploader_id != user.0.id && !permission::role_at_least(&role, permission::ROLE_ADMIN) {
        return Err(AppError::Forbidden);
    }
    repos::delete_attachment(&state.pool, id).await?;
    let abs = state.config.uploads_dir().join(&a.file_path);
    let _ = tokio::fs::remove_file(&abs).await;
    Ok(crate::response::ok_empty())
}

async fn download_attachment(State(state): State<AppState>, user: RequireAuth, Path(id): Path<i64>) -> AppResult<Response> {
    let a = repos::get_attachment(&state.pool, id).await?.ok_or(AppError::NotFound)?;
    let card = repos::get_card(&state.pool, a.card_id).await?.ok_or(AppError::NotFound)?;
    let project = repos::get_project_by_id(&state.pool, card.project_id).await?.ok_or(AppError::NotFound)?;
    permission::require_member(&state.pool, &project, &user.0).await?;
    let abs = state.config.uploads_dir().join(&a.file_path);
    let bytes = tokio::fs::read(&abs).await.map_err(|e| AppError::Internal(e.into()))?;
    let mime = if a.mime_type.is_empty() {
        mime_guess::from_path(&a.file_name).first_or_octet_stream().to_string()
    } else {
        a.mime_type.clone()
    };
    let mut resp = Response::new(Body::from(bytes));
    resp.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")));
    let disp = format!("attachment; filename=\"{}\"", a.file_name.replace('"', ""));
    if let Ok(v) = HeaderValue::from_str(&disp) {
        resp.headers_mut().insert(CONTENT_DISPOSITION, v);
    }
    Ok(resp)
}

async fn serve_avatar(State(state): State<AppState>, Path(user_id): Path<i64>) -> AppResult<Response> {
    let u = repos::get_user_by_id(&state.pool, user_id).await?.ok_or(AppError::NotFound)?;
    let Some(rel) = u.avatar_path else {
        return Ok(Response::builder().status(404).body(Body::from("no avatar")).unwrap());
    };
    let abs = state.config.uploads_dir().join(&rel);
    match tokio::fs::read(&abs).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&rel).first_or_octet_stream().to_string();
            let mut resp = Response::new(Body::from(bytes));
            resp.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap_or_else(|_| HeaderValue::from_static("image/png")));
            Ok(resp)
        }
        Err(_) => Ok(Response::builder().status(404).body(Body::from("no avatar")).unwrap()),
    }
}
