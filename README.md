# MCP Runner VS Code Extension

MCP Runner is a Visual Studio Code extension that lets you start, stop, and monitor a **Model Context Protocol (MCP) server** directly from inside VS Code.  
It is designed for local development of MCP servers (e.g., written in Python with `uv` or `uvicorn`) and integrates with the VS Code status bar + output panel.

---

## 📦 Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/mcp-runner.git
cd mcp-runner
```

### 2. Install dependencies

```bash
npm install
```

This installs TypeScript, VS Code extension APIs, and build tools.

### 3. Compile the extension

```bash
npm run compile
```

This runs `tsc` (TypeScript compiler) and outputs to `out/`.

---

## ▶ Running the Extension in VS Code

1. Open the project folder in VS Code:

   ```bash
   code .
   ```

2. Press **F5** or run **Debug: Start Debugging** from the Command Palette.  
   This opens a new **Extension Development Host** window.

3. In the development host:
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   - Search for:
     - **MCP Runner: Start** → starts your server
     - **MCP Runner: Stop** → stops the server
     - **MCP Runner: Restart** → restarts the server
     - **MCP Runner: Show Logs** → shows server logs

---

## ⚙ Configuration

By default, MCP Runner uses the following settings in your **User Settings (`settings.json`)**:

```json
{
  "mcpRunner.command": "/home/youruser/workspace/mcp-server/.venv/bin/python",
  "mcpRunner.args": ["main.py"],
  "mcpRunner.cwd": "/home/youruser/workspace/mcp-server"
}
```

- `mcpRunner.command`: Path to your Python or uv binary.
- `mcpRunner.args`: Arguments to pass (`main.py`, or `uv run main.py`).
- `mcpRunner.cwd`: Working directory where your MCP server lives.

You can edit these in **File → Preferences → Settings → Extensions → MCP Runner**.

---

## 🚀 Example: Running Your Python MCP Server

If you developed your MCP server in `~/workspace/mcp-server`:

```json
{
  "mcpRunner.command": "/home/osoliman/workspace/mcp-server/.venv/bin/python",
  "mcpRunner.args": ["main.py"],
  "mcpRunner.cwd": "/home/osoliman/workspace/mcp-server"
}
```

Now you can start/stop it directly from VS Code.

---

## 🛠 Development Notes

- This project is generated using `yo code` (VS Code extension generator).
- Written in **TypeScript**.
- Tested on **Linux + VS Code Snap**.
- Logs are redirected to **Output → MCP Runner**.

---

## 📜 License

Copyright© - Omar SOLIMAN