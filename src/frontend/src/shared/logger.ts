/**
 * Frontend logging bridge: mirrors errors to the console and to the desktop
 * file log (`logs/quick-snippets.log`) via the `log_frontend` command.
 */

import { api } from "./ipc";

/** Logs an error with a scope tag to the console and the file log. */
export function logError(scope: string, e: unknown): void {
  console.error(scope, e);
  void api.logLine("WEB", `${scope}: ${String(e)}`);
}
