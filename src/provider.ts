import Anthropic from '@anthropic-ai/sdk';
import { replyToBody } from './reply.js';

/** 回复函数约定：正文、会话上一句和可选角色进来，完整回复异步返回。 */
export type ReplyProvider = (body: string, previousMessage?: string, systemPrompt?: string) => Promise<string>;

/** 宿主/处理器都可读配置；只在选择真实模型时要求凭据，不输出密钥。 */
export function providerSettings(environment: NodeJS.ProcessEnv = process.env):
  { name: 'local' } | { name: 'anthropic'; apiKey: string; model: string; baseURL: string } {
  const name = environment.AI_PROVIDER ?? 'local';
  if (name === 'local') return { name };
  if (name !== 'anthropic') throw new Error('AI_PROVIDER 只能是 local 或 anthropic');
  const apiKey = environment.ANTHROPIC_API_KEY?.trim();
  const model = environment.ANTHROPIC_MODEL?.trim();
  if (!apiKey) throw new Error('真实模型需要 ANTHROPIC_API_KEY');
  if (!model) throw new Error('真实模型需要 ANTHROPIC_MODEL');
  const baseURL = environment.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
  return { name, apiKey, model, baseURL };
}

/** 本地确定性回复：沿用前十课规则，测试不联网、不用密钥。 */
export async function localProvider(body: string, previousMessage?: string): Promise<string> {
  return replyToBody(body, previousMessage);
}

/** 创建真实 SDK 回复函数；client 与 model 被内部函数记住，处理器不用了解 HTTP。 */
export function createAnthropicProvider(client: Anthropic, model: string): ReplyProvider {
  /** 把当前会话的角色与一句上下文交给模型，合并文本块为待投递的字符串。 */
  return async function callAnthropic(body, previousMessage, systemPrompt) {
    const content = previousMessage === undefined
      ? body
      : `上一条用户消息：${previousMessage}\n当前用户消息：${body}`;
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      // 当前只需要直接文本回答；兼容服务的默认思考模式可能耗尽短输出预算。
      thinking: { type: 'disabled' },
      system: systemPrompt ?? '你是个人助手 NanoClaw。用中文简洁回答当前用户消息；上一条用户消息仅作为上下文。',
      messages: [{ role: 'user', content }],
    });
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    const text = parts.join('\n').trim();
    if (!text) throw new Error('模型没有返回可投递的文本');
    return `NanoClaw: ${text}`;
  };
}

/** 在实际运行的一侧选择回复方式；SDK 重试暂关闭，失败由邮箱处理链向上报告。 */
export function createProvider(environment: NodeJS.ProcessEnv = process.env): ReplyProvider {
  const settings = providerSettings(environment);
  if (settings.name === 'local') return localProvider;
  const client = new Anthropic({
    apiKey: settings.apiKey,
    authToken: null,
    baseURL: settings.baseURL,
    maxRetries: 0,
    timeout: 30_000,
  });
  return createAnthropicProvider(client, settings.model);
}
