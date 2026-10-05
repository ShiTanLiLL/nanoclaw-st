import type { DatabaseSync } from 'node:sqlite';
import { isTransientError } from './retry.js';
import { logEvent } from './runtime.js';

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
  const columns = database.prepare('PRAGMA table_info(scheduled_tasks)').all().map((row) => String(row.name));
  if (!columns.includes('failures')) database.exec('ALTER TABLE scheduled_tasks ADD COLUMN failures INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('retry_at')) database.exec('ALTER TABLE scheduled_tasks ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('last_error')) database.exec('ALTER TABLE scheduled_tasks ADD COLUMN last_error TEXT');
}

/** 宿主登记任务：一次可执行，新周期先待审批；毫秒时间戳，登记不请求模型。 */
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
    'INSERT INTO scheduled_tasks (chat_id, text, next_run, interval_ms, status) VALUES (?, ?, ?, ?, ?)',
  ).run(chatId, text, nextRun, intervalMs ?? null, intervalMs === undefined ? 'pending' : 'awaiting_approval');
  return Number(result.lastInsertRowid);
}

/**
 * 宿主扫描到期任务，带稳定轮次身份执行；有限退避，失败一项仍继续下一项。
 * 未传now则读真实时间；测试传固定时间，不需等闹钟。仅支持单个调度进程。
 */
export async function sweepDueTasks(
  database: DatabaseSync,
  receive: (chatId: string, text: string, sourceKey: string) => Promise<void>,
  now?: number,
): Promise<number> {
  const scanTime = now ?? Date.now();
  const tasks = database.prepare(
    "SELECT * FROM scheduled_tasks WHERE status = 'pending' AND next_run <= ? AND retry_at <= ? ORDER BY next_run, id",
  ).all(scanTime, scanTime);
  let completed = 0;
  for (const task of tasks) {
    try {
      // next_run失败时保持不变：这一轮身份不变，收信凭据因此可以复用。
      await receive(String(task.chat_id), String(task.text), `task:${task.id}:${task.next_run}`);
    } catch (error) {
      const failures = Number(task.failures) + 1;
      const retry = isTransientError(error) && failures < 3;
      // 真实退避从失败时开始，而非扫描开始；慢模型不能提前耗掉等待时间。
      const failedAt = now ?? Date.now();
      database.prepare('UPDATE scheduled_tasks SET failures = ?, retry_at = ?, status = ?, last_error = ? WHERE id = ?')
        .run(failures, retry ? failedAt + 1000 * 2 ** (failures - 1) : 0,
          retry ? 'pending' : 'failed', error instanceof Error ? error.name : 'UnknownError', task.id);
      // 不保存原始错误正文，避免服务错误把凭据或私人内容带入状态字段。
      logEvent(retry ? 'task.deferred' : 'task.failed', Number(task.id));
      continue;
    }
    if (task.interval_ms === null) {
      database.prepare("UPDATE scheduled_tasks SET status = 'done' WHERE id = ?").run(task.id);
    } else {
      const interval = Number(task.interval_ms);
      const previousRun = Number(task.next_run);
      // 从原时间网格计算下一次，停机漏过多轮也只执行一轮，不补发一串模型请求。
      const nextRun = previousRun + (Math.floor((scanTime - previousRun) / interval) + 1) * interval;
      database.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(nextRun, task.id);
    }
    database.prepare('UPDATE scheduled_tasks SET failures = 0, retry_at = 0, last_error = NULL WHERE id = ?').run(task.id);
    completed += 1;
    logEvent('task.completed', Number(task.id));
  }
  return completed;
}

/** 用户修复后手动启用失败任务；不重置next_run，防止恢复时生成新的事件身份。 */
export function retryTask(database: DatabaseSync, id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('任务ID须为正整数');
  const result = database.prepare(`UPDATE scheduled_tasks SET status = 'pending',
    failures = 0, retry_at = 0, last_error = NULL WHERE id = ? AND status = 'failed'`).run(id);
  if (result.changes === 0) throw new Error('没有找到该failed任务');
}

/** 本地所有者批准周期任务或恢复暂停任务；暂停只阻止之后扫描，不取消在途请求。 */
export function changeTaskState(database: DatabaseSync, id: number, action: 'approve' | 'pause'): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('任务ID须为正整数');
  const sql = action === 'approve'
    ? "UPDATE scheduled_tasks SET status = 'pending' WHERE id = ? AND status IN ('awaiting_approval', 'paused')"
    : "UPDATE scheduled_tasks SET status = 'paused' WHERE id = ? AND status = 'pending'";
  const result = database.prepare(sql).run(id);
  if (result.changes === 0) throw new Error('任务不存在或当前状态不允许该操作');
  logEvent(action === 'approve' ? 'task.approved' : 'task.paused', id);
}
