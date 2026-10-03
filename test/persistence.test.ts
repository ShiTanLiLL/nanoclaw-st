import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** 从新的 SQLite 数据库查询用户正文，返回 CLI 呈现的 ID、聊天和正文。 */
function searchSavedMessages(program: string, directory: string, keyword: string): string {
  const result = spawnSync(process.execPath, [program, '--search', keyword], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/**
 * 在临时目录里先后启动两个 CLI 进程，验证第二次运行能读到第一次保存的历史。
 * 临时目录隔离了真实工作区的 conversation.db，测试结束后会清理。
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
    assert.equal(searchSavedMessages(program, workingDirectory, '我叫'), '1 [default] 我叫小李\n');

    const secondRun = spawnSync(process.execPath, [program], {
      cwd: workingDirectory,
      input: '@Andy 我刚才说了什么？\n',
      encoding: 'utf8',
    });
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(secondRun.stdout, 'NanoClaw: 你刚才说：我叫小李\n');
    assert.equal(
      searchSavedMessages(program, workingDirectory, '我刚才说了什么？'),
      '2 [default] 我刚才说了什么？\n',
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
    assert.equal(
      searchSavedMessages(program, workingDirectory, '我刚才说了什么？'),
      '3 [家人] 我刚才说了什么？\n4 [工作] 我刚才说了什么？\n',
    );
    assert.equal(searchSavedMessages(program, workingDirectory, '大家好'), '');
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

/** 旧 JSON 数组只导入一次，并归入默认聊天；原文件保持不变。 */
test('旧版单数组文件会迁移到 SQLite 的默认聊天', () => {
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
    assert.equal(
      searchSavedMessages(program, workingDirectory, '我'),
      '1 [default] 我叫小李\n2 [default] 我刚才说了什么？\n',
    );
    assert.equal(readFileSync(path.join(workingDirectory, 'conversation.json'), 'utf8'), '["我叫小李"]\n');
    assert.equal(
      searchSavedMessages(program, workingDirectory, '我'),
      '1 [default] 我叫小李\n2 [default] 我刚才说了什么？\n',
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

/** 第 5～7 课按聊天分组的 JSON 也应完整导入，且第二次打开不重复导入。 */
test('旧版分组 JSON 会按聊天导入 SQLite', () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson8-migration-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    writeFileSync(
      path.join(workingDirectory, 'conversation.json'),
      JSON.stringify({ 家人: ['我叫小李'], 工作: ['项目进度正常'] }),
    );

    const firstSearch = searchSavedMessages(program, workingDirectory, '我叫');
    assert.equal(firstSearch, '1 [家人] 我叫小李\n');
    assert.equal(
      searchSavedMessages(program, workingDirectory, '项目'),
      '2 [工作] 项目进度正常\n',
    );
    assert.equal(searchSavedMessages(program, workingDirectory, '我叫'), firstSearch);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
