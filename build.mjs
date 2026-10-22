#!/usr/bin/env node
import { build } from "./src/build.mjs";
import { parseArgs, HELP } from "./src/options.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(HELP);
  else await build(options);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
