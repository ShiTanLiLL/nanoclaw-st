# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话；第 4 课把历史保存到 JSON；第 5 课按聊天 ID 隔离记忆。
第 6 课让新消息先进入进程内队列，再按顺序处理。第 7 课增加文本文件重放
入口。第 8 课把用户正文保存到 SQLite，并能跨聊天按关键词搜索。当前第 9 课
增加每个聊天的输入/输出邮箱，宿主与处理器可以分开运行。
课程资料位于 [`tutorial/`](./tutorial/)；最高优先级规则记录在工作区上级传入的
规范文件中，并由 [`工作守则.md`](./工作守则.md) 摘要维护。

## 当前运行

需要 Node.js 22.13+ 和 pnpm 10+。依赖安装后：

```bash
pnpm test
printf '[家人] @Andy 我叫小李\n[工作] @Andy 项目进度正常\n' | pnpm start
printf '[家人] @Andy 我刚才说了什么？\n[工作] @Andy 我刚才说了什么？\n' | pnpm start
pnpm build
node dist/src/main.js --replay tutorial/示例/第07课消息.txt
node dist/src/main.js --search 小李
```

第 9 课可在同一工作目录分三步模拟跨进程交接：

```bash
pnpm build
printf '[家人] @Andy 我叫小李\n' | node dist/src/main.js --receive
node dist/src/main.js --process 家人
node dist/src/main.js --deliver 家人
```

`--receive` 只收信，`--process` 单次处理该聊天当前待办输入，`--deliver`
只输出未确认的回复；重复执行后两步不会正常重发。上面的命令会改写当前目录的
个人数据，第一次体验建议先运行隔离在临时目录里的 `pnpm test`。

普通聊天不会产生助手回复。没有 `[聊天 ID] ` 前缀的旧输入使用 `default` 聊天。
消息保存在运行命令时的工作目录中的 `conversation.db`，已被 Git 忽略；涉及
同一会话的命令需在同一目录运行。第一次建库会读取旧 `conversation.json`，
但不修改旧文件。重放会向数据库再次追加相同用户消息；待办队列只在内存里。
Node 内置 SQLite 仍是实验性 API，可能出现非失败的警告。项目不会调用网络、
模型或 Docker。`mailboxes/` 保存按聊天分开的输入/输出邮箱，也已被 Git 忽略。
