import * as ImagePicker from 'expo-image-picker';
import { Platform, Linking } from 'react-native';
import { confirmDialog } from '../lib/dialog';

interface PickedImageFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  ext: string;
  size: number;
  uri: string;
}

interface PickImageOptions {
  source?: 'library' | 'camera';
  allowsMultipleSelection?: boolean;
  selectionLimit?: number;
  cropSquare?: boolean;
  maxDimension?: number;
  quality?: number;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure JS base64 to Uint8Array decoder that works across Hermes (Android/iOS),
 * JavaScriptCore, V8, and Web browsers without Buffer or atob limitations.
 */
export function decodeBase64ToUint8Array(base64Input: string): Uint8Array {
  // Strip optional data URI prefix (e.g., "data:image/jpeg;base64,") and whitespace
  const commaIdx = base64Input.indexOf(',');
  const raw = (commaIdx !== -1 ? base64Input.slice(commaIdx + 1) : base64Input).replace(
    /[\r\n\s]/g,
    ''
  );

  if (!raw) {
    return new Uint8Array(0);
  }

  // Normalize URL-safe base64 if present
  const clean = raw.replace(/-/g, '+').replace(/_/g, '/');
  const len = clean.length;
  let pad = 0;
  if (clean.endsWith('==')) pad = 2;
  else if (clean.endsWith('=')) pad = 1;

  const byteLength = Math.floor((len * 3) / 4) - pad;
  const bytes = new Uint8Array(Math.max(0, byteLength));

  const lookup = new Uint8Array(256);
  lookup.fill(255);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    lookup[BASE64_CHARS.charCodeAt(i)] = i;
  }

  let byteIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = lookup[clean.charCodeAt(i)] ?? 0;
    const c2 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c3 = i + 2 < len ? lookup[clean.charCodeAt(i + 2)] : 0;
    const c4 = i + 3 < len ? lookup[clean.charCodeAt(i + 3)] : 0;

    const triplet = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);

    if (byteIdx < byteLength) bytes[byteIdx++] = (triplet >> 16) & 0xff;
    if (byteIdx < byteLength) bytes[byteIdx++] = (triplet >> 8) & 0xff;
    if (byteIdx < byteLength) bytes[byteIdx++] = triplet & 0xff;
  }

  return bytes;
}

/**
 * Extracts a safe normalized extension and MIME type from file metadata.
 * Handles Web blob:/data: URIs, Android content:// URIs, and iOS HEIC/HEIF transcodes.
 */
export function resolveImageFormat(params: {
  mimeType?: string | null;
  fileName?: string | null;
  uri?: string | null;
}): { ext: string; mimeType: string } {
  const rawMime = (params.mimeType || '').trim().toLowerCase();
  const rawName = (params.fileName || '').trim();
  const rawUri = (params.uri || '').trim();

  // 1. Check if data URI carries explicit MIME
  if (rawUri.startsWith('data:image/')) {
    const match = rawUri.match(/^data:(image\/[a-z0-9.+-]+);/i);
    if (match?.[1]) {
      return normalizeMimeAndExt(match[1].toLowerCase(), '');
    }
  }
  if (rawName.startsWith('data:image/')) {
    const match = rawName.match(/^data:(image\/[a-z0-9.+-]+);/i);
    if (match?.[1]) {
      return normalizeMimeAndExt(match[1].toLowerCase(), '');
    }
  }

  // 2. Extract extension from real filename (ignoring URLs/URIs with domain dots)
  let candidateExt = '';
  const isSchemeUri = (s: string) =>
    s.startsWith('blob:') ||
    s.startsWith('data:') ||
    s.startsWith('content:') ||
    s.startsWith('ph:') ||
    s.startsWith('http:') ||
    s.startsWith('https:');

  if (rawName && !isSchemeUri(rawName)) {
    const baseName = rawName.split('?')[0].split('#')[0].split('/').pop() || '';
    if (baseName.includes('.')) {
      candidateExt = baseName.split('.').pop()!.toLowerCase();
    }
  } else if (rawUri && rawUri.startsWith('file:')) {
    const baseName = rawUri.split('?')[0].split('#')[0].split('/').pop() || '';
    if (baseName.includes('.')) {
      candidateExt = baseName.split('.').pop()!.toLowerCase();
    }
  }

  return normalizeMimeAndExt(rawMime, candidateExt);
}

