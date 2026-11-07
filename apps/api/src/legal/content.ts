// The published text of the policy, terms, and safety page. The reviewed draft lives in a shared document,
// so copy any change there into this file, and bump LEGAL_VERSION if people need to agree again.

export type LegalPage = "privacy" | "terms" | "safety";
export type Language = "en" | "fr";

export const LEGAL_PATHS: Record<LegalPage, Record<Language, string>> = {
  privacy: { en: "/privacy", fr: "/confidentialite" },
  terms: { en: "/terms", fr: "/conditions" },
  safety: { en: "/safety", fr: "/securite" },
};

const privacyEn = `# Privacy policy

Last updated: November 7, 2026

Ideas Match helps people find others nearby who want to talk about the same topics, then meet in person. In this policy, "we" means the operator of Ideas Match, named in our Terms of use. We're based in Canada. Our privacy officer is responsible for how we handle your information. Questions and requests go to privacy@danielthorp.com.

## What we collect

**What you give us.** Your email address, first name, date of birth, role, fields of interest, what you're looking for, city, and campus. A photo and a line about yourself are optional.

**What you do in the app.** The topics and people you swipe on, your stance on question topics if you pick one, your messages (encrypted, so we can't read them), the meetups you propose and answer, whether you say a meetup happened, the topics you suggest, and the people you report or block.

**Device details.** A push notification token if you allow notifications, and your phone's public encryption key. Your IP address reaches our host with every request, and we use it to slow down abuse of sign-in. Our host keeps request logs, including IP addresses, for up to a week.

**Crash reports.** If the app crashes it sends the error message, the technical trace, your platform, and the app version. These reports carry no account ID or name, and we delete them after 30 days. An error message could in rare cases contain text from the screen you were on.

## Your consent

You agree to this policy by ticking the box when you sign up. Some of what you tell us is sensitive: your date of birth, your stance on questions, and whether you're open to dating. We require your date of birth because the app is only for adults. You can withdraw your consent at any time by deleting your account, but you can't use the app without one.

## Your location

If you tap the location icon, the app asks your phone for your rough location once and picks the nearest city on the phone. Your coordinates never reach our servers. Only the city you end up with does, and you can search for a city by hand instead.

## What other people see

People in your city who share a topic with you can see your first name, photo, line about yourself, role, campus, fields, what you're looking for, and the topics you share. If your school email verified you, they see that too, but not the address.

Your date of birth and email address are never shown to other people. Your stance on a question is never shown as yours. A group only sees the total number of people with each stance. People in your city can see percentages for a question once at least 10 people have answered and they don't all agree.

People in a chat with you can see your messages and profile. Anyone with a meetup's share link can see its topic, time, and place, but not who's going. If you report someone, we don't tell them it was you.

## How we use it

We use your information to sign you in, show you topics and people, form matches and groups, deliver messages, remind you about meetups, keep people safe, and fix problems. Your date of birth is there to confirm you're 18 or older. We don't sell your information and we don't show ads.

## How we choose what you see

The app ranks topics and people automatically, using your fields, the topics you pick, what you're looking for, your campus, and how many people nearby picked a topic. A person, not the app, makes moderation decisions.

## Your messages

Messages are end-to-end encrypted. Only the phones of the people in a chat can read them, and we can't, so we couldn't hand them over even if asked. If you report someone from a chat, your phone shares the reported message and the ones around it with us so a moderator can review them, and we keep that text with the report. We can see who you chat with and when. Meetup times and places, and notes the app itself adds to a chat, aren't encrypted, because we use them to send reminders and share links. If you sign in on a new phone or reinstall the app, it can't read older messages unless you restore a backup. A backup is a file you choose to save, protected by a passphrase we never see. Each chat's About screen has a security code you can compare in person, to check that nobody else was added.

## Emails and notifications

We email you only to sign you in, and about safety or your account. Push notifications tell you about matches, messages, new groups, and meetups. You can mute a chat in the app, or turn notifications off in your phone's settings. We don't send marketing. If that ever changes, we'll ask you first, and you'll be able to unsubscribe from every message.

## Who we share it with

We use these companies to run the service, and only for that purpose:

- Cloudflare hosts the app, the database, encrypted messages, and photos.
- Amazon Web Services sends sign-in and moderation emails, so it handles your email address.
- Expo, Google, and Apple deliver push notifications, so they handle your device token and the notification text, which says who wrote to you but not what they said.

These companies may process information outside Canada, including in the United States, where other laws apply. We also disclose information if the law requires it, or if we believe it's needed to protect someone from serious harm. If Ideas Match moves to a company or a new owner, your information moves with it under this policy, and we'll tell you.

## How long we keep it

- Sign-in codes: up to one day.
- Signed-in sessions: 90 days from sign-in, or until you sign out.
- Crash reports: 30 days.
- Reports, including any messages shared with them, and moderation history: two years after the case closes.
- A banned person's email address: for as long as the ban lasts, so they can't sign up again.
- Everything else: until you delete your account, or after two years without using the app. We email you 30 days before deleting an inactive account.

## Deleting your account

Go to You, then Delete account. That removes your email address, date of birth, profile, photo, swipes, messages, meetup answers, blocks, and notification tokens. An empty record with no personal details stays behind so that other people's conversations keep working. Our host's backups can hold deleted data for up to 30 days, and we can't reach screenshots or anything else people saved.

Reports made about you stay for the period above, so that deleting an account can't erase a safety record.

## Your rights

You can ask for a copy of your information, ask us to correct or delete it, and ask how the app's ranking affected what you saw. You can withdraw consent at any time by deleting your account. You can change most of it yourself under Edit profile. Write to privacy@danielthorp.com for anything else, and we'll answer within 30 days.

## Age

Ideas Match is for people 18 and over. If we learn that someone is younger, we'll close the account.

## Security

We encrypt traffic between the app and our servers and store only a hash of sign-in codes and session tokens. No system is perfectly secure. If a breach creates a real risk of harm to you, we'll tell you and the authorities.

## Changes

If we change this policy in a way that matters, we'll tell you in the app or by email before it takes effect.`;

