// [EM-START: inbox-first-delivery]
interface InboxDelivery {
  receivedAt?: number;
  receivedWhileVisible?: boolean;
  metadata?: Record<string, any>;
}

/** Used inside the same read/write transaction as the delivery upsert, in both page and SW. */
export function mergeInboxDelivery<T extends InboxDelivery>(incoming: T, existing?: T): T {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    receivedAt: Number.isFinite(existing.receivedAt) && existing.receivedAt! > 0
      ? existing.receivedAt : incoming.receivedAt,
    receivedWhileVisible: typeof existing.receivedWhileVisible === 'boolean'
      ? existing.receivedWhileVisible : incoming.receivedWhileVisible,
    metadata: {
      ...existing.metadata,
      ...incoming.metadata,
      ...((existing.metadata?.amsgOutboxBackfill === true || incoming.metadata?.amsgOutboxBackfill === true)
        ? { amsgOutboxBackfill: true } : {}),
    },
  };
}
// [EM-END: inbox-first-delivery]
