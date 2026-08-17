#!/usr/bin/env node

import { main } from "../lib/cli/main.js";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`dsh-plugins-extra: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
