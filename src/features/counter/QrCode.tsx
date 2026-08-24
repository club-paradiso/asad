"use client";

/**
 * QR rendered as inline SVG.
 *
 * Generated in the browser, so the join URL — which opens a private
 * conversation — never reaches an image service or any third party.
 *
 * Sized large by default: this is shown across a counter, sometimes at arm's
 * length, sometimes to someone holding a phone at an angle in bad light.
 */
import { useMemo } from "react";
import { encodeQr, qrToSvgPath } from "@/lib/qr";
import { cn } from "@/lib/cn";

export function QrCode({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const rendered = useMemo(() => {
    try {
      const matrix = encodeQr(value);
      return { size: matrix.size, path: qrToSvgPath(matrix) };
    } catch {
      return null;
    }
  }, [value]);

  if (!rendered) {
    return (
      <div
        className={cn(
          "flex aspect-square items-center justify-center rounded-lg border border-[var(--line)] p-4 text-center",
          className,
        )}
      >
        <p className="text-sm text-[var(--fg-dim)]">
          This address is too long for a QR code. Read the code out instead.
        </p>
      </div>
    );
  }

  // A quiet zone is not decoration: scanners need it to find the symbol.
  const quiet = 4;
  const total = rendered.size + quiet * 2;

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label={label ?? "QR code to join this session"}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={rendered.path} fill="#000000" />
      </g>
    </svg>
  );
}
