import { DatabaseSync } from 'node:sqlite';
import { triggeredBody } from './reply.js';
import { createProvider, type ReplyProvider } from './provider.js';

/** 处理器接收邮箱路径和异步回复函数：只读入站，等待成功回复后才写出站确认。 */
export async function processMailbox(
  inboundPath: string,
  outboundPath: string,
  provider: ReplyProvider = createProvider(),
): Promise<void> {
  const inbound = new DatabaseSync(inboundPath, { readOnly: true });
  try {
    const outbound = new DatabaseSync(outboundPath);
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
        const body = triggeredBody(String(message.text));
        if (body === null) continue;
        const reply = await provider(
          body,
          message.previous_body === null ? undefined : String(message.previous_body),
        );
        // 模型返回成功之后才确认处理；失败时不插入这一行，下一次仍是待办。
        saveReply.run(message.id, reply);
      }
    } finally {
      outbound.close();
    }
  } finally {
    inbound.close();
  }
}
