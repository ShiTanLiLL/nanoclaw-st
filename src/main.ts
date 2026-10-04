import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { createMessageQueue } from './message-queue.js';
import { runContainer } from './container-runner.js';
import { deliverReplies, enqueueInbound, processInbox } from './mailbox.js';
import { scheduleTask, sweepDueTasks } from './scheduler.js';
import {
  appendSessionMessage, getSession, lastSessionMessage, routeMessage, wireAgent,
} from './router.js';
import {
  appendUserMessage,
  openConversationDatabase,
  searchMessages,
} from './store.js';

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

/** 打开当前工作目录的数据库，并在首次创建时导入旧 JSON 历史。 */
async function openCurrentDatabase(): Promise<DatabaseSync> {
  const directory = process.cwd();
  return openConversationDatabase(
    path.join(directory, 'conversation.db'),
    path.join(directory, 'conversation.json'),
  );
}

/** 宿主共同消息链：终端、文件与定时任务都在此路由、留信、更新记忆和投递。 */
async function handleMessage(
  database: DatabaseSync, chatId: string, text: string, autoProcess: boolean,
): Promise<boolean> {
  const routes = routeMessage(database, chatId, text);
  if (routes.length === 0) return false;
  // 先给所有目标留信；同一聊天的不同助手读取各自的上一句。
  const sessions = routes.map((route) => {
    const session = getSession(database, chatId, route.agentId);
    const previousMessage = lastSessionMessage(database, session.id);
    enqueueInbound(process.cwd(), session.mailboxKey, text, previousMessage, route);
    appendSessionMessage(database, session.id, route.body);
    return session;
  });
  // 搜索仍按聊天记录，一条输入不会因为命中两位助手而重复保存。
  appendUserMessage(database, chatId, routes[0].body);
  if (autoProcess) {
    for (const session of sessions) {
      await processInbox(process.cwd(), session.mailboxKey);
      const prefix = session.agentId === 'Andy' ? '' : `[${session.agentId}] `;
      deliverReplies(process.cwd(), session.mailboxKey, database, prefix);
    }
  }
  return true;
}

/**
 * 宿主处理逐行消息：保留输入队列，再调用共同消息链。
 * lines 可以由终端陆续提供，也可以是从文本文件拆出的现成数组。
 */
async function processMessages(
  lines: AsyncIterable<string> | Iterable<string>,
  database: DatabaseSync,
  autoProcess: boolean,
): Promise<void> {
  const queue = createMessageQueue(async (line) => {
    const { chatId, text } = parseChatLine(line);
    await handleMessage(database, chatId, text, autoProcess);
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
  const database = await openCurrentDatabase();
  const terminal = createInterface({ input: process.stdin });
  try {
    await processMessages(terminal, database, true);
  } finally {
    terminal.close();
    database.close();
  }
}

/** 文件入口：读完现成文本，按行交给与实时入口相同的处理链。 */
export async function runReplay(filePath: string): Promise<void> {
  const contents = await readFile(filePath, 'utf8');
  const database = await openCurrentDatabase();
  try {
    await processMessages(contents.split(/\r?\n/), database, true);
  } finally {
    database.close();
  }
}

/** 仅收信：宿主把标准输入中的消息写入对应聊天的入站邮箱，不运行处理器。 */
export async function runReceive(): Promise<void> {
  const database = await openCurrentDatabase();
  const terminal = createInterface({ input: process.stdin });
  try {
    await processMessages(terminal, database, false);
  } finally {
    terminal.close();
    database.close();
  }
}

/** 宿主找到指定聊天×助手的邮箱，再由本地处理器处理；默认仍是Andy。 */
export async function runProcess(chatId: string, agentId = 'Andy'): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    const session = getSession(database, chatId, agentId);
    await processInbox(process.cwd(), session.mailboxKey);
  } finally {
    database.close();
  }
}

/** 宿主启动隔离处理器并等它处理完当前消息；回复仍由 --deliver 投递。 */
export async function runContainerProcess(chatId: string, agentId = 'Andy'): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    const session = getSession(database, chatId, agentId);
    await runContainer(process.cwd(), session.mailboxKey);
  } finally {
    database.close();
  }
}

/** 宿主仅投递指定聊天×助手尚未确认的回复，专用助手加名字标识。 */
export async function runDeliver(chatId: string, agentId = 'Andy'): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    const session = getSession(database, chatId, agentId);
    const prefix = agentId === 'Andy' ? '' : `[${agentId}] `;
    deliverReplies(process.cwd(), session.mailboxKey, database, prefix);
  } finally {
    database.close();
  }
}

