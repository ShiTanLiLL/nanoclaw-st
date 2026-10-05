import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeTaskState, initializeSchedule, scheduleTask, sweepDueTasks } from '../src/scheduler.js';

/** 用显式时间代替真实等待，验证未到期、一次完成、周期跳过漏跑和失败不确认。 */
test('任务到期才执行，一次任务完成，周期任务推进且正常重复扫描不重发', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeSchedule(db);
    scheduleTask(db, '课堂', '@Andy 一次提醒', 1000);
    const recurring = scheduleTask(db, '课堂', '@Teacher 周期问题', 1000, 1000);
    changeTaskState(db, recurring, 'approve'); // 第15课起，新周期任务须所有者明确审批。
    const received: string[] = [];
    const receive = async (chat: string, text: string) => { received.push(`${chat}:${text}`); };
    assert.equal(await sweepDueTasks(db, receive, 999), 0);
    assert.equal(await sweepDueTasks(db, receive, 1000), 2);
    assert.equal(await sweepDueTasks(db, receive, 1000), 0);
    assert.equal(await sweepDueTasks(db, receive, 4500), 1);
    assert.deepEqual(received, ['课堂:@Andy 一次提醒', '课堂:@Teacher 周期问题', '课堂:@Teacher 周期问题']);
    const rows = db.prepare('SELECT status, next_run FROM scheduled_tasks ORDER BY id').all();
    assert.equal(rows[0].status, 'done');
    assert.equal(rows[1].next_run, 5000);
    assert.equal(await sweepDueTasks(db, async () => { throw new Error('生成失败'); }, 5000), 0);
    assert.equal(db.prepare('SELECT next_run FROM scheduled_tasks WHERE id = 2').get()!.next_run, 5000);
    assert.equal(db.prepare('SELECT status FROM scheduled_tasks WHERE id = 2').get()!.status, 'failed');
    assert.throws(() => scheduleTask(db, '', '消息', 1000));
    assert.throws(() => scheduleTask(db, '课堂', '消息', NaN));
    assert.throws(() => scheduleTask(db, '课堂', '消息', 1000, 0));
  } finally { db.close(); }
});

/** 真正启动CLI，测试进程保持异步，以便模拟模型服务响应真实SDK请求。 */
async function run(directory: string, environment: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));
  const child = spawn(process.execPath, [program, ...args], {
    cwd: directory, env: { ...process.env, ...environment },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const completed = once(child, 'close');
  child.stdin.end();
  const [status] = await completed;
  assert.equal(status, 0, stderr);
  return stdout;
}

/** 跨进程登记与扫描走同一SDK链；验证多助手、记忆、搜索和重复扫描无额外请求。 */
test('定时任务重启后仍存在，到期经路由与SDK生成，各助手记忆隔离', { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-schedule-'));
  const requests: Array<{ system: string; messages: Array<{ content: string }> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    requests.push(JSON.parse(raw));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      id: 'scheduled-reply', type: 'message', role: 'assistant', model: 'test-model',
      content: [{ type: 'text', text: '定时回答' }],
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
    await run(directory, environment, '--wire', '课堂', 'Andy', 'mention', '@Andy', '通用角色');
    await run(directory, environment, '--wire', '课堂', 'Teacher', 'pattern', '^@(Teacher|Andy)', '老师角色');
    await run(directory, environment, '--schedule', '课堂', '2000-01-01T00:00:00Z', 'once', '@Teacher 香蕉');
    await run(directory, environment, '--schedule', '课堂', '2000-01-02T00:00:00Z', 'once', '@Andy 闭包');
    await run(directory, environment, '--schedule', '课堂', '2099-01-01T00:00:00Z', 'once', '@Andy 未来');
    assert.equal(requests.length, 0); // 仅登记不生成。
    assert.equal(await run(directory, environment, '--sweep'),
      '[Teacher] NanoClaw: 定时回答\nNanoClaw: 定时回答\n[Teacher] NanoClaw: 定时回答\n');
    assert.equal(requests.length, 3);
    assert.equal(requests[1].messages[0].content, '闭包');
    assert.equal(requests[2].system, '老师角色');
    assert.equal(requests[2].messages[0].content, '上一条用户消息：@Teacher 香蕉\n当前用户消息：@Andy 闭包');
    assert.equal(await run(directory, environment, '--sweep'), '');
    assert.equal(requests.length, 3);
    const tasks = await run(directory, environment, '--tasks');
    assert.match(tasks, /1 \[课堂\] done/);
    assert.match(tasks, /3 \[课堂\] pending/);
    assert.equal(await run(directory, environment, '--search', '闭包'), '2 [课堂] 闭包\n');
    // 真实watch入口完成一轮后，模拟用户Ctrl+C，确认正常退出且一次任务已确认。
    await run(directory, environment, '--schedule', '课堂', '2000-01-03T00:00:00Z', 'once', '@Teacher 新练习');
    const program = fileURLToPath(new URL('../src/main.js', import.meta.url));
    const watcher = spawn(process.execPath, [program, '--watch'], {
      cwd: directory, env: { ...process.env, ...environment },
    });
    const stopped = once(watcher, 'close');
    watcher.stdin.end();
    try {
      await once(watcher.stdout, 'data');
      watcher.kill('SIGINT');
      assert.equal((await stopped)[0], 0);
    } finally {
      if (watcher.exitCode === null) watcher.kill('SIGTERM');
    }
    assert.equal(requests.length, 4);
    assert.match(await run(directory, environment, '--tasks'), /4 \[课堂\] done/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
