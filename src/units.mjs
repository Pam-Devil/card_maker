// Medidas em CSS usam 96 pixels por polegada, independentemente do DPI da imagem.
export const CSS_DPI = 96;
export const MM_PER_INCH = 25.4;

export const pxToMm = px => px * MM_PER_INCH / CSS_DPI;
export const mmToPx = (mm, dpi) => Math.round(mm / MM_PER_INCH * dpi);
