// 里程碑 / 版本 列表页（同一实现，kind 区分）

import { api, errMsg } from './api';
import { el, qs, esc, fmtDate, formField, hexToRgba } from './util';
import { toast } from './toast';
import { openModal, closeModal, confirmDialog } from './modal';
import { openCardDetail, priorityBadge } from './card-modal';
import type { MilestoneDetailDto, VersionDetailDto, MetaCardDto } from './types';

type Kind = 'milestones' | 'releases';

/** 里程碑与版本共用的列表项字段 */
interface MetaItem {
  id: number;
  name: string;
  description: string;
  status: string;
  color?: string;
  startDate?: string | null;
  dueDate?: string | null;
  releaseDate?: string | null;
  totalCards: number;
  doneCards: number;
  percent: number;
}

const MILESTONE_STATUS: [string, string][] = [
  ['open', '未开始'],
  ['in_progress', '进行中'],
  ['done', '已完成'],
  ['overdue', '已逾期'],
];

const RELEASE_STATUS: [string, string][] = [
  ['planned', '规划中'],
  ['dev', '开发中'],
  ['frozen', '冻结'],
  ['released', '已发布'],
  ['archived', '已归档'],
];

export function initMetaList(kind: Kind): void {
  const projectKey = document.body.dataset.projectKey || '';
  const listEl = qs<HTMLElement>(kind === 'milestones' ? '#milestones-list' : '#releases-list');
  const addBtn = qs<HTMLButtonElement>(kind === 'milestones' ? '#btn-add-milestone' : '#btn-add-release');
  if (!listEl) return;

  const load = async (): Promise<void> => {
    listEl.innerHTML = '<div class="muted loading">加载中…</div>';
    try {
      const items = await api<MetaItem[]>(`/projects/${projectKey}/${kind === 'milestones' ? 'milestones' : 'releases'}`);
      renderList(listEl, items, kind, load);
    } catch (e) {
      listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };

  addBtn?.addEventListener('click', () => openEditModal(kind, null, load));
  void load();
}

function renderList(listEl: HTMLElement, items: MetaItem[], kind: Kind, reload: () => Promise<void>): void {
  if (!items.length) {
    listEl.innerHTML = `<div class="empty">暂无${kind === 'milestones' ? '里程碑' : '版本'}，点击右上角新建。</div>`;
    return;
  }
  listEl.innerHTML = '';
  const grid = el('div', { class: 'meta-grid' });
  for (const m of items) {
    const card = el('div', { class: 'card meta-card meta-card-clickable' });
    card.addEventListener('click', () => void openDetailModal(kind, m));
    const head = el('div', { class: 'meta-card-head' });
    const color = m.color || '#3B82F6';
    head.append(el('span', { class: 'col-dot', style: `background:${color}` }));
    head.append(el('span', { class: 'meta-card-name', text: m.name }));
    const status = statusLabel(kind, m.status);
    head.append(el('span', { class: 'tag', style: `background:${hexToRgba(statusColor(m.status), 0.15)};color:${statusColor(m.status)}`, text: status }));
    card.append(head);

    if (m.description) card.append(el('p', { class: 'muted meta-card-desc', text: m.description }));

    const dates: string[] = [];
    if (kind === 'milestones') {
      if (m.startDate) dates.push('开始 ' + fmtDate(m.startDate));
    } else {
      if (m.releaseDate) dates.push('发布日期 ' + fmtDate(m.releaseDate));
    }
    if (m.dueDate) dates.push('截止 ' + fmtDate(m.dueDate));
    if (dates.length) card.append(el('p', { class: 'muted meta-card-dates', text: dates.join(' · ') }));

    const pct = m.percent || 0;
    const bar = el('div', { class: 'progress' });
    bar.append(el('div', { class: 'progress-fill', style: `width:${pct}%` }));
    const prog = el('div', { class: 'meta-card-progress' });
    prog.append(bar, el('span', { class: 'muted', text: `${m.doneCards}/${m.totalCards} 卡片 · ${pct}%` }));
    card.append(prog);

    const ops = el('div', { class: 'meta-card-ops' });
    const editBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '编辑' });
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(kind, m, reload);
    });
    const delBtn = el('button', { class: 'btn btn-ghost btn-sm btn-danger-text', type: 'button', text: '删除' });
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog(`删除${kind === 'milestones' ? '里程碑' : '版本'}「${m.name}」？`, { danger: true, okText: '删除' }))) return;
      try {
        await api(`/${kind === 'milestones' ? 'milestones' : 'releases'}/${m.id}`, { method: 'DELETE' });
        toast('已删除', 'success');
        await reload();
      } catch (e2) {
        toast(errMsg(e2), 'error');
      }
    });
    ops.append(editBtn, delBtn);
    card.append(ops);
    grid.append(card);
  }
  listEl.append(grid);
}

function statusLabel(kind: Kind, status: string): string {
  const map = kind === 'milestones' ? MILESTONE_STATUS : RELEASE_STATUS;
  return map.find(([v]) => v === status)?.[1] || status;
}

function statusColor(status: string): string {
  switch (status) {
    case 'done':
    case 'released':
      return '#10B981';
    case 'overdue':
    case 'frozen':
      return '#F59E0B';
    case 'in_progress':
    case 'dev':
      return '#3B82F6';
    default:
      return '#6B7280';
  }
}

