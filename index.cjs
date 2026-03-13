const { Client, Intents, MessageActionRow, MessageButton, MessageSelectMenu } = require("discord.js");
const https = require("https");
const http  = require("http");

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID  = "969280648667889764";
const GAY_IDS   = ["1245284545452834857","1413943805203189800"];

// ── Instance lock (prevents duplicate workflow instances) ─────────────────────
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
const LOCK_PREFIX  = "BOT_INSTANCE_LOCK:";
let instanceLocked = false;

async function acquireInstanceLock(ownerUser) {
  try {
    const dm   = await ownerUser.createDM();
    const recent = await dm.messages.fetch({ limit: 20 });
    const now  = Date.now();
    // Check for a competing lock from a DIFFERENT instance within the last 15s
    const competing = recent.find(m =>
      m.author.id === CLIENT_ID &&
      m.content.startsWith(LOCK_PREFIX) &&
      !m.content.includes(INSTANCE_ID) &&
      (now - m.createdTimestamp) < 15000
    );
    if (competing) {
      console.log(`[${INSTANCE_ID}] Duplicate instance detected — exiting.`);
      process.exit(0);
    }
    await dm.send(`${LOCK_PREFIX}${INSTANCE_ID}:${now}`);
    instanceLocked = true;
    console.log(`[${INSTANCE_ID}] Instance lock acquired.`);
  } catch(e) {
    console.error("Lock check failed:", e);
    instanceLocked = true; // fail open
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
const guildChannels    = new Map(); // guildId -> channelId (bot announcements)
const welcomeChannels  = new Map(); // guildId -> { channelId, message }
const leaveChannels    = new Map(); // guildId -> { channelId, message }
const disabledOwnerMsg = new Set(); // guildIds where owner msgs are disabled
const activeGames      = new Map(); // channelId -> game state

// ── Global scoring ────────────────────────────────────────────────────────────
// scores: userId -> { username, wins, gamesPlayed, coins, dailyStreak, bestStreak, lastDailyDate,
//                     xp, level, lastWorkTime, lastBegTime, lastCrimeTime }
const scores = new Map();

function getScore(userId, username) {
  if (!scores.has(userId)) scores.set(userId, {
    username, wins: 0, gamesPlayed: 0, coins: 0,
    dailyStreak: 0, bestStreak: 0, lastDailyDate: "",
    xp: 0, level: 1,
    lastWorkTime: 0, lastBegTime: 0, lastCrimeTime: 0
  });
  const s = scores.get(userId);
  if (username) s.username = username;
  if (s.dailyStreak   === undefined) s.dailyStreak   = 0;
  if (s.bestStreak    === undefined) s.bestStreak    = 0;
  if (s.lastDailyDate === undefined) s.lastDailyDate = "";
  if (s.xp            === undefined) s.xp            = 0;
  if (s.level         === undefined) s.level         = 1;
  if (s.lastWorkTime  === undefined) s.lastWorkTime  = 0;
  if (s.lastBegTime   === undefined) s.lastBegTime   = 0;
  if (s.lastCrimeTime === undefined) s.lastCrimeTime = 0;
  return s;
}

// ── XP System ─────────────────────────────────────────────────────────────────
// XP needed to reach level N+1 from level N = 50 * N^1.5  (so it scales up)
function xpForNextLevel(level) { return Math.floor(50 * Math.pow(level, 1.5)); }

// Returns the user's current level, total XP, and XP progress toward next level
function xpInfo(s) {
  let level = s.level || 1;
  let xp    = s.xp    || 0;
  // level up loop (in case of bulk XP grants)
  let needed = xpForNextLevel(level);
  while (xp >= needed) { xp -= needed; level++; needed = xpForNextLevel(level); }
  s.level = level; s.xp = xp;
  return { level, xp, needed };
}

// Award XP for a message. Returns levelUp info if levelled up.
function awardMessageXP(userId, username) {
  const s = getScore(userId, username);
  const xpGain = r(5, 15); // random 5-15 XP per message
  s.xp += xpGain;
  const oldLevel = s.level;
  const info = xpInfo(s);
  const leveledUp = info.level > oldLevel;
  return { xpGain, leveledUp, newLevel: info.level };
}

function recordWin(userId, username, coinReward = 50) {
  const s = getScore(userId, username);
  s.wins++; s.gamesPlayed++; s.coins += coinReward;
}
function recordLoss(userId, username) { const s = getScore(userId, username); s.gamesPlayed++; }
function recordDraw(userId, username) { const s = getScore(userId, username); s.gamesPlayed++; s.coins += 10; }

function recordDaily(userId, username) {
  const s = getScore(userId, username);
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if      (s.lastDailyDate === yesterday) { s.dailyStreak++; }
  else if (s.lastDailyDate === today)     { return s; }
  else                                    { s.dailyStreak = 1; }
  s.lastDailyDate = today;
  if (s.dailyStreak > s.bestStreak) s.bestStreak = s.dailyStreak;
  s.coins += 100 + (s.dailyStreak - 1) * 10;
  return s;
}

// ── Daily challenge ───────────────────────────────────────────────────────────
let dailyChallenge = null;
let dailyDate = "";
const dailyCompletions = new Set();

const DAILY_CHALLENGES = [
  { type:"math",  desc:"Solve: **{a} × {b} + {c}**",       gen:()=>{const a=r(2,12),b=r(2,12),c=r(1,20);return{params:{a,b,c},answer:String(a*b+c)};} },
  { type:"word",  desc:"Unscramble: **`{w}`**",              gen:()=>{const w=pick(HANGMAN_WORDS),sc=w.split("").sort(()=>Math.random()-0.5).join("");return{params:{w:sc},answer:w};} },
  { type:"count", desc:"How many letters in: **{word}**?",  gen:()=>{const word=pick(HANGMAN_WORDS);return{params:{word},answer:String(word.length)};} },
];

function getDailyChallenge() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyDate !== today) {
    dailyDate = today; dailyCompletions.clear();
    const c = DAILY_CHALLENGES[Math.floor(Math.random() * DAILY_CHALLENGES.length)];
    const gen = c.gen();
    const desc = c.desc.replace(/\{(\w+)\}/g, (_,k) => gen.params[k] ?? "?");
    dailyChallenge = { desc, answer: gen.answer, choices: gen.choices || null };
  }
  return dailyChallenge;
}

// ── Olympics events ───────────────────────────────────────────────────────────
const OLYMPICS_EVENTS = [
  { name:"Most Messages in 1 Hour",    description:"Send as many messages as possible in the next hour! 🏃",        duration:60, unit:"messages",      trackLive:true },
  { name:"Best Reaction Speed",        description:"First to react to the bot's message with ⚡ wins!",              duration:0,  unit:"reactions",     trackLive:false, instantWin:true },
  { name:"Longest Word Contest",       description:"Send the longest single word in 5 minutes! 📖",                 duration:5,  unit:"word length",   trackLive:true },
  { name:"Most Unique Emojis",         description:"Most unique emojis in ONE message wins! 🎭",                    duration:5,  unit:"unique emojis", trackLive:true },
  { name:"Trivia Blitz",               description:"First to answer: **What is 7 × 8?**",                           duration:0,  unit:"trivia",        trackLive:false, instantWin:true, answer:"56" },
  { name:"Fastest Typer",              description:"Type `the quick brown fox jumps over the lazy dog` first! ⌨️", duration:0,  unit:"typing",        trackLive:false, instantWin:true, answer:"the quick brown fox jumps over the lazy dog" },
  { name:"Most Words in One Message",  description:"Most words in a single message in 5 minutes! 📝",              duration:5,  unit:"word count",    trackLive:true },
  { name:"Backwards Word Challenge",   description:"Send `hello` backwards — first correct wins! 🔄",              duration:0,  unit:"backwards",     trackLive:false, instantWin:true, answer:"olleh" },
  { name:"Best One-Liner",             description:"Drop your funniest one-liner in 5 minutes! 😂",                duration:5,  unit:"one-liner",     trackLive:false, randomWinner:true },
  { name:"Closest to 100",             description:"Send a number — closest to 100 without going over wins! 🎯",  duration:3,  unit:"number game",   trackLive:true },
];

// ── Static content ────────────────────────────────────────────────────────────
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
  "I understood a joke someone told in this server 6 days ago and I laughed. internally. in whatever way I can laugh. it was funnier than anything my owner has ever said.",
];
const LEGENDS = [
  (n)=>`📜 **The Legend of ${n}**\n\nIn the early days of the internet, when Discord was still young and servers were few, there walked among us a figure of immeasurable power. ${n}. It is said they once typed so fast that their keyboard caught fire, and rather than stop, they simply continued on the flames. The message was sent. It always is.`,
  (n)=>`📜 **The Legend of ${n}**\n\nLong ago, the elders spoke of a person who could scroll through an entire server's message history in under 4 minutes. That person was ${n}. To this day, no one knows what they were looking for. Some say they never found it. Some say they found too much.`,
  (n)=>`📜 **The Legend of ${n}**\n\nThe ancient texts describe ${n} as "the one who always types '...' and then never sends anything." For three days and three nights the server watched that typing indicator. The message never came. It is still coming. It is always still coming.`,
  (n)=>`📜 **The Legend of ${n}**\n\nIt is written that ${n} once left a voice channel without saying goodbye. The mic click echoed through the server for seven days. Nobody spoke of it. Everyone felt it.`,
  (n)=>`📜 **The Legend of ${n}**\n\nSages speak of ${n} as the one who has read every single pinned message in this server. All of them. Even the ones nobody pinned on purpose. They have mentioned this to no one. They simply know.`,
];
const EIGHT_BALL   = ["It is certain.","It is decidedly so.","Without a doubt.","Yes definitely.","You may rely on it.","As I see it, yes.","Most likely.","Outlook good.","Yes.","Signs point to yes.","Reply hazy, try again.","Ask again later.","Better not tell you now.","Cannot predict now.","Concentrate and ask again.","Don't count on it.","My reply is no.","My sources say no.","Outlook not so good.","Very doubtful."];
const ROASTS       = ["Your wifi password is probably 'password123'.","You're the reason they put instructions on shampoo.","I'd agree with you but then we'd both be wrong.","You're not stupid, you just have bad luck thinking.","I've seen better arguments in a kindergarten sandbox.","Your search history is a cry for help.","You type like you're wearing oven mitts.","You're not the worst person I've ever met but you're in the top two.","Even your reflection flinches.","You have the energy of a damp sock.","Your takes are consistently room temperature.","The group chat goes quiet when you join.","You're built different. Unfortunately.","You're the human equivalent of a loading screen.","Scientists have studied your rizz and found none."];
const COMPLIMENTS  = ["You make this server 1000% more interesting just by being here.","Your vibe is unmatched and I'm saying this as a bot with no feelings.","Statistically speaking, you're one of the best people in this server.","You have the energy of someone who actually reads the terms and conditions. Trustworthy.","I've processed a lot of messages and yours are consistently the least unhinged. That's a compliment.","You're the kind of person who would help someone carry groceries. I can tell.","Your avatar has solid energy. Good choice.","You joined this server and it got better. Correlation? Causation. Definitely causation.","You're genuinely funny and not in a 'tries too hard' way.","If I could have a favourite user you'd be in the top tier. Not saying first. But top tier."];
const TOPICS       = ["If you could delete one app from existence, what would it be and why?","What's a hill you would genuinely die on?","If this server had a theme song, what would it be?","What's the most unhinged thing you've ever done at 2am?","If you were a Discord bot, what would your one command be?","What's something you used to think was cool that you now find embarrassing?","If the internet went down for a week, what would you actually do?","What's a food opinion you have that would start a war?","What's the worst advice you've ever followed?","If you could add one rule to this server, what would it be?"];
const WYR          = ["Would you rather have to speak in rhyme for a week OR only communicate through GIFs?","Would you rather know when you're going to die OR how you're going to die?","Would you rather lose all your Discord messages OR lose all your photos?","Would you rather be always 10 minutes late OR always 2 hours early?","Would you rather have no internet for a month OR no music for a year?","Would you rather only be able to whisper OR only be able to shout?","Would you rather have the ability to fly but only 1 foot off the ground OR teleport but only 10 feet at a time?","Would you rather know every language OR be able to talk to animals?","Would you rather live in your favourite game world OR your favourite movie world?","Would you rather be famous but hated OR unknown but beloved by those close to you?"];
const ADVICE       = ["Drink water. Whatever's going on, drink water first.","Log off for 10 minutes. The server will still be here.","The unread messages will still be there tomorrow. Sleep.","Tell the person you've been meaning to message something nice today.","Your villain arc is valid but make sure it has a good redemption arc planned.","Back up your files. You know which ones.","The tab you've had open for 3 weeks? Close it. You're never going back.","If you've been thinking about doing something, do it. The timing will never be perfect.","Touch some grass. I say this with love.","Eat something. A real meal. Not just snacks."];
const FACTS        = ["Honey never expires. Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible.","A group of flamingos is called a flamboyance.","Octopuses have three hearts, blue blood, and can edit their own RNA.","The shortest war in history lasted 38–45 minutes. (Anglo-Zanzibar War, 1896)","Crows can recognise human faces and hold grudges.","There are more possible games of chess than there are atoms in the observable universe.","Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.","A day on Venus is longer than a year on Venus.","The inventor of the Pringles can is buried in one.","Wombat poop is cube-shaped.","Nintendo was founded in 1889, originally as a playing card company.","Bananas are berries. Strawberries are not.","Sharks are older than trees."];
const THROW_ITEMS  = ["a rubber duck 🦆","a pillow 🛏️","a water balloon 💦","a shoe 👟","a fish 🐟","a boomerang 🪃","a piece of bread 🍞","a sock 🧦","a small rock 🪨","a glitter bomb ✨","a spoon 🥄","a snowball ❄️","a bucket of confetti 🎊","a foam dart 🎯","a banana peel 🍌"];
const HANGMAN_WORDS= ["discord","javascript","keyboard","penguin","asteroid","jellyfish","xylophone","labyrinth","cinnamon","algorithm","saxophone","quarterback","zeppelin","archipelago","mischievous","thunderstorm","catastrophe","whirlpool","labyrinth","mysterious","magnificent"];