function normalizeMimeAndExt(rawMime: string, rawExt: string): { ext: string; mimeType: string } {
  const cleanExt = rawExt.replace(/[^a-z0-9]/g, '');

  // Map common image extensions & mobile formats
  if (
    cleanExt === 'png' ||
    rawMime === 'image/png' ||
    rawMime === 'image/x-png'
  ) {
    return { ext: 'png', mimeType: 'image/png' };
  }

  if (cleanExt === 'webp' || rawMime === 'image/webp') {
    return { ext: 'webp', mimeType: 'image/webp' };
  }

  if (
    cleanExt === 'jpg' ||
    cleanExt === 'jpeg' ||
    cleanExt === 'jfif' ||
    cleanExt === 'pjpeg' ||
    cleanExt === 'heic' ||
    cleanExt === 'heif' ||
    rawMime === 'image/jpeg' ||
    rawMime === 'image/jpg' ||
    rawMime === 'image/pjpeg' ||
    rawMime === 'image/jfif' ||
    rawMime === 'image/heic' ||
    rawMime === 'image/heif'
  ) {
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }

  // If MIME starts with image/ (e.g. image/bmp, image/gif, image/avif), normalize to jpg after canvas/picker
  if (rawMime.startsWith('image/')) {
    const sub = rawMime.split('/').pop() || 'jpeg';
    if (sub === 'png') return { ext: 'png', mimeType: 'image/png' };
    if (sub === 'webp') return { ext: 'webp', mimeType: 'image/webp' };
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }

  // Default fallback when browser/OS omits MIME on an image picker asset
  if (!cleanExt && !rawMime) {
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }

  return {
    ext: cleanExt || 'jpg',
    mimeType: rawMime || `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}`,
  };
}

/**
 * On Web (PC/Laptop/Mobile Browser): processes a File object, optionally cropping
 * to a 1:1 square (for avatars) and resizing/compressing large or non-standard
 * images via HTML5 Canvas so uploads never fail due to 4K screenshot sizes or HEIC/BMP/JFIF formats.
 */
async function processWebFile(
  file: File,
  options: { cropSquare?: boolean; maxDimension?: number; quality?: number }
): Promise<PickedImageFile> {
  const cropSquare = options.cropSquare ?? false;
  const maxDim = options.maxDimension ?? (cropSquare ? 1024 : 1920);
  const quality = options.quality ?? 0.85;

  const initialFormat = resolveImageFormat({
    mimeType: file.type,
    fileName: file.name,
  });

  const isStandardSmallImage =
    !cropSquare &&
    file.size > 0 &&
    file.size <= 4 * 1024 * 1024 &&
    (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp');

  // Attempt Canvas normalization (handles square crop, oversized 4K screenshots, JFIF/BMP/GIF/AVIF conversion)
  if (typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const processed = await renderWebImageViaCanvas(file, {
        cropSquare,
        maxDim,
        quality,
        preferPng: file.type === 'image/png' && !cropSquare && file.size <= 2 * 1024 * 1024,
      });
      if (processed) {
        return processed;
      }
    } catch {
      // Fall through to direct ArrayBuffer read if canvas fails
    }
  }

  if (isStandardSmallImage || typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const objectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : '';
    return {
      bytes,
      fileName: file.name || `photo_${Date.now()}.${initialFormat.ext}`,
      mimeType: initialFormat.mimeType,
      ext: initialFormat.ext,
      size: bytes.byteLength,
      uri: objectUrl,
    };
  }

  throw new Error('Could not read the selected image file.');
}

