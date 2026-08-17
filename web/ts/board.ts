// 看板页：列渲染、卡片拖拽（原生 HTML5 DnD + 乐观更新）、快速建卡、筛选、SSE

import { api, errMsg } from './api';
import { el, qs, qsa, esc, avatar, debounce, fmtDate, hexToRgba } from './util';
import { toast } from './toast';
import { promptDialog, confirmDialog } from './modal';
import { openCardDetail, getOpenCardId, refreshOpenCard, priorityBadge } from './card-modal';
import type { BoardFull, CardSummary, ColumnDto } from './types';

const boardEl = qs<HTMLElement>('#board');
const boardId = Number(boardEl?.dataset.boardId || 0);
const projectKey = boardEl?.dataset.projectKey || '';

let data: BoardFull | null = null;
let filterQ = '';
let filterAssignee = '';
let filterLabel = '';
let filterPriority = '';
let dragCardId: number | null = null;
let justDragged = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function initBoard(): void {
  if (!boardEl || !boardId) return;

  qs('#board-select')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v) location.href = `/p/${projectKey}/board/${v}`;
  });
  qs('#btn-new-board')?.addEventListener('click', async () => {
    const name = await promptDialog('新建看板', '看板名称');
    if (!name) return;
    try {
      const b = await api<{ id: number }>(`/projects/${projectKey}/boards`, { method: 'POST', body: { name } });
      location.href = `/p/${projectKey}/board/${b.id}`;
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });

  const qInput = qs<HTMLInputElement>('#filter-q');
  qInput?.addEventListener('input', debounce(() => {
    filterQ = qInput.value.trim();
    rerender();
  }, 200));
  qs('#filter-assignee')?.addEventListener('change', (e) => {
    filterAssignee = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#filter-label')?.addEventListener('change', (e) => {
    filterLabel = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#filter-priority')?.addEventListener('change', (e) => {
    filterPriority = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#btn-filter-reset')?.addEventListener('click', () => {
    filterQ = '';
    filterAssignee = '';
    filterLabel = '';
    filterPriority = '';
    if (qInput) qInput.value = '';
    qsa<HTMLSelectElement>('#filter-assignee, #filter-label, #filter-priority').forEach((s) => (s.value = ''));
    rerender();
  });

  void load();
  initSse();
  window.addEventListener('dodogo:card-changed', () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(), 250);
  });
}

// ============ 数据 ============

async function load(): Promise<void> {
  try {
    data = await api<BoardFull>(`/boards/${boardId}`);
    render();
    refreshFilterOptions();
  } catch (e) {
    boardEl!.innerHTML = `<div class="empty">加载看板失败：${esc(errMsg(e))}</div>`;
  }
}

// ============ 渲染 ============

function rerender(): void {
  if (!data) return;
  render();
}

function render(): void {
  if (!data) return;
  const columns = [...data.columns].sort((a, b) => a.position - b.position);
  boardEl!.innerHTML = '';
  for (const col of columns) boardEl!.append(buildColumn(col));
  boardEl!.append(buildAddColumn());
}

