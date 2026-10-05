import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

import { createMessageQueue } from './message-queue.js';
import { runContainer } from './container-runner.js';
import { deliverReplies, enqueueInbound, processInbox } from './mailbox.js';
import { changeTaskState, retryTask, scheduleTask, sweepDueTasks } from './scheduler.js';
import { logEvent, logLevel, readRuntimeStatus } from './runtime.js';
import { expandFileMessage } from './file-message.js';
import { findReceipt, recordReceipt, receiptTargets, type Receipt } from './receipt.js';
import {
  getSession, routeMessage, wireAgent,
} from './router.js';
import {
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
  logLevel(); // 在任何业务写入之前检查日志开关。
  return openConversationDatabase(
    path.join(directory, 'conversation.db'),
    path.join(directory, 'conversation.json'),
  );
}

/** 宿主共同消息链：首次记录凭据和正文；重复事件复用快照，不重复写记忆。 */
async function handleMessage(
  database: DatabaseSync, chatId: string, text: string, autoProcess: boolean,
  sourceKey: string = randomUUID(),
): Promise<boolean> {
  let receipt = findReceipt(database, sourceKey);
  if (!receipt) {
    const routes = routeMessage(database, chatId, text);
    if (routes.length === 0) return false;
    // 安全检查与文件展开先成功，再提交记忆；被拒绝的文件不进入业务数据库。
    const expanded = routes.map((route) => ({ ...route, body: expandFileMessage(process.cwd(), route.body) }));
    receipt = recordReceipt(database, sourceKey, chatId, text, expanded);
    logEvent('receipt.accepted');
  }
  await processReceipt(database, receipt, autoProcess);
  return true;
}

/** 宿主恢复原凭据；逐会话留信和处理，一位失败不阻止另一位，已有结果不重发。 */
async function processReceipt(database: DatabaseSync, receipt: Receipt, autoProcess = true): Promise<void> {
  if (receipt.status === 'done') return;
  const errors: unknown[] = [];
  for (const target of receiptTargets(database, receipt.id)) {
    try {
      enqueueInbound(process.cwd(), target.mailboxKey, receipt.text, target.previousMessage, {
        body: target.body, systemPrompt: target.systemPrompt, sourceKey: receipt.id,
      });
      if (autoProcess) {
        await processInbox(process.cwd(), target.mailboxKey);
        const prefix = target.agentId === 'Andy' ? '' : `[${target.agentId}] `;
        deliverReplies(process.cwd(), target.mailboxKey, database, prefix);
      }
    } catch (error) { errors.push(error); }
  }
  if (errors.length) {
    logEvent('receipt.failed');
    throw new AggregateError(errors, '部分会话未完成，原消息已保存，可修复后恢复');
  }
  if (autoProcess) {
    database.prepare("UPDATE receipts SET status = 'done' WHERE id = ?").run(receipt.id);
    logEvent('receipt.completed');
  }
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
    process.stdout.write(`任务 ${id} 已保存${interval === undefined ? '' : '，等待 --approve-task 审批'}\n`);
  } finally { database.close(); }
}

/** 宿主列出任务及下一次执行时间，不调用模型；done是一次任务正常完成。 */
export async function runTasks(): Promise<void> {
  const database = await openCurrentDatabase();
  try {
    for (const row of database.prepare('SELECT * FROM scheduled_tasks ORDER BY id').all()) {
      const recurrence = row.interval_ms === null ? 'once' : `every=${row.interval_ms}ms`;
      process.stdout.write(`${row.id} [${row.chat_id}] ${row.status} ${new Date(Number(row.next_run)).toISOString()} ${recurrence} failures=${row.failures} retry_at=${row.retry_at} ${row.text}\n`);
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
      await sweepDueTasks(database, async (chatId, text, sourceKey) => {
        const matched = await handleMessage(database, chatId, text, true, sourceKey);
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

/** 宿主恢复所有未完成凭据；沿用原邮箱与记忆，失败汇总后报告，不阻止其他凭据。 */
export async function runRecover(): Promise<void> {
  const database = await openCurrentDatabase();
  const errors: unknown[] = [];
  try {
    for (const row of database.prepare("SELECT id FROM receipts WHERE status = 'pending' ORDER BY rowid").all()) {
      try { await processReceipt(database, findReceipt(database, String(row.id))!); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, '仍有消息未完成，请检查配置后再恢复');
  } finally { database.close(); }
}

/** 宿主在用户明确修复问题后重新启用failed任务，保留原轮次身份与接收快照。 */
export async function runRetryTask(id: string): Promise<void> {
  const database = await openCurrentDatabase();
  try { retryTask(database, Number(id)); }
  finally { database.close(); }
}

/** 宿主治理入口：只修改任务状态；请先停止watch，不并发操作同一组业务数据。 */
export async function runTaskState(id: string, action: 'approve' | 'pause'): Promise<void> {
  const database = await openCurrentDatabase();
  try { changeTaskState(database, Number(id), action); }
  finally { database.close(); }
}

/** 宿主观察入口不使用openCurrentDatabase，避免状态查看触发建库或旧数据迁移。 */
export function runStatus(): void {
  process.stdout.write(`${JSON.stringify(readRuntimeStatus(path.join(process.cwd(), 'conversation.db')), null, 2)}\n`);
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
  } else if (process.argv.length === 3 && process.argv[2] === '--recover') {
    await runRecover();
  } else if (process.argv.length === 4 && process.argv[2] === '--retry-task') {
    await runRetryTask(process.argv[3]);
  } else if (process.argv.length === 4 && process.argv[2] === '--approve-task') {
    await runTaskState(process.argv[3], 'approve');
  } else if (process.argv.length === 4 && process.argv[2] === '--pause-task') {
    await runTaskState(process.argv[3], 'pause');
  } else if (process.argv.length === 3 && process.argv[2] === '--status') {
    runStatus();
  } else if (process.argv.length === 2) {
    await runCli();
  } else {
    throw new Error('用法：node dist/src/main.js [--replay 文件 | --search 词 | --receive | --process 聊天ID [助手] | --process-container 聊天ID [助手] | --deliver 聊天ID [助手] | --wire 聊天ID 助手 mention|pattern 规则 提示词 | --schedule 聊天ID ISO时间 once或周期毫秒 消息 | --tasks | --sweep | --watch | --recover | --retry-task 任务ID | --approve-task 任务ID | --pause-task 任务ID | --status]');
  }
}
