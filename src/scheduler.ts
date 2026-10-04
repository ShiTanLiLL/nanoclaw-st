import type { DatabaseSync } from 'node:sqlite';

/** 宿主中心库保存任务定义；邮箱只接收到期时产生的消息，不承担计时。 */
export function initializeSchedule(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    text TEXT NOT NULL,
    next_run INTEGER NOT NULL,
    interval_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
  )`);
}

/** 宿主登记一次或周期任务；时间为毫秒时间戳，登记本身不发送消息或请求模型。 */
export function scheduleTask(
  database: DatabaseSync, chatId: string, text: string, nextRun: number, intervalMs?: number,
): number {
  if (!chatId.trim() || !text.trim()) throw new Error('聊天和任务消息不能为空');
  if (!Number.isSafeInteger(nextRun) || nextRun < 0 || nextRun > 8_640_000_000_000_000) {
    throw new Error('执行时间必须是有效的非负毫秒时间戳');
  }
  if (intervalMs !== undefined && (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)) {
    throw new Error('周期必须是正整数毫秒');
  }
  const result = database.prepare(
    'INSERT INTO scheduled_tasks (chat_id, text, next_run, interval_ms) VALUES (?, ?, ?, ?)',
  ).run(chatId, text, nextRun, intervalMs ?? null);
  return Number(result.lastInsertRowid);
}

/**
 * 宿主扫描到期任务，逐个等待共同消息链完成，再确认本轮。
 * now默认取真实时间；测试传固定时间，不需等闹钟。仅支持单个调度进程。
 */
export async function sweepDueTasks(
  database: DatabaseSync,
  receive: (chatId: string, text: string) => Promise<void>,
  now = Date.now(),
): Promise<number> {
  const tasks = database.prepare(
    "SELECT * FROM scheduled_tasks WHERE status = 'pending' AND next_run <= ? ORDER BY next_run, id",
  ).all(now);
  let completed = 0;
  for (const task of tasks) {
    await receive(String(task.chat_id), String(task.text));
    if (task.interval_ms === null) {
      database.prepare("UPDATE scheduled_tasks SET status = 'done' WHERE id = ?").run(task.id);
    } else {
      const interval = Number(task.interval_ms);
      const previousRun = Number(task.next_run);
      // 从原时间网格计算下一次，停机漏过多轮也只执行一轮，不补发一串模型请求。
      const nextRun = previousRun + (Math.floor((now - previousRun) / interval) + 1) * interval;
      database.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(nextRun, task.id);
    }
    completed += 1;
  }
  return completed;
}
