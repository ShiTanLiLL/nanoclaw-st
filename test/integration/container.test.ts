import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { containerArguments, CONTAINER_IMAGE } from '../../src/container-runner.js';

/** 实际容器往返与权限验证；单独用 pnpm test:container 执行，需要 Docker 和已构建镜像。 */
test('真实容器只读输入、写回输出，宿主可投递且重复处理不重发', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-real-container-'));
  const program = fileURLToPath(new URL('../../src/main.js', import.meta.url));
  try {
    execFileSync(process.execPath, [program, '--receive'], {
      cwd: directory,
      input: '[家人] @Andy 我叫小李\n[家人] @Andy 我刚才说了什么？\n[工作] @Andy 工作私密消息\n',
    });

    // 使用与启动器完全相同的挂载，临时把入口换成 Node 检查代码。
    const args = containerArguments(directory, '家人');
    const probe = `
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      assert.throws(() => fs.writeFileSync('/input/inbound.db', 'cannot overwrite'));
      assert.equal(fs.existsSync('/app/conversation.db'), false);
      assert.deepEqual(fs.readdirSync('/input'), ['inbound.db']);
      fs.writeFileSync('/output/mount-probe.txt', 'output is writable');
    `;
    execFileSync('docker', [
      ...args.slice(0, -3), '--entrypoint', 'node', CONTAINER_IMAGE, '-e', probe,
    ], { timeout: 120_000 });

    execFileSync(process.execPath, [program, '--process-container', '家人'], {
      cwd: directory, timeout: 120_000,
    });
    const reply = execFileSync(process.execPath, [program, '--deliver', '家人'], {
      cwd: directory, encoding: 'utf8',
    });
    assert.equal(reply, 'NanoClaw: 我叫小李\nNanoClaw: 你刚才说：我叫小李\n');
    execFileSync(process.execPath, [program, '--process-container', '家人'], {
      cwd: directory, timeout: 120_000,
    });
    assert.equal(execFileSync(process.execPath, [program, '--deliver', '家人'], {
      cwd: directory, encoding: 'utf8',
    }), '');
    assert.equal(execFileSync(process.execPath, [program, '--deliver', '工作'], {
      cwd: directory, encoding: 'utf8',
    }), '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
