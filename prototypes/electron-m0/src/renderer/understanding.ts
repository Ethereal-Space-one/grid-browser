namespace Understanding {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  export class Controller {
    private entry = '';
    private signature = '';
    private summarySignature = '';
    constructor(private hooks: { state: () => State | undefined; grid: GridApi; save: () => Promise<boolean>; work: (action: () => Promise<unknown>) => unknown }) {
      element('summarize').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.search) return;
        hooks.work(() => hooks.grid.summarize(state.search!.id, state.ownerId, state.entryId));
      });
      for (const id of ['ask-reading', 'ask-page']) element(id).addEventListener('click', () => {
        const state = hooks.state(); if (!state) return;
        hooks.work(async () => {
          await hooks.save(); await hooks.grid.beginQuestion(state.ownerId, state.entryId);
          if (hooks.state()?.ownerId === state.ownerId && hooks.state()?.mode === 'question') element('question-input').focus();
        });
      });
      element('question-input').addEventListener('input', () => { void hooks.save(); });
      element('question-form').addEventListener('submit', event => {
        event.preventDefault(); const state = hooks.state(); if (!state?.question) return;
        const text = element<HTMLTextAreaElement>('question-input').value;
        hooks.work(async () => { await hooks.save(); await hooks.grid.ask(text, state.ownerId, state.entryId, state.question!.id); });
      });
      element('question-origin').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.question) return;
        hooks.work(async () => { await hooks.save(); await hooks.grid.jump(state.question!.originEntryId, state.ownerId, state.entryId); });
      });
      element('question-open').addEventListener('click', () => {
        const state = hooks.state(); if (!state?.question) return;
        hooks.work(async () => { await hooks.save(); await hooks.grid.open(state.question!.url, state.ownerId); });
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
          button.textContent = `来源 ${citation.source}`; button.title = `${citation.title}：${citation.quote}`;
          button.addEventListener('click', () => this.hooks.work(async () => {
            if (this.hooks.state()?.entryId !== state.entryId || this.hooks.state()?.ownerId !== state.ownerId) return;
            await this.hooks.save(); await this.hooks.grid.open(citation.url, state.ownerId);
          })); links.append(button);
        }
      }
      element('ask-page').hidden = state.mode !== 'page';
      element<HTMLButtonElement>('ask-page').disabled = Boolean(state.pageRecovery || state.pending);
      element<HTMLButtonElement>('ask-reading').disabled = !state.reading || Boolean(state.reading.released || state.pending);
      element('question-view').classList.toggle('hidden', state.mode !== 'question');
      const key = `${state.ownerId}:${state.entryId}`;
      if (key !== this.entry) { this.entry = key; element<HTMLTextAreaElement>('question-input').value = state.presentation.questionDraft || ''; }
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
      const signature = JSON.stringify([key, q?.id, state.issue?.id]);
      if (signature === this.signature) return;
      this.signature = signature;
      element('question-title').textContent = q?.title || '问这页';
      element('question-url').textContent = q?.url || '';
      element('asked-question').textContent = q?.question || '';
      element('answer-text').textContent = q?.answer?.text || '';
      element('answer-time').textContent = q?.answeredAt ? `AI 回答 · ${new Date(q.answeredAt).toLocaleString('zh-CN')} · 未核对` : '';
      element('answer-section').hidden = !q?.question;
      element('source-version').textContent = q?.source ? `Fetch 正文 · ${new Date(q.source.fetchedAt).toLocaleString('zh-CN')} · ${q.source.truncated ? '仅前 16000 字符' : '本次取得的文本'} · ${q.source.released ? '正文未落盘，现显示上次回答' : '非原页实时内容'}` : '尚未获取公开正文';
      const details = element<HTMLDetailsElement>('question-evidence'); details.hidden = !q?.source || Boolean(q.source.released);
      element('question-source-text').textContent = q?.source?.text || '';
      const evidence = element('answer-citations'); evidence.replaceChildren();
      for (const [index, citation] of (q?.answer?.citations || []).entries()) {
        const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
        button.textContent = `依据 ${index + 1} · 查看这版正文`; const quote = document.createElement('blockquote'); quote.textContent = citation.quote;
        button.disabled = Boolean(q?.source?.released); if (q?.source?.released) button.textContent = '完整正文未保存 · 上次引文';
        button.addEventListener('click', () => {
          const source = q?.source; if (!source) return;
          details.open = true; const text = element('question-source-text'); const offset = source.text.indexOf(citation.quote);
          const mark = document.createElement('mark'); mark.textContent = citation.quote; mark.tabIndex = -1;
          text.replaceChildren(document.createTextNode(source.text.slice(0, offset)), mark, document.createTextNode(source.text.slice(offset + citation.quote.length)));
          mark.focus({ preventScroll: true }); mark.scrollIntoView({ block: 'center', behavior: 'instant' });
        }); li.append(button, quote); evidence.append(li);
      }
    }
  }
}
