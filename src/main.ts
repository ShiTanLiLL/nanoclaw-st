import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { replyToText } from './reply.js';

/**
 * 读取一次标准输入，调用 replyToText，并在需要回复时打印结果。
 *
 * 输入来自终端，replyToText 返回 string 或 null；null 表示普通聊天，
 * 此时不向标准输出写入助手回复。入口不负责判断触发词。
 */
export async function runCli(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const text = await terminal.question('你：');
    const reply = replyToText(text);
    if (reply !== null) {
      process.stdout.write(`${reply}\n`);
    }
  } finally {
    terminal.close();
  }
}

// 只有直接执行该文件时才启动 CLI；被测试导入时不会读取测试进程的 stdin。
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  await runCli();
}
