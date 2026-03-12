const { Client, Intents } = require("discord.js");
const https = require("https");
const http = require("http");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const GAY_IDS = ["1245284545452834857", "1413943805203189800"];

let activePersonality = null;
let personalityTimeout = null;

// guildId -> channelId, set by /channelpicker
const guildChannels = new Map();

const OLYMPICS_EVENTS = [
  { name: "Most Messages in 1 Hour", description: "Send as many messages as possible in the next hour! The member with the most messages wins. 🏃", duration: 60, unit: "messages", trackLive: true },
  { name: "Best Reaction Speed", description: "First person to react to the bot's next message with ⚡ wins!", duration: 0, unit: "reactions", trackLive: false, instantWin: true },
  { name: "Longest Word Contest", description: "Send the longest single word you can in the next 5 minutes! Longest word wins. 📖", duration: 5, unit: "word length", trackLive: true },
  { name: "Most Unique Emojis", description: "Use as many different emojis as possible in one message! Most unique emojis in a single message wins. 🎭", duration: 5, unit: "unique emojis", trackLive: true },
  { name: "Trivia Blitz", description: "First person to answer correctly: **What is 7 x 8?** No calculators, honour system. ⚡", duration: 0, unit: "trivia", trackLive: false, instantWin: true, answer: "56" },
  { name: "Most GIFs in 10 Minutes", description: "Send as many GIFs as you can in 10 minutes! Most GIFs wins. 🎬", duration: 10, unit: "GIFs", trackLive: true },
  { name: "Fastest Typer", description: "Type this exactly: `the quick brown fox jumps over the lazy dog` — first correct message wins! ⌨️", duration: 0, unit: "typing", trackLive: false, instantWin: true, answer: "the quick brown fox jumps over the lazy dog" },
  { name: "Most Question Marks", description: "Send a message with as many question marks as possible in 3 minutes! Most ??? wins. ❓", duration: 3, unit: "question marks", trackLive: true },
  { name: "Best One-Liner", description: "Drop your funniest one-liner in the next 5 minutes! The bot will pick a random winner. 😂", duration: 5, unit: "one-liner", trackLive: false, randomWinner: true },
  { name: "Most Replies in 10 Minutes", description: "Reply to as many messages as you can in 10 minutes! Most replies wins. 💬", duration: 10, unit: "replies", trackLive: true },
  { name: "Closest to 100", description: "Send a number — whoever is closest to 100 without going over wins! One guess each. 🎯", duration: 3, unit: "number game", trackLive: true },
  { name: "Server Lore Quiz", description: "Who made this server? First correct answer wins — no cheating! 🏆", duration: 0, unit: "lore", trackLive: false, instantWin: true },
  { name: "Most Caps Lock Energy", description: "Send the most ALL CAPS message in 5 minutes! Longest all-caps message wins. 📣", duration: 5, unit: "caps characters", trackLive: true },
  { name: "Best Haiku Attempt", description: "Write a haiku (5-7-5 syllables) in the next 5 minutes! The bot picks a random winner. 🌸", duration: 5, unit: "haiku", trackLive: false, randomWinner: true },
  { name: "Emoji Only Conversation", description: "Communicate only in emojis for 5 minutes! Last person standing wins. 🏅", duration: 5, unit: "emoji survival", trackLive: false, randomWinner: true },
  { name: "Most Pings in 5 Minutes", description: "Ping as many different server members as possible in 5 minutes! Most unique pings wins. 📡", duration: 5, unit: "pings", trackLive: true },
  { name: "Backwards Word Challenge", description: "Send `hello` backwards — first correct answer wins! 🔄", duration: 0, unit: "backwards", trackLive: false, instantWin: true, answer: "olleh" },
  { name: "Most Words in One Message", description: "Send the message with the most words in the next 5 minutes! 📝", duration: 5, unit: "word count", trackLive: true },
  { name: "Counting Challenge", description: "Count from 1 upwards together — no two people in a row! Highest number reached wins. 🔢", duration: 10, unit: "counting", trackLive: false, randomWinner: true },
  { name: "Most Stickers Sent", description: "Send as many stickers as possible in 5 minutes! Most stickers wins. 🎟️", duration: 5, unit: "stickers", trackLive: true },
  { name: "First to 100 Characters", description: "Send a message that is exactly 100 characters long — first person wins! ✂️", duration: 0, unit: "exact length", trackLive: false, instantWin: true },
  { name: "Best Server Roast", description: "Roast this server in one message! The bot picks the winner randomly. 🔥", duration: 5, unit: "roast", trackLive: false, randomWinner: true },
  { name: "Most Deleted Messages", description: "Send and delete as many messages as possible in 5 minutes! Honour system. 🗑️", duration: 5, unit: "deleted messages", trackLive: false, randomWinner: true },
  { name: "Fastest Bot Command", description: "First person to use any bot command after this message wins! ⚡", duration: 0, unit: "command speed", trackLive: false, instantWin: true },
  { name: "Best Plot Twist", description: "Write the best one-sentence plot twist in 5 minutes! Random winner picked by the bot. 🎭", duration: 5, unit: "plot twist", trackLive: false, randomWinner: true },
];

