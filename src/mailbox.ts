import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { replyToText } from './reply.js';
import { markDelivered, wasDelivered } from './store.js';

/** 聊天 ID 可能含斜杠；把它哈希成固定的安全目录名，而非直接拼入路径。 */
function mailboxPaths(baseDirectory: string, chatId: string) {
  const safeName = createHash('sha256').update(chatId).digest('hex');
  const directory = path.join(baseDirectory, 'mailboxes', safeName);
  return {
    directory,
    inbound: path.join(directory, 'inbound.db'),
    outbound: path.join(directory, 'outbound.db'),
  };
}

/** 宿主只写入站邮箱：原始文本与接收当时的上一句一起交给处理器。 */
export function enqueueInbound(
  baseDirectory: string,
  chatId: string,
  text: string,
  previousMessage?: string,
): void {
  const paths = mailboxPaths(baseDirectory, chatId);
  mkdirSync(paths.directory, { recursive: true });
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
export function processInbox(baseDirectory: string, chatId: string): void {
  const paths = mailboxPaths(baseDirectory, chatId);
  if (!existsSync(paths.inbound)) return;

  const inbound = new DatabaseSync(paths.inbound, { readOnly: true });
  const outbound = new DatabaseSync(paths.outbound);
  try {
    outbound.exec(`CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY,
      inbound_id INTEGER NOT NULL UNIQUE,
      reply TEXT NOT NULL
    )`);
    const messages = inbound.prepare('SELECT id, text, previous_body FROM messages ORDER BY id').all();
    const findReply = outbound.prepare('SELECT 1 FROM replies WHERE inbound_id = ?');
    const saveReply = outbound.prepare('INSERT INTO replies (inbound_id, reply) VALUES (?, ?)');
    for (const message of messages) {
      if (findReply.get(message.id) !== undefined) continue;
      const result = replyToText(
        String(message.text),
        message.previous_body === null ? undefined : String(message.previous_body),
      );
      if (result !== null) saveReply.run(message.id, result.reply);
    }
  } finally {
    inbound.close();
    outbound.close();
  }
}

/** 宿主只读出站，把未确认的回信输出后，在自己的中心库记录投递确认。 */
export function deliverReplies(baseDirectory: string, chatId: string, database: DatabaseSync): void {
  const paths = mailboxPaths(baseDirectory, chatId);
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
