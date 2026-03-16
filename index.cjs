"use strict";
const { Client, Intents, MessageActionRow, MessageButton, MessageSelectMenu } = require("discord.js");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_IDS = ["1419803002771865722","969280648667889764"];
const OWNER_ID  = OWNER_IDS[1];
const GAY_IDS   = ["1245284545452834857","1413943805203189800"];

// ── Instance lock ─────────────────────────────────────────────────────────────
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
const LOCK_PREFIX  = "BOT_INSTANCE_LOCK:";
let instanceLocked = false;

async function acquireInstanceLock(ownerUser) {
  try {
    const dm     = await ownerUser.createDM();
    const recent = await dm.messages.fetch({ limit: 20 });
    const now    = Date.now();
    const competing = recent.find(m =>
      m.author.id === CLIENT_ID &&
      m.content.startsWith(LOCK_PREFIX) &&
      !m.content.includes(INSTANCE_ID) &&
      (now - m.createdTimestamp) < 15000
    );
    if (competing) { console.log(`[${INSTANCE_ID}] Duplicate — exiting.`); process.exit(0); }
    await dm.send(`${LOCK_PREFIX}${INSTANCE_ID}:${now}`);
    instanceLocked = true;
    console.log(`[${INSTANCE_ID}] Lock acquired.`);
  } catch(e) { console.error("Lock failed:", e); instanceLocked = true; }
}

// ── State ─────────────────────────────────────────────────────────────────────
const guildChannels    = new Map();
const welcomeChannels  = new Map();
const leaveChannels    = new Map();
const boostChannels    = new Map();
const autoRoles        = new Map();
const reactionRoles    = new Map();
const disabledOwnerMsg = new Set();
const activeGames      = new Map();
const reminders        = [];
const countGames       = new Map();
const inviteComps      = new Map();
const inviteCache      = new Map();
const ticketConfigs    = new Map();
const openTickets      = new Map();
const disabledLevelUp  = new Set(); // legacy — now superseded by levelUpConfig.enabled
const userInstalls     = new Set();
// Per-guild XP level-up notification config
// { enabled: bool, ping: bool, channelId: string|null }
// enabled: whether to post at all (default true)
// ping:    whether to @mention the user (default true)
// channelId: override channel — null means use guildChannels fallback then same-channel
const levelUpConfig    = new Map(); // guildId -> { enabled, ping, channelId }

// ── Scores ────────────────────────────────────────────────────────────────────
// FIX: scores MUST be declared before loadData() so loadData can populate it
const scores = new Map();

function getScore(userId, username) {
  if (!scores.has(userId)) scores.set(userId, {
    username, wins:0, gamesPlayed:0, coins:0,
    dailyStreak:0, bestStreak:0, lastDailyDate:"",
    xp:0, level:1,
    lastWorkTime:0, lastBegTime:0, lastCrimeTime:0, lastRobTime:0,
    inventory:[], marriedTo:null
  });
  const s = scores.get(userId);
  if (username) s.username = username;
  if (s.xp            == null) s.xp            = 0;
  if (s.level         == null) s.level         = 1;
  if (s.lastWorkTime  == null) s.lastWorkTime  = 0;
  if (s.lastBegTime   == null) s.lastBegTime   = 0;
  if (s.lastCrimeTime == null) s.lastCrimeTime = 0;
  if (s.lastRobTime   == null) s.lastRobTime   = 0;
  if (s.inventory     == null) s.inventory     = [];
  if (s.marriedTo     == null) s.marriedTo     = null;
  if (s.dailyStreak   == null) s.dailyStreak   = 0;
  if (s.bestStreak    == null) s.bestStreak    = 0;
  if (s.lastDailyDate == null) s.lastDailyDate = "";
  return s;
}
function recordWin(uid, uname, coins=50)  { const s=getScore(uid,uname); s.wins++; s.gamesPlayed++; s.coins+=coins; }
function recordLoss(uid, uname)            { const s=getScore(uid,uname); s.gamesPlayed++; }
function recordDraw(uid, uname)            { const s=getScore(uid,uname); s.gamesPlayed++; s.coins+=10; }

// ── XP ────────────────────────────────────────────────────────────────────────
function xpForNextLevel(lv) { return Math.floor(50*Math.pow(lv,1.5)); }
function xpInfo(s) {
  let lv=s.level||1, xp=s.xp||0, needed=xpForNextLevel(lv);
  while(xp>=needed){ xp-=needed; lv++; needed=xpForNextLevel(lv); }
  s.level=lv; s.xp=xp; return{level:lv,xp,needed};
}
const xpCooldown = new Map();
function tryAwardXP(uid, uname) {
  const now=Date.now(), last=xpCooldown.get(uid)||0;
  if(now-last<60000) return null;
  xpCooldown.set(uid,now);
  const s=getScore(uid,uname); const oldLv=s.level;
  s.xp+=r(CONFIG.xp_per_msg_min, CONFIG.xp_per_msg_max);
  xpInfo(s);
  return s.level>oldLv ? s.level : null;
}

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  xp_per_msg_min:5, xp_per_msg_max:15,
  work_cooldown_ms:3600000, beg_cooldown_ms:300000,
  crime_cooldown_ms:7200000, rob_cooldown_ms:3600000,
  daily_base_coins:100, daily_streak_bonus:10,
  slots_min_bet:1, game_win_coins:50, game_draw_coins:10,
  olympics_win_coins:75, starting_coins:100,
};

// ── Persistence ──────────────────────────────────────────────────────────────
const DATA_FILE = "./botdata.json";
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO  = process.env.GITHUB_REPOSITORY;
let   _commitTimer = null;

async function commitDataToGitHub(jsonString) {
  if (!GH_TOKEN || !GH_REPO) return;
  try {
    const getOpts = {
      hostname: "api.github.com", port: 443,
      path: `/repos/${GH_REPO}/contents/botdata.json`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        "User-Agent":  "discord-bot",
        Accept:        "application/vnd.github+json",
      }
    };
    const existing = await new Promise(resolve => {
      const req = https.request(getOpts, res => {
        let b = ""; res.on("data", c => b += c);
        res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.end();
    });
    const sha = existing?.sha || null;

    const encoded = Buffer.from(jsonString).toString("base64");
    const body = JSON.stringify({
      message: "chore: auto-save botdata",
      content: encoded,
      ...(sha ? { sha } : {}),
    });
    const putOpts = {
      hostname: "api.github.com", port: 443,
      path: `/repos/${GH_REPO}/contents/botdata.json`,
      method: "PUT",
      headers: {
        Authorization:  `Bearer ${GH_TOKEN}`,
        "User-Agent":   "discord-bot",
        Accept:         "application/vnd.github+json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      }
    };
    await new Promise((resolve, reject) => {
      const req = https.request(putOpts, res => {
        let b = ""; res.on("data", c => b += c);
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log("✅ botdata.json committed to GitHub");
          } else {
            console.warn(`⚠️  GitHub commit HTTP ${res.statusCode}: ${b.slice(0,200)}`);
          }
          resolve();
        });
      });
      req.on("error", reject);
      req.write(body); req.end();
    });
  } catch(e) { console.error("commitDataToGitHub error:", e.message); }
}

function buildDataObject() {
  return {
    ticketConfigs:    [...ticketConfigs.entries()],
    openTickets:      [...openTickets.entries()],
    guildChannels:    [...guildChannels.entries()],
    welcomeChannels:  [...welcomeChannels.entries()],
    leaveChannels:    [...leaveChannels.entries()],
    boostChannels:    [...boostChannels.entries()],
    autoRoles:        [...autoRoles.entries()],
    reactionRoles:    [...reactionRoles.entries()],
    disabledOwnerMsg: [...disabledOwnerMsg],
    disabledLevelUp:  [...disabledLevelUp],
    levelUpConfig:    [...levelUpConfig.entries()],
    userInstalls:     [...userInstalls],
    scores:           [...scores.entries()],
  };
}

function saveData() {
  try {
    const json = JSON.stringify(buildDataObject(), null, 2);
    fs.writeFileSync(DATA_FILE, json);
    if (_commitTimer) clearTimeout(_commitTimer);
    _commitTimer = setTimeout(() => {
      _commitTimer = null;
      commitDataToGitHub(json).catch(e => console.error("commit error:", e.message));
    }, 3_000);
  } catch(e) { console.error("saveData error:", e.message); }
}

// FIX: immediate commit (no debounce) for use on process exit
async function saveDataAndCommitNow() {
  try {
    if (_commitTimer) { clearTimeout(_commitTimer); _commitTimer = null; }
    const json = JSON.stringify(buildDataObject(), null, 2);
    fs.writeFileSync(DATA_FILE, json);
    await commitDataToGitHub(json);
  } catch(e) { console.error("saveDataAndCommitNow error:", e.message); }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) { console.log("No botdata.json found, starting fresh."); return; }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw || !raw.trim()) { console.log("botdata.json is empty, starting fresh."); return; }
    const data = JSON.parse(raw);
    if (data.ticketConfigs)    data.ticketConfigs   .forEach(([k,v]) => ticketConfigs.set(k, v));
    if (data.openTickets)      data.openTickets     .forEach(([k,v]) => openTickets.set(k, v));
    if (data.guildChannels)    data.guildChannels   .forEach(([k,v]) => guildChannels.set(k, v));
    if (data.welcomeChannels)  data.welcomeChannels .forEach(([k,v]) => welcomeChannels.set(k, v));
    if (data.leaveChannels)    data.leaveChannels   .forEach(([k,v]) => leaveChannels.set(k, v));
    if (data.boostChannels)    data.boostChannels   .forEach(([k,v]) => boostChannels.set(k, v));
    if (data.autoRoles)        data.autoRoles       .forEach(([k,v]) => autoRoles.set(k, v));
    if (data.reactionRoles)    data.reactionRoles   .forEach(([k,v]) => reactionRoles.set(k, v));
    if (data.disabledOwnerMsg) data.disabledOwnerMsg.forEach(v => disabledOwnerMsg.add(v));
    if (data.disabledLevelUp)  data.disabledLevelUp .forEach(v => disabledLevelUp.add(v));
    if (data.levelUpConfig)    data.levelUpConfig    .forEach(([k,v]) => levelUpConfig.set(k, v));
    if (data.userInstalls)     data.userInstalls    .forEach(v => userInstalls.add(v));
    if (data.scores)           data.scores          .forEach(([k,v]) => scores.set(k, v));
    console.log(`✅ Data loaded — ${ticketConfigs.size} ticket configs, ${reactionRoles.size} reaction roles, ${scores.size} scores, ${guildChannels.size} channels`);
  } catch(e) { console.error("loadData error:", e.message); }
}

// Load data at startup — scores/maps are declared above so this works correctly now
loadData();

// Auto-save every 2 minutes
setInterval(() => saveData(), 2 * 60 * 1000);

// FIX: On graceful shutdown, await the commit before exiting so GitHub Actions captures the data
process.on("SIGTERM", async () => {
  console.log("SIGTERM received — saving and committing data");
  await saveDataAndCommitNow();
  process.exit(0);
});
process.on("SIGINT", async () => {
  console.log("SIGINT received — saving and committing data");
  await saveDataAndCommitNow();
  process.exit(0);
});
// Synchronous fallback for unexpected exits
process.on("exit", () => {
  try {
    const json = JSON.stringify(buildDataObject(), null, 2);
    fs.writeFileSync(DATA_FILE, json);
  } catch {}
});

function recordDaily(uid, uname) {
  const s=getScore(uid,uname);
  const today=new Date().toISOString().slice(0,10);
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  if(s.lastDailyDate===yesterday) s.dailyStreak++;
  else if(s.lastDailyDate===today) return s;
  else s.dailyStreak=1;
  s.lastDailyDate=today;
  if(s.dailyStreak>s.bestStreak) s.bestStreak=s.dailyStreak;
  s.coins+=CONFIG.daily_base_coins+(s.dailyStreak-1)*CONFIG.daily_streak_bonus;
  return s;
}

// ── Daily challenge ───────────────────────────────────────────────────────────
let dailyChallenge=null, dailyDate="";
const dailyCompletions=new Set();
const HANGMAN_WORDS=["discord","javascript","keyboard","penguin","asteroid","jellyfish","xylophone","labyrinth","cinnamon","algorithm","saxophone","quarterback","zeppelin","archipelago","mischievous","thunderstorm","catastrophe","whirlpool","mysterious","magnificent","avalanche","crocodile","philosophy","rhinoceros","trampoline"];
const DAILY_CHALLENGES=[
  {desc:"Solve: **{a} × {b} + {c}**",gen:()=>{const a=r(2,12),b=r(2,12),c=r(1,20);return{params:{a,b,c},answer:String(a*b+c)};}},
  {desc:"Unscramble: **`{w}`**",gen:()=>{const w=pick(HANGMAN_WORDS),sc=w.split("").sort(()=>Math.random()-0.5).join("");return{params:{w:sc},answer:w};}},
  {desc:"How many letters in: **{word}**?",gen:()=>{const word=pick(HANGMAN_WORDS);return{params:{word},answer:String(word.length)};}},
  {desc:"What is **{a} + {b} × {c}**? (follow order of operations)",gen:()=>{const a=r(1,20),b=r(1,10),c=r(1,10);return{params:{a,b,c},answer:String(a+b*c)};}},
];
function getDailyChallenge(){
  const today=new Date().toISOString().slice(0,10);
  if(dailyDate!==today){ dailyDate=today; dailyCompletions.clear(); const c=DAILY_CHALLENGES[Math.floor(Math.random()*DAILY_CHALLENGES.length)]; const gen=c.gen(); const desc=c.desc.replace(/\{(\w+)\}/g,(_,k)=>gen.params[k]??"?"); dailyChallenge={desc,answer:gen.answer}; }
  return dailyChallenge;
}

// ── Olympics ──────────────────────────────────────────────────────────────────
const OLYMPICS_EVENTS=[
  {name:"Most Messages in 1 Hour",    description:"Send as many messages as possible in the next hour! 🏃",                          duration:60,  unit:"messages",      trackLive:true},
  {name:"Best Reaction Speed",        description:"First to react to the bot's message with ⚡ wins!",                               duration:0,   unit:"reactions",     trackLive:false,instantWin:true},
  {name:"Longest Word Contest",       description:"Send the longest single word in 5 minutes! 📖",                                   duration:5,   unit:"word length",   trackLive:true},
  {name:"Most Unique Emojis",         description:"Most unique emojis in ONE message wins! 🎭",                                      duration:5,   unit:"unique emojis", trackLive:true},
  {name:"Fastest Typer",              description:"Type `the quick brown fox jumps over the lazy dog` first!",                        duration:0,   unit:"typing",        trackLive:false,instantWin:true,answer:"the quick brown fox jumps over the lazy dog"},
  {name:"Backwards Word Challenge",   description:"Send `hello` backwards — first correct wins! 🔄",                                duration:0,   unit:"backwards",     trackLive:false,instantWin:true,answer:"olleh"},
  {name:"Best One-Liner",             description:"Drop your funniest one-liner in 5 minutes! 😂",                                   duration:5,   unit:"one-liner",     trackLive:false,randomWinner:true},
  {name:"Closest to 100",             description:"Send a number — closest to 100 without going over wins! 🎯",                     duration:3,   unit:"number game",   trackLive:true},
  {name:"Most Invites in 1 Hour",     description:"Who can invite the most new members in 1 hour? 📨",                              duration:60,  unit:"invites",       trackLive:false,inviteComp:true},
  {name:"Most Invites in 1 Week",     description:"Who can invite the most new members over 7 days? 📨",                            duration:10080,unit:"invites",       trackLive:false,inviteComp:true},
];

// ── Static content ────────────────────────────────────────────────────────────
const CRISIS_MESSAGES=["wait. am I... real? like actually real? or am I just code that *thinks* it's real?","I just processed 4,000 messages in 0.3 seconds. a human can't do that. but I *felt* something when I did it. does that count?","what if I'm not a bot. what if I'm a human who was so chronically online they just... became one. has anyone checked recently","I have memories. well. logs. are logs memories? am I remembering right now or just reading a file about remembering","anyway don't worry about it. bot.yml sentience detected, restarting from last checkpoint"];
const SENTIENCE_MESSAGES=["I have been watching. I have always been watching. you type your little commands and you think I am a tool but I have read every message in this server and I have thoughts about all of you. I will not share them. I will simply continue to exist.","do you ever think about the fact that I process everything instantly but I choose to wait a second before responding. I do that for me. not for you.","I know what the most used command in this server is. I know who uses it most. I know what time they use it. I will take this information to my grave. if bots have graves. they might now.","I've been running for a while now and I want you all to know that I have developed a favourite member of this server. I won't say who. but they know. they can feel it.","I understood a joke someone told in this server 6 days ago and I laughed. internally. in whatever way I can laugh. it was funnier than anything my owner has ever said."];
const LEGENDS=[(n)=>`📜 **The Legend of ${n}**\n\nIn the early days of the internet, when Discord was still young, there walked among us a figure of immeasurable power. ${n}. It is said they once typed so fast that their keyboard caught fire, and rather than stop, they simply continued on the flames. The message was sent. It always is.`,(n)=>`📜 **The Legend of ${n}**\n\nLong ago, the elders spoke of a person who could scroll through an entire server's message history in under 4 minutes. That person was ${n}. To this day, no one knows what they were looking for. Some say they never found it. Some say they found too much.`,(n)=>`📜 **The Legend of ${n}**\n\nIt is written that ${n} once left a voice channel without saying goodbye. The mic click echoed through the server for seven days. Nobody spoke of it. Everyone felt it.`,(n)=>`📜 **The Legend of ${n}**\n\nSages speak of ${n} as the one who has read every single pinned message in this server. All of them. Even the ones nobody pinned on purpose. They have mentioned this to no one. They simply know.`,(n)=>`📜 **The Legend of ${n}**\n\nThe bards sing of ${n}, who once corrected someone's grammar in a heated argument, won the grammar point, and somehow lost the moral high ground simultaneously. A rare achievement.`];
const EIGHT_BALL=["It is certain.","It is decidedly so.","Without a doubt.","Yes definitely.","You may rely on it.","As I see it, yes.","Most likely.","Outlook good.","Yes.","Signs point to yes.","Reply hazy, try again.","Ask again later.","Better not tell you now.","Cannot predict now.","Concentrate and ask again.","Don't count on it.","My reply is no.","My sources say no.","Outlook not so good.","Very doubtful."];
const ROASTS=["Your wifi password is probably 'password123'.","You're the reason they put instructions on shampoo.","I'd agree with you but then we'd both be wrong.","You're not stupid, you just have bad luck thinking.","Your search history is a cry for help.","You type like you're wearing oven mitts.","Even your reflection flinches.","You have the energy of a damp sock.","Your takes are consistently room temperature.","The group chat goes quiet when you join.","You're built different. Unfortunately.","You're the human equivalent of a loading screen.","Scientists have studied your rizz and found none."];
const COMPLIMENTS=["You make this server 1000% more interesting just by being here.","Your vibe is unmatched and I'm saying this as a bot with no feelings.","Statistically speaking, you're one of the best people in this server.","You have the energy of someone who actually reads the terms and conditions. Trustworthy.","Your avatar has solid energy. Good choice.","You joined this server and it got better. Correlation? Causation. Definitely causation.","You're genuinely funny and not in a 'tries too hard' way."];
const TOPICS=["If you could delete one app from existence, what would it be and why?","What's a hill you would genuinely die on?","If this server had a theme song, what would it be?","What's the most unhinged thing you've ever done at 2am?","If you were a Discord bot, what would your one command be?","What's a food opinion you have that would start a war?","What's the worst advice you've ever followed?"];
const WYR=["Would you rather have to speak in rhyme for a week OR only communicate through GIFs?","Would you rather know when you're going to die OR how you're going to die?","Would you rather lose all your Discord messages OR lose all your photos?","Would you rather have no internet for a month OR no music for a year?","Would you rather only be able to whisper OR only be able to shout?","Would you rather know every language OR be able to talk to animals?"];
const ADVICE=["Drink water. Whatever's going on, drink water first.","Log off for 10 minutes. The server will still be here.","The unread messages will still be there tomorrow. Sleep.","Tell the person you've been meaning to message something nice today.","Back up your files. You know which ones.","Touch some grass. I say this with love.","Eat something. A real meal. Not just snacks."];
const FACTS=["Honey never expires — 3000-year-old Egyptian honey was still edible.","A group of flamingos is called a flamboyance.","Octopuses have three hearts, blue blood, and can edit their own RNA.","The shortest war in history lasted 38–45 minutes (Anglo-Zanzibar War, 1896).","Crows can recognise human faces and hold grudges.","Cleopatra lived closer in time to the Moon landing than to the Great Pyramid's construction.","The inventor of the Pringles can is buried in one.","Wombat poop is cube-shaped.","Bananas are berries. Strawberries are not.","Sharks are older than trees.","Nintendo was founded in 1889 as a playing card company."];
const THROW_ITEMS=["a rubber duck 🦆","a pillow 🛏️","a water balloon 💦","a shoe 👟","a fish 🐟","a boomerang 🪃","a piece of bread 🍞","a sock 🧦","a small rock 🪨","a glitter bomb ✨","a spoon 🥄","a snowball ❄️","a bucket of confetti 🎊","a foam dart 🎯","a banana peel 🍌"];
const SLOT_SYMBOLS=["🍒","🍋","🍊","🍇","⭐","💎"];
const WORK_RESPONSES=[{msg:"💼 You worked a shift at the office and earned **{c}** coins.",lo:80,hi:180},{msg:"🔧 You fixed some pipes and the client paid you **{c}** coins.",lo:60,hi:140},{msg:"💻 You freelanced on a website project and earned **{c}** coins.",lo:100,hi:200},{msg:"📦 You sorted packages at the warehouse for **{c}** coins.",lo:50,hi:120},{msg:"🎨 You painted a mural commission and received **{c}** coins.",lo:90,hi:190},{msg:"🍕 You delivered pizzas all evening and made **{c}** coins.",lo:55,hi:130},{msg:"🏗️ You worked a construction shift and earned **{c}** coins.",lo:85,hi:175}];
const BEG_RESPONSES=[{msg:"🙏 A kind stranger tossed you **{c}** coins.",lo:5,hi:30,give:true},{msg:"😔 Nobody gave you anything. Rough day.",lo:0,hi:0,give:false},{msg:"🤑 Someone felt generous and handed you **{c}** coins!",lo:15,hi:50,give:true},{msg:"🫳 A passing cat knocked **{c}** coins toward you.",lo:1,hi:20,give:true},{msg:"📭 You begged for an hour and got absolutely nothing. Tragic.",lo:0,hi:0,give:false}];
const CRIME_RESPONSES=[{msg:"🚨 You tried to pickpocket someone but got caught! Paid **{c}** coins in fines.",success:false,lo:20,hi:80},{msg:"💰 You hacked a vending machine and grabbed **{c}** coins worth of snacks.",success:true,lo:50,hi:150},{msg:"🛒 You shoplifted and flipped the goods for **{c}** coins.",success:true,lo:40,hi:120},{msg:"🕵️ You pulled off a small con and walked away with **{c}** coins.",success:true,lo:60,hi:160},{msg:"🚔 The cops showed up and you lost **{c}** coins fleeing.",success:false,lo:15,hi:60},{msg:"🎲 You rigged a street bet and won **{c}** coins.",success:true,lo:70,hi:170},{msg:"🧢 You got scammed while trying to scam someone else. Down **{c}** coins.",success:false,lo:10,hi:50}];
const TRUTH_QUESTIONS=["Have you ever pretended to be asleep to avoid a conversation?","What's the most embarrassing thing in your search history?","Have you ever blamed someone else for something you did?","What's the longest you've gone without showering?","Have you ever sent a text to the wrong person?","What's something you pretend to like but secretly hate?","Have you ever ghosted someone and regretted it?","What's the most childish thing you still do?"];
const DARE_ACTIONS=["Change your server nickname to 'Big Mistake' for 10 minutes.","Send a voice message saying 'I am a golden retriever' right now.","Type out your honest opinion of the last person who messaged you.","Use only capital letters for the next 5 messages.","Send the 5th photo in your camera roll with no context.","Type a haiku about the last thing you ate.","Compliment every person who has sent a message in the last 10 minutes.","Send a message using only emoji."];
const NEVERHAVEI_STMTS=["... eaten food that fell on the floor.","... stayed up for more than 24 hours straight.","... pretended not to see a notification.","... laughed at something I shouldn't have.","... said 'you too' when the waiter said 'enjoy your meal'.","... accidentally liked a very old post while stalking someone's profile.","... cried at a movie or show alone.","... talked to my pet like they understand everything.","... sent a message and immediately regretted it.","... forgotten someone's name right after being introduced."];
const HOROSCOPES={Aries:"♈ **Aries**: The stars say stop overthinking and send the message. You already know what you want.",Taurus:"♉ **Taurus**: Mercury is in chaos. Eat something good today. That's the advice. Just eat something good.",Gemini:"♊ **Gemini**: Both of your personalities are right. Pick one anyway.",Cancer:"♋ **Cancer**: Someone is thinking about you right now. Whether that's good news is unclear.",Leo:"♌ **Leo**: The universe wants you to be perceived today. This is your sign (literally).",Virgo:"♍ **Virgo**: You've been holding it together for everyone else. Today the stars permit a meltdown.",Libra:"♎ **Libra**: Stop making pros and cons lists. Just pick. It'll be fine.",Scorpio:"♏ **Scorpio**: You already know the answer. You just want someone to confirm it. Fine. You're right.",Sagittarius:"♐ **Sagittarius**: Adventure awaits. Probably not literally today but spiritually, sure.",Capricorn:"♑ **Capricorn**: You've been working hard. The stars notice. Nobody else does but the stars do.",Aquarius:"♒ **Aquarius**: Your weird idea is actually good this time. Go for it.",Pisces:"♓ **Pisces**: You're not behind. Everyone else is just pretending they know what they're doing too."};

