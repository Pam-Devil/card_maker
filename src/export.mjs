import sharp from "sharp";

export const MM = Object.freeze({ bleedW: 69, bleedH: 94, trimW: 63, trimH: 88, bleedMargin: 3, radius: 6 });
export const mmToPx = (mm, dpi) => Math.round(mm / 25.4 * dpi);

export async function exportPng(png, destination, opts, size = {}) {
  const width = mmToPx(size.width ?? (opts.trim ? MM.trimW : MM.bleedW), opts.dpi);
  const height = mmToPx(size.height ?? (opts.trim ? MM.trimH : MM.bleedH), opts.dpi);
  // Normaliza antes da máscara para que a borda arredondada coincida com a imagem final.
  const sized = await sharp(png).resize(width, height, { fit: "fill" }).png().toBuffer();
  let result = sharp(sized);
  if (opts.rounded) {
    const radius = mmToPx(MM.radius, opts.dpi);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`);
    result = result.composite([{ input: mask, blend: "dest-in" }]);
  }
  await result.withMetadata({ density: opts.dpi }).png().toFile(destination);
}