const termsEn = `# Terms of use

Last updated: November 7, 2026

These terms are an agreement between you and Daniel Thorp, who runs Ideas Match. By ticking the box when you sign up, you accept them and our Privacy policy. If you don't agree, don't use the app.

## Who can use it

You must be 18 or older, and you can only have one account. Give your real date of birth and a name people can know you by. You can't use the app if we've banned you.

## How to behave

You can disagree with anyone about anything. That's the point. We have zero tolerance for abuse and objectionable content. You can't:

- Harass, threaten, or demean people, including for who they are.
- Pressure anyone to meet, or into anything when you do.
- Pretend to be someone else.
- Send spam, advertise, or recruit for a business.
- Post sexual content, or anything illegal.
- Share intimate images of anyone without their consent.
- Post or share anything that sexualizes or endangers a minor.
- Share someone's private information without their permission.
- Scrape the app, or interfere with how it runs.

## Meeting in person

The app exists to get people into the same room, so read this part. We don't run background checks, and we don't verify who people are beyond their email address. A verified school email only shows that someone can read mail at that school. You decide who to meet and you're responsible for your own safety. Meet in a public place the first time, tell a friend where you're going, and leave if something feels wrong. If you're in danger, call emergency services first, then report it to us.

## Your content

What you post stays yours. You give us a non-exclusive, worldwide, royalty-free licence to store it and show it to the people the app shows it to, for as long as it's on the service. A topic you suggest may stay in the app after you leave, without your name on it, and a moderator may edit it before approving it. Don't post anything you don't have the right to share.

## Moderation

You can report anyone from their profile or by long-pressing a message. We aim to act on reports within 24 hours, and first on anything involving a minor or intimate images shared without consent. Our Safety page explains how. Moderators may warn you, remove content, or ban you, and they can do this without notice when safety is at stake. If you think we got it wrong, write to privacy@danielthorp.com and a person will look at it again. You can leave at any time by deleting your account.

## The service

Ideas Match is free right now. It's a young product, so features may change, and it may have outages or stop running. We'll give notice before shutting it down if we can.

## Limits on our responsibility

**If you live in Quebec, the limits in this section apply only as far as Quebec's Consumer Protection Act and Civil Code allow.** In particular, they don't limit liability for physical or moral injury, or for intentional or gross fault.

We provide the app "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We don't promise that it will work without errors or that any match will go well. We aren't responsible for what users say or do, on the app or in person. To the extent the law allows, we aren't liable for indirect, incidental, special, consequential, or punitive damages, or for injury or loss caused by other users, and our total liability to you is limited to CAD $100.

## Governing law

**If you live in Quebec, the choice of Ontario law and courts below doesn't take away your right to Quebec's consumer protections or to bring a claim in Quebec.**

These terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there. You and we submit to the exclusive jurisdiction of the courts of Ontario, unless mandatory consumer law where you live gives you other rights.

## Changes

If we change these terms in a way that matters, we'll tell you at least 30 days before they take effect, unless a safety or legal reason means it can't wait. If you don't accept a change, you can delete your account. Continuing to use the app after that means you accept them.

## Apple and Google

These terms are between you and us, not Apple or Google. They aren't responsible for the app, its content, or its support. If you got the app from the App Store, Apple may enforce these terms against you.

## Other terms

These terms and the Privacy policy are the whole agreement between you and us. If part of them can't be enforced, the rest still applies. If we don't enforce something, we haven't given up the right to. We may transfer these terms to a company that takes over Ideas Match. You can't transfer your account. The app, its name, and its design belong to us. Questions go to privacy@danielthorp.com.

## Credits

City data comes from GeoNames (geonames.org), licensed under Creative Commons Attribution 4.0.`;

