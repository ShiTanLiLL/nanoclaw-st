import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';

import { loadHistories, saveHistories } from './history.js';
import { createMessageQueue } from './message-queue.js';
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

/** 把业务回复送到当前本地终端；这里不决定消息从哪里来。 */
function sendConsoleReply(reply: string): void {
  process.stdout.write(`${reply}\n`);
}

/**
 * 处理任一来源提供的逐行消息：入队、按聊天选择历史、生成回复并保存。
 * lines 可以由终端陆续提供，也可以是从文本文件拆出的现成数组。
 */
async function processMessages(
  lines: AsyncIterable<string> | Iterable<string>,
  historyFile: string,
  histories: Map<string, string[]>,
): Promise<void> {
  const queue = createMessageQueue(async (line) => {
    const { chatId, text } = parseChatLine(line);
    const history = histories.get(chatId) ?? [];
    const reply = replyToText(text, history);
    if (reply !== null) {
      // 首条有效消息才创建该聊天的历史；普通消息不会产生空聊天。
      histories.set(chatId, history);
      await saveHistories(historyFile, histories);
      sendConsoleReply(reply);
    }
  });

  try {
    for await (const line of lines) {
      queue.enqueue(line);
    }
  } finally {
    // 输入结束时仍可能有待办消息；等它们全部处理完再退出。
    await queue.whenIdle();
  }
}

/** 实时入口：标准输入每来一行就交给共同的处理链。 */
export async function runCli(): Promise<void> {
  const historyFile = path.join(process.cwd(), 'conversation.json');
  const histories = await loadHistories(historyFile);
  const terminal = createInterface({ input: process.stdin });
  try {
    await processMessages(terminal, historyFile, histories);
  } finally {
    terminal.close();
  }
}

/** 文件入口：读完现成文本，按行交给与实时入口相同的处理链。 */
export async function runReplay(filePath: string): Promise<void> {
  const contents = await readFile(filePath, 'utf8');
  const historyFile = path.join(process.cwd(), 'conversation.json');
  const histories = await loadHistories(historyFile);
  await processMessages(contents.split(/\r?\n/), historyFile, histories);
}

// 只有直接执行该文件时才启动 CLI；被测试导入时不会读取测试进程的 stdin。
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  if (process.argv.length === 4 && process.argv[2] === '--replay') {
    await runReplay(process.argv[3]);
  } else if (process.argv.length === 2) {
    await runCli();
  } else {
    throw new Error('用法：node dist/src/main.js [--replay 消息文件路径]');
  }
}
