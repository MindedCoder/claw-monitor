FROM node:22-alpine
WORKDIR /app
COPY server.js .
COPY providers/ providers/
EXPOSE 4180
CMD ["node", "server.js"]
