import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 16 * 1024;

/**
 * 宿主把/file相对文件名和可选问题展开为正文快照。
 * 只允许attachments内的普通.md/.txt UTF-8文件；不将原文件挂进容器。
 */
export function expandFileMessage(baseDirectory: string, body: string): string {
  if (!body.startsWith('/file ')) return body;
  const match = /^\/file\s+(\S+)(?:\s+([\s\S]*))?$/.exec(body);
  if (!match) throw new Error('文件消息格式：/file 相对文件名 [问题]');
  const name = match[1];
  const parts = name.split(/[\\/]/);
  if (path.isAbsolute(name) || name.includes('\0') || parts.some((part) => !part || part === '..' || part === '.')) {
    throw new Error('文件名必须在附件目录内，不能使用绝对路径或目录跳转');
  }
  if (!['.md', '.txt'].includes(path.extname(name).toLowerCase())) throw new Error('只允许.md和.txt文本文件');
  const root = path.join(path.resolve(baseDirectory), 'attachments');
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('附件根目录必须是真实目录');
  let candidate = root;
  for (const part of parts) {
    candidate = path.join(candidate, part);
    if (lstatSync(candidate).isSymbolicLink()) throw new Error('附件路径不能包含符号链接');
  }
  const resolved = realpathSync(candidate);
  const relative = path.relative(realpathSync(root), resolved);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('附件路径越界');
  const descriptor = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('附件须为不超过16KiB的普通文件');
    // 最多读取上限+1字节，避免文件在检查后变大时无限读入内存。
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > MAX_FILE_BYTES) throw new Error('附件超过16KiB');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
    return `${match[2]?.trim() || '请用中文概括以下文件。'}\n\n文件：${name}\n${text}`;
  } finally { closeSync(descriptor); }
}
