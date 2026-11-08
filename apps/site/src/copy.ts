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

/** Real topics from the seed deck, in each field's ink from the app's theme. */
const board = (lang: Lang): Flyer[] =>
  lang === "en"
    ? [
        { fields: "Economics and Politics", title: "Monetary policy and central banks", bg: "#FFC21A", fg: INK },
        { fields: "Philosophy", title: "Ethics and moral philosophy", bg: "#6B3FC9", fg: WHITE },
        { fields: "Education and Psychology", title: "Should phones be banned in schools?", bg: "#FFD95C", fg: INK, question: true },
        { fields: "History and Sociology", title: "Oral history and memory", bg: "#00727A", fg: WHITE },
        { fields: "Biology and Medicine", title: "Microbiome research", bg: "#39C3E8", fg: INK },
        { fields: "Literature and Linguistics", title: "Translation and world literature", bg: "#A3154F", fg: WHITE },
        { fields: "Mathematics and Philosophy", title: "Foundations of mathematics", bg: "#B9A6FF", fg: INK },
        { fields: "Physics and Philosophy", title: "Quantum mechanics and interpretation", bg: "#1B1E7A", fg: WHITE },
        { fields: "Environment & climate", title: "Climate adaptation", bg: "#74C43C", fg: INK },
      ]
    : [
        { fields: "Économie et Politique", title: "Politique monétaire et banques centrales", bg: "#FFC21A", fg: INK },
        { fields: "Philosophie", title: "Éthique et philosophie morale", bg: "#6B3FC9", fg: WHITE },
        { fields: "Éducation et Psychologie", title: "Faut-il interdire les téléphones à l'école?", bg: "#FFD95C", fg: INK, question: true },
        { fields: "Histoire et Sociologie", title: "Histoire orale et mémoire", bg: "#00727A", fg: WHITE },
        { fields: "Biologie et Médecine", title: "Recherche sur le microbiome", bg: "#39C3E8", fg: INK },
        { fields: "Littérature et Linguistique", title: "Traduction et littérature mondiale", bg: "#A3154F", fg: WHITE },
        { fields: "Mathématiques et Philosophie", title: "Fondements des mathématiques", bg: "#B9A6FF", fg: INK },
        { fields: "Physique et Philosophie", title: "Mécanique quantique et interprétation", bg: "#1B1E7A", fg: WHITE },
        { fields: "Environnement et climat", title: "Adaptation au climat", bg: "#74C43C", fg: INK },
      ];

