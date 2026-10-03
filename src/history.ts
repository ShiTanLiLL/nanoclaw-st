import { readFile } from 'node:fs/promises';

/**
 * 仅在首次创建 SQLite 数据库时读取前几课留下的 JSON 文件。
 * 旧版单数组文件归入 default；文件不存在时返回空 Map。
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
