namespace PathNavigation {
  type State = import('../contracts/browsing').State;
  type Node = import('../contracts/browsing').PathNode;
  type Hooks = { jump(id: string): Promise<void>; toggle(open: boolean): Promise<void>; focusContent(): void };
  const kinds = { home: '首页', search: '搜索', reading: '正文', page: '网页', question: '问答', comparison: '对照', judgment: '判断' };
  const scenes = { professional: '专业', learning: '学习', living: '生活', entertainment: '娱乐', inspiration: '灵感' };
  const text = (className: string, value: string) => { const span = document.createElement('span'); span.className = className; span.textContent = value; return span; };
  function name(node: Node): string {
    if (node.kind === 'home') return '首页';
    if (node.kind === 'page' && node.target) {
      try { const url = new URL(node.target); return url.host + (url.pathname === '/' ? '' : decodeURI(url.pathname)); } catch { /* Keep the recorded label. */ }
    }
    return node.kind === 'search' ? node.context?.query || node.label : node.label;
  }
  function source(node: Node): string {
    try { return node.target?.startsWith('http') ? new URL(node.target).host : ''; } catch { return ''; }
  }
  function reveal(element: HTMLElement, container: HTMLElement, horizontal = false) {
    const item = element.getBoundingClientRect(); const box = container.getBoundingClientRect();
    if (horizontal) {
      if (item.left < box.left) container.scrollLeft -= box.left - item.left;
      else if (item.right > box.right) container.scrollLeft += item.right - box.right;
    } else {
      const bottom = element.nextElementSibling?.classList.contains('path-meta') ? element.nextElementSibling.getBoundingClientRect().bottom : item.bottom;
      if (item.top < box.top) container.scrollTop -= box.top - item.top;
      else if (bottom > box.bottom) container.scrollTop += bottom - box.bottom;
    }
  }

