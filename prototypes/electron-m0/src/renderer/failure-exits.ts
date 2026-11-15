namespace FailureExits {
  type State = import('../contracts/browsing').State;
  type GridApi = import('../contracts/browsing').GridApi;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  // A failed Fetch keeps the preceding view. Its URL is not state.value,
  // reading.url, or the last rendered link: only this exact failed node owns it.
  export function originalTarget(s: State): string | undefined {
    if (s.pending || s.issue?.kind !== 'reading') return;
    const node = s.path.nodes.find(n => n.id === s.entryId);
    if (node?.kind !== 'reading' || node.status !== 'failed' || node.runId !== s.issue.id || !node.target) return;
    try {
      const url = new URL(node.target);
      if (!url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return url.href;
    } catch { /* An unsupported address has no actionable link. */ }
  }
  export class Controller {
    private inFlight = false;
    constructor(private hooks: { state: () => State | undefined; grid: GridApi; save: () => Promise<boolean>; work: (action: () => Promise<unknown>) => unknown; measure: () => void; openProvider?: (opener: HTMLElement) => void }) {
      el('failure-configure').addEventListener('click', () => this.command('configure'));
      el('failure-original').addEventListener('click', () => this.command('original'));
      el('failure-back').addEventListener('click', () => this.command('back'));
    }
    private command(kind: 'configure' | 'original' | 'back') {
      const s = this.hooks.state();
      if (!s?.issue || s.pending || this.inFlight) return;
      const target = originalTarget(s);
      if (kind === 'original' && !target || kind === 'configure' && s.keyReady || kind === 'back' && !s.canGoBack) return;
      this.inFlight = true;
      this.hooks.work(async () => {
        try {
          if (!await this.hooks.save()) return;
          const current = this.hooks.state();
          if (current?.ownerId !== s.ownerId || current.entryId !== s.entryId || current.issue?.id !== s.issue!.id || current.pending) return;
          if (kind === 'original') {
            if (originalTarget(current) === target) await this.hooks.grid.open(target!, s.ownerId);
          } else if (kind === 'back') await this.hooks.grid.back(s.ownerId);
          else if (!current.keyReady) {
            if (this.hooks.openProvider) { this.hooks.openProvider(el('failure-configure')); return; }
            if (current.mode !== 'home') await this.hooks.grid.home(s.ownerId);
            const home = this.hooks.state();
            if (home?.ownerId !== s.ownerId || home.mode !== 'home' || home.pending || home.keyReady) return;
            el<HTMLDetailsElement>('provider-settings').open = true;
            el('provider-key').focus({ preventScroll: true }); el('provider-settings').scrollIntoView({ block: 'nearest' });
          }
        } finally { this.inFlight = false; }
      });
    }
    render(s: State) {
      const target = originalTarget(s), noProvider = Boolean(s.issue && !s.keyReady && !s.pending);
      const visible = noProvider || Boolean(target);
      const panel = el('failure-exits'), wasVisible = !panel.hidden;
      panel.hidden = !visible;
      if (visible) {
        el('failure-message').textContent = noProvider
          ? '搜索服务尚未配置。可以设置本次密钥，或继续用网址浏览；不会自动重试。'
          : '这次未能取得引用快照。现有内容仍是上一步，不是下方地址的正文；可直接打开网站当前内容。';
        el('failure-source').textContent = target || ''; el('failure-source').hidden = !target;
        el('failure-configure').hidden = !noProvider; el('failure-original').hidden = !target;
        el('failure-back').hidden = !s.canGoBack;
      }
      if (wasVisible !== visible) this.hooks.measure();
    }
  }
}
