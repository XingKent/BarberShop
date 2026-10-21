/** Lado da foto enviada, em pixels. Com 512 px o arquivo fica por volta de 50 KB. */
const SIZE = 512;

/**
 * Recorta a imagem em quadrado (centralizada) e reduz para 512 px, em JPEG.
 * Fotos de celular têm vários MB; mandar uma imagem leve poupa o banco e a conexão do cliente.
 */
export async function squarePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // imageOrientation: a foto de celular vem "deitada" com um aviso de rotação; isto a endireita.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Não consegui abrir essa imagem. Use uma foto JPEG, PNG ou WebP.");
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador não consegue preparar a foto.");
    ctx.fillStyle = "#ffffff"; // PNG com fundo transparente vira branco no JPEG
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("Não consegui preparar a foto. Tente outra imagem.");
    return blob;
  } finally {
    bitmap.close();
  }
}
