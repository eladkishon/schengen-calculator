# Lets MCP directories (Glama) build the stdio server and list its tools.
FROM node:22-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts && npx tsc
ENTRYPOINT ["node", "./dist/mcp.js"]
