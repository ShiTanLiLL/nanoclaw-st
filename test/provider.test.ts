import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { containerArguments } from '../src/container-runner.js';
import { enqueueInbound, mailboxPaths } from '../src/mailbox.js';
import { processMailbox } from '../src/processor.js';
import { createProvider, providerSettings } from '../src/provider.js';

/** 本地模式无需凭据；真实模式必须有配置，密钥值不会进入 Docker 参数数组。 */
test('选择回复方式并验证真实模型配置与容器凭据传递', async () => {
  const local = createProvider({});
  assert.equal(await local('我刚才说了什么？', '我叫小李'), 'NanoClaw: 你刚才说：我叫小李');
  assert.throws(() => createProvider({ AI_PROVIDER: 'unknown' }), /AI_PROVIDER/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'anthropic' }), /ANTHROPIC_API_KEY/);
  assert.throws(() => createProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only' }), /ANTHROPIC_MODEL/);

  const args = containerArguments(tmpdir(), '家人', {
    AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only-secret', ANTHROPIC_MODEL: 'test-model',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
  });
  assert.ok(args.includes('bridge'));
  assert.ok(args.includes('ANTHROPIC_API_KEY'));
  assert.ok(args.includes('ANTHROPIC_MODEL'));
  assert.ok(args.includes('ANTHROPIC_BASE_URL'));
  assert.ok(!args.some((arg) => arg.includes('test-only-secret')));
  assert.equal(providerSettings({
    AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_MODEL: 'test-model',
  }).name, 'anthropic');
});

/** 真实 SDK 请求本地 HTTP 服务，验证上下文、响应转换、处理确认和失败不写回复。 */
test('SDK回复通过邮箱保存，重复处理不请求API，API失败保持待办', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nanoclaw-lesson11-'));
  const requests: Array<{ url?: string; key?: string | string[]; payload: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk.toString();
    requests.push({ url: request.url, key: request.headers['x-api-key'], payload: JSON.parse(raw) });
    response.setHeader('content-type', 'application/json');
    if (requests.length >= 3) {
      response.statusCode = 503;
      response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: '模拟服务失败' } }));
      return;
    }
    response.end(JSON.stringify({
      id: `msg-test-${requests.length}`, type: 'message', role: 'assistant', model: 'test-model',
      content: [
        { type: 'text', text: requests.length === 1 ? '你好，小李。' : '你刚才说你叫小李。' },
        { type: 'text', text: '还需要什么帮助？' },
      ],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const provider = createProvider({
      AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-only-key', ANTHROPIC_MODEL: 'test-model',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
    });
    enqueueInbound(directory, '家人', '@Andy 我叫小李');
    enqueueInbound(directory, '家人', '@Andy 我刚才说了什么？', '我叫小李');
    const paths = mailboxPaths(directory, '家人');
    await processMailbox(paths.inbound, paths.outbound, provider);
    await processMailbox(paths.inbound, paths.outbound, provider);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/anthropic/v1/messages');
    assert.equal(requests[0].key, 'test-only-key');
    assert.equal(requests[0].payload.model, 'test-model');
    assert.deepEqual(requests[0].payload.thinking, { type: 'disabled' });
    assert.deepEqual(requests[0].payload.messages, [{ role: 'user', content: '我叫小李' }]);
    assert.deepEqual(requests[1].payload.messages, [{
      role: 'user', content: '上一条用户消息：我叫小李\n当前用户消息：我刚才说了什么？',
    }]);

    enqueueInbound(directory, '家人', '@Andy 服务失败', '我刚才说了什么？');
    await assert.rejects(processMailbox(paths.inbound, paths.outbound, provider), /模拟服务失败/);
    assert.equal(requests.length, 5); // 第三条输入503持续失败：最多三次请求。
    const outbound = new DatabaseSync(paths.outbound, { readOnly: true });
    try {
      assert.deepEqual(outbound.prepare('SELECT reply FROM replies ORDER BY id').all().map((row) => row.reply), [
        'NanoClaw: 你好，小李。\n还需要什么帮助？',
        'NanoClaw: 你刚才说你叫小李。\n还需要什么帮助？',
      ]);
    } finally {
      outbound.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
