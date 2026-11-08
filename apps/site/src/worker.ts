interface Env {
  ASSETS: Fetcher;
  API_ORIGIN: string;
  PROXY_KEY?: string;
}

const SITE_PATHS = new Set(["/", "/fr", "/fr/", "/robots.txt", "/favicon.ico"]);

function isSitePath(pathname: string): boolean {
  return SITE_PATHS.has(pathname) || pathname.startsWith("/site/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isSitePath(url.pathname)) return env.ASSETS.fetch(request);

    const target = new URL(url.pathname + url.search, env.API_ORIGIN);
    // Cloudflare Access guards /admin on the API's own hostname, and its sign-in cookie belongs to that host.
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return Response.redirect(target.toString(), 302);

    const headers = new Headers(request.headers);
    headers.delete("x-client-ip");
    headers.delete("x-proxy-key");
    if (env.PROXY_KEY) {
      headers.set("x-client-ip", request.headers.get("cf-connecting-ip") ?? "");
      headers.set("x-proxy-key", env.PROXY_KEY);
    }
    // Passing the request through keeps WebSocket upgrades working.
    return fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
  },
} satisfies ExportedHandler<Env>;
