import { serializeVCards } from "./vcard";

const mockVcf = serializeVCards([
  { name: "Ada", firstName: "Ada", lastName: "L", phones: [{ label: "mobile", number: "1" }], emails: [] },
  { name: "Bob", phones: [], emails: [{ label: "home", address: "b@x.com" }] },
]);

jest.mock("expo-file-system/legacy", () => ({ readAsStringAsync: jest.fn(async () => mockVcf) }));
jest.mock("./contactsSource", () => ({
  addContact: jest.fn(),
  requestContactsPermission: jest.fn(async () => true),
}));

import { addContact, requestContactsPermission } from "./contactsSource";
import { restoreContacts } from "./restoreContacts";

const addContactMock = addContact as jest.Mock;
beforeEach(() => jest.clearAllMocks());

describe("restoreContacts", () => {
  it("adds every parsed contact and returns the count", async () => {
    addContactMock.mockResolvedValue("id");
    const res = await restoreContacts("file:///cache/contacts.vcf");
    expect(addContactMock).toHaveBeenCalledTimes(2);
    expect(addContactMock.mock.calls[0][0]).toMatchObject({ name: "Ada" });
    expect(res).toEqual({ added: 2, failed: 0 });
  });

  it("counts failures without aborting the batch", async () => {
    addContactMock.mockResolvedValueOnce("id").mockRejectedValueOnce(new Error("nope"));
    const res = await restoreContacts("file:///cache/contacts.vcf");
    expect(res).toEqual({ added: 1, failed: 1 });
  });

  it("throws when contacts permission is denied", async () => {
    (requestContactsPermission as jest.Mock).mockResolvedValueOnce(false);
    await expect(restoreContacts("file:///cache/contacts.vcf")).rejects.toThrow(/permission/i);
    expect(addContact).not.toHaveBeenCalled();
  });
});
