// eslint-disable-next-line import/no-named-default
import { isFunction } from "lodash-es";
import type { Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from "pino";
import * as pino from "pino";

export interface LoggerBaseProperties {
    service: string;
    env: string;
}
export interface LoggerOptions<BaseProperties extends LoggerBaseProperties> {
    level: PinoLoggerOptions["level"];
    base: BaseProperties;
}

export type Logger = PinoLogger;
export const createLogger = <T extends LoggerBaseProperties>(opts: LoggerOptions<T>): PinoLogger => {
    const pinoFn = (isFunction(pino) ? pino : pino.pino ?? pino.default) as any;
    return pinoFn({
        level: opts.level,
        redact: {
            paths: ["*.password", "password", "*.token", "token", "*.secret", "secret"],
            censor: "[Filtered]",
        },
        base: opts.base,
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    });
};

export const createStubbedLogger = (): PinoLogger => {
    const pinoFn = (isFunction(pino) ? pino : pino.pino ?? pino.default) as any;
    return pinoFn({ enabled: false });
};
