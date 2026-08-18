// 工作台：新建项目、我的任务汇总

import { api, errMsg } from './api';
import { el, qs, qsa, esc, avatar, initialsOf, fmtDate, timeAgo, formField } from './util';
import { toast } from './toast';
import { openModal, closeModal } from './modal';
import { openCardDetail, priorityBadge } from './card-modal';
import type { ProjectDto, BoardDto, BoardFull, CardSummary } from './types';

const ICON_COLORS = ['#3B82F6', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#8B5CF6', '#EC4899'];

export function initHome(): void {
  qs('#btn-new-project')?.addEventListener('click', openNewProjectModal);
  void loadMyTasks();
  // 收到指派/移动等通知时，实时刷新“我的任务”（卡片更换指派者后新成员主页即时更新）
  window.addEventListener('dodogo:notify', (e) => {
    const d = (e as CustomEvent).detail as { type?: string } | undefined;
    if (d?.type === 'assigned' || d?.type === 'moved') {
      if (taskRefreshTimer) clearTimeout(taskRefreshTimer);
      taskRefreshTimer = setTimeout(() => void loadMyTasks(), 800);
    }
  });
  // 卡片详情弹窗内修改（如更改指派人/移动）后，刷新“我的任务”
  window.addEventListener('dodogo:card-changed', () => {
    if (taskRefreshTimer) clearTimeout(taskRefreshTimer);
    taskRefreshTimer = setTimeout(() => void loadMyTasks(), 500);
  });
}

let taskRefreshTimer: ReturnType<typeof setTimeout> | undefined;

// ============ 新建项目 ============

function openNewProjectModal(): void {
  const body = el('div', { class: 'form-stack' });

  const keyInput = el('input', { class: 'input', type: 'text', placeholder: '如 DODG（2-6 位大写字母/数字）', maxlength: '6' });
  body.append(formField('项目 Key', keyInput));

  const nameInput = el('input', { class: 'input', type: 'text', placeholder: '如 DoDoGo 项目管理', maxlength: '60' });
  body.append(formField('项目名称', nameInput));

  const descInput = el('textarea', { class: 'input', rows: '3', placeholder: '一句话描述项目（可选）' });
  body.append(formField('项目描述', descInput));

  // —— 图标：默认「背景色 + 文字」模式，实时预览，点击预览框上传图片 ——
  let selected = ICON_COLORS[0];
  let iconMode: 'text' | 'image' = 'text';
  let iconFile: File | null = null;
  let previewUrl = '';
  let iconTextTouched = false;

  const iconTextInput = el('input', { class: 'input', type: 'text', placeholder: '留空默认取项目名前两字', maxlength: '2' });

  const colorWrap = el('div', { class: 'color-swatches' });
  for (const c of ICON_COLORS) {
    const sw = el('button', { class: 'swatch' + (c === selected ? ' active' : ''), type: 'button', style: `background:${c}` });
    sw.addEventListener('click', () => {
      selected = c;
      qsa('.swatch', colorWrap).forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
      updatePreview();
    });
    colorWrap.append(sw);
  }

  const preview = el('div', { class: 'icon-preview project-icon project-icon-lg', role: 'button', 'aria-label': '点击上传图片', title: '点击上传图片' });
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: 'true' });
  const clearImg = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '移除图片，切回色块' });
  clearImg.hidden = true;

  function currentIconText(): string {
    const t = (iconTextInput.value.trim() || initialsOf(nameInput.value)).trim();
    return Array.from(t).slice(0, 2).join('') || '?';
  }

  function updatePreview(): void {
    preview.innerHTML = '';
    preview.style.background = selected;
    if (iconMode === 'image' && previewUrl) {
      const img = el('img', { class: 'project-icon-img', alt: '项目图标预览' });
      img.src = previewUrl;
      preview.append(img);
      preview.title = '点击更换图片';
    } else {
      preview.append(el('span', { text: currentIconText() }));
      preview.title = '点击上传图片';
    }
  }

  // 名称变化：图标文字默认跟随前两字（除非用户已手动改过）
  nameInput.addEventListener('input', () => {
    if (!iconTextTouched) {
      const nm = nameInput.value.trim();
      iconTextInput.value = nm ? initialsOf(nm) : '';
    }
    updatePreview();
  });
  iconTextInput.addEventListener('input', () => {
    iconTextTouched = true;
    updatePreview();
  });

  preview.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    iconFile = f;
    iconMode = 'image';
    previewUrl = URL.createObjectURL(f);
    clearImg.hidden = false;
    updatePreview();
    fileInput.value = '';
  });
  clearImg.addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    iconFile = null;
    iconMode = 'text';
    clearImg.hidden = true;
    updatePreview();
  });

  updatePreview();

  const iconControls = el('div', { class: 'icon-controls' });
  iconControls.append(formField('图标颜色', colorWrap), formField('图标文字（1-2 字）', iconTextInput), clearImg);
  const iconRow = el('div', { class: 'icon-row' });
  iconRow.append(preview, iconControls);
  body.append(formField('图标', iconRow, '点击预览框上传图片；文字留空默认取项目名前两字'));

  const tplSelect = el('select', { class: 'select' });
  const tpls: [string, string][] = [
    ['', '标准（待办 / 已完成）'],
    ['dev', '开发流程（需求 / 开发 / 测试 / 发布）'],
    ['todo', '任务清单（待办 / 进行中 / 已完成）'],
  ];
  for (const [v, t] of tpls) tplSelect.append(el('option', { value: v, text: t }));
  body.append(formField('看板模板', tplSelect));

  const foot = el('div', { class: 'modal-actions' });
  const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary', type: 'button', text: '创建' });
  cancel.addEventListener('click', () => closeModal());
  ok.addEventListener('click', async () => {
    const k = keyInput.value.trim().toUpperCase();
    const n = nameInput.value.trim();
    if (!/^[A-Z0-9]{2,6}$/.test(k)) {
      toast('Key 需为 2-6 位大写字母或数字', 'error');
      return;
    }
    if (!n) {
      toast('请输入项目名称', 'error');
      return;
    }
    ok.disabled = true;
    try {
      const proj = await api<ProjectDto>('/projects', {
        method: 'POST',
        body: {
          key: k,
          name: n,
          description: descInput.value.trim(),
          icon_color: selected,
          icon_text: currentIconText(),
          template: tplSelect.value,
        },
      });
      // 用户已选图：先创建项目拿到 key，再上传图标
      if (iconMode === 'image' && iconFile) {
        const fd = new FormData();
        fd.append('file', iconFile);
        await api(`/projects/${proj.key}/icon`, { method: 'POST', form: fd });
      }
      location.href = `/p/${proj.key}`;
    } catch (e) {
      toast(errMsg(e), 'error');
      ok.disabled = false;
    }
  });
  foot.append(cancel, ok);
  openModal({ title: '新建项目', body, footer: foot, width: '480px' });
  keyInput.focus();
}

