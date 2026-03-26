/**
 * Simple pattern-matching router with :param support.
 */
export type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

type Route = {
  method: string;
  pattern: string;
  parts: string[];
  handler: RouteHandler;
};

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler) {
    const parts = pattern.split("/").filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), pattern, parts, handler });
  }

  get(pattern: string, handler: RouteHandler) { this.add("GET", pattern, handler); }
  post(pattern: string, handler: RouteHandler) { this.add("POST", pattern, handler); }

  match(req: Request): { handler: RouteHandler; params: Record<string, string> } | null {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const method = req.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method && route.method !== "ANY") continue;
      if (route.parts.length !== pathParts.length && !route.pattern.endsWith("*")) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.parts.length; i++) {
        const rp = route.parts[i];
        const pp = pathParts[i];
        if (rp === "*") break;
        if (rp.startsWith(":")) {
          params[rp.slice(1)] = decodeURIComponent(pp ?? "");
        } else if (rp !== pp) {
          matched = false;
          break;
        }
      }

      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  async handle(req: Request): Promise<Response> {
    const match = this.match(req);
    if (!match) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      return await match.handler(req, match.params);
    } catch (err) {
      console.error("Route error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
}
