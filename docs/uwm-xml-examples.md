# UWM XML examples received November 11, 2026

Source: Phil Abraham's 09:21 reply, forwarded to the connected inbox as **OrbitLOS - Credentials - Public APIs example XML and example ULAD**. Gmail message `1a1cafe0bcd5f52a`. Original files are retained locally in ignored `.orbit/uwm-examples-20261111/`; borrower-like example fields are not committed to Git.

| Example | Bytes | SHA-256 |
| --- | ---: | --- |
| Kitchen Sink Loan Import 16.xml | 64,816 | 37507b517f42c1a74ee54e199f0e4d4d7eaaf4539842c868e7386db4b243f209 |
| Super Basic Slam Dunk Loan 19.xml | 32,679 | 1846f6b9c6835e55c03b0fc08e751ce1edb0c255c15a1305726b53eb14ab5add |
| ulad_1526000000 (1).xml | 56,520 | cf3f81c3eb07e8eed33d3c8989a9ec2cd15b13321a9a8d17b46d47ae6d796999 |

All three are well-formed MISMO XML with one DEAL and one LOAN, reference model `3.4.032420160128`, and the namespace `http://www.mismo.org/residential/2009/schemas`. Imports additionally use DU and ULAD extension namespaces; the export uses the ULAD extension namespace. They fit the current 1 MiB limit. This is parser/size validation, not XSD validation or acceptance by UWM; the referenced XSD was not supplied.

## Export identification

The export's lender loan number is the `LoanIdentifier` sibling of `LoanIdentifierType` equal to `LenderLoan` under:

`MESSAGE/DEAL_SETS/DEAL_SET/DEALS/DEAL/LOANS/LOAN/LOAN_IDENTIFIERS/LOAN_IDENTIFIER`

Every element in that path must have the MISMO namespace. The export also contains `AgencyCase` and `UniversalLoan` identifiers, which must not be used as the UWM lender number. The import samples contain shorter LenderLoan values and are not evidence of completed UWM loans.

The receiver now strictly parses XML and recognizes exactly one unambiguous 10-digit LenderLoan identifier in a single-loan MISMO 3.4 document. Prefix names may vary; namespace URIs may not. DTDs, entities requiring declarations, malformed XML and excessive complexity are rejected. Unknown structures, versions, missing identifiers, duplicate lender identifiers and multiple loans remain unassigned. Recognized exports route only through the existing environment/loan ownership mapping established by a registered UWM import. Original XML bytes remain archived; no borrower application, amount, status, condition or lock is overwritten from XML.

## Remaining onboarding items

These examples resolve the demonstrated ULAD identifier path and provide two import artifacts for a future supervised test. They do not supply approved Azure upload origins, actual webhook delivery, production date/status JSON loan-number mapping, retry/order semantics, brokerage Insights credentials, or full XML schema validation. No sample was sent to UWM and no real loan or rate request was made while implementing this change.
