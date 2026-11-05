export interface TabResource { id: string; deactivate(): void; dispose(): void }
export const TAB_LIMIT = 12;

export class TabRegistry<T extends TabResource> {
  private entries = new Map<string, T>();
  private selected?: string;
  constructor(private factory: () => T, private changed: () => void) {}
  all(): T[] { return [...this.entries.values()]; }
  active(): T | undefined { return this.selected ? this.entries.get(this.selected) : undefined; }
  get(id: string): T {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('标签已关闭或不属于此窗口');
    return entry;
  }
  open(resource?: T): T {
    if (this.entries.size >= TAB_LIMIT) throw new Error(`预览版每个窗口最多 ${TAB_LIMIT} 个标签`);
    const tab = resource ?? this.factory(); this.entries.set(tab.id, tab); this.select(tab.id); return tab;
  }
  select(id: string) {
    this.get(id);
    if (this.selected === id) return;
    const previous = this.active(); this.selected = id;
    previous?.deactivate(); this.changed();
  }
  close(id: string) {
    const tab = this.get(id); const all = this.all(); const index = all.indexOf(tab);
    if (this.selected === id) tab.deactivate();
    this.entries.delete(id);
    if (this.selected === id) this.selected = all[index + 1]?.id ?? all[index - 1]?.id;
    tab.dispose(); this.changed();
  }
  dispose() {
    const all = this.all(); this.entries.clear(); this.selected = undefined;
    for (const tab of all) tab.dispose();
  }
}
