import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processMailbox } from './processor.js';

/** 独立处理器入口：处理当前邮箱中的消息，关闭连接后自然退出。 */
export function runAgent(inboundPath: string, outboundPath: string): void {
  processMailbox(inboundPath, outboundPath);
}

// 本地测试与容器都直接执行这个文件；被导入时不启动处理。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 4) {
    throw new Error('用法：node agent-runner.js 输入邮箱路径 输出邮箱路径');
  }
  runAgent(process.argv[2], process.argv[3]);
}
