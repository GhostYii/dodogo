//! SSR 页面路由（/  /login /register /setup /p/... /search /notifications /admin）
//!
//! 每个页面由 Askama 模板渲染（templates/ 目录），渲染统一走
//! `crate::response::render`。页面响应前调用 `services::ensure_csrf` 设置
//! CSRF Cookie，并在 `<meta name="csrf-token">` 中输出其值（见 base.html）。

use askama::Template;
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum_extra::extract::cookie::CookieJar;

use crate::error::AppError;
use crate::middleware::CurrentUser;
use crate::permission;
use crate::repos;
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
        .route("/users/{user_id}", get(user_profile_page))
        .route("/admin", get(admin_page))
        .route("/admin/users", get(admin_users_page))
        .route("/admin/settings", get(admin_settings_page))
        .route("/admin/audit", get(admin_audit_page))
}

// ============ 通用辅助 ============

/// 确保 CSRF Cookie 存在，返回 (新的 jar, csrf token)。
fn page_jar(jar: &CookieJar) -> (CookieJar, String) {
    let jar = services::ensure_csrf(jar);
    let token = services::csrf_token(&jar);
    (jar, token)
}

/// 渲染模板并附带 CSRF Cookie。
fn render_page<T: Template>(jar: CookieJar, tpl: &T) -> Response {
    let jar = services::ensure_csrf(&jar);
    (jar, crate::response::render(tpl)).into_response()
}

/// 渲染错误页。
fn error_page(jar: CookieJar, title: &str, message: &str) -> Response {
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &ErrorPage {
            csrf,
            title: title.to_string(),
            message: message.to_string(),
        },
    )
}

fn initials(name: &str) -> String {
    let name = name.trim();
    let mut chars = name.chars();
    let first = chars.next().unwrap_or('?');
    let second = chars.next();
    match second {
        Some(s) => format!("{first}{s}"),
        None => first.to_string(),
    }
}

fn role_label(role: &str) -> String {
    match role {
        "owner" => "所有者".into(),
        "admin" => "管理员".into(),
        "member" => "成员".into(),
        "viewer" => "观察者".into(),
        "system_admin" => "系统管理员".into(),
        other => other.to_string(),
    }
}

/// 当前用户渲染视图。
#[derive(Clone)]
struct UserView {
    id: i64,
    username: String,
    display_name: String,
    avatar_url: String,
    initials: String,
    is_admin: bool,
}

impl UserView {
    fn new(u: &CurrentUser) -> Self {
        let avatar_url = if u.avatar_path.is_some() {
            format!("/api/avatars/{}", u.id)
        } else {
            String::new()
        };
        let display_name = if u.display_name.trim().is_empty() {
            u.username.clone()
        } else {
            u.display_name.clone()
        };
        Self {
            id: u.id,
            username: u.username.clone(),
            initials: initials(&display_name),
            avatar_url,
            display_name,
            is_admin: u.is_admin(),
        }
    }
}

/// 项目导航上下文（project_layout.html）。
#[derive(Clone)]
struct NavView {
    key: String,
    name: String,
    icon_color: String,
    initials: String,
    role_label: String,
    default_board_id: i64,
    nav_board: bool,
    nav_milestones: bool,
    nav_releases: bool,
    nav_members: bool,
    nav_settings: bool,
}

/// 加载项目访问上下文：校验成员身份并列出看板。
async fn load_project_context(
    state: &AppState,
    key: &str,
    user: &CurrentUser,
) -> Result<(crate::models::Project, String, Vec<crate::models::Board>), AppError> {
    let project = repos::get_project_by_key(&state.pool, key).await?.ok_or(AppError::NotFound)?;
    let role = permission::require_member(&state.pool, &project, user).await?;
    let boards = repos::list_boards(&state.pool, project.id).await?;
    Ok((project, role, boards))
}

fn build_nav(project: &crate::models::Project, role: &str, boards: &[crate::models::Board], active: &str) -> NavView {
    NavView {
        key: project.key.clone(),
        name: project.name.clone(),
        icon_color: project.icon_color.clone(),
        initials: initials(&project.name),
        role_label: role_label(role),
        default_board_id: boards.first().map(|b| b.id).unwrap_or(-1),
        nav_board: active == "board",
        nav_milestones: active == "milestones",
        nav_releases: active == "releases",
        nav_members: active == "members",
        nav_settings: active == "settings",
    }
}

// ============ 模板上下文 ============

#[derive(Template)]
#[template(path = "login.html")]
struct LoginPage {
    csrf: String,
}

#[derive(Template)]
#[template(path = "register.html")]
struct RegisterPage {
    csrf: String,
}

#[derive(Template)]
#[template(path = "setup.html")]
struct SetupPage {
    csrf: String,
}

#[derive(Template)]
#[template(path = "error.html")]
struct ErrorPage {
    csrf: String,
    title: String,
    message: String,
}

