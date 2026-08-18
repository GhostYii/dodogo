//! DoDoGo 桌面客户端壳
//!
//! 行为：启动时若默认端口已运行 DoDoGo 则直接复用；否则自动探测一个空闲端口，
//! 拉起同目录下的 dodogo 服务（以 `DODOGO_SERVER_PORT` 指定端口），等待就绪后
//! 以内嵌 WebView（Windows WebView2）呈现界面；关闭窗口时停掉服务进程。
//!
//! 服务二进制查找顺序：环境变量 `DODOGO_SERVER` → 与客户端同目录的
//! `dodogo.exe`（Linux 为 `dodogo`）。

use std::path::PathBuf;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8080;

fn health_ok(port: u16) -> bool {
    let url = format!("http://{HOST}:{port}/healthz");
    match ureq::get(&url).timeout(Duration::from_secs(2)).call() {
        Ok(resp) => resp.status() == 200,
        Err(_) => false,
    }
}

/// 探测一个当前空闲的本地端口。
fn find_free_port() -> u16 {
    if let Ok(listener) = std::net::TcpListener::bind((HOST, 0))
        && let Ok(addr) = listener.local_addr()
    {
        return addr.port();
    }
    DEFAULT_PORT
}

fn find_server_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("DODOGO_SERVER") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let name = if cfg!(windows) { "dodogo.exe" } else { "dodogo" };
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 在指定端口拉起服务进程。
fn spawn_server(port: u16) -> Option<Child> {
    let bin = find_server_binary()?;
    let mut cmd = Command::new(&bin);
    cmd.env("DODOGO_SERVER_PORT", port.to_string());
    let config = bin.parent().map(|d| d.join("config.toml")).filter(|p| p.exists());
    if let Some(cfg) = config {
        cmd.arg("--config").arg(cfg);
    }
    cmd.spawn().ok()
}

fn wait_ready(port: u16, timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if health_ok(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(300));
    }
    false
}

/// 确定服务端口：复用默认端口上已运行的实例，或自动选空闲端口拉起。
/// 返回 (服务进程句柄, 实际端口)。句柄为 None 表示复用已运行的实例（退出时不杀）。
fn ensure_server() -> (Option<Child>, u16) {
    if health_ok(DEFAULT_PORT) {
        return (None, DEFAULT_PORT);
    }
    for _ in 0..3 {
        let port = find_free_port();
        let Some(mut child) = spawn_server(port) else {
            continue;
        };
        if wait_ready(port, 15) {
            return (Some(child), port);
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    (None, DEFAULT_PORT)
}

/// 从内嵌的 icon.png 加载窗口图标。
fn load_icon() -> Option<tao::window::Icon> {
    let bytes = include_bytes!("../icon.png");
    let img = image::load_from_memory(bytes).ok()?.to_rgba8();
    let (w, h) = img.dimensions();
    tao::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (mut server, port) = ensure_server();
    if !health_ok(port) {
        eprintln!("DoDoGo 服务未能启动：请确认同目录存在 dodogo 可执行文件且端口可用");
        std::process::exit(1);
    }

    let app_url = format!("http://{HOST}:{port}");
    let title = format!("[DoDoGo v{}]", env!("CARGO_PKG_VERSION"));
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .with_window_icon(load_icon())
        .build(&event_loop)?;

    let _webview = WebViewBuilder::new().with_url(&app_url).build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            if let Some(mut s) = server.take() {
                let _ = s.kill();
                let _ = s.wait();
            }
            *control_flow = ControlFlow::Exit;
        }
    });
}
