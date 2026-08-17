//! 路由装配

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::error::AppError;
use crate::middleware::{RequireAuth, SESSION_COOKIE};
use crate::response::ok;
use crate::state::AppState;

pub fn build(state: AppState) -> Router {
    let api = Router::new()
        .merge(crate::handlers::boards::routes())
        .merge(crate::handlers::cards::routes())
        .merge(crate::handlers::meta::routes())
        .merge(crate::handlers::gitlab::routes())
        .merge(crate::handlers::webhooks::routes())
        .merge(crate::handlers::files::routes())
        .route("/stream", get(stream))
        .route("/markdown/preview", axum::routing::post(markdown_preview));

    let static_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/web/static");

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
        .nest_service("/static", tower_http::services::ServeDir::new(static_dir))
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
                channel.is_empty()
                    || ev.channel == channel
                    || ev.channel == user_channel
                    || ev.channel.starts_with("user:")
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

// 保留引用，确保编译期检查 SESSION_COOKIE 常量存在
#[allow(dead_code)]
fn _touch() {
    let _ = SESSION_COOKIE;
    let _ = AppError::NotFound;
}
