const globalState = globalThis.__lowdbWriteQueueState || new Map();

if (!globalThis.__lowdbWriteQueueState) {
  globalThis.__lowdbWriteQueueState = globalState;
}

function getQueueKey(filePath) {
  return filePath || "__default__";
}

export async function waitForLowDbWrites(filePath) {
  const pending = globalState.get(getQueueKey(filePath));
  if (!pending) return;
  await pending.catch(() => {});
}

export function wrapLowDbWrite(db, filePath, ensureDir) {
  if (!db || db.__hasSerializedWrite) return db;

  const originalWrite = db.write.bind(db);
  const queueKey = getQueueKey(filePath);

  db.write = async (...args) => {
    const previous = globalState.get(queueKey) || Promise.resolve();
    const runWrite = async () => {
      ensureDir?.();
      try {
        return await originalWrite(...args);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        ensureDir?.();
        return await originalWrite(...args);
      }
    };

    const next = previous.catch(() => {}).then(runWrite);
    globalState.set(
      queueKey,
      next.catch(() => {}),
    );
    return next;
  };

  Object.defineProperty(db, "__hasSerializedWrite", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return db;
}
