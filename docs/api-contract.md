# DoDoGo 前端集成契约（API / 路由 / 约定）

本文件是前端实现（Askama 模板 + web/ts + web/css）对接后端的唯一依据。
前端代码只能放在 `web/` 与 `templates/` 下；SSR 处理器放在 `src/handlers/pages.rs`。

> **字段命名约定（实际实现）**：**请求体/查询参数使用 snake_case**（如 `column_id`、`assignee_id`、`label_ids`、`base_url`、`main_repo`、`sync_interval_minutes`、`page_size`、`confirm_key`）；**响应 JSON 使用 camelCase**（如 `columnId`、`assigneeId`、`labelIds`）。下方示例为语义说明，字段以 snake_case 提交为准。

## 1. 通用约定

- 基础路径 `/api`。JSON 响应统一：`{"code":0,"message":"ok","data":...}`；`code!=0` 为错误。
- 认证：Cookie `dodogo_session`（HttpOnly）。写请求需携带 CSRF：
  - 页面通过 meta 标签 `#csrf-token` 输出 `dodogo_csrf` Cookie 的值；
  - fetch/HTMX 写请求头 `X-CSRF-Token`（或表单字段 `_csrf`）为该值。
- 当前用户：`GET /api/auth/me` → `{id,username,displayName,avatarPath,role}`（role 为 `system_admin`|`user`）。
- 卡片单号 `number` 形如 `DODG-12`。

## 2. 认证

