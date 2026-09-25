export type QueuedMessage = {
  line: string;
  status: 'pending' | 'processing' | 'completed';
};

/**
 * 接收消息时立即入队，由一个异步处理循环按顺序执行真正的工作。
 * handleLine 是本次 CLI 已有的“判断、保存、输出”工作，不引入其它处理器。
 */
export function createMessageQueue(handleLine: (line: string) => Promise<void>) {
  const pending: QueuedMessage[] = [];
  let running: Promise<void> | null = null;
  let failure: unknown = undefined;

  /** 从待办列表依次取消息；等一条处理完，才处理下一条。 */
  async function processPending(): Promise<void> {
    try {
      while (pending.length > 0) {
        const message = pending.shift();
        if (message === undefined) break;

        message.status = 'processing';
        await handleLine(message.line);
        message.status = 'completed';
      }
    } catch (error) {
      failure = error;
    } finally {
      running = null;
    }
  }

  /** 只登记新消息，不等待前面的消息处理结束。 */
  function enqueue(line: string): QueuedMessage {
    if (failure !== undefined) throw failure;

    const message: QueuedMessage = { line, status: 'pending' };
    pending.push(message);
    if (running === null) {
      running = processPending();
    }
    return message;
  }

  /** 输入结束后，等待队列中的消息处理完；处理失败则把错误抛给 CLI。 */
  async function whenIdle(): Promise<void> {
    if (running !== null) await running;
    if (failure !== undefined) throw failure;
  }

  return { enqueue, whenIdle };
}
