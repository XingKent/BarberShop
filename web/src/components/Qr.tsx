import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Desenha um QR code a partir de um texto (usado para configurar o aplicativo autenticador). */
export default function Qr({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: 224, errorCorrectionLevel: "M" })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [value]);

  if (!src) return <div className="qr" aria-hidden />;
  return <img className="qr" src={src} alt={label} width={224} height={224} />;
}
