// [EM-START: db-reconnect]
/**
 * 启动时成批读库的兜底：一次读失败，先换一条新连接、稍等一下再读一次，还不行才降级。
 *
 * 成批读的时候往往是同一条坏连接让后面七八个读一起失败，所以重连只做一次（共享同一个 promise），
 * 大家一起等它，然后各自重读。
 */
export const createReconnectingReader = (
    reset: () => Promise<void>,
    { delayMs = 300 }: { delayMs?: number } = {},
) => {
    let reconnecting: Promise<void> | null = null;
    const reconnectOnce = () => {
        reconnecting ??= reset().catch(() => {}).then(() => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
        return reconnecting;
    };
    return async <T>(read: () => Promise<T>, onRetry?: (error: unknown) => void): Promise<T> => {
        try {
            return await read();
        } catch (error) {
            onRetry?.(error);
            await reconnectOnce();
            return read();
        }
    };
};
// [EM-END: db-reconnect]
