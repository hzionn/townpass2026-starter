import { extname } from 'node:path';
import multer from 'multer';
import { apiError, attachmentError, type ApiError } from './errors.js';

/** The accepted file types (spec §6.3), with what each must look like. */
const FILE_KINDS = [
  { mime: 'application/pdf', extensions: ['.pdf'], magic: Buffer.from('%PDF-', 'latin1') },
  { mime: 'image/png', extensions: ['.png'], magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], magic: Buffer.from([0xff, 0xd8, 0xff]) },
];

export const ACCEPTED_MIME_TYPES = FILE_KINDS.map((kind) => kind.mime);

export function formatBytes(bytes: number): string {
  const inMiB = bytes / (1024 * 1024);
  const round = (value: number) => String(Math.round(value * 10) / 10);
  return inMiB >= 1 ? `${round(inMiB)} MiB` : `${round(bytes / 1024)} KiB`;
}

export type UploadVerdict = { ok: true; mime: string; size: number; bytes: Buffer } | { ok: false; error: ApiError };

function reject(error: ApiError): UploadVerdict {
  return { ok: false, error };
}

function tooLarge(maxBytes: number): ApiError {
  return attachmentError('FILE_TOO_LARGE', `檔案太大，最多 ${formatBytes(maxBytes)}。`);
}

/** Turns an error from the multipart parser into what the API reports. */
function verdictForParseError(uploadError: unknown, maxBytes: number): UploadVerdict {
  if (uploadError instanceof multer.MulterError) {
    if (uploadError.code === 'LIMIT_FILE_SIZE') return reject(tooLarge(maxBytes));
    if (uploadError.code === 'LIMIT_FILE_COUNT' || uploadError.code === 'LIMIT_UNEXPECTED_FILE') {
      return reject(attachmentError('VALIDATION_FAILED', '一次只能上傳一份附件。'));
    }
  }
  return reject(apiError('INVALID_JSON'));
}

/**
 * Judges the uploaded file on its own, without touching the database. Magic bytes, declared
 * MIME and filename extension must all agree, so a renamed file cannot pass.
 * The original filename is used only for this comparison: never stored, returned or logged.
 */
export function inspectUpload(
  file: Express.Multer.File | undefined,
  uploadError: unknown,
  maxBytes: number,
): UploadVerdict {
  if (uploadError) return verdictForParseError(uploadError, maxBytes);
  if (!file) return reject(attachmentError('VALIDATION_FAILED', '請選擇要上傳的檔案。'));
  if (file.size === 0) return reject(attachmentError('VALIDATION_FAILED', '這個檔案是空的，請換一份。'));
  if (file.size > maxBytes) return reject(tooLarge(maxBytes));

  const bytes = file.buffer;
  const kind = FILE_KINDS.find((candidate) => bytes.subarray(0, candidate.magic.length).equals(candidate.magic));
  const agrees =
    kind !== undefined &&
    kind.mime === file.mimetype.toLowerCase() &&
    kind.extensions.includes(extname(file.originalname).toLowerCase());
  if (!agrees) {
    return reject(attachmentError('FILE_TYPE_NOT_ALLOWED', '只接受內容和副檔名相符的 PDF、PNG、JPEG。'));
  }
  return { ok: true, mime: kind.mime, size: file.size, bytes };
}