const safetyEn = `# Safety standards

Last updated: November 7, 2026

Ideas Match is for adults who want to meet in person to talk about ideas. This page explains how we keep people safe, especially children, who aren't allowed on the app.

## Children

You must be 18 to use Ideas Match, and we ask for a date of birth at sign-up. We have zero tolerance for child sexual abuse and exploitation. Anything that sexualizes or endangers a minor gets the account banned. We report child sexual abuse material to Cybertip.ca and to police, as Canadian law requires. If we learn that someone is under 18, we close the account.

## Harmful content

We don't allow harassment, threats, hate, sexual content, intimate images shared without consent, or encouragement of self-harm or violence. People can only post a profile, suggest topics, and send messages. Moderators review suggested topics before anyone else sees them.

## Reporting and blocking

Anyone can report a person from their profile or by long-pressing a message, and can block anyone. We don't tell the person who reported them. We aim to act on reports within 24 hours, and first on anything involving a minor, intimate images, or someone's safety. A person reviews every report. If we act against you and you think we got it wrong, write to us and a person will look at it again.

## Private messages

Messages are end-to-end encrypted, so we can't read or scan them. When someone reports a chat, their phone shares the reported message and the ones around it with us, and that's what moderators review.

## Meeting safely

We don't run background checks. Meet in a public place the first time, tell a friend where you're going, and leave if something feels wrong. If you're in danger, call emergency services first.

## Contact

Safety concerns, including anything involving a child: safety@danielthorp.com. Help for someone in crisis in Canada is at 9-8-8, by call or text. To report a child being exploited, go to Cybertip.ca.`;

