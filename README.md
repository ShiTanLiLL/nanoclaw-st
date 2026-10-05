# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立最小单次对话链；第 2 课增加 `@Andy` 触发判断；第 3 课用内存数组
支持多轮对话；第 4 课把历史保存到 JSON；第 5 课按聊天 ID 隔离记忆。
第 6 课让新消息先进入进程内队列，再按顺序处理。第 7 课增加文本文件重放
入口。第 8 课把用户正文保存到 SQLite，并能跨聊天按关键词搜索。第 9 课
增加每个聊天的输入/输出邮箱，宿主与处理器可以分开运行。第 10 课增加
Docker 处理分支。第 11 课新增官方 Anthropic SDK，可选择本地规则或真实
模型回复，也支持 DeepSeek 的 Anthropic 兼容接口；未加载配置仍是本地模式。
第12～15课增加多助手路由、调度、恢复与安全文件、周期审批和只读运行观察。
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

普通 `pnpm test` 为 26 项测试，不依赖 Docker；`pnpm test:container` 为 1 项
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

当前镜像为 `nanoclaw-st-agent:lesson14`。调用真实 API 会发送当前正文和
至多上一句用户正文，可能产生API费用；本地自动测试不请求云端。
SDK请求由本地模拟HTTP服务验证，云端权限与实际回答需要你用自己的配置验收。

## 第 12 课：同一聊天里的多个助手

本次从第11课提交恢复后，只重新生成第12课。配置角色与触发规则不调用模型：

```bash
pnpm build
node dist/src/main.js --wire 课堂 Andy mention '@Andy' '你是通用助手，用中文简洁回答。'
node dist/src/main.js --wire 课堂 Teacher pattern '^@(Teacher|Andy)' '你是耐心的TypeScript老师，用中文举例讲解。'
pnpm start:model
```

`[课堂] @Teacher 解释闭包`只交给老师；`[课堂] @Andy 解释闭包`交给两位。
Teacher回复带`[Teacher]`标识，各自只记住路由给自己的上一句用户消息。
配置过的聊天只按显式绑定匹配；未配置聊天继续使用旧`@Andy`入口。
搜索按聊天只记录一次，模型上下文改从聊天×助手会话读取。

分段命令可增加助手名：`--process 课堂 Teacher`、
`--process-container 课堂 Teacher`、`--deliver 课堂 Teacher`。
省略助手仍只处理Andy，不表示处理所有助手。第12课引入lesson12镜像，
只读取当前会话入站正文、上一句与角色快照；中心库仍由宿主掌管。
完整阅读、数据说明和真实模型验收见
[第12课教案](tutorial/教案/第12课-一个聊天连接多个助手.md)。

## 第 13 课：未来或周期消息

宿主把任务保存于中央库，到期使用现有聊天路由与模型链。登记不请求模型：

```bash
pnpm build
node dist/src/main.js --wire 定时课堂 Teacher mention '@Teacher' '你是耐心的TypeScript老师，用中文出题。'
lesson13_at=$(node -e 'console.log(new Date(Date.now()+30000).toISOString())')
node dist/src/main.js --schedule 定时课堂 "$lesson13_at" once '@Teacher 给我一道闭包练习，先不公布答案。'
node dist/src/main.js --tasks
node --env-file=.env dist/src/main.js --watch
```

一次扫描用`--sweep`，持续运行用`--watch`，只启动一个扫描进程。
Ctrl+C等当前批次结束后退出；退出不删除任务。once可换成周期毫秒，但会持续
请求模型并收费，建议先体验一次任务。周期漏跑只补一轮，不补发所有错过的轮次。
第13课调度和自动模型执行都在宿主，当时容器处理器未改，镜像继续lesson12。
第13课阶段尚无取消任务或自动恢复命令；第14课补上有限恢复，仍不支持取消任务。
完整说明见[第13课教案](tutorial/教案/第13课-让消息按时间自动触发.md)。

## 第14课：有限重试、原消息恢复与安全文件

真实模型连接错误、429/5xx最多三次请求，等待100/200ms；401等不自动重试。
任务执行失败保存failures/retry_at，临时错误最多三轮，其他错误直接failed，
不会让失败任务打断整个扫描。--tasks展示状态；修复后--retry-task编号再扫描。
本轮next_run保持不变，恢复时不会另造一条输入或重复写会话记忆。

宿主中央库保存receipts及目标快照，邮箱source_key唯一。--recover恢复所有
pending凭据，沿用原角色、正文和上一句；已经成功处理/投递的部分正常不重做。
重新键入相同文字仍是新输入，不是恢复。升级前旧输入无凭据，仍用旧分段命令。

```bash
pnpm build
node dist/src/main.js --wire 文件课堂 Teacher mention '@Teacher' '你是耐心的TypeScript老师，用中文讲解笔记。'
pnpm start:model
```

输入`[文件课堂] @Teacher /file 示例笔记.md 用两句话总结`，宿主只读取
attachments内的普通.md/.txt UTF-8文件（最多16KiB），拒绝路径跳转与链接，
把文本快照交给模型。不挂载原附件给容器，私人附件默认Git忽略。
收信后稍后执行可用--receive，再运行：

```bash
node --env-file=.env dist/src/main.js --recover
```

--recover会处理所有未完成凭据并可能收费；不是只读状态命令，也不更新任务账目。
手动重启任务用`node dist/src/main.js --retry-task 1`后加载.env执行--sweep。
不要并发启动扫描与恢复。当前短重试与任务预算可能相乘为每个目标最多九次
自动HTTP请求；永久错误不重试，人工恢复是另一次明确尝试。

容器运行前重建lesson14镜像，它新增retry.js依赖，仍只挂载原输入和输出。
正常重复不重发不代表所有崩溃下恰好一次：API成功但出站未保存、终端输出但确认
未提交，仍可能重复。完整数据与边界见
[第14课教案](tutorial/教案/第14课-失败恢复与安全文件消息.md)。

## 第15课：周期审批、只读状态与运行日志

```bash
pnpm build
node --env-file=.env dist/src/main.js --status
node dist/src/main.js --tasks
```

status不建库、不迁移、不请求模型，只显示配置有效性与中央统计，不输出密钥/
正文；它不证明云端可用或watch正在运行。新周期任务登记为awaiting_approval，
一次任务仍pending；旧任务不自动改状态。先停止watch，用实际任务ID管理：

```bash
node dist/src/main.js --approve-task 1
node dist/src/main.js --pause-task 1
```

批准后才扫描，暂停后可用approve恢复；暂停不取消在途请求、不清理邮箱，
显式recover仍可能请求模型。权限只假设可信本地所有者，不提供多用户认证。
查看tasks并批准所需任务之后，只启动一个扫描进程：

```bash
LOG_LEVEL=info node --env-file=.env dist/src/main.js --watch
```

LOG_LEVEL默认off，info将固定事件写stderr；可自行追加到私人.env，新示例不会
改变已有配置。stdout仍输出模型回复。结构化事件脱敏不代表所有异常和业务输出
都脱敏，分享前仍须检查。容器处理器未改，继续lesson14镜像。

详见[第15课教案](tutorial/教案/第15课-整理成可配置可部署可理解的系统.md)与
[最终心智模型](tutorial/参考/最终心智模型.md)。最终仍需学生真实模型验收、复述
系统链、提问、手动commit，不把15课代码生成视为学生自动结课。
