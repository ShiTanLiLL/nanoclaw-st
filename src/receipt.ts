import type { DatabaseSync } from 'node:sqlite';
import { appendSessionMessage, getSession, lastSessionMessage, type RoutedMessage } from './router.js';

export type Receipt = { id: string; text: string; status: string };
export type ReceiptTarget = {
  mailboxKey: string; agentId: string; body: string;
  previousMessage?: string; systemPrompt: string;
};

/** 宿主保存接收凭据及其目标快照；中心记忆先提交，再可重复交接至独立邮箱。 */
export function initializeReceipts(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS receipt_targets (
      receipt_id TEXT NOT NULL, session_id INTEGER NOT NULL,
      body TEXT NOT NULL, previous_body TEXT, system_prompt TEXT NOT NULL,
      PRIMARY KEY (receipt_id, session_id)
    )
  `);
}

/** 宿主用事件标识找已有凭据；已收过的定时任务不重新路由、读文件或写记忆。 */
export function findReceipt(database: DatabaseSync, id: string): Receipt | undefined {
  const row = database.prepare('SELECT id, text, status FROM receipts WHERE id = ?').get(id);
  return row === undefined ? undefined : { id: String(row.id), text: String(row.text), status: String(row.status) };
}

/** 首次接收时把凭据、目标快照、会话记忆和搜索记录放在同一个中央事务中。 */
export function recordReceipt(
  database: DatabaseSync, id: string, chatId: string, text: string, routes: RoutedMessage[],
): Receipt {
  const existing = findReceipt(database, id);
  if (existing) return existing;
  // getSession会自行创建会话，不嵌套BEGIN；空会话不等于消息已收到。
  const targets = routes.map((route) => ({ route, session: getSession(database, chatId, route.agentId) }));
  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO receipts (id, chat_id, text) VALUES (?, ?, ?)').run(id, chatId, text);
    for (const { route, session } of targets) {
      const previous = lastSessionMessage(database, session.id);
      database.prepare(`INSERT INTO receipt_targets
        (receipt_id, session_id, body, previous_body, system_prompt) VALUES (?, ?, ?, ?, ?)`)
        .run(id, session.id, route.body, previous ?? null, route.systemPrompt);
      appendSessionMessage(database, session.id, route.body);
    }
    database.prepare('INSERT INTO messages (chat_id, body) VALUES (?, ?)').run(chatId, routes[0].body);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return findReceipt(database, id)!;
}

/** 宿主读取原目标与接收时快照，而非根据今天的绑定重新生成一份目标。 */
export function receiptTargets(database: DatabaseSync, receiptId: string): ReceiptTarget[] {
  return database.prepare(`SELECT mailbox_key, agent_id, body, previous_body, system_prompt
    FROM receipt_targets JOIN sessions ON sessions.id = receipt_targets.session_id
    WHERE receipt_id = ? ORDER BY agent_id`).all(receiptId).map((row) => ({
      mailboxKey: String(row.mailbox_key), agentId: String(row.agent_id), body: String(row.body),
      previousMessage: row.previous_body === null ? undefined : String(row.previous_body),
      systemPrompt: String(row.system_prompt),
    }));
}
