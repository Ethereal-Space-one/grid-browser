namespace Understanding {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  export class Controller {
    private entry = '';
    private signature = '';
    private details = element<HTMLDetailsElement>('question-evidence');
    private inspector = new SnapshotQuote.Inspector(this.details, element('question-source-text'), element<HTMLButtonElement>('question-evidence-back'));
    private summarySignature = '';
    constructor(private hooks: { state: () => State | undefined; grid: GridApi; save: (state?: State) => Promise<boolean>; work: (action: () => Promise<unknown>) => unknown }) {
      element('summarize').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.search) return;
        hooks.work(() => hooks.grid.summarize(state.search!.id, state.ownerId, state.entryId));
      });
      for (const id of ['ask-reading', 'ask-page']) element(id).addEventListener('click', () => {
        const state = hooks.state(); if (!state) return;
        hooks.work(async () => {
          if (!await hooks.save(state)) return; await hooks.grid.beginQuestion(state.ownerId, state.entryId);
          if (hooks.state()?.ownerId === state.ownerId && hooks.state()?.mode === 'question') element('question-input').focus();
        });
      });
      element('question-input').addEventListener('input', () => { void hooks.save(); });
      element('question-form').addEventListener('submit', event => {
        event.preventDefault(); const state = hooks.state(); if (!state?.question) return;
        const text = element<HTMLTextAreaElement>('question-input').value;
        hooks.work(async () => { if (!await hooks.save(state)) return; await hooks.grid.ask(text, state.ownerId, state.entryId, state.question!.id); });
      });
      element('question-origin').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.question) return;
        hooks.work(async () => { if (!await hooks.save(state)) return; await hooks.grid.jump(state.question!.originEntryId, state.ownerId, state.entryId); });
      });
      element('question-open').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.question) return;
        hooks.work(async () => { if (!await hooks.save(state)) return; await hooks.grid.open(state.question!.url, state.ownerId); });
      });
      element('question-cancel').addEventListener('click', () => {
        const state = hooks.state(); if (!state) return;
        hooks.work(async () => { await hooks.grid.cancelRequest(state.ownerId); if (hooks.state()?.entryId === state.entryId) element('question-input').focus(); });
      });
      element('summary-cancel').addEventListener('click', () => {
        const state = hooks.state(); if (!state) return;
        hooks.work(async () => { await hooks.grid.cancelRequest(state.ownerId); if (hooks.state()?.entryId === state.entryId) element('summarize').focus(); });
      });
    }
    render(state: State) {
      const summary = state.summary?.searchId === state.search?.id ? state.summary : undefined;
      const pendingSummary = state.pending?.kind === 'summary';
      const summaryIssue = state.issue?.kind === 'summary';
      element('summary-slot').hidden = state.mode !== 'results' || !state.search?.results.length;
      element('summary-slot').setAttribute('aria-busy', String(pendingSummary));
      // Expansion follows an explicit request; async completion never moves the results again.
      element('summary-slot').dataset.expanded = String(Boolean(summary || pendingSummary || summaryIssue));
      element<HTMLButtonElement>('summarize').disabled = Boolean(state.pending) || Boolean(summary);
      element('summarize').textContent = pendingSummary ? '正在生成…' : summary ? '已生成' : state.issue?.kind === 'summary' ? '重新生成' : '生成短总结';
      element('summary-cancel').hidden = !pendingSummary;
      element('summary-label').textContent = summary ? summary.insufficient ? '摘要信息不足 · AI 未核对' : '已生成 · AI 未核对' : pendingSummary ? '正在整理摘要，结果仍可打开。' : state.issue?.kind === 'summary' ? state.issue.message : '按需生成，最多三句。';
      element('summary-label').classList.toggle('sr-only', Boolean(summary));
      element('summary-label').hidden = !summary && !pendingSummary && !summaryIssue;
      element('summary-slot').dataset.state = state.issue?.kind === 'summary' ? 'error' : pendingSummary ? 'loading' : summary ? 'success' : 'default';
      element('summary-text').textContent = summary?.text || '';
      const summarySignature = [state.ownerId, state.entryId, summary?.id].join(':');
      if (summarySignature !== this.summarySignature) {
        this.summarySignature = summarySignature;
        const links = element('summary-sources'); links.replaceChildren();
        for (const citation of summary?.citations || []) {
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = `来源 ${citation.source} · 打开网站原页`; button.title = `${citation.title}：打开网站当前内容。摘要引用：${citation.quote}（来自搜索摘要，不是 Fetch 正文或完整引用快照）`;
          button.addEventListener('click', () => this.hooks.work(async () => {
            if (this.hooks.state()?.entryId !== state.entryId || this.hooks.state()?.ownerId !== state.ownerId) return;
            if (!await this.hooks.save(state)) return; await this.hooks.grid.open(citation.url, state.ownerId);
          }));
          const quote = document.createElement('blockquote'); quote.textContent = citation.quote;
          const item = document.createElement('div'); item.className = 'summary-citation';
          item.append(quote, button); links.append(item);
        }
      }
      element('ask-page').hidden = state.mode !== 'page';
      element<HTMLButtonElement>('ask-page').disabled = Boolean(state.pageRecovery || state.pending);
      element<HTMLButtonElement>('ask-reading').disabled = !state.reading || Boolean(state.reading.released || state.pending);
      element('question-view').classList.toggle('hidden', state.mode !== 'question');
      const key = `${state.ownerId}:${state.entryId}`;
      if (key !== this.entry) {
        this.entry = key;
        this.inspector.leave();
        element<HTMLTextAreaElement>('question-input').value = state.presentation.questionDraft || '';
      }
      if (state.mode !== 'question') return;
      const q = state.question; const pending = state.pending?.kind === 'question';
      element<HTMLButtonElement>('question-submit').disabled = Boolean(state.pending) || !q;
      element('question-submit').textContent = pending ? '正在回答…' : q?.answer ? '继续提问' : '提问';
      element('question-cancel').hidden = !pending;
      element('question-form').setAttribute('aria-busy', String(pending));
      const originAvailable = Boolean(q && state.path.nodes.some(node => node.id === q.originEntryId));
      element<HTMLButtonElement>('question-origin').disabled = !originAvailable;
      element('question-origin').textContent = originAvailable ? '返回来源位置' : '来源位置已释放';
      element<HTMLButtonElement>('question-open').disabled = !q;
      element('question-scope').textContent = q?.source?.released ? '上次正文未保存。提交后将重新获取公开正文并按新版本独立回答，旧回答仍保留在原步骤。' : q?.source
        ? `提交后将这版公开正文${q.source.truncated ? '的前 16000 字符' : ''}和本次问题发送给 DeepSeek。每次独立作答，不携带前次回答。`
        : '提交后从此地址获取公开 Fetch 正文，再将最多 16000 字符和本次问题发送给 DeepSeek。登录态和动态页面内容不在范围内。';
      element('question-status').textContent = pending ? q?.source ? '正在依据这版正文回答…' : '正在获取公开正文并回答…'
        : state.issue?.kind === 'question' ? state.issue.message : !q ? '这步内容已释放，尚未重新请求。可从路径返回来源。'
        : state.path.nodes.find(node => node.id === state.entryId)?.status === 'cancelled' ? '回答已停止。可以修改问题后重新提交。'
        : q.answer ? q.answer.insufficient ? '资料不足 · 不补全缺失信息' : '回答已生成 · 依据仍需你核对' : '只围绕这个来源，先提出一个问题。';
      element('question-status').dataset.state = state.issue?.kind === 'question' ? 'error' : pending ? 'loading' : q?.answer ? 'success' : 'default';
      const signature = JSON.stringify([key, q?.id, q?.source?.readingId, q?.source?.released]);
      if (signature === this.signature) return;
      this.signature = signature;
      element('question-title').textContent = q?.title || '问这页';
      element('question-url').textContent = q?.url || '';
      element('asked-question').textContent = q?.question || '';
      element('answer-text').textContent = q?.answer?.text || '';
      element('answer-time').textContent = q?.answeredAt ? `AI 回答 · ${new Date(q.answeredAt).toLocaleString('zh-CN')} · 未核对` : '';
      element('answer-section').hidden = !q?.question;
      element('source-version').textContent = q?.source ? `引用快照 · 取得于 ${new Date(q.source.fetchedAt).toLocaleString('zh-CN')} · ${q.source.truncated ? '固定文本，仅前 16000 字符' : '固定文本'} · ${q.source.released ? '快照正文未保存，现显示上次回答' : '非网站当前内容'}` : '尚未获取公开正文';
      this.inspector.clear(); this.details.open = false;
      this.details.hidden = !q?.source || Boolean(q.source.released);
      element('question-source-text').textContent = q?.source?.text || '';
      const evidence = element('answer-citations'); evidence.replaceChildren();
      for (const [index, citation] of (q?.answer?.citations || []).entries()) {
        const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
        const source = q?.source;
        const match = SnapshotQuote.match(source?.text ?? '', citation.quote);
        const problem = match === 'ambiguous' ? '多处匹配' : match === 'missing' ? '未匹配' : '';
        button.textContent = problem ? problem + ' · 查看引用快照' : '定位快照引文';
        const quote = document.createElement('blockquote'); quote.textContent = citation.quote;
        button.disabled = !source || Boolean(source.released); if (!source || source.released) button.textContent = '完整快照未保存 · 无法定位';
        button.setAttribute('aria-label', `依据 ${index + 1} · ${button.textContent}`);
        const version = document.createElement('p'); version.className = 'question-caption';
        version.textContent = source ? `引用快照 · 取得于 ${new Date(source.fetchedAt).toLocaleString('zh-CN')}` : '引用快照的取得时间不可用';
        if (!source || source.released) version.textContent += ' · 这里只保留引文，无法定位完整快照';
        else if (problem) version.textContent += ` · ${problem}，未定位；仅展开固定文本供核对`;
        button.addEventListener('click', () => {
          if (!source || source.released) return;
          this.inspector.show(button, source.text, citation.quote, match);
        }); li.append(button, version, quote); evidence.append(li);
      }
    }
  }
}
