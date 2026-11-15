/** No bridge, preload, permission, fetch, storage, selection, click, or page-world evaluation. */
export const QUOTE_LOCATOR_WORLD = 1001;
type Command = { kind: 'arm' | 'prepare' | 'apply' | 'clear'; token: string; url?: string; quote?: string };

// This entire function is serialized. It must not close over host values or imports.
function localQuoteCommand(command: Command): string {
  const key = '__gridLocalQuoteLocatorV1';
  type Prepared = { quote: string; node: Text; offset: number; geometry: string; observer: MutationObserver; changed: boolean };
  type Local = { token: string; document: Document; url: string; historyLength: number; prepared?: Prepared };
  const scope = globalThis as typeof globalThis & { [key]?: Local };
  const prior = scope[key];
  const drop = () => { prior?.prepared?.observer.disconnect(); if (scope[key] === prior) delete scope[key]; };
  if (command.kind === 'clear') { if (prior?.token === command.token) drop(); return 'unsupported'; }
  if (command.kind === 'arm') {
    drop();
    if (window.top !== window || !document.body || document.contentType !== 'text/html' || document.readyState !== 'complete' || location.href !== command.url) return 'unsupported';
    scope[key] = { token: command.token, document, url: location.href, historyLength: history.length };
    return 'prepared';
  }
  const state = prior;
  const current = () => Boolean(state && state.token === command.token && state.document === document && window.top === window
    && location.href === state.url && history.length === state.historyLength && document.readyState === 'complete' && document.visibilityState === 'visible');
  if (!current() || !state) return 'unsupported';
  type Match = { node: Text; offset: number; range: Range; geometry: string };
  type Scan = { status: 'prepared'; match: Match } | { status: 'ambiguous' | 'missing' | 'unsupported' };
  const scan = (quote: string): Scan => {
    // Deliberately no fuzzy/whitespace/case normalization and no cross-node range.
    // Small quotes, transformed text, complex documents and bounded-scan overflow fail closed.
    if (quote.trim().length < 8 || quote.length > 1000 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]|\s{2,}/u.test(quote)) return { status: 'unsupported' };
    if (document.querySelector('[contenteditable]')) return { status: 'unsupported' };
    const started = performance.now();
    const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'DATALIST']);
    const unsupported = new Set(['IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'CANVAS', 'SVG', 'MATH']);
    const textNodes: Text[] = [];
    let count = 0, bytes = 0, combined = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
        const element = node as Element;
        // Form values and editable content are not inspected, including text nodes.
        return excluded.has(element.tagName) || element.hasAttribute('contenteditable') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++count > 5000 || performance.now() - started > 150) return { status: 'unsupported' };
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (unsupported.has(element.tagName) || element.shadowRoot || element.tagName.includes('-') || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return { status: 'unsupported' };
        // Generated/transformed text is not safely enumerable as literal text nodes.
        const style = getComputedStyle(element);
        if (style.textTransform && style.textTransform !== 'none') return { status: 'unsupported' };
        for (const pseudo of ['::before', '::after']) {
          const content = getComputedStyle(element, pseudo).content;
          if (content && !['none', 'normal', '""', "''"].includes(content)) return { status: 'unsupported' };
        }
      } else {
        const text = node as Text;
        bytes += text.length;
        if (bytes > 500_000) return { status: 'unsupported' };
        textNodes.push(text); combined += text.data;
      }
    }
    let aggregate = 0;
    for (let at = combined.indexOf(quote); at !== -1; at = combined.indexOf(quote, at + 1)) if (++aggregate > 1) return { status: 'ambiguous' };
    // Scan hidden text too, so a hidden repeated literal cannot pick the first visible copy.
    let candidate: { node: Text; offset: number } | undefined;
    let matches = 0;
    for (const node of textNodes) for (let at = node.data.indexOf(quote); at !== -1; at = node.data.indexOf(quote, at + 1)) {
      if (++matches > 1) return { status: 'ambiguous' };
      candidate = { node, offset: at };
    }
    if (!aggregate && !matches) return { status: 'missing' };
    if (!candidate || matches !== 1 || aggregate !== 1) return { status: 'unsupported' };
    const opaqueColor = (raw: string) => {
      const value = raw.toLowerCase().trim();
      // Chromium's ordinary computed rgb is opaque. Unrecognized modern color
      // syntax and all non-1 alpha values are deliberately unsupported.
      return /^rgb\([^/()]+\)$/.test(value) || /^rgba\([^()]*,\s*1(?:\.0+)?\s*\)$/.test(value);
    };
    const { node, offset } = candidate;
    for (let element = node.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(element, pseudo).content;
        if (content && !['none', 'normal', '""', "''"].includes(content)) return { status: 'unsupported' };
      }
      const textSecurity = (style as CSSStyleDeclaration & { webkitTextSecurity?: string }).webkitTextSecurity;
      if (element.hasAttribute('hidden') || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true'
        || style.pointerEvents === 'none' || style.display === 'contents' || style.contain?.split(' ').includes('paint') || style.clip && style.clip !== 'auto' || style.maskImage && style.maskImage !== 'none'
        || style.textTransform && style.textTransform !== 'none' || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) !== 1 || style.contentVisibility === 'hidden'
        || style.transform && style.transform !== 'none' || style.filter && style.filter !== 'none' || style.clipPath && style.clipPath !== 'none'
        || style.position === 'fixed' || style.position === 'sticky' || Number.parseFloat(style.fontSize) === 0
        || !opaqueColor(style.color) || style.webkitTextFillColor && !opaqueColor(style.webkitTextFillColor === 'currentcolor' ? style.color : style.webkitTextFillColor)
        || textSecurity && textSecurity !== 'none') return { status: 'unsupported' };
      if ([style.overflow, style.overflowX, style.overflowY].some(value => ['hidden', 'clip'].includes(value)) || element !== document.body && element !== document.documentElement && [style.overflow, style.overflowX, style.overflowY].some(value => ['auto', 'scroll'].includes(value))) return { status: 'unsupported' };
    }
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + quote.length);
    const rects = Array.from(range.getClientRects());
    if (!node.isConnected || range.toString() !== quote || !rects.length || rects.length > 64 || rects.some(rect => !Number.isFinite(rect.top + rect.left + rect.width + rect.height) || rect.width <= 0 || rect.height <= 0)) return { status: 'unsupported' };
    const geometry = JSON.stringify({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, rects: rects.map(r => [r.x, r.y, r.width, r.height]) });
    return { status: 'prepared', match: { node, offset, range, geometry } };
  };
  if (command.kind === 'prepare') {
    state.prepared?.observer.disconnect(); state.prepared = undefined;
    const prepared: Prepared = { quote: command.quote ?? '', node: document.createTextNode(''), offset: 0, geometry: '', changed: false,
      observer: new MutationObserver(() => { prepared.changed = true; }) };
    prepared.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    const result = scan(prepared.quote);
    if (result.status !== 'prepared' || prepared.observer.takeRecords().length || !current()) { prepared.observer.disconnect(); return result.status === 'prepared' ? 'unsupported' : result.status; }
    prepared.node = result.match.node; prepared.offset = result.match.offset; prepared.geometry = result.match.geometry;
    state.prepared = prepared;
    return 'prepared';
  }
  const prepared = state.prepared;
  if (!prepared) return 'unsupported';
  try {
    if (prepared.changed || prepared.observer.takeRecords().length || !current()) return 'unsupported';
    const result = scan(prepared.quote);
    if (result.status !== 'prepared') return result.status;
    const { match } = result;
    if (match.node !== prepared.node || match.offset !== prepared.offset || match.geometry !== prepared.geometry || !current() || prepared.observer.takeRecords().length) return 'unsupported';
    const rect = match.range.getBoundingClientRect();
    // This is the only page effect. No focus, selection, DOM mutation or fragment.
    window.scrollTo({ top: Math.max(0, rect.top + scrollY - innerHeight * .35), left: scrollX, behavior: 'instant' });
    const visible = Array.from(match.range.getClientRects()).find(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!current() || !visible || prepared.observer.takeRecords().length) return 'uncertain';
    const x = Math.max(0, Math.min(innerWidth - 1, visible.left + visible.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, visible.top + visible.height / 2));
    const hit = document.elementFromPoint(x, y);
    return hit === match.node.parentElement ? 'found' : 'uncertain';
  } catch { return 'uncertain'; }
  finally { prepared.observer.disconnect(); prepared.quote = ''; state.prepared = undefined; }
}

export function quoteDomScript(command: Command): string {
  return `/* Grid local quote locator v1 */ (${localQuoteCommand.toString()})(${JSON.stringify(command)})`;
}
