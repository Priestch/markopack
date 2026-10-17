// Route path is /sitemap.xml — the directory name escapes each literal dot
// with a backtick (marko-run flat-route syntax; a bare `sitemap.xml` would
// parse as /sitemap/xml). Fixture for dev-server dot-path serving: an
// extension-suffixed URL must reach the router, not die in the static
// asset lookup.
export function GET() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n',
    {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    },
  );
}
