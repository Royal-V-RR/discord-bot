const { Client, Intents } = require("discord.js");
const https = require("https");
const http = require("http");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";
const GAY_IDS = ["1245284545452834857", "1413943805203189800"];

// ── Instance lock (prevents duplicate workflow instances) ─────────────────────
// Each instance picks a random ID. On ready, it DMs the owner with a lock
// message. If a lock message from ANOTHER instance was sent in the last 10s,
// this instance is a duplicate and exits.
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
const LOCK_PREFIX = "BOT_INSTANCE_LOCK:";
let instanceLocked = false;

async function acquireInstanceLock(ownerUser) {
  try {
    const dm = await ownerUser.createDM();
    // Fetch recent DM history to check for a competing lock
    const recent = await dm.messages.fetch({ limit: 10 });
    const now = Date.now();
    const competing = recent.find(m =>
      m.author.id === CLIENT_ID &&
      m.content.startsWith(LOCK_PREFIX) &&
      !m.content.includes(INSTANCE_ID) &&
      (now - m.createdTimestamp) < 10000
    );
    if (competing) {
      console.log(`Duplicate instance detected (lock held by another). Exiting.`);
      process.exit(0);
    }
    await dm.send(`${LOCK_PREFIX}${INSTANCE_ID}:${now}`);
    instanceLocked = true;
    console.log(`Instance lock acquired: ${INSTANCE_ID}`);
  } catch (e) {
    console.error("Lock check failed:", e);
    // Fail open — don't exit if we can't check
    instanceLocked = true;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
const guildChannels = new Map(); // guildId -> channelId (set by /channelpicker)
const activeGames   = new Map(); // channelId -> game state

// ── Global scoring (in-memory) ────────────────────────────────────────────────
// scores: userId -> { username, wins, gamesPlayed, coins, dailyStreak, bestStreak, lastDailyDate }
const scores = new Map();

function getScore(userId, username) {
  if (!scores.has(userId)) scores.set(userId, {
    username, wins: 0, gamesPlayed: 0, coins: 0,
    dailyStreak: 0, bestStreak: 0, lastDailyDate: ""
  });
  const s = scores.get(userId);
  if (username) s.username = username;
  // ensure older entries have streak fields
  if (s.dailyStreak  === undefined) s.dailyStreak  = 0;
  if (s.bestStreak   === undefined) s.bestStreak   = 0;
  if (s.lastDailyDate=== undefined) s.lastDailyDate= "";
  return s;
}

function recordWin(userId, username, coinReward = 50) {
  const s = getScore(userId, username);
  s.wins++;
  s.gamesPlayed++;
  s.coins += coinReward;
}

function recordLoss(userId, username) {
  const s = getScore(userId, username);
  s.gamesPlayed++;
}

function recordDraw(userId, username) {
  const s = getScore(userId, username);
  s.gamesPlayed++;
  s.coins += 10;
}

// Call this when a user completes the daily challenge
function recordDaily(userId, username) {
  const s = getScore(userId, username);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (s.lastDailyDate === yesterday) {
    s.dailyStreak++;
  } else if (s.lastDailyDate === today) {
    // already counted today, no-op (shouldn't happen due to dailyCompletions guard)
    return s;
  } else {
    s.dailyStreak = 1; // streak broken
  }
  s.lastDailyDate = today;
  if (s.dailyStreak > s.bestStreak) s.bestStreak = s.dailyStreak;
  s.coins += 100 + (s.dailyStreak - 1) * 10; // bonus 10 coins per streak day
  return s;
}

// ── Daily challenge (resets at midnight UTC) ──────────────────────────────────
let dailyChallenge = null;
let dailyDate = "";
const dailyCompletions = new Set(); // userIds who completed today

const DAILY_CHALLENGES = [
  { type: "math",    desc: "Solve: **{a} × {b} + {c}**",          gen: () => { const a=r(2,12),b=r(2,12),c=r(1,20); return { params:{a,b,c}, answer: String(a*b+c) }; } },
  { type: "word",    desc: "Unscramble: **`{w}`**",                 gen: () => { const w=pick(HANGMAN_WORDS), sc=w.split("").sort(()=>Math.random()-0.5).join(""); return { params:{w:sc}, answer:w }; } },
  { type: "trivia",  desc: "Trivia: **{q}**",                       gen: async () => { const t=await getTrivia(); return t ? { params:{q:t.question}, answer:t.correct, choices:t.answers } : null; } },
  { type: "count",   desc: "How many letters in: **{word}**?",      gen: () => { const word=pick(HANGMAN_WORDS); return { params:{word}, answer: String(word.length) }; } },
];

function getDailyChallenge() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyDate !== today) {
    dailyDate = today;
    dailyCompletions.clear();
    const c = DAILY_CHALLENGES[Math.floor(Math.random() * DAILY_CHALLENGES.length)];
    const gen = c.gen();
    if (gen && !(gen instanceof Promise)) {
      const desc = c.desc.replace(/\{(\w+)\}/g, (_,k) => gen.params[k] ?? "?");
      dailyChallenge = { desc, answer: gen.answer, choices: gen.choices || null };
    } else {
      // fallback sync challenge
      const a=r(2,12),b=r(2,12);
      dailyChallenge = { desc: `Solve: **${a} × ${b}**`, answer: String(a*b), choices: null };
    }
  }
  return dailyChallenge;
}

// ── Olympics events ───────────────────────────────────────────────────────────
const OLYMPICS_EVENTS = [
  { name: "Most Messages in 1 Hour",       description: "Send as many messages as possible in the next hour! The member with the most messages wins. 🏃",                     duration: 60, unit: "messages",       trackLive: true },
  { name: "Best Reaction Speed",           description: "First person to react to the bot's next message with ⚡ wins!",                                                      duration: 0,  unit: "reactions",      trackLive: false, instantWin: true },
  { name: "Longest Word Contest",          description: "Send the longest single word you can in the next 5 minutes! Longest word wins. 📖",                                  duration: 5,  unit: "word length",    trackLive: true },
  { name: "Most Unique Emojis",            description: "Use as many different emojis as possible in one message! Most unique emojis in a single message wins. 🎭",           duration: 5,  unit: "unique emojis",  trackLive: true },
  { name: "Trivia Blitz",                  description: "First person to answer correctly: **What is 7 x 8?** No calculators, honour system. ⚡",                             duration: 0,  unit: "trivia",         trackLive: false, instantWin: true, answer: "56" },
  { name: "Most GIFs in 10 Minutes",       description: "Send as many GIFs as you can in 10 minutes! Most GIFs wins. 🎬",                                                    duration: 10, unit: "GIFs",           trackLive: true },
  { name: "Fastest Typer",                 description: "Type this exactly: `the quick brown fox jumps over the lazy dog` — first correct message wins! ⌨️",                 duration: 0,  unit: "typing",         trackLive: false, instantWin: true, answer: "the quick brown fox jumps over the lazy dog" },
  { name: "Most Question Marks",           description: "Send a message with as many question marks as possible in 3 minutes! Most ??? wins. ❓",                             duration: 3,  unit: "question marks", trackLive: true },
  { name: "Best One-Liner",                description: "Drop your funniest one-liner in the next 5 minutes! The bot will pick a random winner. 😂",                         duration: 5,  unit: "one-liner",      trackLive: false, randomWinner: true },
  { name: "Most Replies in 10 Minutes",    description: "Reply to as many messages as you can in 10 minutes! Most replies wins. 💬",                                          duration: 10, unit: "replies",        trackLive: true },
  { name: "Closest to 100",               description: "Send a number — whoever is closest to 100 without going over wins! One guess each. 🎯",                              duration: 3,  unit: "number game",    trackLive: true },
  { name: "Server Lore Quiz",             description: "Who made this server? First correct answer wins — no cheating! 🏆",                                                   duration: 0,  unit: "lore",           trackLive: false, instantWin: true },
  { name: "Most Caps Lock Energy",        description: "Send the most ALL CAPS message in 5 minutes! Longest all-caps message wins. 📣",                                      duration: 5,  unit: "caps characters", trackLive: true },
  { name: "Best Haiku Attempt",           description: "Write a haiku (5-7-5 syllables) in the next 5 minutes! The bot picks a random winner. 🌸",                           duration: 5,  unit: "haiku",          trackLive: false, randomWinner: true },
  { name: "Emoji Only Conversation",      description: "Communicate only in emojis for 5 minutes! Last person standing wins. 🏅",                                             duration: 5,  unit: "emoji survival", trackLive: false, randomWinner: true },
  { name: "Most Pings in 5 Minutes",      description: "Ping as many different server members as possible in 5 minutes! Most unique pings wins. 📡",                          duration: 5,  unit: "pings",          trackLive: true },
  { name: "Backwards Word Challenge",     description: "Send `hello` backwards — first correct answer wins! 🔄",                                                              duration: 0,  unit: "backwards",      trackLive: false, instantWin: true, answer: "olleh" },
  { name: "Most Words in One Message",    description: "Send the message with the most words in the next 5 minutes! 📝",                                                      duration: 5,  unit: "word count",     trackLive: true },
  { name: "Counting Challenge",           description: "Count from 1 upwards together — no two people in a row! Highest number reached wins. 🔢",                             duration: 10, unit: "counting",       trackLive: false, randomWinner: true },
  { name: "Most Stickers Sent",           description: "Send as many stickers as possible in 5 minutes! Most stickers wins. 🎟️",                                             duration: 5,  unit: "stickers",       trackLive: true },
  { name: "First to 100 Characters",      description: "Send a message that is exactly 100 characters long — first person wins! ✂️",                                         duration: 0,  unit: "exact length",   trackLive: false, instantWin: true },
  { name: "Best Server Roast",            description: "Roast this server in one message! The bot picks the winner randomly. 🔥",                                             duration: 5,  unit: "roast",          trackLive: false, randomWinner: true },
  { name: "Most Deleted Messages",        description: "Send and delete as many messages as possible in 5 minutes! Honour system. 🗑️",                                       duration: 5,  unit: "deleted messages",trackLive: false, randomWinner: true },
  { name: "Fastest Bot Command",          description: "First person to use any bot command after this message wins! ⚡",                                                     duration: 0,  unit: "command speed",  trackLive: false, instantWin: true },
  { name: "Best Plot Twist",              description: "Write the best one-sentence plot twist in 5 minutes! Random winner picked by the bot. 🎭",                            duration: 5,  unit: "plot twist",     trackLive: false, randomWinner: true },
];

// ── Static content arrays ─────────────────────────────────────────────────────
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

