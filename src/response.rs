//! 统一 JSON 响应结构与 Askama 模板渲染辅助

use askama::Template;
use axum::response::{Html, IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::error::AppResult;

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

pub fn ok<T: Serialize>(data: T) -> Json<ApiResponse<T>> {
    Json(ApiResponse { code: 0, message: "ok".into(), data: Some(data) })
}

pub fn ok_empty() -> Json<ApiResponse<()>> {
    Json(ApiResponse { code: 0, message: "ok".into(), data: None })
}

pub fn message<T: Serialize>(msg: &str) -> Json<ApiResponse<T>> {
    Json(ApiResponse { code: 0, message: msg.into(), data: None })
}

/// 渲染 Askama 模板为 HTML 响应。
pub fn render<T: Template>(t: &T) -> Response {
    match t.render() {
        Ok(html) => Html(html).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("模板渲染失败: {e}"),
        )
            .into_response(),
    }
}

/// 渲染结果（可 `?` 传播）。
pub fn render_result<T: Template>(t: &T) -> AppResult<Response> {
    Ok(render(t))
}

/// 分页信息。
#[derive(Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}
