// 项目设置页：基本信息（PATCH/归档/删除）+ GitLab 集成（GET/PUT/sync/test）

import { api, errMsg } from './api';
import { el, qs, qsa, esc, formField, initialsOf } from './util';
import { toast } from './toast';
import { confirmDialog, promptDialog } from './modal';
import { projectIcon } from './project-icon';
import type { ProjectDto } from './types';

const ICON_COLORS = ['#3B82F6', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#8B5CF6', '#EC4899'];

interface GitlabConfig {
  configured: boolean;
  baseUrl: string;
  mainRepo: string;
  matchRegex: string;
  autoComplete: boolean;
  syncIntervalMinutes: number;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncError: string;
}

export function initSettings(): void {
  const projectKey = document.body.dataset.projectKey || '';
  if (!projectKey) return;

  qsa<HTMLButtonElement>('.settings-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.settings-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      qs('#settings-basic')!.hidden = tab !== 'basic';
      qs('#settings-gitlab')!.hidden = tab !== 'gitlab';
    });
  });

  void loadBasic(projectKey);
  void loadGitlab(projectKey);
}

// ============ 基本信息 ============

async function loadBasic(projectKey: string): Promise<void> {
  const pane = qs<HTMLElement>('#settings-basic');
  if (!pane) return;
  pane.innerHTML = '<div class="muted loading">加载中…</div>';
  let p: ProjectDto;
  try {
    p = await api<ProjectDto>(`/projects/${projectKey}`);
  } catch (e) {
    pane.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    return;
  }

  const card = el('div', { class: 'card settings-card' });

  // 项目图标：预览 + 上传图片 / 移除图片
  const iconRow = el('div', { class: 'settings-icon-row' });
  const iconPreview = el('div', { class: 'settings-icon-preview' });
  iconPreview.append(projectIcon(p, 'lg'));
  iconRow.append(iconPreview);

  const iconActions = el('div', { class: 'settings-icon-actions' });
  const upBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '上传图片图标' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: 'true' });
  upBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api<{ iconPath: string }>(`/projects/${projectKey}/icon`, { method: 'POST', form: fd });
      toast('图标已上传', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    fileInput.value = '';
  });
  iconActions.append(upBtn);

  if (p.iconPath) {
    const removeBtn = el('button', { class: 'btn btn-ghost btn-sm btn-danger-text', type: 'button', text: '移除图片，切回色块' });
    removeBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('移除图片图标，切换回色块 + 文字模式？'))) return;
      try {
        await api(`/projects/${projectKey}/icon`, { method: 'DELETE' });
        toast('已切回色块模式', 'success');
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast('移除图标失败（后端暂未提供该接口）：' + errMsg(e), 'error');
      }
    });
    iconActions.append(removeBtn);
  }
  iconRow.append(iconActions);
  card.append(formField('项目图标', iconRow));

  const nameInput = el('input', { class: 'input', type: 'text', maxlength: '60' });
  nameInput.value = p.name;
  card.append(formField('项目名称', nameInput));

  const descInput = el('textarea', { class: 'input', rows: '3' });
  descInput.value = p.description || '';
  card.append(formField('项目描述', descInput));

  const iconTextInput = el('input', { class: 'input', type: 'text', maxlength: '2', placeholder: '1-2 字，留空取项目名前两字' });
  iconTextInput.value = p.iconText || initialsOf(p.name);
  card.append(formField('图标文字（1-2 字）', iconTextInput));

  const colorWrap = el('div', { class: 'color-swatches' });
  let selected = ICON_COLORS.includes(p.iconColor) ? p.iconColor : ICON_COLORS[0];
  for (const c of ICON_COLORS) {
    const sw = el('button', { class: 'swatch' + (c === selected ? ' active' : ''), type: 'button', style: `background:${c}` });
    sw.addEventListener('click', () => {
      selected = c;
      qsa('.swatch', colorWrap).forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
    });
    colorWrap.append(sw);
  }
  card.append(formField('图标颜色', colorWrap));

  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', text: '保存基本信息' });
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('项目名称不能为空', 'error');
      return;
    }
    saveBtn.disabled = true;
    try {
      await api(`/projects/${projectKey}`, {
        method: 'PATCH',
        body: {
          name,
          description: descInput.value.trim(),
          icon_color: selected,
          icon_text: iconTextInput.value.trim(),
        },
      });
      toast('已保存', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
      saveBtn.disabled = false;
    }
  });
  const actions = el('div', { class: 'modal-actions' });
  actions.append(saveBtn);
  card.append(actions);
  pane.innerHTML = '';
  pane.append(card);

  // 危险区
  const dangerCard = el('div', { class: 'card settings-card danger-zone' });
  dangerCard.append(el('h4', { text: '危险操作' }));
  const archiveBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: p.status === 'archived' ? '恢复项目' : '归档项目' });
  archiveBtn.addEventListener('click', async () => {
    if (p.status !== 'archived' && !(await confirmDialog('归档该项目？归档后成员将无法访问。', { danger: true }))) return;
    try {
      await api(`/projects/${projectKey}/archive`, { method: 'POST' });
      toast('已归档', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  const delBtn = el('button', { class: 'btn btn-danger', type: 'button', text: '删除项目' });
  delBtn.addEventListener('click', async () => {
    const key = await promptDialog('输入项目 Key 以确认删除（不可恢复）', '项目 Key');
    if (!key || key.toUpperCase() !== projectKey.toUpperCase()) {
      if (key) toast('Key 不匹配，已取消', 'error');
      return;
    }
    try {
      await api(`/projects/${projectKey}?confirm_key=${encodeURIComponent(projectKey)}`, { method: 'DELETE' });
      toast('项目已删除', 'success');
      setTimeout(() => (location.href = '/'), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  const dangerActions = el('div', { class: 'modal-actions' });
  dangerActions.append(archiveBtn, delBtn);
  dangerCard.append(dangerActions);
  pane.append(dangerCard);
}

// ============ GitLab ============

async function loadGitlab(projectKey: string): Promise<void> {
  const pane = qs<HTMLElement>('#settings-gitlab');
  if (!pane) return;
  pane.innerHTML = '<div class="muted loading">加载中…</div>';
  let cfg: GitlabConfig;
  try {
    cfg = await api<GitlabConfig>(`/projects/${projectKey}/gitlab`);
  } catch (e) {
    pane.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    return;
  }

  const card = el('div', { class: 'card settings-card' });
  const baseUrl = el('input', { class: 'input', type: 'text', placeholder: 'https://gitlab.example.com' });
  baseUrl.value = cfg.baseUrl || '';
  card.append(formField('GitLab 地址', baseUrl));

  const token = el('input', { class: 'input', type: 'password', placeholder: cfg.hasToken ? '已配置（留空则不修改）' : 'Personal Access Token（需 read_api 权限）' });
  card.append(formField('访问令牌', token));

  const mainRepo = el('input', { class: 'input', type: 'text', placeholder: '如 group/project 或 https://gitlab.example.com/group/project.git' });
  mainRepo.value = cfg.mainRepo || '';
  card.append(formField('主仓库', mainRepo));

  const matchRegex = el('input', { class: 'input', type: 'text' });
  matchRegex.value = cfg.matchRegex || '';
  card.append(formField('卡片单号匹配正则', matchRegex, '提交信息中匹配单号的正则，默认 ( #或KEY- )(\\d+)'));

  const autoComplete = el('input', { type: 'checkbox' }) as HTMLInputElement;
  autoComplete.checked = !!cfg.autoComplete;
  const autoRow = el('label', { class: 'check-row' });
  autoRow.append(autoComplete, el('span', { text: '提交信息包含单号时自动完成（移到已完成列）' }));
  card.append(formField('自动完成', autoRow));

  const interval = el('input', { class: 'input', type: 'number', min: '1' });
  interval.value = String(cfg.syncIntervalMinutes || 5);
  card.append(formField('同步间隔（分钟）', interval));

  if (cfg.lastSyncAt || cfg.lastSyncStatus) {
    const statusTxt = cfg.lastSyncStatus || '';
    const ok = statusTxt === 'ok' || statusTxt === '20001' || statusTxt === '';
    const statusLine = el('p', { class: 'muted' });
    statusLine.textContent = `上次同步：${cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString('zh-CN') : '从未'}${cfg.lastSyncError ? ' · ' + cfg.lastSyncError : ''}`;
    statusLine.style.color = ok ? 'var(--text-2)' : 'var(--danger)';
    card.append(statusLine);
  }

  const actions = el('div', { class: 'modal-actions' });
  const testBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: '测试连接' });
  const syncBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: '立即同步' });
  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', text: '保存配置' });

  function payload(): Record<string, unknown> {
    return {
      base_url: baseUrl.value.trim(),
      token: token.value || undefined,
      main_repo: mainRepo.value.trim(),
      match_regex: matchRegex.value.trim() || undefined,
      auto_complete: autoComplete.checked,
      sync_interval_minutes: Number(interval.value) || 5,
    };
  }

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = '测试中…';
    try {
      await api(`/projects/${projectKey}/gitlab/test`, { method: 'POST', body: payload() });
      toast('连接成功', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    testBtn.disabled = false;
    testBtn.textContent = '测试连接';
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await api(`/projects/${projectKey}/gitlab`, { method: 'PUT', body: payload() });
      toast('配置已保存', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
      saveBtn.disabled = false;
    }
  });

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = '同步中…';
    try {
      const r = await api<Record<string, unknown>>(`/projects/${projectKey}/gitlab/sync`, { method: 'POST' });
      toast('同步完成：' + JSON.stringify(r), 'success');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    syncBtn.disabled = false;
    syncBtn.textContent = '立即同步';
  });

  actions.append(testBtn, syncBtn, saveBtn);
  card.append(actions);
  pane.innerHTML = '';
  pane.append(card);
}
