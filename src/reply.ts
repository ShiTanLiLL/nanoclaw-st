/**
 * 判断一次输入是否在呼叫助手，并使用同一聊天的上一句生成回复。
 *
 * text 是去掉聊天前缀后的文字；previousMessage 来自数据库查询。
 * 普通聊天返回 null；触发消息返回要保存的正文和要输出的回复。
 */
export function replyToText(
  text: string,
  previousMessage?: string,
): { body: string; reply: string } | null {
  const message = triggeredBody(text);
  if (message === null) return null;
  return { body: message, reply: replyToBody(message, previousMessage) };
}

/** 对已经去掉触发词的正文生成旧版确定性回复，供本地 Provider 复用。 */
export function replyToBody(message: string, previousMessage?: string): string {
  if (message === '我刚才说了什么？') {
    return previousMessage === undefined
      ? 'NanoClaw: 这是本次对话的第一句话。'
      : `NanoClaw: 你刚才说：${previousMessage}`;
  }
  return `NanoClaw: ${message}`;
}

/** 宿主收信时只判断是否真的呼叫助手，不在这里生成或保存回复。 */
export function triggeredBody(text: string): string | null {
  return text.startsWith('@Andy') ? text.slice('@Andy'.length).trimStart() : null;
}
