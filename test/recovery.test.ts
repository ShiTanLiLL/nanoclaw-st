import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APIError } from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { initializeSchedule, retryTask, scheduleTask, sweepDueTasks } from '../src/scheduler.js';
import { recordReceipt } from '../src/receipt.js';
import { mailboxPaths } from '../src/mailbox.js';
import { retryTransient } from '../src/retry.js';
import { expandFileMessage } from '../src/file-message.js';

/** 不等待真实延迟：503有限退避、401不重试、持续失败只有三次调用。 */
test('临时模型错误有限重试，认证错误立即失败', async () => {
  const transient = new APIError(503, undefined, '临时错误', undefined);
  const denied = new APIError(401, undefined, '认证错误', undefined);
  let attempts = 0;
  const delays: number[] = [];
  const result = await retryTransient(async () => {
    attempts += 1;
    if (attempts < 3) throw transient;
    return '成功';
  }, async (ms) => { delays.push(ms); });
  assert.equal(result, '成功');
  assert.deepEqual(delays, [100, 200]);
  attempts = 0;
  await assert.rejects(retryTransient(async () => { attempts += 1; throw denied; }));
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryTransient(async () => { attempts += 1; throw transient; }, async () => {}));
  assert.equal(attempts, 3);
});

/** 固定时间验证持久化退避：有限次数、失败任务不阻塞另一任务、人工修复可恢复。 */
test('调度失败退避有上限，其他任务继续，手动重启仍使用同一轮次编号', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeSchedule(db);
    scheduleTask(db, '失败', '@Andy 提问', 1000);
    scheduleTask(db, '正常', '@Andy 提问', 1000);
    const identities: string[] = [];
    const transient = new APIError(503, undefined, '临时失败', undefined);
    const receive = async (chat: string, _text: string, id: string) => {
      if (chat === '失败') { identities.push(id); throw transient; }
    };
    assert.equal(await sweepDueTasks(db, receive, 1000), 1);
    assert.equal(await sweepDueTasks(db, receive, 1999), 0);
    assert.equal(await sweepDueTasks(db, receive, 2000), 0);
    assert.equal(await sweepDueTasks(db, receive, 3999), 0);
    assert.equal(await sweepDueTasks(db, receive, 4000), 0);
    assert.deepEqual(identities, ['task:1:1000', 'task:1:1000', 'task:1:1000']);
    assert.equal(db.prepare('SELECT status FROM scheduled_tasks WHERE id=1').get()!.status, 'failed');
    retryTask(db, 1);
    assert.equal(await sweepDueTasks(db, async (_chat, _text, id) => {
      assert.equal(id, 'task:1:1000');
    }, 4000), 1);
    assert.equal(db.prepare('SELECT status FROM scheduled_tasks WHERE id=1').get()!.status, 'done');
  } finally { db.close(); }
});

