const ATTACHMENT_DATABASE_NAME = "recall.capture-attachments.v1";
const ATTACHMENT_DATABASE_VERSION = 1;
const ATTACHMENT_OBJECT_STORE = "attachments";

export type AttachmentRecord = {
  blob: Blob;
  blobKey: string;
  createdAt: string;
};

export type AttachmentMetadata = {
  blobKey: string;
  byteSize: number;
  createdAt: string;
  mimeType: string;
};

export interface AttachmentPersistence {
  delete(blobKey: string): Promise<void>;
  get(blobKey: string): Promise<AttachmentRecord | null>;
  list(): Promise<AttachmentRecord[]>;
  put(record: AttachmentRecord): Promise<void>;
}

export interface AttachmentStore {
  deleteAttachment(blobKey: string): Promise<void>;
  deleteOrphanedAttachments(
    referencedKeys: ReadonlySet<string>,
    olderThan: Date,
  ): Promise<string[]>;
  getAttachment(blobKey: string): Promise<Blob | null>;
  listAttachmentMetadata(): Promise<AttachmentMetadata[]>;
  putAttachment(blobKey: string, blob: Blob): Promise<void>;
}

export class AttachmentStoreUnavailableError extends Error {
  constructor(message = "IndexedDB is unavailable for the attachment outbox") {
    super(message);
    this.name = "AttachmentStoreUnavailableError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

class IndexedDbAttachmentPersistence implements AttachmentPersistence {
  readonly #databaseName: string;
  readonly #factory: IDBFactory | undefined;
  #databasePromise: Promise<IDBDatabase> | null = null;

  constructor(input: {
    databaseName: string;
    indexedDbFactory: IDBFactory | undefined;
  }) {
    this.#databaseName = input.databaseName;
    this.#factory = input.indexedDbFactory;
  }

  #database(): Promise<IDBDatabase> {
    if (!this.#factory) {
      throw new AttachmentStoreUnavailableError();
    }
    this.#databasePromise ??= new Promise((resolve, reject) => {
      const request = this.#factory!.open(
        this.#databaseName,
        ATTACHMENT_DATABASE_VERSION,
      );
      request.addEventListener(
        "upgradeneeded",
        () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(ATTACHMENT_OBJECT_STORE)) {
            database.createObjectStore(ATTACHMENT_OBJECT_STORE, {
              keyPath: "blobKey",
            });
          }
        },
        { once: true },
      );
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Unable to open attachment IndexedDB")),
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => reject(new Error("Attachment IndexedDB upgrade is blocked")),
        { once: true },
      );
    });
    return this.#databasePromise;
  }

  async delete(blobKey: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      ATTACHMENT_OBJECT_STORE,
      "readwrite",
    );
    const completion = transactionComplete(transaction);
    transaction.objectStore(ATTACHMENT_OBJECT_STORE).delete(blobKey);
    await completion;
  }

  async get(blobKey: string): Promise<AttachmentRecord | null> {
    const database = await this.#database();
    const transaction = database.transaction(ATTACHMENT_OBJECT_STORE, "readonly");
    const [result] = await Promise.all([
      requestResult(transaction.objectStore(ATTACHMENT_OBJECT_STORE).get(blobKey)),
      transactionComplete(transaction),
    ]);
    return (result as AttachmentRecord | undefined) ?? null;
  }

  async list(): Promise<AttachmentRecord[]> {
    const database = await this.#database();
    const transaction = database.transaction(ATTACHMENT_OBJECT_STORE, "readonly");
    const [records] = await Promise.all([
      requestResult(transaction.objectStore(ATTACHMENT_OBJECT_STORE).getAll()),
      transactionComplete(transaction),
    ]);
    return records as AttachmentRecord[];
  }

  async put(record: AttachmentRecord): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      ATTACHMENT_OBJECT_STORE,
      "readwrite",
    );
    const completion = transactionComplete(transaction);
    transaction.objectStore(ATTACHMENT_OBJECT_STORE).put(record);
    await completion;
  }
}

export function createAttachmentStore(
  options: {
    databaseName?: string;
    indexedDbFactory?: IDBFactory;
    now?: () => Date;
    persistence?: AttachmentPersistence;
  } = {},
): AttachmentStore {
  const now = options.now ?? (() => new Date());
  const persistence =
    options.persistence ??
    new IndexedDbAttachmentPersistence({
      databaseName: options.databaseName ?? ATTACHMENT_DATABASE_NAME,
      indexedDbFactory: options.indexedDbFactory ?? globalThis.indexedDB,
    });

  return {
    deleteAttachment: (blobKey) => persistence.delete(blobKey),
    async deleteOrphanedAttachments(referencedKeys, olderThan) {
      const deleted: string[] = [];
      const records = (await persistence.list()).sort((left, right) =>
        left.blobKey.localeCompare(right.blobKey),
      );
      for (const record of records) {
        if (
          !referencedKeys.has(record.blobKey) &&
          new Date(record.createdAt).getTime() < olderThan.getTime()
        ) {
          await persistence.delete(record.blobKey);
          deleted.push(record.blobKey);
        }
      }
      return deleted;
    },
    async getAttachment(blobKey) {
      return (await persistence.get(blobKey))?.blob ?? null;
    },
    async listAttachmentMetadata() {
      return (await persistence.list())
        .map((record) => ({
          blobKey: record.blobKey,
          byteSize: record.blob.size,
          createdAt: record.createdAt,
          mimeType: record.blob.type,
        }))
        .sort((left, right) => left.blobKey.localeCompare(right.blobKey));
    },
    async putAttachment(blobKey, blob) {
      if (blobKey.trim().length === 0) {
        throw new Error("Attachment blob key must not be empty");
      }
      await persistence.put({
        blob,
        blobKey,
        createdAt: now().toISOString(),
      });
    },
  };
}

const defaultAttachmentStore = createAttachmentStore();

export const putAttachment = defaultAttachmentStore.putAttachment;
export const getAttachment = defaultAttachmentStore.getAttachment;
export const deleteAttachment = defaultAttachmentStore.deleteAttachment;
export const listAttachmentMetadata =
  defaultAttachmentStore.listAttachmentMetadata;
export const deleteOrphanedAttachments =
  defaultAttachmentStore.deleteOrphanedAttachments;
