import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readRuntimeStatus } from '../src/runtime.js';

/** 跨进程使用实际CLI；同时收集业务stdout和运行stderr，不读取学生.env。 */
async function run(directory: string, environment: NodeJS.ProcessEnv, ...args: string[]) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/main.js', import.meta.url)), ...args], {
    cwd: directory, env: { ...process.env, LOG_LEVEL: 'off', ...environment },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const completed = once(child, 'close');
  child.stdin.end();
  const [status] = await completed;
  return { status, stdout, stderr };
}

/** 观察缺失/旧库不建表、不改字节；错误配置只报告无效，不输出密钥或URL。 */
test('status是只读观察，不建库、不迁移、不泄露配置和消息正文', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-status-'));
  const databasePath = path.join(directory, 'conversation.db');
  const environment = {
    AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'private-key', ANTHROPIC_MODEL: 'test-model',
    ANTHROPIC_BASE_URL: 'https://private-key@example.invalid', LOG_LEVEL: 'info',
  };
  try {
    const missing = await run(directory, environment, '--status');
    assert.equal(missing.status, 0, missing.stderr);
    assert.equal(JSON.parse(missing.stdout).databaseExists, false);
    assert.deepEqual(readdirSync(directory), []);
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO messages VALUES (1, 'private-body')");
    database.close();
    const before = readFileSync(databasePath);
    const existing = await run(directory, environment, '--status');
    assert.equal(existing.status, 0, existing.stderr);
    assert.equal(JSON.parse(existing.stdout).counts.messages, 1);
    assert.deepEqual(readFileSync(databasePath), before);
    assert.doesNotMatch(existing.stdout + existing.stderr, /private-key|private-body|example.invalid/);
    const invalid = readRuntimeStatus(databasePath, { AI_PROVIDER: 'anthropic', LOG_LEVEL: 'verbose' });
    assert.deepEqual(invalid.configuration, { provider: 'invalid', logging: 'invalid', valid: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/** 真SDK请求回环服务：未批准/暂停不请求；批准只处理一轮，日志不改变业务输出。 */
test('周期任务明确审批后才调用模型，暂停跨进程保存，日志不保存正文', { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-governance-'));
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* 消费请求，模拟服务不按模型措辞断言。 */ }
    requests += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      id: 'approved-reply', type: 'message', role: 'assistant', model: 'test-model',
      content: [{ type: 'text', text: '模型回答' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const environment = {
      AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'private-key', ANTHROPIC_MODEL: 'test-model', LOG_LEVEL: 'info',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    };
    const created = await run(directory, environment, '--schedule', '课堂', '2000-01-01T00:00:00Z', '3600000', '@Andy private-body');
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /等待 --approve-task/);
    const waiting = await run(directory, environment, '--sweep');
    assert.equal(waiting.status, 0, waiting.stderr);
    assert.equal(waiting.stdout, '');
    assert.equal(requests, 0);
    assert.equal(JSON.parse((await run(directory, environment, '--status')).stdout).tasks.awaiting_approval, 1);
    assert.notEqual((await run(directory, environment, '--pause-task', '1')).status, 0);
    assert.notEqual((await run(directory, environment, '--approve-task', '0')).status, 0);
    assert.equal((await run(directory, environment, '--approve-task', '1')).status, 0);
    const approved = await run(directory, environment, '--sweep');
    assert.equal(approved.status, 0, approved.stderr);
    assert.equal(approved.stdout, 'NanoClaw: 模型回答\n');
    assert.equal(requests, 1);
    const events = approved.stderr.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ['receipt.accepted', 'receipt.completed', 'task.completed']);
    assert.doesNotMatch(JSON.stringify(events), /private-key|private-body/);
    assert.equal((await run(directory, environment, '--pause-task', '1')).status, 0);
    // 把暂停任务的时间改成已到期，排除“只因时间未到而没请求”的假阳性。
    const database = new DatabaseSync(path.join(directory, 'conversation.db'));
    database.prepare('UPDATE scheduled_tasks SET next_run = 1000 WHERE id = 1').run();
    database.close();
    assert.equal((await run(directory, environment, '--sweep')).stdout, '');
    assert.equal(requests, 1);
    assert.equal(JSON.parse((await run(directory, environment, '--status')).stdout).tasks.paused, 1);
    assert.notEqual((await run(directory, environment, '--pause-task', '1')).status, 0);
    assert.equal((await run(directory, environment, '--approve-task', '1')).status, 0);
    assert.equal((await run(directory, environment, '--sweep')).status, 0);
    assert.equal(requests, 2);
    const snapshot = JSON.parse((await run(directory, environment, '--status')).stdout);
    assert.equal(snapshot.counts.messages, 2);
    assert.equal(snapshot.receipts.done, 2);
    const invalid = await run(directory, { ...environment, LOG_LEVEL: 'verbose' }, '--sweep');
    assert.notEqual(invalid.status, 0);
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
