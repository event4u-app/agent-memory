import pino from "pino";
import { config } from "../config.js";

// Write logs to stderr so CLI stdout remains clean for machine-readable output
// (e.g. `memory status` → `present|absent|misconfigured`).
export const logger = pino(
  {
    level: config.log.level,
    transport:
      config.log.format === "pretty"
        ? { target: "pino-pretty", options: { colorize: true, destination: 2 } }
        : undefined,
  },
  config.log.format === "pretty" ? undefined : pino.destination(2),
);
