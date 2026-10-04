import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getSession, initializeRouting, lastSessionMessage, routeMessage, wireAgent } from '../src/router.js';

/** 只验证路由，不生成local回复；空匹配、单目标和扇出都在一条需求测试中呈现。 */
test('绑定按聊天匹配，mention去前缀、pattern保留原文，一条消息可扇出', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id TEXT, body TEXT); INSERT INTO messages VALUES (1, '旧聊天', '旧记忆')");
    initializeRouting(database);
    assert.equal(lastSessionMessage(database, getSession(database, '旧聊天', 'Andy').id), '旧记忆');
    initializeRouting(database);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM session_messages').get()!.n, 1);
    wireAgent(database, '课堂', 'Andy', 'mention', '@Andy', '通用助手');
    wireAgent(database, '课堂', 'Teacher', 'pattern', '^@(Teacher|Andy)', '老师');
    assert.deepEqual(routeMessage(database, '课堂', '普通消息'), []);
    assert.deepEqual(routeMessage(database, '课堂', '@Teacher 解释闭包').map((route) => route.agentId), ['Teacher']);
    assert.deepEqual(routeMessage(database, '课堂', '@Andy 解释闭包').map((route) => [route.agentId, route.body]), [
      ['Andy', '解释闭包'], ['Teacher', '@Andy 解释闭包'],
    ]);
    assert.deepEqual(routeMessage(database, '其他聊天', '@Teacher 解释闭包'), []);
    assert.equal(routeMessage(database, '其他聊天', '@Andy 你好')[0].agentId, 'Andy');
    assert.throws(() => wireAgent(database, '课堂', 'Teacher', 'pattern', '[', '老师'));
    assert.equal(routeMessage(database, '课堂', '@Teacher 你好').length, 1);
  } finally {
    database.close();
  }
});

/** 异步启动真正CLI，使测试进程的HTTP服务可以同时响应SDK；凭据全部是假值。 */
async function run(directory: string, args: string[], environment: NodeJS.ProcessEnv, input = ''): Promise<string> {
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));
  const child = spawn(process.execPath, [program, ...args], { cwd: directory, env: { ...process.env, ...environment } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const completed = once(child, 'close');
  child.stdin.end(input);
  const [status] = await completed;
  assert.equal(status, 0, stderr);
  return stdout;
}

/** 真实SDK连模拟服务：跨进程配置→扇出→各自上下文和角色→确认，云端体验另行验收。 */
test('同聊天两个助手分别携带角色与上一句，重启后记忆隔离且重复处理不请求模型', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson12-'));
  const requests: Array<{ system: string; messages: Array<{ content: string }> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    const payload = JSON.parse(raw);
    requests.push(payload);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      id: `reply-${requests.length}`, type: 'message', role: 'assistant', model: 'test-model',
      content: [{ type: 'text', text: payload.system === '老师角色' ? '老师回答' : '通用回答' }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const environment = {
      AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_MODEL: 'test-model',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/anthropic`,
    };
    await run(directory, ['--wire', '课堂', 'Andy', 'mention', '@Andy', '通用角色'], environment);
    await run(directory, ['--wire', '课堂', 'Teacher', 'pattern', '^@(Teacher|Andy)', '老师角色'], environment);
    assert.equal(await run(directory, [], environment, '[课堂] @Teacher 只有老师知道：香蕉\n'), '[Teacher] NanoClaw: 老师回答\n');
    assert.equal(await run(directory, [], environment, '[课堂] @Andy 我叫小李\n[别处] @Teacher 忽略\n普通闲聊\n'),
      'NanoClaw: 通用回答\n[Teacher] NanoClaw: 老师回答\n');
    assert.equal(requests[1].messages[0].content, '我叫小李'); // Andy不知道老师之前收到的香蕉。
    assert.equal(requests[2].messages[0].content, '上一条用户消息：@Teacher 只有老师知道：香蕉\n当前用户消息：@Andy 我叫小李');
    await run(directory, ['--receive'], environment, '[课堂] @Andy 我刚才说了什么？\n');
    await run(directory, ['--process', '课堂'], environment);
    await run(directory, ['--process', '课堂', 'Teacher'], environment);
    assert.equal(requests[3].system, '通用角色');
    assert.equal(requests[3].messages[0].content, '上一条用户消息：我叫小李\n当前用户消息：我刚才说了什么？');
    assert.equal(requests[4].system, '老师角色');
    assert.equal(requests[4].messages[0].content, '上一条用户消息：@Andy 我叫小李\n当前用户消息：@Andy 我刚才说了什么？');
    assert.equal(await run(directory, ['--deliver', '课堂'], environment), 'NanoClaw: 通用回答\n');
    assert.equal(await run(directory, ['--deliver', '课堂', 'Teacher'], environment), '[Teacher] NanoClaw: 老师回答\n');
    await run(directory, ['--process', '课堂', 'Teacher'], environment);
    assert.equal(await run(directory, ['--deliver', '课堂', 'Teacher'], environment), '');
    assert.equal(requests.length, 5);
    assert.equal(await run(directory, ['--search', '小李'], environment), '2 [课堂] 我叫小李\n');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
