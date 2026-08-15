// Preview-only shim for window.storage (a shared KV API assumed by App.jsx).
// Backed by localStorage so the app is usable outside its original hosting environment.
if (!window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(key);
      return raw === null ? null : { value: raw };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
    },
  };
}
