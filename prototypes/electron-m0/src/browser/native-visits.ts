import { randomUUID } from 'node:crypto';

export type NativeMethod = 'GET' | 'HEAD' | 'OTHER' | 'UNKNOWN';
export type NativeVisit = Readonly<{ id: string; index: number; url: string; nodeId: string; method: NativeMethod }>;
export type NativePosition = Readonly<{ index: number; url: string; length: number }>;

/** Runtime-only visit identities. Index and URL are observations, never a visit identity. */
export class NativeVisits {
  private visits = new Map<string, NativeVisit>();
  private indices = new Map<number, string>();
  private position?: NativePosition;
  constructor(private readonly limit = 256) {}
  current(): NativePosition | undefined { return this.position; }
  at(index: number, url: string): NativeVisit | undefined {
    const id = this.indices.get(index); const visit = id && this.visits.get(id);
    return visit && visit.url === url ? visit : undefined;
  }
  live(position: NativePosition): boolean {
    return Boolean(this.position && this.position.index === position.index && this.position.url === position.url && this.position.length === position.length);
  }
  resolve(id: string | undefined, position: NativePosition): NativeVisit | undefined {
    if (!this.live(position)) { this.clear(); return undefined; }
    const visit = id && this.visits.get(id);
    return visit || undefined;
  }
  followFrame(id: string | undefined, position: NativePosition): NativeVisit | undefined {
    const visit = id && this.visits.get(id); const previous = this.position;
    if (!visit || !previous || visit.index !== previous.index || visit.url !== previous.url || position.url !== visit.url) return undefined;
    if (this.live(position)) return visit;
    // Chromium's joint history includes child-frame entries. Rebind the current
    // main document only; a new child-frame branch also invalidates forward slots.
    return this.record(position, visit.nodeId, visit.method, position.index <= previous.index);
  }
  record(position: NativePosition, nodeId: string, method: NativeMethod, replaceOnly = false): NativeVisit {
    for (const [index, id] of this.indices) if (replaceOnly ? index === position.index : index >= position.index) {
      this.indices.delete(index); this.visits.delete(id);
    }
    const visit = Object.freeze({ id: randomUUID(), index: position.index, url: position.url, nodeId, method });
    this.visits.set(visit.id, visit); this.indices.set(visit.index, visit.id); this.position = Object.freeze({ ...position });
    while (this.visits.size > this.limit) {
      const id = this.visits.keys().next().value!; const old = this.visits.get(id)!;
      this.visits.delete(id); this.indices.delete(old.index);
    }
    return visit;
  }
  activate(visit: NativeVisit, position: NativePosition): boolean {
    if (this.visits.get(visit.id) !== visit || visit.index !== position.index || visit.url !== position.url || this.position?.length !== position.length) return false;
    this.position = Object.freeze({ ...position }); return true;
  }
  clear() { this.visits.clear(); this.indices.clear(); this.position = undefined; }
}
