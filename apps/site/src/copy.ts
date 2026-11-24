export type Lang = "en" | "fr";

interface Flyer {
  fields: string;
  title: string;
  blurb?: string;
  bg: string;
  fg: string;
  question?: boolean;
}

const INK = "#15173D";
const WHITE = "#FFFFFF";

/**
 * Real topics from the seed deck (apps/api/seed/topics.json): eight from the starter topics new
 * people see first, and one outdoors topic. Fields read the way the app lists them, and each
 * flyer prints in its first field's ink from the app's theme (apps/mobile/src/theme.ts).
 */
const board = (lang: Lang): Flyer[] =>
  lang === "en"
    ? [
        { fields: "Economics, Sociology and Business", title: "Should tipping be replaced with higher wages?", bg: "#FFC21A", fg: INK, question: true },
        { fields: "Psychology and Sociology", title: "Psychology of loneliness and friendship", bg: "#2ED3A5", fg: INK },
        { fields: "Politics and Psychology", title: "Should Canada ban social media for under-16s?", bg: "#FF6A47", fg: INK, question: true },
        { fields: "Cities & urbanism and Environment & climate", title: "Walkable cities", bg: "#C93410", fg: WHITE },
        { fields: "Games & esports and Sports", title: "Should esports count as sports?", bg: "#4D7CFF", fg: INK, question: true },
        { fields: "Engineering and Physics", title: "Space exploration", bg: "#37507A", fg: WHITE },
        { fields: "Outdoors & fitness and Environment & climate", title: "Hiking near the city", bg: "#556B2F", fg: WHITE },
        { fields: "Food & cooking and Economics", title: "Should Canada cap grocery prices on staples?", bg: "#F4E1C1", fg: INK, question: true },
        { fields: "Economics, Sociology and Business", title: "Should a four-day work week become standard?", bg: "#FFC21A", fg: INK, question: true },
      ]
    : [
        { fields: "Économie, Sociologie et Affaires", title: "Le pourboire devrait-il être remplacé par de meilleurs salaires?", bg: "#FFC21A", fg: INK, question: true },
        { fields: "Psychologie et Sociologie", title: "Psychologie de la solitude et de l'amitié", bg: "#2ED3A5", fg: INK },
        { fields: "Politique et Psychologie", title: "Le Canada devrait-il interdire les réseaux sociaux aux moins de 16 ans?", bg: "#FF6A47", fg: INK, question: true },
        { fields: "Villes et urbanisme et Environnement et climat", title: "Villes marchables", bg: "#C93410", fg: WHITE },
        { fields: "Jeux et sports électroniques et Sports", title: "Les sports électroniques devraient-ils compter comme des sports?", bg: "#4D7CFF", fg: INK, question: true },
        { fields: "Génie et Physique", title: "Exploration spatiale", bg: "#37507A", fg: WHITE },
        { fields: "Plein air et activité physique et Environnement et climat", title: "La randonnée près de la ville", bg: "#556B2F", fg: WHITE },
        { fields: "Cuisine et alimentation et Économie", title: "Le Canada devrait-il plafonner le prix des aliments de base?", bg: "#F4E1C1", fg: INK, question: true },
        { fields: "Économie, Sociologie et Affaires", title: "La semaine de quatre jours devrait-elle devenir la norme?", bg: "#FFC21A", fg: INK, question: true },
      ];

