//! DoDoGo 桌面客户端壳
//!
//! 行为：启动时自动拉起同目录下的 dodogo 服务（若未在运行），等待就绪后
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

const APP_URL: &str = "http://127.0.0.1:8080";
const HEALTH_URL: &str = "http://127.0.0.1:8080/healthz";

fn health_ok() -> bool {
    match ureq::get(HEALTH_URL).timeout(Duration::from_secs(2)).call() {
        Ok(resp) => resp.status() == 200,
        Err(_) => false,
    }
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

/// 拉起服务进程；若已有实例在运行则返回 None。
fn start_server() -> Option<Child> {
    if health_ok() {
        return None;
    }
    let bin = find_server_binary()?;
    let mut cmd = Command::new(&bin);
    let config = bin.parent().map(|d| d.join("config.toml")).filter(|p| p.exists());
    if let Some(cfg) = config {
        cmd.arg("--config").arg(cfg);
    }
    cmd.spawn().ok()
}

fn wait_ready(timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if health_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut server = start_server();
    if !wait_ready(15) {
        eprintln!("DoDoGo 服务未能就绪：请确认服务可启动（端口 8080 未被占用）或已手动启动");
        if let Some(mut s) = server.take() {
            let _ = s.kill();
        }
        std::process::exit(1);
    }

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("DoDoGo 项目管理")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)?;

    let _webview = WebViewBuilder::new().with_url(APP_URL).build(&window)?;

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
