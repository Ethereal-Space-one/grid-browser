import type { WebContentsView } from 'electron';

const VIEWPORT_WORLD = 1005;
const settleLayout = 'new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })';

/** Chrome resizing must not turn a website's scroll anchor into a new position.
 * No page text/fields or scroll coordinates are read, and no scroll is replayed:
 * a user's intervening scroll, focus, or navigation always wins.
 */
export class NativeViewport {
  private revision = 0;
  private pending?: { view: WebContentsView; bounds: string };
  hide(view?: WebContentsView) {
    this.revision++; this.pending = undefined; view?.setVisible(false);
  }
  resize(view: WebContentsView, bounds: Electron.Rectangle, current: () => boolean) {
    const signature = JSON.stringify(bounds);
    if (this.pending?.view === view && this.pending.bounds === signature) return;
    const revision = ++this.revision;
    this.pending = undefined;
    const web = view.webContents;
    if (web.isDestroyed() || !current()) return;
    const before = view.getBounds();
    if (!before.width || !before.height || web.isLoadingMainFrame() || before.width === bounds.width && before.height === bounds.height) {
      view.setBounds(bounds); view.setVisible(true); return;
    }
    this.pending = { view, bounds: signature };
    // Browser-inserted CSS avoids a page CSP exception. The temporary rule is
    // removed after native layout has settled, including stale/error paths.
    void (async () => {
      let key: string | undefined;
      try {
        key = await web.insertCSS('html { overflow-anchor: none !important; }');
        if (revision !== this.revision || web.isDestroyed() || !current()) return;
        view.setBounds(bounds); view.setVisible(true);
        await web.executeJavaScriptInIsolatedWorld(VIEWPORT_WORLD, [{ code: settleLayout }]);
      } catch {
        // A navigating/crashed page must still get the current safe geometry.
        if (revision === this.revision && !web.isDestroyed() && current()) { view.setBounds(bounds); view.setVisible(true); }
      } finally {
        if (key && !web.isDestroyed()) await web.removeInsertedCSS(key).catch(() => {});
        if (revision === this.revision) this.pending = undefined;
      }
    })();
  }
}