export const copy = {
  en: {
    htmlLang: "en-CA",
    path: "/",
    otherPath: "/fr/",
    otherLang: "fr-CA",
    otherLabel: "Français",
    title: "Babillard: pick a topic, meet people near you",
    description: "Swipe on topics like tipping, the four-day week, loneliness and esports. When three people in your city pick the same one, a group chat opens and you plan a time to meet.",
    skip: "Skip to content",
    download: "Download for Android",
    downloadShort: "Download",
    getApp: "Get the Android app",
    hero: {
      h1: ["Pick a topic.", "Meet the people near you who picked it too."],
      lede: "When three people in your city pick the same topic, a group chat opens and you plan a time to meet.",
    },
    iphone: ["On an iPhone?", "Join the waitlist"],
    shareImage: "/site/share.png",
    shareAlt: "Topic flyers from Babillard pinned to a board, with the line: Pick a topic. Meet the people near you who picked it too.",
    board: board("en"),
    storyLabel: "How it works",
    steps: [
      { h: "Swipe on what you'd talk about", p: "Each card is a topic, like tipping, walkable cities or whether esports count as sports. Some ask a question. Tap where you stand and you're in." },
      { h: "Three people open a group", p: "The tabs along the bottom of a card are seats. When the third person in your city takes one, a group chat opens. If you'd rather have a bigger group, ask for five to eight instead." },
      { h: "Or start with one person", p: "People who picked the same topic show up as cards too. If you both swipe right, a chat opens with a question to get you going." },
      { h: "Then meet up", p: "Pick a time and a place in a couple of taps. Once enough people say yes, it's on. A group can welcome guests, or meet every week." },
    ],
    rulesTitle: "What to expect",
    rules: [
      { h: "Groups form around topics, not opinions", p: "Answering a question is optional, and your answer is never shown as yours. If everyone who answered in a new group gave the same answer, the app swaps in someone waiting who answered differently, when there is one.", ink: "#FFC21A" },
      { h: "Chats are end-to-end encrypted", p: "Only the phones in a chat can read its messages. If you report someone from a chat, your phone sends the moderators up to 11 messages around the report.", ink: "#2ED3A5" },
      { h: "No feed, no followers", p: "A one-on-one match where nobody writes within a week closes on its own, so your chats stay with people you might actually meet.", ink: "#FF5FAE" },
      { h: "18 and over, and you choose the ages", p: "Set the ages you'd like to meet. Others see your age, never your date of birth.", ink: "#39C3E8" },
    ],
    end: {
      h: "Find your first topic",
      install: [
        "Download Babillard. It's about 100 MB.",
        "Open the file. It isn't on the Play Store, so your phone asks you to allow the install.",
        "Sign in with a code sent to your email. There's no password.",
      ],
      scan: "Scan with your Android phone",
      cities: "We're starting in Ottawa and Gatineau. People in other cities can sign up too.",
    },
    footer: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Safety", "/safety"],
      ["Source code", "https://github.com/arcanistzed/babillard"],
      ["Contact", "mailto:info@babillard.app"],
    ],
    phone: {
      chips: ["All", "Society", "Humanities", "Arts"],
      walk: { fields: "Cities & urbanism and Environment & climate", title: "Walkable cities", blurb: "Why some places are pleasant to be in on foot.", nearby: "5 nearby" },
      vote: { fields: "Politics and Mathematics", title: "Should Canada replace first-past-the-post?", stances: ["For", "Against", "Not sure"], nearby: "2 nearby. You'd open the group." },
      skip: "Pass",
      like: "I'm in",
      opened: "A group on electoral reform just opened in Ottawa.",
      groupTitle: "Should Canada replace first-past-the-post?",
      groupSub: "3 people",
      group: [
        ["Maya", "Has your vote ever felt wasted?"],
        ["Jon", "Every federal election in my riding, honestly."],
        ["Maya", "I'd take ranked ballots over proportional representation."],
        ["me", "Same. Coffee this week to argue about it?"],
        ["Jon", "Yes please"],
      ],
      pairName: "Sam",
      pairSub: "Walkable cities",
      pairOpener: "You both picked Walkable cities. Where's the best walk in this city?",
      pair: [
        ["them", "The canal path in October, easily"],
        ["me", "I've never done the whole thing"],
        ["them", "Want to walk it and talk?"],
        ["me", "Saturday morning?"],
      ],
      meetLine: "Maya proposed a meetup at the library.",
      meetWhen: "Lunch today",
      meetWhere: "Library",
      meetPending: "2 yes so far, 3 needed",
      meetOn: "It's on",
      meetChips: ["I'll be there", "Maybe", "Can't make it"],
      composer: "Message",
      encrypted: "Encrypted",
    },
  },
  fr: {
    htmlLang: "fr-CA",
    path: "/fr/",
    otherPath: "/",
    otherLang: "en-CA",
    otherLabel: "English",
    title: "Babillard: choisissez un sujet, rencontrez des gens près de chez vous",
    description: "Glissez sur des sujets comme le pourboire, la semaine de quatre jours, la solitude ou les sports électroniques. Quand trois personnes de votre ville choisissent le même sujet, une discussion de groupe s'ouvre et vous planifiez une rencontre.",
    skip: "Aller au contenu",
    download: "Télécharger pour Android",
    downloadShort: "Télécharger",
    getApp: "Obtenir l'application Android",
    hero: {
      h1: ["Choisissez un sujet.", "Rencontrez les gens près de chez vous qui l'ont choisi aussi."],
      lede: "Quand trois personnes de votre ville choisissent le même sujet, une discussion de groupe s'ouvre et vous planifiez une rencontre.",
    },
    iphone: ["Vous avez un iPhone?", "Inscrivez-vous à la liste d'attente"],
    shareImage: "/site/share-fr.png",
    shareAlt: "Des affiches de sujets de Babillard sur un babillard, avec la phrase: Choisissez un sujet. Rencontrez les gens près de chez vous qui l'ont choisi aussi.",
    board: board("fr"),
    storyLabel: "Comment ça marche",
    steps: [
      { h: "Glissez sur ce dont vous aimeriez parler", p: "Chaque carte est un sujet, comme le pourboire, les villes marchables ou la question de savoir si les sports électroniques sont des sports. Certaines posent une question. Touchez votre position et le sujet est choisi." },
      { h: "Trois personnes ouvrent un groupe", p: "Les languettes au bas d'une carte sont des places. Quand la troisième personne de votre ville en prend une, une discussion de groupe s'ouvre. Si vous préférez un groupe plus grand, demandez plutôt de cinq à huit personnes." },
      { h: "Ou commencez à deux", p: "Les gens qui ont choisi le même sujet apparaissent aussi sous forme de cartes. Si vous glissez à droite sur vos cartes respectives, une discussion s'ouvre avec une question pour lancer la conversation." },
      { h: "Puis rencontrez-vous", p: "Choisissez un moment et un lieu en quelques touches. Dès qu'assez de gens disent oui, c'est confirmé. Un groupe peut accueillir des personnes invitées ou se voir chaque semaine." },
    ],
    rulesTitle: "À quoi vous attendre",
    rules: [
      { h: "Les groupes se forment autour des sujets, pas des opinions", p: "Répondre à une question est facultatif, et votre réponse n'est jamais présentée comme la vôtre. Si tous ceux qui ont répondu dans un nouveau groupe ont donné la même réponse, l'application y fait entrer une personne en attente qui a répondu autrement, s'il y en a une.", ink: "#FFC21A" },
      { h: "Les discussions sont chiffrées de bout en bout", p: "Seuls les téléphones d'une discussion peuvent en lire les messages. Si vous signalez quelqu'un depuis une discussion, votre téléphone transmet à l'équipe de modération jusqu'à 11 messages autour du signalement.", ink: "#2ED3A5" },
      { h: "Pas de fil, pas d'abonnés", p: "Un jumelage où personne n'écrit dans la semaine se ferme de lui-même, alors vos discussions restent avec des gens que vous pourriez vraiment rencontrer.", ink: "#FF5FAE" },
      { h: "18 ans et plus, et vous choisissez les âges", p: "Indiquez l'âge des gens que vous aimeriez rencontrer. Les autres voient votre âge, jamais votre date de naissance.", ink: "#39C3E8" },
    ],
    end: {
      h: "Trouvez votre premier sujet",
      install: [
        "Téléchargez Babillard. Le fichier fait environ 100 Mo.",
        "Ouvrez le fichier. L'application n'est pas sur le Play Store, alors votre téléphone vous demande d'autoriser l'installation.",
        "Connectez-vous avec un code envoyé par courriel. Il n'y a pas de mot de passe.",
      ],
      scan: "Balayez avec votre téléphone Android",
      cities: "Nous commençons à Ottawa et à Gatineau. Les gens d'autres villes peuvent aussi s'inscrire.",
    },
    footer: [
      ["Confidentialité", "/confidentialite"],
      ["Conditions", "/conditions"],
      ["Sécurité", "/securite"],
      ["Code source", "https://github.com/arcanistzed/babillard"],
      ["Contact", "mailto:info@babillard.app"],
    ],
    phone: {
      chips: ["Tous", "Société", "Humanités", "Arts"],
      walk: { fields: "Villes et urbanisme et Environnement et climat", title: "Villes marchables", blurb: "Pourquoi certains lieux sont agréables à pied.", nearby: "5 à proximité" },
      vote: { fields: "Politique et Mathématiques", title: "Le Canada devrait-il remplacer le scrutin uninominal à un tour?", stances: ["Pour", "Contre", "J'hésite"], nearby: "2 à proximité. Vous ouvririez le groupe." },
      skip: "Passer",
      like: "J'embarque",
      opened: "Un groupe sur la réforme électorale vient de s'ouvrir à Ottawa.",
      groupTitle: "Le Canada devrait-il remplacer le scrutin uninominal à un tour?",
      groupSub: "3 personnes",
      group: [
        ["Maya", "Votre vote vous a-t-il déjà semblé inutile?"],
        ["Jon", "À chaque élection fédérale dans ma circonscription, franchement."],
        ["Maya", "Je préférerais le vote préférentiel à la proportionnelle."],
        ["me", "Moi aussi. Un café cette semaine pour en débattre?"],
        ["Jon", "Oui, avec plaisir"],
      ],
      pairName: "Sam",
      pairSub: "Villes marchables",
      pairOpener: "Vous partagez l'envie d'explorer Villes marchables. Quelle est la plus belle marche de cette ville?",
      pair: [
        ["them", "Le long du canal en octobre, sans hésiter"],
        ["me", "Je ne l'ai jamais faite au complet"],
        ["them", "Envie de la faire en discutant?"],
        ["me", "Samedi matin?"],
      ],
      meetLine: "Maya a proposé une rencontre: bibliothèque.",
      meetWhen: "Ce midi",
      meetWhere: "Bibliothèque",
      meetPending: "2 oui jusqu'ici, 3 requis",
      meetOn: "C'est confirmé",
      meetChips: ["J'y serai", "Peut-être", "Je ne peux pas"],
      composer: "Message",
      encrypted: "Chiffré",
    },
  },
} as const;