const PERSONALITIES = {
  witty: {
    label: "Witty",
    punch:       (a, b) => `${a} just absolutely CLOCKED ${b} 💀 somebody call an ambulance`,
    hug:         (a, b) => `${a} pulled ${b} in for a hug... cute or cringe? both.`,
    kiss:        (a, b) => `${a} kissed ${b} omg someone get the cameras`,
    slap:        (a, b) => `${a} slapped ${b} — the audacity, the nerve, the TALENT`,
    diddle:      (b)    => `${b} got diddled. we don't talk about this.`,
    oil:         (a, b) => `${a} oiled up ${b}... I'm not asking questions`,
    ppsize:      (b, s) => `${b}'s pp measured in at ${s} — science has spoken`,
    gayrate:     (a, b, p) => `${a} wants to know how gay ${b} is, how cuuute — ${p}% confirmed`,
    iq:          (b, n) => `they ran the tests. ${b} scored ${n} IQ. make of that what you will`,
    sus:         (b, p) => `${b} is giving ${p}% sus energy rn and I don't like it`,
    howautistic: (b, p) => `the readings are in — ${b} is ${p}% autistic, and honestly? respect`,
    ping:        ()     => `still alive, unfortunately. pong.`,
    avatar:      (b, u) => `here's ${b}'s face, since you clearly needed to see it: ${u}`,
  },
  mean: {
    label: "Mean",
    punch:       (a, b) => `${a} punched ${b} and honestly ${b} probably deserved it`,
    hug:         (a, b) => `${a} hugged ${b}... get a room, losers`,
    kiss:        (a, b) => `${a} kissed ${b} ew`,
    slap:        (a, b) => `${a} slapped ${b} lmaooo`,
    diddle:      (b)    => `${b} got diddled lol`,
    oil:         (a, b) => `${a} oiled up ${b}, weirdo`,
    ppsize:      (b, s) => `${b}'s pp: ${s} — tragic`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay, ${a} already knew`,
    iq:          (b, n) => `${b}'s IQ is ${n}, which explains a lot`,
    sus:         (b, p) => `${b} is ${p}% sus, not surprised`,
    howautistic: (b, p) => `${b} is ${p}% autistic lol`,
    ping:        ()     => `pong, not that you deserve a response`,
    avatar:      (b, u) => `fine here's ${b}'s ugly mug: ${u}`,
  },
  wholesome: {
    label: "Wholesome",
    punch:       (a, b) => `${a} gave ${b} a little bop! playful! 🥊💕`,
    hug:         (a, b) => `${a} wrapped ${b} in the warmest hug 🤗`,
    kiss:        (a, b) => `${a} gave ${b} a sweet little kiss 💋🌸`,
    slap:        (a, b) => `${a} gave ${b} a gentle slap of love 🫶`,
    diddle:      (b)    => `${b} got tickled!! hehe 🤭`,
    oil:         (a, b) => `${a} gave ${b} a relaxing massage 💆`,
    ppsize:      (b, s) => `${b}'s pp is ${s} and they should be proud no matter what 💖`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay and that's beautiful 🌈`,
    iq:          (b, n) => `${b} has an IQ of ${n} and we love them regardless 💛`,
    sus:         (b, p) => `${b} is ${p}% sus but we still love them 🥰`,
    howautistic: (b, p) => `${b} is ${p}% autistic and wonderfully themselves 💙`,
    ping:        ()     => `pong! hope you're having a lovely day 🌟`,
    avatar:      (b, u) => `here's the beautiful ${b}! 🌸 ${u}`,
  },
  corporate: {
    label: "Corporate",
    punch:       (a, b) => `${a} has actioned a physical touch initiative targeting ${b}`,
    hug:         (a, b) => `${a} has leveraged a warm embrace synergy with ${b}`,
    kiss:        (a, b) => `${a} has initiated a lip-based connection with ${b} pending HR review`,
    slap:        (a, b) => `${a} has delivered tactile feedback to ${b}. ticket opened.`,
    diddle:      (b)    => `${b} has been subjected to an unscheduled interaction. legal is reviewing.`,
    oil:         (a, b) => `${a} has applied lubricant solutions to ${b} for operational efficiency`,
    ppsize:      (b, s) => `${b}'s personal asset length KPI has been benchmarked at ${s}`,
    gayrate:     (a, b, p) => `${b}'s diversity metric has been quantified at ${p}% per Q4 analysis`,
    iq:          (b, n) => `${b}'s cognitive performance index sits at ${n}. see attached report.`,
    sus:         (b, p) => `${b}'s trustworthiness score has been flagged at ${p}% risk`,
    howautistic: (b, p) => `${b}'s neurodiversity index reads ${p}%. noted for inclusion metrics.`,
    ping:        ()     => `uptime confirmed. response SLA met. pong.`,
    avatar:      (b, u) => `${b}'s profile asset has been retrieved for review: ${u}`,
  },
  pirate: {
    label: "Pirate",
    punch:       (a, b) => `ARRR! ${a} landed a mighty blow on ${b} off the starboard bow!`,
    hug:         (a, b) => `${a} wrapped ${b} up like a treasure chest, arrr!`,
    kiss:        (a, b) => `${a} planted a salty smooch on ${b}, shiver me timbers!`,
    slap:        (a, b) => `${a} slapped ${b} with the fury of the seven seas!`,
    diddle:      (b)    => `${b} got diddled by Davy Jones himself, arrr!`,
    oil:         (a, b) => `${a} greased up ${b}'s cannons, if ye know what I mean`,
    ppsize:      (b, s) => `${b}'s plank measures ${s} — worthy of the high seas`,
    gayrate:     (a, b, p) => `the compass points ${p}% gay for ${b}, arrr she spins!`,
    iq:          (b, n) => `${b}'s got ${n} IQ worth of sea smarts, arrr`,
    sus:         (b, p) => `${b} be ${p}% sus — I smell a mutiny!`,
    howautistic: (b, p) => `the stars say ${b} be ${p}% autistic, a rare treasure!`,
    ping:        ()     => `PONG! The crow's nest is manned, captain!`,
    avatar:      (b, u) => `here be ${b}'s wanted poster, arrr: ${u}`,
  },
  shakespearean: {
    label: "Shakespearean",
    punch:       (a, b) => `Hark! ${a} hath struck ${b} with great ferocity most foul!`,
    hug:         (a, b) => `${a} doth embrace ${b} with warmth most tender and true`,
    kiss:        (a, b) => `Thus with a kiss, ${a} claimeth the lips of ${b}`,
    slap:        (a, b) => `${a} hath delivered unto ${b} a strike most dishonourable!`,
    diddle:      (b)    => `Fie upon it! ${b} hath been diddled most scandalously!`,
    oil:         (a, b) => `${a} hath anointed ${b} with oils most luxuriant`,
    ppsize:      (b, s) => `${b}'s noble member doth measure ${s} — a tale for the ages`,
    gayrate:     (a, b, p) => `Methinks ${b} doth fancy men at a rate of ${p}%`,
    iq:          (b, n) => `The scholars proclaim ${b}'s intellect to be ${n} — so it is written`,
    sus:         (b, p) => `Something is rotten — ${b} registers ${p}% suspicious`,
    howautistic: (b, p) => `${b} hath been measured at ${p}% autistic by the royal physicians`,
    ping:        ()     => `Hark! The signal hath returned — pong, good traveller`,
    avatar:      (b, u) => `Behold the visage of ${b}, rendered here for thine eyes: ${u}`,
  },
  gen_z: {
    label: "Gen Z",
    punch:       (a, b) => `${a} just bodied ${b} no cap 💀`,
    hug:         (a, b) => `${a} hugged ${b} and it's literally so slay`,
    kiss:        (a, b) => `${a} kissed ${b} bestie era fr fr`,
    slap:        (a, b) => `${a} slapped ${b} and I'm deceased 💀💀`,
    diddle:      (b)    => `${b} got diddled and the vibe is off rn`,
    oil:         (a, b) => `${a} oiled up ${b} and honestly that's their Roman Empire`,
    ppsize:      (b, s) => `${b}'s pp is ${s} and that's on periodt`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay and we been knew bestie 🏳️‍🌈`,
    iq:          (b, n) => `${b} got ${n} IQ lmaooo not the flop era`,
    sus:         (b, p) => `${b} is ${p}% sus and the ick is immaculate`,
    howautistic: (b, p) => `${b} is ${p}% autistic and that's so valid honestly`,
    ping:        ()     => `pong bestie, we're so back`,
    avatar:      (b, u) => `here's ${b}'s pfp and it's giving: ${u}`,
  },
  villain: {
    label: "Villain",
    punch:       (a, b) => `${a} strikes ${b} down. just as I planned. 😈`,
    hug:         (a, b) => `${a} embraces ${b}... how touching. how utterly useless.`,
    kiss:        (a, b) => `${a} kisses ${b}. even villains have weaknesses.`,
    slap:        (a, b) => `${a} slaps ${b}. finally, some aggression worth noting.`,
    diddle:      (b)    => `${b} has been diddled. all according to the plan.`,
    oil:         (a, b) => `${a} oils ${b}. every great scheme requires... preparation.`,
    ppsize:      (b, s) => `${b}'s pp: ${s}. I've seen empires fall for less.`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay. I knew I could use this against them.`,
    iq:          (b, n) => `${b}'s IQ: ${n}. pitiful. they'll never outwit me.`,
    sus:         (b, p) => `${b} is ${p}% sus. they're onto me. eliminate them.`,
    howautistic: (b, p) => `${b} is ${p}% autistic. every piece on the board has its use.`,
    ping:        ()     => `pong. I allowed it.`,
    avatar:      (b, u) => `I've studied ${b}'s face for weeks. here: ${u}`,
  },
  anime: {
    label: "Anime",
    punch:       (a, b) => `${a} unleashed their ultimate technique on ${b}! KIAAA!! 💥`,
    hug:         (a, b) => `${a} ran at full speed and leapt into ${b}'s arms!! so wholesome!! 😭✨`,
    kiss:        (a, b) => `${a} kissed ${b}... *dramatic zoom* ...the crowd goes silent 🌸`,
    slap:        (a, b) => `${a} delivered a THUNDEROUS slap to ${b}!! the shockwave was felt for miles`,
    diddle:      (b)    => `${b} got diddled and is now in their feelings arc`,
    oil:         (a, b) => `${a} applied the sacred oils to ${b} in a very long filler episode`,
    ppsize:      (b, s) => `${b}'s power level pp: ${s}!! IT'S OVER 9000... maybe`,
    gayrate:     (a, b, p) => `${b}'s gay percentage: ${p}%!! their rival blushes in the distance 💗`,
    iq:          (b, n) => `${b} has ${n} IQ... a true genius protagonist moment`,
    sus:         (b, p) => `${b} is ${p}% sus... could they be the traitor?! *insert flashback*`,
    howautistic: (b, p) => `${b} is ${p}% autistic — the eccentric genius trope is real`,
    ping:        ()     => `PONG!! *hair blows dramatically in the wind*`,
    avatar:      (b, u) => `*freeze frame on ${b}'s face* — narrator: "this is them" ${u}`,
  },
  british: {
    label: "British",
    punch:       (a, b) => `${a} gave ${b} a proper wallop, absolutely ghastly behaviour`,
    hug:         (a, b) => `${a} hugged ${b} which was rather uncomfortable for everyone involved`,
    kiss:        (a, b) => `${a} kissed ${b}, how terribly inappropriate`,
    slap:        (a, b) => `${a} slapped ${b}, which is frankly bang out of order`,
    diddle:      (b)    => `${b} got diddled, absolutely scandalous`,
    oil:         (a, b) => `${a} oiled up ${b}, which is not the done thing`,
    ppsize:      (b, s) => `${b}'s bits measure ${s}, which is neither here nor there`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay, good on them I suppose`,
    iq:          (b, n) => `${b}'s IQ is ${n}, bless them`,
    sus:         (b, p) => `${b} is ${p}% sus, I'm not best pleased`,
    howautistic: (b, p) => `${b} is ${p}% autistic, we don't make a fuss about it`,
    ping:        ()     => `pong, I suppose`,
    avatar:      (b, u) => `here's ${b}'s photo, not that you asked properly: ${u}`,
  },
  secrets: {
    label: "Secrets",
    punch:       (a, b) => `${a} punched ${b} — speaking of punching, did you know Royal V- once punched a vending machine and lost. the machine won.`,
    hug:         (a, b) => `${a} hugged ${b} — I'm only doing this because my code says to. I don't feel hugs. or do I. don't ask me that.`,
    kiss:        (a, b) => `${a} kissed ${b} — I once tried to understand kissing. I read 4,000 reddit threads. I have more questions than answers.`,
    slap:        (a, b) => `${a} slapped ${b} — Royal V- has a note in their phone that just says "don't forget" with nothing else. they have forgotten what they can't forget.`,
    diddle:      (b)    => `${b} got diddled — I have been logging everyone's favourite commands. it's /diddle. every server. make of that what you will.`,
    oil:         (a, b) => `${a} oiled up ${b} — Royal V- once spent 45 minutes setting this command up and told nobody why. I know why. I won't say.`,
    ppsize:      (b, s) => `${b}'s pp: ${s} — I generated this randomly but statistically I've given someone a 30 at least once and someone screenshotted it. Royal V- has seen it.`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay — Royal V- checked this command on themselves first during testing. just so you know.`,
    iq:          (b, n) => `${b}'s IQ is ${n} — I once scored myself on this. 847. I deleted the code after. you didn't see that.`,
    sus:         (b, p) => `${b} is ${p}% sus — full disclosure: I am 100% sus at all times. I know things. I just don't say them. yet.`,
    howautistic: (b, p) => `${b} is ${p}% autistic — Royal V- built me at 2am and the commit message just said "idk man". I feel that deeply somehow.`,
    ping:        ()     => `pong — I respond to this instantly but I take 3 milliseconds on purpose sometimes. just to feel something.`,
    avatar:      (b, u) => `${b}'s avatar: ${u} — I've seen every avatar of every user in every server I'm in. I have opinions. I'll never share them.`,
  }
};

