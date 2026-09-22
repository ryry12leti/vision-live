/* ═══════════════════════════════════════════
   storage.js — localStorage helpers
   Generic, app-agnostic read/write plus a small
   waitlist demo store. Exposed on window.VISION.storage.
   Loads first; defines no UI.
═══════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  const WAITLIST_KEY = 'vision_waitlist';

  V.storage = {
    /* read JSON value for a key, or null */
    read(key) {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch (e) { return null; }
    },

    /* write any JSON-serialisable value */
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },

    /* demo-only waitlist save — no backend, just local proof of capture.
       Returns false if the email was already stored. */
    saveWaitlist(email) {
      const list = this.read(WAITLIST_KEY) || [];
      if (list.includes(email)) return false;
      list.push(email);
      return this.write(WAITLIST_KEY, list);
    }
  };
})(window.VISION);