// ============ 我的任务 ============

interface MyTask extends CardSummary {
  projectKey: string;
  projectName: string;
  columnName?: string;
}

async function loadMyTasks(): Promise<void> {
  const uid = Number(document.body.dataset.uid || 0);
  const box = qs<HTMLElement>('#my-tasks');
  const countEl = qs<HTMLElement>('#my-tasks-count');
  if (!box) return;
  box.innerHTML = '<div class="muted loading">加载中…</div>';
  try {
    const projects = await api<ProjectDto[]>('/projects');
    const tasks: MyTask[] = [];
    for (const p of projects) {
      const boards = await api<BoardDto[]>(`/projects/${p.key}/boards`);
      for (const b of boards) {
        const full = await api<BoardFull>(`/boards/${b.id}`);
        for (const c of full.cards) {
          if (c.assignee && c.assignee.id === uid) {
            const col = full.columns.find((x) => x.id === c.columnId);
            tasks.push({ ...c, projectKey: p.key, projectName: p.name, columnName: col?.name });
          }
        }
      }
    }
    tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    renderMyTasks(box, tasks.slice(0, 20));
    if (countEl) countEl.textContent = tasks.length ? `共 ${tasks.length} 条` : '';
  } catch {
    box.innerHTML = '<div class="empty">加载失败</div>';
  }
}

function renderMyTasks(box: HTMLElement, tasks: MyTask[]): void {
  if (!tasks.length) {
    box.innerHTML = '<div class="empty">暂无指派给你的任务</div>';
    return;
  }
  box.innerHTML = '';
  for (const t of tasks) {
    const row = el('div', { class: 'task-row' });
    const icon = el('span', { class: 'project-icon project-icon-sm', style: 'background:#3B82F6', text: initialsOf(t.projectKey) });
    row.append(icon);
    const main = el('div', { class: 'task-main' });
    main.append(el('span', { class: 'task-title', text: t.title }));
    main.append(el('span', { class: 'muted task-sub', text: `${t.number} · ${t.projectName}${t.columnName ? ' · ' + t.columnName : ''}` }));
    row.append(main);
    row.append(priorityBadge(t.priority));
    if (t.dueDate) row.append(el('span', { class: 'card-due' + (t.dueDate < new Date().toISOString().slice(0, 10) ? ' overdue' : ''), text: fmtDate(t.dueDate) }));
    row.append(el('span', { class: 'muted', text: timeAgo(t.updatedAt) }));
    row.addEventListener('click', () => void openCardDetail(t.id));
    box.append(row);
  }
}
