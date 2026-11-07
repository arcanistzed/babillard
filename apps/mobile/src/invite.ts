import { Share } from "react-native";
import { BASE_URL } from "./api";

export function inviteToApp(): void {
  void Share.share({ message: `Come talk ideas with me on Ideas Match: ${BASE_URL}/invite` });
}

export function inviteToTopic(topic: { id: string; title: string }): void {
  void Share.share({ message: `Let's talk about this on Ideas Match: "${topic.title}" ${BASE_URL}/t/${topic.id}` });
}
