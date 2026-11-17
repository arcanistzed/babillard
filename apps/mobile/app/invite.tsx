import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { useTheme } from "@/theme";

/**
 * Where an invite link lands. The route guard sends anyone not set up yet to sign-in or setup,
 * which end on the deck. Everyone else goes back to the deck they already have, or to a new one.
 */
export default function Invite() {
  const theme = useTheme();
  const { me } = useAuth();
  const setUp = Boolean(me?.onboarded && me.termsAccepted);

  useEffect(() => {
    if (setUp) router.dismissTo("/deck");
  }, [setUp]);

  return <View style={{ flex: 1, backgroundColor: theme.paper }} />;
}
