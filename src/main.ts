import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { loadHistories, saveHistories } from './history.js';
import { replyToText } from './reply.js';

/**
 * 把终端一行文字拆成聊天 ID 和实际消息；无 [聊天 ID] 前缀时沿用默认聊天。
 * 例如 "[家人] @Andy 你好" 会得到 chatId="家人"、text="@Andy 你好"。
 */
function parseChatLine(line: string): { chatId: string; text: string } {
  const markerEnd = line.indexOf('] ');
  if (line.startsWith('[') && markerEnd > 1) {
    return {
      chatId: line.slice(1, markerEnd),
      text: line.slice(markerEnd + 2),
    };
  }
  return { chatId: 'default', text: line };
}

/**
 * 在一个进程中逐行读取标准输入，调用 replyToText 并打印需要回复的结果。
 *
 * 启动时恢复各聊天历史；每行只交给对应聊天的数组处理，有回复时写回。
 */
export async function runCli(): Promise<void> {
  const historyFile = path.join(process.cwd(), 'conversation.json');
  const histories = await loadHistories(historyFile);
  const terminal = createInterface({ input: process.stdin });

  try {
    for await (const line of terminal) {
      const { chatId, text } = parseChatLine(line);
      const history = histories.get(chatId) ?? [];
      const reply = replyToText(text, history);
      if (reply !== null) {
        // 首条有效消息才创建该聊天的历史；普通消息不会产生空聊天。
        histories.set(chatId, history);
        await saveHistories(historyFile, histories);
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