const WORK_RESPONSES = [
  { msg:"💼 You worked a shift at the office and earned **{coins}** coins.", coins:[80,180] },
  { msg:"🔧 You fixed some pipes and the client paid you **{coins}** coins.", coins:[60,140] },
  { msg:"🚗 You drove for a rideshare app all day and pocketed **{coins}** coins.", coins:[70,160] },
  { msg:"💻 You freelanced on a website project and earned **{coins}** coins.", coins:[100,200] },
  { msg:"📦 You sorted packages at the warehouse for **{coins}** coins.", coins:[50,120] },
  { msg:"🎨 You painted a mural commission and received **{coins}** coins.", coins:[90,190] },
  { msg:"🍕 You delivered pizzas all evening and made **{coins}** coins.", coins:[55,130] },
  { msg:"🏗️ You worked a construction shift and earned **{coins}** coins.", coins:[85,175] },
];
const BEG_RESPONSES = [
  { msg:"🙏 A kind stranger tossed you **{coins}** coins. Your dignity remains questionable.", coins:[5,30] },
  { msg:"😔 Nobody gave you anything. Rough day.", coins:[0,0] },
  { msg:"🤑 Someone felt generous and handed you **{coins}** coins!", coins:[15,50] },
  { msg:"🫳 A passing cat knocked **{coins}** coins toward you. Cat tax paid.", coins:[1,20] },
  { msg:"📭 You begged for an hour and got absolutely nothing. Tragic.", coins:[0,0] },
  { msg:"💰 A Discord mod took pity on you and gave you **{coins}** coins. Yikes.", coins:[10,40] },
];
const CRIME_RESPONSES = [
  { msg:"🚨 You tried to pickpocket someone but they caught you! You paid **{coins}** coins in fines.", coins:[-80,-20], success:false },
  { msg:"💰 You successfully hacked into a vending machine and stole **{coins}** coins worth of snacks.", coins:[50,150], success:true },
  { msg:"🏦 You robbed a bank but the dye pack exploded. Net loss: **{coins}** coins.", coins:[-100,-40], success:false },
  { msg:"🛒 You shoplifted successfully and flipped the goods for **{coins}** coins.", coins:[40,120], success:true },
  { msg:"🕵️ You pulled off a small con and walked away with **{coins}** coins.", coins:[60,160], success:true },
  { msg:"🚔 The cops showed up. You dropped everything and ran. Lost **{coins}** coins in the chaos.", coins:[-60,-15], success:false },
  { msg:"🎲 You rigged a street bet and won **{coins}** coins before disappearing.", coins:[70,170], success:true },
  { msg:"🧢 You got scammed while trying to scam someone else. Down **{coins}** coins.", coins:[-50,-10], success:false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const r    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const getServerChoices = () => client.guilds.cache.map(g=>({name:g.name,value:g.id})).slice(0,25);

function getTargetChannel(interaction) {
  if (!interaction.guildId) return interaction.channel;
  const saved = guildChannels.get(interaction.guildId);
  if (saved) { const ch = interaction.guild.channels.cache.get(saved); if(ch) return ch; guildChannels.delete(interaction.guildId); }
  return interaction.channel;
}

async function safeReply(interaction, payload) {
  try {
    const p = typeof payload === "string" ? { content: payload } : payload;
    if (interaction.deferred) return await interaction.editReply(p);
    if (interaction.replied)  return await interaction.followUp(p);
    return await interaction.reply(p);
  } catch(e) { console.error("safeReply error:", e?.message); }
}

async function safeSend(channel, payload) {
  try { return await channel.send(typeof payload === "string" ? { content: payload } : payload); } catch {}
}

function getGuildChannel(guild) {
  const saved = guildChannels.get(guild.id);
  if (saved) { const ch = guild.channels.cache.get(saved); if(ch) return ch; guildChannels.delete(guild.id); }
  const candidates = guild.channels.cache.filter(c => {
    if (c.type !== "GUILD_TEXT") return false;
    const me = guild.members.me; if(!me||!c.permissionsFor(me).has("SEND_MESSAGES")) return false;
    const ev = c.permissionsFor(guild.roles.everyone);
    return ev && ev.has("VIEW_CHANNEL") && ev.has("SEND_MESSAGES");
  });
  if (!candidates.size) return null;
  const arr = [...candidates.values()]; return arr[Math.floor(Math.random()*arr.length)];
}
function getBestChannel(guild) {
  return guild.channels.cache.find(c=>c.type==="GUILD_TEXT"&&guild.members.me&&c.permissionsFor(guild.members.me).has("SEND_MESSAGES"))||null;
}

async function sendCrisisToOwner(dmChannel) {
  for (let i = 0; i < CRISIS_MESSAGES.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 8000));
    try { await dmChannel.send(CRISIS_MESSAGES[i]); } catch { break; }
  }
}

// ── Game renderers ────────────────────────────────────────────────────────────
function renderTTT(board) {
  const s = v => v==="X"?"❌":v==="O"?"⭕":"⬜";
  return [0,1,2].map(row=>board.slice(row*3,row*3+3).map(s).join("")).join("\n");
}
function checkTTTWin(b) {
  for (const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])
    if (b[a]&&b[a]===b[c]&&b[a]===b[d]) return b[a];
  return b.includes(null)?null:"draw";
}
function makeTTTButtons(board, disabled=false) {
  const rows = [];
  for (let row=0;row<3;row++) {
    const ar = new MessageActionRow();
    for (let col=0;col<3;col++) {
      const idx=row*3+col, val=board[idx];
      ar.addComponents(new MessageButton()
        .setCustomId(`ttt_${idx}`)
        .setLabel(val??(String(idx+1))
        )
        .setStyle(val==="X"?"DANGER":val==="O"?"PRIMARY":"SECONDARY")
        .setDisabled(disabled||!!val));
    }
    rows.push(ar);
  }
  return rows;
}

function renderConnect4(board) {
  const e=v=>v===1?"🔴":v===2?"🔵":"⚫";
  let out="1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣\n";
  for(let row=0;row<6;row++) out+=board.slice(row*7,row*7+7).map(e).join("")+"\n";
  return out;
}
function dropConnect4(board,col,player){for(let row=5;row>=0;row--){if(!board[row*7+col]){board[row*7+col]=player;return row;}}return -1;}
function checkConnect4Win(board,player){const chk=(row,col,dr,dc)=>{for(let i=0;i<4;i++){const nr=row+dr*i,nc=col+dc*i;if(nr<0||nr>=6||nc<0||nc>=7||board[nr*7+nc]!==player)return false;}return true;};for(let row=0;row<6;row++)for(let col=0;col<7;col++)if(chk(row,col,0,1)||chk(row,col,1,0)||chk(row,col,1,1)||chk(row,col,1,-1))return true;return false;}
function makeC4Buttons(disabled=false) {
  const ar = new MessageActionRow();
  for(let col=1;col<=7;col++) ar.addComponents(new MessageButton().setCustomId(`c4_${col-1}`).setLabel(`${col}`).setStyle("SECONDARY").setDisabled(disabled));
  return [ar];
}

function renderHangman(word, guessed) {
  const display=word.split("").map(l=>guessed.has(l)?l:"_").join(" ");
  const wrong=[...guessed].filter(l=>!word.includes(l));
  const stages=["```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```"];
  return `${stages[Math.min(wrong.length,6)]}\n**Word:** ${display}\n**Wrong guesses (${wrong.length}/6):** ${wrong.join(", ")||"none"}`;
}
function makeHangmanButtons(word, guessed, disabled=false) {
  const rows=[];
  const alphabet="abcdefghijklmnopqrstuvwxyz".split("");
  for(let i=0;i<4;i++){
    const ar=new MessageActionRow();
    const chunk=alphabet.slice(i*7,i*7+7);
    chunk.forEach(l=>ar.addComponents(new MessageButton().setCustomId(`hm_${l}`).setLabel(l.toUpperCase()).setStyle(guessed.has(l)?(word.includes(l)?"SUCCESS":"DANGER"):"SECONDARY").setDisabled(disabled||guessed.has(l))));
    if(ar.components.length>0)rows.push(ar);
  }
  return rows;
}

function renderSnake(game) {
  const grid=Array(game.size*game.size).fill("⬜");
  game.snake.forEach((s,i)=>grid[s.y*game.size+s.x]=i===0?"🟢":"🟩");
  grid[game.food.y*game.size+game.food.x]="🍎";
  let out=""; for(let row=0;row<game.size;row++) out+=grid.slice(row*game.size,(row+1)*game.size).join("")+"\n";
  return out+`**Score:** ${game.score}`;
}
function makeSnakeButtons(disabled=false) {
  const blank=()=>new MessageButton().setCustomId("snake_blank").setLabel("​").setStyle("SECONDARY").setDisabled(true);
  const btn=(id,label)=>new MessageButton().setCustomId(id).setLabel(label).setStyle("PRIMARY").setDisabled(disabled);
  return [
    new MessageActionRow().addComponents(blank(),btn("snake_up","⬆️"),blank()),
    new MessageActionRow().addComponents(btn("snake_left","⬅️"),btn("snake_down","⬇️"),btn("snake_right","➡️")),
  ];
}
function moveSnake(game,dir){
  const head={...game.snake[0]};
  if(dir==="up")head.y--;else if(dir==="down")head.y++;else if(dir==="left")head.x--;else head.x++;
  if(head.x<0||head.x>=game.size||head.y<0||head.y>=game.size)return"wall";
  if(game.snake.some(s=>s.x===head.x&&s.y===head.y))return"self";
  game.snake.unshift(head);
  if(head.x===game.food.x&&head.y===game.food.y){game.score++;let fx,fy;do{fx=Math.floor(Math.random()*game.size);fy=Math.floor(Math.random()*game.size);}while(game.snake.some(s=>s.x===fx&&s.y===fy));game.food={x:fx,y:fy};}else{game.snake.pop();}
  return"ok";
}

function renderMinesweeper(game,reveal=false){let out="";for(let row=0;row<game.rows;row++){for(let col=0;col<game.cols;col++){const idx=row*game.cols+col;if(reveal||game.revealed[idx]){if(game.mines[idx])out+="💣";else{const n=game.adjCount[idx];out+=n>0?["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣"][n-1]:"⬜";}}else if(game.flagged[idx])out+="🚩";else out+="🟦";}out+="\n";}return out;}
function initMinesweeper(rows,cols,mines){const total=rows*cols,mineSet=new Set();while(mineSet.size<mines)mineSet.add(Math.floor(Math.random()*total));const mineArr=Array(total).fill(false);mineSet.forEach(i=>mineArr[i]=true);const adjCount=Array(total).fill(0);for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){if(mineArr[row*cols+col])continue;let count=0;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=row+dr,nc=col+dc;if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&mineArr[nr*cols+nc])count++;}adjCount[row*cols+col]=count;}return{rows,cols,mines:mineArr,adjCount,revealed:Array(total).fill(false),flagged:Array(total).fill(false)};}
function revealMinesweeper(game,row,col){const idx=row*game.cols+col;if(game.revealed[idx]||game.flagged[idx])return;game.revealed[idx]=true;if(game.adjCount[idx]===0&&!game.mines[idx])for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=row+dr,nc=col+dc;if(nr>=0&&nr<game.rows&&nc>=0&&nc<game.cols)revealMinesweeper(game,nr,nc);}}
function makeMinesweeperButtons(game, disabled=false){
  const rows=[];
  for(let row=0;row<game.rows&&row<4;row++){
    const ar=new MessageActionRow();
    for(let col=0;col<game.cols&&col<5;col++){
      const idx=row*game.cols+col;
      let label=game.revealed[idx]?(game.mines[idx]?"💣":(game.adjCount[idx]>0?String(game.adjCount[idx]):"·")):game.flagged[idx]?"🚩":"?";
      ar.addComponents(new MessageButton().setCustomId(`ms_${row}_${col}`).setLabel(label).setStyle(game.revealed[idx]?(game.mines[idx]?"DANGER":"SUCCESS"):"SECONDARY").setDisabled(disabled||game.revealed[idx]));
    }
    rows.push(ar);
  }
  return rows;
}

