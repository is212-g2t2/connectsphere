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

// The default console formatter renders only the message, so the properties
// that callers attach (request method and path, email recipient, …) are
// visible to the Sentry sink but never to the operator reading stdout.
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