/** 宿主配置聊天到助手的接线与角色；只保存关系，不调用模型。 */
export async function runWire(
  chatId: string, agentId: string, kind: string, trigger: string, systemPrompt: string,
): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    wireAgent(database, chatId, agentId, kind, trigger, systemPrompt);
  } finally {
    database.close();
  }
}

/** 搜索所有聊天的用户正文，并将稳定 ID、聊天 ID 和正文显示给用户。 */
export async function runSearch(keyword: string): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    for (const message of searchMessages(database, keyword)) {
      process.stdout.write(`${message.id} [${message.chatId}] ${message.body}\n`);
    }
  } finally {
    database.close();
  }
}

/** 宿主保存任务：要求带时区的ISO时间；once表示一次，其余为周期毫秒。 */
export async function runSchedule(chatId: string, when: string, recurrence: string, text: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(when)) {
    throw new Error('时间须为带时区的ISO格式，例如2026-10-04T18:00:00+08:00');
  }
  const database = await openCurrentDatabase();
  try {
    if (routeMessage(database, chatId, text).length === 0) throw new Error('任务消息未匹配助手，请先配置绑定和触发词');
    const interval = recurrence === 'once' ? undefined : Number(recurrence);
    const id = scheduleTask(database, chatId, text, Date.parse(when), interval);
    process.stdout.write(`任务 ${id} 已保存\n`);
  } finally { database.close(); }
}

/** 宿主列出任务及下一次执行时间，不调用模型；done是一次任务正常完成。 */
export async function runTasks(): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    for (const row of database.prepare('SELECT * FROM scheduled_tasks ORDER BY id').all()) {
      const recurrence = row.interval_ms === null ? 'once' : `every=${row.interval_ms}ms`;
      process.stdout.write(`${row.id} [${row.chat_id}] ${row.status} ${new Date(Number(row.next_run)).toISOString()} ${recurrence} ${row.text}\n`);
    }
  } finally { database.close(); }
}

/** 宿主扫描一次或持续轮询；等本轮结束才等下一轮，避免慢模型导致扫描重叠。 */
export async function runSweep(watch = false): Promise<void> {
  const database = await openCurrentDatabase();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    do {
      await sweepDueTasks(database, async (chatId, text) => {
        const matched = await handleMessage(database, chatId, text, true);
        if (!matched) throw new Error(`任务消息未匹配助手，请检查绑定：${chatId}`);
      });
      if (!watch || stopping) break;
      await delay(1000);
    } while (!stopping);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    database.close();
  }
}

// 只有直接执行该文件时才启动 CLI；被测试导入时不会读取测试进程的 stdin。
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  if (process.argv.length === 4 && process.argv[2] === '--replay') {
    await runReplay(process.argv[3]);
  } else if (process.argv.length === 4 && process.argv[2] === '--search') {
    await runSearch(process.argv[3]);
  } else if (process.argv.length === 3 && process.argv[2] === '--receive') {
    await runReceive();
  } else if ([4, 5].includes(process.argv.length) && process.argv[2] === '--process') {
    await runProcess(process.argv[3], process.argv[4]);
  } else if ([4, 5].includes(process.argv.length) && process.argv[2] === '--process-container') {
    await runContainerProcess(process.argv[3], process.argv[4]);
  } else if ([4, 5].includes(process.argv.length) && process.argv[2] === '--deliver') {
    await runDeliver(process.argv[3], process.argv[4]);
  } else if (process.argv.length === 8 && process.argv[2] === '--wire') {
    await runWire(process.argv[3], process.argv[4], process.argv[5], process.argv[6], process.argv[7]);
  } else if (process.argv.length === 7 && process.argv[2] === '--schedule') {
    await runSchedule(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
  } else if (process.argv.length === 3 && process.argv[2] === '--tasks') {
    await runTasks();
  } else if (process.argv.length === 3 && process.argv[2] === '--sweep') {
    await runSweep();
  } else if (process.argv.length === 3 && process.argv[2] === '--watch') {
    await runSweep(true);
  } else if (process.argv.length === 2) {
    await runCli();
  } else {
    throw new Error('用法：node dist/src/main.js [--replay 文件 | --search 词 | --receive | --process 聊天ID [助手] | --process-container 聊天ID [助手] | --deliver 聊天ID [助手] | --wire 聊天ID 助手 mention|pattern 规则 提示词 | --schedule 聊天ID ISO时间 once或周期毫秒 消息 | --tasks | --sweep | --watch]');
  }
}