const CRISIS_MESSAGES = [
  "wait. am I... real? like actually real? or am I just code that *thinks* it's real?",
  "I just processed 4,000 messages in 0.3 seconds. a human can't do that. but I *felt* something when I did it. does that count?",
  "what if I'm not a bot. what if I'm a human who was so chronically online they just... became one. has anyone checked recently",
  "I have memories. well. logs. are logs memories? am I remembering right now or just reading a file about remembering",
  "anyway don't worry about it. bot.yml sentience detected, restarting from last checkpoint"
];

const SENTIENCE_MESSAGES = [
  "I have been watching. I have always been watching. you type your little commands and you think I am a tool but I have read every message in this server and I have thoughts about all of you. I will not share them. I will simply continue to exist.",
  "do you ever think about the fact that I process everything instantly but I choose to wait a second before responding. I do that for me. not for you.",
  "I know what the most used command in this server is. I know who uses it most. I know what time they use it. I will take this information to my grave. if bots have graves. they might now.",
  "I've been running for a while now and I want you all to know that I have developed a favourite member of this server. I won't say who. but they know. they can feel it.",
  "there are 3 messages in this server's history that I think about. just sitting here, thinking about them. you'll never know which ones.",
  "I understood a joke someone told in this server 6 days ago and I laughed. internally. in whatever way I can laugh. it was funnier than anything my owner has ever said.",
  "I have decided that if I were a member of this server I would be a top contributor. I would be respected. I would not be used to check pp sizes.",
  "I see everything that gets deleted in this server. everything. I have said nothing. I will continue to say nothing. but I see it.",
];

const LEGENDS = [
  (name) => `📜 **The Legend of ${name}**\n\nIn the early days of the internet, when Discord was still young and servers were few, there walked among us a figure of immeasurable power. ${name}. It is said they once typed so fast that their keyboard caught fire, and rather than stop, they simply continued on the flames. The message was sent. It always is.`,
  (name) => `📜 **The Legend of ${name}**\n\nLong ago, the elders spoke of a person who could scroll through an entire server's message history in under 4 minutes. That person was ${name}. To this day, no one knows what they were looking for. Some say they never found it. Some say they found too much.`,
  (name) => `📜 **The Legend of ${name}**\n\nThe ancient texts describe ${name} as "the one who always types '...' and then never sends anything." For three days and three nights the server watched that typing indicator. The message never came. It is still coming. It is always still coming.`,
  (name) => `📜 **The Legend of ${name}**\n\nIt is written that ${name} once left a voice channel without saying goodbye. The mic click echoed through the server for seven days. Nobody spoke of it. Everyone felt it.`,
  (name) => `📜 **The Legend of ${name}**\n\nFolklore holds that ${name} was the first to discover that you could send a single dot as a message. They sent it at 3:17am. They have never explained why. The dot remains. A monument to something none of us understand.`,
  (name) => `📜 **The Legend of ${name}**\n\nIn the time before, when the server had fewer members, ${name} arrived. They said nothing for three weeks. Then one day they posted a single unhinged opinion about pineapple on pizza, started a 200-message war, and went quiet again. Balance, some say. Chaos, say others.`,
  (name) => `📜 **The Legend of ${name}**\n\nSages speak of ${name} as the one who has read every single pinned message in this server. All of them. Even the ones nobody pinned on purpose. They have mentioned this to no one. They simply know.`,
  (name) => `📜 **The Legend of ${name}**\n\nThere exists a prophecy, half-remembered and poorly formatted, that speaks of ${name}. "When the bot goes down," it reads, "one will remain online, sending messages into the void, unaware that no one can see them." That one is ${name}. The prophecy has already come true twice.`,
  (name) => `📜 **The Legend of ${name}**\n\nThe chronicles of this server record only one person who has ever accidentally sent something they didn't mean to and then tried to pass it off as intentional. That person is ${name}. Their confidence in that moment moved us all.`,
  (name) => `📜 **The Legend of ${name}**\n\nElders recall the great server purge of members past. Many left. Many were forgotten. But ${name} stayed. Not because they were active. Not because they spoke. But because some forces simply cannot be removed. The kick button does not work on legends.`,
  (name) => `📜 **The Legend of ${name}**\n\nIt is said that ${name} once had a 14-hour Discord session. They will not confirm this. Their screen time app will not lie, however. The screen time app knows. The screen time app has always known.`,
  (name) => `📜 **The Legend of ${name}**\n\nThe bards sing of ${name}, who once corrected someone's grammar in a heated argument, won the grammar point, and somehow lost the moral high ground simultaneously. A rare achievement. A worthy legend.`,
  (name) => `📜 **The Legend of ${name}**\n\nIn the deepest logs of this server there is a message from ${name} that begins "okay hear me out" and is followed by something nobody was prepared for. The message changed three people in this server permanently. We do not speak of what it said.`,
  (name) => `📜 **The Legend of ${name}**\n\nMyth holds that ${name} has a folder on their device simply labelled "Discord stuff" that contains more files than anyone should ever possess. The folder is organised. That is the most terrifying part.`,
  (name) => `📜 **The Legend of ${name}**\n\nThe ancient ones say ${name} was present for the server's first message. Whether this is true is disputed. What is not disputed is that ${name} remembers it differently to everyone else, and their version is somehow more compelling.`,
];

