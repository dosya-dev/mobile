jest.mock("expo-contacts", () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  getContactsAsync: jest.fn(),
  addContactAsync: jest.fn(async () => "new-id"),
  Fields: { Name: "name", FirstName: "firstName", LastName: "lastName", PhoneNumbers: "phoneNumbers", Emails: "emails" },
  ContactTypes: { Person: "person", Company: "company" },
}));

import * as Contacts from "expo-contacts";
import { readAllContacts, addContact, requestContactsPermission } from "./contactsSource";

const getContactsAsync = Contacts.getContactsAsync as jest.Mock;
const requestPermissionsAsync = Contacts.requestPermissionsAsync as jest.Mock;
const addContactAsync = Contacts.addContactAsync as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("readAllContacts", () => {
  it("pages until hasNextPage is false and maps to NormalizedContact", async () => {
    getContactsAsync
      .mockResolvedValueOnce({
        data: [{
          id: "1", contactType: "person", name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace",
          phoneNumbers: [{ label: "mobile", number: "+1 555 0100" }],
          emails: [{ label: "home", email: "ada@example.com" }],
        }],
        hasNextPage: true, hasPreviousPage: false,
      })
      .mockResolvedValueOnce({
        data: [{ id: "2", contactType: "person", name: "Bob" }],
        hasNextPage: false, hasPreviousPage: true,
      });

    const out = await readAllContacts();
    expect(getContactsAsync).toHaveBeenCalledTimes(2);
    expect(getContactsAsync.mock.calls[1][0]).toMatchObject({ pageOffset: 100 });
    expect(out).toEqual([
      {
        name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace",
        phones: [{ label: "mobile", number: "+1 555 0100" }],
        emails: [{ label: "home", address: "ada@example.com" }],
      },
      { name: "Bob", phones: [], emails: [] },
    ]);
  });

  it("drops phone/email entries with no value and defaults a missing label", async () => {
    getContactsAsync.mockResolvedValueOnce({
      data: [{
        id: "3", contactType: "person", name: "Nameless",
        phoneNumbers: [{ label: "", number: "123" }, { label: "work" /* no number */ }],
        emails: [{ /* no email */ label: "home" }],
      }],
      hasNextPage: false, hasPreviousPage: false,
    });
    const out = await readAllContacts();
    expect(out[0]).toEqual({ name: "Nameless", phones: [{ label: "other", number: "123" }], emails: [] });
  });

  it("throws when permission is denied", async () => {
    requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: "denied" });
    await expect(readAllContacts()).rejects.toThrow("Contacts permission was denied");
    expect(getContactsAsync).not.toHaveBeenCalled();
  });
});

describe("addContact", () => {
  it("builds a Person contact and returns the new id", async () => {
    const id = await addContact({
      name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace",
      phones: [{ label: "mobile", number: "+1 555 0100" }],
      emails: [{ label: "home", address: "ada@example.com" }],
    });
    expect(id).toBe("new-id");
    expect(addContactAsync).toHaveBeenCalledWith({
      contactType: "person", name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace",
      phoneNumbers: [{ label: "mobile", number: "+1 555 0100" }],
      emails: [{ label: "home", email: "ada@example.com" }],
    });
  });
});

describe("requestContactsPermission", () => {
  it("returns the granted flag", async () => {
    await expect(requestContactsPermission()).resolves.toBe(true);
  });
});
