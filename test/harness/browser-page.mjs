/**
 * In-process browser page over happy-dom — the markopack counterpart of
 * upstream @marko/run's jsdom+vm BrowserPage (src/__tests__/utils/browser.ts).
 * The public surface is identical, so fixture `test.config.ts` step code
 * (page.click / page.fetch / page.settle / page.innerText …) runs unmodified.
 *
 * Structural notes, mirroring upstream:
 *  - A fresh Window is created per navigation (upstream: fresh JSDOM), so
 *    module state never leaks across pages.
 *  - Navigation always starts with a Node fetch, giving steps a real
 *    `Response` even for non-HTML routes (those never load a document).
 *  - Anchor clicks and form submits are intercepted at the window level and
 *    funneled through the same navigate() pipeline, keeping ctx.response and
 *    referer semantics consistent.
 *  - Errors (window "error" events, failed asset loads) are appended to a
 *    `<pre id="error">` element in the DOM so they surface in snapshots.
 *
 * Unlike upstream there is no vm.SourceTextModule machinery: happy-dom
 * executes <script type="module"> natively (including ones dynamically
 * inserted via Range.createContextualFragment, after the shim in shims.mjs).
 */
import { Window } from "happy-dom";
import { installShims } from "./shims.mjs";

const dbg = (...args) => process.env.DEBUG_FIXTURE === "1" && console.error("[page]", ...args);

const WINDOW_SETTINGS = {
  enableJavaScriptEvaluation: true,
  disableJavaScriptFileLoading: false,
  enableCSSFileLoading: false,
  handleDisabledFileLoadingAsSuccess: true,
  disableComputedStyleRendering: true,
  suppressInsecureJavaScriptEnvironmentWarning: true,
  fetch: { disableSameOriginPolicy: true },
  // NOTE: no preventTimerLoops here — it kills happy-dom's internal rAF
  // scheduler after a couple of frames, hanging any second settle() round.
  // maxTimeout still bounds runaway timers for waitUntilComplete().
  timer: { maxTimeout: 20000 },
};

export class BrowserPage {
  window;
  response;
  /** Pristine server HTML of the current navigation, before any client script. */
  serverHTML = "";

  #pendingNavigation = Promise.resolve();
  #seenAssets = new Set();
  // Scratch window used only as a DOMParser factory — DOMParser needs a
  // window to create documents from, and documents produced this way are
  // never connected, so their scripts never execute.
  #parserWindow = new Window();

  get document() {
    if (!this.window) throw new Error("The page has not loaded a document.");
    return this.window.document;
  }

  url() {
    return this.window ? this.window.location.href : this.response.url;
  }

