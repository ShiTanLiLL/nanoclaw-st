import assert from 'node:assert/strict';
import test from 'node:test';

import { replyToText } from '../src/reply.js';

test('以 @Andy 开头的消息会触发回复，并去掉触发词', () => {
  // 助手只处理触发词后面的正文。
  const result = replyToText('@Andy 你好，NanoClaw');

  assert.equal(result, 'NanoClaw: 你好，NanoClaw');
});

test('没有呼叫助手的普通消息不会得到回复', () => {
  // null 表示本次输入不应该产生任何助手回复。
  const result = replyToText('大家下午三点开会');

  assert.equal(result, null);
});
