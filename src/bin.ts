#!/usr/bin/env node
/**
 * Published CLI entry point.
 *
 * Separate from cli.ts because the bundled binary must always run, where cli.ts guards on
 * `import.meta.filename === process.argv[1]` so it can also be imported by tests. Comparing
 * paths is exactly the kind of thing that works everywhere except one platform.
 */
import { main } from './cli.ts';

await main();