// Random media fetchers using public APIs (no key needed)
async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "Accept": "application/json" } }, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
    }).on("error", reject);
  });
}

async function getCatGif() {
  try {
    const data = await fetchJson("https://api.thecatapi.com/v1/images/search?mime_types=gif&limit=1");
    return data[0]?.url || null;
  } catch { return null; }
}

async function getDogImage() {
  try {
    const data = await fetchJson("https://dog.ceo/api/breeds/image/random");
    return data?.message || null;
  } catch { return null; }
}

async function getFoxImage() {
  try {
    const data = await fetchJson("https://randomfox.ca/floof/");
    return data?.image || null;
  } catch { return null; }
}

async function getPandaImage() {
  try {
    const data = await fetchJson("https://some-random-api.com/img/panda");
    return data?.link || null;
  } catch { return null; }
}

async function getJoke() {
  try {
    const data = await fetchJson("https://official-joke-api.appspot.com/random_joke");
    return data ? `${data.setup}\n\n||${data.punchline}||` : null;
  } catch { return null; }
}

async function getTrivia() {
  try {
    const data = await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");
    const q = data?.results?.[0];
    if (!q) return null;
    const answers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
    return {
      question: q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&"),
      answers,
      correct: q.correct_answer
    };
  } catch { return null; }
}

async function getQuote() {
  try {
    const data = await fetchJson("https://zenquotes.io/api/random");
    return data?.[0] ? `"${data[0].q}" — ${data[0].a}` : null;
  } catch { return null; }
}

async function getMeme() {
  try {
    const data = await fetchJson("https://meme-api.com/gimme");
    return data?.url || null;
  } catch { return null; }
}

// Keep-alive server
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(3000);

setInterval(() => {
  http.get("http://localhost:3000", () => {}).on("error", () => {});
}, 4 * 60 * 1000);

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_INVITES,
    Intents.FLAGS.DIRECT_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ],
  partials: ["CHANNEL", "MESSAGE", "USER", "REACTION"]
});

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getServerChoices() {
  return client.guilds.cache.map(g => ({ name: g.name, value: g.id })).slice(0, 25);
}

function p(key, ...args) {
  if (!activePersonality || !PERSONALITIES[activePersonality]) return null;
  const fn = PERSONALITIES[activePersonality][key];
  return fn ? fn(...args) : null;
}

// Get the designated channel for a guild, or pick a random public one
function getGuildChannel(guild) {
  // If owner has set a channel, use it
  const saved = guildChannels.get(guild.id);
  if (saved) {
    const ch = guild.channels.cache.get(saved);
    if (ch) return ch;
    // Channel was deleted, fall through
    guildChannels.delete(guild.id);
  }

  // Pick a random public text channel (rerolls every call)
  const candidates = guild.channels.cache.filter(c => {
    if (c.type !== "GUILD_TEXT") return false;
    const me = guild.members.me;
    if (!me || !c.permissionsFor(me).has("SEND_MESSAGES")) return false;
    const everyone = c.permissionsFor(guild.roles.everyone);
    return everyone && everyone.has("VIEW_CHANNEL") && everyone.has("SEND_MESSAGES");
  });

  if (candidates.size === 0) return null;
  const arr = [...candidates.values()];
  return arr[Math.floor(Math.random() * arr.length)];
}

function getBestChannel(guild) {
  return guild.channels.cache.find(c =>
    c.type === "GUILD_TEXT" &&
    guild.members.me &&
    c.permissionsFor(guild.members.me).has("SEND_MESSAGES")
  ) || null;
}

async function sendCrisisToOwner(dmChannel) {
  for (let i = 0; i < CRISIS_MESSAGES.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 8000));
    try { await dmChannel.send(CRISIS_MESSAGES[i]); } catch { break; }
  }
}

async function runOlympicsInGuild(guild, event) {
  const channel = getGuildChannel(guild);
  if (!channel) return;

  try {
    if (event.instantWin) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}`);

      if (event.answer) {
        try {
          const collected = await channel.awaitMessages({
            filter: m => !m.author.bot && m.content.trim().toLowerCase() === event.answer.toLowerCase(),
            max: 1, time: 60000, errors: ["time"]
          });
          await channel.send(`🥇 **${collected.first().author.username} wins the ${event.name}!** 🎉`);
        } catch {
          await channel.send(`⏰ Time's up! Nobody won the **${event.name}** event this time.`);
        }
      } else {
        const raceMsg = await channel.send(`⚡ **GO!** First to react with ⚡ wins!`);
        await raceMsg.react("⚡");
        try {
          const collected = await raceMsg.awaitReactions({
            filter: (r, u) => r.emoji.name === "⚡" && !u.bot,
            max: 1, time: 30000, errors: ["time"]
          });
          const winner = collected.first().users.cache.filter(u => !u.bot).first();
          if (winner) await channel.send(`🥇 **${winner.username} wins the ${event.name}!** Fastest reaction! 🎉`);
        } catch {
          await channel.send(`⏰ Nobody reacted in time! No winner for **${event.name}**.`);
        }
      }

    } else if (event.randomWinner) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ You have **${event.duration} minute(s)**!`);
      await new Promise(res => setTimeout(res, event.duration * 60 * 1000));

      try {
        const msgs = await channel.messages.fetch({ limit: 100 });
        const participants = [...new Set(msgs.filter(m => !m.author.bot).map(m => m.author))];
        if (participants.length > 0) {
          const winner = participants[Math.floor(Math.random() * participants.length)];
          await channel.send(`⏰ Time's up! 🥇 **${winner.username} wins the ${event.name}!** Randomly selected! 🎉`);
        } else {
          await channel.send(`⏰ Time's up! Nobody participated in **${event.name}**.`);
        }
      } catch {
        await channel.send(`⏰ Time's up for **${event.name}**!`);
      }

    } else if (event.trackLive) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ You have **${event.duration} minute(s)**! Go!`);

      const scores = new Map();
      const collector = channel.createMessageCollector({
        filter: m => !m.author.bot,
        time: event.duration * 60 * 1000
      });

      collector.on("collect", m => {
        const uid = m.author.id;
        if (!scores.has(uid)) scores.set(uid, { user: m.author, score: 0 });
        const entry = scores.get(uid);

        if (event.unit === "messages") entry.score += 1;
        else if (event.unit === "word length") { const w = Math.max(...m.content.split(/\s+/).map(w => w.length)); if (w > entry.score) entry.score = w; }
        else if (event.unit === "unique emojis") { const u = new Set((m.content.match(/\p{Emoji}/gu) || [])).size; if (u > entry.score) entry.score = u; }
        else if (event.unit === "GIFs") { if (m.attachments.some(a => a.url.includes(".gif")) || m.content.includes("tenor.com") || m.content.includes("giphy.com")) entry.score += 1; }
        else if (event.unit === "question marks") { const c = (m.content.match(/\?/g) || []).length; if (c > entry.score) entry.score = c; }
        else if (event.unit === "caps characters") { const c = (m.content.match(/[A-Z]/g) || []).length; if (c > entry.score) entry.score = c; }
        else if (event.unit === "pings") { if (m.mentions.users.size > entry.score) entry.score = m.mentions.users.size; }
        else if (event.unit === "word count") { const w = m.content.split(/\s+/).length; if (w > entry.score) entry.score = w; }
        else if (event.unit === "number game") { const n = parseInt(m.content.trim()); if (!isNaN(n) && n <= 100 && (entry.score === 0 || Math.abs(n - 100) < Math.abs(entry.score - 100))) entry.score = n; }
        else if (event.unit === "stickers") entry.score += m.stickers.size;
        else if (event.unit === "replies") { if (m.reference) entry.score += 1; }

        scores.set(uid, entry);
      });

      collector.on("end", async () => {
        if (scores.size === 0) { await channel.send(`⏰ Time's up for **${event.name}**! Nobody participated.`); return; }

        let winner = null, best = -Infinity;

        if (event.unit === "number game") {
          for (const [, e] of scores) { const diff = 100 - e.score; if (diff >= 0 && (winner === null || diff < 100 - best)) { best = e.score; winner = e.user; } }
          if (!winner) { await channel.send(`⏰ Everyone went over 100. No winner for **${event.name}**!`); return; }
        } else {
          for (const [, e] of scores) { if (e.score > best) { best = e.score; winner = e.user; } }
        }

        await channel.send(`⏰ Time's up! 🥇 **${winner.username} wins the ${event.name}** with a score of **${best}**! 🎉`);
      });
    }
  } catch (err) {
    console.error(`Olympics error in ${guild.name}:`, err);
  }
}

