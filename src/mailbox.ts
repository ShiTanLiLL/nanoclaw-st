import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { processMailbox } from './processor.js';
import { markDelivered, wasDelivered } from './store.js';

/** 聊天 ID 可能含斜杠；把它哈希成固定的安全目录名，而非直接拼入路径。 */
export function mailboxPaths(baseDirectory: string, chatId: string) {
  const safeName = createHash('sha256').update(chatId).digest('hex');
  const directory = path.join(baseDirectory, 'mailboxes', safeName);
  const outputDirectory = path.join(directory, 'output');
  return {
    directory,
    outputDirectory,
    inbound: path.join(directory, 'inbound.db'),
    outbound: path.join(outputDirectory, 'outbound.db'),
  };
}

/** 只迁移第 9 课已经关闭的输出邮箱文件；不改数据库行，保留投递确认所用的 ID。 */
export function prepareMailbox(baseDirectory: string, chatId: string) {
  const paths = mailboxPaths(baseDirectory, chatId);
  mkdirSync(paths.outputDirectory, { recursive: true });
  const legacyOutbound = path.join(paths.directory, 'outbound.db');
  if (existsSync(legacyOutbound) && !existsSync(paths.outbound)) {
    renameSync(legacyOutbound, paths.outbound);
  }
  return paths;
}

/** 宿主只写入站邮箱：原始文本与接收当时的上一句一起交给处理器。 */
export function enqueueInbound(
  baseDirectory: string,
  chatId: string,
  text: string,
  previousMessage?: string,
): void {
  const paths = prepareMailbox(baseDirectory, chatId);
  const inbound = new DatabaseSync(paths.inbound);
  try {
    inbound.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      previous_body TEXT
    )`);
    inbound.prepare('INSERT INTO messages (text, previous_body) VALUES (?, ?)')
      .run(text, previousMessage ?? null);
  } finally {
    inbound.close();
  }
}

/** 处理器轮询一次：只读入站；以 inbound_id 唯一约束确认处理并只写出站。 */
export async function processInbox(baseDirectory: string, chatId: string): Promise<void> {
  const paths = mailboxPaths(baseDirectory, chatId);
  if (!existsSync(paths.inbound)) return;
  prepareMailbox(baseDirectory, chatId);
  await processMailbox(paths.inbound, paths.outbound);
}

/** 宿主只读出站，把未确认的回信输出后，在自己的中心库记录投递确认。 */
export function deliverReplies(baseDirectory: string, chatId: string, database: DatabaseSync): void {
  const paths = mailboxPaths(baseDirectory, chatId);
  if (existsSync(path.join(paths.directory, 'outbound.db'))) prepareMailbox(baseDirectory, chatId);
  if (!existsSync(paths.outbound)) return;

  const outbound = new DatabaseSync(paths.outbound, { readOnly: true });
  try {
    const replies = outbound.prepare('SELECT id, reply FROM replies ORDER BY id').all();
    for (const row of replies) {
      const outboundId = Number(row.id);
      if (wasDelivered(database, chatId, outboundId)) continue;
      process.stdout.write(`${String(row.reply)}\n`);
      markDelivered(database, chatId, outboundId);
    }
  } finally {
    outbound.close();
  }
}
