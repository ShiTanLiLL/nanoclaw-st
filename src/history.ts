import { readFile, writeFile } from 'node:fs/promises';

/**
 * 读取单个会话的历史。第一次启动时文件还不存在，此时从空数组开始。
 * 其他读取错误或无效 JSON 不会伪装成空历史，而是交给调用者处理。
 */
export async function loadHistory(filePath: string): Promise<string[]> {
  try {
    const contents = await readFile(filePath, 'utf8');
    return JSON.parse(contents) as string[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** 把当前会话历史写成可阅读的 JSON 文件，供下次启动恢复。 */
export async function saveHistory(filePath: string, history: string[]): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}
