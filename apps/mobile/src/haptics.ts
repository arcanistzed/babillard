import * as Haptics from "expo-haptics";

// Haptics are a nicety. A device without a motor, or one with them switched off, must not raise an error.
const quietly = (attempt: Promise<void>) => void attempt.catch(() => undefined);

export const haptics = {
  /** A choice changed, such as a chip. */
  select: () => quietly(Haptics.selectionAsync()),
  /** The app did what you asked, such as sending a message. */
  tap: () => quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Something that brings people together: a match, a new group, a confirmed meetup. */
  celebrate: () => quietly(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
