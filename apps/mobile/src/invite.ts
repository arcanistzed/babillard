import { Share } from "react-native";
import { BASE_URL } from "./api";
import { t } from "./i18n";

export function inviteToApp(): void {
  void Share.share({ message: t(`Come talk ideas with me on Ideas Match: ${BASE_URL}/invite`, `Viens parler d'idées avec moi sur Ideas Match : ${BASE_URL}/invite`) });
}

export function inviteToTopic(topic: { id: string; title: string }): void {
  void Share.share({ message: t(`Let's talk about this on Ideas Match: "${topic.title}" ${BASE_URL}/t/${topic.id}`, `Parlons-en sur Ideas Match : « ${topic.title} » ${BASE_URL}/t/${topic.id}`) });
}
