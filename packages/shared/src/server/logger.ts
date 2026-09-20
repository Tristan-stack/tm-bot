import { pino } from "pino";
import type { DestinationStream, Logger } from "pino";
import { PinoPretty } from "pino-pretty";
import { loadDotenvOnce } from "./dotenv.js";
import { CENSOR, SECRET_ENV_VARIABLES, scrubError, scrubSecrets } from "./scrub.js";

export type { Logger };

export type LoggerOptions = {
  /** Where log lines go. Defaults to stdout: JSON in production, pino-pretty otherwise. */
  destination?: DestinationStream;
  /** Defaults to LOG_LEVEL, then `info`. */
  level?: string;
};

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const SECRET_KEYS = [
  ...SECRET_ENV_VARIABLES,
  "token",
  "botToken",
  "password",
  "secretKey",
  "encSecretKey",
  "privateKey",
  "seed",
  "seedPhrase",
  "mnemonic",
  "encMnemonic",
  "iv",
  "authTag",
  "mnemonicIv",
  "mnemonicAuthTag",
  "initData",
];

// pino wildcards match one level only: the keys are listed at the root and two levels deep.
const REDACT_PATHS = [
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers["x-telegram-init-data"]',
  "req.headers.authorization",
  'headers["x-telegram-init-data"]',
  "headers.authorization",
];

function resolveLevel(requested: string | undefined): string {
  const level = requested ?? process.env["LOG_LEVEL"] ?? "info";
  return (LOG_LEVELS as readonly string[]).includes(level) ? level : "info";
}

function defaultDestination(): DestinationStream {
  if (process.env["NODE_ENV"] === "production") return process.stdout;
  // Used as a stream, not as a worker transport, so lines can be scrubbed first.
  return PinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" });
}

/**
 * Three layers: `redact` censors known secret keys of logged objects, the `err` serializer
 * keeps the name and the message of an error only (no stack, and none of its own fields:
 * `GrammyError.payload` holds user input), then every serialized line goes through
 * scrubSecrets before it is written.
 * Processes use createLogger; this one is exported for tests that capture the output.
 */
export function createRootLogger(options: LoggerOptions = {}): Logger {
  loadDotenvOnce();
  const destination = options.destination ?? defaultDestination();
  const scrubbed: DestinationStream = {
    write: (line) => destination.write(scrubSecrets(line)),
  };
  return pino(
    {
      level: resolveLevel(options.level),
      redact: { paths: REDACT_PATHS, censor: CENSOR },
      serializers: { err: scrubError },
    },
    scrubbed,
  );
}

let root: Logger | undefined;
let captured: DestinationStream | undefined;

/**
 * Test seam: redirects what every logger of createLogger writes, scrubbing included, until
 * it is called again with `undefined`. The switch sits at the destination, so it also covers
 * the loggers that modules built when they were imported, and their children.
 */
export function setLogDestination(destination: DestinationStream | undefined): void {
  captured = destination;
}

/** Child logger tagged `{ module: name }`. All processes log through it: `console` is banned. */
export function createLogger(name: string): Logger {
  if (root === undefined) {
    const fallback = defaultDestination();
    root = createRootLogger({
      destination: { write: (line) => (captured ?? fallback).write(line) },
    });
  }
  return root.child({ module: name });
}
