import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome } from './chrome.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A minimal CDP client over headless Chrome. Node's built-in fetch and WebSocket are
 * enough — no puppeteer dependency, nothing to install, the same on CI and a laptop.
 */
export class Browser {
  private proc: ChildProcess;
  private port: number;
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private loadWaiters: (() => void)[] = [];
  /** Console and page errors observed since the last navigation. */
  errors: string[] = [];

  private constructor(proc: ChildProcess, port: number) {
    this.proc = proc;
    this.port = port;
  }

  static async launch(): Promise<Browser> {
    const port = 9500 + Math.floor(Math.random() * 400);
    const proc = spawn(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--no-first-run',
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        '--window-size=1500,980',
        `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ingot-e2e-chrome-'))}`,
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const b = new Browser(proc, port);
    await b.connect();
    return b;
  }

  private async connect(): Promise<void> {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('chrome did not expose a debugging target');

    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('cdp socket failed')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push(String(m.params.entry.text));
      } else if (m.method === 'Page.loadEventFired') {
        for (const w of this.loadWaiters.splice(0)) w();
      }
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    // The guided tour auto-starts once per fresh profile and would race the scenarios —
    // its step 3 runs a scan of its own. The flag is set before any page script runs.
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('ingot-tour-done', '1'); } catch {}`,
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(++this.id, { resolve, reject });
      this.ws.send(JSON.stringify({ id: this.id, method, params }));
    });
  }

  /** Evaluates in the page, awaiting promises, returning the JSON value. */
  async eval<T>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value;
  }

  async goto(url: string): Promise<void> {
    this.errors = [];
    const loaded = new Promise<void>((r) => this.loadWaiters.push(r));
    await this.send('Page.navigate', { url });
    await loaded;
  }

  /** Polls an in-page expression until truthy or the deadline passes. */
  async waitFor(expression: string, timeoutMs = 20000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.eval<boolean>(`!!(${expression})`)) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
    this.proc.kill();
  }
}
