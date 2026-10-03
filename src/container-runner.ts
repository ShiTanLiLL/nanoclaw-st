import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { mailboxPaths, prepareMailbox } from './mailbox.js';

export const CONTAINER_IMAGE = 'nanoclaw-st-agent:lesson10';
const execFileAsync = promisify(execFile);

/** 直接传参数数组启动 Docker，等待本轮处理器退出；启动失败向调用者抛出。 */
async function executeDocker(args: string[]): Promise<void> {
  await execFileAsync('docker', args);
}

/** 为一个聊天生成运行命令：只挂载该聊天的入站文件与独立输出目录。 */
export function containerArguments(baseDirectory: string, chatId: string): string[] {
  const paths = mailboxPaths(path.resolve(baseDirectory), chatId);
  // Linux 宿主的数字 UID/GID，让输出文件仍归当前用户，避免容器留下 root 文件。
  if (!process.getuid || !process.getgid) throw new Error('本课容器启动器需要 Linux/WSL 环境');
  return [
    'run', '--rm', '--read-only', '--network', 'none',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '--mount', `type=bind,src=${paths.inbound},dst=/input/inbound.db,readonly`,
    '--mount', `type=bind,src=${paths.outputDirectory},dst=/output`,
    CONTAINER_IMAGE, '/input/inbound.db', '/output/outbound.db',
  ];
}

/** 单次容器处理：准备目录，运行并等待退出。execute 供离线测试替换启动工具。 */
export async function runContainer(
  baseDirectory: string,
  chatId: string,
  execute: (args: string[]) => Promise<void> = executeDocker,
): Promise<void> {
  const paths = mailboxPaths(baseDirectory, chatId);
  if (!existsSync(paths.inbound)) return;
  prepareMailbox(baseDirectory, chatId);
  await execute(containerArguments(baseDirectory, chatId));
}