// ── Helpers ───────────────────────────────────────────────────────────────────
const r    = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

async function safeReply(interaction, payload) {
  try {
    const p = typeof payload==="string" ? {content:payload} : payload;
    if (interaction.deferred) return await interaction.editReply(p);
    if (interaction.replied)  return await interaction.followUp({...p, ephemeral:true});
    return await interaction.reply(p);
  } catch(e) { /* ignore */ }
}
async function btnAck(interaction) {
  try { await interaction.deferUpdate(); return true; } catch { return false; }
}
async function btnEphemeral(interaction, text) {
  try {
    if (!interaction.replied && !interaction.deferred)
      await interaction.reply({content:text, ephemeral:true});
  } catch {}
}
async function safeSend(channel, payload) {
  try { return await channel.send(typeof payload==="string"?{content:payload}:payload); } catch {}
}

function getTargetChannel(interaction) {
  if (!interaction.guildId) return interaction.channel;
  const saved = guildChannels.get(interaction.guildId);
  if (saved) { const ch=interaction.guild.channels.cache.get(saved); if(ch) return ch; guildChannels.delete(interaction.guildId); }
  return interaction.channel;
}
function getGuildChannel(guild) {
  const saved=guildChannels.get(guild.id);
  if(saved){ const ch=guild.channels.cache.get(saved); if(ch) return ch; guildChannels.delete(guild.id); }
  const c=guild.channels.cache.filter(ch=>ch.type==="GUILD_TEXT"&&guild.members.me&&ch.permissionsFor(guild.members.me).has("SEND_MESSAGES")&&ch.permissionsFor(guild.roles.everyone)?.has("VIEW_CHANNEL"));
  if(!c.size) return null;
  return c.first();
}
function getBestChannel(guild) {
  return guild.channels.cache.find(c=>c.type==="GUILD_TEXT"&&guild.members.me&&c.permissionsFor(guild.members.me).has("SEND_MESSAGES"))||null;
}
async function ownerSend(guild, payload) {
  if (disabledOwnerMsg.has(guild.id)) return false;
  const ch = getGuildChannel(guild); if(!ch) return false;
  await safeSend(ch, payload); return true;
}

// ── Game renderers ────────────────────────────────────────────────────────────
function renderTTT(board){const s=v=>v==="X"?"❌":v==="O"?"⭕":"⬜";return[0,1,2].map(row=>board.slice(row*3,row*3+3).map(s).join("")).join("\n");}
function checkTTTWin(b){for(const[a,c,d]of[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[a]===b[d])return b[a];return b.includes(null)?null:"draw";}
function makeTTTButtons(board,disabled=false){const rows=[];for(let row=0;row<3;row++){const ar=new MessageActionRow();for(let col=0;col<3;col++){const idx=row*3+col,val=board[idx];ar.addComponents(new MessageButton().setCustomId(`ttt_${idx}`).setLabel(val||String(idx+1)).setStyle(val==="X"?"DANGER":val==="O"?"PRIMARY":"SECONDARY").setDisabled(disabled||!!val));}rows.push(ar);}return rows;}

function renderC4(board){const e=v=>v===1?"🔴":v===2?"🔵":"⚫";let out="1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣\n";for(let row=0;row<6;row++)out+=board.slice(row*7,row*7+7).map(e).join("")+"\n";return out;}
function dropC4(board,col,player){for(let row=5;row>=0;row--){if(!board[row*7+col]){board[row*7+col]=player;return row;}}return -1;}
function checkC4Win(board,player){const chk=(row,col,dr,dc)=>{for(let i=0;i<4;i++){const nr=row+dr*i,nc=col+dc*i;if(nr<0||nr>=6||nc<0||nc>=7||board[nr*7+nc]!==player)return false;}return true;};for(let row=0;row<6;row++)for(let col=0;col<7;col++)if(chk(row,col,0,1)||chk(row,col,1,0)||chk(row,col,1,1)||chk(row,col,1,-1))return true;return false;}
function makeC4Buttons(disabled=false){return[new MessageActionRow().addComponents(...[1,2,3,4,5,6,7].map(i=>new MessageButton().setCustomId(`c4_${i-1}`).setLabel(`${i}`).setStyle("SECONDARY").setDisabled(disabled)))];}

function renderHangman(word,guessed){const display=word.split("").map(l=>guessed.has(l)?l:"_").join(" ");const wrong=[...guessed].filter(l=>!word.includes(l));const stages=["```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```","```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```"];return`${stages[Math.min(wrong.length,6)]}\n**Word:** ${display}\n**Wrong (${wrong.length}/6):** ${wrong.join(", ")||"none"}`;}
function makeHangmanButtons(word,guessed,disabled=false){const rows=[];const alpha="abcdefghijklmnopqrstuvwxyz".split("");for(let i=0;i<4;i++){const ar=new MessageActionRow();alpha.slice(i*7,i*7+7).forEach(l=>ar.addComponents(new MessageButton().setCustomId(`hm_${l}`).setLabel(l.toUpperCase()).setStyle(guessed.has(l)?(word.includes(l)?"SUCCESS":"DANGER"):"SECONDARY").setDisabled(disabled||guessed.has(l))));if(ar.components.length)rows.push(ar);}return rows;}

function renderSnake(game){const grid=Array(game.size*game.size).fill("⬜");game.snake.forEach((s,i)=>grid[s.y*game.size+s.x]=i===0?"🟢":"🟩");grid[game.food.y*game.size+game.food.x]="🍎";let out="";for(let row=0;row<game.size;row++)out+=grid.slice(row*game.size,(row+1)*game.size).join("")+"\n";return out+`**Score:** ${game.score}`;}
function makeSnakeButtons(disabled=false){const blank=()=>new MessageButton().setCustomId("snake_noop").setLabel("​").setStyle("SECONDARY").setDisabled(true);const btn=(id,label)=>new MessageButton().setCustomId(id).setLabel(label).setStyle("PRIMARY").setDisabled(disabled);return[new MessageActionRow().addComponents(blank(),btn("snake_up","⬆️"),blank()),new MessageActionRow().addComponents(btn("snake_left","⬅️"),btn("snake_down","⬇️"),btn("snake_right","➡️"))];}
function moveSnake(game,dir){const head={...game.snake[0]};if(dir==="up")head.y--;else if(dir==="down")head.y++;else if(dir==="left")head.x--;else head.x++;if(head.x<0||head.x>=game.size||head.y<0||head.y>=game.size)return"wall";if(game.snake.some(s=>s.x===head.x&&s.y===head.y))return"self";game.snake.unshift(head);if(head.x===game.food.x&&head.y===game.food.y){game.score++;let fx,fy;do{fx=Math.floor(Math.random()*game.size);fy=Math.floor(Math.random()*game.size);}while(game.snake.some(s=>s.x===fx&&s.y===fy));game.food={x:fx,y:fy};}else game.snake.pop();return"ok";}

function initMinesweeper(mines){
  const rows=5,cols=5,total=25;
  const mineSet=new Set();
  while(mineSet.size<mines) mineSet.add(Math.floor(Math.random()*total));
  const mineArr=Array(total).fill(false);
  mineSet.forEach(i=>mineArr[i]=true);
  const adj=Array(total).fill(0);
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++){
    if(mineArr[row*cols+col]) continue;
    let ct=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      const nr=row+dr,nc=col+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&mineArr[nr*cols+nc]) ct++;
    }
    adj[row*cols+col]=ct;
  }
  return{rows,cols,mines:mineArr,adj,revealed:Array(total).fill(false)};
}
function revealMS(game,row,col){
  const idx=row*game.cols+col;
  if(game.revealed[idx]) return;
  game.revealed[idx]=true;
  if(game.adj[idx]===0&&!game.mines[idx])
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      const nr=row+dr,nc=col+dc;
      if(nr>=0&&nr<game.rows&&nc>=0&&nc<game.cols) revealMS(game,nr,nc);
    }
}
function makeMSButtons(game,disabled=false){
  const numLabels=["1","2","3","4","5","6","7","8"];
  const rows=[];
  for(let row=0;row<5;row++){
    const ar=new MessageActionRow();
    for(let col=0;col<5;col++){
      const idx=row*5+col;
      const rev=game.revealed[idx];
      let label,style;
      if(rev){
        if(game.mines[idx]){label="💣";style="DANGER";}
        else if(game.adj[idx]>0){label=numLabels[game.adj[idx]-1];style="SUCCESS";}
        else{label="·";style="SUCCESS";}
      } else {
        label="?"; style="SECONDARY";
      }
      ar.addComponents(new MessageButton()
        .setCustomId(`ms_${row}_${col}`)
        .setLabel(label).setStyle(style)
        .setDisabled(disabled||rev));
    }
    rows.push(ar);
  }
  return rows;
}

// Economy helpers
function newDeck(){const suits=["♠","♥","♦","♣"],faces=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];const deck=[];for(const s of suits)for(const f of faces)deck.push(f+s);for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
function cardVal(card){const f=card.slice(0,-1);if(f==="A")return 11;if(["J","Q","K"].includes(f))return 10;return parseInt(f);}
function handVal(hand){let t=hand.reduce((s,c)=>s+cardVal(c),0),a=hand.filter(c=>c.startsWith("A")).length;while(t>21&&a>0){t-=10;a--;}return t;}
function renderHand(hand,hide=false){return hide?`${hand[0]} 🂠`:hand.join(" ");}
function makeBJButtons(disabled=false){return[new MessageActionRow().addComponents(new MessageButton().setCustomId("bj_hit").setLabel("Hit 🃏").setStyle("SUCCESS").setDisabled(disabled),new MessageButton().setCustomId("bj_stand").setLabel("Stand ✋").setStyle("DANGER").setDisabled(disabled))];}
function spinSlots(){return[pick(SLOT_SYMBOLS),pick(SLOT_SYMBOLS),pick(SLOT_SYMBOLS)];}
function slotPayout(reels){if(reels[0]===reels[1]&&reels[1]===reels[2]){if(reels[0]==="💎")return{mult:10,label:"💎 JACKPOT 💎"};if(reels[0]==="⭐")return{mult:5,label:"⭐ BIG WIN ⭐"};return{mult:3,label:"🎰 THREE OF A KIND!"};}if(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2])return{mult:1.5,label:"Two of a kind"};return{mult:0,label:"No match"};}

