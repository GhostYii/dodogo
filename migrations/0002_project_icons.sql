-- 项目自定义图标（上传图片 / 颜色+文字两种模式）
ALTER TABLE projects ADD COLUMN icon_path TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN icon_text TEXT NOT NULL DEFAULT '';