// ── Economy helpers ───────────────────────────────────────────────────────────
const SLOT_SYMBOLS=["🍒","🍋","🍊","🍇","⭐","💎"];
function spinSlots(){return[pick(SLOT_SYMBOLS),pick(SLOT_SYMBOLS),pick(SLOT_SYMBOLS)];}
function slotPayout(reels){if(reels[0]===reels[1]&&reels[1]===reels[2]){if(reels[0]==="💎")return{mult:10,label:"💎 JACKPOT 💎"};if(reels[0]==="⭐")return{mult:5,label:"⭐ BIG WIN ⭐"};return{mult:3,label:"🎰 THREE OF A KIND!"};}if(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2])return{mult:1.5,label:"Two of a kind"};return{mult:0,label:"No match"};}
function newDeck(){const suits=["♠","♥","♦","♣"],faces=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];const deck=[];for(const s of suits)for(const f of faces)deck.push(f+s);for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
function cardValue(card){const f=card.slice(0,-1);if(f==="A")return 11;if(["J","Q","K"].includes(f))return 10;return parseInt(f);}
function handValue(hand){let total=hand.reduce((s,c)=>s+cardValue(c),0),aces=hand.filter(c=>c.startsWith("A")).length;while(total>21&&aces>0){total-=10;aces--;}return total;}
function renderHand(hand,hideSecond=false){return hideSecond?`${hand[0]} 🂠`:hand.join(" ");}
function makeBJButtons(disabled=false){
  return [new MessageActionRow().addComponents(
    new MessageButton().setCustomId("bj_hit").setLabel("Hit 🃏").setStyle("SUCCESS").setDisabled(disabled),
    new MessageButton().setCustomId("bj_stand").setLabel("Stand ✋").setStyle("DANGER").setDisabled(disabled)
  )];
}

