"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({ text, size = 256 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { width: size, margin: 1 }).then(setSrc); }, [text, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <div style={{ width: size, height: size }} />;
}
