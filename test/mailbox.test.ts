import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.AI_PROVIDER = 'local'; // 只验证邮箱链，不继承终端中的真实模型选择。

/** 在同一个临时工作目录执行一次 CLI，保留文件供下一个进程继续使用。 */
function run(program: string, directory: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [program, ...args], {
    cwd: directory,
    input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/** 宿主与处理器可以先后在不同进程运行；确认后重复轮询不能重复输出。 */
test('两个聊天的输入与输出邮箱独立，重复处理和投递不会重发', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson9-'));
  const program = fileURLToPath(new URL('../src/main.js', import.meta.url));

  try {
    assert.equal(
      run(program, directory, ['--receive'], '[家人] @Andy 我叫小李\n[家人] @Andy 我刚才说了什么？\n[工作] @Andy 项目顺利\n'),
      '',
    );
    assert.equal(run(program, directory, ['--deliver', '家人']), '');

    assert.equal(run(program, directory, ['--process', '家人']), '');
    assert.equal(run(program, directory, ['--process', '家人']), '');
    assert.equal(
      run(program, directory, ['--deliver', '家人']),
      'NanoClaw: 我叫小李\nNanoClaw: 你刚才说：我叫小李\n',
    );
    assert.equal(run(program, directory, ['--deliver', '家人']), '');

    assert.equal(run(program, directory, ['--process', '工作']), '');
    assert.equal(run(program, directory, ['--deliver', '工作']), 'NanoClaw: 项目顺利\n');
    assert.equal(run(program, directory, ['--deliver', '工作']), '');
    assert.equal(run(program, directory, ['--search', '项目']), '3 [工作] 项目顺利\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
