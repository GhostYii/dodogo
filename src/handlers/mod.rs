//! HTTP 处理器（路由层，薄）。每个子模块导出 `routes()`。

pub mod admin;
pub mod auth;
pub mod boards;
pub mod cards;
pub mod files;
pub mod gitlab;
pub mod meta;
pub mod notifications;
pub mod pages;
pub mod projects;
pub mod search;
pub mod webhooks;
