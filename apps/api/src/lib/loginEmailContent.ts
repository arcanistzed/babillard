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
export function loginEmailContent(code: string, link: string, language: "en" | "fr" = "en"): LoginEmail {
  const includeLink = canLinkInEmail(link);
  const french = language === "fr";
  const expiry = french ? (includeLink ? "Les deux expirent" : "Il expire") : includeLink ? "Both expire" : "It expires";
  const notice = french ? `${expiry} dans 15 minutes. Si vous n'avez rien demandé, ignorez ce courriel.` : `${expiry} in 15 minutes. If you didn't ask for this, you can ignore it.`;
  const lead = french ? "Votre code Ideas Match est" : "Your Ideas Match code is";
  const linkLead = french ? "Ou ouvrez ce lien sur votre téléphone :" : "Or open this link on your phone:";
  const linkLabel = french ? "Ouvrir Ideas Match" : "Open Ideas Match";
  return {
    subject: french ? `${code} est votre code Ideas Match` : `${code} is your Ideas Match code`,
    text: `${lead} ${code}.\n\n${includeLink ? `${linkLead}\n${link}\n\n` : ""}${notice}`,
    html: `<p>${lead} <strong style="font-size:20px">${code}</strong>.</p>${includeLink ? `<p><a href="${link}">${linkLabel}</a></p>` : ""}<p>${notice}</p>`,
  };
}
