//! SSR 页面路由（/  /login /register /p/... /search /notifications /admin）
//!
//! 注意：本文件为骨架占位。前端模板（Askama + web/static）由前端实现补充，
//! 各页面需替换为真实的模板渲染。路由与权限约定保持不变。

use axum::extract::{Path, Query, State};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum_extra::extract::cookie::CookieJar;

use crate::error::AppError;
use crate::middleware::{CurrentUser, RequireAuth};
use crate::services;
use crate::state::AppState;

pub fn routes() -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/login", get(login_page))
        .route("/register", get(register_page))
        .route("/setup", get(setup_page))
        .route("/", get(home_page))
        .route("/p/{key}", get(project_page))
        .route("/p/{key}/board/{board_id}", get(board_page))
        .route("/p/{key}/milestones", get(milestones_page))
        .route("/p/{key}/releases", get(releases_page))
        .route("/p/{key}/members", get(members_page))
        .route("/p/{key}/settings", get(settings_page))
        .route("/search", get(search_page))
        .route("/notifications", get(notifications_page))
        .route("/admin", get(admin_page))
        .route("/admin/users", get(admin_page))
        .route("/admin/settings", get(admin_page))
        .route("/admin/audit", get(admin_page))
}

fn placeholder(title: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title} - DoDoGo</title></head>\
         <body><h1>{title}</h1><p>页面由前端模板渲染（建设中）。</p></body></html>"
    ))
}

fn page_with_csrf(jar: &CookieJar, html: Html<String>) -> Response {
    let jar = services::ensure_csrf(jar);
    (jar, html).into_response()
}

async fn login_page(jar: CookieJar) -> Response {
    page_with_csrf(&jar, placeholder("登录"))
}

async fn register_page(jar: CookieJar) -> Response {
    page_with_csrf(&jar, placeholder("注册"))
}

async fn setup_page(jar: CookieJar) -> Response {
    page_with_csrf(&jar, placeholder("初始化向导"))
}

async fn home_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    if user.is_none() {
        return Redirect::to("/login").into_response();
    }
    page_with_csrf(&jar, placeholder("工作台"))
}

async fn project_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path(_key): Path<String>) -> Response {
    page_with_csrf(&jar, placeholder("项目"))
}

async fn board_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path((_key, _board_id)): Path<(String, i64)>) -> Response {
    page_with_csrf(&jar, placeholder("看板"))
}

async fn milestones_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path(_key): Path<String>) -> Response {
    page_with_csrf(&jar, placeholder("里程碑"))
}

async fn releases_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path(_key): Path<String>) -> Response {
    page_with_csrf(&jar, placeholder("版本"))
}

async fn members_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path(_key): Path<String>) -> Response {
    page_with_csrf(&jar, placeholder("成员"))
}

async fn settings_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Path(_key): Path<String>) -> Response {
    page_with_csrf(&jar, placeholder("项目设置"))
}

async fn search_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>, Query(_q): Query<SearchQ>) -> Response {
    page_with_csrf(&jar, placeholder("搜索"))
}

#[derive(serde::Deserialize)]
pub struct SearchQ {
    #[allow(dead_code)]
    q: Option<String>,
}

async fn notifications_page(jar: CookieJar, _user: Option<axum::Extension<CurrentUser>>) -> Response {
    page_with_csrf(&jar, placeholder("通知中心"))
}

async fn admin_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    match user {
        Some(axum::Extension(u)) if u.is_admin() => page_with_csrf(&jar, placeholder("管理后台")),
        _ => Redirect::to("/login").into_response(),
    }
}

// 避免未使用告警
#[allow(dead_code)]
fn _keep(_: AppError, _: RequireAuth, _: State<AppState>) {}