#[derive(Clone)]
struct ProjectView {
    key: String,
    name: String,
    icon_color: String,
    initials: String,
    role_label: String,
}

#[derive(Template)]
#[template(path = "home.html")]
struct HomePage {
    csrf: String,
    page: String,
    user: UserView,
    projects: Vec<ProjectView>,
    has_projects: bool,
}

#[derive(Clone)]
struct BoardView {
    id: i64,
    name: String,
}

#[derive(Template)]
#[template(path = "board.html")]
struct BoardPage {
    csrf: String,
    page: String,
    user: UserView,
    nav: NavView,
    board_id: i64,
    boards: Vec<BoardView>,
}

#[derive(Template)]
#[template(path = "milestones.html")]
struct MilestonesPage {
    csrf: String,
    page: String,
    user: UserView,
    nav: NavView,
}

#[derive(Template)]
#[template(path = "releases.html")]
struct ReleasesPage {
    csrf: String,
    page: String,
    user: UserView,
    nav: NavView,
}

#[derive(Template)]
#[template(path = "members.html")]
struct MembersPage {
    csrf: String,
    page: String,
    user: UserView,
    nav: NavView,
}

#[derive(Template)]
#[template(path = "settings.html")]
struct SettingsPage {
    csrf: String,
    page: String,
    user: UserView,
    nav: NavView,
}

#[derive(Template)]
#[template(path = "search.html")]
struct SearchPage {
    csrf: String,
    page: String,
    user: UserView,
}

#[derive(Template)]
#[template(path = "notifications.html")]
struct NotificationsPage {
    csrf: String,
    page: String,
    user: UserView,
}

/// 成员个人主页中的目标用户信息。
#[derive(Clone)]
struct TargetUserView {
    username: String,
    display_name: String,
    avatar_url: String,
    initials: String,
    role_label: String,
    created_at: String,
}

#[derive(Template)]
#[template(path = "user_profile.html")]
struct UserProfilePage {
    csrf: String,
    page: String,
    user: UserView,
    target: TargetUserView,
}

#[derive(Template)]
#[template(path = "admin.html")]
struct AdminPage {
    csrf: String,
    page: String,
    user: UserView,
    section: String,
    is_overview: bool,
    is_users: bool,
    is_settings: bool,
    is_audit: bool,
}

// ============ 认证页 ============

async fn login_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    if user.is_some() {
        return Redirect::to("/").into_response();
    }
    let (jar, csrf) = page_jar(&jar);
    render_page(jar, &LoginPage { csrf })
}

async fn register_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    if user.is_some() {
        return Redirect::to("/").into_response();
    }
    let (jar, csrf) = page_jar(&jar);
    render_page(jar, &RegisterPage { csrf })
}

async fn setup_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    // 已登录说明系统已初始化，直接进入工作台。
    if user.is_some() {
        return Redirect::to("/").into_response();
    }
    let (jar, csrf) = page_jar(&jar);
    render_page(jar, &SetupPage { csrf })
}

// ============ 工作台 ============

async fn load_home_projects(state: &AppState, user: &CurrentUser) -> Result<Vec<ProjectView>, AppError> {
    let rows = repos::list_projects_for_user(&state.pool, user.id).await?;
    let mut out = Vec::new();
    for p in rows {
        let role = repos::get_member_role(&state.pool, p.id, user.id).await?.unwrap_or_default();
        out.push(ProjectView {
            key: p.key.clone(),
            name: p.name.clone(),
            icon_color: p.icon_color.clone(),
            initials: initials(&p.name),
            role_label: role_label(&role),
        });
    }
    Ok(out)
}

async fn home_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let projects = match load_home_projects(&state, &u).await {
        Ok(p) => p,
        Err(e) => return error_page(jar, "加载失败", &e.to_string()),
    };
    let (jar, csrf) = page_jar(&jar);
    let has_projects = !projects.is_empty();
    render_page(
        jar,
        &HomePage {
            csrf,
            page: "home".into(),
            user: UserView::new(&u),
            projects,
            has_projects,
        },
    )
}

// ============ 项目页 ============

/// `/p/{key}`：重定向到该项目默认看板。
async fn project_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(key): Path<String>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    match load_project_context(&state, &key, &u).await {
        Ok((project, _, boards)) => {
            if let Some(first) = boards.first() {
                Redirect::to(&format!("/p/{}/board/{}", project.key, first.id)).into_response()
            } else {
                error_page(jar, "项目暂无看板", "该项目还没有看板，请联系管理员创建。")
            }
        }
        Err(e) => error_page(jar, "无法访问", &e.to_string()),
    }
}