  async goto(href, options = {}) {
    await this.#navigate(href, {
      headers: options.referer ? { referer: options.referer } : {},
    });
  }

  fetch(href, init) {
    return fetch(new URL(href, this.url()), init);
  }

  async click(selector) {
    const el = this.document.querySelector(selector);
    if (!el) throw new Error(`No element matches ${JSON.stringify(selector)}`);
    el.click();
    await this.settle();
  }

  innerText(selector) {
    const el = this.document.querySelector(selector);
    if (!el) throw new Error(`No element matches ${JSON.stringify(selector)}`);
    return (el.textContent || "").trim();
  }

  async settle() {
    let nav;
    do {
      nav = this.#pendingNavigation;
      await nav;
    } while (nav !== this.#pendingNavigation);
    await this.#settleScheduled();
  }

  /**
   * Normalized serialization of pristine server HTML (before any client
   * script ran) — upstream captures this from the DOM mid-parse; reading the
   * fetch response body is deterministic and avoids racing hydration.
   * Scripts in the parsed document never execute: DOMParser documents are
   * never connected to a browsing context.
   */
  serializeServerHTML(html) {
    const parser = new this.#parserWindow.DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const root = doc.getElementById("app") || doc.body;
    return root ? root.innerHTML : "";
  }

  async close() {
    await this.#pendingNavigation.catch(() => {});
    this.window?.happyDOM?.close?.();
    this.window = undefined;
  }

  async #navigate(href, init = {}, onBodyReady) {
    dbg("navigate", href);
    const response = await fetch(href, {
      ...init,
      headers: { accept: "text/html,*/*;q=0.8", ...init.headers },
    });
    dbg("navigate fetched", response.status);
    this.response = response;

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.includes("text/html")) {
      await this.close();
      return;
    }

    await this.#loadDocument(response, onBodyReady);
  }

  async #loadDocument(response, onBodyReady) {
    this.window?.happyDOM?.close?.();

    let html = await response.clone().text();
    // The markopack dev server injects <script src="/__markopack_reload.js">
    // into every HTML response. Routing that external classic script through
    // happy-dom's document.write deadlocks the main thread (the parser never
    // resumes once the dev server's response is in flight — reproduced with
    // nothing but a Window, the dev server and this one tag). The script only
    // opens the SSE reload channel, which the EventSource shim no-ops anyway,
    // so drop it before the document is written. Stripping before
    // serverHTML is stored also keeps dev and preview snapshots comparable.
    html = html.replace(
      /<script src="[^"]*\/__markopack_reload\.js"><\/script>/g,
      "",
    );
    this.serverHTML = html;
    const window = new Window({ url: response.url, settings: WINDOW_SETTINGS });
    this.window = window;
    this.#seenAssets = new Set();
    this.#setupWindow(window);

    dbg("loadDocument writing", html.length, "bytes");
    window.document.write(html);
    window.document.close();
    dbg("loadDocument written");

    // Meta refresh redirect, mirroring upstream.
    const refresh = window.document
      .querySelector('meta[http-equiv="refresh" i]')
      ?.getAttribute("content");
    const refreshUrl = refresh && /url\s*=\s*(.+)\s*$/i.exec(refresh)?.[1];
    if (refreshUrl) {
      await this.#navigate(
        new URL(refreshUrl, response.url).href,
        { headers: { referer: response.url } },
        onBodyReady,
      );
      return;
    }

    await onBodyReady?.();
    dbg("checkAssets…");
    await this.#checkAssets(window);
    dbg("settle…");
    await this.#settleScheduled();
    dbg("settled");
  }

  #setupWindow(window) {
    installShims(window);

    window.addEventListener(
      "error",
      (ev) => {
        this.#reportError(
          `${ev.error || `Error loading ${ev.target?.outerHTML}`}\n`,
        );
      },
      true,
    );

    window.addEventListener("submit", (ev) => {
      if (ev.defaultPrevented) return;
      ev.preventDefault();
      const form = ev.target;
      const submitter = ev.submitter;
      this.#queueNavigation(() => this.#submitForm(form, submitter));
    });

    window.addEventListener("click", (ev) => {
      if (ev.defaultPrevented) return;
      const anchor = ev.target.closest?.("a[href]");
      if (anchor) {
        ev.preventDefault();
        this.#queueNavigation(() =>
          this.#navigate(anchor.href, {
            headers: { referer: this.url() },
          }),
        );
      }
    });
  }

  #queueNavigation(nav) {
    this.#pendingNavigation = this.#pendingNavigation.then(nav, nav);
  }

  async #submitForm(form, submitter) {
    const window = this.window;
    let data;
    try {
      data = new window.FormData(form, submitter || undefined);
    } catch {
      data = new window.FormData(form);
    }

    const method = (
      submitter?.getAttribute("formmethod") || form.method || "get"
    ).toLowerCase();
    const url = new URL(
      submitter?.getAttribute("formaction") || form.getAttribute("action") || "",
      window.location.href,
    );
    const referer = this.url();

    if (method === "get") {
      url.search = new URLSearchParams(data).toString();
      await this.#navigate(url.href, { headers: { referer } });
    } else {
      const body =
        form.enctype === "multipart/form-data"
          ? data
          : new URLSearchParams(data);
      await this.#navigate(url.href, { method, body, headers: { referer } });
    }
  }

  async #settleScheduled() {
    for (let i = 0; i < 3; i++) {
      dbg("settle round", i);
      await this.window?.happyDOM?.waitUntilComplete?.().catch(() => {});
      dbg("settle round", i, "waitUntilComplete done");
      await this.#animationFrame();
      await new Promise((resolve) => setTimeout(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  #animationFrame() {
    const { window } = this;
    if (!window) return;
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  async #checkAssets(window) {
    const checks = [];
    for (const el of window.document.querySelectorAll(
      "script[src],link[rel=stylesheet][href]",
    )) {
      const href = "src" in el ? el.src : el.href;
      if (!href || this.#seenAssets.has(href) || !/^https?:/.test(href)) {
        continue;
      }
      this.#seenAssets.add(href);
      checks.push(
        (async () => {
          try {
            const res = await fetch(href);
            await res.arrayBuffer();
            if (!res.ok) throw new Error();
          } catch {
            this.#reportError(`Error loading ${el.outerHTML}\n`);
          }
        })(),
      );
    }
    await Promise.all(checks);
  }

  #reportError(msg) {
    const document = this.window?.document;
    if (!document || msg.includes("WebSocket closed")) return;
    let errorContainer = document.getElementById("error");
    if (!errorContainer) {
      errorContainer = document.createElement("pre");
      errorContainer.id = "error";
      (document.getElementById("app") || document.body).appendChild(
        errorContainer,
      );
    }
    errorContainer.insertAdjacentText("beforeend", msg);
  }
}
