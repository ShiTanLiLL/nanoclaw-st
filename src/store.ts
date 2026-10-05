import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { loadHistories } from './history.js';
import { initializeRouting } from './router.js';
import { initializeSchedule } from './scheduler.js';
import { initializeReceipts } from './receipt.js';

export type StoredMessage = { id: number; chatId: string; body: string };

/**
 * 宿主打开中心库，建立搜索/投递表和路由/会话表。
 * 只有数据库第一次创建时，才把旧 JSON 历史按聊天和顺序导入。
 */
export async function openConversationDatabase(
  databasePath: string,
  legacyJsonPath: string,
): Promise<DatabaseSync> {
  const isNewDatabase = !existsSync(databasePath);
  const oldHistories = isNewDatabase ? await loadHistories(legacyJsonPath) : new Map();
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        chat_id TEXT NOT NULL,
        body TEXT NOT NULL
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS delivered_replies (
        chat_id TEXT NOT NULL,
        outbound_id INTEGER NOT NULL,
        PRIMARY KEY (chat_id, outbound_id)
      )
    `);

    if (isNewDatabase && oldHistories.size > 0) {
      // 一次性导入旧文件；任一插入失败就撤销这批插入，不留下半份历史。
      database.exec('BEGIN');
      try {
        const insert = database.prepare('INSERT INTO messages (chat_id, body) VALUES (?, ?)');
        for (const [chatId, history] of oldHistories) {
          for (const body of history) insert.run(chatId, body);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    initializeRouting(database);
    initializeSchedule(database);
    initializeReceipts(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/** 只查询该聊天最新的一条用户正文，供当前的回顾问题使用。 */
export function lastUserMessage(database: DatabaseSync, chatId: string): string | undefined {
  const row = database
    .prepare('SELECT body FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
    .get(chatId);
  return row === undefined ? undefined : String(row.body);
}

/** 把真正发给助手的用户正文追加为一行，SQLite 自动分配稳定 ID。 */
export function appendUserMessage(database: DatabaseSync, chatId: string, body: string): void {
  database.prepare('INSERT INTO messages (chat_id, body) VALUES (?, ?)').run(chatId, body);
}

/** 跨聊天查找包含关键词的用户正文，按消息 ID 从早到晚返回。 */
export function searchMessages(database: DatabaseSync, keyword: string): StoredMessage[] {
  const rows = database
    .prepare('SELECT id, chat_id AS chatId, body FROM messages WHERE instr(body, ?) > 0 ORDER BY id')
    .all(keyword);
  return rows.map((row) => ({
    id: Number(row.id),
    chatId: String(row.chatId),
    body: String(row.body),
  }));
}

/** 宿主检查一封回信是否已经向终端投递过。 */
export function wasDelivered(database: DatabaseSync, chatId: string, outboundId: number): boolean {
  return database.prepare('SELECT 1 FROM delivered_replies WHERE chat_id = ? AND outbound_id = ?')
    .get(chatId, outboundId) !== undefined;
}

/** 投递完成后在宿主拥有的中心库中确认，不让宿主写处理器的输出邮箱。 */
export function markDelivered(database: DatabaseSync, chatId: string, outboundId: number): void {
  database.prepare('INSERT INTO delivered_replies (chat_id, outbound_id) VALUES (?, ?)')
    .run(chatId, outboundId);
}
