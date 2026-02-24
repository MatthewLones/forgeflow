FROM node:22-slim

# Install the Claude Agent SDK globally
RUN npm install -g @anthropic-ai/claude-agent-sdk

# Create workspace directory (will be overridden by volume mount)
RUN mkdir -p /workspace

# Copy entrypoint script
COPY entrypoint.mjs /opt/forgeflow/entrypoint.mjs

WORKDIR /workspace

# Entrypoint reads config from /workspace/.forgeflow-config.json
# and prompt from /workspace/.forgeflow-prompt.md
ENTRYPOINT ["node", "/opt/forgeflow/entrypoint.mjs"]
