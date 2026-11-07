#!/usr/bin/env node
/**
 * Generates the synthetic practice attachments shown on S04 (spec §6.3) into web/public/samples/.
 *
 * Both files are written from scratch so they can never contain anything real, and both start
 * with the magic bytes the server checks, so the demo does not depend on the phone having a file.
 *
 *   node scripts/make-sample-attachments.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const NOTICE = 'SYNTHETIC PRACTICE DOCUMENT - NOT A REAL ID';
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'samples');

/** A one-page A6 PDF. Offsets in the xref table are measured, not hand-counted. */
function buildPdf() {
  const content = `BT /F1 12 Tf 24 200 Td (${NOTICE}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 298] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, 'ascii');
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });

  const xrefOffset = Buffer.byteLength(body, 'ascii');
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'ascii');
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

/** A 96x64 greyscale checkerboard, plainly not a photo of anything, with the notice as metadata. */
function buildPng() {
  const width = 96;
  const height = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per sample
  header[9] = 0; // greyscale

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width + 1); // the leading 0 means "no filter" for this row
    for (let x = 0; x < width; x += 1) {
      row[x + 1] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0xdd : 0xff;
    }
    rows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${NOTICE}`, 'latin1')),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [name, bytes] of [
  ['practice-document.pdf', buildPdf()],
  ['practice-document.png', buildPng()],
]) {
  writeFileSync(join(OUTPUT_DIR, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
