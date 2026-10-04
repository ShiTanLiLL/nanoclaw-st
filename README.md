# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话；第 4 课把历史保存到 JSON；第 5 课按聊天 ID 隔离记忆。
第 6 课让新消息先进入进程内队列，再按顺序处理。第 7 课增加文本文件重放
入口。第 8 课把用户正文保存到 SQLite，并能跨聊天按关键词搜索。第 9 课
增加每个聊天的输入/输出邮箱，宿主与处理器可以分开运行。第 10 课增加
Docker 处理分支。当前第 11 课新增官方 Anthropic SDK，可选择本地规则或真实
模型回复，也支持 DeepSeek 的 Anthropic 兼容接口；未加载配置仍是本地模式。
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

普通 `pnpm test` 为 16 项测试，不依赖 Docker；`pnpm test:container` 为 1 项
真实 Docker 测试。两组业务数据都隔离在临时目录。
要处理自己已收进邮箱的消息，用 `--process-container 家人` 替换上面的
`--process 家人`，再 `--deliver 家人`。处理器代码变更后需重新构建镜像。

普通聊天不会产生助手回复。没有 `[聊天 ID] ` 前缀的旧输入使用 `default` 聊天。
消息保存在运行命令时的工作目录中的 `conversation.db`，已被 Git 忽略；涉及
同一会话的命令需在同一目录运行。第一次建库会读取旧 `conversation.json`，
但不修改旧文件。重放会向数据库再次追加相同用户消息；待办队列只在内存里。
Node 内置 SQLite 仍是实验性 API，可能出现非失败的警告。本地回复模式的容器
关闭网络；真实模型模式允许联网。`mailboxes/` 保存按聊天分开的输入/输出邮箱，
也已被 Git 忽略；第 10 课的输出库位于各聊天目录的 `output/outbound.db`，
旧位置文件会在下次使用时移动过去并保留消息 ID。

## 第 11 课真实模型

先 `cp .env.example .env`，填入你的 DeepSeek API 密钥；示例使用
`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`、
`ANTHROPIC_MODEL=deepseek-flash`。`AI_PROVIDER=anthropic` 表示协议，不限定品牌。
兼容地址见 [DeepSeek 官方文档](https://api-docs.deepseek.com/guides/anthropic_api/)。`.env`
已被 Git 忽略，不进入镜像。未用 `--env-file` 加载时，程序不会自动读它。

主要体验入口（宿主调用模型）：

```bash
pnpm start:model
```

输入 `[学习] @Andy 我叫小李`，等回答后输入 `[学习] @Andy 我刚才说了什么？`。
换 `[工作]` 可验证聊天记忆隔离，退出重启可验证记忆持久化。仅保留上一句用户
正文作为模型上下文，不是完整对话历史。没有 `@Andy` 的普通消息不会请求模型。

文件重放与搜索：

```bash
node --env-file=.env dist/src/main.js --replay tutorial/示例/第11课模型消息.txt
node dist/src/main.js --search 小李
```

重放会追加用户消息并调用模型；搜索只查中心库中的用户正文，不调用模型。

容器调用模型（收信、生成、投递仍分三步）：

```bash
pnpm container:build
printf '[模型演示] @Andy 用两句话解释为什么容器能限制文件访问。\n' | node dist/src/main.js --receive
node --env-file=.env dist/src/main.js --process-container 模型演示
node dist/src/main.js --deliver 模型演示
```

第 11 课镜像为 `nanoclaw-st-agent:lesson11`。调用真实 API 会发送当前正文和
至多上一句用户正文，可能产生API费用；本地自动测试不请求云端。
SDK请求由本地模拟HTTP服务验证，云端权限与实际回答需要你用自己的配置验收。
