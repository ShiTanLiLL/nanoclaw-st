import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { setTimeout as delay } from 'node:timers/promises';

/** 只识别暂时性模型错误；认证、参数、文件与程序错误不自动重试。 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isTransientError);
  }
  return error instanceof APIConnectionError
    || (error instanceof APIError && (error.status === 429
      || (error.status !== undefined && error.status >= 500 && error.status < 600)));
}

/** 同一模型请求最多三次，失败后等100/200ms；sleep替身让测试无需实际等待。 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientError(error) || attempt === 3) throw error;
      await sleep(100 * 2 ** (attempt - 1));
    }
  }
}
