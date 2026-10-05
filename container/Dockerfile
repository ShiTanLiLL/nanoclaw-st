FROM node:22-bookworm-slim

# 镜像只带处理器、运行依赖和 ESM 声明，不复制宿主源码或私人数据。
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY dist/src/agent-runner.js dist/src/processor.js dist/src/reply.js dist/src/provider.js dist/src/retry.js ./
USER node
ENTRYPOINT ["node", "/app/agent-runner.js"]
