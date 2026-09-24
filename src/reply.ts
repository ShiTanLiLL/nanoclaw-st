/**
 * 判断一次输入是否在呼叫助手，并使用本次会话的历史生成回复。
 *
 * text 是终端读到的原始文字；history 是同一进程内已处理的用户正文。
 * 普通聊天返回 null，且不改变历史。触发消息会先读取上一句，
 * 再把当前正文加入 history，并返回回复字符串。
 */
export function replyToText(text: string, history: string[]): string | null {
  if (!text.startsWith('@Andy')) {
    return null;
  }

  const message = text.slice('@Andy'.length).trimStart();
  const previousMessage = history[history.length - 1];
  history.push(message);

  if (message === '我刚才说了什么？') {
    return previousMessage === undefined
      ? 'NanoClaw: 这是本次对话的第一句话。'
      : `NanoClaw: 你刚才说：${previousMessage}`;
  }

  return `NanoClaw: ${message}`;
}