function renderWebImageViaCanvas(
  file: File,
  params: { cropSquare: boolean; maxDim: number; quality: number; preferPng: boolean }
): Promise<PickedImageFile | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (!srcW || !srcH) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }

        let sx = 0;
        let sy = 0;
        let sWidth = srcW;
        let sHeight = srcH;

        if (params.cropSquare) {
          const side = Math.min(srcW, srcH);
          sx = Math.floor((srcW - side) / 2);
          sy = Math.floor((srcH - side) / 2);
          sWidth = side;
          sHeight = side;
        }

        let targetW = sWidth;
        let targetH = sHeight;
        if (targetW > params.maxDim || targetH > params.maxDim) {
          const scale = params.maxDim / Math.max(targetW, targetH);
          targetW = Math.max(1, Math.round(targetW * scale));
          targetH = Math.max(1, Math.round(targetH * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }

        const outMime = params.preferPng ? 'image/png' : 'image/jpeg';
        const outExt = params.preferPng ? 'png' : 'jpg';

        // Fill white background for JPEG in case source had transparency
        if (outMime === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetW, targetH);
        }

        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              URL.revokeObjectURL(url);
              resolve(null);
              return;
            }
            try {
              const ab = await blob.arrayBuffer();
              const bytes = new Uint8Array(ab);
              const baseStem = (file.name || 'photo').replace(/\.[^.]+$/, '');
              const previewUrl = URL.createObjectURL(blob);
              URL.revokeObjectURL(url);
              resolve({
                bytes,
                fileName: `${baseStem}.${outExt}`,
                mimeType: outMime,
                ext: outExt,
                size: bytes.byteLength,
                uri: previewUrl,
              });
            } catch {
              URL.revokeObjectURL(url);
              resolve(null);
            }
          },
          outMime,
          params.quality
        );
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Direct HTML5 file input picker for PC / Laptop / Mobile Web browsers.
 * Handles cancel events reliably so UI loading states never freeze.
 */
function pickFilesOnWebDom(options: PickImageOptions): Promise<PickedImageFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*';
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    if (options.allowsMultipleSelection) {
      input.multiple = true;
    }
    if (options.source === 'camera') {
      input.setAttribute('capture', 'user');
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('focus', handleWindowFocus);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const finish = (result: PickedImageFile[], err?: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result);
    };

    const handleWindowFocus = () => {
      // Modern browsers natively dispatch the 'cancel' event if the file dialog is dismissed without picking.
      // We only use window focus as a fallback on legacy browsers that lack 'oncancel'.
      if ('oncancel' in (input as any)) {
        return;
      }
      setTimeout(() => {
        const fileInput = input as HTMLInputElement;
        if (!settled && (!fileInput.files || fileInput.files.length === 0)) {
          finish([]);
        }
      }, 1500);
    };

    input.addEventListener('cancel', () => {
      finish([]);
    });

    input.addEventListener('change', async () => {
      try {
        const fileList = input.files ? Array.from(input.files) : [];
        if (fileList.length === 0) {
          finish([]);
          return;
        }
        const limit = options.allowsMultipleSelection
          ? options.selectionLimit || fileList.length
          : 1;
        const selected = fileList.slice(0, limit);
        const processed: PickedImageFile[] = [];
        for (const f of selected) {
          const item = await processWebFile(f, {
            cropSquare: options.cropSquare,
            maxDimension: options.maxDimension,
            quality: options.quality,
          });
          processed.push(item);
        }
        finish(processed);
      } catch (err) {
        finish([], err);
      }
    });

    document.body.appendChild(input);
    window.addEventListener('focus', handleWindowFocus);
    input.click();
  });
}

/**
 * Converts an Expo ImagePickerAsset into a PickedImageFile with guaranteed Uint8Array bytes
 * across iOS, Android, and Web.
 */
