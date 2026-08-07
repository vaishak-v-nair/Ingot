import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.gz': 'application/octet-stream',
};

/**
 * Serves an assembled site directory on an ephemeral localhost port. Bytes go out as-is
 * — no Content-Encoding games — matching how the production host serves the index files,
 * which the page decompresses itself.
 */
export function serveSite(dir: string): Promise<{ port: number; close: () => void }> {
  const srv = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = normalize(join(dir, path === '/' ? 'index.html' : path.slice(1)));
    if (!file.startsWith(normalize(dir)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        close: () => srv.close(),
      });
    });
  });
}
