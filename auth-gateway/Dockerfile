FROM registry.cn-hangzhou.aliyuncs.com/library/node:22-alpine
WORKDIR /app
COPY auth-gateway/server.js .
COPY auth-gateway/providers/ providers/
EXPOSE 4180
CMD ["node", "server.js"]
