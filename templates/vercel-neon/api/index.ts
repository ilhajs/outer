import outer from "../src/app";

// Web-standard (Request) -> Response signature, supported directly by
// Vercel's Node.js runtime — no @vercel/node req/res adapter needed.
export default function handler(request: Request): Promise<Response> {
  return outer.handle(request);
}
