import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runContainer } from '../src/container-runner.js';
import { enqueueInbound, mailboxPaths, processInbox } from '../src/mailbox.js';
import { DatabaseSync } from 'node:sqlite';

/** 用真实 Node 处理器代替 docker 命令，验证启动边界和邮箱链；不要求本机安装 Docker。 */
test('容器启动只挂载当前聊天的输入和输出，处理结果留在宿主邮箱', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-container-command-'));
  try {
    enqueueInbound(directory, '家人', '@Andy 我叫小李');
    enqueueInbound(directory, '工作', '@Andy 项目顺利');
    const paths = mailboxPaths(directory, '家人');
    const runner = fileURLToPath(new URL('../src/agent-runner.js', import.meta.url));
    await runContainer(directory, '家人', async (args) => {
      const mounts = args.filter((value) => value.startsWith('type=bind,'));
      assert.deepEqual(mounts, [
        `type=bind,src=${paths.inbound},dst=/input/inbound.db,readonly`,
        `type=bind,src=${paths.outputDirectory},dst=/output`,
      ]);
      assert.ok(args.includes('--rm'));
      assert.ok(args.includes('--read-only'));
      assert.ok(args.includes('--user'));
      assert.deepEqual(args.slice(-2), ['/input/inbound.db', '/output/outbound.db']);
      // 测试只替换启动工具，实际生成回复的仍是这节课的独立处理器入口。
      execFileSync(process.execPath, [runner, paths.inbound, paths.outbound]);
    });
    const outbound = new DatabaseSync(paths.outbound, { readOnly: true });
    try {
      assert.deepEqual(outbound.prepare('SELECT reply FROM replies').all().map((row) => row.reply),
        ['NanoClaw: 我叫小李']);
    } finally {
      outbound.close();
    }
    await assert.rejects(runContainer(directory, '家人', async () => {
      throw new Error('模拟 Docker 启动失败');
    }), /模拟 Docker 启动失败/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** 第 9 课已有的输出邮箱移动到独立目录后，消息 ID 保持不变，不重复生成。 */
test('已有输出邮箱迁移目录后保留回复和消息编号', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-container-layout-'));
  try {
    enqueueInbound(directory, '家人', '@Andy 你好');
    processInbox(directory, '家人');
    const paths = mailboxPaths(directory, '家人');
    renameSync(paths.outbound, path.join(paths.directory, 'outbound.db'));
    processInbox(directory, '家人');
    const outbound = new DatabaseSync(paths.outbound, { readOnly: true });
    try {
      const rows = outbound.prepare('SELECT id, inbound_id, reply FROM replies').all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, 1);
      assert.equal(rows[0].inbound_id, 1);
      assert.equal(rows[0].reply, 'NanoClaw: 你好');
    } finally {
      outbound.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
