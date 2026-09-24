import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { loadHistory, saveHistory } from './history.js';
import { replyToText } from './reply.js';

/**
 * 在一个进程中逐行读取标准输入，调用 replyToText 并打印需要回复的结果。
 *
 * 启动时从当前工作目录的 JSON 文件恢复 history；每条被处理的消息之后写回。
 * 同一进程中始终把同一个数组交给 replyToText。
 */
export async function runCli(): Promise<void> {
  const historyFile = path.join(process.cwd(), 'conversation.json');
  const history = await loadHistory(historyFile);
  const terminal = createInterface({ input: process.stdin });

  try {
    // 每读到一行就处理一次；循环期间 history 始终是同一个数组。
    for await (const text of terminal) {
      const reply = replyToText(text, history);
      if (reply !== null) {
        await saveHistory(historyFile, history);
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
