import assert from 'node:assert/strict';
import test from 'node:test';

import { replyToText } from '../src/reply.js';

test('以 @Andy 开头的消息会触发回复，并去掉触发词', () => {
  // 助手只处理触发词后面的正文。
  const result = replyToText('@Andy 你好，NanoClaw', []);

  assert.equal(result, 'NanoClaw: 你好，NanoClaw');
});

test('没有呼叫助手的普通消息不会得到回复', () => {
  // 普通聊天既不产生回复，也不进入助手的会话历史。
  const history: string[] = [];
  const result = replyToText('大家下午三点开会', history);

  assert.equal(result, null);
  assert.deepEqual(history, []);
});

test('同一会话的第二轮能回顾第一轮用户说过的话', () => {
  // 两次调用共用一个数组；第一个调用写入，第二个调用读取。
  const history: string[] = [];
  const firstReply = replyToText('@Andy 我叫小李', history);
  const secondReply = replyToText('@Andy 我刚才说了什么？', history);

  assert.equal(firstReply, 'NanoClaw: 我叫小李');
  assert.equal(secondReply, 'NanoClaw: 你刚才说：我叫小李');
  assert.deepEqual(history, ['我叫小李', '我刚才说了什么？']);
});

test('新会话没有上一句可回顾', () => {
  // 新数组代表新会话，不能读到其它会话的历史。
  const history: string[] = [];
  const reply = replyToText('@Andy 我刚才说了什么？', history);

  assert.equal(reply, 'NanoClaw: 这是本次对话的第一句话。');
});
