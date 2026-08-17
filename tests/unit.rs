//! 单元与核心逻辑测试（纯函数 + 关键业务规则）

use dodogo::gitlab;
use dodogo::markdown;
use dodogo::permission;
use dodogo::services;

#[test]
fn markdown_strips_xss() {
    let html = markdown::render("<script>alert(1)</script>hello");
    assert!(!html.contains("<script>"), "script 标签应被清洗: {html}");
    assert!(html.contains("hello"));
    let html2 = markdown::render("![x](javascript:alert(1))");
    assert!(!html2.to_lowercase().contains("javascript:"), "javascript: 协议应被清洗");
}

#[test]
fn markdown_renders_basic() {
    let html = markdown::render("**bold** and *italic*");
    assert!(html.contains("<strong>bold</strong>"));
    assert!(html.contains("<em>italic</em>"));
}

#[test]
fn markdown_card_ref() {
    let html = markdown::render("见 [[DODG-12]]");
    assert!(html.contains("/search?q=DODG-12"), "卡片引用应转为搜索链接: {html}");
}

#[test]
fn matcher_default_regex() {
    let re = gitlab::compile_regex("", "DODG").unwrap();
    assert_eq!(gitlab::match_card_no("fix: 修复登录 #12", &re), Some(12));
    assert_eq!(gitlab::match_card_no("fix: DODG-12: 修复", &re), Some(12));
    assert_eq!(gitlab::match_card_no("no issue here", &re), None);
    assert_eq!(gitlab::match_card_no("Closes #7", &re), Some(7));
}

#[test]
fn matcher_custom_regex() {
    let re = gitlab::compile_regex(r"\[BUG-(\d+)\]", "DODG").unwrap();
    assert_eq!(gitlab::match_card_no("[BUG-42] fix", &re), Some(42));
    assert_eq!(gitlab::match_card_no("DODG-12", &re), None);
}

#[test]
fn gitlab_rejects_public_cloud() {
    assert!(gitlab::validate_base_url("https://gitlab.com/x").is_err());
    assert!(gitlab::validate_base_url("https://github.com/x").is_err());
    assert!(gitlab::validate_base_url("https://git.example.com").is_ok());
    assert!(gitlab::validate_base_url("http://192.168.1.10").is_ok());
}

#[test]
fn username_validation() {
    assert!(services::validate_username("abc").is_ok());
    assert!(services::validate_username("a").is_err());
    assert!(services::validate_username("has space").is_err());
}

#[test]
fn password_validation() {
    assert!(services::validate_password("abc12345").is_ok());
    assert!(services::validate_password("short1").is_err());
    assert!(services::validate_password("onlyletters").is_err());
    assert!(services::validate_password("12345678").is_err());
}

#[test]
fn project_key_validation() {
    assert!(services::validate_project_key("DODG").is_ok());
    assert!(services::validate_project_key("d").is_err());
    assert!(services::validate_project_key("dodg").is_err(), "Key 必须大写");
}

#[test]
fn role_ranking() {
    assert!(permission::role_at_least(permission::ROLE_OWNER, permission::ROLE_OWNER));
    assert!(permission::role_at_least(permission::ROLE_ADMIN, permission::ROLE_MEMBER));
    assert!(permission::role_at_least(permission::ROLE_MEMBER, permission::ROLE_VIEWER));
    assert!(!permission::role_at_least(permission::ROLE_VIEWER, permission::ROLE_MEMBER));
}

#[test]
fn crypto_roundtrip() {
    let key: [u8; 32] = [7u8; 32];
    let secret = "glpat-abcdef123456";
    let enc = dodogo::crypto::encrypt(&key, secret).unwrap();
    let dec = dodogo::crypto::decrypt(&key, &enc).unwrap();
    assert_eq!(secret, dec);
}

#[test]
fn password_hash_roundtrip() {
    let hash = dodogo::crypto::hash_password("Passw0rd!").unwrap();
    assert!(dodogo::crypto::verify_password("Passw0rd!", &hash));
    assert!(!dodogo::crypto::verify_password("wrong", &hash));
}
