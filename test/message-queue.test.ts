import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageQueue } from '../src/message-queue.js';

/**
 * 用一个由测试控制结束时间的慢任务，观察第二条消息在第一条处理时已入队。
 * 放行后检查处理顺序与 pending → processing → completed 状态变化。
 */
test('慢任务处理期间仍能接收下一条消息，并按顺序完成', async () => {
  let finishFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const processed: string[] = [];
  const queue = createMessageQueue(async (line) => {
    processed.push(line);
    if (line === '第一条') {
      await firstCanFinish;
    }
  });

  const first = queue.enqueue('第一条');
  const second = queue.enqueue('第二条');

  assert.equal(first.status, 'processing');
  assert.equal(second.status, 'pending');
  assert.deepEqual(processed, ['第一条']);

  finishFirst();
  await queue.whenIdle();

  assert.deepEqual(processed, ['第一条', '第二条']);
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
});
