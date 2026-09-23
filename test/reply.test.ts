import assert from 'node:assert/strict';
import test from 'node:test';

import { replyToText } from '../src/reply.js';

test('一次用户输入会得到确定的助手回复', () => {
  // 这个测试描述第 1 课的唯一业务需求：输入和输出都是普通文本。
  const result = replyToText('你好，NanoClaw');

  assert.equal(result, 'NanoClaw: 你好，NanoClaw');
});
