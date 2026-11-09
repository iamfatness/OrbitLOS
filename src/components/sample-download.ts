export function downloadSampleFile(contents: string | Blob, filename: string, type?: string) {
  const url = URL.createObjectURL(typeof contents === "string" ? new Blob([contents], { type }) : contents);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
