import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as http from 'node:http';
import * as https from 'node:https';

let child: ChildProcessWithoutNullStreams | null = null;
let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;

function log(line: string) {
  if (!output) output = vscode.window.createOutputChannel('MCP Runner');
  output.appendLine(line);
}

function isRunning(): boolean {
  return !!child && !child.killed;
}

function fileExists(p: string): boolean {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

function dirExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function whichSync(cmd: string): string | null {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.EXE','.CMD','.BAT']) : [''];
  const paths = (process.env.PATH ?? '').split(path.delimiter);
  for (const p of paths) {
    for (const ext of exts) {
      const full = path.join(p, cmd + ext);
      if (fileExists(full)) return full;
    }
  }
  return null;
}

async function waitForUrl(u: string, timeoutMs = 5000, intervalMs = 250): Promise<boolean> {
  if (!u) return true;
  const end = Date.now() + timeoutMs;
  const parsed = new url.URL(u);
  const lib = parsed.protocol === 'https:' ? https : http;

  async function pingOnce(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = lib.request(
        { method: 'GET', hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout: Math.min(2000, timeoutMs) },
        (res) => { res.resume(); resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500); }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
      req.end();
    });
  }

  while (Date.now() < end) {
    if (await pingOnce()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

async function resolveCommand(initialCmd: string | undefined): Promise<{cmd: string, note?: string}> {
  // If explicitly set and exists → use it
  if (initialCmd && (fileExists(initialCmd) || whichSync(initialCmd))) {
    return { cmd: initialCmd };
  }
  // Try uv, then python
  const uv = whichSync('uv');
  if (uv) return { cmd: uv, note: 'Falling back to system uv' };
  const py = whichSync('python3') ?? whichSync('python');
  if (py) return { cmd: py, note: 'Falling back to system python' };
  throw new Error('No valid command found. Set "mcpRunner.command" in settings to an existing executable (e.g., /usr/bin/python or /path/to/.venv/bin/python).');
}

async function startServer() {
  if (isRunning()) {
    vscode.window.showInformationMessage('MCP server already running.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('mcpRunner');
  const configuredCommand = cfg.get<string>('command') || '';
  const args = cfg.get<string[]>('args') || [];
  const cwd = cfg.get<string>('cwd') || process.cwd();
  const env = cfg.get<Record<string, string>>('env') || {};
  const readyPattern = cfg.get<string>('readyPattern') || '';
  const killSignal = (cfg.get<string>('killSignal') || 'SIGTERM') as NodeJS.Signals;
  const waitUrlSetting = cfg.get<string>('waitUrl') || ''; // optional: e.g. http://localhost:8000/

  output = vscode.window.createOutputChannel('MCP Runner');
  output.show(true);

  // Validate cwd
  if (!dirExists(cwd)) {
    const msg = `mcpRunner.cwd does not exist: ${cwd}`;
    log(msg);
    vscode.window.showErrorMessage(msg);
    return;
  }

  // Resolve command (with fallback)
  let resolvedCmd: string;
  try {
    const r = await resolveCommand(configuredCommand);
    resolvedCmd = r.cmd;
    if (r.note) log(`[resolver] ${r.note}: ${resolvedCmd}`);
  } catch (err: any) {
    const msg = `Failed to resolve command: ${err?.message ?? err}`;
    log(msg);
    vscode.window.showErrorMessage(msg);
    return;
  }

  // If using system python and args look like ["run","main.py"], patch to ["main.py"]
  let finalArgs = [...args];
  if (path.basename(resolvedCmd).startsWith('python') && finalArgs.length >= 2 && finalArgs[0] === 'run') {
    finalArgs = [finalArgs[1], ...finalArgs.slice(2)];
    log(`[args] Detected python; adjusted args to: ${finalArgs.join(' ')}`);
  }

  log(`Starting MCP server: ${resolvedCmd} ${finalArgs.join(' ')} (cwd=${cwd})`);

  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };

  child = spawn(resolvedCmd, finalArgs, {
    cwd,
    env: childEnv,
    shell: false,
    stdio: 'pipe'
  });

  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'mcpRunner.showLogs';
    statusBar.show();
  }
  statusBar.text = `$(play) MCP: Starting...`;
  statusBar.tooltip = `Launching: ${resolvedCmd} ${finalArgs.join(' ')}`;

  const readyRegex = readyPattern ? new RegExp(readyPattern) : null;
  let readyShown = false;

  const onData = (data: Buffer, stream: 'stdout' | 'stderr') => {
    const text = data.toString();
    text.split(/\r?\n/).forEach(line => {
      if (!line) return;
      log(`[${stream}] ${line}`);
      if (!readyShown && readyRegex && readyRegex.test(line)) {
        readyShown = true;
        statusBar.text = `$(server) MCP: Running`;
        statusBar.tooltip = `MCP server is running`;
        vscode.window.setStatusBarMessage('MCP server is ready', 2500);
      }
    });
  };

  child.stdout.on('data', (d) => onData(d, 'stdout'));
  child.stderr.on('data', (d) => onData(d, 'stderr'));

  child.on('error', (err) => {
    log(`[proc] error: ${err.message}`);
    vscode.window.showErrorMessage(`MCP server failed to start: ${err.message}`);
    statusBar.text = `$(error) MCP: Error`;
  });

  child.on('exit', (code, signal) => {
    log(`[proc] exit code=${code} signal=${signal ?? ''}`);
    if (statusBar) statusBar.text = `$(debug-stop) MCP: Stopped`;
    child = null;
  });

  // Fallback readiness: URL ping or delayed "running"
  (async () => {
    if (waitUrlSetting) {
      log(`[waitUrl] Pinging ${waitUrlSetting}...`);
      const ok = await waitForUrl(waitUrlSetting, 8000, 300);
      if (ok) {
        readyShown = true;
        statusBar.text = `$(server) MCP: Running`;
        statusBar.tooltip = `MCP server is running (URL ok)`;
        vscode.window.setStatusBarMessage('MCP server is ready (URL)', 2500);
        log(`[waitUrl] Up: ${waitUrlSetting}`);
      } else {
        log(`[waitUrl] Timeout waiting for: ${waitUrlSetting}`);
      }
    } else {
      // If we never detect readiness, still mark Running after a small delay so UI is usable
      setTimeout(() => {
        if (isRunning() && !readyShown) {
          statusBar.text = `$(server) MCP: Running`;
          statusBar.tooltip = `MCP server (no readyPattern match yet)`;
        }
      }, 2500);
    }
  })();
}

async function stopServer() {
  if (!isRunning()) {
    vscode.window.showInformationMessage('MCP server is not running.');
    return;
  }
  const cfg = vscode.workspace.getConfiguration('mcpRunner');
  const killSignal = (cfg.get<string>('killSignal') || 'SIGTERM') as NodeJS.Signals;

  log(`Stopping MCP server with ${killSignal}...`);
  try {
    child?.kill(killSignal);
  } catch (e: any) {
    log(`Error sending ${killSignal}: ${e?.message ?? e}`);
  }
}

async function restartServer() {
  await stopServer();
  setTimeout(() => { startServer(); }, 600);
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('MCP Runner');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'mcpRunner.showLogs';
  statusBar.text = `$(debug-stop) MCP: Stopped`;
  statusBar.tooltip = 'MCP server status';
  statusBar.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('mcpRunner.start', startServer),
    vscode.commands.registerCommand('mcpRunner.stop', stopServer),
    vscode.commands.registerCommand('mcpRunner.restart', restartServer),
    vscode.commands.registerCommand('mcpRunner.showLogs', () => output.show(true)),
    statusBar
  );

  const autoStart = vscode.workspace.getConfiguration('mcpRunner').get<boolean>('autoStart') ?? true;
  if (autoStart) startServer();
}

export function deactivate() {
  if (isRunning()) {
    try { child?.kill('SIGTERM'); } catch {}
  }
}
