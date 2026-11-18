export function installDatabase() {
  const stores = new Map();
  let failChunk = false;
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  const keyFor = (name, value) => name === 'chunks' ? JSON.stringify([value.id, value.index]) : value.id;
  const inRange = (value, range) => !range || (value.id === range.lower[0] && value.index >= range.lower[1] && value.index <= range.upper[1]);
  globalThis.indexedDB = { open() {
    const request = {};
    setTimeout(() => {
      request.result = {
        createObjectStore(name) { stores.set(name, new Map()); },
        transaction(names) {
          const selected = Array.isArray(names) ? names : [names];
          const draft = new Map(selected.map(name => [name, new Map(stores.get(name))]));
          let aborted = false;
          const tx = { abort() { aborted = true; setTimeout(() => tx.onabort?.(), 0); } };
          tx.objectStore = name => ({
            put(value) {
              if (name === 'chunks' && failChunk) { failChunk = false; throw new Error('Simulated disk full'); }
              draft.get(name).set(keyFor(name, value), structuredClone(value)); return {};
            },
            get(id) { return { result: draft.get(name).get(id) }; },
            getAll(range) { return { result: [...draft.get(name).values()].filter(v => inRange(v, range)).sort((a, b) => (a.index || 0) - (b.index || 0)) }; },
            delete(key) {
              if (typeof key === 'string') draft.get(name).delete(key);
              else for (const [id, value] of draft.get(name)) if (inRange(value, key)) draft.get(name).delete(id);
              return {};
            },
          });
          setTimeout(() => { if (!aborted) { for (const [name, value] of draft) stores.set(name, value); tx.oncomplete?.(); } }, 0);
          return tx;
        },
      };
      request.onupgradeneeded(); request.onsuccess();
    }, 0);
    return request;
  } };
  return { stores, failNextChunk() { failChunk = true; } };
}
