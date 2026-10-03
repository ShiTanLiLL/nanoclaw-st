import { DatabaseSync } from 'node:sqlite';
import { replyToText } from './reply.js';

/** 处理器只接受两个邮箱路径：只读入站，生成尚未处理的回复并写入出站。 */
export function processMailbox(inboundPath: string, outboundPath: string): void {
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
        const result = replyToText(
          String(message.text),
          message.previous_body === null ? undefined : String(message.previous_body),
        );
        if (result !== null) saveReply.run(message.id, result.reply);
      }
    } finally {
      outbound.close();
    }
  } finally {
    inbound.close();
  }
}
