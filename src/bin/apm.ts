#!/usr/bin/env node
import { buildProgram } from '../cli/program.js';

buildProgram().parseAsync(process.argv).catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n');
  process.exit(75);
});