/** 多CLI进程共用临时目录；保持异步，让当前进程的SDK模拟服务能响应。 */
async function run(directory: string, env: NodeJS.ProcessEnv, args: string[], input = ''): Promise<string> {
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));
  const child = spawn(process.execPath, [program, ...args], {
    cwd: directory, env: { ...process.env, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const completed = once(child, 'close');
  child.stdin.end(input);
  assert.equal((await completed)[0], 0, stderr);
  return stdout;
}

/** 真实SDK模拟失败后修复：成功角色不重做，原信/记忆不重复，文件快照无需重读。 */
test('部分助手失败后跨进程恢复，不重做成功助手，文件正文可进入SDK', { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-recover-sdk-'));
  let teacherBroken = true;
  let andyAttempts = 0;
  const requests: Array<{ system: string; messages: Array<{ content: string }> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    const payload = JSON.parse(raw);
    requests.push(payload);
    response.setHeader('content-type', 'application/json');
    const fail = payload.system === '老师角色' && teacherBroken;
    const temporary = payload.system === '通用角色' && ++andyAttempts === 1;
    if (fail || temporary) {
      response.statusCode = fail ? 401 : 503;
      response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: '测试失败' } }));
    } else {
      response.end(JSON.stringify({
        id: 'recover-reply', type: 'message', role: 'assistant', model: 'test-model',
        content: [{ type: 'text', text: '模型回答' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const env = {
      AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_MODEL: 'test-model',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/anthropic`,
    };
    await run(directory, env, ['--wire', '课堂', 'Andy', 'mention', '@Andy', '通用角色']);
    await run(directory, env, ['--wire', '课堂', 'Teacher', 'pattern', '^@Andy', '老师角色']);
    await run(directory, env, ['--schedule', '课堂', '2000-01-01T00:00:00Z', 'once', '@Andy 原消息']);
    assert.equal(await run(directory, env, ['--sweep']), 'NanoClaw: 模型回答\n');
    assert.equal(requests.length, 3); // Andy503后成功两次；Teacher401只有一次。
    assert.match(await run(directory, env, ['--tasks']), /failed/);
    teacherBroken = false;
    // 绑定改变不应改变已接收凭据的角色快照。
    await run(directory, env, ['--wire', '课堂', 'Teacher', 'pattern', '^@Andy', '改变后的角色']);
    await run(directory, env, ['--retry-task', '1']);
    assert.equal(await run(directory, env, ['--sweep']), '[Teacher] NanoClaw: 模型回答\n');
    assert.equal(requests.length, 4);
    assert.equal(requests[3].system, '老师角色');
    assert.equal(requests[3].messages[0].content, '@Andy 原消息');
    assert.equal(await run(directory, env, ['--recover']), '');
    assert.equal(await run(directory, env, ['--sweep']), '');
    assert.equal(requests.length, 4);
    assert.equal(await run(directory, env, ['--search', '原消息']), '1 [课堂] 原消息\n');
    const central = new DatabaseSync(path.join(directory, 'conversation.db'));
    assert.equal(central.prepare('SELECT COUNT(*) AS n FROM session_messages').get()!.n, 2);
    assert.equal(central.prepare("SELECT COUNT(*) AS n FROM receipts WHERE status='done'").get()!.n, 1);
    // 故意让中央目标写入失败，验证事务不留下半份凭据或记忆。
    central.exec(`CREATE TEMP TRIGGER fail_target BEFORE INSERT ON receipt_targets
      WHEN NEW.receipt_id='broken' BEGIN SELECT RAISE(ABORT, '测试写入失败'); END`);
    assert.throws(() => recordReceipt(central, 'broken', '课堂', '@Andy 测试', [
      { agentId: 'Andy', body: '测试', systemPrompt: '通用角色' },
    ]));
    assert.equal(central.prepare("SELECT id FROM receipts WHERE id='broken'").get(), undefined);
    assert.equal(central.prepare('SELECT COUNT(*) AS n FROM session_messages').get()!.n, 2);
    // 模拟中央已经提交、邮箱尚未写：恢复必须仅凭中央快照继续交接。
    recordReceipt(central, 'gap-event', '交接', '@Andy 交接消息', [
      { agentId: 'Andy', body: '交接消息', systemPrompt: '交接角色' },
    ]);
    central.close();
    assert.equal(existsSync(mailboxPaths(directory, '交接').inbound), false);
    assert.equal(await run(directory, env, ['--recover']), 'NanoClaw: 模型回答\n');
    assert.equal(requests[4].messages[0].content, '交接消息');
    assert.equal(requests.length, 5);
    mkdirSync(path.join(directory, 'attachments'));
    writeFileSync(path.join(directory, 'attachments', '笔记.md'), '原始闭包笔记');
    await run(directory, env, ['--wire', '文件课堂', 'Teacher', 'mention', '@Teacher', '文件角色']);
    await run(directory, env, ['--receive'], '[文件课堂] @Teacher /file 笔记.md 请总结\n');
    writeFileSync(path.join(directory, 'attachments', '笔记.md'), '修改后的文件');
    assert.equal(await run(directory, env, ['--recover']), '[Teacher] NanoClaw: 模型回答\n');
    assert.match(requests[5].messages[0].content, /原始闭包笔记/);
    assert.ok(!requests[5].messages[0].content.includes('修改后的文件'));
    assert.equal(await run(directory, env, ['--recover']), '');
    assert.equal(requests.length, 6);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

/** 宿主读取附件快照；阻止目录越界、符号链接、非白名单后缀、过大和非法编码。 */
test('文件消息只读取附件目录中的小型UTF-8文本', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-safe-file-'));
  try {
    const root = path.join(directory, 'attachments');
    mkdirSync(root);
    writeFileSync(path.join(root, '笔记.md'), '闭包保留外层变量。');
    writeFileSync(path.join(directory, 'private.txt'), '私密文件');
    symlinkSync(path.join(directory, 'private.txt'), path.join(root, 'link.txt'));
    writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(16 * 1024 + 1));
    writeFileSync(path.join(root, 'invalid.txt'), Buffer.from([0xff]));
    assert.match(expandFileMessage(directory, '/file 笔记.md 请出一道题'), /请出一道题[\s\S]*笔记.md\n闭包保留外层变量/);
    assert.equal(expandFileMessage(directory, '普通正文'), '普通正文');
    for (const file of ['../private.txt', '/etc/passwd', 'link.txt', 'large.txt', 'invalid.txt', 'program.js']) {
      assert.throws(() => expandFileMessage(directory, `/file ${file}`));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
