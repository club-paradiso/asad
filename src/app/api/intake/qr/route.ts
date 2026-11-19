import { NextResponse } from "next/server";
import { encodeQr, qrToSvgPath } from "@/lib/qr";
import { validCode } from "@/intake/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** QR encoding occurs on our own server. No third-party QR URL sees any data. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (!validCode(code)) {
    return NextResponse.json({ error: "Invalid desk code" }, { status: 400 });
  }
  const joinUrl = new URL("/intake?desk=" + encodeURIComponent(code), url.origin).toString();
  try {
    const matrix = encodeQr(joinUrl);
    const quiet = 4;
    const view = matrix.size + quiet * 2;
    const path = qrToSvgPath(matrix);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + view + ' ' + view +
      '" shape-rendering="crispEdges" role="img" aria-label="iPad pairing QR">' +
      '<rect width="' + view + '" height="' + view + '" fill="#fff"/>' +
      '<g transform="translate(' + quiet + ' ' + quiet + ')"><path d="' + path +
      '" fill="#000"/></g></svg>';
    return new Response(svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "QR generation failed" }, { status: 422 });
  }
}
