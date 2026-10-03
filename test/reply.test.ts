import assert from 'node:assert/strict';
import test from 'node:test';

import { replyToText } from '../src/reply.js';

test('以 @Andy 开头的消息会触发回复，并去掉触发词', () => {
  // 回复函数交回要保存的用户正文和要输出的助手回复，不直接写数据库。
  const result = replyToText('@Andy 你好，NanoClaw');

  assert.deepEqual(result, {
    body: '你好，NanoClaw',
    reply: 'NanoClaw: 你好，NanoClaw',
  });
});

test('没有呼叫助手的普通消息不会得到回复', () => {
  // 普通聊天没有需要保存的正文，也没有助手回复。
  const result = replyToText('大家下午三点开会');

  assert.equal(result, null);
});

test('同一会话的第二轮能回顾第一轮用户说过的话', () => {
  // 上一句从数据库查询后传入；这里只验证业务函数如何使用它。
  const first = replyToText('@Andy 我叫小李');
  const second = replyToText('@Andy 我刚才说了什么？', first?.body);

  assert.equal(first?.reply, 'NanoClaw: 我叫小李');
  assert.equal(second?.reply, 'NanoClaw: 你刚才说：我叫小李');
  assert.equal(second?.body, '我刚才说了什么？');
});

test('新会话没有上一句可回顾', () => {
  // 数据库找不到该聊天上一句时，传入 undefined。
  const result = replyToText('@Andy 我刚才说了什么？');

  assert.equal(result?.reply, 'NanoClaw: 这是本次对话的第一句话。');
});
