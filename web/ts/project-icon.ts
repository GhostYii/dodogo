// 项目图标：图片（/api/project-icons/{id}）优先，失败回退色块 + 文字

import { api } from './api';
import { el, qs, qsa, initialsOf } from './util';
import type { ProjectDto } from './types';

export function projectIcon(p: ProjectDto, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const cls = 'project-icon' + (size === 'sm' ? ' project-icon-sm' : size === 'lg' ? ' project-icon-lg' : '');
  const text = (p.iconText && p.iconText.trim()) || initialsOf(p.name);
  const wrap = el('span', { class: cls, text });
  wrap.style.background = p.iconColor || '#3B82F6';
  if (p.iconPath) {
    const img = el('img', { class: 'project-icon-img', alt: p.name });
    img.src = `/api/project-icons/${p.id}`;
    img.addEventListener('error', () => img.remove());
    wrap.append(img);
  }
  return wrap;
}

/** 用后端项目数据覆盖 SSR 渲染的项目图标（图片模式 / 色块模式）。 */
export async function initProjectIcons(): Promise<void> {
  const page = document.body.dataset.page || '';
  const projectKey = document.body.dataset.projectKey || '';

  // 项目页头部图标
  if (projectKey) {
    const headIcon = qs<HTMLElement>('.project-head .project-icon');
    if (headIcon) {
      try {
        const p = await api<ProjectDto>(`/projects/${projectKey}`);
        headIcon.replaceWith(projectIcon(p, 'lg'));
      } catch {
        /* 保留 SSR 回退 */
      }
    }
  }

  // 工作台项目卡片
  if (page === 'home') {
    const cards = qsa<HTMLElement>('.project-card');
    if (!cards.length) return;
    try {
      const projects = await api<ProjectDto[]>('/projects');
      const byKey = new Map(projects.map((p) => [p.key, p]));
      for (const card of cards) {
        const key = card.dataset.projectKey;
        const p = key ? byKey.get(key) : undefined;
        if (!p) continue;
        const icon = qs<HTMLElement>('.project-icon', card);
        if (icon) icon.replaceWith(projectIcon(p, 'md'));
      }
    } catch {
      /* 保留 SSR 回退 */
    }
  }
}
