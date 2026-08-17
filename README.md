# DoDoGo

DoDoGo 是一款使用 **Rust** 开发的、类 Trello 的轻量项目管理软件，本地优先、可私有化部署。数据完全由用户掌握，默认单机运行，也可部署在自有服务器上供小团队协作。

> 本仓库为 v1.0 实现，覆盖需求文档 R1–R8 核心功能。

## 功能特性

- **多账号与权限**：注册/登录、服务端会话、系统管理员后台、项目级角色（Owner/Admin/Member/Viewer）RBAC
- **多项目与看板**：多项目管理、多看板、列自定义（增删改排序、颜色、WIP、完成列）
- **卡片式任务与拖拽**：卡片 CRUD、跨列拖拽（乐观更新）、单号自动生成（`DODG-12`）、活动时间线
- **富内容**：Markdown 编辑/预览（服务端白名单清洗防 XSS）、图片/附件上传、清单、标签（8 色）、评论 @提及
- **里程碑与版本**：里程碑进度自动统计（完成列判定）、版本发布管理、进度条
- **私有化 GitLab 联动**：按任务单号匹配提交（`#12` / `DODG-12`），手动/轮询/Webhook 同步，Token AES-GCM 加密
- **通知中心**：站内通知、未读角标、SSE 实时推送、通知偏好
- **搜索与筛选**：全局搜索、看板筛选
- **管理后台**：用户管理、系统设置、审计日志、系统信息、备份
- **设计语言**：简约扁平色块、明/暗双主题、键盘快捷键

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 | Rust（edition 2024，stable） |
| Web 框架 | Axum 0.8 + Tokio |
| 数据库 | SQLite（WAL）+ sqlx 迁移（PostgreSQL 预留） |
| 模板 | Askama（SSR） |
| 密码 | Argon2id；Token AES-256-GCM 加密 |
| 前端 | 原生 TypeScript + esbuild + 手写 CSS 变量（零 CDN、零外部运行时依赖） |
| 实时 | Server-Sent Events（SSE） |

## 目录结构

```
source/
├── Cargo.toml
├── migrations/            # SQL 迁移（全表结构）
├── src/
│   ├── main.rs            # 入口：配置/日志/后台任务/HTTP 服务
│   ├── lib.rs             # 模块声明
│   ├── config.rs          # 配置（config.toml + 环境变量）
│   ├── db.rs              # 连接池 + PRAGMA + 迁移
│   ├── models.rs          # 领域模型与 DTO
│   ├── repos.rs           # 数据访问层
│   ├── services.rs        # 业务服务（认证/通知/活动/模板）
│   ├── permission.rs      # RBAC 权限
│   ├── markdown.rs        # Markdown 渲染（防 XSS）
│   ├── gitlab.rs          # 私有化 GitLab 客户端/匹配/同步
│   ├── middleware.rs      # 会话 + CSRF 中间件
│   ├── handlers/          # 路由处理器（API + SSR 页面）
│   └── routes.rs          # 路由装配 + SSE + 健康检查
├── templates/             # Askama 模板
├── web/                   # 前端 TS/CSS 源码 + 构建产物
├── config/config.example.toml
├── scripts/               # 构建/安装脚本
├── docker/Dockerfile
└── docs/api-contract.md   # 前端集成契约
```

## 快速开始

### 环境要求

- Rust stable（1.85+，建议 1.97）
- Node.js 20+（仅前端构建需要）

### 构建与运行

```bash
# 1. 构建前端静态资源
cd web
npm install
node build.mjs

# 2. 构建并运行后端（回到 source 根目录）
cd ..
cargo run
```

启动后访问 `http://127.0.0.1:8080`，首次启动进入初始化向导创建管理员账号。

### 健康检查

- `GET /healthz` → `ok`
- `GET /api/system/status` → 版本 / 数据库 / 启动时间

## 配置

配置文件 `config/config.toml`（模板见 `config/config.example.toml`），环境变量用 `DODOGO_` 前缀覆盖，优先级：**环境变量 > config.toml > 内置默认值**。

| 关键项 | 说明 |
| --- | --- |
| `server.host` / `server.port` | 监听地址（默认 127.0.0.1:8080） |
| `data_dir` | 数据目录（数据库、上传、备份、日志、主密钥） |
| `security.*` | 会话有效期、登录限速锁定 |
| `upload.max_image_mb` / `max_file_mb` | 上传大小限制 |
| `gitlab.*` | 私有化 GitLab 默认同步配置 |
| `log.level` | 日志级别 |

首次启动自动生成 `data/.master_key`（用于 GitLab Token 加密）。

## 私有化 GitLab 联动

1. 项目设置 → GitLab：填写私有化部署地址（如 `https://git.example.com`）、Access Token、关联仓库（`group/project`）。
2. 提交消息含 `#12` 或 `DODG-12` 时，自动关联到对应卡片（卡片详情「Git 关联」区块展示）。
3. 同步方式：手动同步 / 定时轮询（默认 5 分钟）/ Webhook（`POST /api/webhooks/gitlab/{projectId}`，校验 `X-Gitlab-Token`）。
4. 地址校验会拒绝 `gitlab.com` / `github.com` 等公有云平台（v1.0 仅支持私有化部署的 GitLab CE/EE）。

## 部署

- **Windows**：`scripts/install-windows.ps1`（NSSM 服务化）
- **Linux**：`scripts/install-linux.sh`（systemd）
- **Docker**：`docker/Dockerfile`

默认仅监听 127.0.0.1；公网部署请配合反向代理（Nginx/Caddy）提供 HTTPS，并注意 SSE 需关闭代理缓冲（见技术设计文档 §8.3）。

## 开发

```bash
cargo check        # 编译检查
cargo test         # 测试
cargo clippy -- -D warnings   # 静态检查
cargo fmt --check  # 格式检查
```

后端分层：`handlers`（HTTP 薄层）→ `services`（业务）→ `repos`（数据访问）；权限统一走 `permission.rs`。

## 需求覆盖（R1–R8）

| 编号 | 需求 | 实现 |
| --- | --- | --- |
| R1 | Windows/Linux 部署 | 单二进制 + 服务化脚本 + Dockerfile |
| R2 | 多账号登录、管理员后台 | 认证模块 + `/admin` |
| R3 | 多项目、看板、列自定义 | projects/boards/columns |
| R4 | 卡片式、可视化编辑与拖动 | cards + 原生 DnD + 乐观更新 |
| R5 | 图片、链接、Markdown | markdown.rs + 附件上传 + `[[DODG-12]]` 引用 |
| R6 | 简约扁平色块 | CSS 设计令牌 + 明暗主题 |
| R7 | 里程碑、版本 | milestones/releases + 进度统计 |
| R8 | 私有化 GitLab 单号匹配提交 | gitlab.rs + Webhook |

## 许可与数据主权

默认不发送任何遥测数据；唯一外联请求为用户主动配置的私有化 GitLab。数据仅存于用户指定目录，备份由用户自主控制。
