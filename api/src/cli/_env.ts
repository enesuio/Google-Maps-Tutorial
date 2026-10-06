import 'dotenv/config';
import { loadConfig, type Config } from '../config.js';

/** Loads .env (if present) and validates the environment for CLI commands. */
export function cliConfig(): Config {
  return loadConfig();
}
