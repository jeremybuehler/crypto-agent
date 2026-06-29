/**
 * Server-side proxy to the operator API.
 *
 * The operator bearer token lives only in the dashboard server's environment
 * (`OPERATOR_API_TOKEN`) and is attached here, on the server, before forwarding.
 * It is never sent to the browser, so no secret enters client JavaScript
 * (docs/SECURITY.md "Trust boundaries and authentication").
 */
import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.AGENT_API_URL ?? "http://localhost:3000";
const OPERATOR_TOKEN = process.env.OPERATOR_API_TOKEN;

// Always run on the Node.js server runtime; never statically optimized.
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const target = `${API_URL}/${path.join("/")}${request.nextUrl.search}`;
  const headers: Record<string, string> = {};
  if (OPERATOR_TOKEN) headers.authorization = `Bearer ${OPERATOR_TOKEN}`;

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body) {
      init.body = body;
      headers["content-type"] = request.headers.get("content-type") ?? "application/json";
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "API unreachable." } }, { status: 502 });
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" }
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}

export async function POST(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}