function buildColumn(col: ColumnDto): HTMLElement {
  const colEl = el('div', { class: 'board-col', 'data-col': String(col.id) });
  const cards = data!.cards.filter((c) => c.columnId === col.id).sort((a, b) => a.position - b.position);
  const visible = cards.filter(matchFilters);

  const head = el('div', { class: 'col-head' });
  head.append(el('span', { class: 'col-dot', style: `background:${col.color || '#3B82F6'}` }));
  head.append(el('span', { class: 'col-name', text: col.name }));
  head.append(el('span', { class: 'col-count', text: `${visible.length}/${cards.length}${col.wipLimit > 0 ? ` · WIP ${col.wipLimit}` : ''}` }));
  const colActions = el('span', { class: 'col-actions' });
  const delBtn = el('button', { class: 'btn-icon', type: 'button', text: '✕', title: '删除列' });
  delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(`删除列「${col.name}」？（列内不能有卡片）`, { danger: true }))) return;
    try {
      await api(`/columns/${col.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  colActions.append(delBtn);
  head.append(colActions);

  const body = el('div', { class: 'col-cards', 'data-col-body': String(col.id) });
  for (const card of cards) {
    const node = buildCard(card);
    if (!matchFilters(card)) node.classList.add('filtered-out');
    body.append(node);
  }
  setupDropZone(body, col.id);

  const foot = el('div', { class: 'col-foot' });
  foot.append(buildAddCard(col.id));

  colEl.append(head, body, foot);
  return colEl;
}

function buildCard(card: CardSummary): HTMLElement {
  const node = el('div', { class: 'card', draggable: 'true', 'data-card': String(card.id) });
  const cardLabels = data!.labels.filter((l) => card.labelIds.includes(l.id));

  const top = el('div', { class: 'card-top' });
  top.append(el('span', { class: 'card-no muted', text: card.number }), priorityBadge(card.priority));

  const title = el('div', { class: 'card-title', text: card.title });

  const meta = el('div', { class: 'card-meta' });
  const left = el('div', { class: 'card-labels' });
  for (const l of cardLabels) {
    left.append(el('span', { class: 'tag', style: `background:${hexToRgba(l.color, 0.16)};color:${l.color}`, text: l.name }));
  }
  const right = el('div', { class: 'card-meta-right' });
  if (card.checklistTotal > 0) {
    right.append(el('span', { class: 'muted card-checklist', text: `☑ ${card.checklistDone}/${card.checklistTotal}` }));
  }
  if (card.dueDate) {
    const overdue = card.dueDate < new Date().toISOString().slice(0, 10);
    right.append(el('span', { class: 'card-due' + (overdue ? ' overdue' : ''), text: fmtDate(card.dueDate) }));
  }
  if (card.assignee) {
    right.append(avatar(card.assignee, 'sm'));
  }
  meta.append(left, right);

  node.append(top, title, meta);

  node.addEventListener('click', (e) => {
    if (justDragged) return;
    if ((e.target as HTMLElement).closest('button, a, select, input')) return;
    void openCardDetail(card.id);
  });
  node.addEventListener('dragstart', (e) => {
    dragCardId = card.id;
    justDragged = true;
    node.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', String(card.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragend', () => {
    dragCardId = null;
    setTimeout(() => {
      justDragged = false;
    }, 60);
    qsa('.card.dragging').forEach((c) => c.classList.remove('dragging'));
    qsa('.drop-before, .drop-after, .drop-empty').forEach((c) => c.classList.remove('drop-before', 'drop-after', 'drop-empty'));
  });
  return node;
}

function buildAddCard(colId: number): HTMLElement {
  const wrap = el('div', { class: 'add-card' });
  const btn = el('button', { class: 'add-card-btn', type: 'button', text: '+ 添加卡片' });
  const form = el('div', { class: 'add-card-form', hidden: 'true' });
  const input = el('input', { class: 'input input-sm', type: 'text', placeholder: '卡片标题，回车连续创建' });
  const actions = el('div', { class: 'add-card-actions' });
  const ok = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '添加' });
  const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '取消' });

  function show(): void {
    btn.hidden = true;
    form.hidden = false;
    input.focus();
  }
  function hide(): void {
    btn.hidden = false;
    form.hidden = true;
    input.value = '';
  }
  async function create(): Promise<void> {
    const title = input.value.trim();
    if (!title) {
      hide();
      return;
    }
    ok.disabled = true;
    try {
      await api(`/columns/${colId}/cards`, { method: 'POST', body: { title } });
      input.value = '';
      ok.disabled = false;
      await load();
      input.focus(); // 回车快速连续创建
    } catch (e) {
      toast(errMsg(e), 'error');
      ok.disabled = false;
    }
  }
  btn.addEventListener('click', show);
  cancel.addEventListener('click', hide);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void create();
    else if (e.key === 'Escape') hide();
  });
  ok.addEventListener('click', () => void create());
  actions.append(ok, cancel);
  form.append(input, actions);
  wrap.append(btn, form);
  return wrap;
}

function buildAddColumn(): HTMLElement {
  const wrap = el('div', { class: 'add-col-wrap' });
  const btn = el('button', { class: 'add-col-btn', type: 'button', text: '+ 添加列' });
  btn.addEventListener('click', async () => {
    const name = await promptDialog('新建列', '列名');
    if (!name) return;
    try {
      await api(`/boards/${boardId}/columns`, { method: 'POST', body: { name } });
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  wrap.append(btn);
  return wrap;
}

// ============ 拖拽 ============

function setupDropZone(body: HTMLElement, colId: number): void {
  body.addEventListener('dragover', (e) => {
    if (dragCardId == null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearIndicators(body);
    const cards = visibleCards(body);
    if (!cards.length) {
      body.classList.add('drop-empty');
      return;
    }
    let insertBefore: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        insertBefore = c;
        break;
      }
    }
    if (insertBefore) insertBefore.classList.add('drop-before');
    else cards[cards.length - 1].classList.add('drop-after');
  });
  body.addEventListener('drop', (e) => {
    if (dragCardId == null) return;
    e.preventDefault();
    const cards = visibleCards(body);
    let before: number | null = null;
    let after: number | null = null;
    const beforeEl = qs<HTMLElement>('.drop-before', body);
    if (beforeEl) before = Number(beforeEl.dataset.card);
    else {
      const afterEl = qs<HTMLElement>('.drop-after', body);
      if (afterEl) after = Number(afterEl.dataset.card);
    }
    clearIndicators(body);
    void moveCard(dragCardId, colId, before, after);
  });
  body.addEventListener('dragleave', () => {
    clearIndicators(body);
  });
}

function visibleCards(body: HTMLElement): HTMLElement[] {
  return qsa<HTMLElement>('.card', body).filter((c) => !c.classList.contains('dragging') && !c.classList.contains('filtered-out'));
}

function clearIndicators(body?: HTMLElement): void {
  const scope = body ?? document;
  qsa<HTMLElement>('.drop-before, .drop-after, .drop-empty', scope).forEach((c) => c.classList.remove('drop-before', 'drop-after', 'drop-empty'));
}

async function moveCard(cardId: number, colId: number, before: number | null, after: number | null): Promise<void> {
  if (!data) return;
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) return;
  const prevColumn = card.columnId;

  // 乐观更新本地数据
  card.columnId = colId;
  const rest = data.cards.filter((c) => c.id !== cardId);
  const colCards = rest.filter((c) => c.columnId === colId).sort((a, b) => a.position - b.position);
  const ids = colCards.map((c) => c.id);
  let idx: number;
  if (after != null) {
    const i = ids.indexOf(after);
    idx = i < 0 ? ids.length : i + 1;
  } else if (before != null) {
    const i = ids.indexOf(before);
    idx = i < 0 ? ids.length : i;
  } else {
    idx = ids.length;
  }
  colCards.splice(idx, 0, card);
  colCards.forEach((c, i) => {
    c.position = (i + 1) * 1024;
  });
  render();

  try {
    await api(`/cards/${cardId}/move`, {
      method: 'POST',
      body: { column_id: colId, before_card_id: before, after_card_id: after },
    });
    await load(); // 与服务器对齐
  } catch (e) {
    card.columnId = prevColumn;
    await load();
    toast(errMsg(e), 'error');
  }
}

// ============ 筛选 ============

function matchFilters(card: CardSummary): boolean {
  if (filterAssignee && !(card.assignee && card.assignee.id === Number(filterAssignee))) return false;
  if (filterLabel && !card.labelIds.includes(Number(filterLabel))) return false;
  if (filterPriority && card.priority !== filterPriority) return false;
  if (filterQ) {
    const q = filterQ.toLowerCase();
    if (!card.title.toLowerCase().includes(q) && !card.number.toLowerCase().includes(q)) return false;
  }
  return true;
}

function refreshFilterOptions(): void {
  if (!data) return;
  const assigneeSel = qs<HTMLSelectElement>('#filter-assignee');
  if (assigneeSel) {
    const cur = assigneeSel.value;
    assigneeSel.innerHTML = '<option value="">全部成员</option>';
    for (const m of data.members) {
      const opt = el('option', { value: String(m.id), text: m.displayName || m.username });
      if (String(m.id) === cur) opt.selected = true;
      assigneeSel.append(opt);
    }
  }
  const labelSel = qs<HTMLSelectElement>('#filter-label');
  if (labelSel) {
    const cur = labelSel.value;
    labelSel.innerHTML = '<option value="">全部标签</option>';
    for (const l of data.labels) {
      const opt = el('option', { value: String(l.id), text: l.name });
      if (String(l.id) === cur) opt.selected = true;
      labelSel.append(opt);
    }
  }
  const prioSel = qs<HTMLSelectElement>('#filter-priority');
  if (prioSel) {
    const cur = prioSel.value;
    prioSel.innerHTML = '<option value="">全部优先级</option>';
    const prios: [string, string][] = [
      ['p0', '紧急'],
      ['p1', '高'],
      ['p2', '中'],
      ['p3', '低'],
    ];
    for (const [v, t] of prios) {
      const opt = el('option', { value: v, text: `${v.toUpperCase()} · ${t}` });
      if (v === cur) opt.selected = true;
      prioSel.append(opt);
    }
  }
}

// ============ SSE ============

function initSse(): void {
  const es = new EventSource(`/api/stream?channel=board:${boardId}`);
  const reload = debounce(() => {
    void load();
    if (getOpenCardId() != null) void refreshOpenCard();
  }, 400);
  ['card.created', 'card.updated', 'card.moved', 'card.deleted', 'comment.added'].forEach((ev) => {
    es.addEventListener(ev, reload);
  });
  es.onerror = () => {
    /* 自动重连 */
  };
}