export const copy = {
  en: {
    htmlLang: "en-CA",
    path: "/",
    otherPath: "/fr/",
    otherLang: "fr-CA",
    otherLabel: "Français",
    title: "Ideas Match",
    description: "Swipe on research areas, books, and policy questions. When four people in your city pick the same one, a group chat opens and you plan a time to meet.",
    skip: "Skip to content",
    download: "Download for Android",
    hero: {
      h1: ["Pick a topic.", "Meet the people near you who picked it too."],
      lead: "Ideas Match is a deck of research areas, books, and policy questions. Swipe right on the ones you'd happily talk about for an hour. When four people in your city pick the same one, a group chat opens, and the app helps you find a time to meet.",
      note: "Free, and Android only for now.",
    },
    board: board("en"),
    storyLabel: "How it works",
    steps: [
      { h: "Swipe on what you'd talk about", p: "Each card is a topic, like walkable cities or the foundations of mathematics. Some cards ask a question, and you can say where you stand before you swipe." },
      { h: "Four people open a group", p: "The tabs along the bottom of a card are seats. When the fourth person in your city tears one off, a group chat opens with all four of you in it. A group holds up to eight." },
      { h: "Or start with one person", p: "People who picked the same topic show up as cards too. If you both swipe right, a chat opens with a question about the topic to get you going." },
      { h: "Then meet up", p: "Pick a time and a place in a couple of taps. Once enough people say yes, it's on. Afterward the app asks whether you actually met, and that's the number we measure ourselves by." },
    ],
    rulesTitle: "A few things we decided",
    rules: [
      { h: "Opinions never decide who you meet", p: "Groups form around topics. Answering a question only adds to your city's overall split, which you see once you've answered.", ink: "#FFC21A" },
      { h: "Only the people in a chat can read it", p: "Messages are end-to-end encrypted on your phone. If you report someone, you choose which messages the moderators see.", ink: "#2ED3A5" },
      { h: "No feed, no followers", p: "A match that goes quiet for a week closes on its own, so your chats stay with people you might actually meet.", ink: "#FF5FAE" },
      { h: "English and French", p: "The app follows your phone's language, and so do the topics.", ink: "#39C3E8" },
    ],
    end: {
      h: "Find your first topic",
      p: "The app comes straight from this site rather than the Play Store, so your phone will ask you to allow the install.",
    },
    footer: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Safety", "/safety"],
    ],
    phone: {
      chips: ["All", "Society", "Humanities", "Science"],
      walk: { fields: "Cities & urbanism and Environment & climate", title: "Walkable cities", blurb: "Why some places are pleasant to be in on foot.", nearby: "5 nearby" },
      vote: { fields: "Politics and Mathematics", title: "Should we adopt ranked-choice voting?", stances: ["For", "Against", "Not sure"], nearby: "3 nearby. You'd open the group." },
      opened: "A group on ranked-choice voting just opened in Ottawa.",
      groupTitle: "Should we adopt ranked-choice voting?",
      groupSub: "4 people",
      group: [
        ["Maya", "Have you ever voted this way?"],
        ["Jon", "Once, for a student union. It changed who bothered to run."],
        ["Priya", "I want to know if it actually reduces polarization."],
        ["me", "Same. Coffee this week to argue about it?"],
        ["Maya", "Yes please"],
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
      meetLine: "Priya proposed a meetup at the library.",
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
    title: "Ideas Match",
    description: "Glissez sur des domaines de recherche, des livres et des questions de politique publique. Quand quatre personnes de votre ville choisissent le même sujet, une discussion de groupe s'ouvre et vous planifiez une rencontre.",
    skip: "Aller au contenu",
    download: "Télécharger pour Android",
    hero: {
      h1: ["Choisissez un sujet.", "Rencontrez les gens près de chez vous qui l'ont choisi aussi."],
      lead: "Ideas Match, c'est un paquet de cartes sur des domaines de recherche, des livres et des questions de politique publique. Glissez à droite sur celles dont vous pourriez parler pendant une heure. Quand quatre personnes de votre ville choisissent le même sujet, une discussion de groupe s'ouvre, et l'application vous aide à trouver un moment pour vous rencontrer.",
      note: "Gratuit, et seulement sur Android pour l'instant.",
    },
    board: board("fr"),
    storyLabel: "Comment ça marche",
    steps: [
      { h: "Glissez sur ce dont vous aimeriez parler", p: "Chaque carte est un sujet, comme les villes marchables ou les fondements des mathématiques. Certaines posent une question, et vous pouvez dire où vous vous situez avant de glisser." },
      { h: "Quatre personnes ouvrent un groupe", p: "Les languettes au bas d'une carte sont des places. Quand la quatrième personne de votre ville en détache une, une discussion de groupe s'ouvre avec vous quatre. Un groupe compte jusqu'à huit personnes." },
      { h: "Ou commencez à deux", p: "Les gens qui ont choisi le même sujet apparaissent aussi sous forme de cartes. Si vous glissez tous les deux à droite, une discussion s'ouvre avec une question sur le sujet pour lancer la conversation." },
      { h: "Puis rencontrez-vous", p: "Choisissez un moment et un lieu en quelques touches. Dès qu'assez de gens disent oui, c'est confirmé. Ensuite, l'application vous demande si vous vous êtes vraiment rencontrés, et c'est ce chiffre qui compte pour nous." },
    ],
    rulesTitle: "Quelques choix que nous avons faits",
    rules: [
      { h: "Vos opinions ne décident jamais qui vous rencontrez", p: "Les groupes se forment autour des sujets. Répondre à une question ne fait qu'ajouter à la répartition de votre ville, que vous voyez une fois que vous avez répondu.", ink: "#FFC21A" },
      { h: "Seules les personnes d'une discussion peuvent la lire", p: "Les messages sont chiffrés de bout en bout sur votre téléphone. Si vous signalez quelqu'un, c'est vous qui choisissez les messages que l'équipe de modération voit.", ink: "#2ED3A5" },
      { h: "Pas de fil, pas d'abonnés", p: "Un jumelage qui reste silencieux pendant une semaine se ferme de lui-même, alors vos discussions restent avec des gens que vous pourriez vraiment rencontrer.", ink: "#FF5FAE" },
      { h: "En français et en anglais", p: "L'application suit la langue de votre téléphone, et les sujets aussi.", ink: "#39C3E8" },
    ],
    end: {
      h: "Trouvez votre premier sujet",
      p: "L'application se télécharge directement depuis ce site plutôt que sur le Play Store, alors votre téléphone vous demandera d'autoriser l'installation.",
    },
    footer: [
      ["Confidentialité", "/confidentialite"],
      ["Conditions", "/conditions"],
      ["Sécurité", "/securite"],
    ],
    phone: {
      chips: ["Tout", "Société", "Humanités", "Sciences"],
      walk: { fields: "Villes et urbanisme et Environnement et climat", title: "Villes marchables", blurb: "Pourquoi certains lieux sont agréables à pied.", nearby: "5 à proximité" },
      vote: { fields: "Politique et Mathématiques", title: "Faut-il adopter le vote préférentiel?", stances: ["Pour", "Contre", "Incertain"], nearby: "3 à proximité. Vous ouvririez le groupe." },
      opened: "Un groupe sur le vote préférentiel vient de s'ouvrir à Ottawa.",
      groupTitle: "Faut-il adopter le vote préférentiel?",
      groupSub: "4 personnes",
      group: [
        ["Maya", "Avez-vous déjà voté ainsi?"],
        ["Jon", "Une fois, pour une association étudiante. Ça a changé qui se présentait."],
        ["Priya", "J'aimerais savoir s'il réduit vraiment la polarisation."],
        ["me", "Moi aussi. Un café cette semaine pour en débattre?"],
        ["Maya", "Oui, avec plaisir"],
      ],
      pairName: "Sam",
      pairSub: "Villes marchables",
      pairOpener: "Vous avez tous les deux choisi Villes marchables. Quelle est la plus belle marche de cette ville?",
      pair: [
        ["them", "Le long du canal en octobre, sans hésiter"],
        ["me", "Je ne l'ai jamais faite au complet"],
        ["them", "Envie de la faire en discutant?"],
        ["me", "Samedi matin?"],
      ],
      meetLine: "Priya a proposé une rencontre: bibliothèque.",
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
