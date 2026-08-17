//! Markdown 服务端渲染：pulldown-cmark + ammonia 白名单（防 XSS）
//! 支持 `[[DODG-12]]` 卡片引用与 `@username` 提及。

use ammonia::Builder;
use pulldown_cmark::{html, Options, Parser};

/// 渲染 Markdown 为经过白名单清洗的安全 HTML。
pub fn render(text: &str) -> String {
    // 预处理：`[[DODG-12]]` → 卡片引用链接（跳转全局搜索）。
    let text = render_card_refs(text);
    // 预处理：`@username` → 提及样式占位。
    let (text, mentions) = protect_mentions(&text);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(&text, options);
    let mut body = String::new();
    html::push_html(&mut body, parser);

    let mut cleaned = sanitize(&body);

    // 还原 @提及（使用受控的 span 标签）。
    for (token, name) in mentions {
        let html = format!(
            "<span class=\"mention\" data-mention=\"{}\">@{}</span>",
            html_escape(&name),
            html_escape(&name)
        );
        cleaned = cleaned.replace(&token, &html);
    }

    cleaned
}

fn render_card_refs(text: &str) -> String {
    // 匹配 [[KEY-123]] 或 [[123]]
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let (before, after) = rest.split_at(start);
        result.push_str(before);
        let after = &after[2..];
        if let Some(end) = after.find("]]") {
            let inner = &after[..end];
            let trimmed = inner.trim();
            if !trimmed.is_empty() {
                result.push_str(&format!("[{}](/search?q={})", trimmed, url_encode(trimmed)));
            } else {
                result.push_str("[[]]");
            }
            rest = &after[end + 2..];
        } else {
            result.push_str("[[]]");
            rest = &after;
        }
    }
    result.push_str(rest);
    result
}

/// 把 @mention 替换为唯一占位符，返回 (文本, [(占位符, 用户名)]).
fn protect_mentions(text: &str) -> (String, Vec<(String, String)>) {
    let mut mentions: Vec<(String, String)> = Vec::new();
    // 简单扫描：`@` 后跟用户名（字母/数字/下划线/中文）
    let mut idx = 0;
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    while idx < chars.len() {
        if chars[idx] == '@' && (idx == 0 || !is_ident(chars[idx - 1])) {
            let mut end = idx + 1;
            while end < chars.len() && is_ident(chars[end]) {
                end += 1;
            }
            if end > idx + 1 {
                let name: String = chars[idx + 1..end].iter().collect();
                let token = format!("@@MENTION{}@@", mentions.len());
                mentions.push((token.clone(), name));
                out.push_str(&token);
                idx = end;
                continue;
            }
        }
        out.push(chars[idx]);
        idx += 1;
    }
    (out, mentions)
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn url_encode(s: &str) -> String {
    // 仅对 URL 保留字符做基本编码，避免过度转义影响可读性。
    let mut out = String::new();
    for c in s.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(c),
            _ => out.push_str(&format!("%{:02X}", c as u32)),
        }
    }
    out
}

fn sanitize(html: &str) -> String {
    use std::collections::HashSet;
    let mut tags = HashSet::new();
    for t in [
        "h1", "h2", "h3", "p", "br", "hr", "strong", "em", "del", "a", "ul", "ol", "li", "code",
        "pre", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "img", "input",
    ] {
        tags.insert(t);
    }

    let mut builder = Builder::default();
    builder.tags(tags);
    builder.link_rel(Some("noopener noreferrer"));
    // a 标签属性（rel 由 link_rel 统一管理，勿重复添加）
    builder.add_tag_attributes("a", ["href", "title"]);
    // img 标签属性
    builder.add_tag_attributes("img", ["src", "alt", "title"]);
    // 任务列表复选框
    builder.add_tag_attributes("input", ["type", "checked", "disabled"]);
    // 代码块语言标注
    builder.add_tag_attributes("code", ["class"]);
    builder.clean(html).to_string()
}
