import assert from "node:assert/strict";

export async function readActionResult(response, name) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const textChunks = new Map();
  let actionResult;
  // React text chunks have a byte length and can precede or follow the action result.
  for (let offset = 0; offset < bytes.length;) {
    const end = bytes.indexOf(10, offset);
    const line = bytes.toString("utf8", offset, end < 0 ? bytes.length : end);
    const textHeader = /^([a-f0-9]+):T([a-f0-9]+),/.exec(line);
    if (textHeader) {
      const start = offset + textHeader[0].length;
      offset = start + Number.parseInt(textHeader[2], 16);
      assert.ok(offset <= bytes.length, `Incomplete text chunk for ${name}`);
      textChunks.set(textHeader[1], bytes.toString("utf8", start, offset));
    } else {
      assert.notEqual(end, -1, `Incomplete response for ${name}`);
      if (line.startsWith("0:")) actionResult = JSON.parse(line.slice(2));
      offset = end + 1;
    }
  }
  assert.ok(actionResult, `No action result for ${name}`);
  const { returnValue } = actionResult;
  assert.equal(returnValue.ok, true, `Action protocol error for ${name}`);
  const data = returnValue.data;
  for (const [record, field] of [[data, "mismoXml"], [data, "csv"], [data, "html"],
    ...(data?.kind === "fv7Template" ? [[data, "json"]] : []),
    ...(data?.kind === "fv7Read" ? [[data, "evidence"]] : []),
    ...(data?.kind === "programMonth" ? data.reviews.map(review => [review, "snapshot"]) : []),
    ...(data?.batches ?? []).map((batch) => [batch, "csv"])]) {
    const reference = /^\$([a-f0-9]+)$/.exec(record?.[field] ?? "");
    if (reference) {
      assert.ok(textChunks.has(reference[1]), `The ${name} action must include its ${field} text chunk`);
      record[field] = textChunks.get(reference[1]);
    }
  }
  return data;
}
