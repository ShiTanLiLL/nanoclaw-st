import { readFile, writeFile } from 'node:fs/promises';

/**
 * 从 JSON 读取各聊天的历史。旧版单数组文件归入 default 聊天。
 * 第一次启动文件还不存在时返回空 Map；其他错误仍交给调用者处理。
 */
export async function loadHistories(filePath: string): Promise<Map<string, string[]>> {
  try {
    const contents = await readFile(filePath, 'utf8');
    const saved = JSON.parse(contents);
    if (Array.isArray(saved)) {
      return new Map([['default', saved as string[]]]);
    }
    return new Map(Object.entries(saved as Record<string, string[]>));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
}

/** 把聊天 ID 与各自的历史写成 JSON 对象，供下次启动恢复。 */
export async function saveHistories(
  filePath: string,
  histories: Map<string, string[]>,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(Object.fromEntries(histories), null, 2)}\n`, 'utf8');
}
