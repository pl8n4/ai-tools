# ai-tools

A collection of tools, MCP servers, and integrations I've built to make LLMs and AI agents more useful in day-to-day life. Everything here is stuff I actually use, made public in case it's useful to others.

## What's Here

| Tool | Description | Status |
|---|---|---|
| [mcp-canvas-lms](./mcp-canvas-lms) | MCP server that connects Claude to Canvas LMS — courses, assignments, grades, deadlines | ✅ Working |

## What's an MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI assistants like Claude connect to external tools and data sources. Instead of copy-pasting information into a chat, the AI can pull what it needs directly.

## Structure

Each tool lives in its own directory with its own README, dependencies, and setup instructions. Check the individual READMEs for details.

```
ai-tools/
├── mcp-canvas-lms/  # Canvas LMS → Claude connector
└── ...             # More to come
```
