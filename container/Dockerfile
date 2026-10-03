FROM node:22-bookworm-slim

# 镜像只带处理器所需的三份 JS 和 ESM 声明，不复制宿主源码或私人数据。
WORKDIR /app
COPY package.json ./package.json
COPY dist/src/agent-runner.js dist/src/processor.js dist/src/reply.js ./
USER node
ENTRYPOINT ["node", "/app/agent-runner.js"]