  /** A view of the Host snapshot only. No renderer-owned history or node mutation. */
  export class Controller {
    private state?: State;
    private signature = '';
    private selecting = 0;
    private bar = document.querySelector<HTMLElement>('#path-bar')!;
    private trail = document.querySelector<HTMLOListElement>('#path-trail')!;
    private toggle = document.querySelector<HTMLButtonElement>('#path-toggle')!;
    private panel = document.querySelector<HTMLElement>('#path-map')!;
    private tree = document.querySelector<HTMLOListElement>('#path-tree')!;
    private scroller = document.querySelector<HTMLElement>('#path-tree-scroll')!;
    private error = document.querySelector<HTMLElement>('#path-error')!;
    constructor(private hooks: Hooks) {
      const resize = new ResizeObserver(() => requestAnimationFrame(() => {
        const current = this.trail.querySelector<HTMLElement>('[aria-current="step"]'); if (current) reveal(current, this.trail, true);
        if (!this.panel.hidden) { const current = this.tree.querySelector<HTMLElement>('[aria-current="step"]'); if (current) reveal(current, this.scroller); }
      }));
      resize.observe(this.trail); resize.observe(this.scroller);
      this.toggle.addEventListener('click', () => { void this.setOpen(!this.state?.pathMapOpen); });
      document.querySelector('#path-close')!.addEventListener('click', () => { void this.setOpen(false); });
      this.panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void this.setOpen(false); return; }
        const buttons = Array.from(this.tree.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus({ preventScroll: true }); reveal(buttons[next], this.scroller); }
      });
    }
    private async setOpen(open: boolean) {
      const owner = this.state?.ownerId;
      try {
        await this.hooks.toggle(open);
        if (!open && owner === this.state?.ownerId) this.toggle.focus({ preventScroll: true });
      } catch { if (owner === this.state?.ownerId) this.showError('地图未能切换，请重新选择。'); }
    }
    private showError(message: string) { this.error.textContent = message; this.error.hidden = false; }
    private async select(id: string) {
      const sequence = ++this.selecting; const owner = this.state?.ownerId;
      this.error.hidden = true;
      try {
        await this.hooks.jump(id);
        if (sequence !== this.selecting || owner !== this.state?.ownerId || this.state?.entryId !== id) return;
        if (this.state.pathMapOpen) this.tree.querySelector<HTMLButtonElement>('[aria-current="step"]')?.focus({ preventScroll: true });
        else this.hooks.focusContent();
        const current = this.state.path.nodes.find(node => node.id === id);
        document.querySelector('#path-announcement')!.textContent = current ? `已返回${kinds[current.kind]}：${name(current)}` : '';
      } catch { if (sequence === this.selecting && owner === this.state?.ownerId) this.showError('页面已变化，未执行这次跳转。请重新选择步骤。'); }
    }
    render(state: State) {
      document.querySelector('#path-storage-note')!.textContent = !state.storage.persistent ? '非持久路径 · 网站登录资料共用。' : state.path.recordingPaused ? '旧步骤自动保存 · 当前续页未记录。' : state.storage.status === 'saved' ? '已保存 · 网页与授权不自动恢复。' : state.storage.status === 'error' || state.storage.status === 'blocked' ? '尚未保存 · 请在本地路径查看原因。' : '本机自动保存 · 正文全文不保存。';
      const previous = this.state; this.state = state;
      const visible = state.path.nodes.length > 1;
      this.bar.hidden = !visible; this.panel.hidden = !visible || !state.pathMapOpen;
      document.documentElement.style.setProperty('--pathbar-height', visible ? '44px' : '0px');
      this.toggle.setAttribute('aria-expanded', String(visible && state.pathMapOpen));
      const signature = JSON.stringify([state.ownerId, state.path, state.pathMapOpen, state.pageRecovery?.kind]);
      if (signature === this.signature) return;
      this.signature = signature;
      if (previous?.ownerId !== state.ownerId) { this.selecting++; this.error.hidden = true; this.scroller.scrollTop = 0; }
      const focused = document.activeElement?.id;
      const nodes = new Map(state.path.nodes.map(node => [node.id, node]));
      const order = new Map(state.path.nodes.map((node, index) => [node.id, index + 1]));
      const ancestors: Node[] = []; const seen = new Set<string>();
      let node = nodes.get(state.entryId);
      while (node && !seen.has(node.id)) { ancestors.unshift(node); seen.add(node.id); node = node.parentId ? nodes.get(node.parentId) : undefined; }
      const route = [...ancestors]; node = nodes.get(state.entryId);
      while (node?.selectedChildId && !seen.has(node.selectedChildId)) {
        node = nodes.get(node.selectedChildId); if (!node) break;
        route.push(node); seen.add(node.id);
      }
      const ancestorsIds = new Set(ancestors.map(node => node.id));
      const routeIds = new Set(route.map(node => node.id));
      const branches = state.path.nodes.filter(node => node.childIds.length > 1).length;
      this.toggle.querySelector('span')!.textContent = branches ? `地图 · ${branches} 处分支` : '地图';
      document.querySelector('#path-summary')!.textContent = `${state.path.nodes.length} 个步骤${branches ? ` · ${branches} 处分支` : ''}`;
      this.trail.replaceChildren(); this.tree.replaceChildren();
      const button = (node: Node, compact: boolean): HTMLButtonElement => {
        const element = document.createElement('button'); element.type = 'button'; element.className = 'path-node';
        element.id = `${compact ? 'trail' : 'map'}-${node.id}`; element.dataset.nodeId = node.id;
        const current = node.id === state.entryId;
        const status = current && state.pageRecovery ? state.pageRecovery.kind === 'loading' ? '正在打开' : '需重新打开'
          : node.status === 'pending' ? '正在加载' : node.status === 'failed' ? '未完成' : node.status === 'cancelled' ? '已取消'
          : node.missingContent.length ? '内容已释放' : !node.recorded ? '未记录' : '';
        element.dataset.state = status === '正在打开' || status === '正在加载' ? 'loading' : node.status === 'failed' || (current && state.pageRecovery?.kind !== 'loading' && state.pageRecovery) ? 'error' : node.status === 'ready' ? 'success' : 'default';
        if (element.dataset.state === 'loading') element.setAttribute('aria-busy', 'true');
        if (current) element.setAttribute('aria-current', 'step');
        if (!ancestorsIds.has(node.id) && routeIds.has(node.id)) element.classList.add('path-future');
        element.append(text('path-number', String(order.get(node.id))), text('path-name', name(node)));
        if (current || (!compact && (status || !ancestorsIds.has(node.id)))) element.append(text('path-badge', current ? `当前${status ? ` · ${status}` : ''}` : status || (routeIds.has(node.id) ? '前进路线' : '其他分支')));
        const description = `第 ${order.get(node.id)} 步 · ${kinds[node.kind]} · ${name(node)}${current ? ' · 当前步骤' : ''}${status ? ` · ${status}` : ''}`;
        element.setAttribute('aria-label', description); element.title = description + (node.target ? `\n${node.target}` : '');
        element.addEventListener('click', () => { void this.select(node.id); }); return element;
      };
      for (const node of route) { const item = document.createElement('li'); item.append(button(node, true)); this.trail.append(item); }
      const rendered = new Set<string>();
      const append = (id: string, list: HTMLOListElement, depth: number) => {
        const node = nodes.get(id); if (!node || rendered.has(id)) return; rendered.add(id);
        const item = document.createElement('li'); item.className = 'path-branch';
        const row = button(node, false); item.append(row);
        const meta = document.createElement('p'); meta.className = 'path-meta';
        const timestamp = new Date(node.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        meta.textContent = [kinds[node.kind], source(node), scenes[node.scene], timestamp,
          depth >= 4 && node.parentId ? `上一步：第 ${order.get(node.parentId)} 步` : '',
          !node.recorded ? '仅暂存当前步骤' : node.missingContent.length ? '部分内容已释放' : node.status === 'cancelled' ? '请求已取消' : ''].filter(Boolean).join(' · ');
        item.append(meta);
        if (node.childIds.length) { const children = document.createElement('ol'); if (depth >= 3) children.className = 'path-deep'; for (const child of node.childIds) append(child, children, depth + 1); item.append(children); }
        list.append(item);
      };
      append(state.path.rootId, this.tree, 0);
      if (focused?.startsWith('map-') || focused?.startsWith('trail-')) document.getElementById(focused)?.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (this.state?.ownerId !== state.ownerId || this.state.entryId !== state.entryId) return;
        const current = this.trail.querySelector<HTMLElement>('[aria-current="step"]'); if (current) reveal(current, this.trail, true);
        if (state.pathMapOpen && (!previous?.pathMapOpen || previous.entryId !== state.entryId || previous.ownerId !== state.ownerId)) {
          const current = this.tree.querySelector<HTMLElement>('[aria-current="step"]'); if (current) reveal(current, this.scroller);
        }
      });
    }
  }
}
