# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话。当前第 4 课将唯一会话保存到本地 JSON 文件，重启后仍能恢复。
课程资料位于 [`tutorial/`](./tutorial/)；最高优先级规则记录在工作区上级传入的
规范文件中，并由 [`工作守则.md`](./工作守则.md) 摘要维护。

## 当前运行

需要 Node.js 22+ 和 pnpm 10+。依赖安装后：

```bash
pnpm test
printf '@Andy 我叫小李\n' | pnpm start
printf '@Andy 我刚才说了什么？\n' | pnpm start
```

普通聊天不会产生助手回复。会话保存在运行命令时的工作目录中的
`conversation.json`，已被 Git 忽略；两个命令需在同一目录运行。当前只有这一
个会话，项目不会调用网络、模型或 Docker。
