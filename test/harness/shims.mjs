/**
 * Per-window shims that make a bare happy-dom Window behave like the browser
 * environment markopack's client output expects. Everything here is applied
 * to each fresh Window before any document content is written, so fixture
 * code and generated bundles see a consistent environment.
 *
 * These replace the jsdom-era shims in upstream's browser.ts (setImmediate,
 * MessageChannel, fetch globals) plus two happy-dom-specific gaps found by
 * the 2026-10 spike:
 *
 *  1. requestIdleCallback is not implemented — Marko's `load: "idle"`
 *     trigger needs it (upstream jsdom had the same gap via its own polyfills).
 *  2. happy-dom marks scripts parsed by Range.createContextualFragment as
 *     disableEvaluation (innerHTML semantics). Real browsers execute such
 *     scripts once inserted, and marko-compiler's lazy-load trigger relies on
 *     exactly that — so the flag is stripped from fragment scripts.
 */
import { MessageChannel } from "node:worker_threads";
import { PropertySymbol } from "happy-dom";

export function installShims(window) {
  // --- upstream parity shims (jsdom needed these too) ---
  window.setImmediate ||= setImmediate;
  window.MessageChannel ||= MessageChannel;

  // --- happy-dom gap 1: requestIdleCallback ---
  if (!window.requestIdleCallback) {
    window.requestIdleCallback = (cb) =>
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
    window.cancelIdleCallback = (id) => clearTimeout(id);
  }

  // --- happy-dom gap 2: contextual-fragment script evaluation ---
  const proto = window.Range.prototype;
  if (!proto.__markopackFragmentShim) {
    const orig = proto.createContextualFragment;
    proto.createContextualFragment = function (html) {
      const frag = orig.call(this, html);
      for (const script of frag.querySelectorAll("script")) {
        script[PropertySymbol.disableEvaluation] = false;
      }
      return frag;
    };
    proto.__markopackFragmentShim = true;
  }

  // --- dev-server reload client opens an EventSource; nothing should react
  //     to it inside tests, and a real connection would never settle, so it
  //     is always replaced with a no-op (happy-dom's own implementation
  //     included) ---
  window.EventSource = class EventSource {
    constructor() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
}
