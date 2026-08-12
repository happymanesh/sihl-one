export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;

  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject>;

  get(key: string): Promise<Buffer>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;
}

export const STORAGE_DRIVER = 'STORAGE_DRIVER';

/**
 * Malware scanning seam.
 *
 * Deliberately an interface with a no-op default rather than an unimplemented
 * TODO. A file uploaded by an external partner and later downloaded by an SIHL
 * employee is a genuine transmission path, so the decision "this file has not
 * been scanned" must be explicit, recorded per file, and visible in the UI —
 * not implied by absence.
 */
export interface FileScanner {
  readonly name: string;
  scan(input: { key: string; body: Buffer; contentType: string }): Promise<ScanResult>;
}

export interface ScanResult {
  status: 'CLEAN' | 'INFECTED' | 'FAILED';
  detail?: string;
}

export const FILE_SCANNER = 'FILE_SCANNER';
