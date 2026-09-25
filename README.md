# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话；第 4 课把历史保存到 JSON。当前第 5 课按聊天 ID 隔离记忆。
课程资料位于 [`tutorial/`](./tutorial/)；最高优先级规则记录在工作区上级传入的
规范文件中，并由 [`工作守则.md`](./工作守则.md) 摘要维护。

## 当前运行

需要 Node.js 22+ 和 pnpm 10+。依赖安装后：

```bash
pnpm test
printf '[家人] @Andy 我叫小李\n[工作] @Andy 项目进度正常\n' | pnpm start
printf '[家人] @Andy 我刚才说了什么？\n[工作] @Andy 我刚才说了什么？\n' | pnpm start
```

普通聊天不会产生助手回复。没有 `[聊天 ID] ` 前缀的旧输入使用 `default` 聊天。
各聊天历史保存在运行命令时的工作目录中的 `conversation.json`，已被 Git 忽略；
两个命令需在同一目录运行。项目不会调用网络、模型或 Docker。
