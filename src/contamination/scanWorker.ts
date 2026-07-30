import { loadIndexFromBytes, scanFile } from './browserScan.ts';

/**
 * The scan, off the main thread. A 20 GB corpus takes the better part of an hour, and a
 * page that stutters for an hour is a page nobody trusts with a corpus that size.
 *
 * The worker receives the index as raw bytes (the page already fetched them once —
 * re-fetching here would break the load-then-go-offline story) and the dropped File,
 * streams the scan, and posts progress. Cancel is `worker.terminate()` from the page:
 * no cooperative flags, nothing to leak, the thread simply ends.
 */
self.onmessage = async (e: MessageEvent) => {
  const { indexBytes, file } = e.data as { indexBytes: ArrayBuffer; file: File };
  try {
    const index = await loadIndexFromBytes(new Uint8Array(indexBytes));
    const report = await scanFile(index, file, {
      onProgress: (docs, tokens, bytesRead) =>
        self.postMessage({ type: 'progress', docs, tokens, bytesRead }),
    });
    self.postMessage({ type: 'done', report });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
