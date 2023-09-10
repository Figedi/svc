import { pino, type Logger as PinoLogger, type LoggerOptions as PinoLoggerOptions } from "pino";

export interface LoggerBaseProperties {
    service: string;
    env: string;
}
export interface LoggerOptions<BaseProperties extends LoggerBaseProperties> {
    level: PinoLoggerOptions["level"];
    base: BaseProperties;
}

export type Logger = PinoLogger;

export const createLogger = <T extends LoggerBaseProperties>(opts: LoggerOptions<T>): PinoLogger =>
    pino({
        level: opts.level,
        redact: {
            paths: ["*.password", "password", "*.token", "token", "*.secret", "secret"],
            censor: "[Filtered]",
        },
        base: opts.base,
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    });

export const createStubbedLogger = (): PinoLogger => pino({ enabled: false });
