import { render, screen, fireEvent } from "@testing-library/react-native";
import { LocationPicker, groupLocations } from "./LocationPicker";
import type { RegionInfo } from "./api";

const REGIONS: RegionInfo[] = [
  { code: "ap-southeast-2", city: "Sydney", country: "Australia", continent: "Oceania", flag: "\u{1F1E6}\u{1F1FA}" },
  { code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" },
  { code: "eu-central-1", city: "Frankfurt", country: "Germany", continent: "Europe", flag: "" },
];

// A workspace's location is chosen once, at creation, and the server refuses to
// move it afterwards. This picker is the only place the choice is offered, so
// it has to make 40-odd locations findable on a phone screen.
describe("groupLocations", () => {
  it("groups by continent in the order the server sent them", () => {
    expect(groupLocations(REGIONS, "").map(([c, rows]) => [c, rows.map((r) => r.code)])).toEqual([
      ["Oceania", ["ap-southeast-2"]],
      ["Europe", ["eu-west-1", "eu-central-1"]],
    ]);
  });

  it("matches a city, a country or a code, case-insensitively", () => {
    expect(groupLocations(REGIONS, "FRANK").flatMap(([, rows]) => rows.map((r) => r.code))).toEqual(["eu-central-1"]);
    expect(groupLocations(REGIONS, "ireland").flatMap(([, rows]) => rows.map((r) => r.code))).toEqual(["eu-west-1"]);
    expect(groupLocations(REGIONS, "ap-southeast").flatMap(([, rows]) => rows.map((r) => r.code))).toEqual(["ap-southeast-2"]);
  });

  // A continent whose rows all failed the search is a heading over nothing.
  it("drops a continent whose locations all fail the search", () => {
    expect(groupLocations(REGIONS, "sydney").map(([c]) => c)).toEqual(["Oceania"]);
  });

  it("treats a whitespace-only query as no query at all", () => {
    expect(groupLocations(REGIONS, "   ").flatMap(([, rows]) => rows)).toHaveLength(3);
  });
});

describe("LocationPicker", () => {
  it("offers every location, under its continent heading", () => {
    render(<LocationPicker regions={REGIONS} value="" onChange={jest.fn()} />);
    expect(screen.getByTestId("location-group-Oceania")).toBeTruthy();
    expect(screen.getByTestId("location-group-Europe")).toBeTruthy();
    expect(screen.getByTestId("location-ap-southeast-2")).toHaveTextContent(/Sydney, Australia/);
    expect(screen.getByTestId("location-eu-west-1")).toBeTruthy();
    expect(screen.getByTestId("location-eu-central-1")).toBeTruthy();
  });

  it("filters the list as the user searches", () => {
    render(<LocationPicker regions={REGIONS} value="" onChange={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId("location-search"), "frank");
    expect(screen.getByTestId("location-eu-central-1")).toBeTruthy();
    expect(screen.queryByTestId("location-eu-west-1")).toBeNull();
    expect(screen.queryByTestId("location-group-Oceania")).toBeNull();
  });

  it("says so when a search matches nothing, rather than showing an empty box", () => {
    render(<LocationPicker regions={REGIONS} value="" onChange={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId("location-search"), "atlantis");
    expect(screen.getByTestId("location-no-match")).toBeTruthy();
    expect(screen.queryByTestId("location-empty")).toBeNull();
  });

  // An empty list is not a search result - it means there was nothing to
  // search. Telling someone whose request failed that their query matched
  // nothing sends them hunting for a typo they did not make.
  it("distinguishes an empty list from a search that matched nothing", () => {
    render(<LocationPicker regions={[]} value="" onChange={jest.fn()} />);
    expect(screen.getByTestId("location-empty")).toBeTruthy();
    expect(screen.queryByTestId("location-no-match")).toBeNull();
  });

  it("reports the code of the location tapped", () => {
    const onChange = jest.fn();
    render(<LocationPicker regions={REGIONS} value="eu-west-1" onChange={onChange} />);
    fireEvent.press(screen.getByTestId("location-eu-central-1"));
    expect(onChange).toHaveBeenCalledWith("eu-central-1");
  });

  it("marks exactly the current value as selected, for sighted and assistive users alike", () => {
    render(<LocationPicker regions={REGIONS} value="eu-west-1" onChange={jest.fn()} />);
    expect(screen.getByTestId("location-eu-west-1").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("location-eu-central-1").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("location-ap-southeast-2").props.accessibilityState.selected).toBe(false);
    // The selected row is marked visually too, not only to assistive tech.
    expect(screen.getByTestId("location-eu-west-1")).toHaveTextContent(/Selected/);
  });

  // Parity with web/desktop, whose continent wrappers carry role="group": the
  // heading role is what lets a screen reader jump continent to continent
  // instead of reading 40-odd locations in one run.
  it("marks each continent heading as a header", () => {
    render(<LocationPicker regions={REGIONS} value="" onChange={jest.fn()} />);
    const headings = screen.getAllByRole("header");
    expect(headings.map((h) => h.props.children)).toEqual(["Oceania", "Europe"]);
  });

  it("keeps the selection visible after a search that still contains it", () => {
    render(<LocationPicker regions={REGIONS} value="eu-west-1" onChange={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId("location-search"), "dublin");
    expect(screen.getByTestId("location-eu-west-1").props.accessibilityState.selected).toBe(true);
  });
});
