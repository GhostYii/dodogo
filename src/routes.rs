//! 路由装配

use axum::extract::{Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::middleware::RequireAuth;
use crate::response::ok;
use crate::state::AppState;

/// 前端静态资源（编译期嵌入二进制，实现单文件可移植部署）。
#[derive(RustEmbed)]
#[folder = "web/static/"]
struct StaticAssets;

pub fn build(state: AppState) -> Router {
    let api = Router::new()
        .merge(crate::handlers::boards::routes())
        .merge(crate::handlers::cards::routes())
        .merge(crate::handlers::meta::routes())
        .merge(crate::handlers::gitlab::routes())
        .merge(crate::handlers::webhooks::routes())
        .merge(crate::handlers::files::routes())
        .route("/users/search", get(crate::handlers::auth::search_users))
        .route("/users/{id}", get(crate::handlers::auth::get_user))
        .route("/stream", get(stream))
        .route("/markdown/preview", axum::routing::post(markdown_preview));

    Router::new()
        .route("/healthz", get(health))
        .route("/api/system/status", get(system_status))
        .nest("/api/auth", crate::handlers::auth::routes())
        .nest("/api/projects", crate::handlers::projects::routes())
        .nest("/api/notifications", crate::handlers::notifications::routes())
        .nest("/api/search", crate::handlers::search::routes())
        .nest("/api/admin", crate::handlers::admin::routes())
        .nest("/api", api)
        .merge(crate::handlers::pages::routes())
        .route("/static/{*path}", get(static_asset))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::csrf_mw,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::session_mw,
        ))
        .layer(
            tower_http::trace::TraceLayer::new_for_http().make_span_with(
                tower_http::trace::DefaultMakeSpan::new().include_headers(false),
            ),
        )
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn system_status(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .is_ok();
    ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "db": if db_ok { "ok" } else { "error" },
        "startedAt": state.started_at,
    }))
}

/// 从嵌入的静态资源提供文件。
async fn static_asset(Path(path): Path<String>) -> impl IntoResponse {
    match StaticAssets::get(path.trim_start_matches('/')) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let mut resp = content.data.into_response();
            let headers = resp.headers_mut();
            if let Ok(v) = HeaderValue::from_str(mime.as_ref()) {
                headers.insert(CONTENT_TYPE, v);
            }
            headers.insert(CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
            resp
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
pub struct StreamQuery {
    channel: Option<String>,
}

async fn stream(State(state): State<AppState>, user: RequireAuth, Query(q): Query<StreamQuery>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let channel = q.channel.unwrap_or_default();
    let user_channel = format!("user:{}", user.0.id);
    let rx = state.tx.subscribe();
    let stream = BroadcastStream::new(rx)
        .filter(move |item| match item {
            Ok(ev) => {
                // 未指定频道：仅推送本人通知；指定频道：推送该频道 + 本人通知
                if channel.is_empty() {
                    ev.channel == user_channel
                } else {
                    ev.channel == channel || ev.channel == user_channel
                }
            }
            Err(_) => false,
        })
        .map(|item| {
            let ev = item.expect("已过滤为 Ok");
            Ok(Event::default().event(ev.event).data(ev.data))
        });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(25)).text("ping"))
}

#[derive(Deserialize)]
pub struct MarkdownReq {
    text: String,
}

async fn markdown_preview(Json(req): Json<MarkdownReq>) -> impl IntoResponse {
    let html = crate::markdown::render(&req.text);
    ok(json!({ "html": html }))
}