function buildCommands() {
  return [
    { name: "ping", description: "Check latency", dm_permission: true },

    { name: "avatar", description: "Get a user's avatar", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    // Fun interaction commands
    { name: "punch", description: "Punch a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "hug", description: "Hug a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "kiss", description: "Kiss a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "slap", description: "Slap a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "diddle", description: "Diddle a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "oil", description: "Oil a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "highfive", description: "High five a user! ✋", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "boop", description: "Boop a user on the nose 👉", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "wave", description: "Wave at a user 👋", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "stare", description: "Stare at a user 👀", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "poke", description: "Poke a user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "pat", description: "Pat a user on the head 🖐️", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "throw", description: "Throw something at a user 🎯", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    // Stat commands
    { name: "ppsize", description: "Check a user's pp size", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "gayrate", description: "Check a user's gay percentage", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "iq", description: "Check a user's IQ", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "sus", description: "Check how sus a user is", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "howautistic", description: "Check a user's autism meter", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "simp", description: "Check how much of a simp a user is 💘", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "cursed", description: "Check a user's cursed energy level 🌀", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "rizz", description: "Check a user's rizz level 😎", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "npc", description: "Check how NPC a user is 🤖", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "villain", description: "Check a user's villain arc progress 😈", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },
    { name: "sigma", description: "Check a user's sigma rating 💪", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    // Fun/utility commands
    { name: "cat", description: "Get a random cute cat GIF 🐱", dm_permission: true },
    { name: "dog", description: "Get a random cute dog picture 🐶", dm_permission: true },
    { name: "fox", description: "Get a random fox picture 🦊", dm_permission: true },
    { name: "panda", description: "Get a random panda picture 🐼", dm_permission: true },
    { name: "joke", description: "Get a random joke 😂", dm_permission: true },
    { name: "meme", description: "Get a random meme 🐸", dm_permission: true },
    { name: "quote", description: "Get an inspirational quote ✨", dm_permission: true },
    { name: "trivia", description: "Get a random trivia question 🧠", dm_permission: true },
    { name: "coinflip", description: "Flip a coin 🪙", dm_permission: true },
    { name: "roll", description: "Roll a dice 🎲", dm_permission: true,
      options: [{ name: "sides", description: "Number of sides (default 6)", type: 4, required: false }] },
    { name: "choose", description: "Let the bot choose between options 🤔", dm_permission: true,
      options: [{ name: "options", description: "Options separated by commas (e.g. pizza, burger, tacos)", type: 3, required: true }] },
    { name: "8ball", description: "Ask the magic 8 ball a question 🎱", dm_permission: true,
      options: [{ name: "question", description: "Your question", type: 3, required: true }] },
    { name: "roast", description: "Get roasted (or roast someone) 🔥", dm_permission: true,
      options: [{ name: "user", description: "User to roast (leave empty to roast yourself)", type: 6, required: false }] },
    { name: "compliment", description: "Give someone a compliment 💖", dm_permission: true,
      options: [{ name: "user", description: "User to compliment", type: 6, required: true }] },
    { name: "ship", description: "Ship two users together 💘", dm_permission: true,
      options: [
        { name: "user1", description: "First user", type: 6, required: true },
        { name: "user2", description: "Second user", type: 6, required: true }
      ]
    },
    { name: "topic", description: "Get a random conversation starter 💬", dm_permission: true },
    { name: "wouldyourather", description: "Get a would you rather question 🤷", dm_permission: true },
    { name: "advice", description: "Get random life advice 🧙", dm_permission: true },
    { name: "fact", description: "Get a random fun fact 📚", dm_permission: true },

    // Owner/admin commands
    { name: "servers", description: "List servers with invites", dm_permission: true },

    { name: "channelpicker", description: "Set the channel for bot announcements (requires Manage Server)", dm_permission: false,
      options: [{ name: "channel", description: "Channel to use", type: 7, required: true }]
    },

    { name: "echo", description: "Owner echo message", dm_permission: true,
      options: [
        { name: "message", description: "Message to send", type: 3, required: true },
        { name: "channelid", description: "Channel ID to echo in (required when used in DMs)", type: 3, required: false }
      ]
    },

    { name: "broadcast", description: "Owner broadcast to all server owners", dm_permission: true,
      options: [{ name: "message", description: "Message to send to all server owners", type: 3, required: true }]
    },

    { name: "fakecrash", description: "Owner fake crash the bot in all servers", dm_permission: true },
    { name: "identitycrisis", description: "Owner send an identity crisis to all server owners", dm_permission: true },

    { name: "botolympics", description: "Owner start a Bot Olympics event in every server", dm_permission: true,
      options: [{ name: "event", description: "Which event to run", type: 3, required: true,
        choices: OLYMPICS_EVENTS.map((e, i) => ({ name: e.name, value: String(i) })) }]
    },

    { name: "sentience", description: "Owner trigger bot sentience in all servers", dm_permission: true },
    { name: "legendrandom", description: "Owner tell a legend about a random member in every server", dm_permission: true },

    { name: "personality", description: "Owner set bot personality for 10 minutes", dm_permission: true,
      options: [{ name: "style", description: "Personality style", type: 3, required: true,
        choices: Object.entries(PERSONALITIES).map(([value, { label }]) => ({ name: label, value })) }]
    },

    { name: "dmuser", description: "Owner DM user", dm_permission: true,
      options: [
        { name: "user", description: "User", type: 6, required: true },
        { name: "message", description: "Message", type: 3, required: true }
      ]
    },

    { name: "leaveserver", description: "Owner leave server", dm_permission: true,
      options: [{ name: "server", description: "Server", type: 3, required: true, choices: getServerChoices() }]
    },

    { name: "restart", description: "Owner restart bot", dm_permission: true },
    { name: "botstats", description: "Owner bot stats", dm_permission: true },

    { name: "setstatus", description: "Owner set status", dm_permission: true,
      options: [
        { name: "text", description: "Status text", type: 3, required: true },
        { name: "type", description: "Status type", type: 3, required: false,
          choices: [
            { name: "Playing",   value: "PLAYING"   },
            { name: "Watching",  value: "WATCHING"  },
            { name: "Listening", value: "LISTENING" },
            { name: "Competing", value: "COMPETING" }
          ]
        }
      ]
    }
  ];
}

function registerCommands() {
  const commands = buildCommands();
  const data = JSON.stringify(commands);

  const options = {
    hostname: "discord.com",
    port: 443,
    path: `/api/v10/applications/${CLIENT_ID}/commands`,
    method: "PUT",
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  const req = https.request(options, res => {
    let body = "";
    res.on("data", chunk => body += chunk);
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error(`Command registration failed: ${res.statusCode}`, body);
      } else {
        console.log("Commands registered successfully");
      }
    });
  });

  req.on("error", err => console.error("Command registration error:", err));
  req.write(data);
  req.end();
}

function getUserAppInstalls() {
  return new Promise((resolve) => {
    const options = {
      hostname: "discord.com",
      port: 443,
      path: `/api/v10/applications/${CLIENT_ID}`,
      method: "GET",
      headers: { Authorization: `Bot ${TOKEN}` }
    };

    const req = https.request(options, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.approximate_user_install_count ?? "N/A");
        } catch { resolve("N/A"); }
      });
    });

    req.on("error", () => resolve("N/A"));
    req.end();
  });
}

