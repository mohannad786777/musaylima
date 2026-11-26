# يُبنى من جذر المستودع:  docker build -f mcp-server/Dockerfile -t musaylima-mcp .
FROM node:22-alpine
WORKDIR /app
COPY data.json.gz /app/data.json.gz
COPY mcp-server/server.js mcp-server/package.json /app/mcp-server/
ENV DATA_PATH=/app/data.json.gz PORT=8787 NODE_ENV=production
EXPOSE 8787
CMD ["node", "/app/mcp-server/server.js"]
