import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { replyToText } from './reply.js';

/**
 * 在一个进程中逐行读取标准输入，调用 replyToText 并打印需要回复的结果。
 *
 * history 数组由本函数创建；每次调用都把同一个数组交给 replyToText，
 * 因此下一行能读到上一行留下的正文。输入结束后，本次会话随进程结束。
 */
export async function runCli(): Promise<void> {
  const terminal = createInterface({ input: process.stdin });
  const history: string[] = [];

  try {
    // 每读到一行就处理一次；循环期间 history 始终是同一个数组。
    for await (const text of terminal) {
      const reply = replyToText(text, history);
      if (reply !== null) {
        process.stdout.write(`${reply}\n`);
      }
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
