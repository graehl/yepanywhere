#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const role = process.argv[process.argv.indexOf("--filter") + 1]
  .split("/")
  .pop();
appendFileSync(
  process.env.YA_TEST_WRAPPER_EVENTS,
  `${JSON.stringify({
    role,
    pid: process.pid,
    port: process.env.YEP_DEV_WRAPPER_PORT,
    token: process.env.YEP_DEV_WRAPPER_TOKEN,
  })}\n`,
);
setInterval(() => {}, 1000);
