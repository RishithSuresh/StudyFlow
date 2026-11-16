// IndexedDB + Neon DB persistent storage helper for test papers (PDFs and images)
const DB_NAME = 'studyflow_files_db';
const DB_VERSION = 1;
const STORE_NAME = 'test_papers';

const API_BASE = (typeof window !== 'undefined' && window.STUDYFLOW_API_URL)
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataURLToArrayBuffer(dataUrl) {
  let base64 = dataUrl;
  if (base64.includes(',')) base64 = base64.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Save a test paper file (Blob or File) into IndexedDB and Neon DB
 */
export async function savePaperFile(id, file) {
  if (!id || !file) throw new Error('A paper id and file are required.');
  const testId = String(id);
  const db = await getDB();
  const isPdf = (file.type && file.type.toLowerCase().includes('pdf')) ||
                (file.name && file.name.toLowerCase().endsWith('.pdf'));
  const mimeType = isPdf ? 'application/pdf' : (file.type || 'application/octet-stream');

  let arrayBuffer;
  if (file instanceof ArrayBuffer) {
    arrayBuffer = file;
  } else if (file.arrayBuffer) {
    arrayBuffer = await file.arrayBuffer();
  } else {
    arrayBuffer = new ArrayBuffer(0);
  }

  const dataUrl = await readFileAsDataURL(file instanceof Blob ? file : new Blob([arrayBuffer], { type: mimeType }));
  const storedBlob = new Blob([arrayBuffer], { type: mimeType });
  const record = {
    id: testId,
    name: file.name || (isPdf ? 'question-paper.pdf' : 'test-paper.jpg'),
    type: mimeType,
    size: file.size || arrayBuffer.byteLength,
    buffer: arrayBuffer,
    blob: storedBlob,
    dataUrl,
    savedAt: Date.now()
  };

  // 1. Save locally to IndexedDB
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => {
      console.error('IndexedDB paper save transaction error:', tx.error);
      reject(tx.error || new Error('Could not save paper file locally.'));
    };
    tx.onabort = () => reject(tx.error || new Error('Paper file save was aborted.'));
    tx.objectStore(STORE_NAME).put(record);
  });

  // 2. Upload to Neon DB database through backend API
  try {
    const response = await fetch(`${API_BASE}/papers/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId,
        fileName: record.name,
        fileType: record.type,
        fileSize: record.size,
        fileData: dataUrl
      })
    });
    if (!response.ok) {
      console.warn('Backend paper upload returned non-200 status:', response.status);
    }
  } catch (netErr) {
    console.warn('Could not sync paper to Neon DB server (offline or network issue):', netErr);
  }

  return record;
}

/**
 * Retrieve a test paper file from IndexedDB (or fallback to Neon DB backend)
 */
export async function getPaperFile(id) {
  if (!id) return null;
  const testId = String(id);
  try {
    const db = await getDB();
    const localRecord = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(testId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });

    if (localRecord && (localRecord.buffer || localRecord.dataUrl || localRecord.blob)) {
      const isPdf = (localRecord.type && localRecord.type.toLowerCase().includes('pdf')) || 
                    (localRecord.name && localRecord.name.toLowerCase().endsWith('.pdf'));
      const mimeType = isPdf ? 'application/pdf' : (localRecord.type || 'application/octet-stream');
      localRecord.type = mimeType;

      if (localRecord.buffer instanceof ArrayBuffer || ArrayBuffer.isView(localRecord.buffer)) {
        localRecord.blob = new Blob([localRecord.buffer], { type: mimeType });
      } else if (localRecord.dataUrl) {
        const buf = dataURLToArrayBuffer(localRecord.dataUrl);
        localRecord.buffer = buf;
        localRecord.blob = new Blob([buf], { type: mimeType });
      } else if (localRecord.blob && !(localRecord.blob instanceof Blob)) {
        localRecord.blob = new Blob([localRecord.blob], { type: mimeType });
      } else if (localRecord.blob && isPdf && localRecord.blob.type !== 'application/pdf') {
        localRecord.blob = new Blob([localRecord.blob], { type: 'application/pdf' });
      }
      return localRecord;
    }

    // Fallback: Fetch directly from Neon DB via backend
    try {
      const res = await fetch(`${API_BASE}/papers/${encodeURIComponent(testId)}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload && payload.fileData) {
          const isPdf = (payload.fileType && payload.fileType.toLowerCase().includes('pdf')) || 
                        (payload.fileName && payload.fileName.toLowerCase().endsWith('.pdf'));
          const mimeType = isPdf ? 'application/pdf' : (payload.fileType || 'application/octet-stream');
          const buffer = dataURLToArrayBuffer(payload.fileData);
          const blob = new Blob([buffer], { type: mimeType });
          const remoteRecord = {
            id: testId,
            name: payload.fileName || (isPdf ? 'question-paper.pdf' : 'test-paper.jpg'),
            type: mimeType,
            size: payload.fileSize || buffer.byteLength,
            buffer,
            blob,
            dataUrl: payload.fileData,
            savedAt: Date.now()
          };

          // Cache in IndexedDB for subsequent instant offline access
          try {
            const cacheTx = db.transaction(STORE_NAME, 'readwrite');
            cacheTx.objectStore(STORE_NAME).put(remoteRecord);
          } catch (cacheErr) {
            console.warn('Could not cache remote paper in IndexedDB:', cacheErr);
          }

          return remoteRecord;
        }
      }
    } catch (fetchErr) {
      console.warn('Could not fetch paper from server:', fetchErr);
    }

    return null;
  } catch (error) {
    console.error('Error fetching paper file:', error);
    return null;
  }
}

/**
 * Delete a test paper file from IndexedDB and Neon DB
 */
export async function deletePaperFile(id) {
  if (!id) return false;
  const testId = String(id);
  try {
    const db = await getDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(testId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });

    // Also delete from Neon DB backend
    try {
      await fetch(`${API_BASE}/papers/${encodeURIComponent(testId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch (netErr) {
      console.warn('Could not delete paper from server:', netErr);
    }

    return true;
  } catch (error) {
    console.error('Error deleting paper file:', error);
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
