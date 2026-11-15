// Synthetic geometry only. Native Electron layout/effect checks are a separate stage.
// Supply GRID_TEST_DEPENDENCY_PATH=<directory containing package.json and jsdom>.
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const deps = process.env.GRID_TEST_DEPENDENCY_PATH || path.join(__dirname, 'quote-regression/deps');
const { JSDOM } = createRequire(path.join(path.resolve(deps), 'package.json'))('jsdom');
const { quoteDomScript } = require('../dist/browser/quote-dom.js');
const quote = 'Unique synthetic native quotation for local verification.';
const url = 'https://example.com/synthetic-source';
function fixture(body = `<p id="target" data-y="1200">${quote}</p>`, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, realStyle = w.getComputedStyle.bind(w);
  let scrolls = 0, y = 0, altered = 0;
  Object.defineProperty(w.document, 'readyState', { value: 'complete', configurable: true });
  Object.defineProperty(w, 'scrollY', { get: () => y }); Object.defineProperty(w, 'scrollX', { get: () => 0 });
  w.getComputedStyle = (element, pseudo) => {
    if (pseudo) return { content: element.getAttribute('data-pseudo') || 'none' };
    const style = realStyle(element);
    return new Proxy(style, { get(target, name) {
      if (name === 'color' && target.color === 'canvastext') return 'rgb(0, 0, 0)';
      if (name === 'webkitTextFillColor') return element.getAttribute('data-fill') || target.webkitTextFillColor;
      if (name === 'webkitTextSecurity') return element.getAttribute('data-security') || target.webkitTextSecurity;
      if (name === 'opacity') return target.opacity || '1';
      if (name === 'visibility') return target.visibility || 'visible';
      if (name === 'transform' || name === 'filter' || name === 'clipPath' || name === 'maskImage') return target[name] || 'none';
      if (name === 'clip') return target.clip || 'auto';
      return target[name];
    } });
  };
  const rect = range => { const top = Number(range.startContainer.parentElement.closest('[data-y]')?.getAttribute('data-y') || '1200') - y + altered; return { x: 20, y: top, top, bottom: top + 20, left: 20, right: 420, width: 400, height: 20 }; };
  w.Range.prototype.getClientRects = function () { return [rect(this)]; };
  w.Range.prototype.getBoundingClientRect = function () { return rect(this); };
  w.document.elementFromPoint = () => options.occluded ? w.document.body : w.document.querySelector('#target');
  w.scrollTo = spec => { scrolls++; y = spec.top; if (options.mutateOnScroll) w.document.querySelector('#target').textContent = 'Changed after effect'; };
  w.focus = () => assert.fail('focus must not be changed');
  w.getSelection = () => assert.fail('selection must not be read or changed');
  const command = (kind, fields = {}) => w.eval(quoteDomScript({ kind, token: 'fixture-capability', url, ...fields }));
  assert.equal(command('arm'), 'prepared');
  return { dom, w, command, scrolls: () => scrolls, geometryChange: () => { altered++; }, close: () => dom.window.close() };
}
function run(body, result, options) {
  const f = fixture(body, options);
  try { assert.equal(f.command('prepare', { quote }), result); assert.equal(f.scrolls(), 0); }
  finally { f.close(); }
}
test('first command only arms; second prepares without effect; apply scrolls once without focus/selection/DOM writes', () => {
  const f = fixture();
  try {
    assert.equal(f.scrolls(), 0); const before = f.w.document.body.innerHTML;
    assert.equal(f.command('prepare', { quote }), 'prepared'); assert.equal(f.scrolls(), 0);
    assert.equal(f.command('apply'), 'found'); assert.equal(f.scrolls(), 1); assert.equal(f.w.document.body.innerHTML, before);
    assert.equal(f.command('apply'), 'unsupported'); assert.equal(f.scrolls(), 1);
  } finally { f.close(); }
});
test('repeated visible, hidden, overlapping or cross-node literals never pick a first occurrence', () => {
  run(`<p id="target">${quote}</p><p>${quote}</p>`, 'ambiguous');
  run(`<p id="target">${quote}</p><p hidden>${quote}</p>`, 'ambiguous');
  run(`<p id="target">${quote}</p><p>Unique synthetic <em>native quotation for local verification.</em></p>`, 'ambiguous');
  const f = fixture('<p id="target">aaaaaaaaaa</p>');
  try { assert.equal(f.command('prepare', { quote: 'aaaaaaaa' }), 'ambiguous'); assert.equal(f.scrolls(), 0); } finally { f.close(); }
});
test('missing and split-node-only text do not become guessed positions', () => {
  run('<p id="target">Different source text.</p>', 'missing');
  run('<p id="target">Unique synthetic <em>native quotation for local verification.</em></p>', 'unsupported');
});
for (const attrs of ['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"', 'style="font-size:0"', 'style="color:transparent"', 'style="transform:translateX(2px)"', 'style="filter:blur(1px)"', 'style="clip-path:inset(90%)"', 'style="pointer-events:none"', 'style="overflow:hidden"', 'style="overflow:auto"', 'style="position:fixed"', 'style="position:sticky"', 'style="display:contents"', 'style="contain:paint"', 'style="mask-image:url(fake)"', 'style="text-transform:uppercase"', 'data-fill="rgba(0, 0, 0, 0)"', 'data-fill="color(srgb 0 0 0 / 0)"', 'data-security="disc"', 'style="color:rgba(0, 0, 0, 0.01)"']) {
  test(`unmeasurable/complex target ${attrs} refuses before scroll`, () => run(`<p id="target" ${attrs}>${quote}</p>`, 'unsupported'));
}
for (const extra of ['<iframe src="about:blank"></iframe>', '<canvas></canvas>', '<svg></svg>', '<object></object>', '<custom-source></custom-source>', '<div contenteditable="false">Not read</div>', '<span data-pseudo="&quot;generated text&quot;"></span>']) {
  test(`unsupported document boundary ${extra} refuses before effect`, () => run(`<p id="target">${quote}</p>${extra}`, 'unsupported'));
}
test('body generated text and body text transforms also fail closed', () => {
  for (const [attr, value] of [['data-pseudo', '"generated"'], ['style', 'text-transform:uppercase']]) {
    const f = fixture(); try { f.w.document.body.setAttribute(attr, value); assert.equal(f.command('prepare', { quote }), 'unsupported'); assert.equal(f.scrolls(), 0); } finally { f.close(); }
  }
});
test('open shadow roots are rejected without traversing shadow text', () => {
  const f = fixture('<p id="target">' + quote + '</p><div id="shadow"></div>');
  try { f.w.document.querySelector('#shadow').attachShadow({ mode: 'open' }).textContent = quote; assert.equal(f.command('prepare', { quote }), 'unsupported'); } finally { f.close(); }
});
test('form text/values are excluded and never dereferenced', () => {
  const f = fixture(`<p id="target">${quote}</p><input value="private"><textarea>Not inspected</textarea><select><option>Not inspected</option></select>`);
  try {
    for (const element of f.w.document.querySelectorAll('input,textarea,select')) Object.defineProperty(element, 'value', { get() { assert.fail('form value read'); } });
    assert.equal(f.command('prepare', { quote }), 'prepared'); assert.equal(f.command('apply'), 'found');
  } finally { f.close(); }
  run(`<textarea>${quote}</textarea>`, 'missing');
});
test('DOM replacement, attributes, text edits and geometry changes between phases refuse effect', () => {
  const changes = [f => f.w.document.querySelector('#target').replaceWith(f.w.document.querySelector('#target').cloneNode(true)), f => f.w.document.querySelector('#target').setAttribute('data-changed','1'), f => { f.w.document.querySelector('#target').firstChild.data += '.'; }, f => f.geometryChange()];
  for (const change of changes) { const f = fixture(); try { assert.equal(f.command('prepare', { quote }), 'prepared'); change(f); assert.equal(f.command('apply'), 'unsupported'); assert.equal(f.scrolls(), 0); } finally { f.close(); } }
});
test('URL change, same-URL pushState and token revocation refuse effect', () => {
  const changes = [f => f.dom.reconfigure({ url: url + '#new' }), f => f.w.history.pushState({}, '', url), f => f.command('clear')];
  for (const change of changes) { const f = fixture(); try { assert.equal(f.command('prepare', { quote }), 'prepared'); change(f); assert.equal(f.command('apply'), 'unsupported'); assert.equal(f.scrolls(), 0); } finally { f.close(); } }
});
test('occlusion or mutations discovered after dispatch are uncertain rather than success', () => {
  for (const options of [{ occluded: true }, { mutateOnScroll: true }]) { const f = fixture(undefined, options); try { assert.equal(f.command('prepare', { quote }), 'prepared'); assert.equal(f.command('apply'), 'uncertain'); assert.equal(f.scrolls(), 1); } finally { f.close(); } }
});
test('small/control/normalization-needing quotes and bounded tree overflow refuse', () => {
  for (const literal of ['small', quote + '\n', 'Unique  synthetic']) { const f = fixture(); try { assert.equal(f.command('prepare', { quote: literal }), 'unsupported'); assert.equal(f.scrolls(), 0); } finally { f.close(); } }
  run(`<p id="target">${quote}</p>` + '<i></i>'.repeat(5001), 'unsupported');
});
test('JSON encoding treats executable-looking quotation solely as literal text', () => {
  const literal = 'Unique ");globalThis.injected=true;// synthetic quotation.';
  const f = fixture('<p id="target"></p>');
  try { f.w.document.querySelector('#target').textContent = literal; assert.equal(f.command('prepare', { quote: literal }), 'prepared'); assert.equal(f.command('apply'), 'found'); assert.equal(f.w.injected, undefined); } finally { f.close(); }
});