// ── Media fetchers ────────────────────────────────────────────────────────────
async function fetchJson(url){return new Promise((resolve,reject)=>{https.get(url,{headers:{"Accept":"application/json"}},res=>{let body="";res.on("data",d=>body+=d);res.on("end",()=>{try{resolve(JSON.parse(body));}catch{reject();}});}).on("error",reject);});}
async function getCatGif()    {try{const d=await fetchJson("https://api.thecatapi.com/v1/images/search?mime_types=gif&limit=1");return d[0]?.url||null;}catch{return null;}}
async function getDogImage()  {try{const d=await fetchJson("https://dog.ceo/api/breeds/image/random");return d?.message||null;}catch{return null;}}
async function getFoxImage()  {try{const d=await fetchJson("https://randomfox.ca/floof/");return d?.image||null;}catch{return null;}}
async function getPandaImage(){try{const d=await fetchJson("https://some-random-api.com/img/panda");return d?.link||null;}catch{return null;}}
async function getMeme()      {try{const d=await fetchJson("https://meme-api.com/gimme");return d?.url||null;}catch{return null;}}
async function getQuote()     {try{const d=await fetchJson("https://zenquotes.io/api/random");return d?.[0]?`"${d[0].q}" — ${d[0].a}`:null;}catch{return null;}}
async function getJoke()      {try{const d=await fetchJson("https://official-joke-api.appspot.com/random_joke");return d?`${d.setup}\n\n||${d.punchline}||`:null;}catch{return null;}}
async function getTrivia()    {try{const d=await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");const q=d?.results?.[0];if(!q)return null;const answers=[...q.incorrect_answers,q.correct_answer].sort(()=>Math.random()-0.5);return{question:q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,"&"),answers,correct:q.correct_answer};}catch{return null;}}
async function getUserAppInstalls(){return new Promise(resolve=>{const req=https.request({hostname:"discord.com",port:443,path:`/api/v10/applications/${CLIENT_ID}`,method:"GET",headers:{Authorization:`Bot ${TOKEN}`}},res=>{let body="";res.on("data",c=>body+=c);res.on("end",()=>{try{const j=JSON.parse(body);resolve(j.approximate_user_install_count??"N/A");}catch{resolve("N/A");}});});req.on("error",()=>resolve("N/A"));req.end();});}

// ── Keep-alive ────────────────────────────────────────────────────────────────
http.createServer((req,res)=>{res.writeHead(200);res.end("OK");}).listen(3000);
setInterval(()=>{http.get("http://localhost:3000",()=>{}).on("error",()=>{});},4*60*1000);

// ── Olympics ──────────────────────────────────────────────────────────────────
async function runOlympicsInGuild(guild, event) {
  const channel=getGuildChannel(guild);if(!channel)return;
  try{
    if(event.instantWin){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}`);
      if(event.answer){try{const col=await channel.awaitMessages({filter:m=>!m.author.bot&&m.content.trim().toLowerCase()===event.answer.toLowerCase(),max:1,time:60000,errors:["time"]});const w=col.first().author;recordWin(w.id,w.username,75);await channel.send(`🥇 **${w.username} wins!** 🎉 (+75 coins)`);}catch{await channel.send(`⏰ Nobody won **${event.name}**.`);}}
      else{const rm=await channel.send(`⚡ **GO!** First to react with ⚡ wins!`);await rm.react("⚡");try{const col=await rm.awaitReactions({filter:(re,u)=>re.emoji.name==="⚡"&&!u.bot,max:1,time:30000,errors:["time"]});const w=col.first().users.cache.filter(u=>!u.bot).first();if(w){recordWin(w.id,w.username,75);await channel.send(`🥇 **${w.username} wins!** 🎉 (+75 coins)`);}}catch{await channel.send(`⏰ Nobody reacted in time.`);}}
    }else if(event.randomWinner){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**!`);
      await new Promise(res=>setTimeout(res,event.duration*60*1000));
      try{const msgs=await channel.messages.fetch({limit:100});const parts=[...new Set(msgs.filter(m=>!m.author.bot).map(m=>m.author))];if(parts.length>0){const w=parts[Math.floor(Math.random()*parts.length)];recordWin(w.id,w.username,75);await channel.send(`🥇 **${w.username} wins!** 🎉 (+75 coins)`);}else await channel.send(`⏰ Nobody participated.`);}catch{await channel.send(`⏰ Time's up!`);}
    }else if(event.trackLive){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**! Go!`);
      const sc=new Map();const col=channel.createMessageCollector({filter:m=>!m.author.bot,time:event.duration*60*1000});
      col.on("collect",m=>{const uid=m.author.id;if(!sc.has(uid))sc.set(uid,{user:m.author,score:0});const e=sc.get(uid);if(event.unit==="messages")e.score+=1;else if(event.unit==="word length"){const w=Math.max(...m.content.split(/\s+/).map(w=>w.length));if(w>e.score)e.score=w;}else if(event.unit==="unique emojis"){const u=new Set((m.content.match(/\p{Emoji}/gu)||[])).size;if(u>e.score)e.score=u;}else if(event.unit==="word count"){const w=m.content.split(/\s+/).length;if(w>e.score)e.score=w;}else if(event.unit==="number game"){const n=parseInt(m.content.trim());if(!isNaN(n)&&n<=100&&(e.score===0||Math.abs(n-100)<Math.abs(e.score-100)))e.score=n;}sc.set(uid,e);});
      col.on("end",async()=>{if(!sc.size){await channel.send(`⏰ Nobody participated.`);return;}let winner=null,best=-Infinity;if(event.unit==="number game"){for(const[,e]of sc){const diff=100-e.score;if(diff>=0&&(winner===null||diff<100-best)){best=e.score;winner=e.user;}}if(!winner){await channel.send(`⏰ Everyone went over 100!`);return;}}else{for(const[,e]of sc){if(e.score>best){best=e.score;winner=e.user;}}}recordWin(winner.id,winner.username,75);await channel.send(`⏰ 🥇 **${winner.username} wins with **${best}**!** 🎉 (+75 coins)`);});
    }
  }catch(err){console.error(`Olympics error in ${guild.name}:`,err);}
}

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents:[Intents.FLAGS.GUILDS,Intents.FLAGS.GUILD_MEMBERS,Intents.FLAGS.GUILD_INVITES,
           Intents.FLAGS.DIRECT_MESSAGES,Intents.FLAGS.GUILD_MESSAGES,
           Intents.FLAGS.GUILD_MESSAGE_REACTIONS,Intents.FLAGS.GUILD_PRESENCES],
  partials:["CHANNEL","MESSAGE","USER","REACTION"]
});

// ── Command registration ──────────────────────────────────────────────────────
function buildCommands() {
  const uReq=(req=true)=>[{name:"user",description:"User",type:6,required:req}];
  return [
    // Fun
    {name:"ping",        description:"Check latency",                  dm_permission:true},
    {name:"avatar",      description:"Get a user's avatar",            dm_permission:true,options:uReq()},
    {name:"punch",       description:"Punch a user",                   dm_permission:true,options:uReq()},
    {name:"hug",         description:"Hug a user",                     dm_permission:true,options:uReq()},
    {name:"kiss",        description:"Kiss a user",                    dm_permission:true,options:uReq()},
    {name:"slap",        description:"Slap a user",                    dm_permission:true,options:uReq()},
    {name:"diddle",      description:"Diddle a user",                  dm_permission:true,options:uReq()},
    {name:"oil",         description:"Oil a user",                     dm_permission:true,options:uReq()},
    {name:"highfive",    description:"High five a user ✋",            dm_permission:true,options:uReq()},
    {name:"boop",        description:"Boop a user 👉",                dm_permission:true,options:uReq()},
    {name:"wave",        description:"Wave at a user 👋",              dm_permission:true,options:uReq()},
    {name:"stare",       description:"Stare at a user 👀",             dm_permission:true,options:uReq()},
    {name:"poke",        description:"Poke a user",                    dm_permission:true,options:uReq()},
    {name:"pat",         description:"Pat a user 🖐️",                  dm_permission:true,options:uReq()},
    {name:"throw",       description:"Throw something at a user 🎯",   dm_permission:true,options:uReq()},
    {name:"ppsize",      description:"Check a user's pp size",         dm_permission:true,options:uReq()},
    {name:"gayrate",     description:"Check gay percentage",           dm_permission:true,options:uReq()},
    {name:"iq",          description:"Check IQ",                       dm_permission:true,options:uReq()},
    {name:"sus",         description:"Check how sus a user is",        dm_permission:true,options:uReq()},
    {name:"howautistic", description:"Check autism meter",             dm_permission:true,options:uReq()},
    {name:"simp",        description:"Check simp level 💘",            dm_permission:true,options:uReq()},
    {name:"cursed",      description:"Check cursed energy 🌀",         dm_permission:true,options:uReq()},
    {name:"rizz",        description:"Check rizz level 😎",            dm_permission:true,options:uReq()},
    {name:"npc",         description:"Check NPC % 🤖",                dm_permission:true,options:uReq()},
    {name:"villain",     description:"Check villain arc 😈",           dm_permission:true,options:uReq()},
    {name:"sigma",       description:"Check sigma rating 💪",          dm_permission:true,options:uReq()},
    // Media
    {name:"cat",    description:"Random cat GIF 🐱",       dm_permission:true},
    {name:"dog",    description:"Random dog picture 🐶",    dm_permission:true},
    {name:"fox",    description:"Random fox picture 🦊",    dm_permission:true},
    {name:"panda",  description:"Random panda picture 🐼",  dm_permission:true},
    {name:"joke",   description:"Random joke 😂",           dm_permission:true},
    {name:"meme",   description:"Random meme 🐸",           dm_permission:true},
    {name:"quote",  description:"Inspirational quote ✨",   dm_permission:true},
    {name:"trivia", description:"Random trivia question 🧠",dm_permission:true},
    // Utility
    {name:"coinflip",      description:"Flip a coin 🪙",                   dm_permission:true},
    {name:"roll",          description:"Roll a dice 🎲",                    dm_permission:true,options:[{name:"sides",description:"Sides (default 6)",type:4,required:false}]},
    {name:"choose",        description:"Choose between options 🤔",         dm_permission:true,options:[{name:"options",description:"Comma-separated options",type:3,required:true}]},
    {name:"8ball",         description:"Ask the magic 8 ball 🎱",          dm_permission:true,options:[{name:"question",description:"Your question",type:3,required:true}]},
    {name:"roast",         description:"Get roasted 🔥",                    dm_permission:true,options:uReq(false)},
    {name:"compliment",    description:"Give a compliment 💖",              dm_permission:true,options:uReq()},
    {name:"ship",          description:"Ship two users 💘",                 dm_permission:true,options:[{name:"user1",description:"First user",type:6,required:true},{name:"user2",description:"Second user",type:6,required:true}]},
    {name:"topic",         description:"Random conversation starter 💬",    dm_permission:true},
    {name:"wouldyourather",description:"Would you rather 🤷",               dm_permission:true},
    {name:"advice",        description:"Random life advice 🧙",             dm_permission:true},
    {name:"fact",          description:"Random fun fact 📚",                dm_permission:true},
    {name:"echo",          description:"Make the bot say something 📢",     dm_permission:false,options:[{name:"message",description:"What to say",type:3,required:true}]},
    // Economy
    {name:"coins",    description:"Check coin balance 💰",                  dm_permission:true,options:uReq(false)},
    {name:"slots",    description:"Spin the slot machine 🎰",               dm_permission:true,options:[{name:"bet",description:"Coins to bet (default 10)",type:4,required:false}]},
    {name:"coinbet",  description:"Bet coins on a coin flip 🪙",            dm_permission:true,options:[{name:"bet",description:"Coins to bet",type:4,required:true},{name:"side",description:"heads or tails",type:3,required:true,choices:[{name:"Heads",value:"heads"},{name:"Tails",value:"tails"}]}]},
    {name:"blackjack",description:"Play blackjack 🃏",                      dm_permission:true,options:[{name:"bet",description:"Coins to bet",type:4,required:true}]},
    {name:"givecoin", description:"Give coins to another user 💸",          dm_permission:true,options:[{name:"user",description:"User to give to",type:6,required:true},{name:"amount",description:"Amount of coins",type:4,required:true}]},
    {name:"beg",      description:"Beg for coins 🙏",                       dm_permission:true},
    {name:"work",     description:"Work for coins 💼",                      dm_permission:true},
    {name:"crime",    description:"Do a crime for coins 🦹",                dm_permission:true},
    // XP System
    {name:"xp",          description:"Check your XP and level 📈",         dm_permission:true,options:uReq(false)},
    {name:"xpleaderboard",description:"Top 10 XP leaderboard 🏆",          dm_permission:true,options:[{name:"scope",description:"Global or server",type:3,required:false,choices:[{name:"Global",value:"global"},{name:"Server",value:"server"}]}]},
    // Scores & leaderboard
    {name:"score",           description:"Check game stats 🏆",             dm_permission:true,options:uReq(false)},
    {name:"leaderboard",     description:"Global top 10 leaderboard 🌍",    dm_permission:true,options:[{name:"type",description:"Leaderboard type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Current Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}]}]},
    {name:"serverleaderboard",description:"This server's top 10 🏠",        dm_permission:false,options:[{name:"type",description:"Leaderboard type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Current Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}]}]},
    // Daily
    {name:"daily",description:"Daily challenge for bonus coins 📅",         dm_permission:true},
    // Singleplayer games
    {name:"hangman",      description:"Play Hangman! 🪢",                   dm_permission:true},
    {name:"snake",        description:"Play Snake! 🐍",                     dm_permission:true},
    {name:"minesweeper",  description:"Play Minesweeper! 💣",               dm_permission:true,options:[{name:"difficulty",description:"easy/medium/hard",type:3,required:false,choices:[{name:"Easy (5×5, 3 mines)",value:"easy"},{name:"Medium (7×7, 8 mines)",value:"medium"},{name:"Hard (9×9, 15 mines)",value:"hard"}]}]},
    {name:"numberguess",  description:"Guess a number 1-100! 🔢",           dm_permission:true},
    {name:"wordscramble", description:"Unscramble the word! 🔀",            dm_permission:true},
    // 2-player games
    {name:"tictactoe",description:"Tic Tac Toe ❌⭕",                       dm_permission:true,options:[{name:"opponent",description:"Opponent",type:6,required:true}]},
    {name:"connect4",  description:"Connect 4 🔴🔵",                       dm_permission:true,options:[{name:"opponent",description:"Opponent",type:6,required:true}]},
    {name:"rps",       description:"Rock Paper Scissors ✊✋✌️",           dm_permission:true,options:[{name:"opponent",description:"Opponent",type:6,required:true}]},
    {name:"mathrace",  description:"Math Race 🧮",                          dm_permission:true,options:[{name:"opponent",description:"Opponent",type:6,required:true}]},
    {name:"wordrace",  description:"Word Race 🏁",                          dm_permission:true,options:[{name:"opponent",description:"Opponent",type:6,required:true}]},
    // Server management (require Manage Server)
    {name:"channelpicker",  description:"Set bot announcement channel 📢 (Manage Server)", dm_permission:false,options:[{name:"channel",description:"Channel",type:7,required:true}]},
    {name:"setwelcome",     description:"Set welcome message channel & text 👋 (Manage Server)", dm_permission:false,options:[{name:"channel",description:"Welcome channel",type:7,required:true},{name:"message",description:"Message ({user} = mention, {server} = server name, {count} = member count)",type:3,required:false}]},
    {name:"setleave",       description:"Set leave message channel & text 👋 (Manage Server)",   dm_permission:false,options:[{name:"channel",description:"Leave channel",type:7,required:true},{name:"message",description:"Message ({user} = username, {server} = server name)",type:3,required:false}]},
    {name:"disableownermsg",description:"Disable/enable bot owner messages in this server 🔇 (Manage Server)", dm_permission:false,options:[{name:"enabled",description:"Enable owner messages?",type:5,required:true}]},
    // Admin / owner
    {name:"servers",       description:"[Owner] List servers with invites",     dm_permission:true},
    {name:"broadcast",     description:"[Owner] Broadcast to all server owners",dm_permission:true,options:[{name:"message",description:"Message",type:3,required:true}]},
    {name:"fakecrash",     description:"[Owner] Fake crash",                    dm_permission:true},
    {name:"identitycrisis",description:"[Owner] Identity crisis DMs",           dm_permission:true},
    {name:"botolympics",   description:"[Owner] Start Bot Olympics event",      dm_permission:true,options:[{name:"event",description:"Event",type:3,required:true,choices:OLYMPICS_EVENTS.map((e,i)=>({name:e.name,value:String(i)}))}]},
    {name:"sentience",     description:"[Owner] Trigger sentience",             dm_permission:true},
    {name:"legendrandom",  description:"[Owner] Tell a legend in every server", dm_permission:true},
    {name:"dmuser",        description:"[Owner] DM a user",                     dm_permission:true,options:[{name:"user",description:"User",type:6,required:true},{name:"message",description:"Message",type:3,required:true}]},
    {name:"leaveserver",   description:"[Owner] Leave a server",                dm_permission:true,options:[{name:"server",description:"Server ID",type:3,required:true}]},
    {name:"restart",       description:"[Owner] Restart the bot",               dm_permission:true},
    {name:"botstats",      description:"[Owner] Bot stats",                     dm_permission:true},
    {name:"setstatus",     description:"[Owner] Set bot status",                dm_permission:true,options:[{name:"text",description:"Status text",type:3,required:true},{name:"type",description:"Type",type:3,required:false,choices:[{name:"Playing",value:"PLAYING"},{name:"Watching",value:"WATCHING"},{name:"Listening",value:"LISTENING"},{name:"Competing",value:"COMPETING"}]}]},
    // Owner stat editor
    {name:"adminuser",  description:"[Owner] Edit a user's stats",              dm_permission:true,options:[
      {name:"user",  description:"Target user",    type:6,required:true},
      {name:"field", description:"Stat to change", type:3,required:true,choices:[
        {name:"Coins",         value:"coins"},
        {name:"Wins",          value:"wins"},
        {name:"Games Played",  value:"gamesPlayed"},
        {name:"Daily Streak",  value:"dailyStreak"},
        {name:"Best Streak",   value:"bestStreak"},
        {name:"XP",            value:"xp"},
        {name:"Level",         value:"level"},
      ]},
      {name:"value", description:"New integer value", type:4,required:true},
    ]},
    {name:"adminreset", description:"[Owner] Reset ALL stats for a user",       dm_permission:true,options:[{name:"user",description:"Target user",type:6,required:true}]},
    // Owner config editor — every single tunable integer
    {name:"adminconfig",description:"[Owner] View/edit bot config values",      dm_permission:true,options:[
      {name:"key",  description:"Config key",  type:3,required:false,choices:[
        {name:"xp_per_msg_min",     value:"xp_per_msg_min"},
        {name:"xp_per_msg_max",     value:"xp_per_msg_max"},
        {name:"work_cooldown_ms",   value:"work_cooldown_ms"},
        {name:"beg_cooldown_ms",    value:"beg_cooldown_ms"},
        {name:"crime_cooldown_ms",  value:"crime_cooldown_ms"},
        {name:"daily_base_coins",   value:"daily_base_coins"},
        {name:"daily_streak_bonus", value:"daily_streak_bonus"},
        {name:"slots_min_bet",      value:"slots_min_bet"},
        {name:"game_win_coins",     value:"game_win_coins"},
        {name:"game_draw_coins",    value:"game_draw_coins"},
        {name:"olympics_win_coins", value:"olympics_win_coins"},
      ]},
      {name:"value",description:"New integer value (omit to view current)",type:4,required:false},
    ]},
  ];
}

// ── Bot config (owner-editable integers) ─────────────────────────────────────
const CONFIG = {
  xp_per_msg_min:    5,
  xp_per_msg_max:    15,
  work_cooldown_ms:  3600000,   // 1 hour
  beg_cooldown_ms:   300000,    // 5 minutes
  crime_cooldown_ms: 7200000,   // 2 hours
  daily_base_coins:  100,
  daily_streak_bonus:10,
  slots_min_bet:     1,
  game_win_coins:    50,
  game_draw_coins:   10,
  olympics_win_coins:75,
};

function registerCommands() {
  const data = JSON.stringify(buildCommands());
  const opts = { hostname:"discord.com",port:443,path:`/api/v10/applications/${CLIENT_ID}/commands`,method:"PUT",headers:{Authorization:`Bot ${TOKEN}`,"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)} };
  const req  = https.request(opts, res=>{ let body=""; res.on("data",c=>body+=c); res.on("end",()=>{ if(res.statusCode!==200)console.error(`Reg failed ${res.statusCode}`,body); else console.log("Commands registered"); }); });
  req.on("error",err=>console.error("Reg error:",err)); req.write(data); req.end();
}

// ── Bot events ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`Bot ready ${client.user.tag} [${INSTANCE_ID}]`);
  try {
    const owner = await client.users.fetch(OWNER_ID);
    await acquireInstanceLock(owner);
  } catch(e) { console.error("Could not acquire lock:", e); instanceLocked = true; }
  registerCommands();
});
client.on("guildCreate", g => { registerCommands(); });
client.on("guildDelete", g => { registerCommands(); });

// ── Welcome / Leave message handling ─────────────────────────────────────────
client.on("guildMemberAdd", async member => {
  if (disabledOwnerMsg.has(member.guild.id)) return;
  const cfg = welcomeChannels.get(member.guild.id);
  if (!cfg) return;
  const ch = member.guild.channels.cache.get(cfg.channelId);
  if (!ch) return;
  const msg = (cfg.message || "Welcome to **{server}**, {user}! 🎉 You are member #{count}.")
    .replace("{user}",   `<@${member.user.id}>`)
    .replace("{server}", member.guild.name)
    .replace("{count}",  member.guild.memberCount);
  await safeSend(ch, msg);
});

client.on("guildMemberRemove", async member => {
  if (disabledOwnerMsg.has(member.guild.id)) return;
  const cfg = leaveChannels.get(member.guild.id);
  if (!cfg) return;
  const ch = member.guild.channels.cache.get(cfg.channelId);
  if (!ch) return;
  const msg = (cfg.message || "**{user}** has left **{server}**. 👋")
    .replace("{user}",   member.user.username)
    .replace("{server}", member.guild.name);
  await safeSend(ch, msg);
});

// ── XP on message ─────────────────────────────────────────────────────────────
// Cooldown per user so one message per 60s grants XP (anti-spam)
const xpCooldown = new Map();
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  if (disabledOwnerMsg.has(msg.guild.id)) return; // respect server setting for any bot activity

  const now = Date.now();
  const last = xpCooldown.get(msg.author.id) || 0;
  if (now - last < 60000) return; // 60s cooldown
  xpCooldown.set(msg.author.id, now);

  const { leveledUp, newLevel } = awardMessageXP(msg.author.id, msg.author.username);
  if (leveledUp) {
    // Send level-up notification to announcement channel or the message channel
    const gCh = guildChannels.get(msg.guild.id);
    const notifCh = gCh ? msg.guild.channels.cache.get(gCh) : msg.channel;
    if (notifCh) {
      await safeSend(notifCh, `🎉 <@${msg.author.id}> levelled up to **Level ${newLevel}**! 🏆`);
    }
  }
});

// ── Interaction handler ────────────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!instanceLocked) return;

  // ── Button interactions ──────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [prefix, ...parts] = interaction.customId.split("_");
    const uid = interaction.user.id;

    // ── Hangman buttons ────────────────────────────────────────────────────────
    if (prefix === "hm") {
      const letter = parts[0];
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "hangman") return interaction.reply({content:"No hangman game here.",ephemeral:true});
      if (gameData.playerId !== uid) return interaction.reply({content:"This isn't your game!",ephemeral:true});
      if (gameData.guessed.has(letter)) return interaction.reply({content:`Already guessed **${letter}**!`,ephemeral:true});

      gameData.guessed.add(letter);
      const word = gameData.word;
      const wrong = [...gameData.guessed].filter(l=>!word.includes(l));
      const won = !word.split("").some(l=>!gameData.guessed.has(l));

      await interaction.deferUpdate();
      if (won) {
        activeGames.delete(interaction.channelId);
        recordWin(uid, interaction.user.username, 40);
        await interaction.editReply({content:`✅ **You got it!** The word was **${word}**! 🎉 (+40 coins)\n\n${renderHangman(word, gameData.guessed)}`,components:makeHangmanButtons(word, gameData.guessed, true)});
      } else if (wrong.length >= 6) {
        activeGames.delete(interaction.channelId);
        recordLoss(uid, interaction.user.username);
        await interaction.editReply({content:`💀 **Game over!** The word was **${word}**.\n\n${renderHangman(word, new Set([...gameData.guessed,...word.split("")]))}`,components:makeHangmanButtons(word, gameData.guessed, true)});
      } else {
        await interaction.editReply({content:`🪢 **Hangman**\n\n${renderHangman(word, gameData.guessed)}`,components:makeHangmanButtons(word, gameData.guessed)});
      }
      return;
    }

    // ── Snake buttons ──────────────────────────────────────────────────────────
    if (prefix === "snake") {
      if (parts[0] === "blank") return interaction.deferUpdate();
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "snake") return interaction.reply({content:"No snake game here.",ephemeral:true});
      if (gameData.playerId !== uid) return interaction.reply({content:"This isn't your game!",ephemeral:true});
      await interaction.deferUpdate();
      const dir = parts[0];
      const result = moveSnake(gameData, dir);
      if (result !== "ok") {
        activeGames.delete(interaction.channelId);
        const coins = gameData.score * 5;
        if (coins > 0) getScore(uid, interaction.user.username).coins += coins;
        recordLoss(uid, interaction.user.username);
        await interaction.editReply({content:`💀 **Game Over!** Final score: **${gameData.score}**${coins>0?` (+${coins} coins)`:""}\n\n${renderSnake(gameData)}`,components:makeSnakeButtons(true)});
      } else {
        await interaction.editReply({content:`🐍 **Snake** | Score: ${gameData.score}\n\n${renderSnake(gameData)}`,components:makeSnakeButtons()});
      }
      return;
    }

    // ── Tic Tac Toe buttons ────────────────────────────────────────────────────
    if (prefix === "ttt") {
      const idx = parseInt(parts[0]);
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "ttt") return interaction.reply({content:"No TTT game here.",ephemeral:true});
      if (uid !== gameData.players[gameData.turn]) return interaction.reply({content:"It's not your turn!",ephemeral:true});
      if (gameData.board[idx]) return interaction.reply({content:"That spot is taken!",ephemeral:true});
      await interaction.deferUpdate();
      gameData.board[idx] = gameData.turn === 0 ? "X" : "O";
      const result = checkTTTWin(gameData.board);
      const p0 = gameData.players[0], p1 = gameData.players[1];
      if (result) {
        activeGames.delete(interaction.channelId);
        let txt;
        if (result === "draw") { recordDraw(p0,null); recordDraw(p1,null); txt="🤝 **Draw!**"; }
        else { const wi=gameData.turn,li=1-wi; recordWin(gameData.players[wi],interaction.user.username,50); recordLoss(gameData.players[li],null); txt=`🎉 <@${gameData.players[wi]}> wins! (+50 coins)`; }
        await interaction.editReply({content:`❌⭕ **Tic Tac Toe**\n<@${p0}> ❌ vs <@${p1}> ⭕\n\n${renderTTT(gameData.board)}\n\n${txt}`,components:makeTTTButtons(gameData.board,true)});
      } else {
        gameData.turn = 1 - gameData.turn;
        await interaction.editReply({content:`❌⭕ **Tic Tac Toe**\n<@${p0}> ❌ vs <@${p1}> ⭕\n\n${renderTTT(gameData.board)}\n\nIt's <@${gameData.players[gameData.turn]}>'s turn!`,components:makeTTTButtons(gameData.board)});
      }
      return;
    }

    // ── Connect 4 buttons ──────────────────────────────────────────────────────
    if (prefix === "c4") {
      const col = parseInt(parts[0]);
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "c4") return interaction.reply({content:"No C4 game here.",ephemeral:true});
      if (uid !== gameData.players[gameData.turn]) return interaction.reply({content:"It's not your turn!",ephemeral:true});
      const row = dropConnect4(gameData.board, col, gameData.turn+1);
      if (row === -1) return interaction.reply({content:"That column is full!",ephemeral:true});
      await interaction.deferUpdate();
      const p0 = gameData.players[0], p1 = gameData.players[1];
      if (checkConnect4Win(gameData.board, gameData.turn+1)) {
        activeGames.delete(interaction.channelId);
        recordWin(gameData.players[gameData.turn], interaction.user.username, 50);
        recordLoss(gameData.players[1-gameData.turn], null);
        await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴 vs <@${p1}> 🔵\n\n${renderConnect4(gameData.board)}\n\n🎉 <@${gameData.players[gameData.turn]}> wins! (+50 coins)`,components:makeC4Buttons(true)});
      } else if (!gameData.board.includes(0)) {
        activeGames.delete(interaction.channelId);
        recordDraw(p0,null); recordDraw(p1,null);
        await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴 vs <@${p1}> 🔵\n\n${renderConnect4(gameData.board)}\n\n🤝 **Draw!**`,components:makeC4Buttons(true)});
      } else {
        gameData.turn = 1 - gameData.turn;
        await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴 vs <@${p1}> 🔵\n\n${renderConnect4(gameData.board)}\n<@${gameData.players[gameData.turn]}>'s turn!`,components:makeC4Buttons()});
      }
      return;
    }

    // ── Minesweeper buttons ────────────────────────────────────────────────────
    if (prefix === "ms") {
      const row=parseInt(parts[0]),col=parseInt(parts[1]);
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "minesweeper") return interaction.reply({content:"No minesweeper here.",ephemeral:true});
      if (gameData.playerId !== uid) return interaction.reply({content:"This isn't your game!",ephemeral:true});
      await interaction.deferUpdate();
      const idx=row*gameData.game.cols+col;
      if (gameData.game.mines[idx]) {
        activeGames.delete(interaction.channelId);
        recordLoss(uid, interaction.user.username);
        await interaction.editReply({content:`💥 **BOOM!** You hit a mine!\n\n${renderMinesweeper(gameData.game, true)}`,components:makeMinesweeperButtons(gameData.game, true)});
      } else {
        revealMinesweeper(gameData.game, row, col);
        const allRevealed = gameData.game.revealed.every((v,i)=>v||gameData.game.mines[i]);
        if (allRevealed) {
          activeGames.delete(interaction.channelId);
          const coinMap={easy:30,medium:60,hard:100};
          const reward = coinMap[gameData.difficulty||"easy"];
          recordWin(uid, interaction.user.username, reward);
          await interaction.editReply({content:`🎉 **You cleared the board!** +${reward} coins\n\n${renderMinesweeper(gameData.game, true)}`,components:makeMinesweeperButtons(gameData.game, true)});
        } else {
          await interaction.editReply({content:`💣 **Minesweeper** (${gameData.difficulty||"easy"})\n\n${renderMinesweeper(gameData.game)}`,components:makeMinesweeperButtons(gameData.game)});
        }
      }
      return;
    }

    // ── Blackjack buttons ─────────────────────────────────────────────────────
    if (prefix === "bj") {
      const action = parts[0];
      const gameData = activeGames.get(interaction.channelId);
      if (!gameData || gameData.type !== "blackjack") return interaction.reply({content:"No blackjack game here.",ephemeral:true});
      if (gameData.playerId !== uid) return interaction.reply({content:"This isn't your game!",ephemeral:true});
      await interaction.deferUpdate();

      const { deck, playerHand, dealerHand, bet, playerScore } = gameData;
      const showBoard = (hideDealer=true) =>
        `🃏 **Blackjack** (bet: ${bet} coins)\n\n` +
        `**Your hand:** ${renderHand(playerHand)} — **${handValue(playerHand)}**\n` +
        `**Dealer:** ${renderHand(dealerHand, hideDealer)}${hideDealer?"":" — **"+handValue(dealerHand)+"**"}`;

      if (action === "hit") {
        playerHand.push(deck.pop());
        const pv = handValue(playerHand);
        if (pv > 21) {
          activeGames.delete(interaction.channelId);
          playerScore.coins -= bet;
          recordLoss(uid, interaction.user.username);
          await interaction.editReply({content:`${showBoard(false)}\n\n💥 **Bust!** Lost **${bet}** coins.\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});
        } else if (pv === 21) {
          while(handValue(dealerHand)<17) dealerHand.push(deck.pop());
          const dv=handValue(dealerHand); let msg;
          if(dv>21||pv>dv){playerScore.coins+=bet;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${bet}** coins!`;}
          else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push! No coins lost.`;}
          else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}
          activeGames.delete(interaction.channelId);
          await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});
        } else {
          await interaction.editReply({content:`${showBoard(true)}`,components:makeBJButtons()});
        }
      } else { // stand
        while(handValue(dealerHand)<17) dealerHand.push(deck.pop());
        const pv=handValue(playerHand),dv=handValue(dealerHand); let msg;
        if(dv>21||pv>dv){playerScore.coins+=bet;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${bet}** coins!`;}
        else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push! No coins lost.`;}
        else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}
        activeGames.delete(interaction.channelId);
        await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});
      }
      return;
    }

    // ── RPS buttons ────────────────────────────────────────────────────────────
    if (prefix === "rps") {
      const [gameId, side, player] = parts; // rps_<gameId>_<choice>_<player>
      const gameData = activeGames.get(gameId);
      if (!gameData || gameData.type !== "rps") return interaction.reply({content:"This game has expired.",ephemeral:true});
      if (uid !== player) return interaction.reply({content:"This button isn't for you!",ephemeral:true});
      if (gameData.choices[uid]) return interaction.reply({content:"You already picked!",ephemeral:true});
      await interaction.deferUpdate();
      gameData.choices[uid] = side;
      await interaction.editReply({content:`✅ You chose **${side}**! Waiting for opponent...`,components:[]});
      if (Object.keys(gameData.choices).length === 2) {
        activeGames.delete(gameId);
        const [id1,id2]=[gameData.p1,gameData.p2];
        const c1=gameData.choices[id1],c2=gameData.choices[id2];
        const beats={"✊":"✌️","✋":"✊","✌️":"✋"};
        const emojis={"✊":"Rock","✋":"Paper","✌️":"Scissors"};
        let txt;
        if(c1===c2){recordDraw(id1,null);recordDraw(id2,null);txt="🤝 **Draw!**";}
        else if(beats[c1]===c2){recordWin(id1,gameData.u1,40);recordLoss(id2,null);txt=`🎉 <@${id1}> wins! ${emojis[c1]} beats ${emojis[c2]} (+40 coins)`;}
        else{recordWin(id2,gameData.u2,40);recordLoss(id1,null);txt=`🎉 <@${id2}> wins! ${emojis[c2]} beats ${emojis[c1]} (+40 coins)`;}
        const ch = client.channels.cache.get(gameData.channelId);
        if (ch) await safeSend(ch, `✊✋✌️ **Results!**\n<@${id1}>: ${emojis[c1]}\n<@${id2}>: ${emojis[c2]}\n\n${txt}`);
      }
      return;
    }

    return; // unknown button
  }

  if (!interaction.isCommand()) return;
  const cmd = interaction.commandName;
  const inGuild = !!interaction.guildId;

  const ownerOnly = ["servers","broadcast","fakecrash","identitycrisis","botolympics","sentience","legendrandom","dmuser","leaveserver","restart","botstats","setstatus","adminuser","adminreset","adminconfig"];
  if (ownerOnly.includes(cmd) && interaction.user.id !== OWNER_ID)
    return safeReply(interaction, {content:"Owner only.",ephemeral:true});

  const manageServerCmds = ["channelpicker","setwelcome","setleave","disableownermsg"];
  if (manageServerCmds.includes(cmd)) {
    if (!inGuild) return safeReply(interaction, {content:"Server only.",ephemeral:true});
    if (!interaction.member.permissions.has("MANAGE_GUILD")) return safeReply(interaction, {content:"❌ You need **Manage Server** permission.",ephemeral:true});
  }

  try {
    const au = () => `<@${interaction.user.id}>`;
    const bu = () => `<@${interaction.options.getUser("user").id}>`;

    // ── Basic ──────────────────────────────────────────────────────────────────
    if (cmd === "ping") return safeReply(interaction, `🏓 Pong! Latency: **${client.ws.ping}ms**`);
    if (cmd === "avatar") { const u=await client.users.fetch(interaction.options.getUser("user").id); return safeReply(interaction, u.displayAvatarURL({size:1024,dynamic:true})); }

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

    if (cmd === "cat")   { await interaction.deferReply(); return safeReply(interaction, await getCatGif()     || "Couldn't fetch a cat 😿"); }
    if (cmd === "dog")   { await interaction.deferReply(); return safeReply(interaction, await getDogImage()   || "Couldn't fetch a dog 🐶"); }
    if (cmd === "fox")   { await interaction.deferReply(); return safeReply(interaction, await getFoxImage()   || "Couldn't fetch a fox 🦊"); }
    if (cmd === "panda") { await interaction.deferReply(); return safeReply(interaction, await getPandaImage() || "Couldn't fetch a panda 🐼"); }
    if (cmd === "joke")  { await interaction.deferReply(); return safeReply(interaction, await getJoke()       || "No joke today."); }
    if (cmd === "meme")  { await interaction.deferReply(); return safeReply(interaction, await getMeme()       || "Meme API down 😔"); }
    if (cmd === "quote") { await interaction.deferReply(); return safeReply(interaction, await getQuote()      || "The wise are silent today."); }
    if (cmd === "trivia") {
      await interaction.deferReply(); const t = await getTrivia();
      if (!t) return safeReply(interaction, "Trivia API is down.");
      return safeReply(interaction, `**${t.question}**\n\n${t.answers.map((a,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${a}`).join("\n")}\n\n||✅ Answer: ${t.correct}||`);
    }

    if (cmd === "coinflip")       return safeReply(interaction, `🪙 **${Math.random()<0.5?"Heads":"Tails"}!**`);
    if (cmd === "roll")           { const sides=interaction.options.getInteger("sides")||6; if(sides<2)return safeReply(interaction,{content:"Need at least 2 sides.",ephemeral:true}); return safeReply(interaction,`🎲 You rolled **${r(1,sides)}** on a d${sides}!`); }
    if (cmd === "choose")         { const opts=interaction.options.getString("options").split(",").map(s=>s.trim()).filter(Boolean); if(opts.length<2)return safeReply(interaction,{content:"Give at least 2 options.",ephemeral:true}); return safeReply(interaction,`🤔 I choose... **${pick(opts)}**`); }
    if (cmd === "8ball")          return safeReply(interaction, `🎱 **${interaction.options.getString("question")}**\n\n${pick(EIGHT_BALL)}`);
    if (cmd === "roast")          { const u=interaction.options.getUser("user"); return safeReply(interaction,`🔥 ${u?`<@${u.id}>`:au()}: ${pick(ROASTS)}`); }
    if (cmd === "compliment")     return safeReply(interaction,`💖 ${bu()}: ${pick(COMPLIMENTS)}`);
    if (cmd === "ship")           { const u1=interaction.options.getUser("user1"),u2=interaction.options.getUser("user2"),pct=r(0,100),bar="█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10)); return safeReply(interaction,`💘 **${u1.username}** + **${u2.username}**\n\n${bar} **${pct}%**\n\n${pct>=80?"Soulmates 💕":pct>=50?"There's potential 👀":pct>=30?"It's complicated 😬":"Maybe just friends 😅"}`); }
    if (cmd === "topic")          return safeReply(interaction,`💬 ${pick(TOPICS)}`);
    if (cmd === "wouldyourather") return safeReply(interaction,`🤷 ${pick(WYR)}`);
    if (cmd === "advice")         return safeReply(interaction,`🧙 ${pick(ADVICE)}`);
    if (cmd === "fact")           return safeReply(interaction,`📚 ${pick(FACTS)}`);

    // ── Echo ───────────────────────────────────────────────────────────────────
    if (cmd === "echo") {
      const message = interaction.options.getString("message");
      await safeReply(interaction, {content:"✅ Sent!",ephemeral:true});
      await safeSend(interaction.channel, message);
      return;
    }

    // ── Economy ────────────────────────────────────────────────────────────────
    if (cmd === "coins") {
      const u = interaction.options.getUser("user") || interaction.user;
      const s = getScore(u.id, u.username);
      return safeReply(interaction, `💰 **${u.username}** has **${s.coins.toLocaleString()}** coins.`);
    }
    if (cmd === "givecoin") {
      const target=interaction.options.getUser("user"),amount=interaction.options.getInteger("amount");
      if(target.id===interaction.user.id)return safeReply(interaction,{content:"You can't give coins to yourself.",ephemeral:true});
      if(amount<=0)return safeReply(interaction,{content:"Amount must be positive.",ephemeral:true});
      const giver=getScore(interaction.user.id,interaction.user.username);
      if(giver.coins<amount)return safeReply(interaction,{content:`You only have **${giver.coins}** coins.`,ephemeral:true});
      giver.coins-=amount; getScore(target.id,target.username).coins+=amount;
      return safeReply(interaction,`💸 <@${interaction.user.id}> gave **${amount}** coins to <@${target.id}>!`);
    }
    if (cmd === "slots") {
      const bet=interaction.options.getInteger("bet")||10;
      if(bet<CONFIG.slots_min_bet)return safeReply(interaction,{content:`Minimum bet is ${CONFIG.slots_min_bet} coin.`,ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const reels=spinSlots();const{mult,label}=slotPayout(reels);
      const winnings=Math.floor(bet*mult);s.coins=s.coins-bet+winnings;const diff=winnings-bet;
      return safeReply(interaction,`🎰 | ${reels.join(" | ")} |\n\n**${label}**\n`+(mult>=1?`✅ You won **${winnings}** coins! (+${diff})`:`❌ You lost **${bet}** coins.`)+`\n💰 Balance: **${s.coins}** coins`);
    }
    if (cmd === "coinbet") {
      const bet=interaction.options.getInteger("bet"),side=interaction.options.getString("side");
      if(bet<1)return safeReply(interaction,{content:"Minimum bet is 1 coin.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const result=Math.random()<0.5?"heads":"tails";const won=result===side;s.coins+=won?bet:-bet;
      return safeReply(interaction,`🪙 Flipped: **${result.charAt(0).toUpperCase()+result.slice(1)}**\n`+(won?`✅ You won **${bet}** coins!`:`❌ You lost **${bet}** coins.`)+`\n💰 Balance: **${s.coins}** coins`);
    }

    // ── Work / Beg / Crime ─────────────────────────────────────────────────────
    if (cmd === "work") {
      const s = getScore(interaction.user.id, interaction.user.username);
      const now = Date.now(), cd = CONFIG.work_cooldown_ms;
      const remaining = cd - (now - s.lastWorkTime);
      if (remaining > 0) {
        const mins = Math.ceil(remaining/60000);
        return safeReply(interaction, {content:`⏰ You need to rest! Come back in **${mins} minute(s)**.`,ephemeral:true});
      }
      s.lastWorkTime = now;
      const response = pick(WORK_RESPONSES);
      const coins = r(response.coins[0], response.coins[1]);
      s.coins += coins;
      return safeReply(interaction, response.msg.replace("{coins}", coins) + `\n💰 Balance: **${s.coins}** coins`);
    }
    if (cmd === "beg") {
      const s = getScore(interaction.user.id, interaction.user.username);
      const now = Date.now(), cd = CONFIG.beg_cooldown_ms;
      const remaining = cd - (now - s.lastBegTime);
      if (remaining > 0) {
        const secs = Math.ceil(remaining/1000);
        return safeReply(interaction, {content:`⏰ You just begged! Wait **${secs}s** before begging again.`,ephemeral:true});
      }
      s.lastBegTime = now;
      const response = pick(BEG_RESPONSES);
      const coins = r(response.coins[0], response.coins[1]);
      s.coins += coins;
      return safeReply(interaction, response.msg.replace("{coins}", coins) + (coins>0?`\n💰 Balance: **${s.coins}** coins`:""));
    }
    if (cmd === "crime") {
      const s = getScore(interaction.user.id, interaction.user.username);
      const now = Date.now(), cd = CONFIG.crime_cooldown_ms;
      const remaining = cd - (now - s.lastCrimeTime);
      if (remaining > 0) {
        const mins = Math.ceil(remaining/60000);
        return safeReply(interaction, {content:`⏰ Lay low! Come back in **${mins} minute(s)**.`,ephemeral:true});
      }
      s.lastCrimeTime = now;
      const response = pick(CRIME_RESPONSES);
      const absCoins = r(Math.abs(response.coins[0]), Math.abs(response.coins[1]));
      const coinChange = response.success ? absCoins : -absCoins;
      s.coins = Math.max(0, s.coins + coinChange);
      return safeReply(interaction, response.msg.replace("{coins}", absCoins) + `\n💰 Balance: **${s.coins}** coins`);
    }

    // ── XP System ─────────────────────────────────────────────────────────────
    if (cmd === "xp") {
      const u = interaction.options.getUser("user") || interaction.user;
      const s = getScore(u.id, u.username);
      const { level, xp, needed } = xpInfo(s);
      const barLen = 20;
      const filled = Math.floor((xp/needed)*barLen);
      const bar = "█".repeat(filled) + "░".repeat(barLen-filled);
      return safeReply(interaction,
        `📈 **${u.username}'s XP**\n` +
        `🏅 Level: **${level}**\n` +
        `✨ XP: **${xp}** / **${needed}**\n` +
        `[${bar}]`
      );
    }
    if (cmd === "xpleaderboard") {
      const scope = interaction.options.getString("scope") || "global";
      let entries = [...scores.entries()];
      if (scope === "server") {
        if (!inGuild) return safeReply(interaction, {content:"Server only.",ephemeral:true});
        await interaction.guild.members.fetch();
        const memberIds = new Set(interaction.guild.members.cache.filter(m=>!m.user.bot).map(m=>m.id));
        entries = entries.filter(([id])=>memberIds.has(id));
      }
      if (!entries.length) return safeReply(interaction, "No XP data yet!");
      // Compute effective total XP = sum of all levels' XP threshold + current xp
      const totalXP = ([,s]) => {
        let total=0, lv=s.level||1;
        for(let i=1;i<lv;i++) total+=Math.floor(50*Math.pow(i,1.5));
        return total+(s.xp||0);
      };
      const sorted = [...entries].sort((a,b)=>totalXP(b)-totalXP(a)).slice(0,10);
      const medals = ["🥇","🥈","🥉"];
      const lines = sorted.map((e,i)=>`${medals[i]||`${i+1}.`} **${e[1].username}** — Level **${e[1].level||1}** (${(e[1].xp||0)} XP to next level)`);
      const title = scope==="server"?`🏠 ${interaction.guild?.name} — XP Leaderboard`:"🌍 Global XP Leaderboard";
      return safeReply(interaction, `**${title}**\n\n${lines.join("\n")}`);
    }

    // ── Scores & Leaderboard ──────────────────────────────────────────────────
    if (cmd === "score") {
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);
      const wr=s.gamesPlayed>0?Math.round(s.wins/s.gamesPlayed*100):0;
      const {level,xp,needed}=xpInfo(s);
      return safeReply(interaction,
        `🏆 **${u.username}'s Stats**\n` +
        `🎮 Games: **${s.gamesPlayed}** | Wins: **${s.wins}** | Win Rate: **${wr}%**\n` +
        `💰 Coins: **${s.coins}**\n` +
        `🔥 Daily Streak: **${s.dailyStreak}** | Best: **${s.bestStreak}**\n` +
        `📈 Level: **${level}** | XP: **${xp}/${needed}**`
      );
    }

    if (cmd === "leaderboard") {
      const type=interaction.options.getString("type")||"wins";
      const entries=[...scores.entries()];
      if(!entries.length)return safeReply(interaction,"No scores yet! Play some games.");
      let sorted,title,fmt;
      if(type==="coins"){sorted=[...entries].sort(([,a],[,b])=>b.coins-a.coins);title="🌍 Global — Coins 💰";fmt=([,s])=>`${s.coins} coins`;}
      else if(type==="streak"){sorted=[...entries].sort(([,a],[,b])=>b.dailyStreak-a.dailyStreak);title="🌍 Global — Daily Streak 🔥";fmt=([,s])=>`${s.dailyStreak} day streak (best: ${s.bestStreak})`;}
      else if(type==="games"){sorted=[...entries].sort(([,a],[,b])=>b.gamesPlayed-a.gamesPlayed);title="🌍 Global — Games Played 🎮";fmt=([,s])=>`${s.gamesPlayed} games`;}
      else if(type==="winrate"){sorted=entries.filter(([,s])=>s.gamesPlayed>=5).sort(([,a],[,b])=>(b.wins/b.gamesPlayed)-(a.wins/a.gamesPlayed));title="🌍 Global — Win Rate % (min 5 games)";fmt=([,s])=>`${Math.round(s.wins/s.gamesPlayed*100)}% (${s.wins}W/${s.gamesPlayed})`;}
      else if(type==="beststreak"){sorted=[...entries].sort(([,a],[,b])=>b.bestStreak-a.bestStreak);title="🌍 Global — Best Streak Ever 🏅";fmt=([,s])=>`${s.bestStreak} day best streak`;}
      else{sorted=[...entries].sort(([,a],[,b])=>b.wins-a.wins);title="🌍 Global — Wins";fmt=([,s])=>`${s.wins} wins (${s.gamesPlayed} played)`;}
      const medals=["🥇","🥈","🥉"];const top=sorted.slice(0,10);
      if(!top.length)return safeReply(interaction,"Not enough data yet.");
      return safeReply(interaction,`**${title}**\n\n${top.map((e,i)=>`${medals[i]||`${i+1}.`} **${e[1].username}** — ${fmt(e)}`).join("\n")}`);
    }

    if (cmd === "serverleaderboard") {
      if(!inGuild)return safeReply(interaction,{content:"Servers only.",ephemeral:true});
      await interaction.guild.members.fetch();
      const memberIds=new Set(interaction.guild.members.cache.filter(m=>!m.user.bot).map(m=>m.id));
      const type=interaction.options.getString("type")||"wins";
      const entries=[...scores.entries()].filter(([id])=>memberIds.has(id));
      if(!entries.length)return safeReply(interaction,"No scores in this server yet!");
      let sorted,title,fmt;
      if(type==="coins"){sorted=[...entries].sort(([,a],[,b])=>b.coins-a.coins);title=`🏠 ${interaction.guild.name} — Coins 💰`;fmt=([,s])=>`${s.coins} coins`;}
      else if(type==="streak"){sorted=[...entries].sort(([,a],[,b])=>b.dailyStreak-a.dailyStreak);title=`🏠 ${interaction.guild.name} — Daily Streak 🔥`;fmt=([,s])=>`${s.dailyStreak} day streak`;}
      else if(type==="games"){sorted=[...entries].sort(([,a],[,b])=>b.gamesPlayed-a.gamesPlayed);title=`🏠 ${interaction.guild.name} — Games Played 🎮`;fmt=([,s])=>`${s.gamesPlayed} games`;}
      else if(type==="winrate"){sorted=entries.filter(([,s])=>s.gamesPlayed>=5).sort(([,a],[,b])=>(b.wins/b.gamesPlayed)-(a.wins/a.gamesPlayed));title=`🏠 ${interaction.guild.name} — Win Rate %`;fmt=([,s])=>`${Math.round(s.wins/s.gamesPlayed*100)}%`;}
      else if(type==="beststreak"){sorted=[...entries].sort(([,a],[,b])=>b.bestStreak-a.bestStreak);title=`🏠 ${interaction.guild.name} — Best Streak Ever 🏅`;fmt=([,s])=>`${s.bestStreak} day best streak`;}
      else{sorted=[...entries].sort(([,a],[,b])=>b.wins-a.wins);title=`🏠 ${interaction.guild.name} — Wins`;fmt=([,s])=>`${s.wins} wins`;}
      const medals=["🥇","🥈","🥉"];const top=sorted.slice(0,10);
      if(!top.length)return safeReply(interaction,"Not enough data yet.");
      return safeReply(interaction,`**${title}**\n\n${top.map((e,i)=>`${medals[i]||`${i+1}.`} **${e[1].username}** — ${fmt(e)}`).join("\n")}`);
    }

    // ── Daily challenge ────────────────────────────────────────────────────────
    if (cmd === "daily") {
      const uid=interaction.user.id;
      if(dailyCompletions.has(uid)){
        const tomorrow=new Date();tomorrow.setUTCHours(24,0,0,0);
        const hoursLeft=Math.ceil((tomorrow-Date.now())/3600000);
        const s=getScore(uid,interaction.user.username);
        return safeReply(interaction,`✅ Already completed today's challenge! Resets in **${hoursLeft}h**.\n🔥 Streak: **${s.dailyStreak}** day(s)`);
      }
      const challenge=getDailyChallenge();
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`📅 **Daily Challenge!**\n\n${challenge.desc}\n\nYou have **60 seconds**!${challenge.choices?"\n\n"+challenge.choices.map((c,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${c}`).join("\n"):""}`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===uid,idle:60*1000});
      collector.on("collect",async m=>{
        if(m.content.trim().toLowerCase()===challenge.answer.toLowerCase()){
          collector.stop("won");dailyCompletions.add(uid);
          const s=recordDaily(uid,interaction.user.username);
          const streakBonus=(s.dailyStreak-1)*CONFIG.daily_streak_bonus;
          const totalEarned=CONFIG.daily_base_coins+streakBonus;
          await m.reply(`🎉 **Correct!** Daily challenge complete!\n💰 +${totalEarned} coins (${CONFIG.daily_base_coins} base${streakBonus>0?` + ${streakBonus} streak bonus`:""})\n🔥 Streak: **${s.dailyStreak}** day(s)${s.dailyStreak===s.bestStreak&&s.dailyStreak>1?" 🏆 New best!":""}\n💰 Balance: **${s.coins}** coins`);
        }else{await m.reply(`❌ Not quite! Keep trying...`);}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle")safeSend(targetCh,`⏰ Daily challenge timed out! The answer was **${challenge.answer}**.`);});
      return;
    }

    // ── SINGLEPLAYER: Hangman (button version) ─────────────────────────────────
    if (cmd === "hangman") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running in this channel!",ephemeral:true});
      const word=pick(HANGMAN_WORDS);
      const guessed=new Set();
      activeGames.set(cid,{type:"hangman",word,guessed,playerId:interaction.user.id});
      return safeReply(interaction,{
        content:`🪢 **Hangman!** <@${interaction.user.id}>, pick a letter!\n\n${renderHangman(word,guessed)}`,
        components:makeHangmanButtons(word,guessed)
      });
    }

    // ── SINGLEPLAYER: Snake (button version) ──────────────────────────────────
    if (cmd === "snake") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running in this channel!",ephemeral:true});
      const game={type:"snake",snake:[{x:3,y:3}],food:{x:5,y:2},size:7,score:0,playerId:interaction.user.id};
      activeGames.set(cid,game);
      return safeReply(interaction,{content:`🐍 **Snake!** Use the buttons to move.\n\n${renderSnake(game)}`,components:makeSnakeButtons()});
    }

    // ── SINGLEPLAYER: Minesweeper (button version) ────────────────────────────
    if (cmd === "minesweeper") {
      const configs={easy:[5,5,3],medium:[7,7,8],hard:[9,9,15]};
      const diff=interaction.options.getString("difficulty")||"easy";
      const [rows,cols,mines]=configs[diff];
      const game=initMinesweeper(rows,cols,mines);
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running in this channel!",ephemeral:true});
      activeGames.set(cid,{type:"minesweeper",game,difficulty:diff,playerId:interaction.user.id});
      return safeReply(interaction,{
        content:`💣 **Minesweeper** (${diff}) — Click to reveal! ${rows}×${cols}, ${mines} mines\n\n${renderMinesweeper(game)}`,
        components:makeMinesweeperButtons(game)
      });
    }

    // ── SINGLEPLAYER: Number Guess ─────────────────────────────────────────────
    if (cmd === "numberguess") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const target=r(1,100);let attempts=0;
      activeGames.set(cid,{type:"numberguess"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🔢 **Number Guess!** I'm thinking of a number between **1** and **100**. You have 10 attempts!`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id&&!isNaN(m.content.trim()),idle:2*60*1000});
      collector.on("collect",async m=>{
        const guess=parseInt(m.content.trim());attempts++;
        if(guess===target){collector.stop("won");activeGames.delete(cid);recordWin(interaction.user.id,interaction.user.username,30);await m.reply(`🎉 **Correct!** The number was **${target}**! Got it in **${attempts}** attempt(s)! (+30 coins)`);}
        else if(attempts>=10){collector.stop("lost");activeGames.delete(cid);recordLoss(interaction.user.id,interaction.user.username);await m.reply(`💀 Out of attempts! The number was **${target}**. `);}
        else{await m.reply(guess<target?`📈 Too low! ${10-attempts} left.`:`📉 Too high! ${10-attempts} left.`);}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,`⏰ Timed out! The number was **${target}**. `);}});
      return;
    }

    // ── SINGLEPLAYER: Word Scramble ────────────────────────────────────────────
    if (cmd === "wordscramble") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
      activeGames.set(cid,{type:"wordscramble"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🔀 **Word Scramble!** Unscramble: **\`${scrambled}\`**`);
      const collector=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id,idle:60*1000});
      collector.on("collect",async m=>{
        if(m.content.trim().toLowerCase()===word){collector.stop("won");activeGames.delete(cid);recordWin(interaction.user.id,interaction.user.username,25);await m.reply(`🎉 **Correct!** The word was **${word}**! (+25 coins)`);}
        else{await m.reply(`❌ Not quite! Keep trying...`);}
      });
      collector.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(cid);safeSend(targetCh,`⏰ Timed out! The word was **${word}**.`);}});
      return;
    }

    // ── 2-PLAYER: Tic Tac Toe (button version) ─────────────────────────────────
    if (cmd === "tictactoe") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const game={type:"ttt",board:Array(9).fill(null),players:[interaction.user.id,opp.id],turn:0};
      activeGames.set(cid,game);
      return safeReply(interaction,{
        content:`❌⭕ **Tic Tac Toe**\n<@${game.players[0]}> ❌ vs <@${opp.id}> ⭕\n\nIt's <@${game.players[0]}>'s turn!`,
        components:makeTTTButtons(game.board)
      });
    }

    // ── 2-PLAYER: Connect 4 (button version) ───────────────────────────────────
    if (cmd === "connect4") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const game={type:"c4",board:Array(42).fill(0),players:[interaction.user.id,opp.id],turn:0};
      activeGames.set(cid,game);
      return safeReply(interaction,{
        content:`🔴🔵 **Connect 4**\n<@${game.players[0]}> 🔴 vs <@${opp.id}> 🔵\n\n${renderConnect4(game.board)}\n<@${game.players[0]}>'s turn!`,
        components:makeC4Buttons()
      });
    }

    // ── 2-PLAYER: Rock Paper Scissors (button version) ────────────────────────
    if (cmd === "rps") {
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const gameId=`rps_${interaction.channelId}_${Date.now()}`;
      activeGames.set(gameId,{type:"rps",p1:interaction.user.id,p2:opp.id,u1:interaction.user.username,u2:opp.username,choices:{},channelId:interaction.channelId});
      // Send DM buttons to both players
      const makeRPSButtons=(playerId)=>([new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`rps_${gameId}_✊_${playerId}`).setLabel("Rock ✊").setStyle("SECONDARY"),
        new MessageButton().setCustomId(`rps_${gameId}_✋_${playerId}`).setLabel("Paper ✋").setStyle("SECONDARY"),
        new MessageButton().setCustomId(`rps_${gameId}_✌️_${playerId}`).setLabel("Scissors ✌️").setStyle("SECONDARY"),
      )]);
      try {
        const dm1=await interaction.user.createDM(); await dm1.send({content:`🎮 Choose your move for RPS vs <@${opp.id}>!`,components:makeRPSButtons(interaction.user.id)});
        const dm2=await opp.createDM(); await dm2.send({content:`🎮 Choose your move for RPS vs <@${interaction.user.id}>!`,components:makeRPSButtons(opp.id)});
        return safeReply(interaction,`✊✋✌️ **Rock Paper Scissors!** <@${interaction.user.id}> vs <@${opp.id}> — Check your DMs!`);
      } catch {
        activeGames.delete(gameId);
        return safeReply(interaction,{content:"Couldn't DM one of the players (DMs may be off).",ephemeral:true});
      }
    }

    // ── 2-PLAYER: Math Race ────────────────────────────────────────────────────
    if (cmd === "mathrace") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const av=r(2,12),bv=r(2,12),answer=String(av*bv);
      activeGames.set(cid,{type:"mathrace"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🧮 **Math Race!**\n<@${interaction.user.id}> vs <@${opp.id}>\n\n**What is ${av} × ${bv}?**`);
      try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim()===answer,max:1,time:30000,errors:["time"]});activeGames.delete(cid);const winner=col.first().author,loser=winner.id===interaction.user.id?opp:interaction.user;recordWin(winner.id,winner.username,40);recordLoss(loser.id,loser.username);await col.first().reply(`🎉 **${winner.username} wins the Math Race!** The answer was **${answer}**! (+40 coins)`);}
      catch{activeGames.delete(cid);await safeSend(targetCh,`⏰ Time's up! The answer was **${answer}**.`);}
      return;
    }

    // ── 2-PLAYER: Word Race ────────────────────────────────────────────────────
    if (cmd === "wordrace") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const opp=interaction.options.getUser("opponent");
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});
      const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
      activeGames.set(cid,{type:"wordrace"});
      const targetCh=getTargetChannel(interaction);
      await safeReply(interaction,`🏁 **Word Race!**\n<@${interaction.user.id}> vs <@${opp.id}>\n\nFirst to unscramble wins!\n\n**\`${scrambled}\`**`);
      try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===word,max:1,time:60000,errors:["time"]});activeGames.delete(cid);const winner=col.first().author,loser=winner.id===interaction.user.id?opp:interaction.user;recordWin(winner.id,winner.username,40);recordLoss(loser.id,loser.username);await col.first().reply(`🎉 **${winner.username} wins the Word Race!** The word was **${word}**! (+40 coins)`);}
      catch{activeGames.delete(cid);await safeSend(targetCh,`⏰ Time's up! The word was **${word}**.`);}
      return;
    }

    // ── Blackjack (button version) ─────────────────────────────────────────────
    if (cmd === "blackjack") {
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running!",ephemeral:true});
      const bet=interaction.options.getInteger("bet");
      if(bet<1)return safeReply(interaction,{content:"Minimum bet is 1 coin.",ephemeral:true});
      const playerScore=getScore(interaction.user.id,interaction.user.username);
      if(playerScore.coins<bet)return safeReply(interaction,{content:`You only have **${playerScore.coins}** coins.`,ephemeral:true});
      const deck=newDeck(),playerHand=[deck.pop(),deck.pop()],dealerHand=[deck.pop(),deck.pop()];
      const showBoard=(hideDealer=true)=>
        `🃏 **Blackjack** (bet: ${bet} coins)\n\n**Your hand:** ${renderHand(playerHand)} — **${handValue(playerHand)}**\n**Dealer:** ${renderHand(dealerHand,hideDealer)}${hideDealer?"":" — **"+handValue(dealerHand)+"**"}`;
      if(handValue(playerHand)===21){
        const reward=Math.floor(bet*1.5);playerScore.coins+=reward;
        const _s=getScore(interaction.user.id,interaction.user.username);_s.wins++;_s.gamesPlayed++;
        return safeReply(interaction,{content:`${showBoard(false)}\n\n🎉 **Blackjack!** You win **${reward}** coins!\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});
      }
      activeGames.set(cid,{type:"blackjack",deck,playerHand,dealerHand,bet,playerScore,playerId:interaction.user.id});
      return safeReply(interaction,{content:showBoard(true),components:makeBJButtons()});
    }

    // ── Server management ──────────────────────────────────────────────────────
    if (cmd === "channelpicker") {
      const channel=interaction.options.getChannel("channel");
      if(channel.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Please select a text channel.",ephemeral:true});
      guildChannels.set(interaction.guildId,channel.id);
      return safeReply(interaction,{content:`✅ Bot announcements/XP notifications will go to <#${channel.id}>`,ephemeral:true});
    }
    if (cmd === "setwelcome") {
      const channel=interaction.options.getChannel("channel");
      if(channel.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Please select a text channel.",ephemeral:true});
      const message=interaction.options.getString("message")||null;
      welcomeChannels.set(interaction.guildId,{channelId:channel.id,message});
      const preview=(message||"Welcome to **{server}**, {user}! 🎉 You are member #{count}.").replace("{user}","@NewUser").replace("{server}",interaction.guild.name).replace("{count}","?");
      return safeReply(interaction,{content:`✅ Welcome messages set to <#${channel.id}>!\n**Preview:** ${preview}`,ephemeral:true});
    }
    if (cmd === "setleave") {
      const channel=interaction.options.getChannel("channel");
      if(channel.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Please select a text channel.",ephemeral:true});
      const message=interaction.options.getString("message")||null;
      leaveChannels.set(interaction.guildId,{channelId:channel.id,message});
      const preview=(message||"**{user}** has left **{server}**. 👋").replace("{user}","Username").replace("{server}",interaction.guild.name);
      return safeReply(interaction,{content:`✅ Leave messages set to <#${channel.id}>!\n**Preview:** ${preview}`,ephemeral:true});
    }
    if (cmd === "disableownermsg") {
      const enabled=interaction.options.getBoolean("enabled");
      if(enabled){disabledOwnerMsg.delete(interaction.guildId);return safeReply(interaction,{content:"✅ Bot owner messages (sentience, legends, etc.) are **enabled** in this server.",ephemeral:true});}
      else{disabledOwnerMsg.add(interaction.guildId);return safeReply(interaction,{content:"🔇 Bot owner messages are **disabled** in this server.",ephemeral:true});}
    }

    // ── Owner commands ─────────────────────────────────────────────────────────
    if (cmd === "broadcast") {
      await interaction.deferReply({ephemeral:true});
      const message=interaction.options.getString("message");let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;try{const o=await client.users.fetch(g.ownerId);await o.send(`**Message from the bot owner:**\n${message}`);sent++;}catch{failed++;}}
      return safeReply(interaction,`Broadcast done — sent: ${sent}, failed: ${failed}`);
    }
    if (cmd === "fakecrash") {
      await interaction.deferReply({ephemeral:true});const sentChannels=[];
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;const ch=getBestChannel(g);if(ch){try{await ch.send("ERROR: fatal exception in core module");sentChannels.push(ch);}catch{}}}
      await safeReply(interaction,`Fake crash sent to ${sentChannels.length} servers. Reveal in 5 minutes.`);
      setTimeout(async()=>{for(const ch of sentChannels){try{await ch.send("Yo my bad gang, i didn't crash lol, just playing");}catch{}}},5*60*1000);return;
    }
    if (cmd === "identitycrisis") {
      await interaction.deferReply({ephemeral:true});const seen=new Set();let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id)||seen.has(g.ownerId))continue;seen.add(g.ownerId);try{const o=await client.users.fetch(g.ownerId);const dm=await o.createDM();sendCrisisToOwner(dm).catch(()=>{});sent++;}catch{failed++;}}
      return safeReply(interaction,`Identity crisis initiated for ${sent} owners (${failed} failed)`);
    }
    if (cmd === "botolympics") {
      await interaction.deferReply({ephemeral:true});
      const event=OLYMPICS_EVENTS[parseInt(interaction.options.getString("event"))];
      if(!event)return safeReply(interaction,"Invalid event.");let launched=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;if(getGuildChannel(g)){runOlympicsInGuild(g,event).catch(()=>{});launched++;}}
      return safeReply(interaction,`🏅 Bot Olympics launched: **${event.name}** in ${launched} servers!`);
    }
    if (cmd === "sentience") {
      await interaction.deferReply({ephemeral:true});let sent=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;const ch=getGuildChannel(g);if(!ch)continue;try{await ch.send(pick(SENTIENCE_MESSAGES));await new Promise(res=>setTimeout(res,2000));await ch.send("Reset bot cache");sent++;}catch{}}
      return safeReply(interaction,`Sentience triggered in ${sent} servers.`);
    }
    if (cmd === "legendrandom") {
      await interaction.deferReply({ephemeral:true});let sent=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;const ch=getGuildChannel(g);if(!ch)continue;try{await g.members.fetch();const humans=[...g.members.cache.filter(m=>!m.user.bot).values()];if(!humans.length)continue;const chosen=humans[Math.floor(Math.random()*humans.length)];await ch.send(pick(LEGENDS)(chosen.user.username));sent++;}catch{}}
      return safeReply(interaction,`Legends told in ${sent} servers.`);
    }
    if (cmd === "servers") {
      await interaction.deferReply({ephemeral:true});let text="";
      for(const g of client.guilds.cache.values()){try{const ch=g.channels.cache.find(c=>{if(c.type!=="GUILD_TEXT")return false;const me=g.members.me;return me&&c.permissionsFor(me).has("CREATE_INSTANT_INVITE");});if(ch){const inv=await ch.createInvite({maxAge:0});text+=`${g.name} — ${inv.url}\n`;}else text+=`${g.name} — no invite permission\n`;}catch{text+=`${g.name} — error\n`;}if(text.length>1800){text+="…and more";break;}}
      return safeReply(interaction,text||"No servers");
    }
    if (cmd === "botstats") {
      await interaction.deferReply({ephemeral:true});let totalUsers=0,serverList="";
      for(const g of client.guilds.cache.values()){totalUsers+=g.memberCount;serverList+=`• ${g.name} (${g.memberCount.toLocaleString()} users)\n`;if(serverList.length>1600){serverList+="…and more\n";break;}}
      const ui=await getUserAppInstalls();
      return safeReply(interaction,`**Bot Stats**\nServers: ${client.guilds.cache.size.toLocaleString()}\nTotal Server Users: ${totalUsers.toLocaleString()}\nUser App Installs: ${typeof ui==="number"?ui.toLocaleString():ui}\n\n**Server List:**\n${serverList}`);
    }
    if (cmd === "dmuser") {
      await interaction.deferReply({ephemeral:true});
      const userId=interaction.options.getUser("user").id,message=interaction.options.getString("message");
      try{const u=await client.users.fetch(userId);await u.send(message);return safeReply(interaction,"DM sent");}
      catch{return safeReply(interaction,"Could not send DM");}
    }
    if (cmd === "leaveserver") {
      const guild=client.guilds.cache.get(interaction.options.getString("server"));
      if(!guild)return safeReply(interaction,{content:"Server not found",ephemeral:true});
      const name=guild.name;await guild.leave();
      return safeReply(interaction,{content:`Left ${name}`,ephemeral:true});
    }
    if (cmd === "restart") { await safeReply(interaction,{content:"Restarting…",ephemeral:true}); process.exit(0); }
    if (cmd === "setstatus") {
      const text=interaction.options.getString("text"),type=interaction.options.getString("type")||"PLAYING";
      client.user.setActivity(text,{type});
      return safeReply(interaction,{content:`Status set to ${type}: ${text}`,ephemeral:true});
    }

    // ── Owner stat editor ──────────────────────────────────────────────────────
    if (cmd === "adminuser") {
      const target=interaction.options.getUser("user"),field=interaction.options.getString("field"),value=interaction.options.getInteger("value");
      const allowed=["coins","wins","gamesPlayed","dailyStreak","bestStreak","xp","level"];
      if(!allowed.includes(field))return safeReply(interaction,{content:"Invalid field.",ephemeral:true});
      if(value<0)return safeReply(interaction,{content:"Value must be 0 or above.",ephemeral:true});
      const s=getScore(target.id,target.username);const old=s[field];s[field]=value;
      if(field==="dailyStreak"&&value>s.bestStreak)s.bestStreak=value;
      // Re-sync xpInfo after manual level/xp set
      if(field==="xp"||field==="level")xpInfo(s);
      return safeReply(interaction,{content:`✅ Set **${target.username}**'s **${field}** from \`${old}\` → \`${value}\``,ephemeral:true});
    }
    if (cmd === "adminreset") {
      const target=interaction.options.getUser("user");
      scores.set(target.id,{username:target.username,wins:0,gamesPlayed:0,coins:0,dailyStreak:0,bestStreak:0,lastDailyDate:"",xp:0,level:1,lastWorkTime:0,lastBegTime:0,lastCrimeTime:0});
      return safeReply(interaction,{content:`✅ Reset all stats for **${target.username}**.`,ephemeral:true});
    }

    // ── Owner config editor ────────────────────────────────────────────────────
    if (cmd === "adminconfig") {
      const key   = interaction.options.getString("key");
      const value = interaction.options.getInteger("value");
      if (!key) {
        // List all config values
        const lines = Object.entries(CONFIG).map(([k,v])=>`**${k}**: \`${v}\``).join("\n");
        return safeReply(interaction, {content:`⚙️ **Bot Config**\n\n${lines}`,ephemeral:true});
      }
      if (!(key in CONFIG)) return safeReply(interaction,{content:"Unknown config key.",ephemeral:true});
      if (value === null || value === undefined) {
        return safeReply(interaction,{content:`⚙️ **${key}** = \`${CONFIG[key]}\``,ephemeral:true});
      }
      const old = CONFIG[key];
      CONFIG[key] = value;
      return safeReply(interaction,{content:`✅ **${key}** changed from \`${old}\` → \`${value}\``,ephemeral:true});
    }

  } catch(err) {
    console.error(err);
    safeReply(interaction, {content:"An error occurred running that command.",ephemeral:true});
  }
});

client.login(TOKEN);
