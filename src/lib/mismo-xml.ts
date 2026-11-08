export const xmlText = (value: string | number) => {
  const text = String(value);
  if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(text)) {
    throw new Error("Remove unsupported characters from the application before exporting.");
  }
  return text.replace(/[<>&"']/g, (character) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
};

export const leaf = (tag: string, value?: string | number) =>
  value === "" || value === undefined ? "" : `<${tag}>${xmlText(value)}</${tag}>`;

export function container(tag: string, children: string[], attributes: Record<string, string> = {}) {
  const body = children.filter(Boolean);
  if (!body.length) return "";
  const attrs = Object.entries(attributes).map(([key, value]) => ` ${key}="${xmlText(value)}"`).join("");
  return `<${tag}${attrs}>\n${body.join("\n")}\n</${tag}>`;
}

export const fields = (tag: string, values: Record<string, string | number | undefined>, attrs?: Record<string, string>) =>
  container(tag, Object.entries(values).map(([key, value]) => leaf(key, value)), attrs);

export const indicator = (value?: string) => value === "Yes" ? "true" : value === "No" ? "false" : undefined;
export const label = (value: string) => ({ "xlink:label": value });
export const partyRole = (type: string) => fields("ROLE_DETAIL", { PartyRoleType: type });

export function relationship(from: string, to: string, arc: string) {
  return `<RELATIONSHIP xlink:from="${xmlText(from)}" xlink:to="${xmlText(to)}" xlink:arcrole="urn:fdc:mismo.org:2009:residential/${arc}"/>`;
}

export function mismoAddress(input: { street: string; unit: string; city: string; state: string; zip: string; country?: string }, addressType?: string, county?: string) {
  const country = input.country?.toUpperCase();
  return fields("ADDRESS", {
    AddressLineText: input.street, AddressType: addressType, AddressUnitIdentifier: input.unit,
    CityName: input.city, CountryCode: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    CountryName: country && !/^[A-Z]{2}$/.test(country) ? input.country : undefined,
    CountyName: county, PostalCode: input.zip, StateCode: input.state,
  });
}

export function contactPoint(kind: string, value?: string, role?: string, extension?: string) {
  if (!value) return "";
  return container("CONTACT_POINT", [
    kind === "email" ? fields("CONTACT_POINT_EMAIL", { ContactPointEmailValue: value }) :
      fields("CONTACT_POINT_TELEPHONE", { ContactPointTelephoneExtensionValue: extension, ContactPointTelephoneValue: value.replace(/[^0-9]/g, "") }),
    fields("CONTACT_POINT_DETAIL", { ContactPointRoleType: role }),
  ]);
}