const privacyFr = `# Politique de confidentialité

Dernière mise à jour: 7 novembre 2026

Ideas Match aide les gens à trouver des personnes près de chez eux qui veulent parler des mêmes sujets, puis à se rencontrer en personne. Dans cette politique, « nous » désigne l'exploitant d'Ideas Match, nommé dans nos Conditions d'utilisation. Nous sommes établis au Canada. Notre responsable de la protection des renseignements personnels répond de la façon dont nous traitons vos renseignements. Adressez vos questions et demandes à privacy@danielthorp.com.

## Ce que nous recueillons

**Ce que vous nous donnez.** Votre adresse courriel, votre prénom, votre date de naissance, votre rôle, vos domaines d'intérêt, ce que vous recherchez, votre ville et votre campus. Une photo et une phrase à votre sujet sont facultatives.

**Ce que vous faites dans l'application.** Les sujets et les personnes que vous faites glisser, votre position sur les sujets de type question si vous en choisissez une, vos messages (chiffrés, donc illisibles pour nous), les rencontres que vous proposez et vos réponses, le fait qu'une rencontre a eu lieu si vous l'indiquez, les sujets que vous suggérez, ainsi que les personnes que vous signalez ou bloquez.

**Renseignements sur l'appareil.** Un jeton de notification si vous autorisez les notifications, et la clé publique de chiffrement de votre téléphone. Votre adresse IP parvient à notre hébergeur à chaque requête, et nous l'utilisons pour limiter les abus à la connexion. Notre hébergeur conserve les journaux de requêtes, y compris les adresses IP, jusqu'à une semaine.

**Rapports de plantage.** Si l'application plante, elle envoie le message d'erreur, la trace technique, votre plateforme et la version de l'application. Ces rapports ne contiennent ni identifiant de compte ni nom, et nous les supprimons après 30 jours. Dans de rares cas, un message d'erreur pourrait contenir du texte de l'écran affiché.

## Votre consentement

Vous acceptez cette politique en cochant la case à l'inscription. Certains renseignements que vous nous donnez sont sensibles: votre date de naissance, votre position sur les questions, et le fait que vous êtes ouvert ou ouverte aux rencontres amoureuses. Nous exigeons votre date de naissance parce que l'application est réservée aux adultes. Vous pouvez retirer votre consentement à tout moment en supprimant votre compte, mais vous ne pouvez pas utiliser l'application sans compte.

## Votre emplacement

Si vous touchez l'icône d'emplacement, l'application demande une seule fois votre emplacement approximatif au téléphone et choisit la ville la plus proche sur celui-ci. Vos coordonnées n'atteignent jamais nos serveurs, seule la ville retenue nous parvient. Vous pouvez aussi chercher une ville vous-même.

## Ce que les autres voient

Les personnes de votre ville qui partagent un sujet avec vous peuvent voir votre prénom, votre photo, votre phrase de présentation, votre rôle, votre campus, vos domaines, ce que vous recherchez et les sujets en commun. Si votre courriel scolaire vous a vérifié, elles le voient aussi, mais pas l'adresse.

Votre date de naissance et votre adresse courriel ne sont jamais montrées aux autres. Votre position sur une question n'est jamais présentée comme la vôtre. Un groupe voit seulement le nombre total de personnes par position. Les gens de votre ville peuvent voir des pourcentages pour une question lorsqu'au moins 10 personnes ont répondu et qu'elles ne sont pas toutes du même avis.

Les personnes d'une conversation peuvent voir vos messages et votre profil. Toute personne qui a le lien de partage d'une rencontre peut en voir le sujet, l'heure et le lieu, mais pas qui y va. Si vous signalez quelqu'un, nous ne lui disons pas que c'est vous.

## Comment nous les utilisons

Nous utilisons vos renseignements pour vous connecter, vous montrer des sujets et des personnes, former des jumelages et des groupes, livrer les messages, vous rappeler les rencontres, assurer la sécurité et corriger les problèmes. Votre date de naissance sert à confirmer que vous avez 18 ans ou plus. Nous ne vendons pas vos renseignements et nous n'affichons pas de publicité.

## Comment nous choisissons ce que vous voyez

L'application classe automatiquement les sujets et les personnes selon vos domaines, les sujets que vous choisissez, ce que vous recherchez, votre campus et le nombre de personnes à proximité qui ont choisi un sujet. Les décisions de modération sont prises par une personne, pas par l'application.

## Vos messages

Les messages sont chiffrés de bout en bout. Seuls les téléphones des personnes d'une conversation peuvent les lire. Nous ne le pouvons pas, et nous ne pourrions donc pas les remettre même si on nous le demandait. Si vous signalez quelqu'un depuis une conversation, votre téléphone nous transmet le message signalé et ceux qui l'entourent pour qu'un modérateur les examine, et nous conservons ce texte avec le signalement. Nous pouvons voir avec qui vous discutez et quand. Les heures et lieux des rencontres, ainsi que les notes ajoutées par l'application, ne sont pas chiffrés, parce que nous les utilisons pour les rappels et les liens de partage. Si vous vous connectez sur un nouveau téléphone ou réinstallez l'application, elle ne pourra pas lire les anciens messages, sauf si vous restaurez une sauvegarde. Une sauvegarde est un fichier que vous choisissez d'enregistrer, protégé par une phrase secrète que nous ne voyons jamais. L'écran À propos de chaque conversation affiche un code de sécurité à comparer en personne, pour vérifier que personne d'autre n'a été ajouté.

## Courriels et notifications

Nous vous écrivons seulement pour vous connecter, et au sujet de la sécurité ou de votre compte. Les notifications vous informent des jumelages, des messages, des nouveaux groupes et des rencontres. Vous pouvez mettre une conversation en sourdine dans l'application, ou désactiver les notifications dans les réglages du téléphone. Nous n'envoyons pas de marketing. Si cela change, nous vous le demanderons d'abord, et vous pourrez vous désabonner de chaque message.

## Avec qui nous les partageons

Nous faisons appel à ces entreprises pour faire fonctionner le service, et seulement à cette fin:

- Cloudflare héberge l'application, la base de données, les messages chiffrés et les photos.
- Amazon Web Services envoie les courriels de connexion et de modération, et traite donc votre adresse courriel.
- Expo, Google et Apple livrent les notifications, et traitent donc le jeton de votre appareil et le texte de la notification, qui indique qui vous a écrit mais pas ce qui a été écrit.

Ces entreprises peuvent traiter des renseignements à l'extérieur du Canada, y compris aux États-Unis, où d'autres lois s'appliquent. Nous communiquons aussi des renseignements si la loi l'exige, ou si nous croyons que c'est nécessaire pour protéger quelqu'un d'un préjudice grave. Si Ideas Match passe à une société ou à un nouveau propriétaire, vos renseignements suivent sous cette politique, et nous vous en informerons.

## Combien de temps nous les conservons

- Codes de connexion: jusqu'à un jour.
- Sessions: 90 jours après la connexion, ou jusqu'à la déconnexion.
- Rapports de plantage: 30 jours.
- Signalements, y compris les messages transmis, et historique de modération: deux ans après la fermeture du dossier.
- Adresse courriel d'une personne bannie: tant que dure le bannissement, pour l'empêcher de se réinscrire.
- Tout le reste: jusqu'à la suppression de votre compte, ou après deux ans sans utiliser l'application. Nous vous écrivons 30 jours avant de supprimer un compte inactif.

## Supprimer votre compte

Allez à Vous, puis Supprimer le compte. Cela retire votre adresse courriel, votre date de naissance, votre profil, votre photo, vos glissements, vos messages, vos réponses aux rencontres, vos blocages et vos jetons de notification. Un dossier vide, sans renseignement personnel, subsiste pour que les conversations des autres continuent de fonctionner. Les sauvegardes de notre hébergeur peuvent contenir des données supprimées jusqu'à 30 jours, et nous n'avons pas accès aux captures d'écran ni à ce que d'autres ont enregistré.

Les signalements vous concernant sont conservés pendant la période indiquée ci-dessus, afin que la suppression d'un compte n'efface pas un dossier de sécurité.

## Vos droits

Vous pouvez demander une copie de vos renseignements, demander de les corriger ou de les supprimer, et demander comment le classement de l'application a influencé ce que vous avez vu. Vous pouvez retirer votre consentement à tout moment en supprimant votre compte. Vous pouvez modifier la plupart de ces renseignements vous-même dans Modifier le profil. Pour le reste, écrivez à privacy@danielthorp.com. Nous répondrons dans un délai de 30 jours.

## Âge

Ideas Match est réservé aux personnes de 18 ans et plus. Si nous apprenons qu'une personne est plus jeune, nous fermerons le compte.

## Sécurité

Nous chiffrons les échanges entre l'application et nos serveurs, et nous ne conservons qu'une empreinte des codes de connexion et des jetons de session. Aucun système n'est parfaitement sûr. Si une atteinte crée un risque réel de préjudice pour vous, nous vous en informerons, ainsi que les autorités.

## Changements

Si nous modifions cette politique de façon importante, nous vous en informerons dans l'application ou par courriel avant son entrée en vigueur.`;

