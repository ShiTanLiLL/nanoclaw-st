# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

第 1 课建立了最小单次对话链；当前第 2 课在这条链上增加 `@Andy` 触发判断：
只有被呼叫的消息才产生回复。
课程资料位于 [`tutorial/`](./tutorial/)；最高优先级规则记录在工作区上级传入的
规范文件中，并由 [`工作守则.md`](./工作守则.md) 摘要维护。

## 当前运行

需要 Node.js 22+ 和 pnpm 10+。依赖安装后：

```bash
pnpm test
printf '@Andy 你好，NanoClaw\n' | pnpm start
printf '大家下午三点开会\n' | pnpm start
```

第二次运行只显示输入提示，不显示助手回复。当前不会调用网络、模型或 Docker。
