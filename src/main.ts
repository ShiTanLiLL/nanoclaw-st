import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { replyToText } from './reply.js';

/**
 * 读取一次标准输入，调用业务函数，并把回复打印到标准输出。
 *
 * 入口只负责 CLI 边界，不负责决定回复内容；这样业务函数可以被测试
 * 直接调用，也为以后替换输入渠道留下清晰的当前边界。
 */
export async function runCli(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const text = await terminal.question('你：');
    process.stdout.write(`${replyToText(text)}\n`);
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
