// 管理后台：概览（系统信息/备份）、用户管理、系统设置、审计日志

import { api, errMsg } from './api';
import { el, qs, esc, fmtSize, fmtDateTime, formField } from './util';
import { toast } from './toast';
import { confirmDialog, promptDialog } from './modal';

interface UserDto {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export function initAdmin(): void {
  const content = qs<HTMLElement>('#admin-content');
  if (!content) return;
  const section = content.dataset.section || 'overview';
  if (section === 'users') void adminUsers(content);
  else if (section === 'settings') void adminSettings(content);
  else if (section === 'audit') void adminAudit(content);
  else void adminOverview(content);
}

// ============ 概览 ============

async function adminOverview(content: HTMLElement): Promise<void> {
  content.innerHTML = '<div class="muted loading">加载中…</div>';
  try {
    const info = await api<{
      version: string;
      dbKind: string;
      dbSize: number;
      uploadsSize: number;
      onlineSessions: number;
      startedAt: string;
    }>('/admin/system-info');

    const cards = el('div', { class: 'stat-grid' });
    const stats: [string, string][] = [
      ['版本', info.version],
      ['数据库', info.dbKind],
      ['数据库大小', fmtSize(info.dbSize)],
      ['上传目录', fmtSize(info.uploadsSize)],
      ['在线会话', String(info.onlineSessions)],
      ['启动时间', info.startedAt ? fmtDateTime(info.startedAt) : ''],
    ];
    for (const [label, value] of stats) {
      const c = el('div', { class: 'card stat-card' });
      c.append(el('div', { class: 'muted', text: label }), el('div', { class: 'stat-value', text: value }));
      cards.append(c);
    }
    content.innerHTML = '';
    content.append(el('h3', { text: '系统信息' }), cards);
  } catch (e) {
    content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    return;
  }

  // 备份
  content.append(el('h3', { text: '数据库备份' }));
  const backupBox = el('div', { class: 'card' });
  const loadBackups = async (): Promise<void> => {
    try {
      const list = await api<{ name: string; size: number; modifiedAt: string | null }[]>('/admin/backups');
      backupBox.innerHTML = '';
      const table = el('table', { class: 'table' });
      const thead = el('thead');
      thead.append(el('tr'));
      for (const h of ['文件名', '大小', '创建时间', '操作']) thead.querySelector('tr')!.append(el('th', { text: h }));
      table.append(thead);
      const tbody = el('tbody');
      if (!list.length) {
        const tr = el('tr');
        tr.append(el('td', { colspan: '4', class: 'muted', text: '暂无备份' }));
        tbody.append(tr);
      }
      for (const b of list) {
        const tr = el('tr');
        tr.append(el('td', { text: b.name }));
        tr.append(el('td', { class: 'muted', text: fmtSize(b.size) }));
        tr.append(el('td', { class: 'muted', text: b.modifiedAt ? fmtDateTime(b.modifiedAt) : '' }));
        const op = el('td');
        const del = el('button', { class: 'btn btn-ghost btn-sm btn-danger-text', type: 'button', text: '删除' });
        del.addEventListener('click', async () => {
          if (!(await confirmDialog(`删除备份 ${b.name}？`, { danger: true, okText: '删除' }))) return;
          try {
            await api(`/admin/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
            toast('已删除', 'success');
            await loadBackups();
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        });
        op.append(del);
        tr.append(op);
        tbody.append(tr);
      }
      table.append(tbody);
      backupBox.append(table);
    } catch (e) {
      backupBox.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };
  const createBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ 创建备份' });
  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const r = await api<{ name: string }>('/admin/backups', { method: 'POST' });
      toast('备份已创建：' + r.name, 'success');
      await loadBackups();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    createBtn.disabled = false;
  });
  const bar = el('div', { class: 'section-bar' });
  bar.append(createBtn);
  content.append(bar, backupBox);
  void loadBackups();
}

// ============ 用户管理 ============

interface UserPage {
  items: UserDto[];
  total: number;
  page: number;
  pageSize: number;
}

async function adminUsers(content: HTMLElement): Promise<void> {
  let page = 1;
  let q = '';

  const render = async (): Promise<void> => {
    content.innerHTML = '<div class="muted loading">加载中…</div>';
    try {
      const d = await api<UserPage>(`/admin/users?page=${page}&page_size=20&q=${encodeURIComponent(q)}`);
      content.innerHTML = '';
      const bar = el('div', { class: 'section-bar' });
      const qInput = el('input', { class: 'input input-sm', type: 'text', placeholder: '搜索用户名/昵称/邮箱', value: q });
      qInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          q = qInput.value.trim();
          page = 1;
          void render();
        }
      });
      bar.append(qInput, el('span', { class: 'muted', text: `共 ${d.total} 个用户` }));
      content.append(bar);

      const table = el('table', { class: 'table' });
      const thead = el('thead');
      thead.append(el('tr'));
      for (const h of ['用户', '角色', '状态', '注册时间', '操作']) thead.querySelector('tr')!.append(el('th', { text: h }));
      table.append(thead);
      const tbody = el('tbody');
      for (const u of d.items) {
        const tr = el('tr');
        const nameTd = el('td', { class: 'cell-user' });
        nameTd.append(el('span', { class: 'cell-name', text: u.displayName || u.username }));
        nameTd.append(el('span', { class: 'muted', text: `@${u.username}` + (u.email ? ` · ${u.email}` : '') }));
        tr.append(nameTd);

        const roleTd = el('td');
        if (u.role === 'system_admin') {
          roleTd.append(el('span', { class: 'tag', style: 'background:rgba(139,92,246,.15);color:#8B5CF6', text: '系统管理员' }));
        } else {
          const sel = el('select', { class: 'select select-sm' });
          for (const [v, t] of [['user', '普通用户'], ['system_admin', '系统管理员']] as [string, string][]) {
            const opt = el('option', { value: v, text: t });
            if (v === u.role) opt.selected = true;
            sel.append(opt);
          }
          sel.addEventListener('change', async () => {
            try {
              await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: sel.value } });
              toast('角色已更新', 'success');
              await render();
            } catch (e) {
              toast(errMsg(e), 'error');
              await render();
            }
          });
          roleTd.append(sel);
        }
        tr.append(roleTd);

        const statusTd = el('td');
        const statusTag = el('span', {
          class: 'tag',
          style: u.status === 'active'
            ? 'background:rgba(16,185,129,.15);color:var(--success)'
            : 'background:rgba(239,68,68,.15);color:var(--danger)',
          text: u.status === 'active' ? '正常' : '已禁用',
        });
        statusTd.append(statusTag);
        tr.append(statusTd);

        tr.append(el('td', { class: 'muted', text: u.createdAt ? fmtDateTime(u.createdAt) : '' }));

        const opTd = el('td', { class: 'cell-ops' });
        const toggle = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: u.status === 'active' ? '禁用' : '启用' });
        toggle.addEventListener('click', async () => {
          try {
            await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } });
            toast('已更新', 'success');
            await render();
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        });
        const reset = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '重置密码' });
        reset.addEventListener('click', async () => {
          const pwd = await promptDialog(`为 ${u.username} 设置新密码`, '新密码（8-64 位，含字母数字）');
          if (!pwd) return;
          try {
            await api(`/admin/users/${u.id}/reset-password`, { method: 'POST', body: { new_password: pwd } });
            toast('密码已重置', 'success');
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        });
        const del = el('button', { class: 'btn btn-ghost btn-sm btn-danger-text', type: 'button', text: '删除' });
        del.addEventListener('click', async () => {
          if (!(await confirmDialog(`删除用户 ${u.username}？相关数据将一并删除。`, { danger: true, okText: '删除' }))) return;
          try {
            await api(`/admin/users/${u.id}`, { method: 'DELETE' });
            toast('已删除', 'success');
            await render();
          } catch (e) {
            toast(errMsg(e), 'error');
          }
        });
        opTd.append(toggle, reset, del);
        tr.append(opTd);
        tbody.append(tr);
      }
      table.append(tbody);
      content.append(table);

      const pager = el('div', { class: 'pager' });
      const prev = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '上一页' });
      prev.disabled = page <= 1;
      prev.addEventListener('click', () => {
        page -= 1;
        void render();
      });
      const next = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '下一页' });
      next.disabled = page * d.pageSize >= d.total;
      next.addEventListener('click', () => {
        page += 1;
        void render();
      });
      pager.append(prev, el('span', { class: 'muted', text: `第 ${d.page} 页` }), next);
      content.append(pager);
    } catch (e) {
      content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };
  await render();
}

// ============ 系统设置 ============

async function adminSettings(content: HTMLElement): Promise<void> {
  content.innerHTML = '<div class="muted loading">加载中…</div>';
  let map: Record<string, unknown>;
  try {
    map = await api<Record<string, unknown>>('/admin/settings');
  } catch (e) {
    content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    return;
  }

  const defaults: Record<string, unknown> = { allow_registration: 1, wip_mode: 'warn' };
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in map)) map[k] = v;
  }

  content.innerHTML = '';
  const card = el('div', { class: 'card settings-card' });

  const regWrap = el('div', { class: 'field' });
  const regCheck = el('input', { type: 'checkbox' }) as HTMLInputElement;
  regCheck.checked = String(map.allow_registration) === '1' || map.allow_registration === true;
  const regRow = el('label', { class: 'check-row' });
  regRow.append(regCheck, el('span', { text: '允许公开注册（关闭后只能由管理员创建账号）' }));
  regWrap.append(el('label', { text: '注册' }), regRow);
  card.append(regWrap);

  const wipWrap = el('div', { class: 'field' });
  const wipSel = el('select', { class: 'select' });
  for (const [v, t] of [['warn', '仅提示（允许超限）'], ['block', '阻止超限移动']] as [string, string][]) {
    const opt = el('option', { value: v, text: t });
    if (String(map.wip_mode) === v) opt.selected = true;
    wipSel.append(opt);
  }
  wipWrap.append(el('label', { text: 'WIP 超限策略' }), wipSel);
  card.append(wipWrap);

  // 其余键
  const extra = el('div', { class: 'field' });
  extra.append(el('label', { text: '其他设置（键值对）' }));
  const kvRows = el('div', { class: 'kv-rows' });
  const rows: [HTMLInputElement, HTMLInputElement][] = [];
  const addRow = (k: string, v: unknown): void => {
    if (k === 'allow_registration' || k === 'wip_mode') return;
    const kInput = el('input', { class: 'input input-sm', type: 'text', value: k, placeholder: '键' });
    const vInput = el('input', { class: 'input input-sm', type: 'text', value: String(v ?? ''), placeholder: '值' });
    const row = el('div', { class: 'kv-row' });
    row.append(kInput, vInput);
    rows.push([kInput, vInput]);
    kvRows.append(row);
  };
  for (const [k, v] of Object.entries(map)) addRow(k, v);
  const addBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '+ 添加键' });
  addBtn.addEventListener('click', () => {
    const k = el('input', { class: 'input input-sm', type: 'text', placeholder: '键' });
    const v = el('input', { class: 'input input-sm', type: 'text', placeholder: '值' });
    const row = el('div', { class: 'kv-row' });
    row.append(k, v);
    rows.push([k, v]);
    kvRows.append(row);
  });
  extra.append(kvRows, addBtn);
  card.append(extra);

  const actions = el('div', { class: 'modal-actions' });
  const save = el('button', { class: 'btn btn-primary', type: 'button', text: '保存设置' });
  save.addEventListener('click', async () => {
    const body: Record<string, unknown> = {
      allow_registration: regCheck.checked ? 1 : 0,
      wip_mode: wipSel.value,
    };
    for (const [kInput, vInput] of rows) {
      const k = kInput.value.trim();
      if (!k) continue;
      body[k] = vInput.value;
    }
    save.disabled = true;
    try {
      await api('/admin/settings', { method: 'PUT', body });
      toast('设置已保存', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      toast(errMsg(e), 'error');
      save.disabled = false;
    }
  });
  actions.append(save);
  card.append(actions);
  content.append(card);
}

// ============ 审计日志 ============

async function adminAudit(content: HTMLElement): Promise<void> {
  let page = 1;
  const render = async (): Promise<void> => {
    content.innerHTML = '<div class="muted loading">加载中…</div>';
    try {
      const items = await api<
        { id: number; username: string | null; action: string; targetType: string; targetId: string; detail: string; ip: string; createdAt: string }[]
      >(`/admin/audit-logs?page=${page}&page_size=30`);
      content.innerHTML = '';
      const table = el('table', { class: 'table' });
      const thead = el('thead');
      thead.append(el('tr'));
      for (const h of ['时间', '用户', '操作', '对象', 'IP']) thead.querySelector('tr')!.append(el('th', { text: h }));
      table.append(thead);
      const tbody = el('tbody');
      if (!items.length) {
        const tr = el('tr');
        tr.append(el('td', { colspan: '5', class: 'muted', text: '暂无日志' }));
        tbody.append(tr);
      }
      for (const it of items) {
        const tr = el('tr');
        tr.append(el('td', { class: 'muted', text: fmtDateTime(it.createdAt) }));
        tr.append(el('td', { text: it.username || '系统' }));
        tr.append(el('td', { text: it.action }));
        tr.append(el('td', { class: 'muted', text: `${it.targetType || '-'}${it.targetId ? ' #' + it.targetId : ''}` }));
        tr.append(el('td', { class: 'muted', text: it.ip || '-' }));
        tbody.append(tr);
      }
      table.append(tbody);
      content.append(table);
      const pager = el('div', { class: 'pager' });
      const prev = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '上一页' });
      prev.disabled = page <= 1;
      prev.addEventListener('click', () => {
        page -= 1;
        void render();
      });
      const next = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '下一页' });
      next.addEventListener('click', () => {
        page += 1;
        void render();
      });
      pager.append(prev, el('span', { class: 'muted', text: `第 ${page} 页` }), next);
      content.append(pager);
    } catch (e) {
      content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };
  await render();
}
