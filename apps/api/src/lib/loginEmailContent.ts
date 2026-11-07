export interface LoginEmail {
  subject: string;
  text: string;
  html: string;
}

export function canLinkInEmail(url: string): boolean {
  return !new URL(url).hostname.endsWith(".workers.dev");
}

/**
 * Mail filters treat workers.dev links as a phishing signal, and Microsoft 365
 * sent our sign-in email to junk with one in it. The link only goes in once the
 * API is on its own domain. The code alone is enough to sign in.
 */
export function loginEmailContent(code: string, link: string): LoginEmail {
  const includeLink = canLinkInEmail(link);
  const expiry = includeLink ? "Both expire" : "It expires";
  const notice = `${expiry} in 15 minutes. If you didn't ask for this, you can ignore it.`;
  return {
    subject: `${code} is your Ideas Match code`,
    text: `Your Ideas Match code is ${code}.\n\n${includeLink ? `Or open this link on your phone:\n${link}\n\n` : ""}${notice}`,
    html: `<p>Your Ideas Match code is <strong style="font-size:20px">${code}</strong>.</p>${includeLink ? `<p><a href="${link}">Open Ideas Match</a></p>` : ""}<p style="color:#666">${notice}</p>`,
  };
}
