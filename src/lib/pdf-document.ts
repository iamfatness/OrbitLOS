// Callers provide ASCII PDF objects. PDF offsets and stream lengths then match byte lengths.
export function pdfDocument(objects: string[]) {
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  return pdf + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const winAnsi = "€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ";

function pdfCharacterCode(character: string) {
  const code = character.codePointAt(0)!;
  if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
  const index = winAnsi.indexOf(character);
  return index < 0 || code === 0 ? undefined : 128 + index;
}

export function pdfText(value: string) {
  const characters = [...value.normalize("NFC").replace(/[‐-―]/g, "-")];
  return characters.map((character) => {
    const code = pdfCharacterCode(character);
    if (code !== undefined) return code.toString(16).padStart(2, "0");
    throw new Error("Use Latin-script fictional names and addresses for this sample PDF.");
  }).join("");
}

export function pdfWrappedLines(value: string, limit: number, width = (text: string) => text.length) {
  const result: string[] = [];
  let line = "";
  for (const word of value.trim().split(/\s+/)) {
    if (width(`${line} ${word}`) <= limit) { line = line ? `${line} ${word}` : word; continue; }
    if (line) result.push(line);
    line = "";
    for (const character of word) {
      if (width(line + character) > limit && line) {
        result.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) result.push(line);
  return result;
}

export function pdfSafeBodyText(value: string) {
  return [...value.normalize("NFC").replace(/[‐-―]/g, "-").replace(/\s+/g, " ")].map((character) =>
    pdfCharacterCode(character) !== undefined ? character : `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`).join("");
}
