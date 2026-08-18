// Windows 资源编译：嵌入 exe 图标与版本信息。
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winres::WindowsResource::new();
        res.set_icon("icon.ico");
        if let Err(e) = res.compile() {
            eprintln!("winres 编译失败: {e}");
        }
    }
}