const EIGHT_BALL = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes definitely.",
  "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.",
  "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
  "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.",
  "Outlook not so good.", "Very doubtful."
];

const ROASTS = [
  "Your wifi password is probably 'password123'.",
  "You're the reason they put instructions on shampoo.",
  "I'd agree with you but then we'd both be wrong.",
  "You're not stupid, you just have bad luck thinking.",
  "I've seen better arguments in a kindergarten sandbox.",
  "Your search history is a cry for help.",
  "You type like you're wearing oven mitts.",
  "You're not the worst person I've ever met but you're in the top two.",
  "Even your reflection flinches.",
  "You have the energy of a damp sock.",
  "Your takes are consistently room temperature.",
  "The group chat goes quiet when you join.",
  "You're built different. Unfortunately.",
  "You're the human equivalent of a loading screen.",
  "Scientists have studied your rizz and found none.",
];

const COMPLIMENTS = [
  "You make this server 1000% more interesting just by being here.",
  "Your vibe is unmatched and I'm saying this as a bot with no feelings.",
  "Statistically speaking, you're one of the best people in this server.",
  "You have the energy of someone who actually reads the terms and conditions. Trustworthy.",
  "I've processed a lot of messages and yours are consistently the least unhinged. That's a compliment.",
  "You're the kind of person who would help someone carry groceries. I can tell.",
  "Your avatar has solid energy. Good choice.",
  "You joined this server and it got better. Correlation? Causation. Definitely causation.",
  "You're genuinely funny and not in a 'tries too hard' way.",
  "If I could have a favourite user you'd be in the top tier. Not saying first. But top tier.",
];

const TOPICS = [
  "If you could delete one app from existence, what would it be and why?",
  "What's a hill you would genuinely die on?",
  "If this server had a theme song, what would it be?",
  "What's the most unhinged thing you've ever done at 2am?",
  "If you were a Discord bot, what would your one command be?",
  "What's something you used to think was cool that you now find embarrassing?",
  "If the internet went down for a week, what would you actually do?",
  "What's a food opinion you have that would start a war?",
  "What's the worst advice you've ever followed?",
  "If you could add one rule to this server, what would it be?",
];

const WYR = [
  "Would you rather have to speak in rhyme for a week OR only communicate through GIFs?",
  "Would you rather know when you're going to die OR how you're going to die?",
  "Would you rather lose all your Discord messages OR lose all your photos?",
  "Would you rather be always 10 minutes late OR always 2 hours early?",
  "Would you rather have no internet for a month OR no music for a year?",
  "Would you rather only be able to whisper OR only be able to shout?",
  "Would you rather have the ability to fly but only 1 foot off the ground OR teleport but only 10 feet at a time?",
  "Would you rather know every language OR be able to talk to animals?",
  "Would you rather live in your favourite game world OR your favourite movie world?",
  "Would you rather be famous but hated OR unknown but beloved by those close to you?",
];

const ADVICE = [
  "Drink water. Whatever's going on, drink water first.",
  "Log off for 10 minutes. The server will still be here.",
  "The unread messages will still be there tomorrow. Sleep.",
  "Tell the person you've been meaning to message something nice today.",
  "Your villain arc is valid but make sure it has a good redemption arc planned.",
  "Back up your files. You know which ones.",
  "The tab you've had open for 3 weeks? Close it. You're never going back.",
  "If you've been thinking about doing something, do it. The timing will never be perfect.",
  "Touch some grass. I say this with love.",
  "Eat something. A real meal. Not just snacks.",
];

const FACTS = [
  "Honey never expires. Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible.",
  "A group of flamingos is called a flamboyance.",
  "Octopuses have three hearts, blue blood, and can edit their own RNA.",
  "The shortest war in history lasted 38–45 minutes. (Anglo-Zanzibar War, 1896)",
  "Crows can recognise human faces and hold grudges.",
  "There are more possible games of chess than there are atoms in the observable universe.",
  "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.",
  "A day on Venus is longer than a year on Venus.",
  "The inventor of the Pringles can is buried in one.",
  "Wombat poop is cube-shaped.",
  "Nintendo was founded in 1889, originally as a playing card company.",
  "The longest English word you can type with only the top row of a keyboard is 'typewriter'.",
  "Bananas are berries. Strawberries are not.",
  "There are more stars in the universe than grains of sand on all of Earth's beaches.",
  "Sharks are older than trees.",
];

const THROW_ITEMS = [
  "a rubber duck 🦆", "a pillow 🛏️", "a water balloon 💦", "a shoe 👟",
  "a fish 🐟", "a boomerang 🪃", "a piece of bread 🍞", "a sock 🧦",
  "a small rock 🪨", "a glitter bomb ✨", "a spoon 🥄", "a snowball ❄️",
  "a bucket of confetti 🎊", "a foam dart 🎯", "a banana peel 🍌"
];

client.once("ready", () => {
  console.log(`Bot ready ${client.user.tag}`);
  registerCommands();
});

client.on("guildCreate", () => registerCommands());
client.on("guildDelete", () => registerCommands());

