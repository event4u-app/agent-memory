import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.log.level,
  transport:
    config.log.format === "pretty"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
