let dbPromise;
function database() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('meet-x-recorder', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.result.createObjectStore('chunks', { keyPath: ['id', 'index'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Close older recorder windows and reopen the extension to update storage.')); };
  });
  return dbPromise;
}
async function transaction(stores, action, mode = 'readonly') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let request;
    try { request = action(tx); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || new Error('Local storage failed.'));
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
  });
}
const chunkRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
export const putRecording = r => transaction('recordings', tx => tx.objectStore('recordings').put(r), 'readwrite');
export const getRecording = id => transaction('recordings', tx => tx.objectStore('recordings').get(id));
export const listRecordings = () => transaction('recordings', tx => tx.objectStore('recordings').getAll());
export function appendChunk(id, index, blob, metadata) {
  return transaction(['recordings', 'chunks'], tx => {
    tx.objectStore('chunks').put({ id, index, blob });
    return tx.objectStore('recordings').put(metadata);
  }, 'readwrite');
}
export async function recordingBlob(id) {
  const rows = await transaction('chunks', tx => tx.objectStore('chunks').getAll(chunkRange(id)));
  if (!rows.length) throw new Error('This recording has no saved media chunks. It may have been interrupted before recording began.');
  return new Blob(rows.map(r => r.blob), { type: rows[0].blob.type || 'video/webm' });
}
export const deleteRecording = id => transaction(['recordings', 'chunks'], tx => {
  tx.objectStore('chunks').delete(chunkRange(id));
  return tx.objectStore('recordings').delete(id);
}, 'readwrite');