- `POST /api/auth/register` `{username,email?,password,displayName?}`
- `POST /api/auth/login` `{identity,password,remember?}` → data 为用户对象，同时 Set-Cookie 会话
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/me` `{displayName?,email?}`
- `PUT /api/auth/password` `{oldPassword,newPassword}`
- `GET /api/auth/sessions` / `DELETE /api/auth/sessions/{id}`
- `POST /api/auth/avatar`（multipart，字段 `file`）

## 3. 项目与成员（`/api/projects`）

- `GET /api/projects` → 项目数组（含 `role`）
- `POST /api/projects` `{key,name,description?,iconColor?,template?}`（template: ``|`dev`|`todo`）
- `GET /api/projects/{key}`
- `PATCH /api/projects/{key}` `{name,description?,iconColor?}`
- `POST /api/projects/{key}/archive`
- `DELETE /api/projects/{key}?confirmKey=KEY`
- `GET /api/projects/{key}/members` → `[{userId,username,displayName,avatarPath,role,joinedAt}]`
- `POST /api/projects/{key}/members` `{identity,role}`（role: admin|member|viewer）
- `PATCH /api/projects/{key}/members/{userId}` `{role}`
- `DELETE /api/projects/{key}/members/{userId}`

## 4. 看板 / 列 / 卡片

- `GET /api/projects/{key}/boards` → `[{id,name,color,position,status}]`
- `POST /api/projects/{key}/boards` `{name,color?}`
- `GET /api/boards/{id}` → `{board,columns,cards,labels,members}`（看板全量）
  - columns: `[{id,name,position,color,wipLimit,isDone}]`
  - cards: `[{id,no,number,title,columnId,position,priority,assignee?,labelIds[],milestoneId?,versionId?,dueDate?,checklistDone,checklistTotal,updatedAt}]`
  - labels: `[{id,name,color}]`；members: `[{id,username,displayName,avatarPath}]`
- `PATCH /api/boards/{id}` `{name,color?}`；`DELETE /api/boards/{id}`
- `POST /api/boards/{id}/columns` `{name,color?,wipLimit?,isDone?}`
- `PATCH /api/columns/{id}`（同上）；`DELETE /api/columns/{id}`；`POST /api/columns/{id}/move` `{position}`
- `POST /api/columns/{id}/cards` `{title,description?,priority?,assigneeId?,dueDate?,milestoneId?,versionId?,templateId?}` → `{id,no,number}`
- `GET /api/cards/{id}` → 卡片详情（见下）
- `PATCH /api/cards/{id}` `{title?,description?,assigneeId?,priority?,startDate?,dueDate?,estimateHours?,milestoneId?,versionId?,updatedAt?}`
- `POST /api/cards/{id}/move` `{columnId,beforeCardId?,afterCardId?}`
- `POST /api/cards/{id}/copy`；`POST /api/cards/{id}/archive`；`DELETE /api/cards/{id}`

### 卡片详情结构（`GET /api/cards/{id}` data）
```
id,no,number,title,description,descriptionHtml,columnId,columnName,boardId,
priority,assignee?,labels[],startDate?,dueDate?,estimateHours?,milestone?,version?,
status,createdBy,createdAt,updatedAt,
comments[{id,userId,username,displayName,avatarPath,contentHtml,createdAt,updatedAt}],
checklists[{id,title,items[{id,title,done}]}],
attachments[{id,fileName,fileSize,mimeType,uploaderId,uploaderName,createdAt}],
activities[{id,userId,username,displayName,action,detail,createdAt}],
gitCommits[{id,shortSha,authorName,message,committedAt,commitUrl,mrUrl}]
```

## 5. 协作内容

- 评论：`POST /api/cards/{id}/comments` `{content}`；`PATCH|DELETE /api/comments/{id}`
- 清单：`POST /api/cards/{id}/checklists` `{title}`；`DELETE /api/checklists/{id}`
  - `POST /api/checklists/{id}/items` `{title}`；`PATCH /api/checklist-items/{id}` `{title?,done?}`；`DELETE /api/checklist-items/{id}`
- 标签：`GET|POST /api/projects/{key}/labels`（POST `{name,color?}`）；`DELETE /api/labels/{id}`；`PUT /api/cards/{id}/labels` `{labelIds[]}`
- 附件：`POST /api/cards/{id}/attachments`（multipart `file`）；`DELETE /api/attachments/{id}`；`GET /api/attachments/{id}/download`
- 活动：`GET /api/cards/{id}/activities`

## 6. 里程碑 / 版本

- `GET|POST /api/projects/{key}/milestones`（POST `{name,description?,startDate?,dueDate?,status?,color?}`）
  → 列表项 `{id,name,description,startDate,dueDate,status,color,totalCards,doneCards,percent}`
- `PATCH|DELETE /api/milestones/{id}`
- `GET|POST /api/projects/{key}/releases`（POST `{name,description?,releaseDate?,status?}`）→ 同里程碑结构
- `PATCH|DELETE /api/releases/{id}`

## 7. 通知 / 搜索

- `GET /api/notifications?page=&page_size=` → `[{id,type,title,body,link,read,createdAt}]`
- `GET /api/notifications/unread-count` → `{count}`
- `POST /api/notifications/read` `{ids?}`；`POST /api/notifications/read-all`；`POST /api/notifications/{id}/read`
- `GET /api/search?q=` → `[{id,no,number,title,projectKey,projectName,boardName,columnName,updatedAt}]`

## 8. GitLab / 管理后台

- `GET|PUT /api/projects/{key}/gitlab`；`POST /api/projects/{key}/gitlab/sync`；`POST /api/projects/{key}/gitlab/test`
- `GET|PATCH /api/admin/users`；`DELETE /api/admin/users/{id}`；`POST /api/admin/users/{id}/reset-password`
- `GET|PUT /api/admin/settings`；`GET /api/admin/audit-logs`；`GET /api/admin/system-info`
- `GET|POST /api/admin/backups`；`DELETE /api/admin/backups/{name}`

## 9. 实时（SSE）

`GET /api/stream?channel=board:{boardId}`（需登录，自动携带 Cookie）。
事件：`card.created` / `card.updated` / `card.moved` / `card.deleted` / `comment.added` / `notification.new`。
数据为 JSON 字符串。看板页收到事件后刷新对应卡片区域（简单起见可重拉 `GET /api/boards/{id}`）。

## 10. SSR 页面路由（`src/handlers/pages.rs` 实现）

| 路径 | 说明 |
| --- | --- |
| `/login` `/register` | 登录/注册（未登录可访问） |
| `/setup` | 首次启动初始化向导（无管理员时） |
| `/` | 工作台 |
| `/p/{key}` | 项目页（重定向到默认看板） |
| `/p/{key}/board/{boardId}` | 看板页 |
| `/p/{key}/milestones` `/p/{key}/releases` | 里程碑/版本 |
| `/p/{key}/members` `/p/{key}/settings` | 成员/设置 |
| `/search` `/notifications` | 搜索/通知 |
| `/admin` `/admin/users` `/admin/settings` `/admin/audit` | 管理后台 |

## 11. 设计令牌（CSS 变量）

见《01-软件设计文档》§5.1：`--bg` `--surface` `--surface-2` `--border` `--primary` `--text` `--text-2` `--danger` `--warning` `--success`；
支持 `[data-theme="dark"]`。标签 8 色：红`#EF4444` 橙`#F97316` 黄`#EAB308` 绿`#22C55E` 青`#06B6D4` 蓝`#3B82F6` 紫`#8B5CF6` 粉`#EC4899`。

## 12. 构建

- `web/ts/*.ts` 经 esbuild 打包 → `web/static/assets/app.js`；`web/css/*.css` → `web/static/assets/app.css`。
- 页面引用 `/static/assets/app.js`、`/static/assets/app.css`。
- 无 CDN、无第三方运行时依赖（拖拽用原生 HTML5 DnD，Markdown 预览走 `POST /api/markdown/preview`）。
