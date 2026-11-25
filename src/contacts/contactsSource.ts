import * as Contacts from "expo-contacts";
import { t } from "@/lib/i18n";
import type { NormalizedContact, ContactPhone, ContactEmail } from "./vcard";

const PAGE_SIZE = 100;

export async function requestContactsPermission(): Promise<boolean> {
  const res = await Contacts.requestPermissionsAsync();
  return res.granted;
}

function mapContact(c: Contacts.Contact): NormalizedContact {
  const phones: ContactPhone[] = (c.phoneNumbers ?? [])
    .filter((p): p is Contacts.PhoneNumber & { number: string } => typeof p.number === "string" && p.number.length > 0)
    .map((p) => ({ label: p.label || "other", number: p.number }));
  const emails: ContactEmail[] = (c.emails ?? [])
    .filter((e): e is Contacts.Email & { email: string } => typeof e.email === "string" && e.email.length > 0)
    .map((e) => ({ label: e.label || "other", address: e.email }));
  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed"; // written into the uploaded .vcf file: data, not UI text, so it stays the same in every language
  const out: NormalizedContact = { name, phones, emails };
  if (c.firstName) out.firstName = c.firstName;
  if (c.lastName) out.lastName = c.lastName;
  return out;
}

export async function readAllContacts(): Promise<NormalizedContact[]> {
  if (!(await requestContactsPermission())) {
    throw new Error(t("common.error.contactsPermissionWasDenied"));
  }
  const out: NormalizedContact[] = [];
  let pageOffset = 0;
  // Loop pages until the address book is exhausted.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await Contacts.getContactsAsync({
      fields: [
        Contacts.Fields.Name,
        Contacts.Fields.FirstName,
        Contacts.Fields.LastName,
        Contacts.Fields.PhoneNumbers,
        Contacts.Fields.Emails,
      ],
      pageSize: PAGE_SIZE,
      pageOffset,
    });
    for (const c of res.data) out.push(mapContact(c));
    if (!res.hasNextPage) break;
    pageOffset += PAGE_SIZE;
  }
  return out;
}

export async function addContact(c: NormalizedContact): Promise<string> {
  const contact: Contacts.Contact = {
    contactType: Contacts.ContactTypes.Person,
    name: c.name,
    ...(c.firstName ? { firstName: c.firstName } : {}),
    ...(c.lastName ? { lastName: c.lastName } : {}),
    phoneNumbers: c.phones.map((p) => ({ label: p.label, number: p.number })),
    emails: c.emails.map((e) => ({ label: e.label, email: e.address })),
  };
  return Contacts.addContactAsync(contact);
}