const termsFr = `# Conditions d'utilisation

Dernière mise à jour: 7 novembre 2026

Ces conditions constituent une entente entre vous et Daniel Thorp, qui exploite Ideas Match. En cochant la case à l'inscription, vous les acceptez, ainsi que notre Politique de confidentialité. Si vous n'êtes pas d'accord, n'utilisez pas l'application.

## Qui peut l'utiliser

Vous devez avoir 18 ans ou plus, et vous ne pouvez avoir qu'un seul compte. Donnez votre vraie date de naissance et un nom par lequel on peut vous connaître. Vous ne pouvez pas utiliser l'application si nous vous avons banni.

## Comment se comporter

Vous pouvez être en désaccord avec n'importe qui sur n'importe quoi. C'est le but. Nous ne tolérons ni les abus ni les contenus répréhensibles. Il est interdit de:

- Harceler, menacer ou rabaisser des gens, notamment pour ce qu'ils sont.
- Faire pression sur quelqu'un pour une rencontre, ou pour quoi que ce soit lors d'une rencontre.
- Se faire passer pour quelqu'un d'autre.
- Envoyer du pourriel, faire de la publicité ou recruter pour une entreprise.
- Publier du contenu sexuel ou tout contenu illégal.
- Partager des images intimes d'une personne sans son consentement.
- Publier ou partager quoi que ce soit qui sexualise ou met en danger une personne mineure.
- Partager les renseignements privés d'une personne sans sa permission.
- Extraire des données de l'application ou nuire à son fonctionnement.

## Se rencontrer en personne

L'application existe pour réunir des gens dans une même pièce, alors lisez bien ceci. Nous ne faisons pas de vérification des antécédents et nous ne vérifions l'identité des gens que par leur adresse courriel. Un courriel scolaire vérifié montre seulement qu'une personne peut lire le courrier de cet établissement. Vous décidez qui rencontrer et vous êtes responsable de votre sécurité. Rencontrez-vous dans un lieu public la première fois, dites à quelqu'un où vous allez, et partez si quelque chose ne va pas. Si vous êtes en danger, appelez d'abord les services d'urgence, puis signalez-le-nous.

## Votre contenu

Ce que vous publiez vous appartient. Vous nous accordez une licence non exclusive, mondiale et gratuite pour le stocker et le montrer aux personnes à qui l'application le montre, tant qu'il se trouve sur le service. Un sujet que vous suggérez peut rester dans l'application après votre départ, sans votre nom, et un modérateur peut le modifier avant de l'approuver. Ne publiez rien que vous n'avez pas le droit de partager.

## Modération

Vous pouvez signaler quelqu'un depuis son profil ou en appuyant longuement sur un message. Nous visons à donner suite aux signalements dans les 24 heures, en priorité pour ce qui concerne une personne mineure ou des images intimes partagées sans consentement. Notre page Sécurité explique comment. Les modérateurs peuvent vous avertir, retirer du contenu ou vous bannir, et ils peuvent le faire sans préavis lorsque la sécurité est en jeu. Si vous pensez que nous avons fait erreur, écrivez à privacy@danielthorp.com et une personne réexaminera la décision. Vous pouvez partir à tout moment en supprimant votre compte.

## Le service

Ideas Match est gratuit pour l'instant. C'est un jeune produit: ses fonctions peuvent changer, il peut connaître des pannes ou cesser de fonctionner. Si possible, nous donnerons un préavis avant de le fermer.

## Limites de notre responsabilité

**Si vous habitez au Québec, les limites de cette section s'appliquent uniquement dans la mesure permise par la Loi sur la protection du consommateur et le Code civil du Québec.** En particulier, elles ne limitent pas la responsabilité pour un préjudice corporel ou moral, ni pour une faute intentionnelle ou lourde.

Nous fournissons l'application « telle quelle » et « selon sa disponibilité », sans garantie d'aucune sorte, expresse ou implicite, y compris de qualité marchande, d'adaptation à un usage particulier et d'absence de contrefaçon. Nous ne promettons pas qu'elle fonctionnera sans erreur ni qu'un jumelage se passera bien. Nous ne sommes pas responsables de ce que les utilisateurs disent ou font, dans l'application ou en personne. Dans la mesure permise par la loi, nous ne sommes pas responsables des dommages indirects, accessoires, spéciaux, consécutifs ou punitifs, ni des blessures ou pertes causées par d'autres utilisateurs, et notre responsabilité totale envers vous est limitée à 100 $ CA.

## Droit applicable

**Si vous habitez au Québec, le choix du droit et des tribunaux de l'Ontario ci-dessous ne vous prive pas de vos protections de consommateur au Québec ni du droit d'y intenter un recours.**

Ces conditions sont régies par les lois de la province de l'Ontario et les lois fédérales du Canada qui s'y appliquent. Vous et nous nous soumettons à la compétence exclusive des tribunaux de l'Ontario, à moins que le droit impératif de la consommation de votre lieu de résidence ne vous accorde d'autres droits.

## Changements

Si nous modifions ces conditions de façon importante, nous vous en informerons au moins 30 jours avant leur entrée en vigueur, sauf si une raison de sécurité ou une raison juridique ne permet pas d'attendre. Si vous n'acceptez pas un changement, vous pouvez supprimer votre compte. Continuer d'utiliser l'application ensuite signifie que vous l'acceptez.

## Apple et Google

Ces conditions vous lient à nous, et non à Apple ou à Google. Ces entreprises ne sont pas responsables de l'application, de son contenu ni de son soutien. Si vous avez obtenu l'application dans l'App Store, Apple peut faire respecter ces conditions à votre égard.

## Autres conditions

Ces conditions et la Politique de confidentialité constituent l'entente complète entre vous et nous. Si une partie ne peut être appliquée, le reste demeure en vigueur. Si nous ne faisons pas respecter une disposition, nous ne renonçons pas à ce droit. Nous pouvons céder ces conditions à une société qui reprend Ideas Match. Vous ne pouvez pas céder votre compte. L'application, son nom et sa conception nous appartiennent. Adressez vos questions à privacy@danielthorp.com.

## Mentions

Les données sur les villes proviennent de GeoNames (geonames.org), sous licence Creative Commons Attribution 4.0.`;

