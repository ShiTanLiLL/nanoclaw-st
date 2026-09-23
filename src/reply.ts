/**
 * 把一次用户输入变成当前版本的最小助手回复。
 *
 * 第 1 课只有一种处理方式，所以直接使用函数，不提前引入 Provider
 * 或其它间接层。后续需求出现后，这个函数允许被重写或拆分。
 */
export function replyToText(text: string): string {
  return `NanoClaw: ${text}`;
}
