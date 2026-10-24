// Store source gestures rather than video/bitmaps: small, editable and reusable.
let database;
async function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('direct-painting-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Local cache is blocked'));
  });
  return database;
}
async function transact(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', mode);
    const request = action(transaction.objectStore('projects'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Local cache transaction aborted'));
  });
}
export const loadProject = () => transact('readonly', store => store.get('current'));
export const saveProject = project => transact('readwrite', store => store.put(project, 'current'));
