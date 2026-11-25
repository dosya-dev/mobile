import { render, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";

function Box() {
  return (
    <View className="p-4">
      <Text className="text-lg" accessibilityRole="header">styled</Text>
    </View>
  );
}

describe("nativewind", () => {
  it("renders a className component without crashing", () => {
    render(<Box />);
    expect(screen.getByRole("header")).toHaveTextContent("styled");
  });
});
