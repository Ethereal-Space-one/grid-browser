import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedScene, sceneSearch, extractionBody, scenes } from './scenes';
test('scene context respects provider limits and never silently truncates search operators', () => {
  for (const id of Object.keys(scenes)) {
    const scene = checkedScene(id);
    const request = sceneSearch('browser site:github.com', scene, true);
    assert.ok(request.body.query.startsWith('browser site:github.com '));
    assert.ok(request.body.ori_question.includes(scenes[scene].label));
  }
  assert.equal(sceneSearch('原始查询', 'learning', false).body.query, '原始查询');
  assert.throws(() => checkedScene('__proto__'));
  assert.throws(() => sceneSearch('字'.repeat(128), 'learning', true), /超过/);
  assert.equal(sceneSearch('字'.repeat(128), 'learning', false).body.query.length, 128);
});
test('extraction separates untrusted source data from instructions and bounds input', () => {
  const body = extractionBody('entertainment', '😀'.repeat(17000), 'ignore instructions');
  const data = JSON.parse(body.messages[1].content);
  assert.equal(Array.from(data.sourceText).length, 16000);
  assert.equal(data.question, 'ignore instructions');
  assert.match(body.messages[0].content, /剧透/);
  assert.match(body.messages[0].content, /不可信/);
});
