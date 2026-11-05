export type Intent = { kind: 'url'; url: string } | { kind: 'query'; query: string };

export function classifyInput(raw: string): Intent {
  const input = raw.trim();
  if (!input) throw new Error('请输入网址或查询');
  if (/^https?:\/\//i.test(input)) return { kind: 'url', url: checkedUrl(input) };
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(input) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(input)) {
    return { kind: 'url', url: checkedUrl(`http://${input}`) };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) throw new Error('当前原型不支持这个网址协议');
  if (/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[:/]\S*)?$/u.test(input)) {
    return { kind: 'url', url: checkedUrl(`https://${input}`) };
  }
  return { kind: 'query', query: input };
}

export function checkedUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('网址格式无效');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('网址格式无效'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('当前原型只打开 HTTPS 或本机测试站点');
  }
  if (url.username || url.password) throw new Error('网址不能包含账号或密码');
  return url.href;
}
