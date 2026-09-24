import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 在临时目录里先后启动两个 CLI 进程，验证第二次运行能读到第一次保存的历史。
 * 临时目录隔离了真实工作区的 conversation.json，测试结束后会清理。
 */
test('重启程序后仍能回顾上一轮对话', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson4-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    const firstRun = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '@Andy 我叫小李\n大家下午三点开会\n',
      encoding: 'utf8',
    });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.equal(firstRun.stdout, 'NanoClaw: 我叫小李\n');
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8')),
      ['我叫小李'],
    );

    const secondRun = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '@Andy 我刚才说了什么？\n',
      encoding: 'utf8',
    });
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(secondRun.stdout, 'NanoClaw: 你刚才说：我叫小李\n');
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8')),
      ['我叫小李', '我刚才说了什么？'],
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
