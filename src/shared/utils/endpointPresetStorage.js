const LEGACY_KEY = "9router.cliToolEndpointPresets";
const STORAGE_KEY = `${LEGACY_KEY}.encrypted`;

async function encryptionKey() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("Saving credentials requires HTTPS or localhost and browser storage access.");
  }
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("9router-local-credentials", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("keys", "readwrite");
      const store = transaction.objectStore("keys");
      const request = store.get("endpoint-presets");
      let key;
      request.onsuccess = () => {
        key = request.result || candidate;
        if (!request.result) store.add(key, "endpoint-presets");
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Credential storage was interrupted."));
    });
  } finally {
    db.close();
  }
}

export async function writeEndpointPresets(presets) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(presets));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, iv: [...iv], data: [...new Uint8Array(encrypted)] }));
  localStorage.removeItem(LEGACY_KEY);
}

export async function readEndpointPresets() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const payload = JSON.parse(stored);
    if (payload.version !== 1) throw new Error("Unsupported saved credential format.");
    const key = await encryptionKey();
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(payload.iv) }, key, new Uint8Array(payload.data));
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return [];
  const presets = JSON.parse(legacy);
  await writeEndpointPresets(presets);
  return presets;
}