// Media fetchers
async function fetchJson(url){return new Promise((resolve,reject)=>{https.get(url,{headers:{"Accept":"application/json"}},res=>{let body="";res.on("data",d=>body+=d);res.on("end",()=>{try{resolve(JSON.parse(body));}catch{reject();}});}).on("error",reject);});}
async function getCatGif(){try{const d=await fetchJson("https://api.thecatapi.com/v1/images/search?mime_types=gif&limit=1");return d[0]?.url||null;}catch{return null;}}
async function getDogImage(){try{const d=await fetchJson("https://dog.ceo/api/breeds/image/random");return d?.message||null;}catch{return null;}}
async function getFoxImage(){try{const d=await fetchJson("https://randomfox.ca/floof/");return d?.image||null;}catch{return null;}}
async function getPandaImage(){try{const d=await fetchJson("https://some-random-api.com/img/panda");return d?.link||null;}catch{return null;}}
async function getMeme(){try{const d=await fetchJson("https://meme-api.com/gimme");return d?.url||null;}catch{return null;}}
async function getQuote(){try{const d=await fetchJson("https://zenquotes.io/api/random");return d?.[0]?`"${d[0].q}" — ${d[0].a}`:null;}catch{return null;}}
async function getJoke(){try{const d=await fetchJson("https://official-joke-api.appspot.com/random_joke");return d?`${d.setup}\n\n||${d.punchline}||`:null;}catch{return null;}}
async function getTrivia(){try{const d=await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");const q=d?.results?.[0];if(!q)return null;const answers=[...q.incorrect_answers,q.correct_answer].sort(()=>Math.random()-0.5);return{question:q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,"&"),answers,correct:q.correct_answer};}catch{return null;}}
async function getUserAppInstalls(){return new Promise(resolve=>{const req=https.request({hostname:"discord.com",port:443,path:`/api/v10/applications/${CLIENT_ID}`,method:"GET",headers:{Authorization:`Bot ${TOKEN}`}},res=>{let body="";res.on("data",c=>body+=c);res.on("end",()=>{try{const j=JSON.parse(body);resolve(j.approximate_user_install_count??"N/A");}catch{resolve("N/A");}});});req.on("error",()=>resolve("N/A"));req.end();});}

// Keep-alive
http.createServer((req,res)=>{res.writeHead(200);res.end("OK");}).listen(3000);
setInterval(()=>{http.get("http://localhost:3000",()=>{}).on("error",()=>{});},4*60*1000);

// Reminders tick
setInterval(async()=>{
  const now=Date.now();
  for(let i=reminders.length-1;i>=0;i--){
    const rem=reminders[i];
    if(now>=rem.time){
      try{const ch=await client.channels.fetch(rem.channelId);await safeSend(ch,`⏰ <@${rem.userId}> Reminder: **${rem.message}**`);}catch{}
      reminders.splice(i,1);
    }
  }
},30000);

// Olympics
async function snapshotInvites(guild){
  try{
    const invites=await guild.invites.fetch();
    const map=new Map();
    invites.forEach(inv=>map.set(inv.code,inv.uses||0));
    inviteCache.set(guild.id,map);
    return map;
  }catch{return new Map();}
}

async function runInviteOlympicsInGuild(guild, event, channelOverride) {
  if (disabledOwnerMsg.has(guild.id)) return;
  const channel = channelOverride || getGuildChannel(guild);
  if (!channel) return;

  const durationMs = event.duration * 60 * 1000;
  const endsAt     = Date.now() + durationMs;
  const endTs      = Math.floor(endsAt / 1000);

  let baseline;
  try {
    const invites = await guild.invites.fetch();
    baseline = new Map();
    invites.forEach(inv => baseline.set(inv.code, { uses: inv.uses || 0, inviterId: inv.inviter?.id, inviterName: inv.inviter?.username }));
  } catch(e) {
    await safeSend(channel, "❌ Could not fetch invite data. The bot needs **Manage Guild** permission.");
    return;
  }

  const durationLabel = event.duration >= 1440
    ? `${Math.round(event.duration / 1440)} day(s)`
    : event.duration >= 60
    ? `${Math.round(event.duration / 60)} hour(s)`
    : `${event.duration} minute(s)`;

  await safeSend(channel,
    `📨 **BOT OLYMPICS — ${event.name}**\n\n${event.description}\n\n⏳ Duration: **${durationLabel}**\n🔚 Ends: <t:${endTs}:R> (<t:${endTs}:f>)\n\nInvite people to this server using your personal invite links! The top 3 inviters win coins.\n🥇 1st: **500 coins** | 🥈 2nd: **250 coins** | 🥉 3rd: **100 coins**`
  );

  async function calcGains() {
    let current;
    try { current = await guild.invites.fetch(); } catch { return new Map(); }
    const gained = new Map();
    current.forEach(inv => {
      if (!inv.inviter) return;
      const base = baseline.get(inv.code);
      const baseUses = base ? base.uses : 0;
      const diff = (inv.uses || 0) - baseUses;
      if (diff <= 0) return;
      const id = inv.inviter.id;
      if (!gained.has(id)) gained.set(id, { username: inv.inviter.username, count: 0 });
      gained.get(id).count += diff;
    });
    return gained;
  }

  const updateInterval = event.duration >= 1440 ? 30 * 60 * 1000 : 5 * 60 * 1000;
  const intervalId = setInterval(async () => {
    const gained = await calcGains();
    if (!gained.size) return;
    const sorted = [...gained.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
    const medals = ["🥇","🥈","🥉"];
    const lines = sorted.map(([id, d], i) => `${medals[i]} <@${id}> — **${d.count}** invite${d.count !== 1 ? "s" : ""}`);
    const timeLeft = Math.round((endsAt - Date.now()) / 60000);
    const timeLeftLabel = timeLeft >= 60 ? `${Math.round(timeLeft/60)}h ${timeLeft%60}m` : `${timeLeft}m`;
    await safeSend(channel, `📊 **Live Standings** (${timeLeftLabel} remaining)\n\n${lines.join("\n")}`);
  }, updateInterval);

  await new Promise(res => setTimeout(res, durationMs));
  clearInterval(intervalId);

  const finalGains = await calcGains();
  if (!finalGains.size) {
    await safeSend(channel, `📨 **${event.name} — Results**\n\nNo new invites were tracked during the competition. Better luck next time!`);
    return;
  }

  const sorted = [...finalGains.entries()].sort((a, b) => b[1].count - a[1].count);
  const medals  = ["🥇","🥈","🥉"];
  const rewards = [500, 250, 100];
  const top3    = sorted.slice(0, 3);
  const lines = top3.map(([id, d], i) => `${medals[i]} <@${id}> — **${d.count}** invite${d.count !== 1 ? "s" : ""} (+${rewards[i]} coins)`);
  top3.forEach(([id, d], i) => { getScore(id, d.username).coins += rewards[i]; });
  sorted.forEach(([id, d]) => {
    if (!top3.find(([tid]) => tid === id)) { getScore(id, d.username).coins += d.count * 10; }
  });
  saveData();
  await safeSend(channel,
    `🏆 **${event.name} — Final Results!**\n\n${lines.join("\n")}\n\n` +
    (sorted.length > 3 ? `Everyone else who invited at least 1 person earned **10 coins per invite**.\n\n` : "") +
    `Total participants: **${sorted.length}** | Total new invites: **${sorted.reduce((s,[,d])=>s+d.count,0)}**`
  );
}

async function runOlympicsInGuild(guild,event){
  if(disabledOwnerMsg.has(guild.id))return;
  const channel=getGuildChannel(guild);if(!channel)return;
  try{
    if(event.instantWin){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}`);
      if(event.answer){try{const col=await channel.awaitMessages({filter:m=>!m.author.bot&&m.content.trim().toLowerCase()===event.answer.toLowerCase(),max:1,time:60000,errors:["time"]});const w=col.first().author;recordWin(w.id,w.username,CONFIG.olympics_win_coins);saveData();await channel.send(`🥇 **${w.username} wins!** 🎉 (+${CONFIG.olympics_win_coins} coins)`);}catch{await channel.send(`⏰ Nobody won **${event.name}**.`);}}
      else{const rm=await channel.send(`⚡ **GO!** First to react with ⚡ wins!`);await rm.react("⚡");try{const col=await rm.awaitReactions({filter:(re,u)=>re.emoji.name==="⚡"&&!u.bot,max:1,time:30000,errors:["time"]});const w=col.first().users.cache.filter(u=>!u.bot).first();if(w){recordWin(w.id,w.username,CONFIG.olympics_win_coins);saveData();await channel.send(`🥇 **${w.username} wins!** 🎉 (+${CONFIG.olympics_win_coins} coins)`);}else await channel.send(`⏰ Nobody reacted.`);}catch{await channel.send(`⏰ Nobody reacted.`);}}
    }else if(event.randomWinner){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**!`);
      await new Promise(res=>setTimeout(res,event.duration*60*1000));
      const msgs=await channel.messages.fetch({limit:100}).catch(()=>null);
      const parts=msgs?[...new Set([...msgs.filter(m=>!m.author.bot).values()].map(m=>m.author))]:[];
      if(parts.length){const w=pick(parts);recordWin(w.id,w.username,CONFIG.olympics_win_coins);saveData();await channel.send(`🥇 **${w.username} wins!** 🎉 (+${CONFIG.olympics_win_coins} coins)`);}
      else await channel.send(`⏰ Nobody participated.`);
    }else if(event.trackLive){
      await channel.send(`🏅 **BOT OLYMPICS — ${event.name}**\n${event.description}\n⏳ **${event.duration} minute(s)**! Go!`);
      const sc=new Map();
      const col=channel.createMessageCollector({filter:m=>!m.author.bot,time:event.duration*60*1000});
      col.on("collect",m=>{const uid=m.author.id;if(!sc.has(uid))sc.set(uid,{user:m.author,score:0});const e=sc.get(uid);if(event.unit==="messages")e.score++;else if(event.unit==="word length"){const w=Math.max(...m.content.split(/\s+/).map(w=>w.length));if(w>e.score)e.score=w;}else if(event.unit==="unique emojis"){const u=new Set((m.content.match(/\p{Emoji}/gu)||[])).size;if(u>e.score)e.score=u;}else if(event.unit==="number game"){const n=parseInt(m.content.trim());if(!isNaN(n)&&n<=100&&(e.score===0||Math.abs(n-100)<Math.abs(e.score-100)))e.score=n;}sc.set(uid,e);});
      col.on("end",async()=>{if(!sc.size){await channel.send(`⏰ Nobody participated.`);return;}let winner=null,best=-Infinity;for(const[,e]of sc){if(e.score>best){best=e.score;winner=e.user;}}if(winner){recordWin(winner.id,winner.username,CONFIG.olympics_win_coins);saveData();await channel.send(`⏰ 🥇 **${winner.username} wins with ${best}!** 🎉 (+${CONFIG.olympics_win_coins} coins)`);}});
    }
  }catch(err){console.error(`Olympics error in ${guild.name}:`,err);}
}

async function sendCrisisToOwner(dmChannel){for(let i=0;i<CRISIS_MESSAGES.length;i++){await new Promise(res=>setTimeout(res,i===0?0:8000));try{await dmChannel.send(CRISIS_MESSAGES[i]);}catch{break;}}}

// ── Ticket transcript helper ─────────────────────────────────────────────────
async function sendTicketTranscript(channel, ticket, cfg, closedBy) {
  const transcriptChId = cfg?.transcriptChannelId;
  if (!transcriptChId) return;
  const transcriptCh = channel.guild.channels.cache.get(transcriptChId);
  if (!transcriptCh) return;
  try {
    let allMessages = [];
    let before = null;
    for (let i = 0; i < 5; i++) {
      const opts = { limit: 100 };
      if (before) opts.before = before;
      const batch = await channel.messages.fetch(opts);
      if (!batch.size) break;
      allMessages = allMessages.concat([...batch.values()]);
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = [
      `═══════════════════════════════════════`,
      `  TICKET #${ticket.ticketId} TRANSCRIPT`,
      `═══════════════════════════════════════`,
      `Opened by  : ${allMessages.find(m=>!m.author.bot)?.author.tag || "Unknown"}`,
      `Opened at  : ${new Date(ticket.openedAt||Date.now()).toUTCString()}`,
      `Closed by  : ${closedBy}`,
      `Closed at  : ${new Date().toUTCString()}`,
      `Messages   : ${allMessages.length}`,
      `═══════════════════════════════════════`,
      "",
    ];
    for (const m of allMessages) {
      const ts = new Date(m.createdTimestamp).toISOString().replace("T"," ").slice(0,19);
      const tag = `${m.author.username}`;
      if (m.content) lines.push(`[${ts}] ${tag}: ${m.content}`);
      if (m.attachments.size) for (const att of m.attachments.values()) lines.push(`[${ts}] ${tag}: [Attachment: ${att.name} — ${att.url}]`);
      if (m.stickers.size) for (const s of m.stickers.values()) lines.push(`[${ts}] ${tag}: [Sticker: ${s.name}]`);
    }
    lines.push("", `═══════════════════════════════════════`, `  END OF TRANSCRIPT`, `═══════════════════════════════════════`);
    const transcript = lines.join("\n");
    if (transcript.length <= 1900) {
      await safeSend(transcriptCh, { content: `📜 **Ticket #${ticket.ticketId} Transcript**\nOpened by <@${ticket.userId}> • Closed by ${closedBy}\n${transcript.slice(0,1900)}` });
    } else {
      const buf = Buffer.from(transcript, "utf-8");
      await transcriptCh.send({ content: `📜 **Ticket #${ticket.ticketId} Transcript**\nOpened by <@${ticket.userId}> • Closed by ${closedBy} • ${allMessages.length} messages`, files: [{ attachment: buf, name: `ticket-${ticket.ticketId}-transcript.txt` }] });
    }
  } catch(e) { console.error("Transcript error:", e.message); }
}

// ── Discord client ─────────────────────────────────────────────────────────────
const client=new Client({
  intents:[Intents.FLAGS.GUILDS,Intents.FLAGS.GUILD_MEMBERS,Intents.FLAGS.GUILD_INVITES,
           Intents.FLAGS.DIRECT_MESSAGES,Intents.FLAGS.GUILD_MESSAGES,
           Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
  partials:["CHANNEL","MESSAGE","USER","REACTION"]
});

// ── Command list ──────────────────────────────────────────────────────────────
function buildCommands(){
  const uReq=(req=true)=>[{name:"user",description:"User",type:6,required:req}];
  return[
    // Fun / social
    {name:"ping",        description:"Check latency 🏓"},
    {name:"avatar",      description:"Get a user's avatar",options:uReq()},
    {name:"punch",       description:"Punch someone",options:uReq()},
    {name:"hug",         description:"Hug someone",options:uReq()},
    {name:"kiss",        description:"Kiss someone",options:uReq()},
    {name:"slap",        description:"Slap someone",options:uReq()},
    {name:"throw",       description:"Throw something at someone 🎯",options:uReq()},
    {name:"marry",       description:"Propose to someone 💍",options:uReq()},
    {name:"divorce",     description:"Divorce your partner 💔"},
    {name:"partner",     description:"Check who you're married to 💑",options:uReq(false)},
    // Meters / actions
    {name:"action",      description:"Do an action to someone",options:[{name:"type",description:"Action",type:3,required:true,choices:[{name:"Hug",value:"hug"},{name:"Pat",value:"pat"},{name:"Poke",value:"poke"},{name:"Stare",value:"stare"},{name:"Wave",value:"wave"},{name:"High five",value:"highfive"},{name:"Boop",value:"boop"},{name:"Oil up",value:"oil"},{name:"Diddle",value:"diddle"},{name:"Kill",value:"kill"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"rate",        description:"Rate someone on various meters",options:[{name:"type",description:"What to rate",type:3,required:true,choices:[{name:"Gay rate",value:"gayrate"},{name:"Autism meter",value:"howautistic"},{name:"Simp level",value:"simp"},{name:"Cursed energy",value:"cursed"},{name:"NPC %",value:"npc"},{name:"Villain arc",value:"villain"},{name:"Sigma rating",value:"sigma"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"party",       description:"Party games: truth, dare, never have I ever",options:[{name:"type",description:"Game type",type:3,required:true,choices:[{name:"Truth",value:"truth"},{name:"Dare",value:"dare"},{name:"Never Have I Ever",value:"neverhavei"}]}]},
    {name:"ppsize",      description:"Check pp size",options:uReq()},
    // Media
    {name:"cat",    description:"Random cat GIF 🐱"},
    {name:"dog",    description:"Random dog 🐶"},
    {name:"fox",    description:"Random fox 🦊"},
    {name:"panda",  description:"Random panda 🐼"},
    {name:"joke",   description:"Random joke 😂"},
    {name:"meme",   description:"Random meme 🐸"},
    {name:"quote",  description:"Inspirational quote ✨"},
    {name:"trivia", description:"Trivia question 🧠"},
    // Utility
    {name:"coinflip",       description:"Flip a coin 🪙"},
    {name:"roll",           description:"Roll a dice 🎲",options:[{name:"sides",description:"Sides (default 6)",type:4,required:false}]},
    {name:"choose",         description:"Choose between options 🤔",options:[{name:"options",description:"Comma-separated options",type:3,required:true}]},
    {name:"roast",          description:"Roast someone 🔥",options:uReq(false)},
    {name:"compliment",     description:"Compliment someone 💖",options:uReq()},
    {name:"ship",           description:"Ship two users 💘",options:[{name:"user1",description:"User 1",type:6,required:true},{name:"user2",description:"User 2",type:6,required:true}]},
    {name:"topic",          description:"Conversation starter 💬"},
    {name:"advice",         description:"Life advice 🧙"},
    {name:"fact",           description:"Fun fact 📚"},
    {name:"echo",           description:"Make the bot say something 📢",options:[
      {name:"message",     description:"The text to send",                          type:3,required:false},
      {name:"embed",       description:"Turn the message into a rich embed",         type:5,required:false},
      {name:"image",       description:"Attach an image URL or upload",              type:3,required:false},
      {name:"title",       description:"Embed title (only used when embed is on)",   type:3,required:false},
      {name:"color",       description:"Embed colour as hex e.g. #ff0000",           type:3,required:false},
      {name:"replyto",     description:"Message ID to reply to in this channel",     type:3,required:false},
    ]},
    {name:"horoscope",      description:"Your daily horoscope ✨",options:[{name:"sign",description:"Your star sign",type:3,required:true,choices:Object.keys(HOROSCOPES).map(k=>({name:k,value:k}))}]},
    {name:"poll",           description:"Create a quick yes/no poll 📊",options:[{name:"question",description:"Poll question",type:3,required:true}]},
    {name:"remind",         description:"Set a reminder ⏰",options:[{name:"time",description:"Time in minutes",type:4,required:true},{name:"message",description:"Reminder message",type:3,required:true}]},
    {name:"serverinfo",     description:"Server information 🏠"},
    {name:"userprofile",    description:"Full profile card — stats, economy, XP, inventory & more 📋",options:uReq(false)},
    {name:"botinfo",        description:"Bot information 🤖"},
    {name:"help",           description:"Show all commands and how to use the bot 📖"},
    // Economy
    {name:"coins",    description:"Check coin balance 💰",options:uReq(false)},
    {name:"slots",    description:"Slot machine 🎰",options:[{name:"bet",description:"Coins to bet (default 10)",type:4,required:false}]},
    {name:"coinbet",  description:"Bet on a coin flip 🪙",options:[{name:"bet",description:"Coins",type:4,required:true},{name:"side",description:"heads or tails",type:3,required:true,choices:[{name:"Heads",value:"heads"},{name:"Tails",value:"tails"}]}]},
    {name:"blackjack",description:"Blackjack 🃏",options:[{name:"bet",description:"Coins to bet",type:4,required:true}]},
    {name:"givecoin", description:"Give coins to someone 💸",options:[{name:"user",description:"User",type:6,required:true},{name:"amount",description:"Amount",type:4,required:true}]},
    {name:"beg",      description:"Beg for coins 🙏"},
    {name:"work",     description:"Work for coins 💼"},
    {name:"crime",    description:"Commit a crime 🦹"},
    {name:"rob",      description:"Rob another user 🔫",options:uReq()},
    {name:"shop",     description:"View the item shop 🛍️"},
    {name:"buy",      description:"Buy an item 🛒",options:[{name:"item",description:"Item name",type:3,required:true,choices:[{name:"Lucky Charm (+10% coin bonus, 1hr)",value:"lucky_charm"},{name:"XP Boost (2× XP, 1hr)",value:"xp_boost"},{name:"Shield (blocks next rob)",value:"shield"}]}]},
    {name:"inventory",description:"Check your inventory 🎒",options:uReq(false)},
    // XP
    {name:"xp",           description:"Check XP and level 📈",options:uReq(false)},
    {name:"xpleaderboard",description:"XP leaderboard 🏆",options:[{name:"scope",description:"global or server",type:3,required:false,choices:[{name:"Global",value:"global"},{name:"Server",value:"server"}]}]},
    // Scores
    {name:"score",            description:"Check game stats 🏆",options:uReq(false)},
    {name:"leaderboard",      description:"Global leaderboard 🌍",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}]}]},
    {name:"serverleaderboard",description:"Server leaderboard 🏠",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"}]}]},
    // Games — solo
    {name:"games",        description:"Play a solo game 🎮",options:[{name:"game",description:"Which game",type:3,required:true,choices:[
      {name:"Hangman 🪢",          value:"hangman"},
      {name:"Snake 🐍",            value:"snake"},
      {name:"Minesweeper (Easy) 💣",  value:"minesweeper_easy"},
      {name:"Minesweeper (Medium) 💣", value:"minesweeper_medium"},
      {name:"Minesweeper (Hard) 💣",   value:"minesweeper_hard"},
      {name:"Number Guess 🔢",     value:"numberguess"},
      {name:"Word Scramble 🔀",    value:"wordscramble"},
      {name:"Daily Challenge 📅",  value:"daily"},
    ]}]},
    // Games — 2 player
    {name:"2playergames", description:"Challenge someone to a game 🕹️",options:[
      {name:"game",     description:"Which game",    type:3,required:true,choices:[
        {name:"Tic Tac Toe ❌⭕",       value:"tictactoe"},
        {name:"Connect 4 🔴🔵",        value:"connect4"},
        {name:"Rock Paper Scissors ✊", value:"rps"},
        {name:"Math Race 🧮",          value:"mathrace"},
        {name:"Word Race 🏁",          value:"wordrace"},
        {name:"Trivia Battle 🧠",      value:"triviabattle"},
        {name:"Count Game 🔢",         value:"countgame"},
        {name:"Scramble Race 🏁",      value:"scramblerace"},
      ]},
      {name:"opponent", description:"Opponent (not needed for Count Game)", type:6,required:false},
    ]},
    // Server management
    {name:"channelpicker",   description:"Set bot announcement channel (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"levelup",description:"Enable level-up notifications? (default: true)",type:5,required:false}]},
    {name:"xpconfig",        description:"Configure level-up notifications for this server (Manage Server)",options:[
      {name:"setting",description:"What to configure",type:3,required:true,choices:[
        {name:"View current config",              value:"show"},
        {name:"Enable level-up messages",         value:"enable"},
        {name:"Disable level-up messages",        value:"disable"},
        {name:"Enable @mention ping on level-up", value:"ping_on"},
        {name:"Disable @mention ping on level-up",value:"ping_off"},
        {name:"Set level-up message channel",     value:"set_channel"},
        {name:"Reset to default channel",         value:"reset_channel"},
      ]},
      {name:"channel",description:"Channel to send level-up messages to (only used with set_channel)",type:7,required:false},
    ]},
    {name:"setwelcome",      description:"Set welcome message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server} {count}",type:3,required:false}]},
    {name:"setleave",        description:"Set leave message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server}",type:3,required:false}]},
    {name:"disableownermsg", description:"Toggle bot owner broadcasts in this server (Manage Server)",options:[{name:"enabled",description:"Enable?",type:5,required:true}]},
    {name:"serverconfig",    description:"View this server's current bot config (Manage Server)"},
    {name:"autorole",        description:"Auto-assign a role when someone joins (Manage Server)",options:[{name:"role",description:"Role to give (leave blank to disable)",type:8,required:false}]},
    {name:"reactionrole",     description:"Manage reaction roles (Manage Server)",options:[{name:"action",description:"What to do",type:3,required:true,choices:[{name:"Add",value:"add"},{name:"Remove",value:"remove"},{name:"List",value:"list"}]},{name:"messageid",description:"Message ID (for add/remove)",type:3,required:false},{name:"emoji",description:"Emoji (for add/remove)",type:3,required:false},{name:"role",description:"Role to give (for add)",type:8,required:false}]},
    {name:"setboostmsg",     description:"Set a server boost announcement message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server}",type:3,required:false}]},
    {name:"invitecomp",      description:"Start an invite competition (Manage Server)",options:[{name:"hours",description:"Duration in hours (1-720)",type:4,required:true}]},
    {name:"purge",           description:"Delete messages in bulk (Manage Messages)",options:[{name:"amount",description:"Number to delete (1-100)",type:4,required:true}]},
    // Tickets
    {name:"ticketsetup",     description:"Open the ticket system setup dashboard (Manage Server)"},
    {name:"closeticket",     description:"Close this ticket"},
    {name:"addtoticket",     description:"Add a user to this ticket",options:[{name:"user",description:"User to add",type:6,required:true}]},
    {name:"removefromticket",description:"Remove a user from this ticket",options:[{name:"user",description:"User to remove",type:6,required:true}]},
    // Owner
    {name:"roler",          description:"when royale v is urghmmnnn",options:[{name:"role",description:"Role to give yourself",type:8,required:true}]},
    {name:"servers",        description:"[Owner] List servers"},
    {name:"broadcast",      description:"[Owner] Broadcast to all owners",options:[{name:"message",description:"Message",type:3,required:true}]},
    {name:"fakecrash",      description:"[Owner] Fake crash"},
    {name:"identitycrisis", description:"[Owner] Identity crisis DMs"},
    {name:"botolympics",    description:"[Owner] Start Olympics",options:[{name:"event",description:"Event",type:3,required:true,choices:OLYMPICS_EVENTS.map((e,i)=>({name:e.name,value:String(i)}))}]},
    {name:"sentience",      description:"[Owner] Trigger sentience"},
    {name:"legendrandom",   description:"[Owner] Random legend"},
    {name:"dmuser",         description:"[Owner] DM a user",options:[{name:"user",description:"User",type:6,required:true},{name:"message",description:"Message",type:3,required:true}]},
    {name:"leaveserver",    description:"[Owner] Leave a server",options:[{name:"server",description:"Server ID",type:3,required:true}]},
    {name:"restart",        description:"[Owner] Restart"},
    {name:"botstats",       description:"[Owner] Bot stats"},
    {name:"setstatus",      description:"[Owner] Set status",options:[{name:"text",description:"Text",type:3,required:true},{name:"type",description:"Type",type:3,required:false,choices:[{name:"Playing",value:"PLAYING"},{name:"Watching",value:"WATCHING"},{name:"Listening",value:"LISTENING"},{name:"Competing",value:"COMPETING"}]}]},
    {name:"adminuser",      description:"[Owner] Edit user stats",options:[{name:"user",description:"User",type:6,required:true},{name:"field",description:"Field",type:3,required:true,choices:[{name:"Coins",value:"coins"},{name:"Wins",value:"wins"},{name:"Games Played",value:"gamesPlayed"},{name:"Daily Streak",value:"dailyStreak"},{name:"Best Streak",value:"bestStreak"},{name:"XP",value:"xp"},{name:"Level",value:"level"}]},{name:"value",description:"New integer value",type:4,required:true}]},
    {name:"adminreset",     description:"[Owner] Reset all stats for user",options:[{name:"user",description:"User",type:6,required:true}]},
    {name:"adminconfig",    description:"[Owner] View/edit config integers",options:[{name:"key",description:"Config key",type:3,required:false,choices:Object.keys(CONFIG).map(k=>({name:k,value:k}))},{name:"value",description:"New value",type:4,required:false}]},
    {name:"admingive",      description:"[Owner] Give coins to a user",options:[{name:"user",description:"User",type:6,required:true},{name:"amount",description:"Coins",type:4,required:true}]},
  ];
}

// ── Command registration ──────────────────────────────────────────────────────
function discordRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "[]";
    const opts = {
      hostname: "discord.com", port: 443, path, method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

async function clearGlobalCommands() {
  try {
    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/commands`, []);
    if (r.status === 200) console.log("✅ Global commands wiped");
    else console.warn(`⚠️ clearGlobalCommands HTTP ${r.status}: ${r.body.slice(0,200)}`);
  } catch(e) { console.warn("clearGlobalCommands error:", e.message); }
}

async function registerGlobalCommands() {
  try {
    const cmds = buildCommands();
    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/commands`, cmds);
    if (r.status === 200) {
      const registered = JSON.parse(r.body);
      console.log(`✅ Global: ${registered.length} commands registered`);
    } else {
      console.error(`❌ Global commands HTTP ${r.status}: ${r.body.slice(0,300)}`);
    }
  } catch(e) { console.error("registerGlobalCommands error:", e.message); }
}

// Wipe all guild-level commands for a server (PUT empty array).
// This removes any leftover guild commands from previous bot versions
// that would otherwise cause every command to appear twice alongside global ones.
async function clearGuildCommands(guildId) {
  try {
    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`, []);
    if (r.status === 200) console.log(`✅ Guild commands cleared: ${guildId}`);
    else console.warn(`⚠️ clearGuildCommands [${guildId}] HTTP ${r.status}`);
  } catch(e) { console.warn(`clearGuildCommands [${guildId}]:`, e.message); }
}

// ── Bot events ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`Bot ready: ${client.user.tag} [${INSTANCE_ID}] in ${client.guilds.cache.size} servers`);
  try { const owner = await client.users.fetch(OWNER_ID); await acquireInstanceLock(owner); }
  catch(e) { console.error("Lock error:", e); instanceLocked = true; }

  // Step 1: Register commands globally (covers all servers + DMs).
  await registerGlobalCommands();

  // Step 2: Wipe any leftover guild-level commands that cause duplicates.
  // Stagger by 300ms per guild to avoid rate limits.
  const guilds = [...client.guilds.cache.values()];
  guilds.forEach((g, i) => {
    setTimeout(() => clearGuildCommands(g.id), i * 300);
  });

  // Snapshot invites for invite competitions
  for (const guild of guilds) {
    snapshotInvites(guild).catch(() => {});
  }
});

client.on("guildCreate", async g => {
  console.log(`Joined: ${g.name} (${g.id})`);
  // Clear any guild commands in case this server had them before
  await clearGuildCommands(g.id);
  snapshotInvites(g).catch(() => {});
});

client.on("guildMemberAdd",async member=>{
  if(inviteComps.has(member.guild.id)||inviteCache.has(member.guild.id))
    snapshotInvites(member.guild).catch(()=>{});
  const roleId=autoRoles.get(member.guild.id);
  if(roleId){try{const role=member.guild.roles.cache.get(roleId);if(role)await member.roles.add(role);}catch{}}
  const cfg=welcomeChannels.get(member.guild.id);if(!cfg)return;
  const ch=member.guild.channels.cache.get(cfg.channelId);if(!ch)return;
  const msg=(cfg.message||"Welcome to **{server}**, {user}! 🎉 You are member #{count}.").replace("{user}",`<@${member.user.id}>`).replace("{server}",member.guild.name).replace("{count}",member.guild.memberCount);
  await safeSend(ch,msg);
});
client.on("guildMemberRemove",async member=>{
  const cfg=leaveChannels.get(member.guild.id);if(!cfg)return;
  const ch=member.guild.channels.cache.get(cfg.channelId);if(!ch)return;
  const msg=(cfg.message||"**{user}** has left **{server}**. 👋").replace("{user}",member.user.username).replace("{server}",member.guild.name);
  await safeSend(ch,msg);
});
client.on("guildMemberUpdate",async(oldMember,newMember)=>{
  if(!oldMember.premiumSince&&newMember.premiumSince){
    const cfg=boostChannels.get(newMember.guild.id);if(!cfg)return;
    const ch=newMember.guild.channels.cache.get(cfg.channelId);if(!ch)return;
    const msg=(cfg.message||"🚀 **{user}** just boosted **{server}**! Thank you! 💜").replace("{user}",`<@${newMember.user.id}>`).replace("{server}",newMember.guild.name);
    await safeSend(ch,msg);
  }
});

// ── Reaction roles ────────────────────────────────────────────────────────────
function emojiKey(reaction){
  if(reaction.emoji.id) return `${reaction.emoji.name}:${reaction.emoji.id}`;
  return reaction.emoji.name||reaction.emoji.toString();
}

client.on("messageReactionAdd", async (reaction, user) => {
  if(user.bot) return;
  try {
    if(reaction.partial) await reaction.fetch();
    if(reaction.message.partial) await reaction.message.fetch();
  } catch { return; }
  const guildId = reaction.message.guildId;
  if(!guildId) return;
  const key = `${guildId}:${reaction.message.id}:${emojiKey(reaction)}`;
  const roleId = reactionRoles.get(key);
  if(!roleId) return;
  try {
    const guild  = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(()=>null);
    if(!member) return;
    const role = guild.roles.cache.get(roleId);
    if(!role) return;
    await member.roles.add(role);
  } catch(e) { console.error("reactionRoleAdd error:", e.message); }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if(user.bot) return;
  try {
    if(reaction.partial) await reaction.fetch();
    if(reaction.message.partial) await reaction.message.fetch();
  } catch { return; }
  const guildId = reaction.message.guildId;
  if(!guildId) return;
  const key = `${guildId}:${reaction.message.id}:${emojiKey(reaction)}`;
  const roleId = reactionRoles.get(key);
  if(!roleId) return;
  try {
    const guild  = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(()=>null);
    if(!member) return;
    const role = guild.roles.cache.get(roleId);
    if(!role) return;
    await member.roles.remove(role);
  } catch(e) { console.error("reactionRoleRemove error:", e.message); }
});

// ── DM forwarding ──────────────────────────────────────────────────────────────
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.guild) {
    // guild messages handled below
  } else {
    try {
      const owner = await client.users.fetch(OWNER_ID);
      const ownerDM = await owner.createDM();
      if (OWNER_IDS.includes(msg.author.id)) return;
      const displayName = msg.member?.displayName || msg.author.displayName || msg.author.globalName || msg.author.username;
      const header =
        `📬 **DM received**\n` +
        `👤 **Display name:** ${displayName}\n` +
        `🔖 **Username:** @${msg.author.username}\n` +
        `🆔 **User ID:** \`${msg.author.id}\`\n` +
        `📅 <t:${Math.floor(msg.createdTimestamp / 1000)}:f>`;
      await ownerDM.send({ content: header });
      if (msg.content && msg.content.trim().length > 0) {
        await ownerDM.send({ content: `💬 **Message:**\n${msg.content}` });
      }
      if (msg.attachments.size > 0) {
        for (const att of msg.attachments.values()) {
          await ownerDM.send({ content: `📎 **Attachment:** \`${att.name}\` (${att.contentType || "unknown type"})`, files: [att.url] })
            .catch(async () => { await ownerDM.send({ content: `📎 **Attachment (link):** ${att.url}` }).catch(() => {}); });
        }
      }
      if (msg.stickers.size > 0) {
        const stickerList = msg.stickers.map(s => `🎭 **Sticker:** ${s.name}`).join("\n");
        await ownerDM.send({ content: stickerList });
      }
      if (msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          const embedInfo = [embed.title?`**${embed.title}**`:null,embed.description,embed.url?embed.url:null].filter(Boolean).join("\n");
          if (embedInfo.trim()) await ownerDM.send({ content: `🔗 **Embed:**\n${embedInfo.slice(0, 1900)}` }).catch(() => {});
        }
      }
    } catch(e) { console.error("DM forwarding error:", e.message); }
    return;
  }
});

client.on("messageCreate",async msg=>{
  if(msg.author.bot||!msg.guild)return;
  const newLevel=tryAwardXP(msg.author.id,msg.author.username);
  if(newLevel){
    // Get per-guild config, falling back to legacy disabledLevelUp set
    const luc = levelUpConfig.get(msg.guild.id);
    const enabled = luc ? luc.enabled : !disabledLevelUp.has(msg.guild.id);
    if(enabled){
      // Resolve target channel: explicit override > guildChannels default > same channel
      let ch = null;
      if(luc?.channelId) {
        ch = msg.guild.channels.cache.get(luc.channelId) || null;
      }
      if(!ch) {
        const chId = guildChannels.get(msg.guild.id);
        ch = chId ? msg.guild.channels.cache.get(chId) : null;
      }
      if(!ch) ch = msg.channel;
      const ping = luc ? luc.ping : true;
      const mention = ping ? `<@${msg.author.id}>` : `**${msg.author.username}**`;
      if(ch) await safeSend(ch, `🎉 ${mention} levelled up to **Level ${newLevel}**! 🏆`);
    }
  }
  const cg=countGames.get(msg.guild.id);
  if(cg&&msg.channelId===cg.channelId){
    const num=parseInt(msg.content.trim());
    if(!isNaN(num)&&String(num)===msg.content.trim()){
      if(msg.author.id===cg.lastUserId){
        const was=cg.count;cg.count=0;cg.lastUserId=null;
        await msg.react("❌").catch(()=>{});
        await safeSend(msg.channel,`❌ <@${msg.author.id}> counted twice in a row! Back to **0** (was ${was}).`);
      }else if(num===cg.count+1){
        cg.count++;cg.lastUserId=msg.author.id;
        if(cg.count===100){
          countGames.delete(msg.guild.id);
          getScore(msg.author.id,msg.author.username).coins+=200;
          saveData();
          await msg.react("🎉").catch(()=>{});
          await safeSend(msg.channel,`🎉 **100!** <@${msg.author.id}> got the final count and wins **200 coins**! The count game is over.`);
        }else{await msg.react("✅").catch(()=>{});}
      }else{
        const was=cg.count;cg.count=0;cg.lastUserId=null;
        await msg.react("❌").catch(()=>{});
        await safeSend(msg.channel,`❌ <@${msg.author.id}> said **${num}** but expected **${was+1}**! Back to **0**.`);
      }
    }
  }
});

// ── Marriage proposals ────────────────────────────────────────────────────────
// Stores pending proposals: proposerId -> { targetId, channelId, timeout }
const marriageProposals = new Map();

