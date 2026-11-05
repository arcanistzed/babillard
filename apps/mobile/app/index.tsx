import { View } from "react-native";
import { useTheme } from "@/theme";

/** The route guard in the root layout replaces this right away. */
export default function Index() {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.paper }} />;
}