const safetyFr = `# Normes de sécurité

Dernière mise à jour: 7 novembre 2026

Ideas Match s'adresse aux adultes qui veulent se rencontrer en personne pour parler d'idées. Cette page explique comment nous assurons la sécurité des gens, en particulier des enfants, qui ne sont pas admis sur l'application.

## Enfants

Il faut avoir 18 ans pour utiliser Ideas Match, et nous demandons une date de naissance à l'inscription. Nous ne tolérons aucune exploitation ni aucun abus sexuels d'enfants. Tout contenu qui sexualise ou met en danger une personne mineure entraîne le bannissement du compte. Nous signalons le matériel d'abus pédosexuels à Cyberaide.ca et à la police, comme l'exige la loi canadienne. Si nous apprenons qu'une personne a moins de 18 ans, nous fermons le compte.

## Contenu préjudiciable

Nous n'acceptons pas le harcèlement, les menaces, la haine, le contenu sexuel, les images intimes partagées sans consentement, ni l'incitation à l'automutilation ou à la violence. Les gens peuvent seulement publier un profil, suggérer des sujets et envoyer des messages. Les modérateurs examinent les sujets suggérés avant que d'autres les voient.

## Signaler et bloquer

Chacun peut signaler une personne depuis son profil ou en appuyant longuement sur un message, et peut bloquer qui il veut. Nous ne disons pas à la personne qui l'a signalée. Nous visons à donner suite aux signalements dans les 24 heures, en priorité pour ce qui concerne une personne mineure, des images intimes ou la sécurité de quelqu'un. Une personne examine chaque signalement. Si nous prenons une mesure contre vous et que vous pensez que nous avons fait erreur, écrivez-nous et une personne réexaminera la décision.

## Messages privés

Les messages sont chiffrés de bout en bout: nous ne pouvons ni les lire ni les analyser. Lorsqu'une personne signale une conversation, son téléphone nous transmet le message signalé et ceux qui l'entourent, et c'est ce que les modérateurs examinent.

## Se rencontrer en sécurité

Nous ne faisons pas de vérification des antécédents. Rencontrez-vous dans un lieu public la première fois, dites à quelqu'un où vous allez, et partez si quelque chose ne va pas. Si vous êtes en danger, appelez d'abord les services d'urgence.

## Nous joindre

Préoccupations de sécurité, y compris tout ce qui concerne un enfant: safety@danielthorp.com. Au Canada, de l'aide en cas de crise est offerte au 9-8-8, par appel ou texto. Pour signaler l'exploitation d'un enfant, rendez-vous sur Cyberaide.ca.`;

export const LEGAL_TEXT: Record<LegalPage, Record<Language, string>> = {
  privacy: { en: privacyEn, fr: privacyFr },
  terms: { en: termsEn, fr: termsFr },
  safety: { en: safetyEn, fr: safetyFr },
};
