import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { providerSettings } from './provider.js';

/** 宿主日志开关：默认关闭；不接受拼错的值，避免用户误以为日志已经开启。 */
export function logLevel(environment: NodeJS.ProcessEnv = process.env): 'off' | 'info' {
  const level = environment.LOG_LEVEL ?? 'off';
  if (level !== 'off' && level !== 'info') throw new Error('LOG_LEVEL 只能是 off 或 info');
  return level;
}

type RuntimeEvent = 'receipt.accepted' | 'receipt.completed' | 'receipt.failed'
  | 'task.approved' | 'task.paused' | 'task.completed' | 'task.deferred' | 'task.failed';

/** 宿主运行日志只接受固定事件与数字任务ID；不接受正文、凭据、角色或原始异常。 */
export function logEvent(event: RuntimeEvent, taskId?: number): void {
  if (logLevel() === 'off') return;
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), event, taskId })}\n`);
}

/** 宿主只读快照：不建库、不迁移、不调用模型；仅返回配置有效性及中央统计。 */
export function readRuntimeStatus(databasePath: string, environment: NodeJS.ProcessEnv = process.env) {
  let configurationValid = true;
  let provider: 'local' | 'anthropic' | 'invalid' = 'invalid';
  let logging: 'off' | 'info' | 'invalid' = 'invalid';
  try { provider = providerSettings(environment).name; } catch { configurationValid = false; }
  try { logging = logLevel(environment); } catch { configurationValid = false; }
  const result = {
    configuration: { provider, logging, valid: configurationValid },
    databaseExists: existsSync(databasePath),
    counts: { messages: 0, sessions: 0, deliveredReplies: 0 },
    tasks: {} as Record<string, number>, receipts: {} as Record<string, number>,
  };
  if (!result.databaseExists) return result;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((row) => String(row.name)));
    // 表名来自代码里的固定清单，不从命令行拼接；兼容旧库，不为了观察而升级。
    for (const [table, field] of [
      ['messages', 'messages'], ['sessions', 'sessions'], ['delivered_replies', 'deliveredReplies'],
    ] as const) {
      if (tables.has(table)) result.counts[field] = Number(database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()!.total);
    }
    for (const [table, field] of [['scheduled_tasks', 'tasks'], ['receipts', 'receipts']] as const) {
      if (!tables.has(table)) continue;
      for (const row of database.prepare(`SELECT status, COUNT(*) AS total FROM ${table} GROUP BY status`).all()) {
        result[field][String(row.status)] = Number(row.total);
      }
    }
    return result;
  } finally { database.close(); }
}
