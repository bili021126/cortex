export enum LogLevel { Debug=0, Info=10, Warn=20, Error=30, Fatal=40 }
export const LOG_LEVEL_PRIORITY: Record<LogLevel,number> = { [LogLevel.Debug]:0, [LogLevel.Info]:10, [LogLevel.Warn]:20, [LogLevel.Error]:30, [LogLevel.Fatal]:40 };
export const LOG_LEVEL_LABELS: Record<LogLevel,string> = { [LogLevel.Debug]:"DEBUG", [LogLevel.Info]:"INFO", [LogLevel.Warn]:"WARN", [LogLevel.Error]:"ERROR", [LogLevel.Fatal]:"FATAL" };
export type LogLevelValue = LogLevel | number;
