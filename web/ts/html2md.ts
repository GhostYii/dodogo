// HTML → Markdown 转换（供 TipTap 所见即所得编辑器保存时使用）
// 覆盖：加粗/斜体/删除线/标题/有序无序列表/任务列表/引用/行内代码/代码块/链接/图片/分割线/表格/段落/换行。

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'LI',
]);

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as HTMLElement).tagName);
}

/** 序列化 inline 内容（strong/em/code/a/img/br 等）。 */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = () => Array.from(el.childNodes).map(inline).join('');
  switch (el.tagName) {
    case 'STRONG':
    case 'B':
      return `**${inner()}**`;
    case 'EM':
    case 'I':
      return `*${inner()}*`;
    case 'DEL':
    case 'S':
    case 'STRIKE':
      return `~~${inner()}~~`;
    case 'CODE':
      return `\`${inner()}\``;
    case 'A': {
      const href = el.getAttribute('href') || '';
      const text = inner();
      if (!href) return text;
      // 卡片引用链接还原为 [[KEY-123]]
      if (href.startsWith('/search?q=')) {
        const q = decodeURIComponent(href.slice('/search?q='.length));
        return `[[${q}]]`;
      }
      if (text === href) return `<${href}>`;
      return `[${text}](${href})`;
    }
    case 'IMG': {
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }
    case 'BR':
      return '  \n';
    case 'INPUT': {
      if ((el.getAttribute('type') || '').toLowerCase() !== 'checkbox') return '';
      return el.hasAttribute('checked') ? '[x] ' : '[ ] ';
    }
    default:
      return inner();
  }
}

function blocks(container: Node): string {
  let out = '';
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) out += t + '\n\n';
    buf = '';
  };
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      buf += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (isBlock(child)) {
      flush();
      out += blockNode(child as HTMLElement);
    } else {
      buf += inline(child);
    }
  }
  flush();
  return out;
}

function blockNode(el: HTMLElement): string {
  switch (el.tagName) {
    case 'P': {
      const t = inline(el).trim();
      return t ? t + '\n\n' : '\n';
    }
    case 'DIV':
      return blocks(el);
    case 'H1': return `# ${inline(el)}\n\n`;
    case 'H2': return `## ${inline(el)}\n\n`;
    case 'H3': return `### ${inline(el)}\n\n`;
    case 'H4': return `#### ${inline(el)}\n\n`;
    case 'H5': return `##### ${inline(el)}\n\n`;
    case 'H6': return `###### ${inline(el)}\n\n`;
    case 'HR': return '---\n\n';
    case 'BLOCKQUOTE': {
      const inner = blocks(el).trim().replace(/\n/g, '\n> ');
      return `> ${inner}\n\n`;
    }
    case 'UL': return list(el, false) + '\n';
    case 'OL': return list(el, true) + '\n';
    case 'PRE': {
      const codeEl = el.querySelector('code');
      const lang = codeEl ? (codeEl.className.match(/language-([\w+-]+)/) || [])[1] || '' : '';
      const txt = el.textContent ?? '';
      return '```' + lang + '\n' + txt.replace(/\n+$/, '') + '\n```\n\n';
    }
    case 'TABLE': return table(el) + '\n\n';
    case 'LI': return inline(el);
    default: return blocks(el);
  }
}

function list(el: HTMLElement, ordered: boolean): string {
  let out = '';
  let n = 0;
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'LI') continue;
    n++;
    const li = child as HTMLElement;
    const isTask = li.getAttribute('data-type') === 'taskItem';
    const checked = li.getAttribute('data-checked') === 'true';
    const marker = ordered ? `${n}. ` : '- ';

    const lines: string[] = [];
    let buf = '';
    const flush = () => {
      const t = buf.trim();
      if (t) lines.push(t);
      buf = '';
    };
    for (const node of Array.from(li.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        buf += node.textContent ?? '';
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = (node as HTMLElement).tagName;
      if (tag === 'UL' || tag === 'OL') {
        flush();
        lines.push(list(node as HTMLElement, tag === 'OL').replace(/\n+$/, ''));
      } else if (tag === 'P' || tag === 'DIV') {
        flush();
        const t = inline(node as HTMLElement).trim();
        if (t) lines.push(t);
      } else if (isTask && tag === 'LABEL') {
        // 任务清单复选框：状态已在首行前缀体现，跳过该元素
        continue;
      } else {
        buf += inline(node);
      }
    }
    flush();

    if (!lines.length) lines.push('');
    const first = (isTask ? (checked ? '[x] ' : '[ ] ') : '') + lines[0];
    out += marker + first + '\n';
    for (let i = 1; i < lines.length; i++) out += indent(lines[i], 2) + '\n';
  }
  return out;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((l) => pad + l).join('\n');
}

function table(el: HTMLElement): string {
  const rows = Array.from(el.querySelectorAll('tr'));
  if (!rows.length) return '';
  const lines: string[] = [];
  rows.forEach((row, ri) => {
    const cells = Array.from(row.children).filter((c) => c.tagName === 'TH' || c.tagName === 'TD');
    const texts = cells.map((c) => inline(c).trim().replace(/\|/g, '\\|'));
    lines.push('| ' + texts.join(' | ') + ' |');
    if (ri === 0) lines.push('| ' + texts.map(() => '---').join(' | ') + ' |');
  });
  return lines.join('\n');
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const body = doc.body;
  const out = blocks(body).trim().replace(/\n{3,}/g, '\n\n');
  return out ? out + '\n' : '';
}
