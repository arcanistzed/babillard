import { AwsClient } from "aws4fetch";
import { loginEmailContent } from "./loginEmailContent";

const SEND_PATH = "/v2/email/outbound-emails";

function sesEndpoint(env: Env): string {
  // Tests point this at a local fake. Production leaves it empty.
  return env.SES_ENDPOINT || `https://email.${env.SES_REGION}.amazonaws.com`;
}

/** Sends through Amazon SES. Throws without the recipient or message contents, so failures are safe to log. */
export async function sendLoginEmail(env: Env, to: string, code: string, link: string): Promise<void> {
  const { SES_ACCESS_KEY_ID: accessKeyId, SES_SECRET_ACCESS_KEY: secretAccessKey, SES_REGION: region } = env;
  if (!accessKeyId || !secretAccessKey || !region) throw new Error("SES is not configured");

  const content = loginEmailContent(code, link);
  // Someone is waiting on the sign-in screen, so don't sit through a long backoff.
  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "ses", retries: 1 });
  const response = await client.fetch(`${sesEndpoint(env)}${SEND_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: env.EMAIL_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: content.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: content.text, Charset: "UTF-8" },
            Html: { Data: content.html, Charset: "UTF-8" },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`SES returned ${response.status} ${response.headers.get("x-amzn-errortype") ?? ""}`.trim());
  }
}
