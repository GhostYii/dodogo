//! 统一错误类型与 HTTP 响应映射（对应《01-软件设计文档》§7.4 错误码）

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

/// 业务错误码（见软件设计文档 §7.4）
pub mod codes {
    pub const PARAM_INVALID: i32 = 10001;
    pub const UNAUTHORIZED: i32 = 10002;
    pub const FORBIDDEN: i32 = 10003;
    pub const NOT_FOUND: i32 = 10004;
    pub const CONFLICT: i32 = 10005;
    pub const UNIQUE_CONFLICT: i32 = 10006;
    pub const RATE_LIMITED: i32 = 10007;
    pub const BUSINESS_RULE: i32 = 10008;
    pub const INTERNAL: i32 = 20001;
    pub const GITLAB_UNAVAILABLE: i32 = 20002;
    pub const GITLAB_UNAUTHORIZED: i32 = 20003;
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Param(String),
    #[error("未登录或会话已失效")]
    Unauthorized,
    #[error("无权限执行此操作")]
    Forbidden,
    #[error("资源不存在")]
    NotFound,
    #[error("数据已被他人更新，请刷新后重试")]
    Conflict,
    #[error("{0}")]
    Unique(String),
    #[error("请求过于频繁，请稍后再试")]
    RateLimited,
    #[error("{0}")]
    Business(String),
    #[error("GitLab 连接失败：{0}")]
    GitlabUnavailable(String),
    #[error("GitLab 令牌失效，请更新令牌")]
    GitlabUnauthorized,
    #[error("内部错误")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn code(&self) -> i32 {
        match self {
            AppError::Param(_) => codes::PARAM_INVALID,
            AppError::Unauthorized => codes::UNAUTHORIZED,
            AppError::Forbidden => codes::FORBIDDEN,
            AppError::NotFound => codes::NOT_FOUND,
            AppError::Conflict => codes::CONFLICT,
            AppError::Unique(_) => codes::UNIQUE_CONFLICT,
            AppError::RateLimited => codes::RATE_LIMITED,
            AppError::Business(_) => codes::BUSINESS_RULE,
            AppError::Internal(_) => codes::INTERNAL,
            AppError::GitlabUnavailable(_) => codes::GITLAB_UNAVAILABLE,
            AppError::GitlabUnauthorized => codes::GITLAB_UNAUTHORIZED,
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            AppError::Param(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Conflict => StatusCode::CONFLICT,
            AppError::Unique(_) => StatusCode::CONFLICT,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::Business(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::GitlabUnavailable(_) => StatusCode::BAD_GATEWAY,
            AppError::GitlabUnauthorized => StatusCode::UNAUTHORIZED,
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    code: i32,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ErrorBody {
            code: self.code(),
            message: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        if let sqlx::Error::RowNotFound = e {
            AppError::NotFound
        } else {
            AppError::Internal(e.into())
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
