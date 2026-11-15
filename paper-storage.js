// IndexedDB storage helper for test papers (PDFs and images)
const DB_NAME = 'studyflow_files_db';
const DB_VERSION = 1;
const STORE_NAME = 'test_papers';

let dbInstance = null;

function getDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Save a test paper file (Blob or File) into IndexedDB
 */
export async function savePaperFile(id, file) {
  if (!id || !file) throw new Error('A paper id and file are required.');

  const db = await getDB();
  const isPdf = (file.type && file.type.toLowerCase().includes('pdf')) ||
                (file.name && file.name.toLowerCase().endsWith('.pdf'));
  const mimeType = isPdf ? 'application/pdf' : (file.type || 'application/octet-stream');
  const arrayBuffer = await file.arrayBuffer();
  const storedBlob = new Blob([arrayBuffer], { type: mimeType });
  const record = {
    id,
    name: file.name || 'test-paper',
    type: mimeType,
    size: file.size || arrayBuffer.byteLength,
    buffer: arrayBuffer,
    blob: storedBlob,
    savedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => {
      console.error('IndexedDB paper save transaction error:', tx.error);
      reject(tx.error || new Error('Could not save paper file.'));
    };
    tx.onabort = () => reject(tx.error || new Error('Paper file save was aborted.'));
    tx.objectStore(STORE_NAME).put(record);
  });
}

/**
 * Retrieve a test paper file from IndexedDB
 */
export async function getPaperFile(id) {
  if (!id) return null;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result;
        if (!record) {
          resolve(null);
          return;
        }
        const isPdf = (record.type && record.type.toLowerCase().includes('pdf')) || 
                      (record.name && record.name.toLowerCase().endsWith('.pdf'));
        const mimeType = isPdf ? 'application/pdf' : (record.type || 'application/octet-stream');
        record.type = mimeType;

        // Reconstruct the Blob from the durable buffer when available.
        if (record.buffer instanceof ArrayBuffer || ArrayBuffer.isView(record.buffer)) {
          record.blob = new Blob([record.buffer], { type: mimeType });
        } else if (record.blob && !(record.blob instanceof Blob)) {
          record.blob = new Blob([record.blob], { type: mimeType });
        } else if (record.blob && isPdf && record.blob.type !== 'application/pdf') {
          record.blob = new Blob([record.blob], { type: 'application/pdf' });
        }
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error('Error fetching paper file from IndexedDB:', error);
    return null;
  }
}

/**
 * Delete a test paper file from IndexedDB
 */
export async function deletePaperFile(id) {
  if (!id) return false;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error('Error deleting paper file from IndexedDB:', error);
    return false;
  }
}

/**
 * Generate a downscaled thumbnail data URL for image files (for instant card display)
 */
export function generateImageThumbnail(file, maxDimension = 320) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Format bytes into human-readable string (e.g. 1.2 MB)
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

