import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";

/**
 * Object storage for uploads, extracted text and generated documents.
 *
 * Everything is encrypted by the application (AES-256-GCM) before it reaches the storage
 * backend, in addition to the backend's own encryption at rest (Azure Storage encrypts by default).
 */
export interface BlobBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalBackend implements BlobBackend {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private file(key: string) {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes("..")) throw new Error("invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, data, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.promises.readFile(this.file(key));
  }
  async delete(key: string) {
    await fs.promises.rm(this.file(key), { force: true });
  }
}

class AzureBlobBackend implements BlobBackend {
  private containerPromise: Promise<import("@azure/storage-blob").ContainerClient>;
  constructor(accountUrl: string, container: string) {
    this.containerPromise = (async () => {
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const { DefaultAzureCredential } = await import("@azure/identity");
      // Uses the App Service managed identity in Azure; no storage keys are kept in configuration.
      const service = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
      return service.getContainerClient(container);
    })();
  }
  async put(key: string, data: Buffer) {
    const c = await this.containerPromise;
    await c.getBlockBlobClient(key).uploadData(data, { blobHTTPHeaders: { blobContentType: "application/octet-stream" } });
  }
  async get(key: string) {
    const c = await this.containerPromise;
    return c.getBlockBlobClient(key).downloadToBuffer();
  }
  async delete(key: string) {
    const c = await this.containerPromise;
    await c.getBlockBlobClient(key).deleteIfExists();
  }
}

const MAGIC = Buffer.from("FDA1");

function loadKey(): Buffer {
  const config = getConfig();
  if (config.STORAGE_ENCRYPTION_KEY) {
    const key = Buffer.from(config.STORAGE_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return key;
  }
  if (config.isProduction) throw new Error("STORAGE_ENCRYPTION_KEY is required");
  // Development only: generate and remember a local key so restarts can read earlier files.
  const file = path.resolve(process.cwd(), "data", "dev-encryption-key");
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  return key;
}

export function encrypt(plain: Buffer, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer, key: Buffer) {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error("unrecognised storage format");
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}

export class EncryptedStorage {
  constructor(
    private readonly backend: BlobBackend,
    private readonly key: Buffer,
  ) {}
  async put(key: string, data: Uint8Array | string) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    await this.backend.put(key, encrypt(buf, this.key));
  }
  async get(key: string) {
    return decrypt(await this.backend.get(key), this.key);
  }
  async getText(key: string) {
    return (await this.get(key)).toString("utf8");
  }
  async delete(key: string) {
    await this.backend.delete(key);
  }
}

const g = globalThis as unknown as { __fdaStorage?: EncryptedStorage; __fdaKey?: Buffer };

/** Application data-encryption key (from STORAGE_ENCRYPTION_KEY / Key Vault in production). */
export function getEncryptionKey(): Buffer {
  return (g.__fdaKey ??= loadKey());
}

export function getStorage(): EncryptedStorage {
  if (g.__fdaStorage) return g.__fdaStorage;
  const config = getConfig();
  const backend =
    config.STORAGE_DRIVER === "azure-blob"
      ? new AzureBlobBackend(required(config.AZURE_STORAGE_ACCOUNT_URL, "AZURE_STORAGE_ACCOUNT_URL"), config.AZURE_STORAGE_CONTAINER)
      : new LocalBackend(path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR));
  g.__fdaStorage = new EncryptedStorage(backend, getEncryptionKey());
  return g.__fdaStorage;
}

export function setStorageForTesting(s: EncryptedStorage | undefined) {
  g.__fdaStorage = s;
}

export class MemoryBackend implements BlobBackend {
  readonly map = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.map.set(key, data);
  }
  async get(key: string) {
    const v = this.map.get(key);
    if (!v) throw new Error(`missing object ${key}`);
    return v;
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

export function newStorageKey(prefix: string, ext = "bin") {
  return `${prefix}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
}

export const sha256 = (data: Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

function required(v: string | undefined, name: string) {
  if (!v) throw new Error(`${name} must be set when STORAGE_DRIVER=azure-blob`);
  return v;
}
