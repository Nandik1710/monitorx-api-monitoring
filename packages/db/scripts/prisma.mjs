import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    cwd: new URL("..", import.meta.url),
    env: process.env,
  },
);
process.exit(result.status ?? 1);
