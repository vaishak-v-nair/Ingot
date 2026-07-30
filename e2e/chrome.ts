import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Finds a Chrome or Chromium binary across the machines this suite runs on: a developer
 * laptop on any OS, and the ubuntu CI runner (which ships Google Chrome preinstalled).
 * CHROME_PATH always wins, so an unusual install is one env var away from working.
 */
export function findChrome(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const fixed =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [];
  for (const c of fixed) if (c && existsSync(c)) return c;

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']) {
    try {
      const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\r?\n/)[0];
      if (found && existsSync(found)) return found;
    } catch {
      /* keep looking */
    }
  }
  throw new Error('no Chrome or Chromium found — set CHROME_PATH');
}
