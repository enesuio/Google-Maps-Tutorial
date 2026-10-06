import type { PhotoKind } from './db.js';

// ---- Shared types (mirror docs/API.md, T14) ----

export interface Photo {
  id: number;
  date: string;
  kind: PhotoKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** `/api/photos/:id/file` */
  url: string;
}

export interface PhotosView {
  photos: Photo[];
}

export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** Accepted types and the on-disk extension for each. */
export const PHOTO_MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export type PhotoMime = keyof typeof PHOTO_MIME_EXT;

export const isPhotoMime = (mime: string): mime is PhotoMime => Object.hasOwn(PHOTO_MIME_EXT, mime);

/** Bytes of the file head needed to sniff the type and, for PNG/JPEG, read the dimensions. */
export const PHOTO_HEADER_BYTES = 256 * 1024;

// ISO BMFF brands that mean a HEIF/HEIC still image (the `ftyp` box at offset 4).
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis']);

/** Type by magic bytes; null when the bytes are none of the accepted image formats. */
export function sniffImage(head: Buffer): PhotoMime | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    const major = head.toString('latin1', 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(major)) return 'image/heic';
    // Some encoders put the HEIC brand only in the compatible-brands list.
    const boxLen = head.readUInt32BE(0);
    for (let off = 16; off + 4 <= Math.min(boxLen, head.length, 64); off += 4) {
      if (HEIC_BRANDS.has(head.toString('latin1', off, off + 4).toLowerCase())) return 'image/heic';
    }
  }
  return null;
}

/**
 * Pixel size when it is cheap to read from the head (PNG IHDR, JPEG SOF marker); null otherwise
 * (WebP, HEIC, or a JPEG whose SOF sits past the header we kept).
 */
export function imageDimensions(mime: PhotoMime, head: Buffer): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (head.length < 24 || head.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let off = 2;
    while (off + 9 <= head.length) {
      if (head[off] !== 0xff) return null;
      const marker = head[off + 1]!;
      if (marker === 0xff) {
        off++; // fill byte
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        off += 2; // standalone markers without a length
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan: no SOF seen
      const length = head.readUInt16BE(off + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: head.readUInt16BE(off + 5), width: head.readUInt16BE(off + 7) };
      }
      off += 2 + length;
    }
  }
  return null;
}

export function photoView(row: {
  id: number;
  date: string;
  kind: PhotoKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: Date;
}): Photo {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at.toISOString(),
    url: `/api/photos/${row.id}/file`,
  };
}