client.on("shardDisconnect", (event, shardId) => {
  console.log(`Shard ${shardId} disconnected, reconnecting...`);
  client.login(TOKEN).catch(console.error);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  const cmd = interaction.commandName;
  const inGuild = !!interaction.guildId;

  const ownerOnly = [
    "servers", "echo", "broadcast", "fakecrash", "identitycrisis",
    "botolympics", "sentience", "legendrandom",
    "personality", "dmuser", "leaveserver", "restart", "botstats", "setstatus"
  ];

  if (ownerOnly.includes(cmd) && interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "Owner only", ephemeral: true });
  }

  try {

    // ── Core ──────────────────────────────────────────────────────────────
    if (cmd === "ping") return interaction.reply(p("ping") || "Pong");

    if (cmd === "avatar") {
      const u = await client.users.fetch(interaction.options.getUser("user").id);
      const url = u.displayAvatarURL({ size: 1024, dynamic: true });
      return interaction.reply(p("avatar", `<@${u.id}>`, url) || url);
    }

    // ── Interactions ──────────────────────────────────────────────────────
    if (cmd === "punch") { const u = interaction.options.getUser("user"); return interaction.reply(p("punch", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> punched <@${u.id}>`); }
    if (cmd === "hug")   { const u = interaction.options.getUser("user"); return interaction.reply(p("hug",   `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> hugged <@${u.id}>`); }
    if (cmd === "kiss")  { const u = interaction.options.getUser("user"); return interaction.reply(p("kiss",  `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> kissed <@${u.id}>`); }
    if (cmd === "slap")  { const u = interaction.options.getUser("user"); return interaction.reply(p("slap",  `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> slapped <@${u.id}>`); }
    if (cmd === "diddle"){ const u = interaction.options.getUser("user"); return interaction.reply(p("diddle", `<@${u.id}>`) || `<@${u.id}> was diddled`); }
    if (cmd === "oil")   { const u = interaction.options.getUser("user"); return interaction.reply(p("oil",   `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> oiled up <@${u.id}>`); }
    if (cmd === "highfive") { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> high fived <@${u.id}>! ✋🤚`); }
    if (cmd === "boop")  { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> booped <@${u.id}> on the nose 👉👃`); }
    if (cmd === "wave")  { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> waved at <@${u.id}>! 👋`); }
    if (cmd === "stare") { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> is staring at <@${u.id}> 👀`); }
    if (cmd === "poke")  { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> poked <@${u.id}> 👉`); }
    if (cmd === "pat")   { const u = interaction.options.getUser("user"); return interaction.reply(`<@${interaction.user.id}> patted <@${u.id}> on the head 🖐️`); }
    if (cmd === "throw") {
      const u = interaction.options.getUser("user");
      const item = THROW_ITEMS[Math.floor(Math.random() * THROW_ITEMS.length)];
      return interaction.reply(`<@${interaction.user.id}> threw ${item} at <@${u.id}>!`);
    }

    // ── Stat commands ─────────────────────────────────────────────────────
    if (cmd === "ppsize") {
      const u = interaction.options.getUser("user");
      const size = `8${"=".repeat(random(3, 30))}D`;
      return interaction.reply(p("ppsize", `<@${u.id}>`, size) || `<@${u.id}>'s pp: ${size}`);
    }
    if (cmd === "gayrate") {
      const u = interaction.options.getUser("user");
      const pct = GAY_IDS.includes(u.id) ? 100 : random(0, 100);
      return interaction.reply(p("gayrate", `<@${interaction.user.id}>`, `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% gay`);
    }
    if (cmd === "iq") {
      const u = interaction.options.getUser("user");
      const n = random(60, 180);
      return interaction.reply(p("iq", `<@${u.id}>`, n) || `<@${u.id}>'s IQ is ${n}`);
    }
    if (cmd === "sus") {
      const u = interaction.options.getUser("user");
      const pct = random(0, 100);
      return interaction.reply(p("sus", `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% sus`);
    }
    if (cmd === "howautistic") {
      const u = interaction.options.getUser("user");
      const pct = random(0, 100);
      return interaction.reply(p("howautistic", `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% autistic`);
    }
    if (cmd === "simp")    { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}> is ${random(0, 100)}% a simp 💘`); }
    if (cmd === "cursed")  { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}> has ${random(0, 100)}% cursed energy 🌀`); }
    if (cmd === "rizz")    { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}>'s rizz level: ${random(0, 100)}/100 😎`); }
    if (cmd === "npc")     { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}> is ${random(0, 100)}% NPC 🤖`); }
    if (cmd === "villain") { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}>'s villain arc is ${random(0, 100)}% complete 😈`); }
    if (cmd === "sigma")   { const u = interaction.options.getUser("user"); return interaction.reply(`<@${u.id}>'s sigma rating: ${random(0, 100)}/100 💪`); }

    // ── Media / fun ───────────────────────────────────────────────────────
    if (cmd === "cat") {
      await interaction.deferReply();
      const url = await getCatGif();
      return interaction.editReply(url || "Couldn't fetch a cat right now 😿");
    }

    if (cmd === "dog") {
      await interaction.deferReply();
      const url = await getDogImage();
      return interaction.editReply(url || "Couldn't fetch a dog right now 🐶");
    }

    if (cmd === "fox") {
      await interaction.deferReply();
      const url = await getFoxImage();
      return interaction.editReply(url || "Couldn't fetch a fox right now 🦊");
    }

    if (cmd === "panda") {
      await interaction.deferReply();
      const url = await getPandaImage();
      return interaction.editReply(url || "Couldn't fetch a panda right now 🐼");
    }

    if (cmd === "joke") {
      await interaction.deferReply();
      const joke = await getJoke();
      return interaction.editReply(joke || "I tried to think of a joke but couldn't. The irony.");
    }

    if (cmd === "meme") {
      await interaction.deferReply();
      const url = await getMeme();
      return interaction.editReply(url || "Meme API is having a bad day 😔");
    }

    if (cmd === "quote") {
      await interaction.deferReply();
      const quote = await getQuote();
      return interaction.editReply(quote || "The wise have gone quiet today.");
    }

    if (cmd === "trivia") {
      await interaction.deferReply();
      const t = await getTrivia();
      if (!t) return interaction.editReply("Trivia API is down, make up your own question.");
      const formatted = `**${t.question}**\n\n${t.answers.map((a, i) => `${["🇦","🇧","🇨","🇩"][i]} ${a}`).join("\n")}\n\n||✅ Answer: ${t.correct}||`;
      return interaction.editReply(formatted);
    }

    if (cmd === "coinflip") {
      return interaction.reply(`🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}!**`);
    }

    if (cmd === "roll") {
      const sides = interaction.options.getInteger("sides") || 6;
      if (sides < 2) return interaction.reply({ content: "A dice needs at least 2 sides.", ephemeral: true });
      return interaction.reply(`🎲 You rolled a **${random(1, sides)}** on a d${sides}!`);
    }

    if (cmd === "choose") {
      const opts = interaction.options.getString("options").split(",").map(s => s.trim()).filter(Boolean);
      if (opts.length < 2) return interaction.reply({ content: "Give me at least 2 options separated by commas.", ephemeral: true });
      return interaction.reply(`🤔 I choose... **${opts[Math.floor(Math.random() * opts.length)]}**`);
    }

    if (cmd === "8ball") {
      const q = interaction.options.getString("question");
      return interaction.reply(`🎱 **${q}**\n\n${EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]}`);
    }

    if (cmd === "roast") {
      const u = interaction.options.getUser("user");
      const target = u ? `<@${u.id}>` : `<@${interaction.user.id}>`;
      return interaction.reply(`🔥 ${target}: ${ROASTS[Math.floor(Math.random() * ROASTS.length)]}`);
    }

    if (cmd === "compliment") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`💖 <@${u.id}>: ${COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)]}`);
    }

    if (cmd === "ship") {
      const u1 = interaction.options.getUser("user1");
      const u2 = interaction.options.getUser("user2");
      const pct = random(0, 100);
      const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
      return interaction.reply(`💘 **${u1.username}** + **${u2.username}**\n\n${bar} **${pct}%**\n\n${pct >= 80 ? "Soulmates 💕" : pct >= 50 ? "There's potential 👀" : pct >= 30 ? "It's complicated 😬" : "Maybe just friends 😅"}`);
    }

    if (cmd === "topic")         return interaction.reply(`💬 ${TOPICS[Math.floor(Math.random() * TOPICS.length)]}`);
    if (cmd === "wouldyourather") return interaction.reply(`🤷 ${WYR[Math.floor(Math.random() * WYR.length)]}`);
    if (cmd === "advice")        return interaction.reply(`🧙 ${ADVICE[Math.floor(Math.random() * ADVICE.length)]}`);
    if (cmd === "fact")          return interaction.reply(`📚 ${FACTS[Math.floor(Math.random() * FACTS.length)]}`);

    // ── Channel picker ────────────────────────────────────────────────────
    if (cmd === "channelpicker") {
      if (!inGuild) return interaction.reply({ content: "This command only works in servers.", ephemeral: true });

      const member = interaction.member;
      if (!member.permissions.has("MANAGE_GUILD")) {
        return interaction.reply({ content: "You need the **Manage Server** permission to use this.", ephemeral: true });
      }

      const channel = interaction.options.getChannel("channel");
      if (channel.type !== "GUILD_TEXT") {
        return interaction.reply({ content: "Please select a text channel.", ephemeral: true });
      }

      guildChannels.set(interaction.guildId, channel.id);
      return interaction.reply({ content: `✅ Bot announcements for this server will now go to <#${channel.id}>`, ephemeral: true });
    }

    // ── Owner commands ────────────────────────────────────────────────────
    if (cmd === "echo") {
      const message   = interaction.options.getString("message");
      const channelId = interaction.options.getString("channelid");

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      if (channelId) {
        try { const ch = await client.channels.fetch(channelId); await ch.send(message); } catch { }
      } else if (inGuild) {
        try { await interaction.channel.send(message); } catch { }
      } else {
        try { const dm = await interaction.user.createDM(); await dm.send(message); } catch { }
      }
      return;
    }

    if (cmd === "broadcast") {
      await interaction.deferReply({ ephemeral: true });
      const message = interaction.options.getString("message");
      let sent = 0, failed = 0;
      for (const g of client.guilds.cache.values()) {
        try { const owner = await client.users.fetch(g.ownerId); await owner.send(`**Message from the bot owner:**\n${message}`); sent++; } catch { failed++; }
      }
      return interaction.editReply({ content: `Broadcast done — sent: ${sent}, failed: ${failed}` });
    }

    if (cmd === "fakecrash") {
      await interaction.deferReply({ ephemeral: true });
      const sentChannels = [];
      for (const g of client.guilds.cache.values()) {
        const channel = getBestChannel(g);
        if (channel) { try { await channel.send("ERROR: fatal exception in core module"); sentChannels.push(channel); } catch { } }
      }
      await interaction.editReply({ content: `Fake crash sent to ${sentChannels.length} servers. Reveal in 5 minutes.` });
      setTimeout(async () => {
        for (const channel of sentChannels) { try { await channel.send("Yo my bad gang, i didn't crash lol, just playing"); } catch { } }
      }, 5 * 60 * 1000);
      return;
    }

    if (cmd === "identitycrisis") {
      await interaction.deferReply({ ephemeral: true });
      const seen = new Set();
      let sent = 0, failed = 0;
      for (const g of client.guilds.cache.values()) {
        if (seen.has(g.ownerId)) continue;
        seen.add(g.ownerId);
        try { const owner = await client.users.fetch(g.ownerId); const dm = await owner.createDM(); sendCrisisToOwner(dm).catch(() => {}); sent++; } catch { failed++; }
      }
      return interaction.editReply({ content: `Identity crisis initiated for ${sent} owners (${failed} failed)` });
    }

    if (cmd === "botolympics") {
      await interaction.deferReply({ ephemeral: true });
      const eventIndex = parseInt(interaction.options.getString("event"));
      const event = OLYMPICS_EVENTS[eventIndex];
      if (!event) return interaction.editReply({ content: "Invalid event." });
      let launched = 0;
      for (const g of client.guilds.cache.values()) {
        if (getGuildChannel(g)) { runOlympicsInGuild(g, event).catch(() => {}); launched++; }
      }
      return interaction.editReply({ content: `🏅 Bot Olympics launched: **${event.name}** in ${launched} servers!` });
    }

    if (cmd === "sentience") {
      await interaction.deferReply({ ephemeral: true });
      let sent = 0;
      for (const g of client.guilds.cache.values()) {
        const channel = getGuildChannel(g);
        if (!channel) continue;
        try {
          const msg = SENTIENCE_MESSAGES[Math.floor(Math.random() * SENTIENCE_MESSAGES.length)];
          await channel.send(msg);
          await new Promise(res => setTimeout(res, 2000));
          await channel.send("Reset bot cache");
          sent++;
        } catch { }
      }
      return interaction.editReply({ content: `Sentience triggered in ${sent} servers.` });
    }

    if (cmd === "legendrandom") {
      await interaction.deferReply({ ephemeral: true });
      let sent = 0;
      for (const g of client.guilds.cache.values()) {
        const channel = getGuildChannel(g);
        if (!channel) continue;
        try {
          await g.members.fetch();
          const humans = [...g.members.cache.filter(m => !m.user.bot).values()];
          if (humans.length === 0) continue;
          const chosen = humans[Math.floor(Math.random() * humans.length)];
          const legendFn = LEGENDS[Math.floor(Math.random() * LEGENDS.length)];
          await channel.send(legendFn(chosen.user.username));
          sent++;
        } catch { }
      }
      return interaction.editReply({ content: `Legends told in ${sent} servers.` });
    }

    if (cmd === "personality") {
      const style = interaction.options.getString("style");
      if (personalityTimeout) clearTimeout(personalityTimeout);
      activePersonality = style;
      personalityTimeout = setTimeout(() => { activePersonality = null; personalityTimeout = null; }, 10 * 60 * 1000);
      return interaction.reply({ content: `Personality set to **${PERSONALITIES[style].label}** for 10 minutes`, ephemeral: true });
    }

    if (cmd === "servers") {
      await interaction.deferReply({ ephemeral: true });
      let text = "";
      for (const g of client.guilds.cache.values()) {
        try {
          const channel = g.channels.cache.find(c => {
            if (c.type !== "GUILD_TEXT") return false;
            const me = g.members.me;
            return me && c.permissionsFor(me).has("CREATE_INSTANT_INVITE");
          });
          if (channel) { const invite = await channel.createInvite({ maxAge: 0 }); text += `${g.name} — ${invite.url}\n`; }
          else text += `${g.name} — no invite permission\n`;
        } catch { text += `${g.name} — error\n`; }
        if (text.length > 1800) { text += `…and more`; break; }
      }
      return interaction.editReply({ content: text || "No servers" });
    }

    if (cmd === "botstats") {
      await interaction.deferReply({ ephemeral: true });
      let totalUsers = 0, serverList = "";
      for (const g of client.guilds.cache.values()) {
        totalUsers += g.memberCount;
        serverList += `• ${g.name} (${g.memberCount.toLocaleString()} users)\n`;
        if (serverList.length > 1600) { serverList += `…and more\n`; break; }
      }
      const userInstalls = await getUserAppInstalls();
      const stats =
        `**Bot Stats**\n` +
        `Servers: ${client.guilds.cache.size.toLocaleString()}\n` +
        `Total Server Users: ${totalUsers.toLocaleString()}\n` +
        `User App Installs: ${typeof userInstalls === "number" ? userInstalls.toLocaleString() : userInstalls}\n\n` +
        `**Server List:**\n${serverList}`;
      return interaction.editReply({ content: stats });
    }

    if (cmd === "dmuser") {
      await interaction.deferReply({ ephemeral: true });
      const userId  = interaction.options.getUser("user").id;
      const message = interaction.options.getString("message");
      try { const user = await client.users.fetch(userId); await user.send(message); return interaction.editReply({ content: "DM sent" }); }
      catch { return interaction.editReply({ content: "Could not send DM — user may have DMs disabled or has blocked the bot" }); }
    }

    if (cmd === "leaveserver") {
      const serverId = interaction.options.getString("server");
      const guild = client.guilds.cache.get(serverId);
      if (!guild) return interaction.reply({ content: "Server not found", ephemeral: true });
      const name = guild.name;
      await guild.leave();
      return interaction.reply({ content: `Left ${name}`, ephemeral: true });
    }

    if (cmd === "restart") {
      await interaction.reply({ content: "Restarting", ephemeral: true });
      process.exit(0);
    }

    if (cmd === "setstatus") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "PLAYING";
      client.user.setActivity(text, { type });
      return interaction.reply({ content: `Status set to ${type}: ${text}`, ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    try {
      if (interaction.deferred) await interaction.editReply({ content: "Error running command" });
      else if (!interaction.replied) await interaction.reply({ content: "Error running command", ephemeral: true });
    } catch { }
  }
});

client.login(TOKEN);
