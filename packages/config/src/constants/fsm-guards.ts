/** FSM Guard 默认阈值——可通过 JSON 配置覆写 */
export const FSM_ARCHIVE_WEIGHT_THRESHOLD = 0.5;   // canArchive: weight < 此值
export const FSM_RESTORE_ACCESS_THRESHOLD = 0;      // canRestore: accessCount > 此值
export const FSM_OBLITERATE_DAYS_THRESHOLD = 365;   // canObliterate: daysSinceLastAccess > 此值