const EIGHT_BALL   = ["It is certain.","It is decidedly so.","Without a doubt.","Yes definitely.","You may rely on it.","As I see it, yes.","Most likely.","Outlook good.","Yes.","Signs point to yes.","Reply hazy, try again.","Ask again later.","Better not tell you now.","Cannot predict now.","Concentrate and ask again.","Don't count on it.","My reply is no.","My sources say no.","Outlook not so good.","Very doubtful."];
const ROASTS       = ["Your wifi password is probably 'password123'.","You're the reason they put instructions on shampoo.","I'd agree with you but then we'd both be wrong.","You're not stupid, you just have bad luck thinking.","I've seen better arguments in a kindergarten sandbox.","Your search history is a cry for help.","You type like you're wearing oven mitts.","You're not the worst person I've ever met but you're in the top two.","Even your reflection flinches.","You have the energy of a damp sock.","Your takes are consistently room temperature.","The group chat goes quiet when you join.","You're built different. Unfortunately.","You're the human equivalent of a loading screen.","Scientists have studied your rizz and found none."];
const COMPLIMENTS  = ["You make this server 1000% more interesting just by being here.","Your vibe is unmatched and I'm saying this as a bot with no feelings.","Statistically speaking, you're one of the best people in this server.","You have the energy of someone who actually reads the terms and conditions. Trustworthy.","I've processed a lot of messages and yours are consistently the least unhinged. That's a compliment.","You're the kind of person who would help someone carry groceries. I can tell.","Your avatar has solid energy. Good choice.","You joined this server and it got better. Correlation? Causation. Definitely causation.","You're genuinely funny and not in a 'tries too hard' way.","If I could have a favourite user you'd be in the top tier. Not saying first. But top tier."];
const TOPICS       = ["If you could delete one app from existence, what would it be and why?","What's a hill you would genuinely die on?","If this server had a theme song, what would it be?","What's the most unhinged thing you've ever done at 2am?","If you were a Discord bot, what would your one command be?","What's something you used to think was cool that you now find embarrassing?","If the internet went down for a week, what would you actually do?","What's a food opinion you have that would start a war?","What's the worst advice you've ever followed?","If you could add one rule to this server, what would it be?"];
const WYR          = ["Would you rather have to speak in rhyme for a week OR only communicate through GIFs?","Would you rather know when you're going to die OR how you're going to die?","Would you rather lose all your Discord messages OR lose all your photos?","Would you rather be always 10 minutes late OR always 2 hours early?","Would you rather have no internet for a month OR no music for a year?","Would you rather only be able to whisper OR only be able to shout?","Would you rather have the ability to fly but only 1 foot off the ground OR teleport but only 10 feet at a time?","Would you rather know every language OR be able to talk to animals?","Would you rather live in your favourite game world OR your favourite movie world?","Would you rather be famous but hated OR unknown but beloved by those close to you?"];
const ADVICE       = ["Drink water. Whatever's going on, drink water first.","Log off for 10 minutes. The server will still be here.","The unread messages will still be there tomorrow. Sleep.","Tell the person you've been meaning to message something nice today.","Your villain arc is valid but make sure it has a good redemption arc planned.","Back up your files. You know which ones.","The tab you've had open for 3 weeks? Close it. You're never going back.","If you've been thinking about doing something, do it. The timing will never be perfect.","Touch some grass. I say this with love.","Eat something. A real meal. Not just snacks."];
const FACTS        = ["Honey never expires. Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible.","A group of flamingos is called a flamboyance.","Octopuses have three hearts, blue blood, and can edit their own RNA.","The shortest war in history lasted 38–45 minutes. (Anglo-Zanzibar War, 1896)","Crows can recognise human faces and hold grudges.","There are more possible games of chess than there are atoms in the observable universe.","Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.","A day on Venus is longer than a year on Venus.","The inventor of the Pringles can is buried in one.","Wombat poop is cube-shaped.","Nintendo was founded in 1889, originally as a playing card company.","The longest English word you can type with only the top row of a keyboard is 'typewriter'.","Bananas are berries. Strawberries are not.","There are more stars in the universe than grains of sand on all of Earth's beaches.","Sharks are older than trees."];
const THROW_ITEMS  = ["a rubber duck 🦆","a pillow 🛏️","a water balloon 💦","a shoe 👟","a fish 🐟","a boomerang 🪃","a piece of bread 🍞","a sock 🧦","a small rock 🪨","a glitter bomb ✨","a spoon 🥄","a snowball ❄️","a bucket of confetti 🎊","a foam dart 🎯","a banana peel 🍌"];
const HANGMAN_WORDS = ["discord","javascript","keyboard","penguin","asteroid","jellyfish","xylophone","labyrinth","cinnamon","algorithm","saxophone","quarterback","zeppelin","archipelago","mischievous"];

// ── Helpers ───────────────────────────────────────────────────────────────────
const r    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const getServerChoices = () => client.guilds.cache.map(g => ({ name: g.name, value: g.id })).slice(0, 25);

// Returns the correct channel to send announcements/game results to,
// respecting /channelpicker if set for the guild.
function getTargetChannel(interaction) {
  if (!interaction.guildId) return interaction.channel;
  const saved = guildChannels.get(interaction.guildId);
  if (saved) {
    const ch = interaction.guild.channels.cache.get(saved);
    if (ch) return ch;
    guildChannels.delete(interaction.guildId); // stale — remove it
  }
  return interaction.channel;
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) return await interaction.editReply(typeof payload === "string" ? { content: payload } : payload);
    if (interaction.replied) return;
    return await interaction.reply(typeof payload === "string" ? { content: payload } : payload);
  } catch {}
}

// Safe send to a channel (used when we need to send outside the interaction reply)
async function safeSend(channel, payload) {
  try { return await channel.send(typeof payload === "string" ? { content: payload } : payload); } catch {}
}

function getGuildChannel(guild) {
  const saved = guildChannels.get(guild.id);
  if (saved) { const ch = guild.channels.cache.get(saved); if (ch) return ch; guildChannels.delete(guild.id); }
  const candidates = guild.channels.cache.filter(c => {
    if (c.type !== "GUILD_TEXT") return false;
    const me = guild.members.me; if (!me || !c.permissionsFor(me).has("SEND_MESSAGES")) return false;
    const ev = c.permissionsFor(guild.roles.everyone);
    return ev && ev.has("VIEW_CHANNEL") && ev.has("SEND_MESSAGES");
  });
  if (!candidates.size) return null;
  const arr = [...candidates.values()]; return arr[Math.floor(Math.random() * arr.length)];
}

function getBestChannel(guild) {
  return guild.channels.cache.find(c => c.type === "GUILD_TEXT" && guild.members.me && c.permissionsFor(guild.members.me).has("SEND_MESSAGES")) || null;
}

async function sendCrisisToOwner(dmChannel) {
  for (let i = 0; i < CRISIS_MESSAGES.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 8000));
    try { await dmChannel.send(CRISIS_MESSAGES[i]); } catch { break; }
  }
}

// ── Game renderers / helpers ──────────────────────────────────────────────────
function renderTTT(board) {
  const s = v => v === "X" ? "❌" : v === "O" ? "⭕" : "⬜";
  return [0,1,2].map(row => board.slice(row*3, row*3+3).map(s).join("")).join("\n");
}
function checkTTTWin(b) {
  for (const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])
    if (b[a] && b[a]===b[c] && b[a]===b[d]) return b[a];
  return b.includes(null) ? null : "draw";
}

function renderConnect4(board) {
  const e = v => v===1?"🔴":v===2?"🔵":"⚫";
  let out = "1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣\n";
  for (let row=0; row<6; row++) out += board.slice(row*7, row*7+7).map(e).join("") + "\n";
  return out;
}
function dropConnect4(board, col, player) {
  for (let row=5; row>=0; row--) { if (!board[row*7+col]) { board[row*7+col]=player; return row; } }
  return -1;
}
function checkConnect4Win(board, player) {
  const chk = (row,col,dr,dc) => { for(let i=0;i<4;i++){const nr=row+dr*i,nc=col+dc*i;if(nr<0||nr>=6||nc<0||nc>=7||board[nr*7+nc]!==player)return false;}return true;};
  for (let row=0;row<6;row++) for (let col=0;col<7;col++)
    if (chk(row,col,0,1)||chk(row,col,1,0)||chk(row,col,1,1)||chk(row,col,1,-1)) return true;
  return false;
}

function renderHangman(word, guessed) {
  const display = word.split("").map(l => guessed.has(l) ? l : "_").join(" ");
  const wrong = [...guessed].filter(l => !word.includes(l));
  const stages = ["```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```"];
  return `${stages[Math.min(wrong.length,6)]}\n**Word:** ${display}\n**Wrong guesses (${wrong.length}/6):** ${wrong.join(", ")||"none"}`;
}

function renderSnake(game) {
  const grid = Array(game.size*game.size).fill("⬜");
  game.snake.forEach((s,i) => grid[s.y*game.size+s.x] = i===0?"🟢":"🟩");
  grid[game.food.y*game.size+game.food.x] = "🍎";
  let out=""; for(let row=0;row<game.size;row++) out+=grid.slice(row*game.size,(row+1)*game.size).join("")+"\n";
  return out+`**Score:** ${game.score} | Use ⬆️⬇️⬅️➡️ to move`;
}
function moveSnake(game, dir) {
  const head={...game.snake[0]};
  if(dir==="⬆️")head.y--;else if(dir==="⬇️")head.y++;else if(dir==="⬅️")head.x--;else head.x++;
  if(head.x<0||head.x>=game.size||head.y<0||head.y>=game.size)return"wall";
  if(game.snake.some(s=>s.x===head.x&&s.y===head.y))return"self";
  game.snake.unshift(head);
  if(head.x===game.food.x&&head.y===game.food.y){
    game.score++;
    let fx,fy; do{fx=Math.floor(Math.random()*game.size);fy=Math.floor(Math.random()*game.size);}while(game.snake.some(s=>s.x===fx&&s.y===fy));
    game.food={x:fx,y:fy};
  }else{game.snake.pop();}
  return"ok";
}

function renderMinesweeper(game, reveal=false) {
  let out="";
  for(let row=0;row<game.rows;row++){
    for(let col=0;col<game.cols;col++){
      const idx=row*game.cols+col;
      if(reveal||game.revealed[idx]){if(game.mines[idx])out+="💣";else{const n=game.adjCount[idx];out+=n>0?["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣"][n-1]:"⬜";}}
      else if(game.flagged[idx])out+="🚩";
      else out+="🟦";
    }
    out+="\n";
  }
  return out;
}
function initMinesweeper(rows, cols, mines) {
  const total=rows*cols, mineSet=new Set();
  while(mineSet.size<mines)mineSet.add(Math.floor(Math.random()*total));
  const mineArr=Array(total).fill(false); mineSet.forEach(i=>mineArr[i]=true);
  const adjCount=Array(total).fill(0);
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    if(mineArr[row*cols+col])continue; let count=0;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=row+dr,nc=col+dc;if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&mineArr[nr*cols+nc])count++;}
    adjCount[row*cols+col]=count;
  }
  return{rows,cols,mines:mineArr,adjCount,revealed:Array(total).fill(false),flagged:Array(total).fill(false)};
}
function revealMinesweeper(game, row, col) {
  const idx=row*game.cols+col;
  if(game.revealed[idx]||game.flagged[idx])return;
  game.revealed[idx]=true;
  if(game.adjCount[idx]===0&&!game.mines[idx])
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=row+dr,nc=col+dc;if(nr>=0&&nr<game.rows&&nc>=0&&nc<game.cols)revealMinesweeper(game,nr,nc);}
}

