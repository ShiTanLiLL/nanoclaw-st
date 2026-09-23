# NanoClaw 渐进式复现项目

这是一个按需求逐课重新发明 NanoClaw 核心链路的教学项目，不是原项目的副本。

当前只完成第 1 课的最小起点：从标准输入读取一段文本，输出确定的本地回复。
课程资料位于 [`tutorial/`](./tutorial/)；最高优先级规则记录在工作区上级传入的
规范文件中，并由 [`工作守则.md`](./工作守则.md) 摘要维护。

## 当前运行

需要 Node.js 22+ 和 pnpm 10+。依赖安装后：

```bash
pnpm test
printf '你好，NanoClaw\n' | pnpm start
```

当前不会调用网络、模型或 Docker。
