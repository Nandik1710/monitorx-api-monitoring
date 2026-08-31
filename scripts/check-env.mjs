import { existsSync } from "node:fs";

if (!existsSync(".env")) {
  console.warn(
    "No .env file found. Runtime defaults are safe for health-only development, but local services need .env before product work.",
  );
}