function openEditModal(kind: Kind, item: MetaItem | null, reload: () => Promise<void>): void {
  const isMs = kind === 'milestones';
  const body = el('div', { class: 'form-stack' });

  const nameInput = el('input', { class: 'input', type: 'text', placeholder: '名称', maxlength: '60' });
  nameInput.value = item?.name || '';
  body.append(formField('名称', nameInput));

  const descInput = el('textarea', { class: 'input', rows: '3', placeholder: '描述（可选）' });
  descInput.value = item?.description || '';
  body.append(formField('描述', descInput));

  let startInput: HTMLInputElement | null = null;
  if (isMs) {
    startInput = el('input', { class: 'input', type: 'date' });
    startInput.value = item?.startDate ? fmtDate(item.startDate) : '';
    body.append(formField('开始日期', startInput));
  }

  const dueInput = el('input', { class: 'input', type: 'date' });
  dueInput.value = item?.dueDate ? fmtDate(item.dueDate) : '';
  body.append(formField(isMs ? '截止日期' : '发布日期', dueInput));

  const statusOpts = isMs ? MILESTONE_STATUS : RELEASE_STATUS;
  const statusSel = el('select', { class: 'select' });
  for (const [v, t] of statusOpts) {
    const opt = el('option', { value: v, text: t });
    if (v === (item?.status || (isMs ? 'open' : 'planned'))) opt.selected = true;
    statusSel.append(opt);
  }
  body.append(formField('状态', statusSel));

  const foot = el('div', { class: 'modal-actions' });
  const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary', type: 'button', text: item ? '保存' : '创建' });
  cancel.addEventListener('click', () => closeModal());
  ok.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('请输入名称', 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      description: descInput.value.trim(),
      status: statusSel.value,
    };
    if (isMs) payload.start_date = startInput?.value || null;
    payload[isMs ? 'due_date' : 'release_date'] = dueInput.value || null;
    ok.disabled = true;
    try {
      if (item) {
        await api(`/${isMs ? 'milestones' : 'releases'}/${item.id}`, { method: 'PATCH', body: payload });
      } else {
        await api(`/projects/${document.body.dataset.projectKey}/${isMs ? 'milestones' : 'releases'}`, { method: 'POST', body: payload });
      }
      toast('已保存', 'success');
      closeModal();
      await reload();
    } catch (e) {
      toast(errMsg(e), 'error');
      ok.disabled = false;
    }
  });
  foot.append(cancel, ok);
  openModal({ title: item ? '编辑' : `新建${isMs ? '里程碑' : '版本'}`, body, footer: foot, width: '480px' });
  nameInput.focus();
}

// ============ 详情弹窗 ============

async function openDetailModal(kind: Kind, item: MetaItem): Promise<void> {
  const isMs = kind === 'milestones';
  const body = el('div', { class: 'meta-detail' });
  body.innerHTML = '<div class="loading">加载中…</div>';
  openModal({ title: item.name, body, width: '640px' });
  try {
    const d = await api<MilestoneDetailDto | VersionDetailDto>(`/${isMs ? 'milestones' : 'releases'}/${item.id}`);
    renderDetail(body, d, kind);
  } catch (e) {
    body.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
}

function renderDetail(body: HTMLElement, d: MilestoneDetailDto | VersionDetailDto, kind: Kind): void {
  const isMs = kind === 'milestones';
  body.innerHTML = '';
  const ms = d as MilestoneDetailDto;
  const ver = d as VersionDetailDto;
  const color = (isMs ? ms.color : '#3B82F6') || '#3B82F6';

  const head = el('div', { class: 'meta-detail-head' });
  const colorBar = el('span', { class: 'meta-detail-color', style: `background:${color}` });
  const status = statusLabel(kind, d.status);
  head.append(
    colorBar,
    el('span', { class: 'tag', style: `background:${hexToRgba(statusColor(d.status), 0.15)};color:${statusColor(d.status)}`, text: status }),
  );
  body.append(head);

  if (d.description) body.append(el('p', { class: 'meta-detail-desc', text: d.description }));

  const dates: string[] = [];
  if (isMs) {
    if (ms.startDate) dates.push('开始 ' + fmtDate(ms.startDate));
    if (ms.dueDate) dates.push('截止 ' + fmtDate(ms.dueDate));
  } else {
    if (ver.releaseDate) dates.push('发布日期 ' + fmtDate(ver.releaseDate));
  }
  if (dates.length) body.append(el('p', { class: 'muted meta-detail-dates', text: dates.join(' · ') }));

  const pct = d.percent || 0;
  const bar = el('div', { class: 'progress' });
  bar.append(el('div', { class: 'progress-fill', style: `width:${pct}%` }));
  const prog = el('div', { class: 'meta-detail-progress' });
  prog.append(bar, el('span', { class: 'muted', text: `${d.doneCards}/${d.totalCards} 卡片 · ${pct}%` }));
  body.append(prog);

  body.append(el('h4', { class: 'meta-detail-cards-title', text: `关联卡片（${d.cards.length}）` }));
  const list = el('div', { class: 'meta-card-list' });
  if (!d.cards.length) list.append(el('p', { class: 'muted', text: '暂无关联卡片' }));
  for (const c of d.cards) list.append(buildDetailCardRow(c));
  body.append(list);
}

function buildDetailCardRow(c: MetaCardDto): HTMLElement {
  const row = el('div', { class: 'meta-card-row' });
  row.append(el('span', { class: 'muted meta-card-row-no', text: c.number }));
  row.append(el('span', { class: 'meta-card-row-title', text: c.title }));
  row.append(el('span', { class: 'muted meta-card-row-col', text: c.columnName || '' }));
  const done = el('span', { class: 'meta-card-row-done' + (c.done ? ' is-done' : ''), text: c.done ? '✓ 已完成' : '未完成' });
  row.append(done);
  row.append(priorityBadge(c.priority));
  if (c.dueDate) row.append(el('span', { class: 'muted meta-card-row-due', text: fmtDate(c.dueDate) }));
  row.addEventListener('click', () => void openCardDetail(c.id));
  return row;
}
