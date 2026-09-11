const DATABASE_NAME = "clusterca-web";
const DATABASE_VERSION = 1;
const STORE_NAME = "autosaves";
const MAX_REVISIONS = 4;

interface StoredRevision {
  timestamp: number;
  bytes: ArrayBuffer;
}

interface StoredProject {
  projectId: string;
  revisions: StoredRevision[];
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "projectId" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("无法打开自动存档数据库"));
});

export const saveAutosaveRevision = async (projectId: string, source: Uint8Array): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const request = store.get(projectId);
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error);
    });
    const copy = source.slice();
    const revisions = [{ timestamp: Date.now(), bytes: copy.buffer }, ...(existing?.revisions ?? [])].slice(0, MAX_REVISIONS);
    store.put({ projectId, revisions } satisfies StoredProject);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("自动存档事务已中止"));
    });
  } finally {
    database.close();
  }
};

export const loadLatestAutosave = async (projectId: string): Promise<Uint8Array | undefined> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const stored = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const request = transaction.objectStore(STORE_NAME).get(projectId);
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error);
    });
    const latest = stored?.revisions[0];
    return latest ? new Uint8Array(latest.bytes.slice(0)) : undefined;
  } finally {
    database.close();
  }
};
