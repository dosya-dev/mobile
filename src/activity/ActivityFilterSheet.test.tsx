import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { ActivityFilterSheet } from "./ActivityFilterSheet";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { NO_FILTERS, type ActivityFilters } from "./api";

/** A three-button Android navigation bar - what the Apply button must clear. */
const NAV_BAR = 48;

const MEMBERS = [
  { id: "u1", name: "Ada", email: "ada@x.com" },
  { id: "u2", name: null, email: "bob@x.com" },
];

function renderSheet(filters: ActivityFilters = NO_FILTERS) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: NAV_BAR, left: 0, right: 0 }}>
      <ThemeProvider>
        <ActivityFilterSheet visible filters={filters} members={MEMBERS} onApply={onApply} onClose={onClose} />
      </ThemeProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  return { onApply, onClose };
}

const open = (section: string) => fireEvent.press(screen.getByTestId(`activity-filter-${section}`));

it("opens on Category, because that is the choice that narrows the others", () => {
  renderSheet();
  expect(screen.getByTestId("activity-filter-category-files")).toBeTruthy();
  // Action is fifty-odd chips; opening with all of them showing is a wall.
  expect(screen.queryByTestId("activity-filter-action-file_uploaded")).toBeNull();
});

it("applies only on Show activity, not on every chip tap", () => {
  // Filtering refetches from page one; applying per tap would fire a request
  // per tap and yank the list out from under the thumb still choosing.
  const { onApply } = renderSheet();
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("activity-filter-apply"));
  expect(onApply).toHaveBeenCalledWith({ categories: ["files", "folders"], actions: [], userIds: [] });
});

it("toggles a chip off again", () => {
  const { onApply } = renderSheet();
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  fireEvent.press(screen.getByTestId("activity-filter-apply"));
  expect(onApply).toHaveBeenCalledWith(NO_FILTERS);
});

it("narrows the offered actions to the chosen categories", () => {
  renderSheet();
  fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
  open("actions");
  expect(screen.getByTestId("activity-filter-action-folder_created")).toBeTruthy();
  expect(screen.queryByTestId("activity-filter-action-file_uploaded")).toBeNull();
});

it("drops an action that the newly-chosen categories no longer offer", () => {
  // Otherwise the feed stays filtered by something the sheet no longer shows -
  // a filter the user cannot see is one they cannot turn off.
  const { onApply } = renderSheet({ categories: [], actions: ["file_uploaded"], userIds: [] });
  fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
  fireEvent.press(screen.getByTestId("activity-filter-apply"));
  expect(onApply).toHaveBeenCalledWith({ categories: ["folders"], actions: [], userIds: [] });
});

it("names a member with no display name by their email", () => {
  renderSheet();
  open("members");
  expect(screen.getByTestId("activity-filter-member-u2")).toHaveTextContent("bob@x.com");
});

it("counts what is selected in each section", () => {
  renderSheet();
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
  expect(screen.getByTestId("activity-filter-categories-count")).toHaveTextContent("2");
});

it("clears everything at once", () => {
  const { onApply } = renderSheet({ categories: ["files"], actions: [], userIds: ["u1"] });
  fireEvent.press(screen.getByTestId("activity-filter-clear"));
  fireEvent.press(screen.getByTestId("activity-filter-apply"));
  expect(onApply).toHaveBeenCalledWith(NO_FILTERS);
});

it("offers Clear all only when there is something to clear", () => {
  renderSheet();
  expect(screen.queryByTestId("activity-filter-clear")).toBeNull();
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  expect(screen.getByTestId("activity-filter-clear")).toBeTruthy();
});

it("keeps Show activity clear of the Android navigation bar", () => {
  renderSheet();
  const style = StyleSheet.flatten(screen.getByTestId("activity-filter-sheet").props.style);
  expect(style.paddingBottom).toBeGreaterThan(NAV_BAR);
});

it("says so rather than showing an empty section when there are no members", () => {
  render(
    <ThemeProvider>
      <ActivityFilterSheet visible filters={NO_FILTERS} members={[]} onApply={jest.fn()} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  open("members");
  expect(screen.getByText("No members to filter by.")).toBeTruthy();
});

it("dismisses on a backdrop tap without applying the draft", () => {
  const { onApply, onClose } = renderSheet();
  fireEvent.press(screen.getByTestId("activity-filter-category-files"));
  fireEvent.press(screen.getByTestId("activity-filter-backdrop"));
  expect(onClose).toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});
