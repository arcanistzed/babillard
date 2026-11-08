export interface LoginEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Mail filters can treat workers.dev links as a phishing signal, and Microsoft 365
 * once sent our sign-in email to junk with one in it. EMAIL_LINKS_ON_WORKERS_DEV
 * turns the link back on there, to test whether that still happens. The code
 * alone is always enough to sign in.
 */
export function canLinkInEmail(url: string, allowWorkersDev = false): boolean {
  return allowWorkersDev || !new URL(url).hostname.endsWith(".workers.dev");
}

export function loginEmailContent(code: string, link: string, language: "en" | "fr" = "en", allowWorkersDev = false): LoginEmail {
  const includeLink = canLinkInEmail(link, allowWorkersDev);
  const french = language === "fr";
  const expiry = french ? (includeLink ? "Les deux expirent" : "Il expire") : includeLink ? "Both expire" : "It expires";
  const notice = french ? `${expiry} dans 15 minutes. Si vous n'avez rien demandé, ignorez ce courriel.` : `${expiry} in 15 minutes. If you didn't ask for this, you can ignore it.`;
  const lead = french ? "Votre code Babillard est" : "Your Babillard code is";
  const linkLead = french ? "Ou ouvrez ce lien sur votre téléphone :" : "Or open this link on your phone:";
  const linkLabel = french ? "Ouvrir Babillard" : "Open Babillard";
  return {
    subject: french ? `${code} est votre code Babillard` : `${code} is your Babillard code`,
    text: `${lead} ${code}.\n\n${includeLink ? `${linkLead}\n${link}\n\n` : ""}${notice}`,
    html: `<p>${lead} <strong style="font-size:20px">${code}</strong>.</p>${includeLink ? `<p><a href="${link}">${linkLabel}</a></p>` : ""}<p>${notice}</p>`,
  };
}
