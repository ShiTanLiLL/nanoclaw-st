import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      { default: ['我叫小李'] },
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
      { default: ['我叫小李', '我刚才说了什么？'] },
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

/** 两个聊天交错进入同一个程序，重启后各自只回顾自己的上一句话。 */
test('不同聊天的历史互不混用，重启后仍分别恢复', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson5-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    const firstRun = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '[家人] @Andy 我叫小李\n[路人] 大家好\n[工作] @Andy 项目进度正常\n',
      encoding: 'utf8',
    });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.equal(firstRun.stdout, 'NanoClaw: 我叫小李\nNanoClaw: 项目进度正常\n');

    const secondRun = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '[家人] @Andy 我刚才说了什么？\n[工作] @Andy 我刚才说了什么？\n',
      encoding: 'utf8',
    });
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(
      secondRun.stdout,
      'NanoClaw: 你刚才说：我叫小李\nNanoClaw: 你刚才说：项目进度正常\n',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8')),
      {
        家人: ['我叫小李', '我刚才说了什么？'],
        工作: ['项目进度正常', '我刚才说了什么？'],
      },
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

/** 第 4 课留下的数组文件属于默认聊天，升级后仍应能读取。 */
test('旧版单数组文件会归入默认聊天', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson5-old-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    writeFileSync(path.join(workingDirectory, 'conversation.json'), '["我叫小李"]\n');
    const result = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '@Andy 我刚才说了什么？\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'NanoClaw: 你刚才说：我叫小李\n');
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8')),
      { default: ['我叫小李', '我刚才说了什么？'] },
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
