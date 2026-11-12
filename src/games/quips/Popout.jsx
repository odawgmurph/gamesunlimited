import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';

const NAME = 'quips-main-screen';

/**
 * Opens (or reuses) the pop-out window. Must be called from a click so the
 * browser doesn't block it. Returns null if it was blocked.
 */
export function openScreenWindow() {
  const w = window.open('', NAME, 'popup,width=1280,height=760');
  if (!w) return null;
  // A fresh standards-mode document (about:blank would be in quirks mode).
  w.document.open();
  w.document.write(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quips · Main screen</title></head><body class="qps-popout-body"></body></html>'
  );
  w.document.close();
  w.focus();
  return w;
}

/**
 * Renders children into another window. The game's code keeps running in this
 * tab; the window only displays it. Stylesheets are copied over, including any
 * that load later.
 */
export function Popout({ win, onClose, children }) {
  const [root, setRoot] = useState(null);

  useEffect(() => {
    const doc = win.document;
    const copy = (n) => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'LINK' && n.rel === 'stylesheet') {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = n.href; // absolute, so it resolves from about:blank
        doc.head.appendChild(l);
      } else if (n.tagName === 'STYLE') {
        const s = doc.createElement('style');
        s.textContent = n.textContent;
        doc.head.appendChild(s);
      }
    };
    document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(copy);
    const watch = new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(copy)));
    watch.observe(document.head, { childList: true });

    const el = doc.createElement('div');
    el.className = 'qps-popout';
    doc.body.appendChild(el);
    setRoot(el);

    // Closing the window (or this tab) ends the pop-out.
    const closed = () => onClose();
    win.addEventListener('pagehide', closed);
    const poll = setInterval(() => win.closed && closed(), 1000);
    const closeWin = () => win.close();
    window.addEventListener('pagehide', closeWin);
    return () => {
      watch.disconnect();
      clearInterval(poll);
      win.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', closeWin);
      el.remove();
    };
  }, [win]);

  return root ? createPortal(children, root) : null;
}
