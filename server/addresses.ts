// Saved shipping addresses on a customer account. Signed-in orders can omit the
// address (the default is used) or name one by addressId; guests are unchanged.
import { z } from "zod";
import { db, get, put, all, remove, id, HttpError } from "./store.js";
import { addressSchema, type Session } from "./types.js";
import { requireAccount } from "./accounts.js";

export const maxSavedAddresses = 10;
export interface SavedAddress {
  id: string;
  accountId: string;
  label?: string;
  address: z.infer<typeof addressSchema>;
  default: boolean;
  created: number;
}
export const savedAddressInput = z
  .object({
    address: addressSchema,
    label: z.string().trim().min(1).max(40).optional(),
    default: z.boolean().optional(),
  })
  .strict();

export const addressView = (a: SavedAddress) => ({
  id: a.id,
  label: a.label ?? null,
  default: a.default,
  address: a.address,
  created: new Date(a.created).toISOString(),
});

export function savedAddresses(accountId: string) {
  return all<SavedAddress>("account-address", accountId).sort(
    (a, b) => Number(b.default) - Number(a.default) || b.created - a.created || a.id.localeCompare(b.id),
  );
}
function owned(accountId: string, addressId: unknown) {
  const a =
    typeof addressId === "string" && addressId.length <= 100
      ? get<SavedAddress>("account-address", addressId)
      : undefined;
  if (!a || a.accountId !== accountId)
    throw new HttpError(404, "address_not_found", "Saved address not found.");
  return a;
}
const same = (a: SavedAddress["address"], b: SavedAddress["address"]) =>
  JSON.stringify(a) === JSON.stringify(b);

export function saveAddress(session: Session, body: unknown) {
  const accountId = requireAccount(session, "poppy:write");
  const input = savedAddressInput.parse(body);
  return db.transaction(() => {
    const existing = savedAddresses(accountId);
    const duplicate = existing.find((a) => same(a.address, input.address));
    if (duplicate) {
      const updated = { ...duplicate, label: input.label ?? duplicate.label };
      if (input.default) setDefault(accountId, existing, updated.id);
      put("account-address", updated.id, { ...updated, default: input.default || duplicate.default }, accountId);
      return { created: false, address: get<SavedAddress>("account-address", updated.id)! };
    }
    if (existing.length >= maxSavedAddresses)
      throw new HttpError(
        409,
        "address_limit",
        `An account can save up to ${maxSavedAddresses} addresses. Delete one first.`,
      );
    const saved: SavedAddress = {
      id: id("addr"),
      accountId,
      ...(input.label ? { label: input.label } : {}),
      address: input.address,
      default: input.default === true || existing.length === 0,
      created: Date.now(),
    };
    if (saved.default) setDefault(accountId, existing, saved.id);
    put("account-address", saved.id, saved, accountId);
    return { created: true, address: saved };
  })();
}
function setDefault(accountId: string, existing: SavedAddress[], addressId: string) {
  for (const a of existing)
    if (a.default && a.id !== addressId)
      put("account-address", a.id, { ...a, default: false }, accountId);
}
export function makeDefault(session: Session, addressId: string) {
  const accountId = requireAccount(session, "poppy:write");
  return db.transaction(() => {
    const target = owned(accountId, addressId);
    setDefault(accountId, savedAddresses(accountId), target.id);
    const updated = { ...target, default: true };
    put("account-address", target.id, updated, accountId);
    return updated;
  })();
}
export function deleteAddress(session: Session, addressId: string) {
  const accountId = requireAccount(session, "poppy:write");
  db.transaction(() => {
    const target = owned(accountId, addressId);
    remove("account-address", target.id);
    if (target.default) {
      const next = savedAddresses(accountId)[0];
      if (next) put("account-address", next.id, { ...next, default: true }, accountId);
    }
  })();
}

/**
 * Fill a signed-in proposal from the account: `addressId` picks a saved address,
 * a missing address uses the default one, and a missing email uses the account's
 * verified email. The resolved address and email appear in the proposal's
 * summary, which the user approves as usual. Guest proposals are untouched.
 */
export function resolveAccountDefaults(body: unknown, session: Session) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = { ...(body as Record<string, unknown>) };
  if (!session.accountId) {
    if ("addressId" in b)
      throw new HttpError(
        403,
        "sign_in_required",
        "Saved addresses need a signed-in session with poppy:write.",
        { scope: "poppy:write" },
      );
    return body;
  }
  const accountId = requireAccount(session, "poppy:write");
  if ("addressId" in b) {
    if (b.address !== undefined)
      throw new HttpError(400, "invalid_request", "Send address or addressId, not both.");
    b.address = owned(accountId, b.addressId).address;
    delete b.addressId;
  } else if (b.address === undefined) {
    const fallback = savedAddresses(accountId).find((a) => a.default);
    if (!fallback)
      throw new HttpError(
        400,
        "address_required",
        "This account has no saved address. Include a shipping address, or save one first.",
      );
    b.address = fallback.address;
  }
  if (b.email === undefined) b.email = get("account", accountId)?.email;
  return b;
}
