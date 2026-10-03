# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话；第 4 课把历史保存到 JSON；第 5 课按聊天 ID 隔离记忆。
第 6 课让新消息先进入进程内队列，再按顺序处理。第 7 课增加文本文件重放
入口。第 8 课把用户正文保存到 SQLite，并能跨聊天按关键词搜索。第 9 课
增加每个聊天的输入/输出邮箱，宿主与处理器可以分开运行。当前第 10 课增加
Docker 处理分支，只挂载当前聊天的只读输入邮箱和可写输出目录。
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

第 10 课在 Linux/WSL 环境中、Docker 服务启动后执行：

```bash
pnpm container:build
pnpm test:container
```

普通 `pnpm test` 为 14 项测试，不依赖 Docker；`pnpm test:container` 为 1 项
真实 Docker 测试。两组业务数据都隔离在临时目录。
要处理自己已收进邮箱的消息，用 `--process-container 家人` 替换上面的
`--process 家人`，再 `--deliver 家人`。处理器代码变更后需重新构建镜像。

普通聊天不会产生助手回复。没有 `[聊天 ID] ` 前缀的旧输入使用 `default` 聊天。
消息保存在运行命令时的工作目录中的 `conversation.db`，已被 Git 忽略；涉及
同一会话的命令需在同一目录运行。第一次建库会读取旧 `conversation.json`，
但不修改旧文件。重放会向数据库再次追加相同用户消息；待办队列只在内存里。
Node 内置 SQLite 仍是实验性 API，可能出现非失败的警告。回复仍是本地确定性
规则，容器处理分支当前关闭网络。`mailboxes/` 保存按聊天分开的输入/输出邮箱，
也已被 Git 忽略；第 10 课的输出库位于各聊天目录的 `output/outbound.db`，
旧位置文件会在下次使用时移动过去并保留消息 ID。
