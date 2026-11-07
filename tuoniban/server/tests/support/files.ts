/** Synthetic practice files. Only the leading magic bytes matter to the server. */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n% synthetic practice document for tests\n%%EOF\n', 'latin1');
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic png body'),
]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic jpeg body')]);

/** A file of exactly `size` bytes that still starts like a PDF. */
export function pdfOfSize(size: number): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  PDF_BYTES.copy(bytes, 0, 0, Math.min(PDF_BYTES.length, size));
  return bytes;
}