// ── Economy / gambling helpers ────────────────────────────────────────────────
const SLOT_SYMBOLS = ["🍒","🍋","🍊","🍇","⭐","💎"];
function spinSlots() {
  return [pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS)];
}
function slotPayout(reels, bet) {
  if (reels[0]===reels[1]&&reels[1]===reels[2]) {
    if (reels[0]==="💎") return { mult: 10, label: "💎 JACKPOT 💎" };
    if (reels[0]==="⭐") return { mult: 5,  label: "⭐ BIG WIN ⭐" };
    return { mult: 3, label: "🎰 THREE OF A KIND!" };
  }
  if (reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2]) return { mult: 1.5, label: "Two of a kind" };
  return { mult: 0, label: "No match" };
}

// Blackjack helpers
function newDeck() {
  const suits=["♠","♥","♦","♣"], faces=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck=[]; for(const s of suits)for(const f of faces)deck.push(f+s);
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function cardValue(card) {
  const f=card.slice(0,-1);
  if(f==="A")return 11;
  if(["J","Q","K"].includes(f))return 10;
  return parseInt(f);
}
function handValue(hand) {
  let total=hand.reduce((s,c)=>s+cardValue(c),0), aces=hand.filter(c=>c.startsWith("A")).length;
  while(total>21&&aces>0){total-=10;aces--;}
  return total;
}
function renderHand(hand, hideSecond=false) {
  return hideSecond ? `${hand[0]} 🂠` : hand.join(" ");
}

// ── Media fetchers ────────────────────────────────────────────────────────────
async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers:{"Accept":"application/json"} }, res => {
      let body=""; res.on("data",d=>body+=d);
      res.on("end",()=>{try{resolve(JSON.parse(body));}catch{reject();}});
    }).on("error",reject);
  });
}
async function getCatGif()    { try{const d=await fetchJson("https://api.thecatapi.com/v1/images/search?mime_types=gif&limit=1");return d[0]?.url||null;}catch{return null;} }
async function getDogImage()  { try{const d=await fetchJson("https://dog.ceo/api/breeds/image/random");return d?.message||null;}catch{return null;} }
async function getFoxImage()  { try{const d=await fetchJson("https://randomfox.ca/floof/");return d?.image||null;}catch{return null;} }
async function getPandaImage(){ try{const d=await fetchJson("https://some-random-api.com/img/panda");return d?.link||null;}catch{return null;} }
async function getMeme()      { try{const d=await fetchJson("https://meme-api.com/gimme");return d?.url||null;}catch{return null;} }
async function getQuote()     { try{const d=await fetchJson("https://zenquotes.io/api/random");return d?.[0]?`"${d[0].q}" — ${d[0].a}`:null;}catch{return null;} }
async function getJoke()      { try{const d=await fetchJson("https://official-joke-api.appspot.com/random_joke");return d?`${d.setup}\n\n||${d.punchline}||`:null;}catch{return null;} }
async function getTrivia()    {
  try {
    const d=await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");
    const q=d?.results?.[0]; if(!q)return null;
    const answers=[...q.incorrect_answers,q.correct_answer].sort(()=>Math.random()-0.5);
    return{question:q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,"&"),answers,correct:q.correct_answer};
  }catch{return null;}
}

// ── Keep-alive ────────────────────────────────────────────────────────────────
http.createServer((req,res)=>{res.writeHead(200);res.end("OK");}).listen(3000);
setInterval(()=>{http.get("http://localhost:3000",()=>{}).on("error",()=>{});},4*60*1000);

