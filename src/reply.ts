/**
 * 判断一次输入是否在呼叫助手，并在触发时生成回复。
 *
 * 输入是终端读到的原始文字。只有以 @Andy 开头时才返回回复字符串；
 * 普通聊天返回 null，告诉调用者本次不需要输出。
 */
export function replyToText(text: string): string | null {
  if (!text.startsWith('@Andy')) {
    return null;
  }

  const message = text.slice('@Andy'.length).trimStart();
  return `NanoClaw: ${message}`;
}
