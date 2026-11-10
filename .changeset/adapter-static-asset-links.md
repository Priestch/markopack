---
"@markopack/adapter-static": patch
---

Skip links with known static-asset extensions when crawling: a discovered `<a>` pointing at a file (e.g. an image pipeline's link-to-original wrapping `/_markopress/image/…/pic.png`) is not a page — visiting it only logged 404 noise and wrote a junk `pic.png.html` next to where the real file belongs. The 404 branch also no longer writes a `404.html` document for asset-ish paths. Deliberately an extension allowlist rather than a generic `/\.\w+$/`, so dotted page routes (`/docs/v1.2`) keep being crawled.
