// 全局搜索页：GET /api/search?q= 实时搜索；结果点击打开卡片详情

import { api, errMsg } from './api';
import { el, qs, esc, timeAgo, debounce } from './util';
import { openCardDetail } from './card-modal';
import type { SearchItem } from './types';

export function initSearch(): void {
  const input = qs<HTMLInputElement>('#search-input');
  const results = qs<HTMLElement>('#search-results');
  if (!input || !results) return;

  const run = debounce(async (q: string) => {
    if (!q) {
      results.innerHTML = '<div class="empty">输入关键字开始搜索，支持单号（如 DODG-12、#12）</div>';
      return;
    }
    results.innerHTML = '<div class="muted loading">搜索中…</div>';
    try {
      const items = await api<SearchItem[]>('/search?q=' + encodeURIComponent(q));
      render(results, items);
    } catch (e) {
      results.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }, 300);

  input.addEventListener('input', () => run(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run(input.value.trim());
  });

  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    input.value = q;
    void run(q);
  }
}

function render(box: HTMLElement, items: SearchItem[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">没有匹配的结果</div>';
    return;
  }
  box.innerHTML = '';
  const list = el('div', { class: 'search-results-list' });
  for (const it of items) {
    const row = el('div', { class: 'search-row' });
    const main = el('div', { class: 'search-row-main' });
    main.append(el('span', { class: 'search-row-no muted', text: it.number }));
    main.append(el('span', { class: 'search-row-title', text: it.title }));
    const sub: string[] = [it.projectName];
    if (it.boardName) sub.push(it.boardName);
    if (it.columnName) sub.push(it.columnName);
    main.append(el('span', { class: 'muted search-row-sub', text: sub.join(' · ') }));
    row.append(main);
    if (it.updatedAt) row.append(el('span', { class: 'muted', text: timeAgo(it.updatedAt) }));
    row.addEventListener('click', () => void openCardDetail(it.id));
    list.append(row);
  }
  box.append(list);
}
