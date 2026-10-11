import {
  configureSync,
  defaultConsoleFormatter,
  getConsoleSink,
  getLogger,
  resetSync,
} from "@logtape/logtape";
import type { ConsoleFormatter } from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";

interface AppLoggingOptions {
  isDevelopment: boolean;
  enableSentrySink: boolean;
}

export const logger = getLogger(["app"]);

// The default console formatter shows only the message. It hides properties such as the request
// method, path, and email recipient from operators who read stdout. The Sentry sink still receives them.
export const consoleFormatter: ConsoleFormatter = record =>
  Object.keys(record.properties).length === 0
    ? defaultConsoleFormatter(record)
    : [...defaultConsoleFormatter(record), record.properties];

export function configureAppLogging({ isDevelopment, enableSentrySink }: AppLoggingOptions) {
  resetSync();

  const sinks = {
    console: getConsoleSink({ formatter: consoleFormatter }),
    ...(enableSentrySink ? { sentry: getSentrySink() } : {}),
  };

  const loggerSinks = enableSentrySink ? ["console", "sentry"] : ["console"];

  configureSync({
    sinks,
    loggers: [
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
      {
        category: ["app"],
        lowestLevel: isDevelopment ? "debug" : "info",
        sinks: loggerSinks,
      },
    ],
  });
}
