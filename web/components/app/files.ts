// What a visitor can download. Every file is built from real results: the solver's STL, the checker's header, the design JSON, the live run's bundle.
export interface ProductFile {
  name: string;
  mime: string;
  /** One short line: what it is. */
  note: string;
  text?: string;
  base64?: string;
}

export const bytesOf = (f: ProductFile): number => (f.text !== undefined ? new TextEncoder().encode(f.text).length : f.base64 ? Math.floor((f.base64.length * 3) / 4) : 0);

export function toBlob(f: ProductFile): Blob {
  if (f.text !== undefined) return new Blob([f.text], { type: f.mime });
  const bin = atob(f.base64 ?? "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: f.mime });
}

/** Browser download of one file. Safe to call only from a click handler. */
export function downloadFile(f: ProductFile) {
  const url = URL.createObjectURL(toBlob(f));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

const guessMime = (path: string) => (/\.(c|h|v|sv|txt|md|diff|patch|json|csv|log)$/i.test(path) ? "text/plain" : "application/octet-stream");
export function fromBundle(files: Array<{ path: string; text?: string; base64?: string }>): ProductFile[] {
  return files.map((f) => ({ name: f.path.split("/").pop() ?? f.path, mime: guessMime(f.path), note: f.path, text: f.text, base64: f.base64 }));
}
