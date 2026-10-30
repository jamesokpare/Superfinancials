/**
 * Text layer of a PDF (unpdf / pdf.js), pages joined with newlines. Scanned
 * documents have no text layer and come back as an empty string.
 */
import { extractText, getDocumentProxy } from "unpdf";

export async function pdfText(buf: ArrayBuffer | Uint8Array | Buffer): Promise<string> {
  const pdf = await getDocumentProxy(buf instanceof Uint8Array ? new Uint8Array(buf) : new Uint8Array(buf));
  try { const { text } = await extractText(pdf, { mergePages: true }); return String(text ?? "").replace(/\r/g, "").trim(); }
  finally { try { await pdf.cleanup(); } catch { /* nothing to free */ } }
}
