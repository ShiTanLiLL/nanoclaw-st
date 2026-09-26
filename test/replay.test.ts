import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 从现成文本文件接收多行消息，仍走原来的队列、聊天记忆和终端回复链。
 * 临时目录隔离输入文件与 conversation.json，避免影响真实会话。
 */
test('可以重放文本文件中的消息并输出回复', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson7-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    writeFileSync(
      path.join(workingDirectory, 'messages.txt'),
      '[家人] @Andy 我叫小李\n[工作] 大家好\n[家人] @Andy 我刚才说了什么？\n',
    );
    const result = spawnSync(process.execPath, [program, '--replay', 'messages.txt'], {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      'NanoClaw: 我叫小李\nNanoClaw: 你刚才说：我叫小李\n',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8')),
      { 家人: ['我叫小李', '我刚才说了什么？'] },
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
