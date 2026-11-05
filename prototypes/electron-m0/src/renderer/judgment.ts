namespace PersonalJudgment {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  type Judgment = import('../contracts/judgment').Judgment;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  export class Controller {
    private entry = '';
    private revision = 0;
    private pending: Promise<void> = Promise.resolve();
    private failed = false;
    private saving = false;
    private referenceKey = '';
    constructor(private hooks: { state: () => State | undefined; grid: GridApi; save: () => Promise<boolean>; work: (action: () => Promise<unknown>) => unknown }) {
      for (const id of ['judgment-from-question', 'judgment-from-comparison', 'judgment-revise']) el(id).addEventListener('click', () => {
        const s = hooks.state(); if (!s) return;
        hooks.work(async () => {
          await hooks.save(); await hooks.grid.judgmentBegin(s.ownerId, s.entryId);
          if (hooks.state()?.mode === 'judgment' && hooks.state()?.ownerId === s.ownerId) el('judgment-text').focus();
        });
      });
      for (const id of ['judgment-text', 'judgment-checks']) el(id).addEventListener('input', () => this.edit());
      el('judgment-references').addEventListener('change', () => this.edit());
      el('judgment-retry').addEventListener('click', () => this.edit());
      el('judgment-form').addEventListener('submit', event => {
        event.preventDefault(); const s = hooks.state(); if (!s?.judgment || this.saving) return;
        this.saving = true; this.status('正在保存本次版本…', 'loading');
        el<HTMLButtonElement>('judgment-save').disabled = true;
        hooks.work(async () => {
          try {
            await this.flush(); await hooks.grid.judgmentSave({ draftId: s.judgment!.draftId, revision: this.revision }, s.ownerId, s.entryId);
            if (hooks.state()?.ownerId === s.ownerId && hooks.state()?.mode === 'judgment') el('judgment-title').focus();
          } catch (error) {
            if (hooks.state()?.ownerId === s.ownerId && hooks.state()?.entryId === s.entryId) this.status(error instanceof Error ? error.message : '未保存，请重试', 'error');
            throw error;
          } finally { this.saving = false; this.controls(this.hooks.state()); }
        });
      });
      el('judgment-origin').addEventListener('click', () => {
        const s = hooks.state(); const origin = s?.judgment?.originEntryId ?? s?.path.nodes.find(n => n.id === s.entryId)?.judgmentScope?.originEntryId;
        if (!s || !origin) return;
        hooks.work(async () => { await hooks.save(); await hooks.grid.jump(origin, s.ownerId, s.entryId); });
      });
    }
    async flush(): Promise<void> { await this.pending; if (this.failed) throw new Error('草稿更新未完成，请点击重试保留草稿后再离开'); }
    private status(message: string, state: string) {
      el('judgment-status').textContent = message; el('judgment-status').dataset.state = state;
      el('judgment-save').dataset.state = state; el('judgment-form').dataset.state = state;
      el('judgment-form').setAttribute('aria-busy', String(state === 'loading'));
      for (const id of ['judgment-text', 'judgment-checks']) el(id).setAttribute('aria-invalid', String(state === 'error'));
    }
    private edit() {
      const s = this.hooks.state(); const draft = s?.mode === 'judgment' && s.judgment?.status === 'draft' ? s.judgment : undefined;
      if (!s || !draft || this.saving) return;
      const entry = this.entry; const revision = ++this.revision;
      this.failed = false; this.status('正在保留草稿…', 'loading');
      const edit = { draftId: draft.draftId, revision, text: el<HTMLTextAreaElement>('judgment-text').value,
        checks: el<HTMLTextAreaElement>('judgment-checks').value,
        citationIds: Array.from(el('judgment-references').querySelectorAll<HTMLInputElement>('input:checked')).map(n => n.value) };
      this.pending = this.hooks.grid.judgmentEdit(edit, s.ownerId, s.entryId).then(() => {
        if (entry === this.entry && revision === this.revision) this.status('草稿已保留在本次运行中', 'success');
      }, () => {
        if (entry === this.entry && revision === this.revision) { this.failed = true; this.status('草稿未能保留；文字仍在输入框，请重试。', 'error'); this.controls(this.hooks.state()); }
      });
      el('judgment-boundary').textContent = s.storage.persistent ? '判断和草稿随路径保存在本机；提交状态可在本地记录中查看。个人文字不发送给模型。' : '非持久路径：任务不写入本地文件，关闭后无法恢复；网站登录状态仍共用。个人文字不发送给模型。';
      this.controls(s);
    }
    private controls(state: State | undefined) {
      const draft = state?.mode === 'judgment' && state.judgment?.status === 'draft';
      el<HTMLButtonElement>('judgment-save').disabled = !draft || this.saving || this.failed || !el<HTMLTextAreaElement>('judgment-text').value.trim();
      el('judgment-save').hidden = !draft;
      el('judgment-save').textContent = this.saving ? '正在保存…' : '保存为新版本';
      el('judgment-retry').hidden = !this.failed;
      for (const id of ['judgment-text', 'judgment-checks']) el<HTMLTextAreaElement>(id).disabled = this.saving;
      el<HTMLFieldSetElement>('judgment-references').disabled = this.saving;
    }
    render(s: State) {
      el('judgment-from-question').hidden = s.mode !== 'question' || !s.question?.answer || !s.question.source || Boolean(s.pending);
      el('judgment-from-comparison').hidden = s.mode !== 'comparison' || !s.comparison?.analysis || Boolean(s.pending);
      el('judgment-view').classList.toggle('hidden', s.mode !== 'judgment');
      const j = s.mode === 'judgment' ? s.judgment : undefined;
      const key = `${s.ownerId}:${s.entryId}`; const switched = key !== this.entry;
      if (switched) { this.entry = key; this.revision = j?.revision ?? 0; this.failed = false; this.saving = false; this.pending = Promise.resolve(); }
      if (s.mode !== 'judgment') return;
      const scope = s.path.nodes.find(n => n.id === s.entryId)?.judgmentScope;
      const draft = j?.status === 'draft';
      el('judgment-citation-label').textContent = draft ? `附上原文引文 · 已选 ${j.citationIds.length} / ${j.citations.length}` : `你选择的原文引文 · ${j?.citationIds.length ?? 0} 条`;
      el('judgment-title').textContent = !j ? '我的判断 · 内容已释放' : draft ? '我的判断' : `我的判断 · v${j.version}`;
      el('judgment-topic').textContent = j?.topic ?? '';
      el('judgment-version').textContent = j ? draft ? j.version ? `修改草稿 · 基于 v${j.version} · 保存后新增版本` : '草稿 · 由你撰写，尚未形成版本'
        : `由你撰写 · ${new Date(j.savedAt!).toLocaleString('zh-CN')} · ${s.storage.persistent ? '个人判断版本' : '非持久路径'}` : scope?.status === 'saved' ? `v${scope.version} · 版本位置仍保留` : '草稿位置仍保留';
      el('judgment-form').hidden = !draft;
      el('judgment-saved').hidden = !j || draft;
      el('judgment-revise').hidden = !j || draft;
      el('judgment-reference-area').hidden = !j;
      const origin = j?.originEntryId ?? scope?.originEntryId;
      el<HTMLButtonElement>('judgment-origin').disabled = !s.path.nodes.some(n => n.id === origin);
      if (switched) {
        el<HTMLTextAreaElement>('judgment-text').value = j?.text ?? '';
        el<HTMLTextAreaElement>('judgment-checks').value = j?.checks ?? '';
        this.status(j ? draft ? s.storage.persistent ? '草稿随路径自动保留；提交状态可在本地记录中查看。' : '非持久路径：草稿仅保留在本次运行中。' : '已形成独立版本，旧版本和草稿仍可从路径回看。'
          : '文字已从内存释放，无法自动重建你的判断。可返回原问答或对照重新记录；不会重新请求模型。', j ? draft ? 'default' : 'success' : 'error');
      }
      el('judgment-saved-text').textContent = j?.text ?? '';
      el('judgment-saved-checks').textContent = j?.checks || '没有记录待核事项。';
      el('judgment-model-note').textContent = j?.modelNote ?? '';
      const referenceKey = `${key}:${draft ? j?.draftId : j?.id}`;
      if (referenceKey !== this.referenceKey) {
        this.referenceKey = referenceKey;
        el<HTMLDetailsElement>('judgment-model').open = false;
        el<HTMLDetailsElement>('judgment-citation-options').open = !draft;
        const fieldset = el('judgment-references'); fieldset.replaceChildren();
        const legend = document.createElement('legend'); legend.textContent = '原文引文'; legend.className = 'sr-only'; fieldset.append(legend);
        const refs = draft ? j?.citations : j?.citations.filter(c => j.citationIds.includes(c.id));
        if (!refs?.length) { const p = document.createElement('p'); p.className = 'judgment-caption'; p.textContent = draft ? '这版模型输出没有可附上的原文引文。你仍可记录判断，或返回来源核对。' : '这个版本未附引文。'; fieldset.append(p); }
        for (const [index, c] of (refs ?? []).entries()) {
          const label = document.createElement('label'); label.className = 'judgment-citation';
          if (draft) { const input = document.createElement('input'); input.type = 'checkbox'; input.value = c.id; input.id = `judgment-citation-${index}`; input.checked = j!.citationIds.includes(c.id); label.htmlFor = input.id; label.append(input); }
          const body = document.createElement('span'); const title = document.createElement('strong'); title.textContent = c.title;
          const quote = document.createElement('q'); quote.textContent = c.quote;
          const version = document.createElement('span'); version.className = 'judgment-caption'; version.textContent = `${new Date(c.fetchedAt).toLocaleString('zh-CN')} · Fetch ${c.truncated ? '截取正文' : '正文'} · 非原页实时内容`;
          const address = document.createElement('span'); address.className = 'judgment-caption'; address.textContent = c.url;
          version.title = `正文版本 ${c.readingId}`;
          body.append(title, quote, version, address); label.append(body); fieldset.append(label);
        }
      }
      el('judgment-boundary').textContent = s.storage.persistent ? '判断和草稿随路径保存在本机；提交状态可在本地记录中查看。个人文字不发送给模型。' : '非持久路径：任务不写入本地文件，关闭后无法恢复；网站登录状态仍共用。个人文字不发送给模型。';
      this.controls(s);
    }
  }
}