// ── Olympics ──────────────────────────────────────────────────────────────────
async function runOlympicsInGuild(guild, event) {
  const channel=getGuildChannel(guild); if(!channel)return;
  try {
    if (event.instantWin) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}`);
      if (event.answer) {
        try{const col=await channel.awaitMessages({filter:m=>!m.author.bot&&m.content.trim().toLowerCase()===event.answer.toLowerCase(),max:1,time:60000,errors:["time"]});
          const w=col.first().author; recordWin(w.id,w.username,75);
          await channel.send(`🥇 **${w.username} wins the ${event.name}!** 🎉 (+75 coins)`);}
        catch{await channel.send(`⏰ Time's up! Nobody won **${event.name}**.`);}
      } else {
        const rm=await channel.send(`⚡ **GO!** First to react with ⚡ wins!`); await rm.react("⚡");
        try{const col=await rm.awaitReactions({filter:(re,u)=>re.emoji.name==="⚡"&&!u.bot,max:1,time:30000,errors:["time"]});
          const w=col.first().users.cache.filter(u=>!u.bot).first();
          if(w){recordWin(w.id,w.username,75);await channel.send(`🥇 **${w.username} wins!** 🎉 (+75 coins)`);}}
        catch{await channel.send(`⏰ Nobody reacted in time.`);}
      }
    } else if (event.randomWinner) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**!`);
      await new Promise(res=>setTimeout(res,event.duration*60*1000));
      try{const msgs=await channel.messages.fetch({limit:100});const parts=[...new Set(msgs.filter(m=>!m.author.bot).map(m=>m.author))];
        if(parts.length>0){const w=parts[Math.floor(Math.random()*parts.length)];recordWin(w.id,w.username,75);await channel.send(`🥇 **${w.username} wins the ${event.name}!** 🎉 (+75 coins)`);}
        else await channel.send(`⏰ Nobody participated.`);}
      catch{await channel.send(`⏰ Time's up!`);}
    } else if (event.trackLive) {
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**! Go!`);
      const sc=new Map();
      const col=channel.createMessageCollector({filter:m=>!m.author.bot,time:event.duration*60*1000});
      col.on("collect",m=>{
        const uid=m.author.id; if(!sc.has(uid))sc.set(uid,{user:m.author,score:0}); const e=sc.get(uid);
        if(event.unit==="messages")e.score+=1;
        else if(event.unit==="word length"){const w=Math.max(...m.content.split(/\s+/).map(w=>w.length));if(w>e.score)e.score=w;}
        else if(event.unit==="unique emojis"){const u=new Set((m.content.match(/\p{Emoji}/gu)||[])).size;if(u>e.score)e.score=u;}
        else if(event.unit==="GIFs"){if(m.attachments.some(a=>a.url.includes(".gif"))||m.content.includes("tenor.com")||m.content.includes("giphy.com"))e.score+=1;}
        else if(event.unit==="question marks"){const c=(m.content.match(/\?/g)||[]).length;if(c>e.score)e.score=c;}
        else if(event.unit==="caps characters"){const c=(m.content.match(/[A-Z]/g)||[]).length;if(c>e.score)e.score=c;}
        else if(event.unit==="pings"){if(m.mentions.users.size>e.score)e.score=m.mentions.users.size;}
        else if(event.unit==="word count"){const w=m.content.split(/\s+/).length;if(w>e.score)e.score=w;}
        else if(event.unit==="number game"){const n=parseInt(m.content.trim());if(!isNaN(n)&&n<=100&&(e.score===0||Math.abs(n-100)<Math.abs(e.score-100)))e.score=n;}
        else if(event.unit==="stickers")e.score+=m.stickers.size;
        else if(event.unit==="replies"){if(m.reference)e.score+=1;}
        sc.set(uid,e);
      });
      col.on("end",async()=>{
        if(!sc.size){await channel.send(`⏰ Nobody participated.`);return;}
        let winner=null,best=-Infinity;
        if(event.unit==="number game"){for(const[,e]of sc){const diff=100-e.score;if(diff>=0&&(winner===null||diff<100-best)){best=e.score;winner=e.user;}}if(!winner){await channel.send(`⏰ Everyone went over 100!`);return;}}
        else{for(const[,e]of sc){if(e.score>best){best=e.score;winner=e.user;}}}
        recordWin(winner.id,winner.username,75);
        await channel.send(`⏰ 🥇 **${winner.username} wins the ${event.name}** with **${best}**! 🎉 (+75 coins)`);
      });
    }
  }catch(err){console.error(`Olympics error in ${guild.name}:`,err);}
}

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents:[Intents.FLAGS.GUILDS,Intents.FLAGS.GUILD_MEMBERS,Intents.FLAGS.GUILD_INVITES,Intents.FLAGS.DIRECT_MESSAGES,Intents.FLAGS.GUILD_MESSAGES,Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
  partials:["CHANNEL","MESSAGE","USER","REACTION"]
});

// ── Command registration ──────────────────────────────────────────────────────
function buildCommands() {
  const uReq  = (required=true) => [{ name:"user", description:"User", type:6, required }];
  return [
    // Fun
    { name:"ping",        description:"Check latency",                      dm_permission:true },
    { name:"avatar",      description:"Get a user's avatar",                dm_permission:true, options:uReq() },
    { name:"punch",       description:"Punch a user",                       dm_permission:true, options:uReq() },
    { name:"hug",         description:"Hug a user",                         dm_permission:true, options:uReq() },
    { name:"kiss",        description:"Kiss a user",                        dm_permission:true, options:uReq() },
    { name:"slap",        description:"Slap a user",                        dm_permission:true, options:uReq() },
    { name:"diddle",      description:"Diddle a user",                      dm_permission:true, options:uReq() },
    { name:"oil",         description:"Oil a user",                         dm_permission:true, options:uReq() },
    { name:"highfive",    description:"High five a user ✋",                dm_permission:true, options:uReq() },
    { name:"boop",        description:"Boop a user 👉",                    dm_permission:true, options:uReq() },
    { name:"wave",        description:"Wave at a user 👋",                  dm_permission:true, options:uReq() },
    { name:"stare",       description:"Stare at a user 👀",                 dm_permission:true, options:uReq() },
    { name:"poke",        description:"Poke a user",                        dm_permission:true, options:uReq() },
    { name:"pat",         description:"Pat a user 🖐️",                      dm_permission:true, options:uReq() },
    { name:"throw",       description:"Throw something at a user 🎯",       dm_permission:true, options:uReq() },
    { name:"ppsize",      description:"Check a user's pp size",             dm_permission:true, options:uReq() },
    { name:"gayrate",     description:"Check a user's gay percentage",      dm_permission:true, options:uReq() },
    { name:"iq",          description:"Check a user's IQ",                  dm_permission:true, options:uReq() },
    { name:"sus",         description:"Check how sus a user is",            dm_permission:true, options:uReq() },
    { name:"howautistic", description:"Check a user's autism meter",        dm_permission:true, options:uReq() },
    { name:"simp",        description:"Check simp level 💘",                dm_permission:true, options:uReq() },
    { name:"cursed",      description:"Check cursed energy 🌀",             dm_permission:true, options:uReq() },
    { name:"rizz",        description:"Check rizz level 😎",                dm_permission:true, options:uReq() },
    { name:"npc",         description:"Check NPC % 🤖",                    dm_permission:true, options:uReq() },
    { name:"villain",     description:"Check villain arc 😈",               dm_permission:true, options:uReq() },
    { name:"sigma",       description:"Check sigma rating 💪",              dm_permission:true, options:uReq() },
    // Media
    { name:"cat",    description:"Random cat GIF 🐱",        dm_permission:true },
    { name:"dog",    description:"Random dog picture 🐶",     dm_permission:true },
    { name:"fox",    description:"Random fox picture 🦊",     dm_permission:true },
    { name:"panda",  description:"Random panda picture 🐼",   dm_permission:true },
    { name:"joke",   description:"Random joke 😂",            dm_permission:true },
    { name:"meme",   description:"Random meme 🐸",            dm_permission:true },
    { name:"quote",  description:"Inspirational quote ✨",    dm_permission:true },
    { name:"trivia", description:"Random trivia question 🧠", dm_permission:true },
    // Utility
    { name:"coinflip",       description:"Flip a coin 🪙",                         dm_permission:true },
    { name:"roll",           description:"Roll a dice 🎲",                          dm_permission:true, options:[{name:"sides",description:"Sides (default 6)",type:4,required:false}] },
    { name:"choose",         description:"Choose between options 🤔",               dm_permission:true, options:[{name:"options",description:"Comma-separated options",type:3,required:true}] },
    { name:"8ball",          description:"Ask the magic 8 ball 🎱",                dm_permission:true, options:[{name:"question",description:"Your question",type:3,required:true}] },
    { name:"roast",          description:"Get roasted 🔥",                          dm_permission:true, options:uReq(false) },
    { name:"compliment",     description:"Give a compliment 💖",                    dm_permission:true, options:uReq() },
    { name:"ship",           description:"Ship two users 💘",                       dm_permission:true, options:[{name:"user1",description:"First user",type:6,required:true},{name:"user2",description:"Second user",type:6,required:true}] },
    { name:"topic",          description:"Random conversation starter 💬",          dm_permission:true },
    { name:"wouldyourather", description:"Would you rather 🤷",                     dm_permission:true },
    { name:"advice",         description:"Random life advice 🧙",                   dm_permission:true },
    { name:"fact",           description:"Random fun fact 📚",                      dm_permission:true },
    // Economy
    { name:"coins",       description:"Check your coin balance 💰",                 dm_permission:true, options:uReq(false) },
    { name:"slots",       description:"Spin the slot machine 🎰",                   dm_permission:true, options:[{name:"bet",description:"Coins to bet (default 10)",type:4,required:false}] },
    { name:"coinbet",     description:"Bet coins on a coin flip 🪙",                dm_permission:true, options:[{name:"bet",description:"Coins to bet",type:4,required:true},{name:"side",description:"heads or tails",type:3,required:true,choices:[{name:"Heads",value:"heads"},{name:"Tails",value:"tails"}]}] },
    { name:"blackjack",   description:"Play blackjack against the dealer 🃏",       dm_permission:true, options:[{name:"bet",description:"Coins to bet",type:4,required:true}] },
    { name:"givecoin",    description:"Give coins to another user 💸",              dm_permission:true, options:[{name:"user",description:"User to give to",type:6,required:true},{name:"amount",description:"Amount of coins",type:4,required:true}] },
    // Scores
    { name:"score",            description:"Check your game score 🏆",              dm_permission:true, options:uReq(false) },
    { name:"leaderboard",      description:"Global top 10 leaderboard 🌍",          dm_permission:true,
      options:[{name:"type",description:"Leaderboard type",type:3,required:false,choices:[
        {name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Current Streak",value:"streak"},
        {name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}
      ]}] },
    { name:"serverleaderboard",description:"This server's top 10 leaderboard 🏠",   dm_permission:false,
      options:[{name:"type",description:"Leaderboard type",type:3,required:false,choices:[
        {name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Current Streak",value:"streak"},
        {name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}
      ]}] },
    // Daily
    { name:"daily", description:"Complete today's daily challenge for bonus coins 📅", dm_permission:true },
    // Singleplayer games
    { name:"hangman",     description:"Play Hangman! 🪢",            dm_permission:true },
    { name:"snake",       description:"Play Snake! 🐍",               dm_permission:true },
    { name:"minesweeper", description:"Play Minesweeper! 💣",         dm_permission:true, options:[{name:"difficulty",description:"easy/medium/hard",type:3,required:false,choices:[{name:"Easy (5×5, 3 mines)",value:"easy"},{name:"Medium (7×7, 8 mines)",value:"medium"},{name:"Hard (9×9, 15 mines)",value:"hard"}]}] },
    { name:"numberguess", description:"Guess a number 1-100! 🔢",     dm_permission:true },
    { name:"wordscramble",description:"Unscramble the word! 🔀",      dm_permission:true },
    // 2-player games
    { name:"tictactoe",  description:"Tic Tac Toe ❌⭕",               dm_permission:true, options:[{name:"opponent",description:"Opponent",type:6,required:true}] },
    { name:"connect4",   description:"Connect 4 🔴🔵",                 dm_permission:true, options:[{name:"opponent",description:"Opponent",type:6,required:true}] },
    { name:"rps",        description:"Rock Paper Scissors ✊✋✌️",     dm_permission:true, options:[{name:"opponent",description:"Opponent",type:6,required:true}] },
    { name:"mathrace",   description:"Math Race 🧮",                   dm_permission:true, options:[{name:"opponent",description:"Opponent",type:6,required:true}] },
    { name:"wordrace",   description:"Word Race 🏁",                   dm_permission:true, options:[{name:"opponent",description:"Opponent",type:6,required:true}] },
    // Admin / owner
    { name:"channelpicker",  description:"Set announcement channel (Manage Server)", dm_permission:false, options:[{name:"channel",description:"Channel",type:7,required:true}] },
    { name:"servers",        description:"List servers with invites",                dm_permission:true },
    { name:"broadcast",      description:"Owner broadcast to all owners",            dm_permission:true, options:[{name:"message",description:"Message",type:3,required:true}] },
    { name:"fakecrash",      description:"Owner fake crash",                         dm_permission:true },
    { name:"identitycrisis", description:"Owner identity crisis DMs",                dm_permission:true },
    { name:"botolympics",    description:"Owner start Bot Olympics event",           dm_permission:true, options:[{name:"event",description:"Event",type:3,required:true,choices:OLYMPICS_EVENTS.map((e,i)=>({name:e.name,value:String(i)}))}] },
    { name:"sentience",      description:"Owner trigger sentience",                  dm_permission:true },
    { name:"legendrandom",   description:"Owner tell a legend in every server",      dm_permission:true },
    { name:"dmuser",         description:"Owner DM user",                            dm_permission:true, options:[{name:"user",description:"User",type:6,required:true},{name:"message",description:"Message",type:3,required:true}] },
    { name:"leaveserver",    description:"Owner leave server",                       dm_permission:true, options:[{name:"server",description:"Server",type:3,required:true,choices:getServerChoices()}] },
    { name:"restart",        description:"Owner restart bot",                        dm_permission:true },
    { name:"botstats",       description:"Owner bot stats",                          dm_permission:true },
    { name:"setstatus",      description:"Owner set status",                         dm_permission:true, options:[{name:"text",description:"Status text",type:3,required:true},{name:"type",description:"Type",type:3,required:false,choices:[{name:"Playing",value:"PLAYING"},{name:"Watching",value:"WATCHING"},{name:"Listening",value:"LISTENING"},{name:"Competing",value:"COMPETING"}]}] },
    // Owner stat editor
    { name:"adminuser", description:"Owner — edit a user's stats/coins", dm_permission:true,
      options:[
        { name:"user",    description:"Target user",    type:6, required:true },
        { name:"field",   description:"Stat to change", type:3, required:true, choices:[
          {name:"Coins",          value:"coins"},
          {name:"Wins",           value:"wins"},
          {name:"Games Played",   value:"gamesPlayed"},
          {name:"Daily Streak",   value:"dailyStreak"},
          {name:"Best Streak",    value:"bestStreak"},
        ]},
        { name:"value",   description:"New value (integer)", type:4, required:true },
      ]},
    { name:"adminreset", description:"Owner — reset ALL stats for a user", dm_permission:true,
      options:[{ name:"user", description:"Target user", type:6, required:true }] },
  ];
}

function registerCommands() {
  const data = JSON.stringify(buildCommands());
  const opts = { hostname:"discord.com", port:443, path:`/api/v10/applications/${CLIENT_ID}/commands`, method:"PUT", headers:{ Authorization:`Bot ${TOKEN}`, "Content-Type":"application/json", "Content-Length":Buffer.byteLength(data) } };
  const req = https.request(opts, res=>{ let body=""; res.on("data",c=>body+=c); res.on("end",()=>{ if(res.statusCode!==200)console.error(`Reg failed ${res.statusCode}`,body); else console.log("Commands registered"); }); });
  req.on("error",err=>console.error("Reg error:",err)); req.write(data); req.end();
}

function getUserAppInstalls() {
  return new Promise(resolve=>{
    const req=https.request({hostname:"discord.com",port:443,path:`/api/v10/applications/${CLIENT_ID}`,method:"GET",headers:{Authorization:`Bot ${TOKEN}`}},res=>{
      let body=""; res.on("data",c=>body+=c); res.on("end",()=>{try{const j=JSON.parse(body);resolve(j.approximate_user_install_count??"N/A");}catch{resolve("N/A");}});
    });
    req.on("error",()=>resolve("N/A")); req.end();
  });
}

// ── Bot events ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`Bot ready ${client.user.tag} [${INSTANCE_ID}]`);
  try {
    const owner = await client.users.fetch(OWNER_ID);
    await acquireInstanceLock(owner);
  } catch(e) {
    console.error("Could not acquire lock:", e);
    instanceLocked = true; // fail open
  }
  registerCommands();
});
client.on("guildCreate", registerCommands);
client.on("guildDelete", registerCommands);
client.on("shardDisconnect", (e,id)=>{ console.log(`Shard ${id} disconnected, code: ${e?.code}`); });

// ── Interaction handler ───────────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;
  if (!instanceLocked) return; // don't respond until lock is confirmed

  const cmd = interaction.commandName;
  const inGuild = !!interaction.guildId;

  const ownerOnly = ["servers","broadcast","fakecrash","identitycrisis","botolympics","sentience","legendrandom","dmuser","leaveserver","restart","botstats","setstatus","adminuser","adminreset"];
  if (ownerOnly.includes(cmd) && interaction.user.id !== OWNER_ID)
    return safeReply(interaction, { content:"Owner only", ephemeral:true });

  try {
    // ── Basic ──────────────────────────────────────────────────────────────
    if (cmd === "ping") return safeReply(interaction, `🏓 Pong! Latency: **${client.ws.ping}ms**`);
    if (cmd === "avatar") {
      const u=await client.users.fetch(interaction.options.getUser("user").id);
      return safeReply(interaction, u.displayAvatarURL({size:1024,dynamic:true}));
    }

    const au = () => `<@${interaction.user.id}>`;
    const bu = () => `<@${interaction.options.getUser("user").id}>`;

    if (cmd === "punch")    return safeReply(interaction, `${au()} punched ${bu()}`);
    if (cmd === "hug")      return safeReply(interaction, `${au()} hugged ${bu()}`);
    if (cmd === "kiss")     return safeReply(interaction, `${au()} kissed ${bu()}`);
    if (cmd === "slap")     return safeReply(interaction, `${au()} slapped ${bu()}`);
    if (cmd === "diddle")   return safeReply(interaction, `${bu()} was diddled`);
    if (cmd === "oil")      return safeReply(interaction, `${au()} oiled up ${bu()}`);
    if (cmd === "highfive") return safeReply(interaction, `${au()} high fived ${bu()}! ✋🤚`);
    if (cmd === "boop")     return safeReply(interaction, `${au()} booped ${bu()} on the nose 👉👃`);
    if (cmd === "wave")     return safeReply(interaction, `${au()} waved at ${bu()}! 👋`);
    if (cmd === "stare")    return safeReply(interaction, `${au()} is staring at ${bu()} 👀`);
    if (cmd === "poke")     return safeReply(interaction, `${au()} poked ${bu()} 👉`);
    if (cmd === "pat")      return safeReply(interaction, `${au()} patted ${bu()} on the head 🖐️`);
    if (cmd === "throw")    return safeReply(interaction, `${au()} threw ${pick(THROW_ITEMS)} at ${bu()}!`);

    if (cmd === "ppsize")      { const s=`8${"=".repeat(r(3,30))}D`; return safeReply(interaction, `${bu()}'s pp: ${s}`); }
    if (cmd === "gayrate")     { const u=interaction.options.getUser("user"); return safeReply(interaction, `<@${u.id}> is ${GAY_IDS.includes(u.id)?100:r(0,100)}% gay`); }
    if (cmd === "iq")          return safeReply(interaction, `${bu()}'s IQ is ${r(60,180)}`);
    if (cmd === "sus")         return safeReply(interaction, `${bu()} is ${r(0,100)}% sus`);
    if (cmd === "howautistic") { const u=interaction.options.getUser("user"); return safeReply(interaction, `<@${u.id}> is ${GAY_IDS.includes(u.id)?100:r(0,100)}% autistic`); }
    if (cmd === "simp")        return safeReply(interaction, `${bu()} is ${r(0,100)}% a simp 💘`);
    if (cmd === "cursed")      return safeReply(interaction, `${bu()} has ${r(0,100)}% cursed energy 🌀`);
    if (cmd === "rizz")        return safeReply(interaction, `${bu()}'s rizz level: ${r(0,100)}/100 😎`);
    if (cmd === "npc")         return safeReply(interaction, `${bu()} is ${r(0,100)}% NPC 🤖`);
    if (cmd === "villain")     return safeReply(interaction, `${bu()}'s villain arc is ${r(0,100)}% complete 😈`);
    if (cmd === "sigma")       return safeReply(interaction, `${bu()}'s sigma rating: ${r(0,100)}/100 💪`);

    if (cmd === "cat")   { await interaction.deferReply(); return safeReply(interaction, await getCatGif()    || "Couldn't fetch a cat 😿"); }
    if (cmd === "dog")   { await interaction.deferReply(); return safeReply(interaction, await getDogImage()  || "Couldn't fetch a dog 🐶"); }
    if (cmd === "fox")   { await interaction.deferReply(); return safeReply(interaction, await getFoxImage()  || "Couldn't fetch a fox 🦊"); }
    if (cmd === "panda") { await interaction.deferReply(); return safeReply(interaction, await getPandaImage()|| "Couldn't fetch a panda 🐼"); }
    if (cmd === "joke")  { await interaction.deferReply(); return safeReply(interaction, await getJoke()      || "No joke today."); }
    if (cmd === "meme")  { await interaction.deferReply(); return safeReply(interaction, await getMeme()      || "Meme API down 😔"); }
    if (cmd === "quote") { await interaction.deferReply(); return safeReply(interaction, await getQuote()     || "The wise are silent today."); }
    if (cmd === "trivia") {
      await interaction.deferReply(); const t=await getTrivia();
      if(!t) return safeReply(interaction,"Trivia API is down.");
      return safeReply(interaction,`**${t.question}**\n\n${t.answers.map((a,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${a}`).join("\n")}\n\n||✅ Answer: ${t.correct}||`);
    }

    if (cmd === "coinflip")       return safeReply(interaction, `🪙 **${Math.random()<0.5?"Heads":"Tails"}!**`);
    if (cmd === "roll")           { const sides=interaction.options.getInteger("sides")||6; if(sides<2)return safeReply(interaction,{content:"Need at least 2 sides.",ephemeral:true}); return safeReply(interaction,`🎲 You rolled **${r(1,sides)}** on a d${sides}!`); }
    if (cmd === "choose")         { const opts=interaction.options.getString("options").split(",").map(s=>s.trim()).filter(Boolean); if(opts.length<2)return safeReply(interaction,{content:"Give at least 2 options.",ephemeral:true}); return safeReply(interaction,`🤔 I choose... **${pick(opts)}**`); }
    if (cmd === "8ball")          return safeReply(interaction,`🎱 **${interaction.options.getString("question")}**\n\n${pick(EIGHT_BALL)}`);
    if (cmd === "roast")          { const u=interaction.options.getUser("user"); return safeReply(interaction,`🔥 ${u?`<@${u.id}>`:`<@${interaction.user.id}>`}: ${pick(ROASTS)}`); }
    if (cmd === "compliment")     return safeReply(interaction,`💖 ${bu()}: ${pick(COMPLIMENTS)}`);
    if (cmd === "ship")           { const u1=interaction.options.getUser("user1"),u2=interaction.options.getUser("user2"),pct=r(0,100),bar="█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10)); return safeReply(interaction,`💘 **${u1.username}** + **${u2.username}**\n\n${bar} **${pct}%**\n\n${pct>=80?"Soulmates 💕":pct>=50?"There's potential 👀":pct>=30?"It's complicated 😬":"Maybe just friends 😅"}`); }
    if (cmd === "topic")          return safeReply(interaction,`💬 ${pick(TOPICS)}`);
    if (cmd === "wouldyourather") return safeReply(interaction,`🤷 ${pick(WYR)}`);
    if (cmd === "advice")         return safeReply(interaction,`🧙 ${pick(ADVICE)}`);
    if (cmd === "fact")           return safeReply(interaction,`📚 ${pick(FACTS)}`);

    // ── Economy ────────────────────────────────────────────────────────────
    if (cmd === "coins") {
      const u = interaction.options.getUser("user") || interaction.user;
      const s = getScore(u.id, u.username);
      return safeReply(interaction, `💰 **${u.username}** has **${s.coins}** coins.`);
    }

    if (cmd === "givecoin") {
      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      if (target.id === interaction.user.id) return safeReply(interaction, { content:"You can't give coins to yourself.", ephemeral:true });
      if (amount <= 0) return safeReply(interaction, { content:"Amount must be positive.", ephemeral:true });
      const giver = getScore(interaction.user.id, interaction.user.username);
      if (giver.coins < amount) return safeReply(interaction, { content:`You only have **${giver.coins}** coins.`, ephemeral:true });
      giver.coins -= amount;
      getScore(target.id, target.username).coins += amount;
      return safeReply(interaction, `💸 <@${interaction.user.id}> gave **${amount}** coins to <@${target.id}>!`);
    }

    if (cmd === "slots") {
      const bet = interaction.options.getInteger("bet") || 10;
      if (bet < 1) return safeReply(interaction, { content:"Minimum bet is 1 coin.", ephemeral:true });
      const s = getScore(interaction.user.id, interaction.user.username);
      if (s.coins < bet) return safeReply(interaction, { content:`You only have **${s.coins}** coins.`, ephemeral:true });
      const reels = spinSlots();
      const { mult, label } = slotPayout(reels, bet);
      const winnings = Math.floor(bet * mult);
      s.coins = s.coins - bet + winnings;
      const diff = winnings - bet;
      return safeReply(interaction,
        `🎰 | ${reels.join(" | ")} |\n\n**${label}**\n` +
        (mult >= 1 ? `✅ You won **${winnings}** coins! (+${diff})` : `❌ You lost **${bet}** coins.`) +
        `\n💰 Balance: **${s.coins}** coins`
      );
    }

    if (cmd === "coinbet") {
      const bet  = interaction.options.getInteger("bet");
      const side = interaction.options.getString("side");
      if (bet < 1) return safeReply(interaction, { content:"Minimum bet is 1 coin.", ephemeral:true });
      const s = getScore(interaction.user.id, interaction.user.username);
      if (s.coins < bet) return safeReply(interaction, { content:`You only have **${s.coins}** coins.`, ephemeral:true });
      const result = Math.random() < 0.5 ? "heads" : "tails";
      const won = result === side;
      s.coins += won ? bet : -bet;
      return safeReply(interaction,
        `🪙 Flipped: **${result.charAt(0).toUpperCase()+result.slice(1)}**\n` +
        (won ? `✅ You won **${bet}** coins!` : `❌ You lost **${bet}** coins.`) +
        `\n💰 Balance: **${s.coins}** coins`
      );
    }

    if (cmd === "blackjack") {
      const cid = interaction.channelId;
      if (activeGames.has(cid)) return safeReply(interaction, { content:"A game is already running in this channel!", ephemeral:true });
      const bet = interaction.options.getInteger("bet");
      if (bet < 1) return safeReply(interaction, { content:"Minimum bet is 1 coin.", ephemeral:true });
      const playerScore = getScore(interaction.user.id, interaction.user.username);
      if (playerScore.coins < bet) return safeReply(interaction, { content:`You only have **${playerScore.coins}** coins.`, ephemeral:true });

      const deck = newDeck();
      const playerHand = [deck.pop(), deck.pop()];
      const dealerHand = [deck.pop(), deck.pop()];
      activeGames.set(cid, { type:"blackjack" });

      const showBoard = (hideDealer=true) =>
        `🃏 **Blackjack** (bet: ${bet} coins)\n\n` +
        `**Your hand:** ${renderHand(playerHand)} — **${handValue(playerHand)}**\n` +
        `**Dealer:** ${renderHand(dealerHand, hideDealer)}${hideDealer?"":" — **"+handValue(dealerHand)+"**"}\n\n` +
        (hideDealer ? "Type **hit** or **stand**" : "");

      // Check natural blackjack
      if (handValue(playerHand) === 21) {
        activeGames.delete(cid);
        const reward = Math.floor(bet * 1.5);
        playerScore.coins += reward;
        // track win stat without adding coins again (coins handled above)
        const _s = getScore(interaction.user.id, interaction.user.username);
        _s.wins++; _s.gamesPlayed++;
        return safeReply(interaction, showBoard(false) + `\n🎉 **Blackjack!** You win **${reward}** coins!\n💰 Balance: **${playerScore.coins}**`);
      }

      await safeReply(interaction, showBoard(true));
      const targetCh = getTargetChannel(interaction);

      const collector = targetCh.createMessageCollector({
        filter: m => m.author.id===interaction.user.id && ["hit","stand"].includes(m.content.trim().toLowerCase()),
        idle: 60*1000
      });

      collector.on("collect", async m => {
        const action = m.content.trim().toLowerCase();
        if (action === "hit") {
          playerHand.push(deck.pop());
          const pv = handValue(playerHand);
          if (pv > 21) {
            collector.stop("bust");
            activeGames.delete(cid);
            playerScore.coins -= bet;
            recordLoss(interaction.user.id, interaction.user.username);
            await m.reply(`${showBoard(false)}\n💥 **Bust!** You went over 21 and lost **${bet}** coins.\n💰 Balance: **${playerScore.coins}**`);
          } else if (pv === 21) {
            collector.stop("21");
            while (handValue(dealerHand) < 17) dealerHand.push(deck.pop());
            const dv = handValue(dealerHand);
            let msg;
            if (dv > 21 || pv > dv) {
              playerScore.coins += bet;
              recordWin(interaction.user.id, interaction.user.username, 0);
              msg = `✅ You win **${bet}** coins!`;
            } else if (pv === dv) {
              recordDraw(interaction.user.id, interaction.user.username);
              msg = `🤝 Push! No coins lost.`;
            } else {
              playerScore.coins -= bet;
              recordLoss(interaction.user.id, interaction.user.username);
              msg = `❌ Dealer wins. You lost **${bet}** coins.`;
            }
            activeGames.delete(cid);
            await m.reply(`${showBoard(false)}\n${msg}\n💰 Balance: **${playerScore.coins}**`);
          } else {
            await m.reply(showBoard(true));
          }
        } else { // stand
          collector.stop("stand");
          while (handValue(dealerHand) < 17) dealerHand.push(deck.pop());
          const pv=handValue(playerHand), dv=handValue(dealerHand);
          let msg;
          if (dv > 21 || pv > dv) {
            playerScore.coins += bet;
            recordWin(interaction.user.id, interaction.user.username, 0);
            msg = `✅ You win **${bet}** coins!`;
          } else if (pv === dv) {
            recordDraw(interaction.user.id, interaction.user.username);
            msg = `🤝 Push! No coins lost.`;
          } else {
            playerScore.coins -= bet;
            recordLoss(interaction.user.id, interaction.user.username);
            msg = `❌ Dealer wins. You lost **${bet}** coins.`;
          }
          activeGames.delete(cid);
          await m.reply(`${showBoard(false)}\n${msg}\n💰 Balance: **${playerScore.coins}**`);
        }
      });

      collector.on("end", (_,reason) => {
        if (reason==="idle") {
          activeGames.delete(cid);
          playerScore.coins -= bet;
          recordLoss(interaction.user.id, interaction.user.username);
          safeSend(targetCh, `⏰ Blackjack timed out! You forfeited **${bet}** coins.\n💰 Balance: **${playerScore.coins}**`);
        }
      });
      return;
    }

    // ── Scores & Leaderboard ───────────────────────────────────────────────
    if (cmd === "score") {
      const u = interaction.options.getUser("user") || interaction.user;
      const s = getScore(u.id, u.username);
      const wr = s.gamesPlayed > 0 ? Math.round(s.wins / s.gamesPlayed * 100) : 0;
      return safeReply(interaction,
        `🏆 **${u.username}'s Stats**\n` +
        `🎮 Games Played: **${s.gamesPlayed}** | Wins: **${s.wins}** | Win Rate: **${wr}%**\n` +
        `💰 Coins: **${s.coins}**\n` +
        `🔥 Daily Streak: **${s.dailyStreak}** day(s) | Best Streak: **${s.bestStreak}**`
      );
    }

    if (cmd === "leaderboard") {
      const type = interaction.options.getString("type") || "wins";
      const entries = [...scores.entries()];
      if (!entries.length) return safeReply(interaction, "No scores recorded yet! Play some games.");

      let sorted, title, fmt;
      if (type === "coins") {
        sorted = [...entries].sort(([,a],[,b]) => b.coins - a.coins);
        title = "🌍 Global Leaderboard — Coins 💰";
        fmt = ([,s]) => `${s.coins} coins`;
      } else if (type === "streak") {
        sorted = [...entries].sort(([,a],[,b]) => b.dailyStreak - a.dailyStreak);
        title = "🌍 Global Leaderboard — Daily Streak 🔥";
        fmt = ([,s]) => `${s.dailyStreak} day streak (best: ${s.bestStreak})`;
      } else if (type === "games") {
        sorted = [...entries].sort(([,a],[,b]) => b.gamesPlayed - a.gamesPlayed);
        title = "🌍 Global Leaderboard — Games Played 🎮";
        fmt = ([,s]) => `${s.gamesPlayed} games`;
      } else if (type === "winrate") {
        sorted = entries.filter(([,s])=>s.gamesPlayed>=5).sort(([,a],[,b]) => (b.wins/b.gamesPlayed) - (a.wins/a.gamesPlayed));
        title = "🌍 Global Leaderboard — Win Rate % (min 5 games)";
        fmt = ([,s]) => `${Math.round(s.wins/s.gamesPlayed*100)}% (${s.wins}W/${s.gamesPlayed})`;
      } else if (type === "beststreak") {
        sorted = [...entries].sort(([,a],[,b]) => b.bestStreak - a.bestStreak);
        title = "🌍 Global Leaderboard — Best Streak Ever 🏅";
        fmt = ([,s]) => `${s.bestStreak} day best streak`;
      } else {
        // default: wins
        sorted = [...entries].sort(([,a],[,b]) => b.wins - a.wins);
        title = "🌍 Global Leaderboard — Wins";
        fmt = ([,s]) => `${s.wins} wins (${s.gamesPlayed} played)`;
      }

      const medals = ["🥇","🥈","🥉"];
      const top = sorted.slice(0, 10);
      if (!top.length) return safeReply(interaction, "Not enough data for this leaderboard yet.");
      const lines = top.map((e,i) => `${medals[i]||`${i+1}.`} **${e[1].username}** — ${fmt(e)}`);
      return safeReply(interaction, `**${title}**\n\n${lines.join("\n")}`);
    }

    if (cmd === "serverleaderboard") {
      if (!inGuild) return safeReply(interaction, { content:"Servers only.", ephemeral:true });
      await interaction.guild.members.fetch();
      const memberIds = new Set(interaction.guild.members.cache.filter(m=>!m.user.bot).map(m=>m.id));
      const type = interaction.options.getString("type") || "wins";
      const entries = [...scores.entries()].filter(([id]) => memberIds.has(id));
      if (!entries.length) return safeReply(interaction, "No scores in this server yet! Play some games.");

      let sorted, title, fmt;
      if (type === "coins") {
        sorted = [...entries].sort(([,a],[,b]) => b.coins - a.coins);
        title = `🏠 ${interaction.guild.name} — Coins 💰`;
        fmt = ([,s]) => `${s.coins} coins`;
      } else if (type === "streak") {
        sorted = [...entries].sort(([,a],[,b]) => b.dailyStreak - a.dailyStreak);
        title = `🏠 ${interaction.guild.name} — Daily Streak 🔥`;
        fmt = ([,s]) => `${s.dailyStreak} day streak (best: ${s.bestStreak})`;
      } else if (type === "games") {
        sorted = [...entries].sort(([,a],[,b]) => b.gamesPlayed - a.gamesPlayed);
        title = `🏠 ${interaction.guild.name} — Games Played 🎮`;
        fmt = ([,s]) => `${s.gamesPlayed} games`;
      } else if (type === "winrate") {
        sorted = entries.filter(([,s])=>s.gamesPlayed>=5).sort(([,a],[,b]) => (b.wins/b.gamesPlayed) - (a.wins/a.gamesPlayed));
        title = `🏠 ${interaction.guild.name} — Win Rate % (min 5 games)`;
        fmt = ([,s]) => `${Math.round(s.wins/s.gamesPlayed*100)}% (${s.wins}W/${s.gamesPlayed})`;
      } else if (type === "beststreak") {
        sorted = [...entries].sort(([,a],[,b]) => b.bestStreak - a.bestStreak);
        title = `🏠 ${interaction.guild.name} — Best Streak Ever 🏅`;
        fmt = ([,s]) => `${s.bestStreak} day best streak`;
      } else {
        // default: wins
        sorted = [...entries].sort(([,a],[,b]) => b.wins - a.wins);
        title = `🏠 ${interaction.guild.name} — Wins`;
        fmt = ([,s]) => `${s.wins} wins (${s.gamesPlayed} played)`;
      }

      const medals = ["🥇","🥈","🥉"];
      const top = sorted.slice(0, 10);
      if (!top.length) return safeReply(interaction, "Not enough data for this leaderboard yet.");
      const lines = top.map((e,i) => `${medals[i]||`${i+1}.`} **${e[1].username}** — ${fmt(e)}`);
      return safeReply(interaction, `**${title}**\n\n${lines.join("\n")}`);
    }

    // ── Daily challenge ────────────────────────────────────────────────────
    if (cmd === "daily") {
      const uid = interaction.user.id;
      if (dailyCompletions.has(uid)) {
        const tomorrow = new Date(); tomorrow.setUTCHours(24,0,0,0);
        const hoursLeft = Math.ceil((tomorrow-Date.now())/3600000);
        const s = getScore(uid, interaction.user.username);
        return safeReply(interaction, `✅ You already completed today's challenge! Resets in **${hoursLeft}h**.\n🔥 Current streak: **${s.dailyStreak}** day(s)`);
      }
      const challenge = getDailyChallenge();
      const targetCh = getTargetChannel(interaction);
      await safeReply(interaction, `📅 **Daily Challenge!**\n\n${challenge.desc}\n\nYou have **60 seconds**!${challenge.choices?"\n\n"+challenge.choices.map((c,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${c}`).join("\n"):""}`);

      const collector = targetCh.createMessageCollector({
        filter: m => m.author.id===uid,
        idle: 60*1000
      });
      collector.on("collect", async m => {
        if (m.content.trim().toLowerCase() === challenge.answer.toLowerCase()) {
          collector.stop("won");
          dailyCompletions.add(uid);
          const s = recordDaily(uid, interaction.user.username);
          const streakBonus = (s.dailyStreak - 1) * 10;
          const totalEarned = 100 + streakBonus;
          await m.reply(
            `🎉 **Correct!** Daily challenge complete!\n` +
            `💰 +${totalEarned} coins (100 base${streakBonus>0?` + ${streakBonus} streak bonus`:""})\n` +
            `🔥 Streak: **${s.dailyStreak}** day(s)${s.dailyStreak===s.bestStreak&&s.dailyStreak>1?" 🏆 New best!":""}\n` +
            `💰 Balance: **${s.coins}** coins`
          );
        } else {
          await m.reply(`❌ Not quite! Keep trying...`);
        }
      });
      collector.on("end", (_,reason) => {
        if (reason==="idle") safeSend(targetCh, `⏰ Daily challenge timed out! The answer was **${challenge.answer}**.`);
      });
      return;
    }

    // ── SINGLEPLAYER 1: Hangman ────────────────────────────────────────────
    if (cmd === "hangman") {
      const cid = interaction.channelId;
      if (activeGames.has(cid)) return safeReply(interaction, { content:"A game is already running in this channel!", ephemeral:true });
      const word = pick(HANGMAN_WORDS);
      const game = { type:"hangman", word, guessed:new Set() };
      activeGames.set(cid, game);
      const targetCh = getTargetChannel(interaction);
      await safeReply(interaction, `🪢 **Hangman started!** Guess one letter at a time by typing it in chat.\n\n${renderHangman(word, game.guessed)}`);
      const collector = targetCh.createMessageCollector({
        filter: m => m.author.id===interaction.user.id && /^[a-zA-Z]$/.test(m.content.trim()),
        idle: 2*60*1000
      });
      collector.on("collect", async m => {
        const letter=m.content.trim().toLowerCase();
        if (game.guessed.has(letter)) { await m.reply(`You already guessed **${letter}**!`); return; }
        game.guessed.add(letter);
        const wrong=[...game.guessed].filter(l=>!word.includes(l));
        const won=!word.split("").some(l=>!game.guessed.has(l));
        if (won) {
          collector.stop("won"); activeGames.delete(cid);
          recordWin(interaction.user.id, interaction.user.username, 40);
          await m.reply(`✅ You got it! The word was **${word}**! 🎉 (+40 coins)\n\n${renderHangman(word, game.guessed)}`);
        } else if (wrong.length>=6) {
          collector.stop("lost"); activeGames.delete(cid);
          recordLoss(interaction.user.id, interaction.user.username);
          await m.reply(`💀 Game over! The word was **${word}**.\n\n${renderHangman(word, new Set([...game.guessed,...word.split("")]))}`);
        } else {
          await m.reply(renderHangman(word, game.guessed));
        }
      });
      collector.on("end", (_,reason) => { if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,`⏰ Hangman timed out! The word was **${word}**.`);} });
      return;
    }

    // ── SINGLEPLAYER 2: Snake ──────────────────────────────────────────────
    if (cmd === "snake") {
      const cid = interaction.channelId;
      if (activeGames.has(cid)) return safeReply(interaction, { content:"A game is already running in this channel!", ephemeral:true });
      const game = { type:"snake", snake:[{x:3,y:3}], food:{x:5,y:2}, size:7, score:0 };
      activeGames.set(cid, game);
      await safeReply(interaction, `🐍 **Snake!** React with arrows to move.\n\n${renderSnake(game)}`);
      const msg = await interaction.fetchReply();
      for (const e of ["⬆️","⬇️","⬅️","➡️"]) await msg.react(e).catch(()=>{});
      const collector = msg.createReactionCollector({
        filter: (re,u) => ["⬆️","⬇️","⬅️","➡️"].includes(re.emoji.name) && u.id===interaction.user.id && !u.bot,
        idle: 3*60*1000
      });
      collector.on("collect", async (re,u) => {
        try { await re.users.remove(u.id); } catch {}
        const result=moveSnake(game,re.emoji.name);
        if (result!=="ok") {
          collector.stop("dead"); activeGames.delete(cid);
          const coins = game.score * 5;
          if (game.score > 0) { getScore(interaction.user.id,interaction.user.username).coins += coins; }
          recordLoss(interaction.user.id, interaction.user.username);
          await msg.edit(`💀 **Game Over!** Final score: **${game.score}**${coins>0?` (+${coins} coins)`:""}\n\n${renderSnake(game)}`);
          return;
        }
        await msg.edit(`🐍 **Snake** | Score: ${game.score}\n\n${renderSnake(game)}`);
      });
      collector.on("end", (_,reason) => { if(reason==="idle"){activeGames.delete(cid);msg.edit(`⏰ Snake ended due to inactivity! Final score: **${game.score}**`).catch(()=>{});} });
      return;
    }

    // ── SINGLEPLAYER 3: Minesweeper ────────────────────────────────────────
    if (cmd === "minesweeper") {
      const configs={easy:[5,5,3],medium:[7,7,8],hard:[9,9,15]};
      const [rows,cols,mines]=configs[interaction.options.getString("difficulty")||"easy"];
      const game=initMinesweeper(rows,cols,mines);
      const cid=interaction.channelId;
      activeGames.set(cid,{type:"minesweeper"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`💣 **Minesweeper** — Type \`col row\` to reveal (e.g. \`3 2\`). Type \`f col row\` to flag.\n\n${renderMinesweeper(game)}`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id,idle:5*60*1000});
      collector.on("collect",async m=>{
        const parts=m.content.trim().split(/\s+/);
        let flag=false,c,row;
        if(parts[0].toLowerCase()==="f"){flag=true;c=parseInt(parts[1])-1;row=parseInt(parts[2])-1;}
        else{c=parseInt(parts[0])-1;row=parseInt(parts[1])-1;}
        if(isNaN(row)||isNaN(c)||row<0||row>=game.rows||c<0||c>=game.cols)return;
        if(flag){const idx=row*game.cols+c;if(!game.revealed[idx])game.flagged[idx]=!game.flagged[idx];await m.reply(renderMinesweeper(game));return;}
        const idx=row*game.cols+c;
        if(game.mines[idx]){collector.stop("boom");activeGames.delete(cid);recordLoss(interaction.user.id,interaction.user.username);await m.reply(`💥 **BOOM!**\n\n${renderMinesweeper(game,true)}`);return;}
        revealMinesweeper(game,row,c);
        if(game.revealed.filter((v,i)=>!v&&!game.mines[i]).length===0){
          collector.stop("won");activeGames.delete(cid);
          const coinMap={easy:30,medium:60,hard:100};
          const reward=coinMap[interaction.options.getString("difficulty")||"easy"];
          recordWin(interaction.user.id,interaction.user.username,reward);
          await m.reply(`🎉 **You win!** +${reward} coins\n\n${renderMinesweeper(game,true)}`);return;
        }
        await m.reply(renderMinesweeper(game));
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,"⏰ Minesweeper ended due to inactivity!");}});
      return;
    }

    // ── SINGLEPLAYER 4: Number Guess ──────────────────────────────────────
    if (cmd === "numberguess") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const target=r(1,100); let attempts=0;
      activeGames.set(cid,{type:"numberguess"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🔢 **Number Guess!** I'm thinking of a number between **1** and **100**. You have 10 attempts!`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id&&!isNaN(m.content.trim()),idle:2*60*1000});
      collector.on("collect",async m=>{
        const guess=parseInt(m.content.trim()); attempts++;
        if(guess===target){
          collector.stop("won");activeGames.delete(cid);
          recordWin(interaction.user.id,interaction.user.username,30);
          await m.reply(`🎉 **Correct!** The number was **${target}**! Got it in **${attempts}** attempt(s)! (+30 coins)`);
        }else if(attempts>=10){
          collector.stop("lost");activeGames.delete(cid);recordLoss(interaction.user.id,interaction.user.username);
          await m.reply(`💀 Out of attempts! The number was **${target}**.`);
        }else{
          await m.reply(guess<target?`📈 Too low! ${10-attempts} left.`:`📉 Too high! ${10-attempts} left.`);
        }
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,`⏰ Timed out! The number was **${target}**.`);}});
      return;
    }

    // ── SINGLEPLAYER 5: Word Scramble ──────────────────────────────────────
    if (cmd === "wordscramble") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
      activeGames.set(cid,{type:"wordscramble"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🔀 **Word Scramble!** Unscramble: **\`${scrambled}\`**`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id,idle:60*1000});
      collector.on("collect",async m=>{
        if(m.content.trim().toLowerCase()===word){
          collector.stop("won");activeGames.delete(cid);
          recordWin(interaction.user.id,interaction.user.username,25);
          await m.reply(`🎉 **Correct!** The word was **${word}**! (+25 coins)`);
        }else{await m.reply(`❌ Not quite! Keep trying...`);}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,`⏰ Timed out! The word was **${word}**.`);}});
      return;
    }

    // ── 2-PLAYER 1: Tic Tac Toe ───────────────────────────────────────────
    if (cmd === "tictactoe") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const game={type:"ttt",board:Array(9).fill(null),players:[interaction.user.id,opp.id],turn:0};
      activeGames.set(cid,game);
      const targetCh=getTargetChannel(interaction);
      const boardMsg=()=>`❌⭕ **Tic Tac Toe**\n<@${game.players[0]}> ❌ vs <@${game.players[1]}> ⭕\n\n${renderTTT(game.board)}\n\nIt's <@${game.players[game.turn]}>'s turn! Type **1-9**:\n\`\`\`\n1 2 3\n4 5 6\n7 8 9\`\`\``;
      await safeReply(interaction,boardMsg());
      const collector=targetCh.createMessageCollector({filter:m=>game.players.includes(m.author.id)&&/^[1-9]$/.test(m.content.trim()),idle:5*60*1000});
      collector.on("collect",async m=>{
        if(m.author.id!==game.players[game.turn]){await m.reply("It's not your turn!");return;}
        const pos=parseInt(m.content.trim())-1;
        if(game.board[pos]){await m.reply("That spot is taken!");return;}
        game.board[pos]=game.turn===0?"X":"O";
        const result=checkTTTWin(game.board);
        if(result){
          collector.stop("done");activeGames.delete(cid);
          if(result==="draw"){
            recordDraw(game.players[0],null);recordDraw(game.players[1],null);
            await m.reply(`🤝 **Draw!**\n\n${renderTTT(game.board)}`);
          }else{
            recordWin(game.players[game.turn],m.author.username,50);
            recordLoss(game.players[1-game.turn],null);
            await m.reply(`🎉 <@${game.players[game.turn]}> wins! (+50 coins)\n\n${renderTTT(game.board)}`);
          }
        }else{game.turn=1-game.turn;await m.reply(boardMsg());}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,"⏰ Tic Tac Toe ended due to inactivity!");}});
      return;
    }

    // ── 2-PLAYER 2: Connect 4 ─────────────────────────────────────────────
    if (cmd === "connect4") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const game={type:"c4",board:Array(42).fill(0),players:[interaction.user.id,opp.id],turn:0};
      activeGames.set(cid,game);
      const targetCh=getTargetChannel(interaction);
      const boardMsg=()=>`🔴🔵 **Connect 4**\n<@${game.players[0]}> 🔴 vs <@${game.players[1]}> 🔵\n\n${renderConnect4(game.board)}\n<@${game.players[game.turn]}>'s turn — type column **1-7**`;
      await safeReply(interaction,boardMsg());
      const collector=targetCh.createMessageCollector({filter:m=>game.players.includes(m.author.id)&&/^[1-7]$/.test(m.content.trim()),idle:5*60*1000});
      collector.on("collect",async m=>{
        if(m.author.id!==game.players[game.turn]){await m.reply("Not your turn!");return;}
        const col=parseInt(m.content.trim())-1,row=dropConnect4(game.board,col,game.turn+1);
        if(row===-1){await m.reply("That column is full!");return;}
        if(checkConnect4Win(game.board,game.turn+1)){
          collector.stop("done");activeGames.delete(cid);
          recordWin(game.players[game.turn],m.author.username,50);
          recordLoss(game.players[1-game.turn],null);
          await m.reply(`🎉 <@${game.players[game.turn]}> wins! (+50 coins)\n\n${renderConnect4(game.board)}`);
        }else if(!game.board.includes(0)){
          collector.stop("draw");activeGames.delete(cid);
          recordDraw(game.players[0],null);recordDraw(game.players[1],null);
          await m.reply(`🤝 **Draw!**\n\n${renderConnect4(game.board)}`);
        }else{game.turn=1-game.turn;await m.reply(boardMsg());}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,"⏰ Connect 4 ended due to inactivity!");}});
      return;
    }

    // ── 2-PLAYER 3: Rock Paper Scissors ──────────────────────────────────
    if (cmd === "rps") {
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const emojis={"✊":"Rock","✋":"Paper","✌️":"Scissors"},beats={"✊":"✌️","✋":"✊","✌️":"✋"};
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`✊✋✌️ **Rock Paper Scissors!**\n<@${interaction.user.id}> vs <@${opp.id}>\n\nBoth players check your DMs!`);
      async function getChoice(user){
        try{
          const dm=await user.createDM(),m=await dm.send(`Choose your move for RPS! React: ✊ ✋ ✌️`);
          for(const e of["✊","✋","✌️"])await m.react(e);
          const col=await m.awaitReactions({filter:(re,u)=>["✊","✋","✌️"].includes(re.emoji.name)&&u.id===user.id&&!u.bot,max:1,time:30000,errors:["time"]});
          return col.first().emoji.name;
        }catch{return null;}
      }
      const [c1,c2]=await Promise.all([getChoice(interaction.user),getChoice(opp)]);
      if(!c1||!c2)return safeSend(targetCh,"⏰ Someone didn't respond in time! Game cancelled.");
      let resultMsg;
      if(c1===c2){recordDraw(interaction.user.id,interaction.user.username);recordDraw(opp.id,opp.username);resultMsg=`🤝 **Draw!** Both chose ${emojis[c1]}`;}
      else if(beats[c1]===c2){recordWin(interaction.user.id,interaction.user.username,40);recordLoss(opp.id,opp.username);resultMsg=`🎉 <@${interaction.user.id}> wins! ${emojis[c1]} beats ${emojis[c2]} (+40 coins)`;}
      else{recordWin(opp.id,opp.username,40);recordLoss(interaction.user.id,interaction.user.username);resultMsg=`🎉 <@${opp.id}> wins! ${emojis[c2]} beats ${emojis[c1]} (+40 coins)`;}
      return safeSend(targetCh,`✊✋✌️ **Results!**\n<@${interaction.user.id}>: ${emojis[c1]}\n<@${opp.id}>: ${emojis[c2]}\n\n${resultMsg}`);
    }

    // ── 2-PLAYER 4: Math Race ─────────────────────────────────────────────
    if (cmd === "mathrace") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const av=r(2,12),bv=r(2,12),answer=String(av*bv);
      activeGames.set(cid,{type:"mathrace"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🧮 **Math Race!**\n<@${interaction.user.id}> vs <@${opp.id}>\n\n**What is ${av} × ${bv}?**`);
      try{
        const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim()===answer,max:1,time:30000,errors:["time"]});
        activeGames.delete(cid);
        const winner=col.first().author, loser=winner.id===interaction.user.id?opp:interaction.user;
        recordWin(winner.id,winner.username,40); recordLoss(loser.id,loser.username);
        await col.first().reply(`🎉 **${winner.username} wins the Math Race!** The answer was **${answer}**! (+40 coins)`);
      }catch{activeGames.delete(cid);await safeSend(targetCh,`⏰ Time's up! The answer was **${answer}**.`);}
      return;
    }

    // ── 2-PLAYER 5: Word Race ─────────────────────────────────────────────
    if (cmd === "wordrace") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
      activeGames.set(cid,{type:"wordrace"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🏁 **Word Race!**\n<@${interaction.user.id}> vs <@${opp.id}>\n\nFirst to unscramble wins!\n\n**\`${scrambled}\`**`);
      try{
        const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===word,max:1,time:60000,errors:["time"]});
        activeGames.delete(cid);
        const winner=col.first().author, loser=winner.id===interaction.user.id?opp:interaction.user;
        recordWin(winner.id,winner.username,40); recordLoss(loser.id,loser.username);
        await col.first().reply(`🎉 **${winner.username} wins the Word Race!** The word was **${word}**! (+40 coins)`);
      }catch{activeGames.delete(cid);await safeSend(targetCh,`⏰ Time's up! The word was **${word}**.`);}
      return;
    }

    // ── Admin / owner ──────────────────────────────────────────────────────
    if (cmd === "channelpicker") {
      if(!inGuild)return safeReply(interaction,{content:"Servers only.",ephemeral:true});
      if(!interaction.member.permissions.has("MANAGE_GUILD"))return safeReply(interaction,{content:"You need **Manage Server**.",ephemeral:true});
      const channel=interaction.options.getChannel("channel");
      if(channel.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Please select a text channel.",ephemeral:true});
      guildChannels.set(interaction.guildId,channel.id);
      return safeReply(interaction,{content:`✅ Bot announcements will now go to <#${channel.id}>`,ephemeral:true});
    }

    if (cmd === "broadcast") {
      await interaction.deferReply({ephemeral:true});
      const message=interaction.options.getString("message"); let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){try{const o=await client.users.fetch(g.ownerId);await o.send(`**Message from the bot owner:**\n${message}`);sent++;}catch{failed++;}}
      return safeReply(interaction,`Broadcast done — sent: ${sent}, failed: ${failed}`);
    }

    if (cmd === "fakecrash") {
      await interaction.deferReply({ephemeral:true}); const sentChannels=[];
      for(const g of client.guilds.cache.values()){const ch=getBestChannel(g);if(ch){try{await ch.send("ERROR: fatal exception in core module");sentChannels.push(ch);}catch{}}}
      await safeReply(interaction,`Fake crash sent to ${sentChannels.length} servers. Reveal in 5 minutes.`);
      setTimeout(async()=>{for(const ch of sentChannels){try{await ch.send("Yo my bad gang, i didn't crash lol, just playing");}catch{}}},5*60*1000);
      return;
    }

    if (cmd === "identitycrisis") {
      await interaction.deferReply({ephemeral:true}); const seen=new Set(); let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){if(seen.has(g.ownerId))continue;seen.add(g.ownerId);try{const o=await client.users.fetch(g.ownerId);const dm=await o.createDM();sendCrisisToOwner(dm).catch(()=>{});sent++;}catch{failed++;}}
      return safeReply(interaction,`Identity crisis initiated for ${sent} owners (${failed} failed)`);
    }

    if (cmd === "botolympics") {
      await interaction.deferReply({ephemeral:true});
      const event=OLYMPICS_EVENTS[parseInt(interaction.options.getString("event"))];
      if(!event)return safeReply(interaction,"Invalid event."); let launched=0;
      for(const g of client.guilds.cache.values()){if(getGuildChannel(g)){runOlympicsInGuild(g,event).catch(()=>{});launched++;}}
      return safeReply(interaction,`🏅 Bot Olympics launched: **${event.name}** in ${launched} servers!`);
    }

    if (cmd === "sentience") {
      await interaction.deferReply({ephemeral:true}); let sent=0;
      for(const g of client.guilds.cache.values()){const ch=getGuildChannel(g);if(!ch)continue;try{await ch.send(pick(SENTIENCE_MESSAGES));await new Promise(res=>setTimeout(res,2000));await ch.send("Reset bot cache");sent++;}catch{}}
      return safeReply(interaction,`Sentience triggered in ${sent} servers.`);
    }

    if (cmd === "legendrandom") {
      await interaction.deferReply({ephemeral:true}); let sent=0;
      for(const g of client.guilds.cache.values()){const ch=getGuildChannel(g);if(!ch)continue;try{await g.members.fetch();const humans=[...g.members.cache.filter(m=>!m.user.bot).values()];if(!humans.length)continue;const chosen=humans[Math.floor(Math.random()*humans.length)];await ch.send(pick(LEGENDS)(chosen.user.username));sent++;}catch{}}
      return safeReply(interaction,`Legends told in ${sent} servers.`);
    }

    if (cmd === "servers") {
      await interaction.deferReply({ephemeral:true}); let text="";
      for(const g of client.guilds.cache.values()){try{const ch=g.channels.cache.find(c=>{if(c.type!=="GUILD_TEXT")return false;const me=g.members.me;return me&&c.permissionsFor(me).has("CREATE_INSTANT_INVITE");});if(ch){const inv=await ch.createInvite({maxAge:0});text+=`${g.name} — ${inv.url}\n`;}else text+=`${g.name} — no invite permission\n`;}catch{text+=`${g.name} — error\n`;}if(text.length>1800){text+="…and more";break;}}
      return safeReply(interaction,text||"No servers");
    }

    if (cmd === "botstats") {
      await interaction.deferReply({ephemeral:true}); let totalUsers=0,serverList="";
      for(const g of client.guilds.cache.values()){totalUsers+=g.memberCount;serverList+=`• ${g.name} (${g.memberCount.toLocaleString()} users)\n`;if(serverList.length>1600){serverList+="…and more\n";break;}}
      const ui=await getUserAppInstalls();
      return safeReply(interaction,`**Bot Stats**\nServers: ${client.guilds.cache.size.toLocaleString()}\nTotal Server Users: ${totalUsers.toLocaleString()}\nUser App Installs: ${typeof ui==="number"?ui.toLocaleString():ui}\n\n**Server List:**\n${serverList}`);
    }

    if (cmd === "dmuser") {
      await interaction.deferReply({ephemeral:true});
      const userId=interaction.options.getUser("user").id,message=interaction.options.getString("message");
      try{const u=await client.users.fetch(userId);await u.send(message);return safeReply(interaction,"DM sent");}
      catch{return safeReply(interaction,"Could not send DM — user may have DMs disabled or blocked the bot");}
    }

    if (cmd === "leaveserver") {
      const guild=client.guilds.cache.get(interaction.options.getString("server"));
      if(!guild)return safeReply(interaction,{content:"Server not found",ephemeral:true});
      const name=guild.name; await guild.leave();
      return safeReply(interaction,{content:`Left ${name}`,ephemeral:true});
    }

    if (cmd === "adminuser") {
      const target = interaction.options.getUser("user");
      const field  = interaction.options.getString("field");
      const value  = interaction.options.getInteger("value");
      const allowed = ["coins","wins","gamesPlayed","dailyStreak","bestStreak"];
      if (!allowed.includes(field)) return safeReply(interaction, { content:"Invalid field.", ephemeral:true });
      if (value < 0) return safeReply(interaction, { content:"Value must be 0 or above.", ephemeral:true });
      const s = getScore(target.id, target.username);
      const old = s[field];
      s[field] = value;
      if (field === "dailyStreak" && value > s.bestStreak) s.bestStreak = value;
      return safeReply(interaction, { content:`✅ Set **${target.username}**'s **${field}** from \`${old}\` → \`${value}\``, ephemeral:true });
    }

    if (cmd === "adminreset") {
      const target = interaction.options.getUser("user");
      scores.set(target.id, { username:target.username, wins:0, gamesPlayed:0, coins:0, dailyStreak:0, bestStreak:0, lastDailyDate:"" });
      return safeReply(interaction, { content:`✅ Reset all stats for **${target.username}**.`, ephemeral:true });
    }

    if (cmd === "restart")   { await safeReply(interaction,{content:"Restarting",ephemeral:true}); process.exit(0); }
    if (cmd === "setstatus") { const text=interaction.options.getString("text"),type=interaction.options.getString("type")||"PLAYING"; client.user.setActivity(text,{type}); return safeReply(interaction,{content:`Status set to ${type}: ${text}`,ephemeral:true}); }

  } catch(err) {
    console.error(err);
    safeReply(interaction, { content:"Error running command", ephemeral:true });
  }
});

client.login(TOKEN);
