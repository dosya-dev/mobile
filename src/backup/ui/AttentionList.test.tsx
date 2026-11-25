import { render, screen, fireEvent } from "@testing-library/react-native";
import { AttentionList } from "./AttentionList";
import type { AttentionItem } from "./attention";

const photo: AttentionItem = { id: "photo-access", title: "Allow photo access", detail: "Needed to copy photos.", tone: "warn", actionable: true };
const offline: AttentionItem = { id: "offline", title: "You're offline", detail: "Backup resumes when a connection returns.", tone: "info", actionable: false };

describe("AttentionList", () => {
  it("renders nothing when there is nothing to say", () => {
    render(<AttentionList items={[]} firstRun={false} onPress={jest.fn()} />);
    expect(screen.queryByTestId("attention")).toBeNull();
  });

  it("renders one row per item, by id, with its title and detail", () => {
    render(<AttentionList items={[photo, offline]} firstRun onPress={jest.fn()} />);
    expect(screen.getByTestId("attention-photo-access")).toHaveTextContent(/Allow photo access/);
    expect(screen.getByTestId("attention-photo-access")).toHaveTextContent(/Needed to copy photos\./);
    expect(screen.getByTestId("attention-offline")).toBeTruthy();
  });

  it("adds a counted heading only once there are two or more", () => {
    const one = render(<AttentionList items={[photo]} firstRun onPress={jest.fn()} />);
    expect(one.queryByTestId("attention-heading")).toBeNull();
    one.unmount();
    render(<AttentionList items={[photo, offline]} firstRun onPress={jest.fn()} />);
    expect(screen.getByTestId("attention-heading")).toHaveTextContent("2 things before the first backup");
  });

  it("fires onPress with the id for actionable rows only", () => {
    const onPress = jest.fn();
    render(<AttentionList items={[photo, offline]} firstRun={false} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("attention-photo-access"));
    expect(onPress).toHaveBeenCalledWith("photo-access");
    fireEvent.press(screen.getByTestId("attention-offline"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