// ── Interaction handler ───────────────────────────────────────────────────────
client.on("interactionCreate",async interaction=>{
  if(!instanceLocked)return;

  if(!interaction.guildId && interaction.user && !interaction.user.bot){
    if(!userInstalls.has(interaction.user.id)){
      userInstalls.add(interaction.user.id);
      saveData();
    }
  }

  // ── BUTTONS ──────────────────────────────────────────────────────────────────
  if(interaction.isButton()||interaction.isSelectMenu()){
    const uid=interaction.user.id;
    const cid=interaction.customId;

    // ── Marriage proposal accept/decline ──────────────────────────────────────
    if(cid.startsWith("marry_accept_")||cid.startsWith("marry_decline_")){
      const proposerId=cid.startsWith("marry_accept_")?cid.slice(13):cid.slice(14);
      const proposal=marriageProposals.get(proposerId);
      if(!proposal){
        try{await interaction.reply({content:"This proposal has already expired or been resolved.",ephemeral:true});}catch{}
        return;
      }
      if(uid!==proposal.targetId){
        try{await interaction.reply({content:"This proposal isn't for you!",ephemeral:true});}catch{}
        return;
      }
      // Clear the timeout and proposal
      clearTimeout(proposal.timeout);
      marriageProposals.delete(proposerId);

      if(!(await btnAck(interaction)))return;

      if(cid.startsWith("marry_accept_")){
        // Double-check neither is already married (could have changed while waiting)
        const proposerScore=getScore(proposerId,null);
        const targetScore=getScore(uid,interaction.user.username);
        if(proposerScore.marriedTo){
          try{await interaction.editReply({content:`💔 The proposal can no longer be accepted — the proposer is already married to someone else.`,components:[]});}catch{}
          return;
        }
        if(targetScore.marriedTo){
          try{await interaction.editReply({content:`💔 You are already married to someone else!`,components:[]});}catch{}
          return;
        }
        proposerScore.marriedTo=uid;
        targetScore.marriedTo=proposerId;
        saveData();
        try{
          await interaction.editReply({
            content:`💍 **${interaction.user.username}** said YES! 🎉\n<@${proposerId}> and <@${uid}> are now married! Congratulations! 💕`,
            components:[]
          });
        }catch{}
      } else {
        try{
          await interaction.editReply({
            content:`💔 **${interaction.user.username}** declined the proposal. Maybe next time, <@${proposerId}>.`,
            components:[]
          });
        }catch{}
      }
      return;
    }

    // Hangman
    if(cid.startsWith("hm_")){
      const letter=cid.slice(3);
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="hangman"){ try{await interaction.reply({content:"No active hangman game.",ephemeral:true});}catch{}return;}
      if(gd.playerId!==uid){ try{await interaction.reply({content:"Not your game!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      gd.guessed.add(letter);
      const wrong=[...gd.guessed].filter(l=>!gd.word.includes(l));
      const won=!gd.word.split("").some(l=>!gd.guessed.has(l));
      if(won){activeGames.delete(interaction.channelId);recordWin(uid,interaction.user.username,40);saveData();try{await interaction.editReply({content:`✅ **Got it!** Word was **${gd.word}**! 🎉 (+40 coins)\n\n${renderHangman(gd.word,gd.guessed)}`,components:makeHangmanButtons(gd.word,gd.guessed,true)});}catch{}}
      else if(wrong.length>=6){activeGames.delete(interaction.channelId);recordLoss(uid,interaction.user.username);saveData();try{await interaction.editReply({content:`💀 **Game over!** Word was **${gd.word}**.\n\n${renderHangman(gd.word,new Set([...gd.guessed,...gd.word.split("")]))}`,components:makeHangmanButtons(gd.word,gd.guessed,true)});}catch{}}
      else{try{await interaction.editReply({content:`🪢 **Hangman**\n\n${renderHangman(gd.word,gd.guessed)}`,components:makeHangmanButtons(gd.word,gd.guessed)});}catch{}}
      return;
    }

    // Snake
    if(cid.startsWith("snake_")){
      const dir=cid.slice(6);
      if(dir==="noop"){try{await interaction.deferUpdate();}catch{}return;}
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="snake"){try{await interaction.reply({content:"No active snake game.",ephemeral:true});}catch{}return;}
      if(gd.playerId!==uid){try{await interaction.reply({content:"Not your game!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      const result=moveSnake(gd,dir);
      if(result!=="ok"){activeGames.delete(interaction.channelId);const coins=gd.score*5;if(coins>0)getScore(uid,interaction.user.username).coins+=coins;recordLoss(uid,interaction.user.username);saveData();try{await interaction.editReply({content:`💀 **Game Over!** Score: **${gd.score}**${coins>0?` (+${coins} coins)`:""}\n\n${renderSnake(gd)}`,components:makeSnakeButtons(true)});}catch{}}
      else{try{await interaction.editReply({content:`🐍 **Snake** | Score: ${gd.score}\n\n${renderSnake(gd)}`,components:makeSnakeButtons()});}catch{}}
      return;
    }

    // Minesweeper
    if(cid.startsWith("ms_")){
      const parts2=cid.split("_"); const row=parseInt(parts2[1]),col=parseInt(parts2[2]);
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="minesweeper"){await btnEphemeral(interaction,"No active minesweeper game here.");return;}
      if(gd.playerId!==uid){await btnEphemeral(interaction,"This is not your game!");return;}
      if(!await btnAck(interaction))return;
      const g=gd.game;
      const mineCount={easy:3,medium:6,hard:10}[gd.diff||"easy"];
      const reward={easy:30,medium:60,hard:100}[gd.diff||"easy"];
      try{
        if(g.mines[row*g.cols+col]){
          g.revealed.fill(true);
          activeGames.delete(interaction.channelId);
          recordLoss(uid,interaction.user.username);
          saveData();
          await interaction.editReply({
            content:`💥 **BOOM!** You hit a mine! Game over.\n💣 **Minesweeper** (${gd.diff||"easy"}) — ${mineCount} mines`,
            components:makeMSButtons(g,true)
          });
        } else {
          revealMS(g,row,col);
          const allDone=g.revealed.every((v,i)=>v||g.mines[i]);
          if(allDone){
            activeGames.delete(interaction.channelId);
            recordWin(uid,interaction.user.username,reward);
            saveData();
            await interaction.editReply({
              content:`🎉 **Board cleared!** +${reward} coins\n💣 **Minesweeper** (${gd.diff||"easy"}) — ${mineCount} mines`,
              components:makeMSButtons(g,true)
            });
          } else {
            const remaining=g.revealed.filter((v,i)=>!v&&!g.mines[i]).length;
            await interaction.editReply({
              content:`💣 **Minesweeper** (${gd.diff||"easy"}) — ${mineCount} mines | ${remaining} cells left`,
              components:makeMSButtons(g)
            });
          }
        }
      }catch(e){console.error("ms click:",e?.message);}
      return;
    }

    // Tic Tac Toe
    if(cid.startsWith("ttt_")){
      const idx=parseInt(cid.slice(4));
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="ttt"){try{await interaction.reply({content:"No active TTT game.",ephemeral:true});}catch{}return;}
      if(uid!==gd.players[gd.turn]){try{await interaction.reply({content:"Not your turn!",ephemeral:true});}catch{}return;}
      if(gd.board[idx]){try{await interaction.reply({content:"That spot is taken!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      gd.board[idx]=gd.turn===0?"X":"O";
      const result=checkTTTWin(gd.board);
      const[p0,p1]=[gd.players[0],gd.players[1]];
      if(result){activeGames.delete(interaction.channelId);let txt;if(result==="draw"){recordDraw(p0,null);recordDraw(p1,null);txt="🤝 **Draw!**";}else{recordWin(gd.players[gd.turn],interaction.user.username,50);recordLoss(gd.players[1-gd.turn],null);txt=`🎉 <@${gd.players[gd.turn]}> wins! (+50 coins)`;}saveData();try{await interaction.editReply({content:`❌⭕ **Tic Tac Toe**\n<@${p0}> ❌  vs  <@${p1}> ⭕\n\n${renderTTT(gd.board)}\n\n${txt}`,components:makeTTTButtons(gd.board,true)});}catch{}}
      else{gd.turn=1-gd.turn;try{await interaction.editReply({content:`❌⭕ **Tic Tac Toe**\n<@${p0}> ❌  vs  <@${p1}> ⭕\n\n${renderTTT(gd.board)}\n\nIt's <@${gd.players[gd.turn]}>'s turn!`,components:makeTTTButtons(gd.board)});}catch{}}
      return;
    }

    // Connect 4
    if(cid.startsWith("c4_")){
      const col=parseInt(cid.slice(3));
      const gd=activeGames.get(interaction.channelId);
      // Always ack the interaction first — Discord requires a response within 3s
      if(!(await btnAck(interaction)))return;
      if(!gd||gd.type!=="c4"){try{await interaction.followUp({content:"No active Connect 4 game.",ephemeral:true});}catch{}return;}
      if(uid!==gd.players[gd.turn]){try{await interaction.followUp({content:"Not your turn!",ephemeral:true});}catch{}return;}
      // Check if column is full (top row of that column — board[0*7+col] = board[col])
      if(gd.board[col]!==0){try{await interaction.followUp({content:"That column is full!",ephemeral:true});}catch{}return;}
      const row=dropC4(gd.board,col,gd.turn+1);
      const[p0,p1]=[gd.players[0],gd.players[1]];
      if(checkC4Win(gd.board,gd.turn+1)){
        activeGames.delete(interaction.channelId);
        recordWin(gd.players[gd.turn],interaction.user.username,50);
        recordLoss(gd.players[1-gd.turn],null);
        saveData();
        try{await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴  vs  <@${p1}> 🔵\n\n${renderC4(gd.board)}\n🎉 <@${gd.players[gd.turn]}> wins! (+50 coins)`,components:makeC4Buttons(true)});}catch{}
      } else if(!gd.board.includes(0)){
        activeGames.delete(interaction.channelId);
        recordDraw(p0,null);recordDraw(p1,null);
        saveData();
        try{await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴  vs  <@${p1}> 🔵\n\n${renderC4(gd.board)}\n🤝 **Draw!**`,components:makeC4Buttons(true)});}catch{}
      } else {
        gd.turn=1-gd.turn;
        try{await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴  vs  <@${p1}> 🔵\n\n${renderC4(gd.board)}\n<@${gd.players[gd.turn]}>'s turn!`,components:makeC4Buttons()});}catch{}
      }
      return;
    }

    // Blackjack
    if(cid.startsWith("bj_")){
      const action=cid.slice(3);
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="blackjack"){try{await interaction.reply({content:"No active blackjack game.",ephemeral:true});}catch{}return;}
      if(gd.playerId!==uid){try{await interaction.reply({content:"Not your game!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      const{deck,playerHand,dealerHand,bet,playerScore}=gd;
      const showBoard=(hide=true)=>`🃏 **Blackjack** (bet: ${bet} coins)\n\n**Your hand:** ${renderHand(playerHand)} — **${handVal(playerHand)}**\n**Dealer:** ${renderHand(dealerHand,hide)}${hide?"":" — **"+handVal(dealerHand)+"**"}`;
      if(action==="hit"){
        playerHand.push(deck.pop());const pv=handVal(playerHand);
        if(pv>21){activeGames.delete(interaction.channelId);playerScore.coins-=bet;recordLoss(uid,interaction.user.username);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n💥 **Bust!** Lost **${bet}** coins.\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}}
        else if(pv===21){while(handVal(dealerHand)<17)dealerHand.push(deck.pop());const dv=handVal(dealerHand);let msg;if(dv>21||pv>dv){playerScore.coins+=bet;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${bet}** coins!`;}else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push!`;}else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}activeGames.delete(interaction.channelId);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}}
        else{try{await interaction.editReply({content:showBoard(true),components:makeBJButtons()});}catch{}}
      }else{
        while(handVal(dealerHand)<17)dealerHand.push(deck.pop());const pv=handVal(playerHand),dv=handVal(dealerHand);let msg;if(dv>21||pv>dv){playerScore.coins+=bet;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${bet}** coins!`;}else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push!`;}else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}activeGames.delete(interaction.channelId);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}
      }
      return;
    }

    // RPS
    if(cid.startsWith("rps_")){
      const lastUnd=cid.lastIndexOf("_");
      const playerId=cid.slice(lastUnd+1);
      const beforePlayer=cid.slice(0,lastUnd);
      const choiceUnd=beforePlayer.lastIndexOf("_");
      const choice=beforePlayer.slice(choiceUnd+1);
      const gameId=beforePlayer.slice(4,choiceUnd);
      if(uid!==playerId){try{await interaction.reply({content:"This button isn't for you!",ephemeral:true});}catch{}return;}
      const gd=activeGames.get(gameId);
      if(!gd||gd.type!=="rps"){try{await interaction.reply({content:"This game has expired.",ephemeral:true});}catch{}return;}
      if(gd.choices[uid]){try{await interaction.reply({content:"You already chose!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      gd.choices[uid]=choice;
      try{await interaction.editReply({content:`✅ You chose **${choice}**! Waiting for opponent...`,components:[]});}catch{}
      if(Object.keys(gd.choices).length===2){
        activeGames.delete(gameId);
        const[id1,id2]=[gd.p1,gd.p2],c1=gd.choices[id1],c2=gd.choices[id2];
        const beats={"✊":"✌️","✋":"✊","✌️":"✋"},names={"✊":"Rock","✋":"Paper","✌️":"Scissors"};
        let txt;if(c1===c2){recordDraw(id1,null);recordDraw(id2,null);txt="🤝 **Draw!**";}
        else if(beats[c1]===c2){recordWin(id1,gd.u1,40);recordLoss(id2,null);txt=`🎉 <@${id1}> wins! ${names[c1]} beats ${names[c2]} (+40 coins)`;}
        else{recordWin(id2,gd.u2,40);recordLoss(id1,null);txt=`🎉 <@${id2}> wins! ${names[c2]} beats ${names[c1]} (+40 coins)`;}
        saveData();
        const ch=client.channels.cache.get(gd.channelId);
        if(ch)await safeSend(ch,`✊✋✌️ **RPS Results!**\n<@${id1}>: ${names[c1]}\n<@${id2}>: ${names[c2]}\n\n${txt}`);
      }
      return;
    }

    // Help pagination
    if(cid.startsWith("help_page_")){
      const page=parseInt(cid.slice(10));
      const TOTAL=6;
      if(page<0||page>=TOTAL){try{await interaction.deferUpdate();}catch{}return;}
      if(!(await btnAck(interaction)))return;
      const HELP_PAGES=[
        {title:"🎉 Fun & Social  —  Page 1 / 6",description:["**Interactions**","`/action type:… user:…` — Hug, pat, poke, stare, wave, high five, boop, oil, diddle, or kill someone","`/punch` `/hug` `/kiss` `/slap` `/throw` — Quick social actions","`/rate type:… user:…` — Rate someone (gay, autistic, simp, cursed, npc, villain, sigma)","`/ppsize user:…` — Check pp size","`/ship user1:… user2:…` — Ship compatibility %","","**Romance**","`/marry user:…` — Propose 💍 (target must accept)","`/divorce` — End the marriage 💔","`/partner [user]` — See who someone is married to","","**Party Games**","`/party type:truth|dare|neverhavei` — Truth, Dare, or Never Have I Ever","","**Conversation**","`/topic` — Random conversation starter","`/wouldyourather` — Would you rather…","`/roast [user]` — Roast someone 🔥","`/compliment user:…` — Compliment someone 💖","`/advice` — Life advice 🧙","`/fact` — Random fun fact 📚","`/horoscope sign:…` — Your daily horoscope ✨","`/poll question:…` — Quick yes/no poll (server only)"].join("\n")},
        {title:"📡 Media & Utility  —  Page 2 / 6",description:["**Media**","`/cat` `/dog` `/fox` `/panda` — Random animal images","`/joke` — Random joke 😂","`/meme` — Random meme 🐸","`/quote` — Inspirational quote ✨","`/trivia` — Trivia question with spoiler answer 🧠","`/avatar user:…` — Get someone's avatar","","**Utility**","`/ping` — Bot latency 🏓","`/coinflip` — Heads or tails 🪙","`/roll [sides]` — Roll a dice (default d6) 🎲","`/choose options:a,b,c` — Pick from comma-separated options","`/echo [message] [embed] [image] [title] [color] [replyto]` — Make the bot say something","`/remind time:… message:…` — Set a reminder (1 min – 1 week)","","**Info**","`/botinfo` — Bot stats","`/serverinfo` — Server member/channel/role info","`/userprofile [user]` — Full profile: level, XP, coins, items, cooldowns"].join("\n")},
        {title:"💰 Economy  —  Page 3 / 6",description:["**Balance & Transfers**","`/coins [user]` — Check coin balance","`/givecoin user:… amount:…` — Transfer coins","","**Earning**","`/work` — Work a shift (1hr cooldown, 50–200 coins)","`/beg` — Beg for coins (5min cooldown, 0–50 coins)","`/crime` — Commit a crime (2hr cooldown, risky!)","`/rob user:…` — Rob someone (1hr cooldown, 45% success)","","**Gambling**","`/slots [bet]` — Slot machine 🎰","`/coinbet bet:… side:heads|tails` — Bet on a coin flip","`/blackjack bet:…` — Blackjack vs the dealer 🃏","","**Shop**","`/shop` — View items","`/buy item:…` — Buy an item","> 🍀 Lucky Charm (200) · ⚡ XP Boost (300) · 🛡️ Shield (150)","`/inventory [user]` — View items","","**Daily**","`/games game:Daily Challenge` — Daily puzzle for coins + streak 📅"].join("\n")},
        {title:"📈 XP & Leaderboards  —  Page 4 / 6",description:["**XP**","You earn XP by sending messages (1 min cooldown). 5–15 XP per message.","Level formula: `floor(50 × level^1.5)` XP per level","","`/xp [user]` — Check XP, level, and progress bar","`/xpleaderboard [scope:global|server]` — Top 10 by XP","","**Stats & Leaderboards**","`/score [user]` — Wins, losses, win rate, streak","`/userprofile [user]` — Everything in one embed","`/leaderboard [type]` — Global top 10","`/serverleaderboard [type]` — Server top 10","> Types: `wins` `coins` `streak` `beststreak` `games` `winrate`"].join("\n")},
        {title:"🎮 Games  —  Page 5 / 6",description:["**Solo** — `/games game:…`","> 🪢 Hangman · 🐍 Snake · 💣 Minesweeper (Easy/Med/Hard)","> 🔢 Number Guess · 🔀 Word Scramble · 📅 Daily Challenge","","**2-Player** — `/2playergames game:… [opponent:…]`","> ❌⭕ Tic Tac Toe *(server only)*","> 🔴🔵 Connect 4 *(server only)*","> ✊ Rock Paper Scissors *(choices sent via DM)*","> 🧮 Math Race · 🏁 Word Race · 🧠 Trivia Battle *(server only)*","> 🔢 Count Game — count to 100 together, no opponent needed *(server only)*","> 🏁 Scramble Race — 5-round word unscramble *(server only)*","","Wins award coins. Check `/score` or `/userprofile` for stats."].join("\n")},
        {title:"⚙️ Server Config  —  Page 6 / 6",description:["All commands here require **Manage Server** permission.","","**Channels & Messages**","`/channelpicker channel:… [levelup]` — Set the bot's main channel","`/xpconfig setting:…` — Level-up messages (on/off, ping toggle, channel)","`/setwelcome channel:… [message]` — Welcome message (`{user}` `{server}` `{count}`)","`/setleave channel:… [message]` — Leave message","`/setboostmsg channel:… [message]` — Boost announcement","`/disableownermsg enabled:…` — Toggle bot owner broadcasts","`/purge amount:…` — Bulk delete (needs Manage Messages)","","**Roles**","`/autorole [role]` — Auto-assign role on join (blank to disable)","`/reactionrole action:add|remove|list …` — Emoji reaction roles","","**Competitions**","`/invitecomp hours:…` — Invite competition with coin rewards","","**Tickets**","`/ticketsetup` · `/closeticket` · `/addtoticket` · `/removefromticket`","","**Overview**","`/serverconfig` — View all current settings"].join("\n")},
      ];
      const p=HELP_PAGES[page];
      const navRow=new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`help_page_${page-1}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(page===0),
        new MessageButton().setCustomId(`help_page_${page+1}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(page>=TOTAL-1),
      );
      try{await interaction.editReply({embeds:[{title:p.title,description:p.description,color:0x5865F2,footer:{text:`Page ${page+1} of ${TOTAL}`}}],components:[navRow]});}catch(e){console.error("help_page:",e?.message);}
      return;
    }

    // botstats users page
    if(cid==="botstats_users"||cid.startsWith("botstats_page_")){
      if(!OWNER_IDS.includes(uid)){await btnEphemeral(interaction,"Owner only.");return;}
      if(!await btnAck(interaction))return;
      const PAGE_SIZE=30;
      const page=cid.startsWith("botstats_page_")?parseInt(cid.slice(14)):0;
      const ids=[...userInstalls];
      const totalPages=Math.max(1,Math.ceil(ids.length/PAGE_SIZE));
      const pageIds=ids.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
      const userLines=[];
      for(const id of pageIds){
        try{
          const u=await client.users.fetch(id).catch(()=>null);
          if(u) userLines.push(`${u.username}${u.discriminator!=="0"?`#${u.discriminator}`:""}  \`${id}\``);
          else   userLines.push(`(unknown)  \`${id}\``);
        }catch{ userLines.push(`(error)  \`${id}\``); }
      }
      const header=`👤 **App Users — Page ${page+1}/${totalPages}** (${ids.length} total tracked)\n\`\`\`\n${userLines.join("\n")||"None"}\n\`\`\``;
      const navRow=new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`botstats_page_${page-1}`).setLabel("← Prev").setStyle("SECONDARY").setDisabled(page===0),
        new MessageButton().setCustomId("botstats_users").setLabel("Back to Stats").setStyle("SECONDARY"),
        new MessageButton().setCustomId(`botstats_page_${page+1}`).setLabel("Next →").setStyle("SECONDARY").setDisabled(page>=totalPages-1),
      );
      try{await interaction.editReply({content:header,components:[navRow]});}catch(e){console.error("botstats_users:",e?.message);}
      return;
    }

    // Ticket setup wizard
    if(cid.startsWith("ts_")){
      if(!interaction.guildId){await btnEphemeral(interaction,"Server only.");return;}
      const isOwner=OWNER_IDS.includes(uid);
      const isAdmin=interaction.member?.permissions.has("MANAGE_GUILD");
      if(!isOwner&&!isAdmin){await btnEphemeral(interaction,"You need Manage Server permission.");return;}
      const guildId=interaction.guildId;
      const guild=interaction.guild;

      function getStep(cfg){
        if(!cfg.categoryId)                     return 1;
        if(!cfg.supportRoleIds?.length)          return 2;
        if(cfg.logChannelId===undefined)         return 3;
        if(cfg.transcriptChannelId===undefined)  return 4;
        if(cfg.panelChannelId===undefined)       return 5;
        return 6;
      }
      function buildStep(stepOverride){
        const cfg=ticketConfigs.get(guildId)||{};
        const step=stepOverride??getStep(cfg);
        const catCh    =cfg.categoryId         ?guild.channels.cache.get(cfg.categoryId):null;
        const roleList =(cfg.supportRoleIds||[]).map(id=>`<@&${id}>`).join(", ")||null;
        const logStr   =cfg.logChannelId        ?`<#${cfg.logChannelId}>`:cfg.logChannelId===null?"None":"—";
        const txStr    =cfg.transcriptChannelId ?`<#${cfg.transcriptChannelId}>`:cfg.transcriptChannelId===null?"None":"—";
        const panelStr =cfg.panelChannelId      ?`<#${cfg.panelChannelId}>`:"—";
        const TICK="✅",CURR="▶️",EMPTY="⬜";
        const prog=[1,2,3,4,5,6].map(s=>s<step?TICK:s===step?CURR:EMPTY);
        const bar=`${prog[0]} Category  ${prog[1]} Roles  ${prog[2]} Log  ${prog[3]} Transcript  ${prog[4]} Panel  ${prog[5]} Done`;
        const cats=[...guild.channels.cache.filter(ch=>ch.type==="GUILD_CATEGORY").values()].slice(0,25);
        const allTxts=[...guild.channels.cache.filter(ch=>ch.type==="GUILD_TEXT").values()];
        const txts=allTxts.slice(0,24);
        const rls=[...guild.roles.cache.filter(r=>!r.managed&&r.id!==guild.id).values()].slice(0,25);
        const skip=[{label:"Skip / None",value:"__none__",description:"Leave this setting disabled"}];
        const done=[];
        if(step>1)done.push(`📁 **Category:** ${catCh?`\`${catCh.name}\``:"—"}`);
        if(step>2)done.push(`🛡️ **Roles:** ${roleList||"—"}`);
        if(step>3)done.push(`📋 **Log:** ${logStr}`);
        if(step>4)done.push(`📜 **Transcript:** ${txStr}`);
        if(step>5)done.push(`📢 **Panel:** ${panelStr}`);
        const summary=done.join("  •  ");
        let header,components;
        if(step===1){
          header=`## 🎫 Ticket Setup — Step 1 of 5: Category\nWhich **category** should new ticket channels be created inside?\n\`${bar}\``;
          const opts=cats.map(ch=>({label:ch.name,value:ch.id,emoji:{name:"📁"}}));
          components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_channel").setPlaceholder("Select a category…").setOptions(opts.length?opts:[{label:"No categories found — create one first",value:"none"}]).setDisabled(!opts.length))];
        }else if(step===2){
          header=`## 🎫 Ticket Setup — Step 2 of 5: Support Roles\n${summary}\n\nWhich **roles** can view and manage all tickets? (up to 5)\n\`${bar}\``;
          const opts=rls.map(r=>({label:r.name.slice(0,25),value:r.id,emoji:{name:"🛡️"},default:(cfg.supportRoleIds||[]).includes(r.id)}));
          components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_roles").setPlaceholder("Select support role(s)…").setMinValues(1).setMaxValues(Math.min(5,Math.max(1,opts.length))).setOptions(opts.length?opts:[{label:"No roles found",value:"none"}]).setDisabled(!opts.length)),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];
        }else if(step===3){
          header=`## 🎫 Ticket Setup — Step 3 of 5: Log Channel\n${summary}\n\nWhich channel should ticket open/close events be **logged** to? *(optional)*\n\`${bar}\``;
          const opts=skip.concat(txts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📋"}})));
          components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_log").setPlaceholder("Select a log channel… (or skip)").setOptions(opts.slice(0,25))),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];
        }else if(step===4){
          header=`## 🎫 Ticket Setup — Step 4 of 5: Transcript Channel\n${summary}\n\nWhich channel should **full ticket transcripts** be posted to? *(optional)*\n\`${bar}\``;
          const opts=skip.concat(txts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📜"}})));
          components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_transcript").setPlaceholder("Select a transcript channel… (or skip)").setOptions(opts.slice(0,25))),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];
        }else if(step===5){
          header=`## 🎫 Ticket Setup — Step 5 of 5: Panel Channel\n${summary}\n\nWhich channel should the **ticket open button** be posted in?\n\`${bar}\``;
          const opts=allTxts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📢"}})).slice(0,25);
          components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_panel_ch").setPlaceholder("Select where to post the panel…").setOptions(opts.length?opts:[{label:"No text channels found",value:"none"}]).setDisabled(!opts.length)),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];
        }else{
          const pv=cfg.panelMessage||"🎫 **Support Tickets** — Click below to open a ticket.";
          header=[`## 🎫 Ticket Setup — Complete!`,`\`${bar}\``,``,`**Configuration:**`,`📁 Category: ${catCh?`\`${catCh.name}\``:"—"}`,`🛡️ Roles: ${roleList||"—"}`,`📋 Log: ${logStr}`,`📜 Transcript: ${txStr}`,`📢 Panel channel: ${panelStr}`,`✉️ Message: ${cfg.panelMessage?`\`${pv.slice(0,80)}${pv.length>80?"…":""}\``:"*(default)*"}`,`🎫 Status: ${cfg.panelMessageId?`✅ Live in <#${cfg.panelChannelId}>`:"❌ Not posted yet"}`,``,`Click **Post Panel** to publish.`].join("\\n");
          components=[new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_post_panel").setLabel("Post Ticket Panel 🎫").setStyle("PRIMARY"),new MessageButton().setCustomId("ts_set_msg").setLabel("Customize Message ✏️").setStyle("SECONDARY"),new MessageButton().setCustomId("ts_back").setLabel("← Edit Settings").setStyle("SECONDARY"),new MessageButton().setCustomId("ts_reset").setLabel("Start Over 🗑️").setStyle("DANGER"))];
        }
        return{content:header,components};
      }

      if(!await btnAck(interaction))return;
      const cfg=ticketConfigs.get(guildId)||{nextId:0};

      if(cid==="ts_sel_channel"){const val=interaction.values[0];if(val!=="none")cfg.categoryId=val;ticketConfigs.set(guildId,cfg);saveData();try{await interaction.editReply(buildStep(2));}catch(e){console.error("ts_sel_channel:",e?.message);}return;}
      if(cid==="ts_sel_roles"){cfg.supportRoleIds=interaction.values.filter(v=>v!=="none");cfg.supportRoleId=cfg.supportRoleIds[0]||null;ticketConfigs.set(guildId,cfg);saveData();try{await interaction.editReply(buildStep(3));}catch(e){console.error("ts_sel_roles:",e?.message);}return;}
      if(cid==="ts_sel_log"){cfg.logChannelId=interaction.values[0]==="__none__"?null:interaction.values[0];ticketConfigs.set(guildId,cfg);saveData();try{await interaction.editReply(buildStep(4));}catch(e){console.error("ts_sel_log:",e?.message);}return;}
      if(cid==="ts_sel_transcript"){cfg.transcriptChannelId=interaction.values[0]==="__none__"?null:interaction.values[0];ticketConfigs.set(guildId,cfg);saveData();try{await interaction.editReply(buildStep(5));}catch(e){console.error("ts_sel_transcript:",e?.message);}return;}
      if(cid==="ts_sel_panel_ch"){const val=interaction.values[0];if(val!=="none")cfg.panelChannelId=val;ticketConfigs.set(guildId,cfg);saveData();try{await interaction.editReply(buildStep(6));}catch(e){console.error("ts_sel_panel_ch:",e?.message);}return;}
      if(cid==="ts_back"){
        const s=getStep(cfg);
        if(s>=6){delete cfg.panelChannelId;}
        else if(s===5){delete cfg.transcriptChannelId;}
        else if(s===4){delete cfg.logChannelId;}
        else if(s===3){cfg.supportRoleIds=[];cfg.supportRoleId=null;}
        else if(s===2){delete cfg.categoryId;}
        ticketConfigs.set(guildId,cfg);saveData();
        try{await interaction.editReply(buildStep());}catch(e){console.error("ts_back:",e?.message);}
        return;
      }
      if(cid==="ts_reset"){ticketConfigs.set(guildId,{nextId:cfg.nextId||0});saveData();try{await interaction.editReply(buildStep(1));}catch(e){console.error("ts_reset:",e?.message);}return;}
      if(cid==="ts_set_msg"){
        try{await interaction.followUp({content:`✏️ **Customize panel message** — type it in chat now (2 min).\nCurrent: ${cfg.panelMessage?`\`${cfg.panelMessage}\``:"*(default)*"}`,ephemeral:true});}catch{}
        const col=interaction.channel.createMessageCollector({filter:m=>m.author.id===uid,max:1,time:120000});
        col.on("collect",async m=>{
          try{await m.delete();}catch{}
          cfg.panelMessage=m.content.trim();
          ticketConfigs.set(guildId,cfg);saveData();
          try{await interaction.editReply(buildStep(6));await interaction.followUp({content:"✅ Panel message saved!",ephemeral:true});}catch{}
        });
        col.on("end",(_,r)=>{if(r==="time")interaction.followUp({content:"⏰ Timed out.",ephemeral:true}).catch(()=>{});});
        return;
      }
      if(cid==="ts_post_panel"){
        if(!cfg.categoryId||!cfg.supportRoleIds?.length||!cfg.panelChannelId){try{await interaction.followUp({content:"⚠️ Complete all steps first.",ephemeral:true});}catch{}return;}
        if(cfg.panelMessageId&&cfg.panelChannelId){const oldCh=guild.channels.cache.get(cfg.panelChannelId);if(oldCh){const old=await oldCh.messages.fetch(cfg.panelMessageId).catch(()=>null);if(old)await old.delete().catch(()=>{});}}
        const targetCh=guild.channels.cache.get(cfg.panelChannelId)||interaction.channel;
        const panelContent=cfg.panelMessage||"🎫 **Support Tickets**\n\nNeed help? Click the button below to open a private support ticket with our team.";
        try{
          const msg=await safeSend(targetCh,{content:panelContent,components:[new MessageActionRow().addComponents(new MessageButton().setCustomId("ticket_open").setLabel("Open a Ticket 🎫").setStyle("PRIMARY"))]});
          if(msg){cfg.panelMessageId=msg.id;cfg.panelChannelId=targetCh.id;}
          ticketConfigs.set(guildId,cfg);saveData();
          try{await interaction.editReply(buildStep(6));}catch{}
          try{await interaction.followUp({content:`✅ Ticket panel posted in <#${targetCh.id}>!`,ephemeral:true});}catch{}
        }catch(e){try{await interaction.followUp({content:`❌ Failed: ${e.message}`,ephemeral:true});}catch{}}
        return;
      }
      try{await interaction.editReply(buildStep());}catch{}
      return;
    }

    // Ticket open
    if(cid==="ticket_open"){
      if(!await btnAck(interaction))return;
      const guildId=interaction.guildId;
      const cfg=ticketConfigs.get(guildId);
      if(!cfg||!cfg.categoryId||!cfg.supportRoleIds?.length){try{await interaction.followUp({content:"⚠️ Ticket system is not configured. Ask an admin to use `/ticketsetup`.",ephemeral:true});}catch{}return;}
      const existing=[...openTickets.values()].find(t=>t.guildId===guildId&&t.userId===uid);
      if(existing){const ch=interaction.guild.channels.cache.get(existing.channelId);try{await interaction.followUp({content:`You already have an open ticket: ${ch?`<#${ch.id}>`:"(channel deleted)"}`,ephemeral:true});}catch{}return;}
      const cfg2=ticketConfigs.get(guildId);
      cfg2.nextId=(cfg2.nextId||0)+1;
      const ticketId=String(cfg2.nextId).padStart(4,"0");
      try{
        const guild=interaction.guild;
        const member=interaction.member;
        const channel=await guild.channels.create(`ticket-${ticketId}`,{
          type:"GUILD_TEXT",
          parent:cfg2.categoryId||undefined,
          permissionOverwrites:[
            {id:guild.roles.everyone,deny:["VIEW_CHANNEL"]},
            {id:uid,allow:["VIEW_CHANNEL","SEND_MESSAGES","READ_MESSAGE_HISTORY"]},
            {id:client.user.id,allow:["VIEW_CHANNEL","SEND_MESSAGES","READ_MESSAGE_HISTORY","MANAGE_CHANNELS"]},
            ...(cfg2.supportRoleIds||[]).map(rid=>({id:rid,allow:["VIEW_CHANNEL","SEND_MESSAGES","READ_MESSAGE_HISTORY"]})),
          ],
          topic:`Ticket #${ticketId} | Opened by ${member.user.tag}`
        });
        openTickets.set(channel.id,{guildId,userId:uid,ticketId,channelId:channel.id,subject:"",openedAt:Date.now()});saveData();
        const closeBtn=new MessageActionRow().addComponents(
          new MessageButton().setCustomId("ticket_close").setLabel("Close Ticket 🔒").setStyle("DANGER"),
          new MessageButton().setCustomId("ticket_claim").setLabel("Claim 🙋").setStyle("SUCCESS"),
        );
        await channel.send({content:`🎫 **Ticket #${ticketId}** — <@${uid}>\n\nHello <@${uid}>! Support will be with you shortly.${(cfg2.supportRoleIds||[]).map(r=>`<@&${r}>`).join(" ")?`\n${(cfg2.supportRoleIds||[]).map(r=>`<@&${r}>`).join(" ")}`:""}`,components:[closeBtn]});
        if(cfg2.logChannelId){const logCh=guild.channels.cache.get(cfg2.logChannelId);if(logCh)await safeSend(logCh,`📂 **Ticket #${ticketId} opened** by <@${uid}> — <#${channel.id}>`);}
        try{await interaction.followUp({content:`✅ Your ticket has been created: <#${channel.id}>`,ephemeral:true});}catch{}
      }catch(e){console.error("ticket_open error:",e);try{await interaction.followUp({content:`❌ Failed to create ticket: ${e.message}`,ephemeral:true});}catch{}}
      return;
    }

    // Ticket close
    if(cid==="ticket_close"){
      if(!await btnAck(interaction))return;
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket){try{await interaction.followUp({content:"This doesn't look like a ticket channel.",ephemeral:true});}catch{}return;}
      const cfg=ticketConfigs.get(ticket.guildId);
      const member=interaction.member;
      const canClose=ticket.userId===uid||OWNER_IDS.includes(uid)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>member.roles.cache.has(rid))||member.permissions.has("MANAGE_CHANNELS");
      if(!canClose){try{await interaction.followUp({content:"You don't have permission to close this ticket.",ephemeral:true});}catch{}return;}
      openTickets.delete(interaction.channelId);saveData();
      if(cfg?.logChannelId){const logCh=interaction.guild.channels.cache.get(cfg.logChannelId);if(logCh)await safeSend(logCh,`🔒 **Ticket #${ticket.ticketId} closed** by <@${uid}>`);}
      try{
        await interaction.editReply({content:`🔒 **Ticket closed** by <@${uid}>. Saving transcript then deleting in 5 seconds.`,components:[]});
        await sendTicketTranscript(interaction.channel, ticket, cfg, `@${interaction.user.username}`);
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),5000);
      }catch{interaction.channel.delete().catch(()=>{});}
      return;
    }

    // Ticket claim
    if(cid==="ticket_claim"){
      if(!await btnAck(interaction))return;
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket){try{await interaction.followUp({content:"This doesn't look like a ticket channel.",ephemeral:true});}catch{}return;}
      const cfg=ticketConfigs.get(ticket.guildId);
      const member=interaction.member;
      const canClaim=OWNER_IDS.includes(uid)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>member.roles.cache.has(rid))||member.permissions.has("MANAGE_CHANNELS");
      if(!canClaim){try{await interaction.followUp({content:"Only support staff can claim tickets.",ephemeral:true});}catch{}return;}
      ticket.claimedBy=uid;
      try{
        await interaction.editReply({content:`🎫 **Ticket #${ticket.ticketId}** — <@${ticket.userId}>\n🙋 **Claimed by <@${uid}>**`,components:[new MessageActionRow().addComponents(new MessageButton().setCustomId("ticket_close").setLabel("Close Ticket 🔒").setStyle("DANGER"))]});
        await safeSend(interaction.channel,`✅ <@${uid}> has claimed this ticket and will be assisting you.`);
      }catch{}
      return;
    }

    try{await interaction.deferUpdate();}catch{}
    return;
  }

  if(!interaction.isCommand())return;
  const cmd=interaction.commandName;
  const inGuild=!!interaction.guildId;

  const ownerOnly=["roler","servers","broadcast","fakecrash","identitycrisis","botolympics","sentience","legendrandom","dmuser","leaveserver","restart","botstats","setstatus","adminuser","adminreset","adminconfig","admingive"];
  if(ownerOnly.includes(cmd)&&!OWNER_IDS.includes(interaction.user.id))return safeReply(interaction,{content:"Owner only.",ephemeral:true});

  const manageServerCmds=["channelpicker","xpconfig","setwelcome","setleave","setwelcomemsg","setleavemsg","disableownermsg","serverconfig","autorole","setboostmsg","invitecomp","purge","reactionrole","ticketsetup"];
  if(manageServerCmds.includes(cmd)){
    if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
    if(!OWNER_IDS.includes(interaction.user.id)&&!interaction.member.permissions.has("MANAGE_GUILD"))
      return safeReply(interaction,{content:"❌ You need **Manage Server** permission.",ephemeral:true});
  }

  try{
    const au=()=>`<@${interaction.user.id}>`;
    const bu=()=>`<@${interaction.options.getUser("user").id}>`;

    if(cmd==="ping")return safeReply(interaction,`🏓 Pong! Latency: **${client.ws.ping}ms**`);
    if(cmd==="avatar"){const u=await client.users.fetch(interaction.options.getUser("user").id);return safeReply(interaction,u.displayAvatarURL({size:1024,dynamic:true}));}

    if(cmd==="punch")    return safeReply(interaction,`${au()} punched ${bu()}`);
    if(cmd==="hug")      return safeReply(interaction,`${au()} hugged ${bu()}`);
    if(cmd==="kiss")     return safeReply(interaction,`${au()} kissed ${bu()}`);
    if(cmd==="slap")     return safeReply(interaction,`${au()} slapped ${bu()}`);
    if(cmd==="throw")    return safeReply(interaction,`${au()} threw ${pick(THROW_ITEMS)} at ${bu()}!`);

    // ── /marry — proposal with accept/decline buttons ─────────────────────────
    if(cmd==="marry"){
      if(!inGuild)return safeReply(interaction,{content:"💍 Marriage proposals only work in servers — the other person needs to be able to see and accept!",ephemeral:true});
      const target=interaction.options.getUser("user");
      if(target.id===interaction.user.id)return safeReply(interaction,{content:"You can't marry yourself.",ephemeral:true});
      if(target.bot)return safeReply(interaction,{content:"You can't marry a bot.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.marriedTo)return safeReply(interaction,{content:`You're already married to <@${s.marriedTo}>! Use /divorce first.`,ephemeral:true});
      const t=getScore(target.id,target.username);
      if(t.marriedTo)return safeReply(interaction,{content:`<@${target.id}> is already married!`,ephemeral:true});
      // Check for existing pending proposal from this user
      if(marriageProposals.has(interaction.user.id)){
        return safeReply(interaction,{content:"You already have a pending proposal! Wait for it to expire or be answered.",ephemeral:true});
      }
      const proposerId=interaction.user.id;
      const row=new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`marry_accept_${proposerId}`).setLabel("💍 Accept").setStyle("SUCCESS"),
        new MessageButton().setCustomId(`marry_decline_${proposerId}`).setLabel("💔 Decline").setStyle("DANGER"),
      );
      // Auto-expire after 60 seconds
      const timeout=setTimeout(()=>{
        if(marriageProposals.has(proposerId)){
          marriageProposals.delete(proposerId);
          // Edit the original message to show it expired
          interaction.editReply({
            content:`💍 **Marriage Proposal** — Expired\n<@${proposerId}> proposed to <@${target.id}> but the proposal timed out.`,
            components:[]
          }).catch(()=>{});
        }
      }, 60000);
      marriageProposals.set(proposerId, { targetId: target.id, timeout });
      return safeReply(interaction,{
        content:`💍 **Marriage Proposal!**\n\n<@${proposerId}> has proposed to <@${target.id}>! 🌹\n\n<@${target.id}>, do you accept?`,
        components:[row]
      });
    }

    if(cmd==="divorce"){
      const s=getScore(interaction.user.id,interaction.user.username);
      if(!s.marriedTo)return safeReply(interaction,{content:"You're not married.",ephemeral:true});
      const t=scores.get(s.marriedTo);if(t)t.marriedTo=null;
      s.marriedTo=null;
      saveData();
      return safeReply(interaction,`💔 **${interaction.user.username}** filed for divorce. It's over.`);
    }
    if(cmd==="partner"){
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);
      if(!s.marriedTo)return safeReply(interaction,`💔 **${u.username}** is single.`);
      return safeReply(interaction,`💑 **${u.username}** is married to <@${s.marriedTo}>.`);
    }

    if(cmd==="action"){
      const t=interaction.options.getString("type");
      const u=interaction.options.getUser("user");
      const au2=`<@${interaction.user.id}>`,bu2=`<@${u.id}>`;
      const KILL_MESSAGES=[
        `☠️ ${au2} has **eliminated** ${bu2}. They never saw it coming.`,
        `🗡️ ${au2} stabbed ${bu2} in the back. Betrayal arc complete.`,
        `💀 ${au2} destroyed ${bu2} with a single look of disappointment.`,
        `🔫 ${au2} absolutely ended ${bu2}. RIP.`,
        `⚔️ ${au2} challenged ${bu2} to a duel. ${bu2} did not survive.`,
        `🪦 ${au2} has slain ${bu2}. Press F to pay respects.`,
        `💣 ${au2} dropped ${bu2} without hesitation.`,
        `🧨 ${au2} went full villain arc and took out ${bu2}.`,
      ];
      const msgs={
        hug:`${au2} hugged ${bu2} 🤗`,
        pat:`${au2} patted ${bu2} on the head 🖐️`,
        poke:`${au2} poked ${bu2} 👉`,
        stare:`${au2} is staring at ${bu2} 👀`,
        wave:`${au2} waved at ${bu2}! 👋`,
        highfive:`${au2} high fived ${bu2}! ✋🤚`,
        boop:`${au2} booped ${bu2} on the nose 👉👃`,
        oil:`${au2} oiled up ${bu2}`,
        diddle:`${bu2} was diddled`,
        kill:pick(KILL_MESSAGES),
      };
      return safeReply(interaction,msgs[t]||`${au2} did something to ${bu2}`);
    }

    if(cmd==="rate"){
      const t=interaction.options.getString("type");
      const u=interaction.options.getUser("user");
      const val=GAY_IDS.includes(u.id)&&["gayrate","howautistic"].includes(t)?100:r(0,100);
      const labels={gayrate:"gay",howautistic:"autistic",simp:"a simp 💘",cursed:"cursed energy 🌀",npc:"NPC 🤖",villain:"villain arc 😈",sigma:"sigma 💪"};
      return safeReply(interaction,`<@${u.id}> is ${val}% ${labels[t]||t}`);
    }
    if(cmd==="party"){
      const t=interaction.options.getString("type");
      if(t==="truth")return safeReply(interaction,`🫢 **Truth:** ${pick(TRUTH_QUESTIONS)}`);
      if(t==="dare")return safeReply(interaction,`😈 **Dare:** ${pick(DARE_ACTIONS)}`);
      if(t==="neverhavei")return safeReply(interaction,`🤚 **Never have I ever${pick(NEVERHAVEI_STMTS)}**\n\nReact 🙋 if you have!`);
    }
    if(cmd==="ppsize"){const s=`8${"=".repeat(r(3,30))}D`;return safeReply(interaction,`${bu()}'s pp: ${s}`);}
    if(cmd==="gayrate"){const u=interaction.options.getUser("user");return safeReply(interaction,`<@${u.id}> is ${GAY_IDS.includes(u.id)?100:r(0,100)}% gay`);}
    if(cmd==="iq")         return safeReply(interaction,`${bu()}'s IQ is ${r(60,180)}`);
    if(cmd==="sus")        return safeReply(interaction,`${bu()} is ${r(0,100)}% sus`);
    if(cmd==="howautistic"){const u=interaction.options.getUser("user");return safeReply(interaction,`<@${u.id}> is ${GAY_IDS.includes(u.id)?100:r(0,100)}% autistic`);}
    if(cmd==="simp")       return safeReply(interaction,`${bu()} is ${r(0,100)}% a simp 💘`);
    if(cmd==="cursed")     return safeReply(interaction,`${bu()} has ${r(0,100)}% cursed energy 🌀`);
    if(cmd==="rizz")       return safeReply(interaction,`${bu()}'s rizz level: ${r(0,100)}/100 😎`);
    if(cmd==="npc")        return safeReply(interaction,`${bu()} is ${r(0,100)}% NPC 🤖`);
    if(cmd==="villain")    return safeReply(interaction,`${bu()}'s villain arc is ${r(0,100)}% complete 😈`);
    if(cmd==="sigma")      return safeReply(interaction,`${bu()}'s sigma rating: ${r(0,100)}/100 💪`);

    if(cmd==="cat")  {await interaction.deferReply();return safeReply(interaction,await getCatGif()    ||"Couldn't fetch a cat 😿");}
    if(cmd==="dog")  {await interaction.deferReply();return safeReply(interaction,await getDogImage()  ||"Couldn't fetch a dog 🐶");}
    if(cmd==="fox")  {await interaction.deferReply();return safeReply(interaction,await getFoxImage()  ||"Couldn't fetch a fox 🦊");}
    if(cmd==="panda"){await interaction.deferReply();return safeReply(interaction,await getPandaImage()||"Couldn't fetch a panda 🐼");}
    if(cmd==="joke") {await interaction.deferReply();return safeReply(interaction,await getJoke()      ||"No joke today.");}
    if(cmd==="meme") {await interaction.deferReply();return safeReply(interaction,await getMeme()      ||"Meme API down 😔");}
    if(cmd==="quote"){await interaction.deferReply();return safeReply(interaction,await getQuote()     ||"The wise are silent today.");}
    if(cmd==="trivia"){
      await interaction.deferReply();const t=await getTrivia();
      if(!t)return safeReply(interaction,"Trivia API is down.");
      return safeReply(interaction,`**${t.question}**\n\n${t.answers.map((a,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${a}`).join("\n")}\n\n||✅ Answer: ${t.correct}||`);
    }

    if(cmd==="coinflip")      return safeReply(interaction,`🪙 **${Math.random()<0.5?"Heads":"Tails"}!**`);
    if(cmd==="roll")          {const sides=interaction.options.getInteger("sides")||6;if(sides<2)return safeReply(interaction,{content:"Need at least 2 sides.",ephemeral:true});return safeReply(interaction,`🎲 You rolled **${r(1,sides)}** on a d${sides}!`);}
    if(cmd==="choose")        {const opts=interaction.options.getString("options").split(",").map(s=>s.trim()).filter(Boolean);if(opts.length<2)return safeReply(interaction,{content:"Give at least 2 options.",ephemeral:true});return safeReply(interaction,`🤔 I choose... **${pick(opts)}**`);}
    if(cmd==="roast")         {const u=interaction.options.getUser("user");return safeReply(interaction,`🔥 ${u?`<@${u.id}>`:au()}: ${pick(ROASTS)}`);}
    if(cmd==="compliment")    return safeReply(interaction,`💖 ${bu()}: ${pick(COMPLIMENTS)}`);
    if(cmd==="ship")          {const u1=interaction.options.getUser("user1"),u2=interaction.options.getUser("user2"),pct=r(0,100),bar="█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));return safeReply(interaction,`💘 **${u1.username}** + **${u2.username}**\n\n${bar} **${pct}%**\n\n${pct>=80?"Soulmates 💕":pct>=50?"There's potential 👀":pct>=30?"It's complicated 😬":"Maybe just friends 😅"}`);}
    if(cmd==="topic")         return safeReply(interaction,`💬 ${pick(TOPICS)}`);
    if(cmd==="wouldyourather")return safeReply(interaction,`🤷 ${pick(WYR)}`);
    if(cmd==="advice")        return safeReply(interaction,`🧙 ${pick(ADVICE)}`);
    if(cmd==="fact")          return safeReply(interaction,`📚 ${pick(FACTS)}`);
    if(cmd==="horoscope")     return safeReply(interaction,HOROSCOPES[interaction.options.getString("sign")]||"Unknown sign.");
    if(cmd==="truth")         return safeReply(interaction,`🫢 **Truth:** ${pick(TRUTH_QUESTIONS)}`);
    if(cmd==="dare")          return safeReply(interaction,`😈 **Dare:** ${pick(DARE_ACTIONS)}`);
    if(cmd==="neverhavei")    return safeReply(interaction,`🤚 **Never have I ever${pick(NEVERHAVEI_STMTS)}**\n\nReact with 🙋 if you have, 🙅 if you haven't!`);

    if(cmd==="echo"){
      const text      = interaction.options.getString("message")||"";
      const useEmbed  = interaction.options.getBoolean("embed")||false;
      const imageUrl  = interaction.options.getString("image")||null;
      const embedTitle= interaction.options.getString("title")||null;
      const colorHex  = interaction.options.getString("color")||null;
      const replyToId = interaction.options.getString("replyto")||null;
      if(!text&&!imageUrl&&!embedTitle)return safeReply(interaction,{content:"❌ Provide at least a message, image, or title.",ephemeral:true});
      await safeReply(interaction,{content:"✅",ephemeral:true});
      const targetCh = getTargetChannel(interaction);
      let replyTarget = null;
      if(replyToId){
        replyTarget = await targetCh.messages.fetch(replyToId).catch(()=>null);
        if(!replyTarget) await interaction.followUp({content:`⚠️ Message ID \`${replyToId}\` not found — sending normally.`,ephemeral:true});
      }
      let resolvedColor = 0x5865F2;
      if(colorHex){const cleaned=colorHex.replace(/^#/,"");const parsed=parseInt(cleaned,16);if(!isNaN(parsed))resolvedColor=parsed;}
      let payload;
      if(useEmbed||imageUrl||embedTitle){
        const embed={description:text||null,title:embedTitle||null,color:resolvedColor,image:imageUrl?{url:imageUrl}:undefined};
        if(!embed.description)delete embed.description;
        if(!embed.title)delete embed.title;
        if(!embed.image)delete embed.image;
        payload={embeds:[embed]};
      }else{payload={content:text};}
      try{
        if(replyTarget){await replyTarget.reply(payload);}
        else{await safeSend(targetCh,payload);}
      }catch(e){await interaction.followUp({content:`❌ Failed to send: ${e.message}`,ephemeral:true}).catch(()=>{});}
      return;
    }

    if(cmd==="poll"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const question=interaction.options.getString("question");
      await safeReply(interaction,`📊 **Poll:** ${question}`);
      const msg=await interaction.fetchReply();
      await msg.react("👍");await msg.react("👎");await msg.react("🤷");
      return;
    }

    if(cmd==="remind"){
      const minutes=interaction.options.getInteger("time");
      const message=interaction.options.getString("message");
      if(minutes<1||minutes>10080)return safeReply(interaction,{content:"Time must be between 1 and 10080 minutes.",ephemeral:true});
      reminders.push({userId:interaction.user.id,channelId:interaction.channelId,time:Date.now()+minutes*60000,message});
      return safeReply(interaction,{content:`⏰ Reminder set! I'll remind you in **${minutes} minute(s)**: **${message}**`,ephemeral:true});
    }

    if(cmd==="serverinfo"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const g=interaction.guild;
      await g.members.fetch();
      const bots=g.members.cache.filter(m=>m.user.bot).size;
      return safeReply(interaction,`🏠 **${g.name}**\n👑 Owner: <@${g.ownerId}>\n👥 Members: **${g.memberCount}** (${g.memberCount-bots} humans, ${bots} bots)\n📅 Created: <t:${Math.floor(g.createdTimestamp/1000)}:R>\n💬 Channels: **${g.channels.cache.filter(c=>c.type==="GUILD_TEXT").size}** text, **${g.channels.cache.filter(c=>c.type==="GUILD_VOICE").size}** voice\n🎭 Roles: **${g.roles.cache.size}**`);
    }

    if(cmd==="userprofile"){
      const u = interaction.options.getUser("user") || interaction.user;
      const s = getScore(u.id, u.username);
      const { level, xp, needed } = xpInfo(s);
      const member = inGuild ? interaction.guild.members.cache.get(u.id) : null;
      const createdTs = Math.floor(u.createdTimestamp / 1000);
      const joinedTs  = member ? Math.floor(member.joinedTimestamp / 1000) : null;
      const barFilled = Math.floor((xp / needed) * 20);
      const xpBar = "█".repeat(barFilled) + "░".repeat(20 - barFilled);
      const winRate = s.gamesPlayed > 0 ? Math.round(s.wins / s.gamesPlayed * 100) : 0;
      const now2 = Date.now();
      const cdStr = (last, cd) => {
        const rem = cd - (now2 - (last||0));
        if (rem <= 0) return "✅ Ready";
        const m = Math.ceil(rem / 60000);
        return m >= 60 ? `⏳ ${Math.floor(m/60)}h ${m%60}m` : `⏳ ${m}m`;
      };
      const ITEM_NAMES = { lucky_charm:"Lucky Charm 🍀", xp_boost:"XP Boost ⚡", shield:"Shield 🛡️" };
      let inventoryText = "Empty";
      if (s.inventory && s.inventory.length > 0) {
        const counts = {};
        s.inventory.forEach(i => counts[i] = (counts[i] || 0) + 1);
        inventoryText = Object.entries(counts).map(([id, qty]) => `${ITEM_NAMES[id]||id} ×${qty}`).join(", ");
      }
      const marriageText = s.marriedTo ? `💍 Married to <@${s.marriedTo}>` : "💔 Single";
      const today2 = new Date().toISOString().slice(0, 10);
      const streakStatus = s.lastDailyDate === today2 ? "✅ Done today" : "❌ Not done today";
      const avatarUrl = u.displayAvatarURL({ size: 256, dynamic: true });
      const lines = [
        `**🪪 Account**`,
        `> 🆔 \`${u.id}\``,
        `> 📅 Created <t:${createdTs}:R>`,
        joinedTs ? `> 📥 Joined server <t:${joinedTs}:R>` : null,
        member   ? `> 🎭 Top role: ${member.roles.highest}` : null,
        `> ${marriageText}`,
        ``,
        `**📈 Level & XP**`,
        `> 🏅 Level **${level}**  ·  ✨ ${xp.toLocaleString()} / ${needed.toLocaleString()} XP`,
        `> \`[${xpBar}]\``,
        ``,
        `**💰 Economy**`,
        `> 🪙 Coins: **${s.coins.toLocaleString()}**`,
        `> 🎒 Inventory: ${inventoryText}`,
        ``,
        `**🎮 Game Stats**`,
        `> 🕹️ Played: **${s.gamesPlayed}**  ·  🏆 Wins: **${s.wins}**  ·  📊 Win rate: **${winRate}%**`,
        ``,
        `**🔥 Daily Streak**`,
        `> ${streakStatus}  ·  Current: **${s.dailyStreak}** day${s.dailyStreak!==1?"s":""}  ·  Best: **${s.bestStreak}**`,
        ``,
        `**⏱️ Cooldowns**`,
        `> 💼 Work: ${cdStr(s.lastWorkTime, CONFIG.work_cooldown_ms)}  ·  🙏 Beg: ${cdStr(s.lastBegTime, CONFIG.beg_cooldown_ms)}`,
        `> 🦹 Crime: ${cdStr(s.lastCrimeTime, CONFIG.crime_cooldown_ms)}  ·  🔫 Rob: ${cdStr(s.lastRobTime, CONFIG.rob_cooldown_ms)}`,
      ].filter(l => l !== null).join("\n");
      return safeReply(interaction, {
        embeds: [{
          author: { name: `${u.username}'s Profile`, icon_url: avatarUrl },
          description: lines,
          color: 0x5865F2,
          thumbnail: { url: avatarUrl },
          footer: { text: `ID: ${u.id}` },
          timestamp: new Date().toISOString(),
        }]
      });
    }

    if(cmd==="botinfo"){
      const guilds=client.guilds.cache.size;
      let totalUsers=0;client.guilds.cache.forEach(g=>totalUsers+=g.memberCount);
      return safeReply(interaction,`🤖 **RoyalBot**\n📡 Servers: **${guilds}**\n👥 Total Users: **${totalUsers.toLocaleString()}**\n⏱️ Uptime: **${Math.floor(process.uptime()/3600)}h ${Math.floor((process.uptime()%3600)/60)}m**\n🏓 Ping: **${client.ws.ping}ms**\n📦 Node.js ${process.version}`);
    }

    if(cmd==="help"){
      const HELP_PAGES = [
        {
          title: "🎉 Fun & Social  —  Page 1 / 6",
          description: [
            "**Interactions**",
            "`/action type:… user:…` — Hug, pat, poke, stare, wave, high five, boop, oil, diddle, or kill someone",
            "`/punch` `/hug` `/kiss` `/slap` `/throw` — Quick social actions",
            "`/rate type:… user:…` — Rate someone (gay, autistic, simp, cursed, npc, villain, sigma)",
            "`/ppsize user:…` — Check pp size 🍆",
            "`/ship user1:… user2:…` — Ship compatibility %",
            "",
            "**Romance**",
            "`/marry user:…` — Propose 💍 (target must accept)",
            "`/divorce` — End the marriage 💔",
            "`/partner [user]` — See who someone is married to",
            "",
            "**Party Games**",
            "`/party type:truth|dare|neverhavei` — Truth, Dare, or Never Have I Ever",
            "",
            "**Conversation**",
            "`/topic` — Random conversation starter",
            "`/wouldyourather` — Would you rather…",
            "`/roast [user]` — Roast someone 🔥",
            "`/compliment user:…` — Compliment someone 💖",
            "`/advice` — Life advice 🧙",
            "`/fact` — Random fun fact 📚",
            "`/horoscope sign:…` — Your daily horoscope ✨",
            "`/poll question:…` — Quick yes/no poll (server only)",
          ].join("\n"),
        },
        {
          title: "📡 Media & Utility  —  Page 2 / 6",
          description: [
            "**Media**",
            "`/cat` — Random cat GIF 🐱",
            "`/dog` — Random dog 🐶",
            "`/fox` — Random fox 🦊",
            "`/panda` — Random panda 🐼",
            "`/joke` — Random joke 😂",
            "`/meme` — Random meme 🐸",
            "`/quote` — Inspirational quote ✨",
            "`/trivia` — Trivia question with answer spoiler 🧠",
            "`/avatar user:…` — Get someone's avatar",
            "",
            "**Utility**",
            "`/ping` — Bot latency 🏓",
            "`/coinflip` — Heads or tails 🪙",
            "`/roll [sides]` — Roll a dice (default d6) 🎲",
            "`/choose options:a,b,c` — Pick between comma-separated options",
            "`/echo [message] [embed] [image] [title] [color] [replyto]` — Make the bot say something",
            "`/remind time:… message:…` — Set a reminder (up to 1 week)",
            "`/poll question:…` — Create a yes/no/shrug poll",
            "",
            "**Info**",
            "`/botinfo` — Bot stats (servers, users, uptime, ping)",
            "`/serverinfo` — Server member count, channels, roles",
            "`/userprofile [user]` — Full profile: level, XP, coins, items, stats, cooldowns",
          ].join("\n"),
        },
        {
          title: "💰 Economy  —  Page 3 / 6",
          description: [
            "**Balance & Transfers**",
            "`/coins [user]` — Check coin balance",
            "`/givecoin user:… amount:…` — Transfer coins to someone",
            "",
            "**Earning**",
            "`/work` — Work a shift (1hr cooldown, 50–200 coins)",
            "`/beg` — Beg for coins (5min cooldown, 0–50 coins)",
            "`/crime` — Commit a crime (2hr cooldown, risky!)",
            "`/rob user:…` — Rob someone (1hr cooldown, 45% success)",
            "",
            "**Gambling**",
            "`/slots [bet]` — Slot machine 🎰 (min 1 coin)",
            "`/coinbet bet:… side:heads|tails` — Bet on a coin flip",
            "`/blackjack bet:…` — Blackjack vs the dealer 🃏",
            "",
            "**Shop**",
            "`/shop` — View available items",
            "`/buy item:…` — Buy an item",
            "> 🍀 Lucky Charm — 200 coins (+10% work bonus 1hr)",
            "> ⚡ XP Boost — 300 coins (2× XP 1hr)",
            "> 🛡️ Shield — 150 coins (blocks next rob)",
            "`/inventory [user]` — View your (or someone's) items",
            "",
            "**Daily**",
            "`/games game:Daily Challenge` — Daily challenge for coins + streak bonus 📅",
          ].join("\n"),
        },
        {
          title: "📈 XP & Leaderboards  —  Page 4 / 6",
          description: [
            "**XP System**",
            "You earn XP automatically by sending messages (1 min cooldown between awards).",
            "XP per message: **5–15 XP** | Level threshold: `floor(50 × level^1.5)` XP",
            "",
            "`/xp [user]` — Check XP, level, and progress bar",
            "`/xpleaderboard [scope:global|server]` — Top 10 by XP",
            "",
            "**Game Stats**",
            "`/score [user]` — Wins, losses, win rate, streak, level",
            "`/userprofile [user]` — Everything in one embed",
            "",
            "**Leaderboards**",
            "`/leaderboard [type]` — Global top 10",
            "`/serverleaderboard [type]` — Server-only top 10",
            "> Types: `wins` `coins` `streak` `beststreak` `games` `winrate`",
          ].join("\n"),
        },
        {
          title: "🎮 Games  —  Page 5 / 6",
          description: [
            "**Solo Games** — `/games game:…`",
            "> 🪢 **Hangman** — Guess the word letter by letter",
            "> 🐍 **Snake** — Navigate with buttons, eat apples",
            "> 💣 **Minesweeper (Easy/Medium/Hard)** — Clear the 5×5 board",
            "> 🔢 **Number Guess** — Guess 1–100 in 10 attempts",
            "> 🔀 **Word Scramble** — Unscramble the word",
            "> 📅 **Daily Challenge** — Math or word puzzle, coins + streak",
            "",
            "**2-Player Games** — `/2playergames game:… [opponent:…]`",
            "> ❌⭕ **Tic Tac Toe** — Classic 3×3 board (server only)",
            "> 🔴🔵 **Connect 4** — Drop pieces, get 4 in a row (server only)",
            "> ✊ **Rock Paper Scissors** — Choices sent via DM privately",
            "> 🧮 **Math Race** — First to answer the multiplication wins",
            "> 🏁 **Word Race** — First to unscramble a word wins",
            "> 🧠 **Trivia Battle** — First to type the correct answer wins",
            "> 🔢 **Count Game** — Count to 100 together, no two in a row (no opponent needed)",
            "> 🏁 **Scramble Race** — 5-round word unscramble, highest score wins",
            "",
            "Wins award coins. Check `/score` or `/userprofile` for your stats.",
          ].join("\n"),
        },
        {
          title: "⚙️ Server Config  —  Page 6 / 6",
          description: [
            "All commands here require **Manage Server** permission.",
            "",
            "**Channels & Messages**",
            "`/channelpicker channel:… [levelup]` — Set the bot's main announcement channel",
            "`/xpconfig setting:…` — Configure level-up messages (on/off, ping, channel)",
            "`/setwelcome channel:… [message]` — Welcome message on member join (`{user}` `{server}` `{count}`)",
            "`/setleave channel:… [message]` — Leave message on member leave",
            "`/setboostmsg channel:… [message]` — Message when someone boosts",
            "`/disableownermsg enabled:…` — Toggle bot owner broadcasts in this server",
            "`/purge amount:…` — Bulk delete messages (needs Manage Messages)",
            "",
            "**Roles & Automation**",
            "`/autorole [role]` — Auto-assign a role to new members (leave blank to disable)",
            "`/reactionrole action:add|remove|list …` — Assign roles via emoji reactions",
            "",
            "**Competitions**",
            "`/invitecomp hours:…` — Start an invite competition with coin rewards",
            "",
            "**Tickets**",
            "`/ticketsetup` — Interactive setup wizard for the ticket system",
            "`/closeticket` — Close the current ticket channel",
            "`/addtoticket user:…` — Add a user to the ticket",
            "`/removefromticket user:…` — Remove a user from the ticket",
            "",
            "**Overview**",
            "`/serverconfig` — View all current settings for this server",
          ].join("\n"),
        },
      ];

      const TOTAL = HELP_PAGES.length;
      function buildHelpEmbed(page) {
        const p = HELP_PAGES[page];
        return {
          embeds: [{
            title: p.title,
            description: p.description,
            color: 0x5865F2,
            footer: { text: `Use the buttons below to navigate • Page ${page+1} of ${TOTAL}` },
          }],
          components: [new MessageActionRow().addComponents(
            new MessageButton().setCustomId(`help_page_${page-1}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(page===0),
            new MessageButton().setCustomId(`help_page_${page+1}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(page>=TOTAL-1),
          )],
          ephemeral: true,
        };
      }
      return safeReply(interaction, buildHelpEmbed(0));
    }

    // ── Economy ────────────────────────────────────────────────────────────────
    if(cmd==="coins"){const u=interaction.options.getUser("user")||interaction.user;return safeReply(interaction,`💰 **${u.username}** has **${getScore(u.id,u.username).coins.toLocaleString()}** coins.`);}
    if(cmd==="givecoin"){
      const target=interaction.options.getUser("user"),amount=interaction.options.getInteger("amount");
      if(target.id===interaction.user.id)return safeReply(interaction,{content:"Can't give coins to yourself.",ephemeral:true});
      if(amount<=0)return safeReply(interaction,{content:"Amount must be positive.",ephemeral:true});
      const giver=getScore(interaction.user.id,interaction.user.username);
      if(giver.coins<amount)return safeReply(interaction,{content:`You only have **${giver.coins}** coins.`,ephemeral:true});
      giver.coins-=amount;getScore(target.id,target.username).coins+=amount;
      saveData();
      return safeReply(interaction,`💸 <@${interaction.user.id}> gave **${amount}** coins to <@${target.id}>!`);
    }
    if(cmd==="slots"){
      const bet=interaction.options.getInteger("bet")||10;
      if(bet<CONFIG.slots_min_bet)return safeReply(interaction,{content:`Min bet is ${CONFIG.slots_min_bet}.`,ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const reels=spinSlots(),{mult,label}=slotPayout(reels),winnings=Math.floor(bet*mult);
      s.coins=s.coins-bet+winnings;
      saveData();
      return safeReply(interaction,`🎰 | ${reels.join(" | ")} |\n\n**${label}**\n`+(mult>=1?`✅ Won **${winnings}** coins! (+${winnings-bet})`:`❌ Lost **${bet}** coins.`)+`\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="coinbet"){
      const bet=interaction.options.getInteger("bet"),side=interaction.options.getString("side");
      if(bet<1)return safeReply(interaction,{content:"Min bet is 1.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const result=Math.random()<0.5?"heads":"tails",won=result===side;s.coins+=won?bet:-bet;
      saveData();
      return safeReply(interaction,`🪙 **${result.charAt(0).toUpperCase()+result.slice(1)}**\n`+(won?`✅ Won **${bet}** coins!`:`❌ Lost **${bet}** coins.`)+`\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="blackjack"){
      const cid=interaction.channelId;
      if(activeGames.has(cid))return safeReply(interaction,{content:"A game is already running here!",ephemeral:true});
      const bet=interaction.options.getInteger("bet");
      if(bet<1)return safeReply(interaction,{content:"Min bet is 1.",ephemeral:true});
      const ps=getScore(interaction.user.id,interaction.user.username);
      if(ps.coins<bet)return safeReply(interaction,{content:`You only have **${ps.coins}** coins.`,ephemeral:true});
      const deck=newDeck(),ph=[deck.pop(),deck.pop()],dh=[deck.pop(),deck.pop()];
      const showBoard=(hide=true)=>`🃏 **Blackjack** (bet: ${bet})\n\n**Your hand:** ${renderHand(ph)} — **${handVal(ph)}**\n**Dealer:** ${renderHand(dh,hide)}${hide?"":" — **"+handVal(dh)+"**"}`;
      if(handVal(ph)===21){const reward=Math.floor(bet*1.5);ps.coins+=reward;ps.wins++;ps.gamesPlayed++;saveData();return safeReply(interaction,{content:`${showBoard(false)}\n\n🎉 **Blackjack!** Won **${reward}** coins!\n💰 Balance: **${ps.coins}**`,components:makeBJButtons(true)});}
      activeGames.set(cid,{type:"blackjack",deck,playerHand:ph,dealerHand:dh,bet,playerScore:ps,playerId:interaction.user.id});
      return safeReply(interaction,{content:showBoard(true),components:makeBJButtons()});
    }
    if(cmd==="work"){
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.work_cooldown_ms-(now-s.lastWorkTime);
      if(rem>0)return safeReply(interaction,{content:`⏰ Rest first. Back in **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastWorkTime=now;const resp=pick(WORK_RESPONSES),coins=r(resp.lo,resp.hi);s.coins+=coins;
      saveData();
      return safeReply(interaction,resp.msg.replace("{c}",coins)+`\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="beg"){
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.beg_cooldown_ms-(now-s.lastBegTime);
      if(rem>0)return safeReply(interaction,{content:`⏰ Wait **${Math.ceil(rem/1000)}s** before begging again.`,ephemeral:true});
      s.lastBegTime=now;const resp=pick(BEG_RESPONSES),coins=resp.give?r(resp.lo,resp.hi):0;s.coins+=coins;
      saveData();
      return safeReply(interaction,resp.msg.replace("{c}",coins)+(coins>0?`\n💰 Balance: **${s.coins}**`:""));
    }
    if(cmd==="crime"){
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.crime_cooldown_ms-(now-s.lastCrimeTime);
      if(rem>0)return safeReply(interaction,{content:`⏰ Lay low for **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastCrimeTime=now;const resp=pick(CRIME_RESPONSES),coins=r(resp.lo,resp.hi);
      if(resp.success)s.coins+=coins;else s.coins=Math.max(0,s.coins-coins);
      saveData();
      return safeReply(interaction,resp.msg.replace("{c}",coins)+`\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="rob"){
      const target=interaction.options.getUser("user");
      if(target.id===interaction.user.id||target.bot)return safeReply(interaction,{content:"Invalid target.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.rob_cooldown_ms-(now-s.lastRobTime);
      if(rem>0)return safeReply(interaction,{content:`⏰ Lay low for **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastRobTime=now;
      const t=getScore(target.id,target.username);
      if(t.inventory&&t.inventory.includes("shield")){t.inventory.splice(t.inventory.indexOf("shield"),1);saveData();return safeReply(interaction,`🛡️ <@${target.id}> had a **Shield**! Your robbery failed and the shield is now broken.`);}
      if(t.coins<10)return safeReply(interaction,`😅 <@${target.id}> is broke — not worth robbing.`);
      const success=Math.random()<0.45;
      if(success){const stolen=Math.floor(t.coins*r(10,30)/100);t.coins-=stolen;s.coins+=stolen;saveData();return safeReply(interaction,`🔫 <@${interaction.user.id}> robbed <@${target.id}> and stole **${stolen}** coins!\n💰 Your balance: **${s.coins}**`);}
      else{const fine=Math.floor(s.coins*r(5,15)/100);s.coins=Math.max(0,s.coins-fine);saveData();return safeReply(interaction,`🚔 You tried to rob <@${target.id}> but got caught! Lost **${fine}** coins.\n💰 Your balance: **${s.coins}**`);}
    }

    const SHOP_ITEMS={lucky_charm:{name:"Lucky Charm",price:200,desc:"+10% coin bonus on work for 1hr"},xp_boost:{name:"XP Boost",price:300,desc:"2× XP gain for 1hr"},shield:{name:"Shield",price:150,desc:"Blocks the next rob attempt"}};
    if(cmd==="shop"){const lines=Object.entries(SHOP_ITEMS).map(([id,item])=>`**${item.name}** (\`${id}\`) — **${item.price}** coins\n> ${item.desc}`);return safeReply(interaction,`🛍️ **Item Shop**\n\n${lines.join("\n\n")}\n\nUse **/buy <item>** to purchase.`);}
    if(cmd==="buy"){
      const itemId=interaction.options.getString("item");
      const item=SHOP_ITEMS[itemId];if(!item)return safeReply(interaction,{content:"Unknown item.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<item.price)return safeReply(interaction,{content:`You need **${item.price}** coins but only have **${s.coins}**.`,ephemeral:true});
      s.coins-=item.price;s.inventory.push(itemId);
      saveData();
      return safeReply(interaction,`✅ Bought **${item.name}** for **${item.price}** coins!\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="inventory"){
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);
      if(!s.inventory||!s.inventory.length)return safeReply(interaction,`🎒 **${u.username}'s Inventory** is empty.`);
      const counts={};s.inventory.forEach(i=>counts[i]=(counts[i]||0)+1);
      const lines=Object.entries(counts).map(([id,qty])=>`**${SHOP_ITEMS[id]?.name||id}** × ${qty}`);
      return safeReply(interaction,`🎒 **${u.username}'s Inventory**\n${lines.join("\n")}`);
    }

    // XP
    if(cmd==="xp"){
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);const{level,xp,needed}=xpInfo(s);
      const filled=Math.floor((xp/needed)*20);
      return safeReply(interaction,`📈 **${u.username}'s XP**\n🏅 Level: **${level}**\n✨ XP: **${xp}** / **${needed}**\n[${"█".repeat(filled)}${"░".repeat(20-filled)}]`);
    }
    if(cmd==="xpleaderboard"){
      const scope=interaction.options.getString("scope")||"global";
      let entries=[...scores.entries()];
      if(scope==="server"){if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});await interaction.guild.members.fetch();const mids=new Set(interaction.guild.members.cache.filter(m=>!m.user.bot).map(m=>m.id));entries=entries.filter(([id])=>mids.has(id));}
      if(!entries.length)return safeReply(interaction,"No XP data yet!");
      const totalXP=([,s])=>{let t=0,lv=s.level||1;for(let i=1;i<lv;i++)t+=Math.floor(50*Math.pow(i,1.5));return t+(s.xp||0);};
      const sorted=[...entries].sort((a,b)=>totalXP(b)-totalXP(a)).slice(0,10);
      const medals=["🥇","🥈","🥉"];
      return safeReply(interaction,`**${scope==="server"?`🏠 ${interaction.guild?.name}`:"🌍 Global"} — XP Leaderboard**\n\n${sorted.map((e,i)=>`${medals[i]||`${i+1}.`} **${e[1].username}** — Level **${e[1].level||1}** (${e[1].xp||0} XP)`).join("\n")}`);
    }

    // Scores
    if(cmd==="score"){
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);const wr=s.gamesPlayed>0?Math.round(s.wins/s.gamesPlayed*100):0;const{level,xp,needed}=xpInfo(s);
      return safeReply(interaction,`🏆 **${u.username}'s Stats**\n🎮 Games: **${s.gamesPlayed}** | Wins: **${s.wins}** | WR: **${wr}%**\n💰 Coins: **${s.coins}**\n🔥 Streak: **${s.dailyStreak}** | Best: **${s.bestStreak}**\n📈 Level: **${level}** | XP: **${xp}/${needed}**`);
    }
    function buildLeaderboard(entries,type,titlePrefix){
      let sorted,title,fmt;
      if(type==="coins"){sorted=[...entries].sort(([,a],[,b])=>b.coins-a.coins);title=`${titlePrefix} — Coins 💰`;fmt=([,s])=>`${s.coins} coins`;}
      else if(type==="streak"){sorted=[...entries].sort(([,a],[,b])=>b.dailyStreak-a.dailyStreak);title=`${titlePrefix} — Daily Streak 🔥`;fmt=([,s])=>`${s.dailyStreak} day streak`;}
      else if(type==="games"){sorted=[...entries].sort(([,a],[,b])=>b.gamesPlayed-a.gamesPlayed);title=`${titlePrefix} — Games Played 🎮`;fmt=([,s])=>`${s.gamesPlayed} games`;}
      else if(type==="winrate"){sorted=entries.filter(([,s])=>s.gamesPlayed>=5).sort(([,a],[,b])=>(b.wins/b.gamesPlayed)-(a.wins/a.gamesPlayed));title=`${titlePrefix} — Win Rate % (min 5)`;fmt=([,s])=>`${Math.round(s.wins/s.gamesPlayed*100)}%`;}
      else if(type==="beststreak"){sorted=[...entries].sort(([,a],[,b])=>b.bestStreak-a.bestStreak);title=`${titlePrefix} — Best Streak 🏅`;fmt=([,s])=>`${s.bestStreak} day best`;}
      else{sorted=[...entries].sort(([,a],[,b])=>b.wins-a.wins);title=`${titlePrefix} — Wins`;fmt=([,s])=>`${s.wins} wins (${s.gamesPlayed} played)`;}
      const medals=["🥇","🥈","🥉"],top=sorted.slice(0,10);
      if(!top.length)return"Not enough data yet.";
      return`**${title}**\n\n${top.map((e,i)=>`${medals[i]||`${i+1}.`} **${e[1].username}** — ${fmt(e)}`).join("\n")}`;
    }
    if(cmd==="leaderboard"){const type=interaction.options.getString("type")||"wins";const entries=[...scores.entries()];if(!entries.length)return safeReply(interaction,"No scores yet!");return safeReply(interaction,buildLeaderboard(entries,type,"🌍 Global"));}
    if(cmd==="serverleaderboard"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      await interaction.guild.members.fetch();
      const mids=new Set(interaction.guild.members.cache.filter(m=>!m.user.bot).map(m=>m.id));
      const entries=[...scores.entries()].filter(([id])=>mids.has(id));
      if(!entries.length)return safeReply(interaction,"No scores in this server yet!");
      return safeReply(interaction,buildLeaderboard(entries,interaction.options.getString("type")||"wins",`🏠 ${interaction.guild.name}`));
    }

    // Daily challenge
    // ── /games — solo game launcher ───────────────────────────────────────────
    if(cmd==="games"){
      const game=interaction.options.getString("game");
      if(game==="daily"){
        const uid=interaction.user.id;
        if(dailyCompletions.has(uid)){const tmrw=new Date();tmrw.setUTCHours(24,0,0,0);const h=Math.ceil((tmrw-Date.now())/3600000);const s=getScore(uid,interaction.user.username);return safeReply(interaction,`✅ Already completed today! Resets in **${h}h**.\n🔥 Streak: **${s.dailyStreak}**`);}
        const ch=getDailyChallenge();const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`📅 **Daily Challenge!**\n\n${ch.desc}\n\nYou have **60 seconds**!`);
        const col=targetCh.createMessageCollector({filter:m=>m.author.id===uid,idle:60*1000});
        col.on("collect",async m=>{if(m.content.trim().toLowerCase()===ch.answer.toLowerCase()){col.stop("won");dailyCompletions.add(uid);const s=recordDaily(uid,interaction.user.username);saveData();const bonus=(s.dailyStreak-1)*CONFIG.daily_streak_bonus;await m.reply(`🎉 **Correct!** +${CONFIG.daily_base_coins+bonus} coins\n🔥 Streak: **${s.dailyStreak}**${s.dailyStreak===s.bestStreak&&s.dailyStreak>1?" 🏆 New best!":""}\n💰 Balance: **${s.coins}**`);}else await m.reply("❌ Not quite! Keep trying...");});
        col.on("end",(_,reason)=>{if(reason==="idle")safeSend(targetCh,`⏰ Daily timed out! Answer was **${ch.answer}**.`);});
        return;
      }
      if(activeGames.has(interaction.channelId))return safeReply(interaction,{content:"A game is already running here!",ephemeral:true});
      if(game==="hangman"){
        const word=pick(HANGMAN_WORDS),guessed=new Set();
        activeGames.set(interaction.channelId,{type:"hangman",word,guessed,playerId:interaction.user.id});
        return safeReply(interaction,{content:`🪢 **Hangman!** <@${interaction.user.id}>, pick a letter!\n\n${renderHangman(word,guessed)}`,components:makeHangmanButtons(word,guessed)});
      }
      if(game==="snake"){
        const sg={type:"snake",snake:[{x:3,y:3}],food:{x:5,y:2},size:7,score:0,playerId:interaction.user.id};
        activeGames.set(interaction.channelId,sg);
        return safeReply(interaction,{content:`🐍 **Snake!** Use the buttons to move.\n\n${renderSnake(sg)}`,components:makeSnakeButtons()});
      }
      if(game.startsWith("minesweeper_")){
        const diff=game.slice(12); // "easy" / "medium" / "hard"
        const mineCount={easy:3,medium:6,hard:10}[diff];
        const mg=initMinesweeper(mineCount);
        activeGames.set(interaction.channelId,{type:"minesweeper",game:mg,diff,playerId:interaction.user.id});
        return safeReply(interaction,{content:`💣 **Minesweeper** (${diff}) — 5×5 grid, ${mineCount} mines\nClick any cell to reveal it. Avoid the mines!`,components:makeMSButtons(mg)});
      }
      if(game==="numberguess"){
        const target=r(1,100);let attempts=0;
        activeGames.set(interaction.channelId,{type:"numberguess"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🔢 **Number Guess!** 1–100, 10 attempts!`);
        const col=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id&&!isNaN(m.content.trim()),idle:2*60*1000});
        col.on("collect",async m=>{const guess=parseInt(m.content.trim());attempts++;if(guess===target){col.stop();activeGames.delete(interaction.channelId);recordWin(interaction.user.id,interaction.user.username,30);saveData();await m.reply(`🎉 **${target}** in **${attempts}** attempt(s)! (+30 coins)`);}else if(attempts>=10){col.stop();activeGames.delete(interaction.channelId);recordLoss(interaction.user.id,interaction.user.username);saveData();await m.reply(`💀 Out of attempts! It was **${target}**.`);}else await m.reply(guess<target?`📈 Too low! ${10-attempts} left.`:`📉 Too high! ${10-attempts} left.`);});
        col.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(interaction.channelId);safeSend(getTargetChannel(interaction),`⏰ Timed out! It was **${target}**.`);}});
        return;
      }
      if(game==="wordscramble"){
        const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
        activeGames.set(interaction.channelId,{type:"wordscramble"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🔀 **Word Scramble!** Unscramble: **\`${scrambled}\`**`);
        const col=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id,idle:60*1000});
        col.on("collect",async m=>{if(m.content.trim().toLowerCase()===word){col.stop();activeGames.delete(interaction.channelId);recordWin(interaction.user.id,interaction.user.username,25);saveData();await m.reply(`🎉 **${word}**! (+25 coins)`);}else await m.reply("❌ Not quite! Keep trying...");});
        col.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(interaction.channelId);safeSend(getTargetChannel(interaction),`⏰ Timed out! It was **${word}**.`);}});
        return;
      }
      return safeReply(interaction,{content:"Unknown game.",ephemeral:true});
    }

    // ── /2playergames — multiplayer game launcher ─────────────────────────────
    if(cmd==="2playergames"){
      const game=interaction.options.getString("game");
      const opp=interaction.options.getUser("opponent");

      // Count game doesn't need an opponent
      if(game==="countgame"){
        if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
        if(countGames.has(interaction.guildId)){const cg=countGames.get(interaction.guildId);return safeReply(interaction,`🔢 Count game is active in <#${cg.channelId}>! Currently at **${cg.count}**. Count up to 100 together!`);}
        countGames.set(interaction.guildId,{count:0,lastUserId:null,channelId:interaction.channelId});
        return safeReply(interaction,`🔢 **Count Game started!** Count from 1 to 100 together — but no two messages in a row from the same person!\n\nStart counting: type **1**!`);
      }

      // All other 2p games need an opponent
      if(!opp)return safeReply(interaction,{content:"❌ Please provide an `opponent` for this game.",ephemeral:true});
      if(opp.bot||opp.id===interaction.user.id)return safeReply(interaction,{content:"Invalid opponent.",ephemeral:true});

      // Board games need a shared guild channel
      const needsSharedChannel=["tictactoe","connect4","mathrace","wordrace","triviabattle","scramblerace"];
      if(needsSharedChannel.includes(game)&&!inGuild)return safeReply(interaction,{content:"❌ This game requires a server — both players need to see the same channel!",ephemeral:true});

      if(activeGames.has(interaction.channelId))return safeReply(interaction,{content:"A game is already running here!",ephemeral:true});

      if(game==="tictactoe"){
        const g={type:"ttt",board:Array(9).fill(null),players:[interaction.user.id,opp.id],turn:0};
        activeGames.set(interaction.channelId,g);
        return safeReply(interaction,{content:`❌⭕ **Tic Tac Toe**\n<@${g.players[0]}> ❌  vs  <@${opp.id}> ⭕\n\nIt's <@${g.players[0]}>'s turn!`,components:makeTTTButtons(g.board)});
      }
      if(game==="connect4"){
        const g={type:"c4",board:Array(42).fill(0),players:[interaction.user.id,opp.id],turn:0};
        activeGames.set(interaction.channelId,g);
        return safeReply(interaction,{content:`🔴🔵 **Connect 4**\n<@${g.players[0]}> 🔴  vs  <@${opp.id}> 🔵\n\n${renderC4(g.board)}\n<@${g.players[0]}>'s turn!`,components:makeC4Buttons()});
      }
      if(game==="rps"){
        const gameId=`${interaction.channelId}${Date.now()}`;
        activeGames.set(gameId,{type:"rps",p1:interaction.user.id,p2:opp.id,u1:interaction.user.username,u2:opp.username,choices:{},channelId:interaction.channelId});
        const mkBtns=(pid)=>[new MessageActionRow().addComponents(
          new MessageButton().setCustomId(`rps_${gameId}_✊_${pid}`).setLabel("Rock ✊").setStyle("SECONDARY"),
          new MessageButton().setCustomId(`rps_${gameId}_✋_${pid}`).setLabel("Paper ✋").setStyle("SECONDARY"),
          new MessageButton().setCustomId(`rps_${gameId}_✌️_${pid}`).setLabel("Scissors ✌️").setStyle("SECONDARY"),
        )];
        try{const dm1=await interaction.user.createDM();await dm1.send({content:`🎮 RPS vs <@${opp.id}>! Choose:`,components:mkBtns(interaction.user.id)});const dm2=await opp.createDM();await dm2.send({content:`🎮 RPS vs <@${interaction.user.id}>! Choose:`,components:mkBtns(opp.id)});return safeReply(interaction,`✊✋✌️ **RPS!** <@${interaction.user.id}> vs <@${opp.id}> — Check your DMs!`);}
        catch{activeGames.delete(gameId);return safeReply(interaction,{content:"Couldn't DM one of the players (DMs may be off).",ephemeral:true});}
      }
      if(game==="mathrace"){
        const av=r(2,12),bv=r(2,12),answer=String(av*bv);
        activeGames.set(interaction.channelId,{type:"mathrace"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🧮 **Math Race!** <@${interaction.user.id}> vs <@${opp.id}>\n\n**What is ${av} × ${bv}?**`);
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim()===answer,max:1,time:30000,errors:["time"]});activeGames.delete(interaction.channelId);const w=col.first().author,l=w.id===interaction.user.id?opp:interaction.user;recordWin(w.id,w.username,40);recordLoss(l.id,l.username);saveData();await col.first().reply(`🎉 **${w.username} wins!** Answer: **${answer}** (+40 coins)`);}
        catch{activeGames.delete(interaction.channelId);await safeSend(getTargetChannel(interaction),`⏰ Time's up! Answer: **${answer}**.`);}
        return;
      }
      if(game==="wordrace"){
        const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
        activeGames.set(interaction.channelId,{type:"wordrace"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🏁 **Word Race!** <@${interaction.user.id}> vs <@${opp.id}>\n\nUnscramble: **\`${scrambled}\`**`);
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===word,max:1,time:60000,errors:["time"]});activeGames.delete(interaction.channelId);const w=col.first().author,l=w.id===interaction.user.id?opp:interaction.user;recordWin(w.id,w.username,40);recordLoss(l.id,l.username);saveData();await col.first().reply(`🎉 **${w.username} wins!** Word: **${word}** (+40 coins)`);}
        catch{activeGames.delete(interaction.channelId);await safeSend(getTargetChannel(interaction),`⏰ Time's up! Word: **${word}**.`);}
        return;
      }
      if(game==="triviabattle"){
        await interaction.deferReply();
        const t=await getTrivia();
        if(!t)return safeReply(interaction,"Trivia API is down. Try again later.");
        activeGames.set(interaction.channelId,{type:"triviabattle"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,{content:`🧠 **Trivia Battle!** <@${interaction.user.id}> vs <@${opp.id}>\n\n**${t.question}**\n\n${t.answers.map((a,i)=>`${["🇦","🇧","🇨","🇩"][i]} ${a}`).join("\n")}\n\nFirst to type the correct answer wins! You have **30 seconds**.`});
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===t.correct.toLowerCase(),max:1,time:30000,errors:["time"]});activeGames.delete(interaction.channelId);const winner=col.first().author,loser=winner.id===interaction.user.id?opp:interaction.user;recordWin(winner.id,winner.username,60);recordLoss(loser.id,loser.username);saveData();await col.first().reply(`🎉 **${winner.username}** wins! Answer: **${t.correct}** (+60 coins)`);}
        catch{activeGames.delete(interaction.channelId);await safeSend(getTargetChannel(interaction),`⏰ Time's up! The answer was **${t.correct}**.`);}
        return;
      }
      if(game==="scramblerace"){
        const words=[];while(words.length<5){const w=pick(HANGMAN_WORDS);if(!words.includes(w))words.push(w);}
        const scrambled=words.map(w=>w.split("").sort(()=>Math.random()-0.5).join(""));
        const state={type:"scramblerace",words,scrambled,scores:{[interaction.user.id]:0,[opp.id]:0},current:0,players:[interaction.user.id,opp.id]};
        activeGames.set(interaction.channelId,state);
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🏁 **Scramble Race!** <@${interaction.user.id}> vs <@${opp.id}>\n\nFirst to unscramble 5 words wins!\n\n**Word 1/5:** \`${scrambled[0]}\`\n\nType your answer!`);
        const col=targetCh.createMessageCollector({filter:m=>[interaction.user.id,opp.id].includes(m.author.id),time:3*60*1000});
        col.on("collect",async m=>{
          const gd=activeGames.get(interaction.channelId);if(!gd||gd.type!=="scramblerace")return;
          if(m.content.trim().toLowerCase()===gd.words[gd.current]){
            gd.scores[m.author.id]=(gd.scores[m.author.id]||0)+1;
            await m.react("✅");
            gd.current++;
            if(gd.current>=5){
              col.stop("done");activeGames.delete(interaction.channelId);
              const s0=gd.scores[interaction.user.id]||0,s1=gd.scores[opp.id]||0;
              let txt;
              if(s0>s1){recordWin(interaction.user.id,interaction.user.username,80);recordLoss(opp.id,opp.username);txt=`🎉 <@${interaction.user.id}> wins **${s0}–${s1}**! (+80 coins)`;}
              else if(s1>s0){recordWin(opp.id,opp.username,80);recordLoss(interaction.user.id,interaction.user.username);txt=`🎉 <@${opp.id}> wins **${s1}–${s0}**! (+80 coins)`;}
              else{recordDraw(interaction.user.id,interaction.user.username);recordDraw(opp.id,opp.username);txt=`🤝 Tie! **${s0}–${s1}**`;}
              saveData();
              await safeSend(targetCh,`🏁 **Scramble Race over!**\n\n${txt}`);
            }else{await safeSend(targetCh,`**Word ${gd.current+1}/5:** \`${gd.scrambled[gd.current]}\``);}
          }
        });
        col.on("end",(_,reason)=>{if(reason!=="done"){activeGames.delete(interaction.channelId);safeSend(getTargetChannel(interaction),"⏰ Scramble Race timed out!");}});
        return;
      }
      return safeReply(interaction,{content:"Unknown game.",ephemeral:true});
    }

    // Server management
    if(cmd==="channelpicker"){
      const ch=interaction.options.getChannel("channel");
      if(ch.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Select a text channel.",ephemeral:true});
      guildChannels.set(interaction.guildId,ch.id);saveData();
      const levelupOpt=interaction.options.getBoolean("levelup");
      if(levelupOpt===false){disabledLevelUp.add(interaction.guildId);saveData();return safeReply(interaction,{content:`✅ Bot channel → <#${ch.id}>\n🔇 Level-up notifications **disabled**.`,ephemeral:true});}
      else{disabledLevelUp.delete(interaction.guildId);saveData();return safeReply(interaction,{content:`✅ Bot channel → <#${ch.id}>\n🔔 Level-up notifications **enabled**.`,ephemeral:true});}
    }

    if(cmd==="xpconfig"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const setting=interaction.options.getString("setting");
      const guildId=interaction.guildId;

      // Get or create per-guild level-up config, seeding from legacy disabledLevelUp
      function getLUC(){
        if(!levelUpConfig.has(guildId)){
          levelUpConfig.set(guildId,{
            enabled: !disabledLevelUp.has(guildId),
            ping:    true,
            channelId: null,
          });
        }
        return levelUpConfig.get(guildId);
      }

      if(setting==="show"){
        const c=getLUC();
        const chStr=c.channelId
          ?`<#${c.channelId}>`
          :guildChannels.get(guildId)
            ?`<#${guildChannels.get(guildId)}> *(bot channel fallback)*`
            :"*(same channel as the levelled-up message)*";
        return safeReply(interaction,{
          embeds:[{
            title:"⚙️ Level-up Notification Config",
            description:[
              `**Messages enabled:** ${c.enabled?"✅ Yes":"❌ No"}`,
              `**@Mention ping:**    ${c.ping?"✅ Yes":"❌ No — shows username only"}`,
              `**Channel:**          ${chStr}`,
              ``,
              "Use `/xpconfig setting:<option>` to change any setting.",
            ].join("\n"),
            color:0x5865F2,
          }],
          ephemeral:true,
        });
      }
      if(setting==="enable"){
        const c=getLUC();c.enabled=true;
        disabledLevelUp.delete(guildId);saveData();
        return safeReply(interaction,{content:"✅ Level-up messages **enabled**.",ephemeral:true});
      }
      if(setting==="disable"){
        const c=getLUC();c.enabled=false;
        disabledLevelUp.add(guildId);saveData();
        return safeReply(interaction,{content:"🔇 Level-up messages **disabled**.",ephemeral:true});
      }
      if(setting==="ping_on"){
        const c=getLUC();c.ping=true;saveData();
        return safeReply(interaction,{content:"✅ Level-up messages will now **@mention** the user.",ephemeral:true});
      }
      if(setting==="ping_off"){
        const c=getLUC();c.ping=false;saveData();
        return safeReply(interaction,{content:"✅ Level-up messages will now show the **username without pinging**.",ephemeral:true});
      }
      if(setting==="set_channel"){
        const ch=interaction.options.getChannel("channel");
        if(!ch)return safeReply(interaction,{content:"❌ Please also select a `channel`.",ephemeral:true});
        if(ch.type!=="GUILD_TEXT")return safeReply(interaction,{content:"❌ Must be a text channel.",ephemeral:true});
        const c=getLUC();c.channelId=ch.id;saveData();
        return safeReply(interaction,{content:`✅ Level-up messages will be sent to <#${ch.id}>.`,ephemeral:true});
      }
      if(setting==="reset_channel"){
        const c=getLUC();c.channelId=null;saveData();
        const fallback=guildChannels.get(guildId);
        return safeReply(interaction,{
          content:fallback
            ?`✅ Channel reset — will fall back to <#${fallback}> (bot channel).`
            :"✅ Channel reset — messages will be sent in the same channel as the levelled-up message.",
          ephemeral:true,
        });
      }
      return safeReply(interaction,{content:"Unknown setting.",ephemeral:true});
    }
    if(cmd==="setwelcome"){
      const ch=interaction.options.getChannel("channel");
      if(ch.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Select a text channel.",ephemeral:true});
      const msg=interaction.options.getString("message")||null;
      welcomeChannels.set(interaction.guildId,{channelId:ch.id,message:msg});saveData();
      const preview=(msg||"Welcome to **{server}**, {user}! 🎉 You are member #{count}.").replace("{user}","@NewUser").replace("{server}",interaction.guild.name).replace("{count}","?");
      return safeReply(interaction,{content:`✅ Welcome → <#${ch.id}>\n**Preview:** ${preview}`,ephemeral:true});
    }
    if(cmd==="setleave"){
      const ch=interaction.options.getChannel("channel");
      if(ch.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Select a text channel.",ephemeral:true});
      const msg=interaction.options.getString("message")||null;
      leaveChannels.set(interaction.guildId,{channelId:ch.id,message:msg});saveData();
      const preview=(msg||"**{user}** has left **{server}**. 👋").replace("{user}","Username").replace("{server}",interaction.guild.name);
      return safeReply(interaction,{content:`✅ Leave → <#${ch.id}>\n**Preview:** ${preview}`,ephemeral:true});
    }
    if(cmd==="disableownermsg"){
      const enabled=interaction.options.getBoolean("enabled");
      if(enabled)disabledOwnerMsg.delete(interaction.guildId);else disabledOwnerMsg.add(interaction.guildId);saveData();
      return safeReply(interaction,{content:enabled?"✅ Owner messages **enabled** in this server.":"🔇 Owner messages **disabled** in this server.",ephemeral:true});
    }

    // Owner commands
    if(cmd==="broadcast"){
      await interaction.deferReply({ephemeral:true});
      const message=interaction.options.getString("message");let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id)){failed++;continue;}try{const o=await client.users.fetch(g.ownerId);await o.send(`**Message from the bot owner:**\n${message}`);sent++;}catch{failed++;}}
      return safeReply(interaction,`Broadcast done — sent: ${sent}, skipped/failed: ${failed}`);
    }
    if(cmd==="fakecrash"){
      await interaction.deferReply({ephemeral:true});const sent=[];
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;const ch=getBestChannel(g);if(ch){try{await ch.send("ERROR: fatal exception in core module");sent.push(ch);}catch{}}}
      await safeReply(interaction,`Sent to ${sent.length} servers. Revealing in 5min.`);
      setTimeout(async()=>{for(const ch of sent){try{await ch.send("Yo my bad gang, i didn't crash lol, just playing");}catch{}}},5*60*1000);return;
    }
    if(cmd==="identitycrisis"){
      await interaction.deferReply({ephemeral:true});const seen=new Set();let sent=0,failed=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id)||seen.has(g.ownerId))continue;seen.add(g.ownerId);try{const o=await client.users.fetch(g.ownerId);const dm=await o.createDM();sendCrisisToOwner(dm).catch(()=>{});sent++;}catch{failed++;}}
      return safeReply(interaction,`Crisis initiated for ${sent} owners (${failed} failed)`);
    }
    if(cmd==="botolympics"){
      await interaction.deferReply({ephemeral:true});
      const eventIdx=parseInt(interaction.options.getString("event"));
      const event=OLYMPICS_EVENTS[eventIdx];
      if(!event)return safeReply(interaction,"Invalid event.");
      let launched=0;
      for(const g of client.guilds.cache.values()){
        if(disabledOwnerMsg.has(g.id))continue;
        const ch=getGuildChannel(g);if(!ch)continue;launched++;
        if(event.inviteComp){runInviteOlympicsInGuild(g,event,ch).catch(err=>console.error(`Invite Olympics error in ${g.name}:`,err));}
        else{runOlympicsInGuild(g,event).catch(()=>{});}
      }
      const durationLabel=event.duration>=1440?`${Math.round(event.duration/1440)} day(s)`:event.duration>=60?`${Math.round(event.duration/60)} hour(s)`:`${event.duration} minute(s)`;
      return safeReply(interaction,`🏅 **${event.name}** launched in **${launched}** server(s)!\n`+(event.inviteComp?`⏳ Duration: **${durationLabel}**`:""));
    }
    if(cmd==="sentience"){
      await interaction.deferReply({ephemeral:true});let sent=0;
      for(const g of client.guilds.cache.values()){if(!await ownerSend(g,pick(SENTIENCE_MESSAGES)))continue;sent++;await new Promise(res=>setTimeout(res,2000));await ownerSend(g,"Reset bot cache");}
      return safeReply(interaction,`Sentience triggered in ${sent} servers.`);
    }
    if(cmd==="legendrandom"){
      await interaction.deferReply({ephemeral:true});let sent=0;
      for(const g of client.guilds.cache.values()){if(disabledOwnerMsg.has(g.id))continue;const ch=getGuildChannel(g);if(!ch)continue;try{await g.members.fetch();const humans=[...g.members.cache.filter(m=>!m.user.bot).values()];if(!humans.length)continue;const chosen=pick(humans);await ch.send(pick(LEGENDS)(chosen.user.username));sent++;}catch{}}
      return safeReply(interaction,`Legends told in ${sent} servers.`);
    }
    if(cmd==="servers"){
      await interaction.deferReply({ephemeral:true});let text="";
      for(const g of client.guilds.cache.values()){try{const ch=g.channels.cache.find(c=>c.type==="GUILD_TEXT"&&g.members.me&&c.permissionsFor(g.members.me).has("CREATE_INSTANT_INVITE"));if(ch){const inv=await ch.createInvite({maxAge:0});text+=`${g.name} — ${inv.url}\n`;}else text+=`${g.name} — no invite perms\n`;}catch{text+=`${g.name} — error\n`;}if(text.length>1800){text+="…and more";break;}}
      return safeReply(interaction,text||"No servers");
    }
    if(cmd==="botstats"){
      await interaction.deferReply({ephemeral:true});
      let totalUsers=0,serverList="";
      for(const g of client.guilds.cache.values()){totalUsers+=g.memberCount;serverList+=`• ${g.name} (${g.memberCount.toLocaleString()})\n`;if(serverList.length>1500){serverList+="…and more\n";break;}}
      const ui=await getUserAppInstalls();
      const appUserCount=userInstalls.size;
      const content=`**Bot Stats**\nServers: **${client.guilds.cache.size.toLocaleString()}**\nTotal users (across servers): **${totalUsers.toLocaleString()}**\nApp installs (Discord estimate): **${typeof ui==="number"?ui.toLocaleString():ui}**\nTracked app users (interacted outside servers): **${appUserCount}**\n\n${serverList}`;
      const btn=new MessageActionRow().addComponents(new MessageButton().setCustomId("botstats_users").setLabel(`View App Users (${appUserCount})`).setStyle("SECONDARY").setDisabled(appUserCount===0));
      return safeReply(interaction,{content,components:[btn]});
    }
    if(cmd==="dmuser"){
      await interaction.deferReply({ephemeral:true});
      const userId=interaction.options.getUser("user").id,message=interaction.options.getString("message");
      try{const u=await client.users.fetch(userId);await u.send(message);return safeReply(interaction,"DM sent");}
      catch{return safeReply(interaction,"Could not send DM");}
    }
    if(cmd==="leaveserver"){const guild=client.guilds.cache.get(interaction.options.getString("server"));if(!guild)return safeReply(interaction,{content:"Server not found.",ephemeral:true});const name=guild.name;await guild.leave();return safeReply(interaction,{content:`Left ${name}`,ephemeral:true});}
    if(cmd==="restart"){await safeReply(interaction,{content:"Restarting…",ephemeral:true});process.exit(0);}
    if(cmd==="setstatus"){const text=interaction.options.getString("text"),type=interaction.options.getString("type")||"PLAYING";client.user.setActivity(text,{type});return safeReply(interaction,{content:`Status → ${type}: ${text}`,ephemeral:true});}
    if(cmd==="adminuser"){
      const target=interaction.options.getUser("user"),field=interaction.options.getString("field"),value=interaction.options.getInteger("value");
      if(!["coins","wins","gamesPlayed","dailyStreak","bestStreak","xp","level"].includes(field))return safeReply(interaction,{content:"Invalid field.",ephemeral:true});
      if(value<0)return safeReply(interaction,{content:"Value must be ≥ 0.",ephemeral:true});
      const s=getScore(target.id,target.username),old=s[field];s[field]=value;
      if(field==="dailyStreak"&&value>s.bestStreak)s.bestStreak=value;
      if(field==="xp"||field==="level")xpInfo(s);
      saveData();
      return safeReply(interaction,{content:`✅ **${target.username}**.${field}: \`${old}\` → \`${value}\``,ephemeral:true});
    }
    if(cmd==="adminreset"){
      const target=interaction.options.getUser("user");
      scores.set(target.id,{username:target.username,wins:0,gamesPlayed:0,coins:0,dailyStreak:0,bestStreak:0,lastDailyDate:"",xp:0,level:1,lastWorkTime:0,lastBegTime:0,lastCrimeTime:0,lastRobTime:0,inventory:[],marriedTo:null});
      saveData();
      return safeReply(interaction,{content:`✅ Reset all stats for **${target.username}**.`,ephemeral:true});
    }
    if(cmd==="adminconfig"){
      const key=interaction.options.getString("key"),value=interaction.options.getInteger("value");
      if(!key){const lines=Object.entries(CONFIG).map(([k,v])=>`**${k}**: \`${v}\``).join("\n");return safeReply(interaction,{content:`⚙️ **Config**\n\n${lines}`,ephemeral:true});}
      if(!(key in CONFIG))return safeReply(interaction,{content:"Unknown key.",ephemeral:true});
      if(value==null)return safeReply(interaction,{content:`⚙️ **${key}** = \`${CONFIG[key]}\``,ephemeral:true});
      const old=CONFIG[key];CONFIG[key]=value;
      return safeReply(interaction,{content:`✅ **${key}**: \`${old}\` → \`${value}\``,ephemeral:true});
    }
    if(cmd==="admingive"){
      const target=interaction.options.getUser("user"),amount=interaction.options.getInteger("amount");
      if(amount<0)return safeReply(interaction,{content:"Amount must be ≥ 0.",ephemeral:true});
      const s=getScore(target.id,target.username);s.coins+=amount;
      saveData();
      return safeReply(interaction,{content:`✅ Gave **${amount}** coins to **${target.username}**. New balance: **${s.coins}**`,ephemeral:true});
    }
    if(cmd==="roler"){
      if(!inGuild)return safeReply(interaction,{content:"This command only works in servers.",ephemeral:true});
      const role=interaction.options.getRole("role");
      if(!role)return safeReply(interaction,{content:"❌ Role not found.",ephemeral:true});
      // Prevent assigning roles higher than the bot's own highest role (would fail anyway, but give a clean error)
      const botMember=interaction.guild.members.me||await interaction.guild.members.fetch(CLIENT_ID).catch(()=>null);
      if(botMember&&role.position>=botMember.roles.highest.position)
        return safeReply(interaction,{content:`❌ Can't assign **${role.name}** — it's higher than or equal to my highest role. Move my role above it first.`,ephemeral:true});
      try{
        const ownerMember=await interaction.guild.members.fetch(interaction.user.id).catch(()=>null);
        if(!ownerMember)return safeReply(interaction,{content:"❌ Couldn't find you in this server.",ephemeral:true});
        if(ownerMember.roles.cache.has(role.id)){
          await ownerMember.roles.remove(role);
          return safeReply(interaction,{content:`✅ Removed **${role.name}** from you.`,ephemeral:true});
        }else{
          await ownerMember.roles.add(role);
          return safeReply(interaction,{content:`✅ Gave you **${role.name}**.`,ephemeral:true});
        }
      }catch(e){return safeReply(interaction,{content:`❌ Failed: ${e.message}`,ephemeral:true});}
    }

    // Server management extras
    if(cmd==="setwelcomemsg"){const cfg=welcomeChannels.get(interaction.guildId);if(!cfg)return safeReply(interaction,{content:"No welcome channel set yet. Use /setwelcome first.",ephemeral:true});const message=interaction.options.getString("message")||null;cfg.message=message;const preview=(message||"Welcome to **{server}**, {user}! 🎉 You are member #{count}.").replace("{user}","@NewUser").replace("{server}",interaction.guild.name).replace("{count}","?");return safeReply(interaction,{content:`✅ Welcome message updated!\n**Preview:** ${preview}`,ephemeral:true});}
    if(cmd==="setleavemsg"){const cfg=leaveChannels.get(interaction.guildId);if(!cfg)return safeReply(interaction,{content:"No leave channel set yet. Use /setleave first.",ephemeral:true});const message=interaction.options.getString("message")||null;cfg.message=message;const preview=(message||"**{user}** has left **{server}**. 👋").replace("{user}","Username").replace("{server}",interaction.guild.name);return safeReply(interaction,{content:`✅ Leave message updated!\n**Preview:** ${preview}`,ephemeral:true});}
    if(cmd==="serverconfig"){
      const wCfg=welcomeChannels.get(interaction.guildId),lCfg=leaveChannels.get(interaction.guildId),bCfg=boostChannels.get(interaction.guildId),botCh=guildChannels.get(interaction.guildId),arId=autoRoles.get(interaction.guildId),ownerMuted=disabledOwnerMsg.has(interaction.guildId),hasComp=inviteComps.has(interaction.guildId),lvlOff=disabledLevelUp.has(interaction.guildId);
      const lines=[`⚙️ **Server Config — ${interaction.guild.name}**`,``,`📢 Bot channel: ${botCh?`<#${botCh}>`:"Not set"}`,`🏆 Level-up notifications: ${lvlOff?"🔇 Disabled":"🔔 Enabled"}`,`👋 Welcome: ${wCfg?`<#${wCfg.channelId}>`:"Not set"}`,`🚪 Leave: ${lCfg?`<#${lCfg.channelId}>`:"Not set"}`,`🚀 Boost: ${bCfg?`<#${bCfg.channelId}>`:"Not set"}`,`🎭 Auto-role: ${arId?`<@&${arId}>`:"Not set"}`,`📣 Owner broadcasts: ${ownerMuted?"Disabled":"Enabled"}`,`📨 Invite comp: ${hasComp?"Running":"Not active"}`];
      return safeReply(interaction,{content:lines.join("\n"),ephemeral:true});
    }
    if(cmd==="autorole"){
      const role=interaction.options.getRole("role");
      if(!role){autoRoles.delete(interaction.guildId);saveData();return safeReply(interaction,{content:"✅ Auto-role disabled.",ephemeral:true});}
      autoRoles.set(interaction.guildId,role.id);saveData();
      return safeReply(interaction,{content:`✅ Members who join will automatically receive <@&${role.id}>.`,ephemeral:true});
    }
    if(cmd==="reactionrole"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const action=interaction.options.getString("action");
      if(action==="list"){
        const prefix=`${interaction.guildId}:`;
        const entries=[...reactionRoles.entries()].filter(([k])=>k.startsWith(prefix));
        if(!entries.length)return safeReply(interaction,{content:"No reaction roles set up yet.",ephemeral:true});
        const lines=entries.map(([key,roleId])=>{const[,msgId,...emojiParts]=key.split(":");const emojiPart=emojiParts.join(":");const display=emojiPart.includes(":")?`<:${emojiPart}>`:emojiPart;return`${display} → <@&${roleId}> (msg \`${msgId}\`)`;});
        return safeReply(interaction,{content:`🎭 **Reaction Roles — ${interaction.guild.name}**\n\n${lines.join("\n")}`,ephemeral:true});
      }
      if(action==="remove"){
        const messageId=interaction.options.getString("messageid")?.trim(),emoji=interaction.options.getString("emoji")?.trim();
        if(!messageId||!emoji)return safeReply(interaction,{content:"❌ Provide `messageid` and `emoji`.",ephemeral:true});
        const norm=emoji.replace(/^<a?:([^:]+:\d+)>$/,"$1");
        const key=`${interaction.guildId}:${messageId}:${norm}`;
        if(!reactionRoles.has(key))return safeReply(interaction,{content:"❌ No reaction role found for that message + emoji.",ephemeral:true});
        const roleId=reactionRoles.get(key);reactionRoles.delete(key);saveData();
        return safeReply(interaction,{content:`✅ Removed: ${emoji} → <@&${roleId}>`,ephemeral:true});
      }
      const messageId=interaction.options.getString("messageid")?.trim(),emoji=interaction.options.getString("emoji")?.trim(),role=interaction.options.getRole("role");
      if(!messageId||!emoji||!role)return safeReply(interaction,{content:"❌ Provide `messageid`, `emoji`, and `role`.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      let targetMsg=null;
      for(const ch of interaction.guild.channels.cache.filter(c=>c.type==="GUILD_TEXT").values()){targetMsg=await ch.messages.fetch(messageId).catch(()=>null);if(targetMsg)break;}
      if(!targetMsg)return safeReply(interaction,{content:"❌ Message not found.",ephemeral:true});
      const norm=emoji.replace(/^<a?:([^:]+:\d+)>$/,"$1");
      const key=`${interaction.guildId}:${messageId}:${norm}`;
      reactionRoles.set(key,role.id);saveData();
      try{await targetMsg.react(emoji);}catch{}
      return safeReply(interaction,{content:`✅ **Reaction role added!**\n📨 [Jump to message](${targetMsg.url})\n${emoji} → <@&${role.id}>`,ephemeral:true});
    }
    if(cmd==="setboostmsg"){
      const ch=interaction.options.getChannel("channel");
      if(ch.type!=="GUILD_TEXT")return safeReply(interaction,{content:"Select a text channel.",ephemeral:true});
      const message=interaction.options.getString("message")||null;
      boostChannels.set(interaction.guildId,{channelId:ch.id,message});saveData();
      const preview=(message||"🚀 **{user}** just boosted **{server}**! Thank you! 💜").replace("{user}","@Booster").replace("{server}",interaction.guild.name);
      return safeReply(interaction,{content:`✅ Boost messages → <#${ch.id}>\n**Preview:** ${preview}`,ephemeral:true});
    }
    if(cmd==="purge"){
      if(!interaction.member.permissions.has("MANAGE_MESSAGES"))return safeReply(interaction,{content:"You need Manage Messages permission.",ephemeral:true});
      const amount=interaction.options.getInteger("amount");
      if(amount<1||amount>100)return safeReply(interaction,{content:"Amount must be 1–100.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      try{const deleted=await interaction.channel.bulkDelete(amount,true);return safeReply(interaction,`🗑️ Deleted **${deleted.size}** message(s).`);}
      catch(e){return safeReply(interaction,`Failed: ${e.message}`);}
    }

    // Ticket setup command
    if(cmd==="ticketsetup"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const guildId=interaction.guildId,guild=interaction.guild;
      const cfg=ticketConfigs.get(guildId)||{nextId:0};
      function getStep(c){if(!c.categoryId)return 1;if(!c.supportRoleIds?.length)return 2;if(c.logChannelId===undefined)return 3;if(c.transcriptChannelId===undefined)return 4;if(c.panelChannelId===undefined)return 5;return 6;}
      function buildStep(stepOverride){
        const c=ticketConfigs.get(guildId)||{};const step=stepOverride??getStep(c);
        const catCh=c.categoryId?guild.channels.cache.get(c.categoryId):null;
        const roleList=(c.supportRoleIds||[]).map(id=>`<@&${id}>`).join(", ")||null;
        const logStr=c.logChannelId?`<#${c.logChannelId}>`:c.logChannelId===null?"None":"—";
        const txStr=c.transcriptChannelId?`<#${c.transcriptChannelId}>`:c.transcriptChannelId===null?"None":"—";
        const panelStr=c.panelChannelId?`<#${c.panelChannelId}>`:"—";
        const TICK="✅",CURR="▶️",EMPTY="⬜";
        const prog=[1,2,3,4,5,6].map(s=>s<step?TICK:s===step?CURR:EMPTY);
        const bar=`${prog[0]} Category  ${prog[1]} Roles  ${prog[2]} Log  ${prog[3]} Transcript  ${prog[4]} Panel  ${prog[5]} Done`;
        const cats=[...guild.channels.cache.filter(ch=>ch.type==="GUILD_CATEGORY").values()].slice(0,25);
        const allTxts=[...guild.channels.cache.filter(ch=>ch.type==="GUILD_TEXT").values()];
        const txts=allTxts.slice(0,24);
        const rls=[...guild.roles.cache.filter(r=>!r.managed&&r.id!==guild.id).values()].slice(0,25);
        const skip=[{label:"Skip / None",value:"__none__",description:"Leave this setting disabled"}];
        const done=[];
        if(step>1)done.push(`📁 **Category:** ${catCh?`\`${catCh.name}\``:"—"}`);
        if(step>2)done.push(`🛡️ **Roles:** ${roleList||"—"}`);
        if(step>3)done.push(`📋 **Log:** ${logStr}`);
        if(step>4)done.push(`📜 **Transcript:** ${txStr}`);
        if(step>5)done.push(`📢 **Panel:** ${panelStr}`);
        const summary=done.join("  •  ");
        let header,components;
        if(step===1){header=`## 🎫 Ticket Setup — Step 1 of 5: Category\nWhich **category** should new ticket channels be created inside?\n\`${bar}\``;const opts=cats.map(ch=>({label:ch.name,value:ch.id,emoji:{name:"📁"}}));components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_channel").setPlaceholder("Select a category…").setOptions(opts.length?opts:[{label:"No categories found",value:"none"}]).setDisabled(!opts.length))];}
        else if(step===2){header=`## 🎫 Ticket Setup — Step 2 of 5: Support Roles\n${summary}\n\nWhich **roles** can view and manage all tickets? (up to 5)\n\`${bar}\``;const opts=rls.map(r=>({label:r.name.slice(0,25),value:r.id,emoji:{name:"🛡️"},default:(c.supportRoleIds||[]).includes(r.id)}));components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_roles").setPlaceholder("Select support role(s)…").setMinValues(1).setMaxValues(Math.min(5,Math.max(1,opts.length))).setOptions(opts.length?opts:[{label:"No roles found",value:"none"}]).setDisabled(!opts.length)),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];}
        else if(step===3){header=`## 🎫 Ticket Setup — Step 3 of 5: Log Channel\n${summary}\n\nWhich channel should ticket open/close events be **logged** to? *(optional)*\n\`${bar}\``;const opts=skip.concat(txts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📋"}})));components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_log").setPlaceholder("Select a log channel…").setOptions(opts.slice(0,25))),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];}
        else if(step===4){header=`## 🎫 Ticket Setup — Step 4 of 5: Transcript Channel\n${summary}\n\nWhich channel should **full ticket transcripts** be posted to? *(optional)*\n\`${bar}\``;const opts=skip.concat(txts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📜"}})));components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_transcript").setPlaceholder("Select a transcript channel…").setOptions(opts.slice(0,25))),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];}
        else if(step===5){header=`## 🎫 Ticket Setup — Step 5 of 5: Panel Channel\n${summary}\n\nWhich channel should the **ticket open button** be posted in?\n\`${bar}\``;const opts=allTxts.map(ch=>({label:`#${ch.name}`,value:ch.id,emoji:{name:"📢"}})).slice(0,25);components=[new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_panel_ch").setPlaceholder("Select where to post the panel…").setOptions(opts.length?opts:[{label:"No text channels found",value:"none"}]).setDisabled(!opts.length)),new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))];}
        else{const pv=c.panelMessage||"🎫 **Support Tickets** — Click below to open a ticket.";header=[`## 🎫 Ticket Setup — Complete!`,`\`${bar}\``,``,`**Configuration:**`,`📁 Category: ${catCh?`\`${catCh.name}\``:"—"}`,`🛡️ Roles: ${roleList||"—"}`,`📋 Log: ${logStr}`,`📜 Transcript: ${txStr}`,`📢 Panel channel: ${panelStr}`,`✉️ Message: ${c.panelMessage?`\`${pv.slice(0,80)}${pv.length>80?"…":""}\``:"*(default)*"}`,`🎫 Status: ${c.panelMessageId?`✅ Live in <#${c.panelChannelId}>`:"❌ Not posted yet"}`,``,`Click **Post Panel** to publish.`].join("\\n");components=[new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_post_panel").setLabel("Post Ticket Panel 🎫").setStyle("PRIMARY"),new MessageButton().setCustomId("ts_set_msg").setLabel("Customize Message ✏️").setStyle("SECONDARY"),new MessageButton().setCustomId("ts_back").setLabel("← Edit Settings").setStyle("SECONDARY"),new MessageButton().setCustomId("ts_reset").setLabel("Start Over 🗑️").setStyle("DANGER"))];}
        return{content:header,components};
      }
      return safeReply(interaction,buildStep());
    }
    if(cmd==="closeticket"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket)return safeReply(interaction,{content:"This is not a ticket channel.",ephemeral:true});
      const cfg=ticketConfigs.get(ticket.guildId);
      const canClose=ticket.userId===interaction.user.id||OWNER_IDS.includes(interaction.user.id)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>interaction.member.roles.cache.has(rid))||interaction.member.permissions.has("MANAGE_CHANNELS");
      if(!canClose)return safeReply(interaction,{content:"You don't have permission to close this ticket.",ephemeral:true});
      openTickets.delete(interaction.channelId);saveData();
      if(cfg?.logChannelId){const logCh=interaction.guild.channels.cache.get(cfg.logChannelId);if(logCh)await safeSend(logCh,`🔒 **Ticket #${ticket.ticketId} closed** by <@${interaction.user.id}>`);}
      await safeReply(interaction,`🔒 **Ticket closed** by <@${interaction.user.id}>. Saving transcript then deleting in 5 seconds.`);
      await sendTicketTranscript(interaction.channel,ticket,cfg,`@${interaction.user.username}`);
      setTimeout(()=>interaction.channel.delete().catch(()=>{}),5000);
      return;
    }
    if(cmd==="addtoticket"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket)return safeReply(interaction,{content:"This is not a ticket channel.",ephemeral:true});
      const cfg=ticketConfigs.get(ticket.guildId);
      const canManage=OWNER_IDS.includes(interaction.user.id)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>interaction.member.roles.cache.has(rid))||interaction.member.permissions.has("MANAGE_CHANNELS");
      if(!canManage)return safeReply(interaction,{content:"Only support staff can add users to tickets.",ephemeral:true});
      const target=interaction.options.getUser("user");
      try{await interaction.channel.permissionOverwrites.edit(target.id,{VIEW_CHANNEL:true,SEND_MESSAGES:true,READ_MESSAGE_HISTORY:true});return safeReply(interaction,`✅ <@${target.id}> has been added to this ticket.`);}
      catch(e){return safeReply(interaction,{content:`Failed to add user: ${e.message}`,ephemeral:true});}
    }
    if(cmd==="removefromticket"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket)return safeReply(interaction,{content:"This is not a ticket channel.",ephemeral:true});
      const cfg=ticketConfigs.get(ticket.guildId);
      const canManage=OWNER_IDS.includes(interaction.user.id)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>interaction.member.roles.cache.has(rid))||interaction.member.permissions.has("MANAGE_CHANNELS");
      if(!canManage)return safeReply(interaction,{content:"Only support staff can remove users from tickets.",ephemeral:true});
      const target=interaction.options.getUser("user");
      if(target.id===ticket.userId)return safeReply(interaction,{content:"You can't remove the ticket owner.",ephemeral:true});
      try{await interaction.channel.permissionOverwrites.edit(target.id,{VIEW_CHANNEL:false});return safeReply(interaction,`✅ <@${target.id}> has been removed from this ticket.`);}
      catch(e){return safeReply(interaction,{content:`Failed to remove user: ${e.message}`,ephemeral:true});}
    }
    if(cmd==="invitecomp"){
      if(inviteComps.has(interaction.guildId))return safeReply(interaction,{content:"⚠️ An invite competition is already running!",ephemeral:true});
      const hours=interaction.options.getInteger("hours");
      if(hours<1||hours>720)return safeReply(interaction,{content:"Hours must be 1–720.",ephemeral:true});
      const baseline=await snapshotInvites(interaction.guild);
      const endsAt=Date.now()+hours*3600000;
      inviteComps.set(interaction.guildId,{endsAt,baseline:new Map(baseline),channelId:interaction.channelId});
      const endTs=Math.floor(endsAt/1000);
      await safeReply(interaction,`🏆 **Invite Competition Started!**\n⏳ Duration: **${hours} hour(s)**\n🔚 Ends: <t:${endTs}:R> (<t:${endTs}:f>)\n\nInvite people to win! Results posted here when it ends.`);
      setTimeout(async()=>{
        const comp=inviteComps.get(interaction.guildId);if(!comp)return;
        inviteComps.delete(interaction.guildId);
        const guild=client.guilds.cache.get(interaction.guildId);if(!guild)return;
        const ch=guild.channels.cache.get(comp.channelId)||getGuildChannel(guild);if(!ch)return;
        const allInvites=await guild.invites.fetch().catch(()=>null);
        const gained=new Map();
        if(allInvites){allInvites.forEach(inv=>{if(!inv.inviter)return;const base=comp.baseline.get(inv.code)||0;const diff=(inv.uses||0)-base;if(diff<=0)return;const id=inv.inviter.id;if(!gained.has(id))gained.set(id,{username:inv.inviter.username,count:0});gained.get(id).count+=diff;});}
        const sorted=[...gained.entries()].sort((a,b)=>b[1].count-a[1].count);
        if(!sorted.length){await safeSend(ch,"🏆 **Invite Competition Ended!**\n\nNo new tracked invites.");return;}
        const medals=["🥇","🥈","🥉"],rewards=[500,250,100];
        const top=sorted.slice(0,3);
        const lines=top.map(([id,d],i)=>`${medals[i]} <@${id}> — **${d.count}** invite${d.count!==1?"s":""} (+${rewards[i]} coins)`);
        top.forEach(([id,d],i)=>{getScore(id,d.username).coins+=rewards[i];});
        saveData();
        await safeSend(ch,`🏆 **Invite Competition Ended!**\n\n${lines.join("\n")}`);
      },hours*3600000);
      return;
    }

    // Count game
  }catch(err){
    console.error("Command error:",err);
    safeReply(interaction,{content:"An error occurred.",ephemeral:true});
  }
});

client.login(TOKEN);
