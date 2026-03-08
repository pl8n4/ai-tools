# Canvas MCP Server

An MCP (Model Context Protocol) server that connects Claude to your Canvas LMS account, giving Claude real-time access to your courses, assignments, grades, and more — so it can actually help you manage your workload without you having to paste anything in.

## What It Does

- **Reads your active courses** and enrollment info
- **Shows upcoming assignments** across all courses with due dates
- **Reports your current grades** and submission status
- **Surfaces announcements**, modules, syllabi, and Canvas to-do items
- **Lists course files and attachments** and can extract readable text from PDFs and text-based documents
- **Gives Claude enough context** to help you plan your week, prioritize tasks, and study smarter

## Who It's For

Any student using Canvas LMS who wants an AI study assistant that's actually aware of their coursework in real time.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Claude Desktop](https://claude.ai/download) app
- A Canvas LMS account with API access

> **Note:** PDF extraction is powered by `pdf-parse` and is best run on Node.js 20+.

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/pl8n4/ai-tools.git
cd ai-tools/mcp-canvas-lms
npm install
npm run build
```

### 2. Get a Canvas API Token

1. Log in to your school's Canvas instance
2. Go to **Account → Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Name it (e.g., "Claude MCP"), generate, and **copy the token immediately** — it won't be shown again

> **Note:** Some institutions restrict students from generating API tokens. If you don't see the option, check with your school's IT department.

### 3. Configure Claude Desktop

Open your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `canvas` entry under `mcpServers` (create the `mcpServers` key if it doesn't exist):

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-mcp/dist/index.js"],
      "env": {
        "CANVAS_API_TOKEN": "your_canvas_api_token",
        "CANVAS_BASE_URL": "https://yourschool.instructure.com"
      }
    }
  }
}
```

Replace:
- `/absolute/path/to/canvas-mcp/dist/index.js` with the actual path to the built file on your machine
- `your_canvas_api_token` with the token you generated in step 2
- `https://yourschool.instructure.com` with your school's Canvas URL

### 4. Restart Claude Desktop

Fully quit (`⌘Q` on Mac) and reopen. The Canvas tools should appear in the 🔨 tool picker.

## Available Tools

| Tool | Description |
|---|---|
| `get_courses` | List active courses with grades |
| `get_assignments` | Get assignments for a course (filter: upcoming, past, overdue, unsubmitted, all) |
| `get_upcoming_deadlines` | Deadlines in the next N days across all courses (default: 30 days) |
| `get_grades` | Current grades/scores for all courses |
| `get_course_modules` | Module structure and completion status |
| `get_announcements` | Recent instructor announcements |
| `get_submission_status` | Check if you've submitted an assignment + grade |
| `get_syllabus` | Get the syllabus for a course |
| `get_todo_items` | Canvas's built-in to-do list |
| `list_course_files` | List course files/attachments with file IDs |
| `get_file_content` | Read PDFs and text-like attachments into plain text |

## Example Prompts

- *"What courses am I taking this semester?"*
- *"What's due this week?"*
- *"What are my current grades?"*
- *"Show me the modules for my CS course"*
- *"Have I submitted the latest homework for [course]?"*
- *"List the files in my Biology course"*
- *"Read file 12345 from course 67890"*
- *"Help me plan my study schedule for the next two weeks"*

## How It Works

This server uses the **stdio** transport — Claude Desktop launches it as a local process on your machine and communicates over stdin/stdout. Your Canvas API token never leaves your computer.

```
Claude Desktop  ←── stdio (MCP) ──→  canvas-mcp  ←── HTTPS ──→  Canvas API
```

## Attachment Support

This server can now bridge one of the main Claude Desktop gaps with Canvas:

- It can list course files and attachment metadata
- It can read **PDFs** and extract plain text for Claude
- It can also read **text-based files** like `.txt`, `.md`, `.csv`, `.json`, `.html`, and `.xml`
- Unsupported binary formats such as `.docx`, `.pptx`, images, and spreadsheets are still listed, but their contents are not extracted yet

This means Claude can collaborate on professor-uploaded PDFs directly through the MCP server instead of requiring manual copy/paste.

## Resources

The server exposes:

- `canvas://dashboard` for a combined overview of courses, grades, upcoming deadlines, and to-do items
- `canvas://courses/{course_id}/files/{file_id}` for readable attachment content when the file is a PDF or text-like document

## Security

- Your API token is stored locally in the Claude Desktop config and passed as an environment variable — it is **never sent to Claude's servers**
- The server is **read-only** — it cannot submit assignments, post discussions, or modify anything in Canvas
- Treat your API token like a password. If compromised, revoke it immediately in Canvas under Account → Settings → Approved Integrations