async fn board_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path((key, board_id)): Path<(String, i64)>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (project, role, boards) = match load_project_context(&state, &key, &u).await {
        Ok(ctx) => ctx,
        Err(e) => return error_page(jar, "无法访问", &e.to_string()),
    };
    if !boards.iter().any(|b| b.id == board_id) {
        return error_page(jar, "看板不存在", "看板不存在或无权访问。");
    }
    let nav = build_nav(&project, &role, &boards, "board");
    let boards_view = boards.iter().map(|b| BoardView { id: b.id, name: b.name.clone() }).collect();
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &BoardPage {
            csrf,
            page: "board".into(),
            user: UserView::new(&u),
            nav,
            board_id,
            boards: boards_view,
        },
    )
}

async fn milestones_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(key): Path<String>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (project, role, boards) = match load_project_context(&state, &key, &u).await {
        Ok(ctx) => ctx,
        Err(e) => return error_page(jar, "无法访问", &e.to_string()),
    };
    let nav = build_nav(&project, &role, &boards, "milestones");
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &MilestonesPage {
            csrf,
            page: "milestones".into(),
            user: UserView::new(&u),
            nav,
        },
    )
}

async fn releases_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(key): Path<String>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (project, role, boards) = match load_project_context(&state, &key, &u).await {
        Ok(ctx) => ctx,
        Err(e) => return error_page(jar, "无法访问", &e.to_string()),
    };
    let nav = build_nav(&project, &role, &boards, "releases");
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &ReleasesPage {
            csrf,
            page: "releases".into(),
            user: UserView::new(&u),
            nav,
        },
    )
}

async fn members_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(key): Path<String>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (project, role, boards) = match load_project_context(&state, &key, &u).await {
        Ok(ctx) => ctx,
        Err(e) => return error_page(jar, "无法访问", &e.to_string()),
    };
    let nav = build_nav(&project, &role, &boards, "members");
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &MembersPage {
            csrf,
            page: "members".into(),
            user: UserView::new(&u),
            nav,
        },
    )
}

async fn settings_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(key): Path<String>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (project, role, boards) = match load_project_context(&state, &key, &u).await {
        Ok(ctx) => ctx,
        Err(e) => return error_page(jar, "无法访问", &e.to_string()),
    };
    let nav = build_nav(&project, &role, &boards, "settings");
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &SettingsPage {
            csrf,
            page: "settings".into(),
            user: UserView::new(&u),
            nav,
        },
    )
}

// ============ 搜索 / 通知 ============

#[derive(serde::Deserialize)]
pub struct SearchQ {
    #[allow(dead_code)]
    q: Option<String>,
}

async fn search_page(
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Query(_q): Query<SearchQ>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (jar, csrf) = page_jar(&jar);
    render_page(jar, &SearchPage { csrf, page: "search".into(), user: UserView::new(&u) })
}

async fn notifications_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let (jar, csrf) = page_jar(&jar);
    render_page(jar, &NotificationsPage { csrf, page: "notifications".into(), user: UserView::new(&u) })
}

// ============ 成员个人主页 ============

async fn user_profile_page(
    State(state): State<AppState>,
    jar: CookieJar,
    user: Option<axum::Extension<CurrentUser>>,
    Path(user_id): Path<i64>,
) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    let Some(t) = repos::get_user_by_id(&state.pool, user_id).await.ok().flatten() else {
        return error_page(jar, "用户不存在", "未找到该成员。");
    };
    let avatar_url = if t.avatar_path.is_some() {
        format!("/api/avatars/{}", t.id)
    } else {
        String::new()
    };
    let display_name = if t.display_name.trim().is_empty() { t.username.clone() } else { t.display_name.clone() };
    let (jar, csrf) = page_jar(&jar);
    render_page(
        jar,
        &UserProfilePage {
            csrf,
            page: "users".into(),
            user: UserView::new(&u),
            target: TargetUserView {
                username: t.username,
                initials: initials(&display_name),
                avatar_url,
                display_name,
                role_label: role_label(&t.role),
                created_at: t.created_at.format("%Y-%m-%d").to_string(),
            },
        },
    )
}

// ============ 管理后台 ============

async fn admin_section(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>, section: &str) -> Response {
    let Some(axum::Extension(u)) = user else {
        return Redirect::to("/login").into_response();
    };
    if !u.is_admin() {
        return error_page(jar, "无权访问", "该页面仅系统管理员可访问。");
    }
    let (jar, csrf) = page_jar(&jar);
    let page = AdminPage {
        csrf,
        page: "admin".into(),
        user: UserView::new(&u),
        section: section.to_string(),
        is_overview: section == "overview",
        is_users: section == "users",
        is_settings: section == "settings",
        is_audit: section == "audit",
    };
    render_page(jar, &page)
}

async fn admin_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    admin_section(jar, user, "overview").await
}

async fn admin_users_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    admin_section(jar, user, "users").await
}

async fn admin_settings_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    admin_section(jar, user, "settings").await
}

async fn admin_audit_page(jar: CookieJar, user: Option<axum::Extension<CurrentUser>>) -> Response {
    admin_section(jar, user, "audit").await
}
