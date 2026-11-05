export async function sendLoginEmail(env: Env, to: string, code: string, link: string): Promise<void> {
  await env.EMAIL.send({
    to,
    from: { email: env.EMAIL_FROM, name: "Ideas Match" },
    subject: `${code} is your Ideas Match code`,
    text: `Your Ideas Match code is ${code}.\n\nOr open this link on your phone:\n${link}\n\nBoth expire in 15 minutes. If you didn't ask for this, you can ignore it.`,
    html: `<p>Your Ideas Match code is <strong style="font-size:20px">${code}</strong>.</p><p><a href="${link}">Open Ideas Match</a></p><p style="color:#666">Both expire in 15 minutes. If you didn't ask for this, you can ignore it.</p>`,
  });
}
