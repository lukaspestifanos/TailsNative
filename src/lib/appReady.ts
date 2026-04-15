// Simple global signal for when the feed content is loaded and images are prefetched.
// The animated splash watches this before dismissing.

let _ready = false;
const _listeners: Array<() => void> = [];

export function setAppReady() {
  if (_ready) return;
  _ready = true;
  _listeners.forEach((fn) => fn());
  _listeners.length = 0;
}

export function isAppReady() {
  return _ready;
}

export function onAppReady(fn: () => void) {
  if (_ready) {
    fn();
  } else {
    _listeners.push(fn);
  }
}

// Reset for session changes (e.g. sign out / sign in)
export function resetAppReady() {
  _ready = false;
}
