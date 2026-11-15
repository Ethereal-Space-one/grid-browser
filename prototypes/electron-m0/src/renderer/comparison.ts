namespace SourceComparison {
  type State = import('../contracts/browsing').State;
  type Api = import('../contracts/browsing').GridApi;
  type Selector = import('../contracts/comparison').ComparisonSelector;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const text = (tag: string, value: string, className = '') => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
  const relations = { agreement: '一致', conflict: '说法有分歧', 'different-scope': '适用范围不同', insufficient: '资料不足' };
  const address = (raw: string) => { try { const url = new URL(raw); url.hash = ''; return url.href; } catch { return raw; } };
  export class Controller {
    private trayKey = '';
    private recordKey = '';
    private entryKey = '';
    private focusOnStart?: string;
    // UI-only opt-in. Host-owned selections survive leaving this mode or reading a page.
    private selectionView = '';
    constructor(private hooks: { state(): State | undefined; grid: Api; save(): Promise<boolean>; work(action: () => Promise<unknown>): unknown }) {
      el('comparison-select-mode').addEventListener('click', () => {
        const s = hooks.state(); if (!s || s.mode !== 'results' || !s.search?.results.length) return;
        this.selectionView = this.picking(s) ? '' : `${s.ownerId}:${s.search.id}`;
        this.render(s);
      });
      el('results').addEventListener('keydown', event => {
        const s = hooks.state();
        if (!s || !this.picking(s) || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        event.preventDefault(); event.stopPropagation();
        // First close an inner disclosure; another Escape exits selection, never removes it.
        const disclosure = event.target instanceof Element ? event.target.closest<HTMLDetailsElement>('details[open]') : null;
        if (disclosure) { disclosure.open = false; disclosure.querySelector('summary')?.focus({ preventScroll: true }); return; }
        this.selectionView = ''; this.render(s);
        el('comparison-select-mode').focus({ preventScroll: true });
      });
      el('comparison-start').addEventListener('click', () => {
        const s = hooks.state(); if (!s) return;
        this.focusOnStart = s.ownerId;
        hooks.work(async () => {
          try { await hooks.save(); await hooks.grid.comparisonStart(s.ownerId, s.entryId); }
          finally { this.focusOnStart = undefined; }
        });
      });
      el('comparison-retry').addEventListener('click', () => {
        const s = hooks.state(); if (!s) return;
        hooks.work(async () => {
          await hooks.save();
          if (s.comparison) await hooks.grid.comparisonRetry(s.comparison.id, s.ownerId, s.entryId);
          else await hooks.grid.comparisonRecover(s.ownerId, s.entryId);
        });
      });
      el('comparison-cancel').addEventListener('click', () => {
        const s = hooks.state(); if (!s) return;
        hooks.work(async () => { await hooks.grid.cancelRequest(s.ownerId); if (hooks.state()?.entryId === s.entryId) el('comparison-retry').focus(); });
      });
      for (const id of ['comparison-reading', 'comparison-question']) el(id).addEventListener('click', () => {
        const s = hooks.state(); if (!s) return;
        const url = s.mode === 'reading' && !s.reading?.released ? s.reading?.url : s.question?.source?.url;
        const selector: Selector | undefined = s.mode === 'reading' && s.reading ? { kind: 'reading', readingId: s.reading.id }
          : s.mode === 'question' && s.question?.source ? { kind: 'question', questionId: s.question.id } : undefined;
        if (url && selector) this.toggle(selector, url);
      });
    }
    resultControl(index: number, searchId: string, title: string, url: string): HTMLElement {
      const label = document.createElement('label'); label.className = 'comparison-pick'; label.hidden = true;
      const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.comparisonUrl = address(url);
      box.id = `comparison-result-${index}`;
      box.setAttribute('aria-label', `选择对照来源：${title}`);
      box.setAttribute('aria-describedby', 'comparison-select-help');
      box.addEventListener('change', () => {
        box.checked = !box.checked;
        const s = this.hooks.state();
        if (!s || !this.picking(s) || s.search?.id !== searchId) return;
        this.toggle({ kind: 'result', searchId, index }, url);
      });
      label.append(box, text('span', '选作对照')); return label;
    }
    private picking(s: State): boolean { return s.mode === 'results' && Boolean(s.search && this.selectionView === `${s.ownerId}:${s.search.id}`); }
    private toggle(selector: Selector, url: string) {
      const s = this.hooks.state(); if (!s) return;
      const selected = s.comparisonSelection.find(item => address(item.url) === address(url));
      this.hooks.work(() => selected ? this.hooks.grid.comparisonRemove(selected.id, s.ownerId, s.entryId) : this.hooks.grid.comparisonChoose(selector, s.ownerId, s.entryId));
    }
    private button(label: string, id: string, action: () => Promise<unknown>): HTMLButtonElement {
      const button = document.createElement('button'); button.type = 'button'; button.id = id; button.textContent = label;
      button.addEventListener('click', () => this.hooks.work(action)); return button;
    }
    render(s: State) {
      // A new result list or tab starts in ordinary reading mode. Do not clear the selection.
      if (this.selectionView && (s.mode !== 'results' || this.selectionView !== `${s.ownerId}:${s.search?.id}`)) this.selectionView = '';
      const picking = this.picking(s);
      el('comparison-result-tools').hidden = s.mode !== 'results' || !s.search?.results.length;
      el('comparison-select-mode').textContent = picking ? '退出选资料' : '选资料对照';
      el('comparison-select-mode').setAttribute('aria-pressed', String(picking));
      el('comparison-select-help').hidden = !picking;
      const tray = el('comparison-tray');
      tray.hidden = !s.comparisonSelection.length || ['comparison', 'judgment'].includes(s.mode);
      el('comparison-count').textContent = `${s.comparisonSelection.length} / 2 份来源${s.comparisonSelection.length === 1 ? ' · 再选一份' : ''}`;
      el('comparison-start').hidden = s.comparisonSelection.length !== 2;
      el<HTMLButtonElement>('comparison-start').disabled = Boolean(s.pending);
      el('comparison-send-note').hidden = s.comparisonSelection.length !== 2;
      const selectedAddresses = new Set(s.comparisonSelection.map(item => address(item.url)));
      for (const box of document.querySelectorAll<HTMLInputElement>('[data-comparison-url]')) {
        const label = box.closest<HTMLElement>('.comparison-pick')!; label.hidden = !picking;
        box.checked = selectedAddresses.has(box.dataset.comparisonUrl!);
        box.disabled = Boolean(s.pending) || !box.checked && s.comparisonSelection.length === 2;
        const index = s.comparisonSelection.findIndex(item => address(item.url) === box.dataset.comparisonUrl);
        label.querySelector('span')!.textContent = index < 0 ? '选作对照' : `已选为 ${index ? 'B' : 'A'}`;
      }
      const updatePick = (id: string, url: string | undefined) => {
        const button = el<HTMLButtonElement>(id); const picked = Boolean(url && selectedAddresses.has(address(url)));
        button.textContent = picked ? '已选对照 · 移除' : '选作对照'; button.setAttribute('aria-pressed', String(picked));
        button.disabled = !url || Boolean(s.pending) || !picked && s.comparisonSelection.length === 2;
      };
      updatePick('comparison-reading', s.mode === 'reading' && !s.reading?.released ? s.reading?.url : undefined);
      el('comparison-question').hidden = !s.question?.source;
      updatePick('comparison-question', s.mode === 'question' ? s.question?.source?.url : undefined);
      const trayKey = JSON.stringify([s.ownerId, s.comparisonSelection, Boolean(s.pending)]);
      if (trayKey !== this.trayKey) {
        this.trayKey = trayKey; const active = document.activeElement?.id;
        const list = el('comparison-selection'); list.replaceChildren();
        for (const [index, item] of s.comparisonSelection.entries()) {
          const row = document.createElement('li'); const label = text('span', `${index ? 'B' : 'A'} · ${item.title}`); label.title = `${item.title}\n${item.url}`;
          const remove = this.button('×', 'comparison-remove-' + item.id, async () => {
            const current = this.hooks.state(); if (!current || current.ownerId !== s.ownerId) return;
            await this.hooks.grid.comparisonRemove(item.id, s.ownerId, current.entryId);
            if (!this.hooks.state()?.comparisonSelection.length) el('input').focus({ preventScroll: true });
            else el('comparison-selection').querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
          });
          remove.disabled = Boolean(s.pending);
          remove.setAttribute('aria-label', `移除来源 ${index ? 'B' : 'A'}：${item.title}`); row.append(label, remove); list.append(row);
        }
        if (active?.startsWith('comparison-remove-')) document.getElementById(active)?.focus({ preventScroll: true });
      }
      const visible = s.mode === 'comparison'; el('comparison-view').classList.toggle('hidden', !visible);
      if (!visible) return;
      const scope = s.path.nodes.find(node => node.id === s.entryId)?.comparisonScope;
      const record: import('../contracts/comparison').ComparisonRecord | undefined = s.comparison ?? (scope && {
        ...scope, id: `missing-${s.entryId}`, sources: scope.sources.map(item => ({ ...item,
          issue: item.version ? `原版正文已释放（取得于 ${new Date(item.version.fetchedAt).toLocaleString('zh-CN')}），尚未补取。` : '尚无可用公开正文。' }))
      });
      const released = !s.comparison; const pending = s.pending?.kind === 'comparison';
      el('comparison-cancel').hidden = !pending;
      el<HTMLButtonElement>('comparison-retry').disabled = !record || Boolean(s.pending);
      el('comparison-retry').textContent = released ? '重新获取两份正文并对照' : record?.sources.some(item => !item.source || item.source.released) ? record?.sources.some(item => item.source?.released) ? '获取新版本正文并对照' : '补取缺失来源并对照' : record?.analysis ? '重新对照这两版正文' : '按相同正文重试';
      const status = el('comparison-status');
      const cancelled = s.path.nodes.find(node => node.id === s.entryId)?.status === 'cancelled';
      status.textContent = !record ? '这步没有可用的来源信息；请从路径返回重新选择，尚未重新请求。'
        : released ? '旧对照内容已释放，来源与原版时间仍保留。点击补取将取得新版本、形成新步骤；尚未重新请求。'
        : pending ? record.sources.every(item => item.source) ? '正在对照这两版正文…' : '正在获取明确选定的公开正文…'
        : s.issue?.kind === 'comparison' ? s.issue.message : cancelled ? '对照已停止，已取得的正文仍可查看。重试由你决定。'
        : record.analysis ? '对照已生成 · AI 观察，未经核对' : '尚未生成对照，请核对来源。';
      status.dataset.state = pending ? 'loading' : s.issue?.kind === 'comparison' ? 'error' : record?.analysis ? 'success' : 'default';
      el('comparison-view').setAttribute('aria-busy', String(pending));
      const key = JSON.stringify([s.ownerId, s.entryId, record?.id, pending]);
      if (key === this.recordKey) return;
      const entryKey = `${s.ownerId}:${s.entryId}`;
      const changedEntry = this.entryKey !== entryKey; this.entryKey = entryKey;
      this.recordKey = key;
      el('comparison-topic').textContent = record?.topic || '';
      el('comparison-version').textContent = record ? `${({professional:'专业',learning:'学习',living:'生活',entertainment:'娱乐',inspiration:'灵感'})[record.scene]}场景 · 本步固定查询与所选正文版本${record.generatedAt ? ' · 生成于 ' + new Date(record.generatedAt).toLocaleString('zh-CN') : ''}` : '';
      el('comparison-overview').textContent = record?.analysis?.overview || '';
      el('comparison-limitations').textContent = record?.analysis?.limitations || '';
      const active = document.activeElement?.id;
      const opened = new Set(Array.from(el('comparison-sources').querySelectorAll<HTMLDetailsElement>('details[open]')).map(node => node.id));
      const sources = el('comparison-sources'); sources.replaceChildren();
      for (const [index, item] of (record?.sources || []).entries()) {
        const letter = index ? 'B' : 'A'; const card = document.createElement('article'); card.className = 'comparison-source'; card.setAttribute('aria-label', `来源 ${letter}`);
        const title = text('h2', item.title); title.title = item.title;
        card.append(text('div', `来源 ${letter}`, 'eyebrow'), title, text('p', item.url, 'comparison-url'));
        const info = item.source ? `引用快照 · 取得于 ${new Date(item.source.fetchedAt).toLocaleString('zh-CN')} · ${item.source.released ? '快照正文未保存；下方保留引文' : item.source.truncated ? '固定文本，仅前 16000 字符' : '固定文本，非网站当前内容'}`
          : item.issue || (pending ? '正在获取公开正文…' : '尚未取得公开正文');
        card.append(text('p', info, item.issue ? 'comparison-source-issue' : 'comparison-caption'));
        const actions = document.createElement('div'); actions.className = 'understanding-actions';
        const open = this.button('打开网站原页 ↗', `comparison-open-${index}`, async () => {
          if (this.hooks.state()?.ownerId !== s.ownerId || this.hooks.state()?.entryId !== s.entryId) return;
          await this.hooks.save(); await this.hooks.grid.open(item.url, s.ownerId);
        });
        open.title = '打开网站当前内容，不是引用快照';
        const origin = this.button('返回选择位置', `comparison-origin-${index}`, async () => {
          if (this.hooks.state()?.ownerId !== s.ownerId || this.hooks.state()?.entryId !== s.entryId) return;
          await this.hooks.save(); await this.hooks.grid.jump(item.originEntryId, s.ownerId, s.entryId);
        });
        origin.disabled = !s.path.nodes.some(node => node.id === item.originEntryId); actions.append(open, origin); card.append(actions);
        if (item.source && !item.source.released) {
          const details = document.createElement('details'); details.className = 'question-evidence'; details.id = `comparison-evidence-${index}`;
          const summary = text('summary', '查看引用快照'); const body = text('pre', item.source.text);
          body.id = `comparison-text-${index}`; body.tabIndex = 0; summary.setAttribute('aria-label', `查看来源 ${letter} 的引用快照`); body.setAttribute('aria-label', `来源 ${letter} 的引用快照`);
          const back = this.button('回到刚才的对照项', `comparison-evidence-back-${index}`, async () => {
            const target = back.dataset.quoteTarget && document.getElementById(back.dataset.quoteTarget);
            if (!target) return;
            if (back.dataset.collapse === 'true') details.open = false;
            target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center', behavior: 'instant' });
          }); back.hidden = true;
          details.append(summary, body, back); details.open = !changedEntry && opened.has(details.id); card.append(details);
        }
        sources.append(card);
      }
      const rows = el('comparison-rows'); rows.replaceChildren();
      for (const [rowIndex, row] of (record?.analysis?.rows || []).entries()) {
        const section = document.createElement('section'); section.className = 'comparison-row';
        const heading = text('h2', row.aspect); heading.id = `comparison-aspect-${rowIndex}`; section.setAttribute('aria-labelledby', heading.id);
        const relation = text('p', `${relations[row.relation]} · AI 判断待核对`, 'comparison-relation'); relation.dataset.relation = row.relation;
        section.append(heading, relation); const pair = document.createElement('div'); pair.className = 'comparison-pair';
        for (const [index, side] of [row.left, row.right].entries()) {
          const column = document.createElement('article'); column.append(text('h3', `来源 ${index ? 'B' : 'A'}`), text('p', side.text));
          for (const [quoteIndex, quote] of side.quotes.entries()) {
            const evidence = document.createElement('div'); evidence.className = 'comparison-quote';
            const source = record!.sources[index].source; const offset = source && quote ? source.text.indexOf(quote) : -1;
            const ambiguous = offset >= 0 && source!.text.indexOf(quote, offset + 1) >= 0;
            const label = ambiguous ? '多处匹配 · 查看引用快照' : offset < 0 ? '未匹配 · 查看引用快照' : '定位快照引文';
            const button = this.button(label, `comparison-quote-${rowIndex}-${index}-${quoteIndex}`, async () => {
              if (!source || source.released) return;
              const body = el(`comparison-text-${index}`); const details = el<HTMLDetailsElement>(`comparison-evidence-${index}`);
              const back = el(`comparison-evidence-back-${index}`);
              body.textContent = source.text; back.hidden = true; delete back.dataset.quoteTarget; delete back.dataset.collapse;
              const wasOpen = details.open; details.open = true;
              if (offset < 0 || ambiguous) return;
              back.hidden = false;
              back.dataset.quoteTarget = `comparison-quote-${rowIndex}-${index}-${quoteIndex}`; back.dataset.collapse = String(!wasOpen);
              const mark = text('mark', quote); mark.tabIndex = -1;
              body.replaceChildren(document.createTextNode(source.text.slice(0, offset)), mark, document.createTextNode(source.text.slice(offset + quote.length)));
              mark.focus({ preventScroll: true }); mark.scrollIntoView({ block: 'center', behavior: 'instant' });
            });
            if (!source || source.released) { button.disabled = true; button.textContent = '完整快照未保存 · 无法定位'; }
            // Full version/scope stays in the A/B source cards. Repeat only a local
            // limitation beside the affected quote, not successful provenance.
            const note = !source || source.released ? '这里只保留引文，无法定位完整快照'
              : ambiguous || offset < 0 ? `${ambiguous ? '多处匹配' : '未匹配'}，未定位；仅展开固定文本供核对` : '';
            evidence.append(text('blockquote', quote));
            if (note) {
              const issue = text('p', note, 'comparison-quote-issue'); issue.id = `${button.id}-issue`;
              evidence.append(issue); button.setAttribute('aria-describedby', issue.id);
            }
            evidence.append(button); column.append(evidence);
          }
          pair.append(column);
        }
        section.append(pair); rows.append(section);
      }
      if (active && !changedEntry) document.getElementById(active)?.focus({ preventScroll: true });
      if (changedEntry && this.focusOnStart === s.ownerId) requestAnimationFrame(() => {
        if (this.hooks.state()?.ownerId === s.ownerId && this.hooks.state()?.entryId === s.entryId) el('comparison-title').focus({ preventScroll: true });
      });
    }
  }
}