async function assetToPickedImageFile(
  asset: ImagePicker.ImagePickerAsset,
  options: { cropSquare?: boolean; maxDimension?: number; quality?: number } = {}
): Promise<PickedImageFile> {
  // 1. If Web File object is attached on asset.file, process via Web pipeline
  const anyAsset = asset as any;
  if (
    Platform.OS === 'web' &&
    anyAsset.file &&
    typeof File !== 'undefined' &&
    anyAsset.file instanceof File
  ) {
    return await processWebFile(anyAsset.file, options);
  }

  const format = resolveImageFormat({
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    uri: asset.uri,
  });

  // 2. If base64 string is available (from base64: true on iOS/Android/Web or data: URI)
  if (asset.base64 && asset.base64.length > 0) {
    const bytes = decodeBase64ToUint8Array(asset.base64);
    if (bytes.byteLength > 0) {
      return {
        bytes,
        fileName:
          asset.fileName && !asset.fileName.startsWith('data:')
            ? asset.fileName
            : `photo_${Date.now()}.${format.ext}`,
        mimeType: format.mimeType,
        ext: format.ext,
        size: bytes.byteLength,
        uri: asset.uri,
      };
    }
  }

  if (asset.uri && asset.uri.startsWith('data:')) {
    const bytes = decodeBase64ToUint8Array(asset.uri);
    if (bytes.byteLength > 0) {
      return {
        bytes,
        fileName: `photo_${Date.now()}.${format.ext}`,
        mimeType: format.mimeType,
        ext: format.ext,
        size: bytes.byteLength,
        uri: asset.uri,
      };
    }
  }

  // 3. Fallback: fetch the asset URI and extract ArrayBuffer / Blob bytes
  let bytes: Uint8Array | null = null;
  try {
    const response = await fetch(asset.uri);
    if (typeof response.arrayBuffer === 'function') {
      const ab = await response.arrayBuffer();
      bytes = new Uint8Array(ab);
    } else {
      const blob = await response.blob();
      if (typeof (blob as any).arrayBuffer === 'function') {
        bytes = new Uint8Array(await (blob as any).arrayBuffer());
      }
    }
  } catch {
    // If fetch fails on native file/content URI, try FileSystem reading as base64
    try {
      const FileSystem = require('expo-file-system');
      if (FileSystem && FileSystem.readAsStringAsync) {
        const b64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });
        if (b64) {
          bytes = decodeBase64ToUint8Array(b64);
        }
      }
    } catch {}
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Could not read image data on this device.');
  }

  return {
    bytes,
    fileName:
      asset.fileName && !asset.fileName.includes('://')
        ? asset.fileName
        : `photo_${Date.now()}.${format.ext}`,
    mimeType: format.mimeType,
    ext: format.ext,
    size: bytes.byteLength,
    uri: asset.uri,
  };
}

/**
 * Universal image picker that works across PC, Laptop, Android, iOS, and Mobile Web.
 */
export async function pickImagesUniversal(
  options: PickImageOptions = {}
): Promise<PickedImageFile[]> {
  const source = options.source || 'library';

  // On PC / Laptop / Mobile Web Browser: use direct DOM file input for maximum reliability
  if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof window !== 'undefined') {
    return await pickFilesOnWebDom(options);
  }

  // On Native Mobile (Android & iOS): request permissions first
  if (Platform.OS !== 'web') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          const open = await confirmDialog({
            title: 'Camera Permission Required',
            message:
              'Camera access was previously denied for Gigormoc. Would you like to open Settings to enable camera access?',
            confirmText: 'Open Settings',
            cancelText: 'Cancel',
          });
          if (open) {
            await Linking.openSettings().catch(() => {});
          }
        }
        throw new Error('Camera permission is required to take a photo. You can choose a photo from your library instead.');
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      const hasPerm =
        perm.granted ||
        (perm as any).accessPrivileges === 'limited' ||
        (perm as any).accessPrivileges === 'all';
      if (!hasPerm) {
        if (!perm.canAskAgain) {
          const open = await confirmDialog({
            title: 'Photo Access Required',
            message:
              'Photo library access was previously denied for Gigormoc. Would you like to open Settings to enable photo access?',
            confirmText: 'Open Settings',
            cancelText: 'Cancel',
          });
          if (open) {
            await Linking.openSettings().catch(() => {});
          }
        }
        throw new Error('Photo library permission is required to choose a photo.');
      }
    }
  }

  const allowsMultiple = Boolean(options.allowsMultipleSelection && source !== 'camera');

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Note: Android does not allow allowsEditing=true when allowsMultipleSelection=true
    allowsEditing: allowsMultiple ? false : Boolean(options.cropSquare),
    aspect: options.cropSquare ? [1, 1] : undefined,
    allowsMultipleSelection: allowsMultiple,
    selectionLimit: allowsMultiple ? options.selectionLimit || 3 : 1,
    quality: options.quality ?? 0.8,
    base64: true,
  };

  let result: ImagePicker.ImagePickerResult;
  try {
    result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);
  } catch (err: any) {
    // Fallback if device camera is unavailable (e.g. simulator or desktop)
    if (source === 'camera') {
      result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    } else {
      throw err;
    }
  }

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return [];
  }

  const limit = allowsMultiple ? options.selectionLimit || result.assets.length : 1;
  const picked: PickedImageFile[] = [];

  for (const asset of result.assets.slice(0, limit)) {
    const file = await assetToPickedImageFile(asset, options);
    picked.push(file);
  }

  return picked;
}
