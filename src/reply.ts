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
  if (!text.startsWith('@Andy')) {
    return null;
  }

  const message = text.slice('@Andy'.length).trimStart();

  if (message === '我刚才说了什么？') {
    const reply = previousMessage === undefined
      ? 'NanoClaw: 这是本次对话的第一句话。'
      : `NanoClaw: 你刚才说：${previousMessage}`;
    return { body: message, reply };
  }

  return { body: message, reply: `NanoClaw: ${message}` };
}
