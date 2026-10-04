import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.AI_PROVIDER = 'local'; // 搜索测试的写入阶段使用确定性回复。

/**
 * 两个聊天写入同一数据库后，可以跨聊天按正文查询，并看到稳定的消息 ID。
 * 使用真实 CLI 进程检查写入、重启和搜索的完整链条。
 */
test('可以按关键词查询不同聊天的消息', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson8-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    const write = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '[家人] @Andy 今天项目顺利\n[工作] @Andy 项目进度正常\n',
      encoding: 'utf8',
    });
    assert.equal(write.status, 0, write.stderr);

    const search = spawnSync(process.execPath, [program, '--search', '项目'], {
      cwd: workingDirectory,
      encoding: 'utf8',
    });
    assert.equal(search.status, 0, search.stderr);
    assert.equal(search.stdout, '1 [家人] 今天项目顺利\n2 [工作] 项目进度正常\n');
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
