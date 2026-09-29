// Pure ESM: safe to import from Deno, Node, or a future browser login module.
// ENo is decimal text at the API boundary to preserve PostgreSQL bigint precision.
export function canonicalEno(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Invalid ENo");
    value = String(value);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new TypeError("Invalid ENo");
  }
  const eno = BigInt(value);
  if (eno < 1n || eno > 9223372036854775807n) throw new TypeError("Invalid ENo");
  return String(eno);
}

export function internalEmailForEno(eno) {
  return `eno-${canonicalEno(eno)}@auth.diesduck.invalid`;
}
