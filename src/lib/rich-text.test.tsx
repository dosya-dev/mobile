import { Text } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { richText } from "./rich-text";

describe("richText", () => {
  it("renders slots as nested Text and keeps their onPress", () => {
    const onPress = jest.fn();
    render(
      <Text testID="p">
        {richText("Read the {terms} and {privacy}.", {
          terms: (
            <Text testID="terms" onPress={onPress}>
              Terms
            </Text>
          ),
          privacy: <Text testID="privacy">Privacy</Text>,
        })}
      </Text>,
    );
    expect(screen.getByTestId("p")).toHaveTextContent("Read the Terms and Privacy.");
    expect(screen.getByTestId("terms").props.onPress).toBe(onPress);
    fireEvent.press(screen.getByTestId("terms"));
    expect(onPress).toHaveBeenCalledTimes(1);
    // The link is a child of the one paragraph Text, not a sibling block.
    expect(within(screen.getByTestId("p")).getByTestId("terms")).toBeTruthy();
  });

  it("keeps each language's word order", () => {
    render(
      <Text testID="p">{richText("{b} önce, {a} sonra", { a: <Text>A</Text>, b: <Text>B</Text> })}</Text>,
    );
    expect(screen.getByTestId("p")).toHaveTextContent("B önce, A sonra");
  });

  it("leaves a placeholder with no slot as literal text", () => {
    render(<Text testID="p">{richText("Hello {name}, see {link}", { link: <Text>here</Text> })}</Text>);
    expect(screen.getByTestId("p")).toHaveTextContent("Hello {name}, see here");
  });

  it("does not re-parse braces inside slot values or the message's own text", () => {
    render(
      <Text testID="p">
        {richText("Open {file} now", { file: <Text>{"{terms} {file}"}</Text>, terms: <Text>NO</Text> })}
      </Text>,
    );
    expect(screen.getByTestId("p")).toHaveTextContent("Open {terms} {file} now");
  });

  it("returns the message untouched when there are no slots", () => {
    expect(richText("Plain {x}", {})).toBe("Plain {x}");
  });
});
