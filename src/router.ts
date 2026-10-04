import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_PROMPT = '你是个人助手 NanoClaw。用中文简洁回答当前用户消息；上一条用户消息仅作为上下文。';
export type Session = { id: number; chatId: string; agentId: string; mailboxKey: string };
export type RoutedMessage = { agentId: string; body: string; systemPrompt: string };

/** 宿主建关系表：助手定义、聊天绑定、聊天×助手会话，以及会话自己的用户记忆。 */
export function initializeRouting(database: DatabaseSync): void {
  const upgrading = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get() === undefined;
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, system_prompt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wirings (
      chat_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      kind TEXT NOT NULL, trigger TEXT NOT NULL,
      PRIMARY KEY (chat_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      mailbox_key TEXT NOT NULL UNIQUE, UNIQUE (chat_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, body TEXT NOT NULL
    );
  `);
  // 只在第11课数据库首次升级时导入旧记忆；以后聊天记录可能来自别的助手。
  if (upgrading && database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get()) {
    for (const row of database.prepare('SELECT DISTINCT chat_id FROM messages').all()) {
      const session = getSession(database, String(row.chat_id), 'Andy');
      database.prepare(`INSERT INTO session_messages (session_id, body)
        SELECT ?, body FROM messages WHERE chat_id = ? ORDER BY id`).run(session.id, session.chatId);
    }
  }
}

/** 宿主保存一个助手及其聊天绑定；同聊天同助手重复配置是更新，不是重复订阅。 */
export function wireAgent(
  database: DatabaseSync, chatId: string, agentId: string,
  kind: string, trigger: string, systemPrompt: string,
): void {
  if (![chatId, agentId, trigger, systemPrompt].every((value) => value.trim())) {
    throw new Error('聊天、助手、触发规则与提示词不能为空');
  }
  if (kind !== 'mention' && kind !== 'pattern') throw new Error('规则只能是 mention 或 pattern');
  if (kind === 'pattern') new RegExp(trigger); // 先验证，再写库，错误配置不留下半份关系。
  database.exec('BEGIN');
  try {
    database.prepare(`INSERT INTO agents VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET system_prompt = excluded.system_prompt`).run(agentId, systemPrompt);
    database.prepare(`INSERT INTO wirings VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id, agent_id) DO UPDATE SET kind = excluded.kind, trigger = excluded.trigger`)
      .run(chatId, agentId, kind, trigger);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** 宿主逐一匹配聊天绑定，返回零/一/多个目标；尚未配置的聊天沿用 @Andy。 */
export function routeMessage(database: DatabaseSync, chatId: string, text: string): RoutedMessage[] {
  const wirings = database.prepare(`SELECT agent_id, kind, trigger, system_prompt
    FROM wirings JOIN agents ON agents.id = wirings.agent_id
    WHERE chat_id = ? ORDER BY agent_id`).all(chatId);
  if (wirings.length === 0) {
    return text.startsWith('@Andy')
      ? [{ agentId: 'Andy', body: text.slice(5).trimStart(), systemPrompt: DEFAULT_PROMPT }]
      : [];
  }
  const routes: RoutedMessage[] = [];
  for (const wiring of wirings) {
    const trigger = String(wiring.trigger);
    const matches = wiring.kind === 'mention' ? text.startsWith(trigger) : new RegExp(trigger).test(text);
    if (!matches) continue;
    routes.push({
      agentId: String(wiring.agent_id),
      body: wiring.kind === 'mention' ? text.slice(trigger.length).trimStart() : text,
      systemPrompt: String(wiring.system_prompt),
    });
  }
  return routes;
}

/** 宿主找到或创建聊天×助手会话；Andy沿用旧邮箱，新助手获得独立的邮箱键。 */
export function getSession(database: DatabaseSync, chatId: string, agentId: string): Session {
  let row = database.prepare('SELECT id, mailbox_key FROM sessions WHERE chat_id = ? AND agent_id = ?')
    .get(chatId, agentId);
  if (row === undefined) {
    // UNIQUE 约束保证键冲突时报错，绝不让两个会话共用邮箱或投递确认。
    const mailboxKey = agentId === 'Andy' ? chatId : `agent:${randomUUID()}`;
    database.exec('BEGIN');
    try {
      database.prepare('INSERT INTO sessions (chat_id, agent_id, mailbox_key) VALUES (?, ?, ?)')
        .run(chatId, agentId, mailboxKey);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    row = database.prepare('SELECT id, mailbox_key FROM sessions WHERE chat_id = ? AND agent_id = ?')
      .get(chatId, agentId)!;
  }
  return { id: Number(row.id), chatId, agentId, mailboxKey: String(row.mailbox_key) };
}

/** 宿主在收信时读取这一会话上一句，而不是读取整个聊天最新的一句。 */
export function lastSessionMessage(database: DatabaseSync, sessionId: number): string | undefined {
  const row = database.prepare('SELECT body FROM session_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId);
  return row === undefined ? undefined : String(row.body);
}

/** 宿主追加本次真正路由给该助手的正文；助手看不到未路由给自己的消息。 */
export function appendSessionMessage(database: DatabaseSync, sessionId: number, body: string): void {
  database.prepare('INSERT INTO session_messages (session_id, body) VALUES (?, ?)').run(sessionId, body);
}
