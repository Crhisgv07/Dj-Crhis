export type Id3Meta = {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  comment?: string;
  cover?: string;
};

export function parseId3(buffer: ArrayBuffer): Id3Meta {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!) !== "ID3") {
    return {};
  }
  const version = bytes[3] ?? 3;
  const size = synchsafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + size);
  const meta: Id3Meta = {};
  let offset = 10;
  if ((bytes[5] ?? 0) & 0x40) offset += 4 + synchsafe(bytes, 10);

  while (offset + 10 < end) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize =
      version === 4 ? synchsafe(bytes, offset + 4) : readU32(bytes, offset + 4);
    const dataStart = offset + 10;
    const dataEnd = Math.min(end, dataStart + frameSize);
    if (dataEnd <= dataStart) break;
    const frame = bytes.subarray(dataStart, dataEnd);
    if (id === "TIT2") meta.title = readText(frame);
    if (id === "TPE1") meta.artist = readText(frame);
    if (id === "TALB") meta.album = readText(frame);
    if (id === "TYER" || id === "TDRC") meta.year = readText(frame).slice(0, 4);
    if (id === "TCON") {
      const g = readText(frame);
      meta.genre = g.replace(/^\((\d+)\)/, "").trim() || g;
    }
    if (id === "COMM") meta.comment = readComment(frame);
    if (id === "APIC" && !meta.cover) meta.cover = readPicture(frame);
    offset = dataEnd;
  }
  return meta;
}

function synchsafe(bytes: Uint8Array, i: number) {
  return ((bytes[i]! & 0x7f) << 21) | ((bytes[i + 1]! & 0x7f) << 14) | ((bytes[i + 2]! & 0x7f) << 7) | (bytes[i + 3]! & 0x7f);
}

function readU32(bytes: Uint8Array, i: number) {
  return ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
}

function readText(frame: Uint8Array) {
  if (!frame.length) return "";
  return decodeId3(frame[0]!, frame.subarray(1));
}

/** COMM = [enc][lang:3][descripción\0][texto]. Antes se saltaban sólo 3 bytes y
 *  el byte de idioma se tomaba como codificación → texto ilegible. */
function readComment(frame: Uint8Array) {
  if (frame.length < 5) return "";
  const enc = frame[0]!;
  const wide = enc === 1 || enc === 2;
  let i = 4; // enc(1) + idioma(3)
  if (wide) {
    while (i + 1 < frame.length && !(frame[i] === 0 && frame[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < frame.length && frame[i] !== 0) i += 1;
    i += 1;
  }
  return decodeId3(enc, frame.subarray(i));
}

const clean = (s: string) => s.replace(/[\uFEFF\uFFFE]/g, "").replace(/\0/g, " ").trim();

/** UTF-16 de ID3: muchos taggers ponen el BOM equivocado (o dos BOM seguidos) y
 *  el texto real es Big-Endian aunque el frame diga "enc 1". Detectamos el/los
 *  BOM a mano y, si no hay, adivinamos el endianness por dónde caen los ceros. */
function decodeUtf16(data: Uint8Array): string {
  let d = data;
  let le: boolean | null = null;
  while (d.length >= 2 && ((d[0] === 0xff && d[1] === 0xfe) || (d[0] === 0xfe && d[1] === 0xff))) {
    le = d[0] === 0xff; // FF FE → LE · FE FF → BE
    d = d.subarray(2);
  }
  if (le === null) {
    // Sin BOM: en LE el byte cero suele ser el impar (texto latino/ASCII).
    let evenZero = 0;
    let oddZero = 0;
    const n = Math.min(d.length, 96);
    for (let i = 0; i + 1 < n; i += 2) {
      if (d[i] === 0) evenZero += 1;
      if (d[i + 1] === 0) oddZero += 1;
    }
    le = oddZero >= evenZero;
  }
  return new TextDecoder(le ? "utf-16le" : "utf-16be").decode(d);
}

/** Decodifica texto ID3 tolerando los dos errores más comunes del mundo real:
 *  (1) UTF-16 con BOM equivocado / doble BOM / endianness al revés, y
 *  (2) tags marcados como ISO-8859-1 (enc 0) que en realidad llevan UTF-8
 *  (típico en MP3 en español) → salían como "AdoraciÃ³n". */
function decodeId3(encoding: number, data: Uint8Array): string {
  if (!data.length) return "";
  try {
    if (encoding === 1 || encoding === 2) return clean(decodeUtf16(data));
    if (encoding === 3) return clean(new TextDecoder("utf-8").decode(data));
    // encoding 0 (o desconocido): probamos UTF-8 estricto; si es válido y hay
    // bytes altos, era UTF-8 mal etiquetado. Si no, Windows-1252.
    if (data.some((b) => b >= 0x80)) {
      try {
        const asUtf8 = new TextDecoder("utf-8", { fatal: true }).decode(data);
        return clean(asUtf8);
      } catch {
        /* no era UTF-8 válido: cae a 1252 */
      }
    }
    return clean(new TextDecoder("windows-1252").decode(data));
  } catch {
    return "";
  }
}

/** APIC = [enc][mime\0][tipo:1][descripción\0(\0)][imagen].
 *  La descripción va en `enc`: si es UTF-16 el terminador es 00 00, no 00 — el
 *  código anterior cortaba en el primer 00 (que en UTF-16BE es el primer byte de
 *  la 1ª letra) y devolvía una imagen corrupta. */
function readPicture(frame: Uint8Array): string | undefined {
  if (frame.length < 12) return;
  const enc = frame[0]!;
  let i = 1;
  const mimeStart = i;
  while (i < frame.length && frame[i] !== 0) i += 1;
  let mime = new TextDecoder("latin1").decode(frame.subarray(mimeStart, i)).trim().toLowerCase();
  i += 1; // \0 del mime
  i += 1; // byte de tipo de imagen
  if (enc === 1 || enc === 2) {
    while (i + 1 < frame.length && !(frame[i] === 0 && frame[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < frame.length && frame[i] !== 0) i += 1;
    i += 1;
  }
  const image = frame.subarray(i);
  if (image.length < 24 || image.length > 12_000_000) return;
  // El MIME del tag suele venir mal ("image/jpg", vacío…): confírmalo por los
  // bytes mágicos de la imagen.
  if (image[0] === 0x89 && image[1] === 0x50) mime = "image/png";
  else if (image[0] === 0xff && image[1] === 0xd8) mime = "image/jpeg";
  else if (image[0] === 0x47 && image[1] === 0x49 && image[2] === 0x46) mime = "image/gif";
  else if (image[0] === 0x52 && image[1] === 0x49 && image[2] === 0x46 && image[3] === 0x46) mime = "image/webp";
  else if (!mime.startsWith("image/")) mime = "image/jpeg";
  else if (mime === "image/jpg") mime = "image/jpeg";
  // data URL (persistible), no blob URL efímera.
  return `data:${mime};base64,${bytesToBase64(image)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}
