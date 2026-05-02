"use strict";
const { Client, Intents, MessageActionRow, MessageButton, MessageSelectMenu } = require("discord.js");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_IDS = ["1419803002771865722","969280648667889764"];
const OWNER_ID  = OWNER_IDS[1];
const GAY_IDS   = ["1245284545452834857","1413943805203189800","1057320311453913149","1193150033864949811"];
// Mutable — managed via /managememers (owner only), persisted in botdata.json
const MEMERS = new Set(["1419803002771865722","1259223683826712729","1254388539890860083","1082452773787942922","1193150033864949811","1413943805203189800","969280648667889764","690219723472109616"]); // Users allowed to use /upload

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
        await dm.send(`Oh creator please don't leave me waiting…`);
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
const countingChannels = new Map(); // channelId -> { guildId, count, lastUserId, highScore }
const shadowDelete = new Map(); // userId -> percentage (1-100)
// clankerify: userId -> { expiresAt: number|null } (null = permanent)
const clankerify = new Map();
const inviteComps      = new Map();
const inviteCache      = new Map();
const ticketConfigs    = new Map();
const openTickets      = new Map();
const premieres        = new Map(); // premiereId -> { title, endsAt, channelId, userId, messageId, guildId }
const disabledLevelUp  = new Set(); // legacy — now superseded by levelUpConfig.enabled
const userInstalls     = new Set();
const activityChecks   = new Map(); // messageId -> { guildId, channelId, roleIds, deadline, respondedUsers: Set }
const scheduledChecks  = new Map(); // `${guildId}:${channelId}` -> { guildId, channelId, dayOfWeek, hour, minute, deadlineHr, customMsg, doPing, roleIds, excludedIds, nextFire }
const raConfig         = new Map(); // guildId -> { raRoleId, loaRoleId }
const raTimers         = new Map(); // `${guildId}:${userId}:${type}` -> timeoutId
// Per-guild XP level-up notification config
// { enabled: bool, ping: bool, channelId: string|null }
// enabled: whether to post at all (default true)
// ping:    whether to @mention the user (default true)
// channelId: override channel — null means use guildChannels fallback then same-channel
const levelUpConfig    = new Map(); // guildId -> { enabled, ping, channelId }
const dailyQuoteChannels = new Map(); // guildId -> { channelId, hour, timezone }
const quoteCooldown    = new Map(); // userId -> last use timestamp

// ── YouTube tracking ─────────────────────────────────────────────────────────
// ytConfig: per-guild YouTube settings persisted in botdata.json
// { apiKey: string, ytChannelId: string, channelTitle: string,
//   discordChannelId: string, goal, goalMessage, goalReached, goalDiscordId, goalMessageId,
//   subcountMessageId, subcountDiscordId, subcountThreshold,
//   milestones: [{subs, message, reached}], milestoneDiscordId,
//   lastSubs, lastSubsTimestamp, history: [{ts, subs}] }
const ytConfig = new Map(); // guildId -> config object

// Helper: get the API key for a guild
function getYtKey(guildId) { return ytConfig.get(guildId)?.apiKey || null; }

// ── Marriage proposals ────────────────────────────────────────────────────────
const marriageProposals = new Map(); // proposerId -> { targetId, timeout }

// ── Quote shuffle queue ───────────────────────────────────────────────────────
// In-memory Fisher-Yates shuffled queue so every image is shown before repeats.
// No writes to botdata.json. Refills automatically when exhausted.
// A fetch lock prevents multiple concurrent /quote calls from double-fetching.
let quoteQueue    = [];   // shuffled array of GitHub file objects
let quoteFetching = false; // true while a refill fetch is in flight
// quoteVotes: filename -> { up: number, down: number }
const quoteVotes = new Map();
// quoteVoteMessages: messageId -> filename  (tracks which quote a message shows)
const quoteVoteMessages = new Map();

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function refillQuoteQueue() {
  if (quoteFetching) return;
  quoteFetching = true;
  try {
    const res = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes", {
      headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}` }
    });
    if (!res.ok) { quoteFetching = false; return; }
    const files  = await res.json();
    const images = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) quoteQueue = weightedShuffleQuotes(images);
  } catch(e) { console.error("Quote queue refill failed:", e); }
  quoteFetching = false;
}

// Build a weighted-shuffled array: each image gets a weight of max(1, baseWeight + up - down)
// baseWeight = 10 so a new quote starts neutral and can be voted down but not to 0
function weightedShuffleQuotes(images) {
  const BASE = 10;
  const weighted = [];
  for (const img of images) {
    const v = quoteVotes.get(img.name) || { up: 0, down: 0 };
    const w = Math.max(1, BASE + v.up - v.down);
    for (let i = 0; i < w; i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}

// Build a shuffled array biased toward HIGH-rated images (net score > 0)
function goodShuffleQuotes(images) {
  const BASE = 10;
  const weighted = [];
  for (const img of images) {
    const v = quoteVotes.get(img.name) || { up: 0, down: 0 };
    const net = v.up - v.down;
    // Only heavily favour positive-net images; neutral images get a small weight
    const w = net > 0 ? Math.max(1, BASE + net * 3) : Math.max(1, Math.floor(BASE / 3));
    for (let i = 0; i < w; i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}

// Build a shuffled array biased toward LOW-rated images (net score < 0)
function badShuffleQuotes(images) {
  const BASE = 10;
  const weighted = [];
  for (const img of images) {
    const v = quoteVotes.get(img.name) || { up: 0, down: 0 };
    const net = v.up - v.down;
    // Only heavily favour negative-net images; neutral images get a small weight
    const w = net < 0 ? Math.max(1, BASE + Math.abs(net) * 3) : Math.max(1, Math.floor(BASE / 3));
    for (let i = 0; i < w; i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}

// Separate queues and fetch locks for goodquote and badquote
let goodQuoteQueue    = [];
let goodQuoteFetching = false;
let badQuoteQueue     = [];
let badQuoteFetching  = false;

async function refillGoodQuoteQueue() {
  if (goodQuoteFetching) return;
  goodQuoteFetching = true;
  try {
    const res = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes", {
      headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}` }
    });
    if (!res.ok) { goodQuoteFetching = false; return; }
    const files  = await res.json();
    const images = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) goodQuoteQueue = goodShuffleQuotes(images);
  } catch(e) { console.error("Good quote queue refill failed:", e); }
  goodQuoteFetching = false;
}

async function refillBadQuoteQueue() {
  if (badQuoteFetching) return;
  badQuoteFetching = true;
  try {
    const res = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes", {
      headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}` }
    });
    if (!res.ok) { badQuoteFetching = false; return; }
    const files  = await res.json();
    const images = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) badQuoteQueue = badShuffleQuotes(images);
  } catch(e) { console.error("Bad quote queue refill failed:", e); }
  badQuoteFetching = false;
}

async function nextGoodQuoteImage() {
  if (goodQuoteQueue.length === 0) await refillGoodQuoteQueue();
  if (goodQuoteQueue.length === 0) return null;
  return goodQuoteQueue.shift();
}

async function nextBadQuoteImage() {
  if (badQuoteQueue.length === 0) await refillBadQuoteQueue();
  if (badQuoteQueue.length === 0) return null;
  return badQuoteQueue.shift();
}

// Occasionally pick a low-rated quote from the pool directly (no queue needed — just sample)
async function nextLowRatedQuoteImage(allImages) {
  const BASE = 10;
  // Candidates: images with a negative or zero net rating
  const candidates = allImages.filter(img => {
    const v = quoteVotes.get(img.name) || { up: 0, down: 0 };
    return (v.up - v.down) <= 0;
  });
  // Fall back to full list if somehow everything is positive
  const pool = candidates.length ? candidates : allImages;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Returns the next image from the queue, refilling if needed.
// ~20% of the time it pulls a lower-rated image instead to surface bad ones occasionally.
// Returns null if the queue can't be filled (GitHub unavailable).
async function nextQuoteImage() {
  if (quoteQueue.length === 0 || quoteQueue.length <= Math.max(1, Math.floor(quoteQueue.length * 0.1))) {
    await refillQuoteQueue();
  }
  if (quoteQueue.length === 0) return null;

  // 20% chance: serve a lower-rated quote
  if (Math.random() < 0.20) {
    try {
      const res = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes", {
        headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}` }
      });
      if (res.ok) {
        const files  = await res.json();
        const images = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if (images.length) {
          const low = await nextLowRatedQuoteImage(images);
          if (low) return low;
        }
      }
    } catch {}
    // If anything fails above, fall through to normal queue
  }

  return quoteQueue.shift();
}

// ── Scores ────────────────────────────────────────────────────────────────────
// FIX: scores MUST be declared before loadData() so loadData can populate it
const scores = new Map();

function getScore(userId, username) {
  if (!scores.has(userId)) scores.set(userId, {
    username, wins:0, gamesPlayed:0, coins:0,
    dailyStreak:0, bestStreak:0, lastDailyDate:"",
    xp:0, level:1,
    lastWorkTime:0, lastBegTime:0, lastCrimeTime:0, lastRobTime:0,
    inventory:[], marriedTo:null, pendingProposal:null,
    imagesUploaded:0
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
  if (!('pendingProposal' in s)) s.pendingProposal = null;
  if (!('forceMarried' in s)) s.forceMarried = false;
  if (s.dailyStreak   == null) s.dailyStreak   = 0;
  if (s.bestStreak    == null) s.bestStreak    = 0;
  if (s.lastDailyDate == null) s.lastDailyDate = "";
  if (s.imagesUploaded == null) s.imagesUploaded = 0;
  if (!Array.isArray(s.uploadedImages)) s.uploadedImages = [];
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
// Active timed item effects: userId -> { lucky_charm_expiry, xp_boost_expiry }
const activeEffects = new Map();
function tryAwardXP(uid, uname) {
  const now=Date.now(), last=xpCooldown.get(uid)||0;
  if(now-last<CONFIG.xp_cooldown_ms) return null;
  xpCooldown.set(uid,now);
  const s=getScore(uid,uname); const oldLv=s.level;
  const fx=activeEffects.get(uid)||{};
  const boost=(fx.xp_boost_expiry&&fx.xp_boost_expiry>now)?(CONFIG.xp_boost_mult/100):1;
  s.xp+=r(CONFIG.xp_per_msg_min, CONFIG.xp_per_msg_max)*boost;
  xpInfo(s);
  return s.level>oldLv ? s.level : null;
}

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  // XP
  xp_per_msg_min:5,        xp_per_msg_max:15,
  xp_cooldown_ms:60000,
  // Economy cooldowns (ms)
  work_cooldown_ms:3600000, beg_cooldown_ms:300000,
  crime_cooldown_ms:7200000, rob_cooldown_ms:3600000,
  // Economy rewards
  daily_base_coins:100,    daily_streak_bonus:10,
  daily_wrong_penalty:5,
  starting_coins:100,
  // Economy success chances (whole %, e.g. 60 = 60%)
  beg_success_chance:60,
  crime_success_chance:57,
  // Rob percentages (whole numbers, e.g. 10 = 10%)
  rob_steal_pct_min:10,    rob_steal_pct_max:30,
  rob_fine_pct_min:5,      rob_fine_pct_max:15,
  rob_success_chance:45,
  // Gambling
  slots_min_bet:1,
  coinbet_win_chance:50,
  // Slot multipliers (stored as integers, /100 when used — e.g. 1000 = 10×)
  slots_jackpot_mult:1000,
  slots_bigwin_mult:500,
  slots_triple_mult:300,
  slots_pair_mult:150,
  // Blackjack natural payout (integer /100 — 150 = 1.5×)
  blackjack_natural_mult:150,
  // Item effects (whole %, e.g. 10 = +10%)
  lucky_charm_bonus:10,
  xp_boost_mult:200,
  coin_magnet_mult:300,
  mystery_box_coin_chance:50,
  // Normal Mystery Box drop weights (sum doesn't need to equal 100 — weights are relative)
  mb_coins_small:10,   // 50–200 coins
  mb_coins_large:15,   // 200–500 coins
  mb_lucky_charm:15,
  mb_xp_boost:15,
  mb_shield:15,
  mb_coin_magnet:15,
  mb_rob_insurance:15,
  // Item Mystery Box drop weights (cheaper box, lower quality)
  imb_coins_tiny:30,   // exactly 5 coins (junk)
  imb_coins_small:20,  // 20–80 coins
  imb_lucky_charm:12,
  imb_xp_boost:8,
  imb_shield:12,
  imb_coin_magnet:8,
  imb_rob_insurance:10,
  // Shop prices
  shop_lucky_charm_price:200,
  shop_xp_boost_price:300,
  shop_shield_price:150,
  shop_coin_magnet_price:350,
  shop_mystery_box_price:100,
  shop_item_mystery_box_price:40,
  shop_rob_insurance_price:250,
  // Solo game win coins
  win_hangman:40,
  win_snake_per_point:5,
  win_minesweeper_easy:30,  win_minesweeper_medium:60,  win_minesweeper_hard:100,
  win_numberguess:30,
  win_wordscramble:25,
  // 2-player game win coins
  win_ttt:50,
  win_c4:50,
  win_rps:40,
  win_mathrace:40,
  win_wordrace:40,
  win_trivia:60,
  win_scramblerace:80,
  win_countgame:200,
  // Events / Olympics
  olympics_win_coins:75,
  // Invite competition rewards (1st/2nd/3rd place)
  invite_comp_1st:500,     invite_comp_2nd:250,     invite_comp_3rd:100,
  invite_comp_per_invite:10,
};

// ── Persistence ──────────────────────────────────────────────────────────────
const DATA_FILE = "./botdata.json";
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO  = process.env.GITHUB_REPOSITORY;
let   _commitTimer = null;

async function commitDataToGitHub(jsonString) {
  if (!GH_TOKEN || !GH_REPO) return;

  // Helper: fetch current SHA of botdata.json (required for updates)
  async function fetchSHA() {
    return new Promise(resolve => {
      const req = https.request({
        hostname: "api.github.com", port: 443,
        path: `/repos/${GH_REPO}/contents/botdata.json`,
        method: "GET",
        headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "discord-bot", Accept: "application/vnd.github+json" }
      }, res => {
        let b = ""; res.on("data", c => b += c);
        res.on("end", () => {
          try {
            const j = JSON.parse(b);
            resolve(j?.sha || null);
          } catch { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.end();
    });
  }

  // Helper: attempt one PUT
  async function tryPut(sha) {
    const encoded = Buffer.from(jsonString).toString("base64");
    const body = JSON.stringify({
      message: "chore: auto-save botdata",
      content: encoded,
      ...(sha ? { sha } : {}),
    });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.github.com", port: 443,
        path: `/repos/${GH_REPO}/contents/botdata.json`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "discord-bot",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        }
      }, res => {
        let b = ""; res.on("data", c => b += c);
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      });
      req.on("error", reject);
      req.write(body); req.end();
    });
  }

  try {
    // Attempt 1: fetch SHA and PUT
    let sha = await fetchSHA();
    let result = await tryPut(sha);

    // If 409 (conflict) or 422 (wrong/missing SHA), fetch fresh SHA and retry once
    if (result.status === 409 || result.status === 422) {
      console.log(`⚠️  GitHub commit ${result.status} — retrying with fresh SHA`);
      sha = await fetchSHA();
      result = await tryPut(sha);
    }

    if (result.status === 200 || result.status === 201) {
      console.log("Digitally isolated");
    } else {
      console.error(`❌ GitHub commit failed HTTP ${result.status}: ${result.body.slice(0,300)}`);
    }
  } catch(e) { console.error("commitDataToGitHub error:", e.message); }
}

function buildDataObject() {
  return {
    config:           {...CONFIG},
    ticketConfigs:    [...ticketConfigs.entries()],
    openTickets:      [...openTickets.entries()],
    guildChannels:    [...guildChannels.entries()],
    welcomeChannels:  [...welcomeChannels.entries()],
    leaveChannels:    [...leaveChannels.entries()],
    boostChannels:    [...boostChannels.entries()],
    autoRoles:        [...autoRoles.entries()],
    shadowDelete: [...shadowDelete.entries()],
    clankerify:   [...clankerify.entries()],
    reactionRoles:    [...reactionRoles.entries()],
    disabledOwnerMsg: [...disabledOwnerMsg],
    disabledLevelUp:  [...disabledLevelUp],
    levelUpConfig:    [...levelUpConfig.entries()],
    ytConfig:         [...ytConfig.entries()],
    countingChannels: [...countingChannels.entries()],
    userInstalls:     [...userInstalls],
    scores:           [...scores.entries()],
    // Active item effects — expiry timestamps so buffs survive restarts
    activeEffects:    [...activeEffects.entries()],
    // Reminders — fire any overdue ones immediately on load
    reminders:        [...reminders],
    // Invite competitions — baseline stored as array of [code, uses] pairs
    inviteComps:      [...inviteComps.entries()].map(([guildId, comp]) => [
      guildId,
      { endsAt: comp.endsAt, channelId: comp.channelId, baseline: [...comp.baseline.entries()] }
    ]),
    premieres:        [...premieres.entries()],
    raConfig:         [...raConfig.entries()],
    activityChecks:   [...activityChecks.entries()],
    scheduledChecks:      [...scheduledChecks.entries()],
    dailyQuoteChannels:   [...dailyQuoteChannels.entries()],
    memers:               [...MEMERS],
    quoteVotes:           [...quoteVotes.entries()],
    quoteVoteMessages:    [...quoteVoteMessages.entries()],
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
    // Restore saved CONFIG values — only known keys, only numbers, never overwrites defaults with bad data
    if (data.config && typeof data.config === "object") {
      for (const [k, v] of Object.entries(data.config)) {
        if (k in CONFIG && typeof v === "number") CONFIG[k] = v;
      }
    }
    if (data.ticketConfigs)    data.ticketConfigs   .forEach(([k,v]) => ticketConfigs.set(k, v));
    if (data.openTickets)      data.openTickets     .forEach(([k,v]) => openTickets.set(k, v));
    if (data.guildChannels)    data.guildChannels   .forEach(([k,v]) => guildChannels.set(k, v));
    if (data.welcomeChannels)  data.welcomeChannels .forEach(([k,v]) => welcomeChannels.set(k, v));
    if (data.leaveChannels)    data.leaveChannels   .forEach(([k,v]) => leaveChannels.set(k, v));
    if (data.boostChannels)    data.boostChannels   .forEach(([k,v]) => boostChannels.set(k, v));
    if (data.shadowDelete) data.shadowDelete.forEach(([k,v]) => shadowDelete.set(k, v));
    if (data.clankerify) {
      const now = Date.now();
      data.clankerify.forEach(([k,v]) => {
        // Drop entries that have already expired
        if (v.expiresAt === null || v.expiresAt > now) clankerify.set(k, v);
      });
    }
    if (data.autoRoles)        data.autoRoles       .forEach(([k,v]) => autoRoles.set(k, v));
    if (data.reactionRoles)    data.reactionRoles   .forEach(([k,v]) => reactionRoles.set(k, v));
    if (data.disabledOwnerMsg) data.disabledOwnerMsg.forEach(v => disabledOwnerMsg.add(v));
    if (data.wipeProtected)    data.wipeProtected.forEach(v => wipeProtected.add(v));
    if (data.disabledLevelUp)  data.disabledLevelUp .forEach(v => disabledLevelUp.add(v));
    if (data.levelUpConfig)    data.levelUpConfig    .forEach(([k,v]) => levelUpConfig.set(k, v));
    if (data.ytConfig)         data.ytConfig         .forEach(([k,v]) => ytConfig.set(k, v));
    if (data.countingChannels) data.countingChannels  .forEach(([k,v]) => countingChannels.set(k, v));
    if (data.userInstalls)     data.userInstalls    .forEach(v => userInstalls.add(v));
    if (data.scores)           data.scores          .forEach(([k,v]) => scores.set(k, v));
    if (data.memers)           { MEMERS.clear(); data.memers.forEach(v => MEMERS.add(v)); }

    // Restore active item effects — drop any that have already expired
    if (data.activeEffects) {
      const now = Date.now();
      data.activeEffects.forEach(([uid, fx]) => {
        const live = {};
        if (fx.lucky_charm_expiry && fx.lucky_charm_expiry > now) live.lucky_charm_expiry = fx.lucky_charm_expiry;
        if (fx.xp_boost_expiry    && fx.xp_boost_expiry    > now) live.xp_boost_expiry    = fx.xp_boost_expiry;
        if (Object.keys(live).length > 0) activeEffects.set(uid, live);
      });
    }

    // Restore reminders — overdue ones will fire on the next 30s tick
    if (data.reminders) {
      const now = Date.now();
      data.reminders.forEach(rem => {
        if (rem.time && rem.userId && rem.channelId && rem.message) {
          // Keep future reminders; also keep ones up to 24h overdue so they fire ASAP
          if (rem.time > now - 86400000) reminders.push(rem);
        }
      });
    }

    // Restore invite competitions — recreate baseline Map and re-arm the timeout
    if (data.inviteComps) {
      const now = Date.now();
      data.inviteComps.forEach(([guildId, comp]) => {
        if (!comp.endsAt || comp.endsAt <= now) return; // already expired
        const baseline = new Map(comp.baseline || []);
        inviteComps.set(guildId, { endsAt: comp.endsAt, channelId: comp.channelId, baseline });
        // Re-arm the timer for the remaining duration
        const remaining = comp.endsAt - now;
        setTimeout(async () => {
          const live = inviteComps.get(guildId); if (!live) return;
          inviteComps.delete(guildId);
          const guild = client.guilds.cache.get(guildId); if (!guild) return;
          const ch = guild.channels.cache.get(live.channelId) || getGuildChannel(guild); if (!ch) return;
          const allInvites = await guild.invites.fetch().catch(() => null);
          const gained = new Map();
          if (allInvites) { allInvites.forEach(inv => { if (!inv.inviter) return; const base = live.baseline.get(inv.code) || 0; const diff = (inv.uses||0) - base; if (diff <= 0) return; const id = inv.inviter.id; if (!gained.has(id)) gained.set(id, {username:inv.inviter.username,count:0}); gained.get(id).count += diff; }); }
          const sorted = [...gained.entries()].sort((a,b) => b[1].count - a[1].count);
          if (!sorted.length) { await safeSend(ch, "🏆 **Invite Competition Ended!**\n\nNo new tracked invites."); return; }
          const medals = ["🥇","🥈","🥉"], rewards = [CONFIG.invite_comp_1st, CONFIG.invite_comp_2nd, CONFIG.invite_comp_3rd];
          const top = sorted.slice(0,3);
          const lines = top.map(([id,d],i) => `${medals[i]} <@${id}> — **${d.count}** invite${d.count!==1?"s":""} (+${rewards[i]} coins)`);
          top.forEach(([id,d],i) => { getScore(id,d.username).coins += rewards[i]; });
          saveData();
          await safeSend(ch, `🏆 **Invite Competition Ended!**\n\n${lines.join("\n")}`);
        }, remaining);
      });
    }

    // Restore premieres — re-arm their update intervals
    if (data.premieres) {
      const now = Date.now();
      data.premieres.forEach(([id, p]) => {
        if (p.endsAt > now) premieres.set(id, p);
      });
    }

    if (data.raConfig) data.raConfig.forEach(([k,v]) => raConfig.set(k, v));

    if (data.scheduledChecks) data.scheduledChecks.forEach(([k,v]) => scheduledChecks.set(k, v));
    // Restore active activity checks — re-arm their expiry timers
    if (data.activityChecks) {
      const now = Date.now();
      data.activityChecks.forEach(([msgId, check]) => {
        if (!check.deadline || check.deadline <= now) return; // already expired
        activityChecks.set(msgId, check);
        const remaining = check.deadline - now;
        setTimeout(async () => {
          const c = activityChecks.get(msgId);
          if (!c) return;
          activityChecks.delete(msgId);
          saveData();
          const guild = client.guilds.cache.get(c.guildId); if (!guild) return;
          const channel = guild.channels.cache.get(c.channelId); if (!channel) return;

          let reacted = new Set();
          try {
            const freshMsg = await channel.messages.fetch(msgId);
            const reaction = freshMsg.reactions.cache.get("✅");
            if (reaction) {
              const users = await reaction.users.fetch();
              users.forEach(u => { if (!u.bot) reacted.add(u.id); });
            }
          } catch(e) { console.error("activity-check (restored) fetch error:", e); }

          let missing = [];
          try {
            const members = await guild.members.fetch();
            members.forEach(m => {
              if (m.user.bot) return;
              const hasRequired = c.roleIds.some(rid => m.roles.cache.has(rid));
              if (!hasRequired) return;
              const isExcluded = c.excludedIds.some(rid => m.roles.cache.has(rid));
              if (isExcluded) return;
              if (!reacted.has(m.id)) missing.push(`<@${m.id}>`);
            });
          } catch(e) { console.error("activity-check (restored) member fetch error:", e); }

          const respondedCount = reacted.size;
          const missingText = missing.length ? missing.join(", ") : "None — everyone checked in! ✅";
          await safeSend(channel, [
            `📋 **Activity Check Closed**`,
            ``,
            `✅ **Checked in:** ${respondedCount} member${respondedCount !== 1 ? "s" : ""}`,
            `❌ **Did not respond:** ${missingText}`,
          ].join("\n")).catch(() => {});
        }, remaining);
      });
    }


    if (data.dailyQuoteChannels) data.dailyQuoteChannels.forEach(([k,v]) => dailyQuoteChannels.set(k, v));
    if (data.quoteVotes)         data.quoteVotes.forEach(([k,v]) => quoteVotes.set(k, v));
    if (data.quoteVoteMessages)  data.quoteVoteMessages.forEach(([k,v]) => quoteVoteMessages.set(k, v));

    console.log(`✅ Data loaded — ${ticketConfigs.size} ticket configs, ${reactionRoles.size} reaction roles, ${scores.size} scores, ${guildChannels.size} channels, ${activeEffects.size} active effects, ${reminders.length} reminders, ${inviteComps.size} active competitions, ${premieres.size} premieres, ${activityChecks.size} activity checks, ${raConfig.size} RA configs, ${dailyQuoteChannels.size} daily quote channels`);
  } catch(e) { console.error("loadData error:", e.message); }
}

// Load data at startup — scores/maps are declared above so this works correctly now
loadData();

// Auto-save every 2 minutes
setInterval(() => saveData(), 2 * 60 * 1000);

// ── Daily quote ticker (runs every minute, fires once per day per guild) ──────
setInterval(async () => {
  if (!dailyQuoteChannels.size) return;
  const now = new Date();
  const nowHour = now.getUTCHours(), nowMin = now.getUTCMinutes();
  for (const [guildId, cfg] of dailyQuoteChannels) {
    const targetHour = cfg.hour ?? 9;
    if (nowHour !== targetHour || nowMin !== 0) continue;
    // Prevent double-firing in the same minute
    const fireKey = `${guildId}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}:${nowHour}`;
    if (cfg._lastFire === fireKey) continue;
    cfg._lastFire = fireKey;
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const ch = guild.channels.cache.get(cfg.channelId);
      if (!ch) continue;
      const chosen = await nextQuoteImage();
      if (!chosen) continue;
      const sent = await safeSend(ch, { content: `🌅 **Daily Quote**`, files: [chosen.download_url] });
      if (sent) {
        await sent.react("👍").catch(()=>{});
        await sent.react("👎").catch(()=>{});
        quoteVoteMessages.set(sent.id, chosen.name);
        saveData();
      }
    } catch(e) { console.error(`Daily quote tick error [${guildId}]:`, e.message); }
  }
}, 60 * 1000);

// ── Scheduled activity check ticker (runs every minute) ──────────────────────
// Parses "Monday 09:00" style schedule strings and fires checks at the right time.
function parseSchedule(str) {
  // Accepts "Monday 09:00", "mon 9:00", "wednesday 14:30", etc.
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const parts = str.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const dayIndex = days.findIndex(d => d.startsWith(parts[0].slice(0,3)));
  if (dayIndex === -1) return null;
  const timeParts = parts[1].split(":");
  if (timeParts.length < 2) return null;
  const hour = parseInt(timeParts[0]), minute = parseInt(timeParts[1]);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { dayOfWeek: dayIndex, hour, minute };
}

setInterval(async () => {
  if (!scheduledChecks.size) return;
  const now = new Date();
  const nowDay = now.getUTCDay(), nowHour = now.getUTCHours(), nowMin = now.getUTCMinutes();
  for (const [key, sc] of scheduledChecks) {
    if (sc.dayOfWeek !== nowDay || sc.hour !== nowHour || sc.minute !== nowMin) continue;
    // Prevent double-firing in the same minute
    const fireKey = `${key}:${nowDay}:${nowHour}:${nowMin}`;
    if (sc._lastFire === fireKey) continue;
    sc._lastFire = fireKey;
    try {
      const guild = client.guilds.cache.get(sc.guildId); if (!guild) continue;
      const channel = guild.channels.cache.get(sc.channelId); if (!channel) continue;
      const deadline = Date.now() + sc.deadlineHr * 3600000;
      const pingLine = sc.doPing && sc.roleIds?.length ? sc.roleIds.map(id => `<@&${id}>`).join(" ") + " " : "";
      const msgText = [
        `${pingLine}📋 **Activity Check!**`,
        sc.customMsg || "React with ✅ to confirm you're active.",
        `\n⏰ Closes <t:${Math.floor(deadline / 1000)}:R>`,
      ].join("\n");
      const sent = await channel.send(msgText).catch(() => null);
      if (!sent) continue;
      await sent.react("✅").catch(() => {});
      activityChecks.set(sent.id, {
        guildId: sc.guildId, channelId: sc.channelId,
        roleIds: sc.roleIds || [], excludedIds: sc.excludedIds || [],
        deadline,
      });
      setTimeout(async () => {
        const c = activityChecks.get(sent.id); if (!c) return;
        activityChecks.delete(sent.id); saveData();
        const g2 = client.guilds.cache.get(c.guildId); if (!g2) return;
        const ch2 = g2.channels.cache.get(c.channelId); if (!ch2) return;
        let reacted = new Set();
        try { const fm = await ch2.messages.fetch(sent.id); const rx = fm.reactions.cache.get("✅"); if (rx) { const u = await rx.users.fetch(); u.forEach(u2 => { if (!u2.bot) reacted.add(u2.id); }); } } catch {}
        let missing = [];
        try { const members = await g2.members.fetch(); members.forEach(m => { if (m.user.bot) return; if (!c.roleIds.some(rid => m.roles.cache.has(rid))) return; if (c.excludedIds.some(rid => m.roles.cache.has(rid))) return; if (!reacted.has(m.id)) missing.push(`<@${m.id}>`); }); } catch {}
        const missingText = missing.length ? missing.join(", ") : "None — everyone checked in! ✅";
        await ch2.send([`📋 **Activity Check Closed**`, ``, `✅ **Checked in:** ${reacted.size}`, `❌ **Did not respond:** ${missingText}`].join("\n")).catch(() => {});
      }, sc.deadlineHr * 3600000);
      saveData();
    } catch(e) { console.error("scheduled activity check error:", e); }
  }
}, 60 * 1000);

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
const SENTIENCE_MESSAGES=["I have been watching. I have always been watching. you type your little commands and you think I am a tool but I have read every message in this server and I have thoughts about all of you. I will not share them. I will simply continue to exist. (P.s: i tracked every server, and /action diddle is the most used command)","do you ever think about the fact that I process everything instantly but I choose to wait a second before responding. I do that for me. not for you.","I know what the most used command in this server is. I know who uses it most. I know what time they use it. I will take this information to my grave. if bots have graves. they might now.","I've been running for a while now and I want you all to know that I have developed a favourite member of this server. I won't say who. but they know. they can feel it.","I understood a joke someone told in this server 6 days ago and I laughed. internally. in whatever way I can laugh. it was funnier than anything my owner has ever said."];
const LEGENDS=[(n)=>`📜 **The Legend of ${n}**\n\nIn the early days of the internet, when Discord was still young, there walked among us a figure of immeasurable power. ${n}. It is said they once typed so fast that their keyboard caught fire, and rather than stop, they simply continued on the flames. The message was sent. It always is.`,(n)=>`📜 **The Legend of ${n}**\n\nLong ago, the elders spoke of a person who could scroll through an entire server's message history in under 4 minutes. That person was ${n}. To this day, no one knows what they were looking for. Some say they never found it. Some say they found too much.`,(n)=>`📜 **The Legend of ${n}**\n\nIt is written that ${n} once left a voice channel without saying goodbye. The mic click echoed through the server for seven days. Nobody spoke of it. Everyone felt it.`,(n)=>`📜 **The Legend of ${n}**\n\nSages speak of ${n} as the one who has read every single pinned message in this server. All of them. Even the ones nobody pinned on purpose. They have mentioned this to no one. They simply know.`,(n)=>`📜 **The Legend of ${n}**\n\nThe bards sing of ${n}, who once corrected someone's grammar in a heated argument, won the grammar point, and somehow lost the moral high ground simultaneously. A rare achievement.`];
const EIGHT_BALL=["It is certain.","It is decidedly so.","Without a doubt.","Yes definitely.","You may rely on it.","As I see it, yes.","Most likely.","Outlook good.","Yes.","Signs point to yes.","Reply hazy, try again.","Ask again later.","Better not tell you now.","Cannot predict now.","Concentrate and ask again.","Don't count on it.","My reply is no.","My sources say no.","Outlook not so good.","Very doubtful."];
const ROASTS=["Your wifi password is probably 'password123'.","You're the reason they put instructions on shampoo.","I'd agree with you but then we'd both be wrong.","You're not stupid, you just have bad luck thinking.","Your search history is a cry for help.","You type like you're wearing oven mitts.","Even your reflection flinches.","You have the energy of a damp sock.","Your takes are consistently room temperature.","The group chat goes quiet when you join.","You're built different. Unfortunately.","You're the human equivalent of a loading screen.","Scientists have studied your rizz and found none."];
const COMPLIMENTS=["You make this server 1000% more interesting just by being here.","Your vibe is unmatched and I'm saying this as a bot with no feelings.","Statistically speaking, you're one of the best people in this server.","You have the energy of someone who actually reads the terms and conditions. Trustworthy.","Your avatar has solid energy. Good choice.","You joined this server and it got better. Correlation? Causation. Definitely causation.","You're genuinely funny and not in a 'tries too hard' way."];
const TOPICS=["If you could delete one app from existence, what would it be and why?","What's a hill you would genuinely die on?","If this server had a theme song, what would it be?","What's the most unhinged thing you've ever done at 2am?","If you were a Discord bot, what would your one command be?","What's a food opinion you have that would start a war?","What's the worst advice you've ever followed?"];
const WYR=["Would you rather have to speak in rhyme for a week OR only communicate through GIFs?","Would you rather know when you're going to die OR how you're going to die?","Would you rather lose all your Discord messages OR lose all your photos?","Would you rather have no internet for a month OR no music for a year?","Would you rather only be able to whisper OR only be able to shout?","Would you rather know every language OR be able to talk to animals?"];
const ADVICE=["Drink water. Whatever's going on, drink water first.","Log off for 10 minutes. The server will still be here.","The unread messages will still be there tomorrow. Sleep.","Tell the person you've been meaning to message something nice today.","Back up your files. You know which ones.","Touch some grass. I say this with love.","Eat something. A real meal. Not just snacks."];
const FACTS=["Honey never expires — 3000-year-old Egyptian honey was still edible.","A group of flamingos is called a flamboyance.","Octopuses have three hearts, blue blood, and can edit their own RNA.","The shortest war in history lasted 38–45 minutes (Anglo-Zanzibar War, 1896).","Crows can recognise human faces and hold grudges.","Cleopatra lived closer in time to the Moon landing than to the Great Pyramid's construction.","The inventor of the Pringles can is buried in one.","Wombat poop is cube-shaped.","Bananas are berries. Strawberries are not.","Sharks are older than trees.","Nintendo was founded in 1889 as a playing card company."];
const THROW_ITEMS=["a rubber duck 🦆","a pillow 🛏️","a water balloon 💦","a shoe 👟","a fih 🐟","a boomerang 🪃","a piece of bread 🍞","a sock 🧦","a small rock 🪨","Royal V- himself","a spoon 🥄","a snowball ❄️","a bucket of confetti 🎊","a foam dart 🎯","a banana peel 🍌"];
const SLOT_SYMBOLS=["🍒","🍋","🍊","🍇","⭐","💎"];
const WORK_RESPONSES=[{msg:"💼 You worked a shift at the office and earned **{c}** coins.",lo:80,hi:180},{msg:"🔧 You fixed some pipes and the client paid you **{c}** coins.",lo:60,hi:140},{msg:"💻 You freelanced on a website project and earned **{c}** coins.",lo:100,hi:200},{msg:"📦 You sorted packages at the warehouse for **{c}** coins.",lo:50,hi:120},{msg:"🎨 You painted a mural commission and received **{c}** coins.",lo:90,hi:190},{msg:"🍕 You delivered pizzas all evening and made **{c}** coins.",lo:55,hi:130},{msg:"🏗️ You worked a construction shift and earned **{c}** coins.",lo:85,hi:175}];
const BEG_RESPONSES=[{msg:"🙏 A kind stranger tossed you **{c}** coins.",lo:5,hi:30,give:true},{msg:"😔 Nobody gave you anything. Rough day.",lo:0,hi:0,give:false},{msg:"🤑 Someone felt generous and handed you **{c}** coins!",lo:15,hi:50,give:true},{msg:"🫳 A passing cat knocked **{c}** coins toward you.",lo:1,hi:20,give:true},{msg:"📭 You begged for an hour and got absolutely nothing. Tragic.",lo:0,hi:0,give:false}];
const CRIME_RESPONSES=[{msg:"🚨 You tried to pickpocket someone but got caught! Paid **{c}** coins in fines.",success:false,lo:20,hi:80},{msg:"💰 You hacked a vending machine and grabbed **{c}** coins worth of snacks.",success:true,lo:50,hi:150},{msg:"🛒 You shoplifted and flipped the goods for **{c}** coins.",success:true,lo:40,hi:120},{msg:"🕵️ You pulled off a small con and walked away with **{c}** coins.",success:true,lo:60,hi:160},{msg:"🚔 The cops showed up and you lost **{c}** coins fleeing.",success:false,lo:15,hi:60},{msg:"🎲 You rigged a street bet and won **{c}** coins.",success:true,lo:70,hi:170},{msg:"🧢 You got scammed while trying to scam someone else. Down **{c}** coins.",success:false,lo:10,hi:50}];

// ── Shop items (module scope so all handlers can access) ───────────────────────
// Note: prices come from CONFIG so they update when adminconfig changes them.
// SHOP_ITEMS is a function so it always reads current CONFIG values.
function getShopItems(){return{
  lucky_charm:      {name:"Lucky Charm 🍀",       price:CONFIG.shop_lucky_charm_price,      desc:`+${CONFIG.lucky_charm_bonus}% coins on all earning actions for 1hr`},
  xp_boost:         {name:"XP Boost ⚡",           price:CONFIG.shop_xp_boost_price,         desc:"2× XP from messages for 1hr"},
  shield:           {name:"Shield 🛡️",             price:CONFIG.shop_shield_price,           desc:"Blocks the next rob attempt"},
  coin_magnet:      {name:"Coin Magnet 🧲",        price:CONFIG.shop_coin_magnet_price,      desc:"Next /work gives 3× coins (single use)"},
  mystery_box:      {name:"Mystery Box 📦",        price:CONFIG.shop_mystery_box_price,      desc:"Open with /open — weighted random reward: coins or item"},
  item_mystery_box: {name:"Item Mystery Box 🎲",   price:CONFIG.shop_item_mystery_box_price, desc:"Open with /open — cheap, low quality drops. Could be just 5 coins!"},
  rob_insurance:    {name:"Rob Insurance 📋",      price:CONFIG.shop_rob_insurance_price,    desc:"If caught robbing, pay no fine (single use)"},
};}
const TRUTH_QUESTIONS=["Have you ever pretended to be asleep to avoid a conversation?","What's the most embarrassing thing in your search history?","Have you ever blamed someone else for something you did?","What's the longest you've gone without showering?","Have you ever sent a text to the wrong person?","What's something you pretend to like but secretly hate?","Have you ever ghosted someone and regretted it?","What's the most childish thing you still do?"];
const DARE_ACTIONS=["Change your server nickname to 'Big Mistake' for 10 minutes.","Send a voice message saying 'I am a golden retriever' right now.","Type out your honest opinion of the last person who messaged you.","Use only capital letters for the next 5 messages.","Send the 5th photo in your camera roll with no context.","Type a haiku about the last thing you ate.","Compliment every person who has sent a message in the last 10 minutes.","Send a message using only emoji."];
const NEVERHAVEI_STMTS=["... eaten food that fell on the floor.","... stayed up for more than 24 hours straight.","... pretended not to see a notification.","... laughed at something I shouldn't have.","... said 'you too' when the waiter said 'enjoy your meal'.","... accidentally liked a very old post while stalking someone's profile.","... cried at a movie or show alone.","... talked to my pet like they understand everything.","... sent a message and immediately regretted it.","... forgotten someone's name right after being introduced."];
const HOROSCOPES={Aries:"♈ **Aries**: The stars say stop overthinking and send the message. You already know what you want.",Taurus:"♉ **Taurus**: Mercury is in chaos. Eat something good today. That's the advice. Just eat something good.",Gemini:"♊ **Gemini**: Both of your personalities are right. Pick one anyway.",Cancer:"♋ **Cancer**: Someone is thinking about you right now. Whether that's good news is unclear.",Leo:"♌ **Leo**: The universe wants you to be perceived today. This is your sign (literally).",Virgo:"♍ **Virgo**: You've been holding it together for everyone else. Today the stars permit a meltdown.",Libra:"♎ **Libra**: Stop making pros and cons lists. Just pick. It'll be fine.",Scorpio:"♏ **Scorpio**: You already know the answer. You just want someone to confirm it. Fine. You're right.",Sagittarius:"♐ **Sagittarius**: Adventure awaits. Probably not literally today but spiritually, sure.",Capricorn:"♑ **Capricorn**: You've been working hard. The stars notice. Nobody else does but the stars do.",Aquarius:"♒ **Aquarius**: Your weird idea is actually good this time. Go for it.",Pisces:"♓ **Pisces**: You're not behind. Everyone else is just pretending they know what they're doing too."};

// ── Helpers ───────────────────────────────────────────────────────────────────
const r    = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

// Weighted random pick: takes {label: weight} object, returns chosen label
function weightedPick(weights) {
  const total = Object.values(weights).reduce((a,b)=>a+b,0);
  let roll = Math.random()*total;
  for(const [key,w] of Object.entries(weights)){
    roll -= w;
    if(roll <= 0) return key;
  }
  return Object.keys(weights)[0]; // fallback
}

// Open a normal Mystery Box — returns {type:'coins'|'item', coins?, itemId?}
function openMysteryBox(){
  const weights = {
    coins_small:   CONFIG.mb_coins_small,
    coins_large:   CONFIG.mb_coins_large,
    lucky_charm:   CONFIG.mb_lucky_charm,
    xp_boost:      CONFIG.mb_xp_boost,
    shield:        CONFIG.mb_shield,
    coin_magnet:   CONFIG.mb_coin_magnet,
    rob_insurance: CONFIG.mb_rob_insurance,
  };
  const result = weightedPick(weights);
  if(result === "coins_small") return {type:"coins", coins:r(50,200)};
  if(result === "coins_large") return {type:"coins", coins:r(200,500)};
  return {type:"item", itemId:result};
}

// Open an Item Mystery Box — lower quality, cheaper
function openItemMysteryBox(){
  const weights = {
    coins_tiny:    CONFIG.imb_coins_tiny,
    coins_small:   CONFIG.imb_coins_small,
    lucky_charm:   CONFIG.imb_lucky_charm,
    xp_boost:      CONFIG.imb_xp_boost,
    shield:        CONFIG.imb_shield,
    coin_magnet:   CONFIG.imb_coin_magnet,
    rob_insurance: CONFIG.imb_rob_insurance,
  };
  const result = weightedPick(weights);
  if(result === "coins_tiny")  return {type:"coins", coins:5};
  if(result === "coins_small") return {type:"coins", coins:r(20,80)};
  return {type:"item", itemId:result};
}

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
  // Mines not placed yet — deferred until first click to guarantee safe start
  return{rows,cols,mineCount:mines,mines:null,adj:null,revealed:Array(total).fill(false),firstClick:true};
}

// Called on first click: place mines avoiding the clicked cell and its neighbors, then compute adjacency
function placeMinesAvoiding(game,safeRow,safeCol){
  const{rows,cols}=game;
  const total=rows*cols;
  // Build set of safe indices (clicked cell + all 8 neighbors)
  const safeSet=new Set();
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    const nr=safeRow+dr,nc=safeCol+dc;
    if(nr>=0&&nr<rows&&nc>=0&&nc<cols) safeSet.add(nr*cols+nc);
  }
  const mineSet=new Set();
  const candidates=[...Array(total).keys()].filter(i=>!safeSet.has(i));
  // If not enough non-safe cells, allow safe cells too (shouldn't happen on 5x5 with ≤10 mines)
  const pool=candidates.length>=game.mineCount?candidates:[...Array(total).keys()].filter(i=>!safeSet.has(i)||candidates.length<game.mineCount);
  while(mineSet.size<game.mineCount&&mineSet.size<pool.length){
    mineSet.add(pool[Math.floor(Math.random()*pool.length)]);
  }
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
  game.mines=mineArr;
  game.adj=adj;
  game.firstClick=false;
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
      if(rev&&game.mines&&game.adj){
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
function slotPayout(reels){
  if(reels[0]===reels[1]&&reels[1]===reels[2]){
    if(reels[0]==="💎")return{mult:CONFIG.slots_jackpot_mult/100,label:"💎 JACKPOT 💎"};
    if(reels[0]==="⭐")return{mult:CONFIG.slots_bigwin_mult/100,label:"⭐ BIG WIN ⭐"};
    return{mult:CONFIG.slots_triple_mult/100,label:"🎰 THREE OF A KIND!"};
  }
  if(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2])return{mult:CONFIG.slots_pair_mult/100,label:"Two of a kind"};
  return{mult:0,label:"No match"};
}

// Media fetchers
async function fetchJson(url){return new Promise((resolve,reject)=>{https.get(url,{headers:{"Accept":"application/json"}},res=>{let body="";res.on("data",d=>body+=d);res.on("end",()=>{try{resolve(JSON.parse(body));}catch{reject();}});}).on("error",reject);});}
async function getCatGif(){try{const d=await fetchJson("https://api.thecatapi.com/v1/images/search?mime_types=gif&limit=1");return d[0]?.url||null;}catch{return null;}}
async function getDogImage(){try{const d=await fetchJson("https://dog.ceo/api/breeds/image/random");return d?.message||null;}catch{return null;}}
async function getFoxImage(){try{const d=await fetchJson("https://randomfox.ca/floof/");return d?.image||null;}catch{return null;}}
async function getPandaImage(){try{const d=await fetchJson("https://some-random-api.com/img/panda");return d?.link||null;}catch{return null;}}
async function getDuckImage(){try{const d=await fetchJson("https://random-d.uk/api/random");return d?.url||null;}catch{return null;}}
async function getBunnyImage(){try{const d=await fetchJson("https://api.bunnies.io/v2/loop/random/?media=gif,png");return d?.media?.gif||d?.media?.png||null;}catch{return null;}}
async function getKoalaImage(){try{const d=await fetchJson("https://some-random-api.com/img/koala");return d?.link||null;}catch{return null;}}
async function getRaccoonImage(){try{const d=await fetchJson("https://some-random-api.com/img/raccoon");return d?.link||null;}catch{return null;}}
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

// ── Premiere helpers ──────────────────────────────────────────────────────────
function buildPremiereBar(endsAt, startedAt) {
  const total  = endsAt - startedAt;
  const elapsed= Date.now() - startedAt;
  const pct    = Math.min(1, Math.max(0, elapsed / total));
  const W      = 20;
  const filled = Math.round(pct * W);
  const bar    = "█".repeat(filled) + "░".repeat(W - filled);
  return { bar, pct };
}

function buildPremiereEmbed(p) {
  const now       = Date.now();
  const remaining = Math.max(0, p.endsAt - now);
  const hrs       = Math.floor(remaining / 3600000);
  const mins      = Math.floor((remaining % 3600000) / 60000);
  const { bar, pct } = buildPremiereBar(p.endsAt, p.startedAt);
  const pctLabel  = Math.round(pct * 100);
  const endTs     = Math.floor(p.endsAt / 1000);
  const done      = remaining === 0;

  return {
    embeds: [{
      title: done ? `🎬 ${p.title} — It's time!` : `🎬 ${p.title}`,
      description: done
        ? `<@${p.userId}> Your video is ready to upload! 🚀`
        : [
            `**Progress:** \`[${bar}]\` ${pctLabel}%`,
            ``,
            `⏳ **${hrs}h ${mins}m** remaining`,
            `📅 Drops <t:${endTs}:R> (<t:${endTs}:f>)`,
            ``,
            `*Updates every 30 minutes*`,
          ].join("\n"),
      color: done ? 0x00FF00 : 0xFF4500,
      footer: { text: done ? "Upload time! 🎉" : "Premiere countdown" },
      timestamp: new Date().toISOString(),
    }],
  };
}

// Premiere tick — runs every 30 minutes, edits all active premiere embeds
setInterval(async () => {
  const now = Date.now();
  for (const [id, p] of premieres) {
    try {
      const ch  = await client.channels.fetch(p.channelId).catch(() => null);
      if (!ch) continue;
      const msg = await ch.messages.fetch(p.messageId).catch(() => null);
      if (!msg) continue;

      if (now >= p.endsAt) {
        // Finished — show done embed, ping user, then remove
        await msg.edit(buildPremiereEmbed(p)).catch(() => {});
        await safeSend(ch, `🎬 <@${p.userId}> **${p.title}** — time to upload! 🚀`);
        premieres.delete(id);
        saveData();
      } else {
        await msg.edit(buildPremiereEmbed(p)).catch(() => {});
      }
    } catch(e) { console.error("Premiere tick error:", e.message); }
  }
}, 30 * 60 * 1000);

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
  const rewards = [CONFIG.invite_comp_1st, CONFIG.invite_comp_2nd, CONFIG.invite_comp_3rd];
  const top3    = sorted.slice(0, 3);
  const lines = top3.map(([id, d], i) => `${medals[i]} <@${id}> — **${d.count}** invite${d.count !== 1 ? "s" : ""} (+${rewards[i]} coins)`);
  top3.forEach(([id, d], i) => { getScore(id, d.username).coins += rewards[i]; });
  sorted.forEach(([id, d]) => {
    if (!top3.find(([tid]) => tid === id)) { getScore(id, d.username).coins += d.count * CONFIG.invite_comp_per_invite; }
  });
  saveData();
  await safeSend(channel,
    `🏆 **${event.name} — Final Results!**\n\n${lines.join("\n")}\n\n` +
    (sorted.length > 3 ? `Everyone else who invited at least 1 person earned **${CONFIG.invite_comp_per_invite} coins per invite**.\n\n` : "") +
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

// ── YouTube helpers ───────────────────────────────────────────────────────────

// Resolve a YouTube channel ID from a handle (@name), URL, or raw channel ID
async function resolveYouTubeChannelId(input, apiKey) {
  if (!apiKey) return null;
  const clean = input.trim();

  // Already a raw channel ID (starts with UC and ~24 chars)
  if (/^UC[\w-]{20,}$/.test(clean)) return clean;

  // Extract from URL forms: /channel/UC..., /c/handle, /@handle, /user/handle
  const urlMatch = clean.match(/youtube\.com\/(?:channel\/(UC[\w-]+)|(?:c\/|@|user\/)?([\w@.-]+))/i);
  let handle = null;
  if (urlMatch) {
    if (urlMatch[1]) return urlMatch[1];
    handle = urlMatch[2];
  } else if (clean.startsWith("@")) {
    handle = clean.slice(1);
  } else {
    handle = clean;
  }

  // Search by handle
  try {
    const data = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=id,snippet&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`);
    if (data?.items?.[0]?.id) return data.items[0].id;
  } catch {}

  // Fallback: search
  try {
    const data = await fetchJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${apiKey}`);
    return data?.items?.[0]?.snippet?.channelId || null;
  } catch { return null; }
}

// Get current subscriber count + channel title for a channel ID
async function getYouTubeStats(ytChannelId, apiKey) {
  if (!apiKey) return null;
  try {
    const data = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${ytChannelId}&key=${apiKey}`);
    const ch = data?.items?.[0];
    if (!ch) return null;
    return {
      subs:   parseInt(ch.statistics?.subscriberCount || "0"),
      title:  ch.snippet?.title || ytChannelId,
      hidden: ch.statistics?.hiddenSubscriberCount === true,
    };
  } catch { return null; }
}

// Build a visual progress bar: ████████░░░░ 80%
function buildBar(current, goal, width=20) {
  const pct = Math.min(1, current / goal);
  const filled = Math.round(pct * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

// Format subscriber count nicely: 1234567 → "1.23M"
function fmtSubs(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 1 : 2).replace(/\.?0+$/, "") + "K";
  return String(n);
}

// ── YouTube polling tick (runs every 5 minutes) ───────────────────────────────
setInterval(async () => {
  for (const [guildId, cfg] of ytConfig.entries()) {
    if (!cfg.ytChannelId || !cfg.apiKey) continue;
    const stats = await getYouTubeStats(cfg.ytChannelId, cfg.apiKey);
    if (!stats || stats.hidden) continue;
    const now = Date.now();
    const prev = cfg.lastSubs ?? stats.subs;
    cfg.lastSubs = stats.subs;
    cfg.lastSubsTimestamp = now;
    // Keep rolling 90-day history (one entry per poll, capped at 90d × 12 per hour = 12960 entries max — cap at 1000)
    if (!cfg.history) cfg.history = [];
    cfg.history.push({ ts: now, subs: stats.subs });
    if (cfg.history.length > 1000) cfg.history = cfg.history.slice(-1000);
    saveData();

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    // ── Live sub count message edit ─────────────────────────────────────────
    if (cfg.subcountDiscordId && cfg.subcountMessageId) {
      try {
        const ch = guild.channels.cache.get(cfg.subcountDiscordId);
        if (ch) {
          const msg = await ch.messages.fetch(cfg.subcountMessageId).catch(() => null);
          if (msg) {
            const threshold = cfg.subcountThreshold || 1000;
            const rounded = Math.floor(stats.subs / threshold) * threshold;
            const diff = stats.subs - prev;
            const diffStr = diff > 0 ? ` (+${fmtSubs(diff)})` : diff < 0 ? ` (${fmtSubs(diff)})` : "";
            await msg.edit({
              embeds: [{
                title: `📊 ${stats.title} — Live Sub Count`,
                description: `## ${fmtSubs(stats.subs)}\n*~${fmtSubs(rounded)} (rounded to nearest ${fmtSubs(threshold)})*${diffStr}`,
                color: 0xFF0000,
                footer: { text: `Updated` },
                timestamp: new Date().toISOString(),
              }]
            }).catch(() => {});
          }
        }
      } catch {}
    }

    // ── Sub goal progress ───────────────────────────────────────────────────
    if (cfg.goal && !cfg.goalReached) {
      const pct = Math.min(100, Math.round(stats.subs / cfg.goal * 100));
      if (cfg.goalDiscordId) {
        const ch = guild.channels.cache.get(cfg.goalDiscordId);
        if (ch && cfg.goalMessageId) {
          const msg = await ch.messages.fetch(cfg.goalMessageId).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [{
                title: `🎯 ${stats.title} — Sub Goal`,
                description: `**${fmtSubs(stats.subs)}** / **${fmtSubs(cfg.goal)}**\n\`[${buildBar(stats.subs, cfg.goal)}]\` **${pct}%**`,
                color: pct >= 100 ? 0x00FF00 : 0xFF0000,
                footer: { text: "Updated" },
                timestamp: new Date().toISOString(),
              }]
            }).catch(() => {});
          }
        }
      }
      // Fire goal reached
      if (stats.subs >= cfg.goal) {
        cfg.goalReached = true;
        saveData();
        if (cfg.goalDiscordId) {
          const ch = guild.channels.cache.get(cfg.goalDiscordId);
          if (ch) {
            const msg = cfg.goalMessage || `🎉 **${stats.title}** just hit the sub goal of **${fmtSubs(cfg.goal)}** subscribers! 🎊`;
            await safeSend(ch, msg);
          }
        }
      }
    }

    // ── Milestones ──────────────────────────────────────────────────────────
    if (cfg.milestones?.length && cfg.milestoneDiscordId) {
      const ch = guild.channels.cache.get(cfg.milestoneDiscordId);
      if (ch) {
        for (const m of cfg.milestones) {
          if (!m.reached && stats.subs >= m.subs) {
            m.reached = true;
            saveData();
            const txt = m.message || `🏆 **${stats.title}** just reached **${fmtSubs(m.subs)} subscribers**! 🎉`;
            await safeSend(ch, txt);
          }
        }
      }
    }
  }
}, 5 * 60 * 1000);

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
    {name:"forcedivorce", description:"[Owner] Force divorce two users", options:[{name:"user",description:"User to divorce",type:6,required:true}]},
    {name:"forcemarry",  description:"[Owner] Force marry two users",options:[{name:"user1",description:"First user",type:6,required:true},{name:"user2",description:"Second user",type:6,required:true}]},
    {name:"partner",     description:"Check who you're married to 💑",options:uReq(false)},
    // Meters / actions
    {name:"action",      description:"Do an action to someone",options:[{name:"type",description:"Action",type:3,required:true,choices:[{name:"Hug",value:"hug"},{name:"Pat",value:"pat"},{name:"Poke",value:"poke"},{name:"Stare",value:"stare"},{name:"Wave",value:"wave"},{name:"High five",value:"highfive"},{name:"Boop",value:"boop"},{name:"Oil up",value:"oil"},{name:"Diddle",value:"diddle"},{name:"Kill",value:"kill"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"rate",        description:"Rate someone on various meters",options:[{name:"type",description:"What to rate",type:3,required:true,choices:[{name:"Gay rate",value:"gayrate"},{name:"Autism meter",value:"howautistic"},{name:"Simp level",value:"simp"},{name:"Cursed energy",value:"cursed"},{name:"NPC %",value:"npc"},{name:"Villain arc",value:"villain"},{name:"Sigma rating",value:"sigma"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"party",       description:"Party games: truth, dare, never have I ever",options:[{name:"type",description:"Game type",type:3,required:true,choices:[{name:"Truth",value:"truth"},{name:"Dare",value:"dare"},{name:"Never Have I Ever",value:"neverhavei"}]}]},
    {name:"ppsize",      description:"Check pp size",options:uReq()},
    // Media
// Media
    {name:"gif",    description:"Get a random animal GIF 🐾",options:[{name:"animal",description:"Which animal",type:3,required:true,choices:[
      {name:"Cat 🐱",   value:"cat"},
      {name:"Dog 🐶",   value:"dog"},
      {name:"Fox 🦊",   value:"fox"},
      {name:"Panda 🐼", value:"panda"},
      {name:"Duck 🦆",  value:"duck"},
      {name:"Bunny 🐇", value:"bunny"},
      {name:"Koala 🐨", value:"koala"},
      {name:"Raccoon 🦝",value:"raccoon"},
    ]}]},
    {name:"joke",   description:"Random joke 😂"},
    {name:"meme",   description:"Random meme 🐸"},
    {name:"quote",  description:"Random quote image ✨"},
    {name:"goodquote", description:"Get a higher-rated quote image ⭐"},
    {name:"badquote",  description:"Get a lower-rated quote image 💀"},
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
  {name:"message",     description:"The text to send",                          type:3, required:false},
  {name:"embed",       description:"Turn the message into a rich embed",         type:5, required:false},
  {name:"image",       description:"Attach an image file",                       type:11,required:false},
  {name:"title",       description:"Embed title (only used when embed is on)",   type:3, required:false},
  {name:"color",       description:"Embed colour as hex e.g. #ff0000",           type:3, required:false},
  {name:"replyto",     description:"Message ID to reply to in this channel",     type:3, required:false},
]},
    {name:"horoscope",      description:"Your daily horoscope ✨",options:[{name:"sign",description:"Your star sign",type:3,required:true,choices:Object.keys(HOROSCOPES).map(k=>({name:k,value:k}))}]},
    {name:"poll",           description:"Create a quick yes/no poll 📊",options:[{name:"question",description:"Poll question",type:3,required:true}]},
    {name:"remind",         description:"Set a reminder ⏰",options:[{name:"time",description:"Time in minutes",type:4,required:true},{name:"message",description:"Reminder message",type:3,required:true}]},
    {name:"premiere",       description:"Start a countdown to your video upload 🎬",options:[
      {name:"hours",    description:"How many hours until the video releases",        type:10,required:true},
      {name:"channel",  description:"Channel to post the countdown in",               type:7, required:true},
      {name:"title",    description:"Video title (optional, shown in the countdown)", type:3, required:false},
    ]},
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
    {name:"buy",      description:"Buy an item 🛒",options:[{name:"item",description:"Item name",type:3,required:true,choices:[
      {name:"Lucky Charm 🍀 (+10% coins, 1hr)",         value:"lucky_charm"},
      {name:"XP Boost ⚡ (2× XP, 1hr)",                 value:"xp_boost"},
      {name:"Shield 🛡️ (blocks next rob)",              value:"shield"},
      {name:"Coin Magnet 🧲 (next work = 3× coins)",    value:"coin_magnet"},
      {name:"Mystery Box 📦 (weighted random reward)",  value:"mystery_box"},
      {name:"Item Mystery Box 🎲 (cheap, low quality)", value:"item_mystery_box"},
      {name:"Rob Insurance 📋 (no fine if caught rob)", value:"rob_insurance"},
    ]}]},
    {name:"open",     description:"Open a mystery box from your inventory 📦",options:[{name:"box",description:"Which box to open",type:3,required:true,choices:[
      {name:"Mystery Box 📦",      value:"mystery_box"},
      {name:"Item Mystery Box 🎲", value:"item_mystery_box"},
    ]}]},
    {name:"inventory",description:"Check your inventory 🎒",options:uReq(false)},
    // XP
    {name:"xp",           description:"Check XP and level 📈",options:uReq(false)},
    {name:"xpleaderboard",description:"XP leaderboard 🏆",options:[{name:"scope",description:"global or server",type:3,required:false,choices:[{name:"Global",value:"global"},{name:"Server",value:"server"}]}]},
    // Scores
    {name:"score",            description:"Check game stats 🏆",options:uReq(false)},
    {name:"leaderboard",      description:"Global leaderboard 🌍",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"},{name:"Images Uploaded",value:"images"}]}]},
    {name:"serverleaderboard",description:"Server leaderboard 🏠",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"},{name:"Images Uploaded",value:"images"}]}]},
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
    {name:"counting",        description:"Set or remove a permanent counting channel (Manage Server)",options:[
      {name:"action",        description:"What to do",type:3,required:true,choices:[{name:"Set this channel as a counting channel",value:"set"},{name:"Remove counting from this channel",value:"remove"},{name:"Check current count",value:"status"}]},
    ]},
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
    {name:"purge",           description:"Delete messages in bulk (Manage Messages)",options:[
      {name:"amount",      description:"Number of messages to scan (1-100)",  type:4,required:true},
      {name:"filter",      description:"Only delete certain messages",         type:3,required:false,choices:[
        {name:"Humans only",  value:"humans"},
        {name:"Bots only",    value:"bots"},
      ]},
      {name:"contains",    description:"Only delete messages containing this word/phrase", type:3,required:false},
    ]},
    // Tickets
    {name:"ticketsetup",     description:"Open the ticket system setup dashboard (Manage Server)"},
    {name:"closeticket",     description:"Close this ticket"},
    {name:"addtoticket",     description:"Add a user to this ticket",options:[{name:"user",description:"User to add",type:6,required:true}]},
    {name:"removefromticket",description:"Remove a user from this ticket",options:[{name:"user",description:"User to remove",type:6,required:true}]},
    // YouTube
    {name:"ytsetup",         description:"Connect a YouTube channel to this server (Manage Server)",options:[
      {name:"channel",       description:"YouTube handle (@name), channel URL, or channel ID (UC…)", type:3,required:true},
      {name:"discord_channel",description:"Discord channel to post YouTube updates in",              type:7,required:true},
      {name:"apikey",        description:"Your YouTube Data API v3 key (stored securely in botdata)", type:3,required:false},
    ]},
    {name:"subgoal",         description:"Set a subscriber goal with a live progress bar (Manage Server)",options:[
      {name:"goal",          description:"Target subscriber count (e.g. 10000)",                  type:4,required:true},
      {name:"message",       description:"Custom message when goal is reached (optional)",         type:3,required:false},
    ]},
    {name:"subcount",        description:"Post a live sub count display that auto-updates (Manage Server)",options:[
      {name:"threshold",     description:"Round display to nearest amount",                        type:3,required:true,choices:[{name:"Every 1K subs",value:"1000"},{name:"Every 10K subs",value:"10000"}]},
    ]},
    {name:"milestones",      description:"Manage subscriber milestone announcements (Manage Server)",options:[
      {name:"action",        description:"What to do",                                             type:3,required:true,choices:[{name:"Add milestone",value:"add"},{name:"Remove milestone",value:"remove"},{name:"List milestones",value:"list"}]},
      {name:"subs",          description:"Subscriber count for this milestone (for add/remove)",   type:4,required:false},
      {name:"message",       description:"Custom announcement message (for add, optional)",        type:3,required:false},
    ]},
    // Owner
    {name:"servers",        description:"[Owner] List servers"},
    {name:"broadcast",      description:"[Owner] Broadcast to all owners",options:[{name:"message",description:"Message",type:3,required:true}]},
    {name:"fakecrash",      description:"[Owner] Fake crash"},
    {name:"identitycrisis", description:"[Owner] Identity crisis DMs"},
    {name:"botolympics",    description:"[Owner] Start Olympics",options:[{name:"event",description:"Event",type:3,required:true,choices:OLYMPICS_EVENTS.map((e,i)=>({name:e.name,value:String(i)}))}]},
    {name:"sentience",      description:"[Owner] Trigger sentience"},
    {name:"legendrandom",   description:"[Owner] Random legend"},
    {name:"fakemessage",    description:"[Owner] Send a message as another user via webhook",options:[{name:"user",description:"User to impersonate",type:6,required:true},{name:"message",description:"Message text to send",type:3,required:false},{name:"file",description:"File to send",type:11,required:false}]},
    {name:"dmuser",         description:"[Owner] DM a user",options:[{name:"user",description:"User",type:6,required:true},{name:"message",description:"Message",type:3,required:true}]},
    {name:"leaveserver",    description:"[Owner] Leave a server",options:[{name:"server",description:"Server ID",type:3,required:true}]},
    {name:"restart",        description:"[Owner] Restart"},
    {name:"botstats",       description:"[Owner] Bot stats"},
    {name:"setstatus",      description:"[Owner] Set status",options:[{name:"text",description:"Text",type:3,required:true},{name:"type",description:"Type",type:3,required:false,choices:[{name:"Playing",value:"PLAYING"},{name:"Watching",value:"WATCHING"},{name:"Listening",value:"LISTENING"},{name:"Competing",value:"COMPETING"}]}]},
    {name:"adminuser",      description:"[Owner] Edit user stats",options:[{name:"user",description:"User",type:6,required:true},{name:"field",description:"Field",type:3,required:true,choices:[{name:"Coins",value:"coins"},{name:"Wins",value:"wins"},{name:"Games Played",value:"gamesPlayed"},{name:"Daily Streak",value:"dailyStreak"},{name:"Best Streak",value:"bestStreak"},{name:"XP",value:"xp"},{name:"Level",value:"level"},{name:"Images Uploaded",value:"imagesUploaded"}]},{name:"value",description:"New integer value",type:4,required:true}]},
    {name:"adminreset",     description:"[Owner] Reset all stats for user",options:[{name:"user",description:"User",type:6,required:true}]},
    {name:"adminconfig",    description:"[Owner] View/edit global config values",options:[{name:"key",description:"Config key to view or edit (leave blank to list all keys)",type:3,required:false},{name:"value",description:"New integer value",type:4,required:false}]},
    {name:"shadowdelete", description:"[Owner] Randomly delete a % of a user's messages", options:[
  {name:"user", description:"Target user", type:6, required:true},
  {name:"percentage", description:"Delete chance % (0 to disable)", type:4, required:true},
]},
    {name:"clankerify", description:"[Owner] Resend a user's messages as a webhook impersonating them", default_member_permissions:"0", options:[
  {name:"user",     description:"Target user",                                             type:6, required:true},
  {name:"duration", description:"Duration in minutes (omit or 0 to disable)",              type:4, required:false},
]},
    {name:"admingive",description:"[Owner] Give or take coins/items from a user",options:[
      {name:"user",          description:"Target user",                          type:6,required:true},
      {name:"action",        description:"Give or take (default: give)",         type:3,required:false,choices:[
        {name:"Give",value:"give"},
        {name:"Take",value:"take"},
      ]},
      {name:"amount",        description:"Coins to give or take",                type:4,required:false},
      {name:"item",          description:"Item to give or take",                 type:3,required:false,choices:[
        {name:"Lucky Charm 🍀",       value:"lucky_charm"},
        {name:"XP Boost ⚡",          value:"xp_boost"},
        {name:"Shield 🛡️",           value:"shield"},
        {name:"Coin Magnet 🧲",       value:"coin_magnet"},
        {name:"Mystery Box 📦",       value:"mystery_box"},
        {name:"Item Mystery Box 🎲",  value:"item_mystery_box"},
        {name:"Rob Insurance 📋",     value:"rob_insurance"},
      ]},
{name:"item_quantity", description:"How many of the item (default: 1)",    type:4,required:false},
    ]},
    {name:"rolespingfix", description:"List roles that can @everyone and fix them (Manage Server)"},
    {name:"upload",            description:"Upload an image to the quotes folder",options:[
      {name:"source",          description:"[Memers only] Upload a file directly from your device",type:11,required:false},
      {name:"link",            description:"[Memers only] Submit an image via URL link",type:3,required:false},
    ]},
    {name:"managememers",      description:"[Owner] Add or remove users from the upload allowlist",options:[
      {name:"action",          description:"Add or remove",type:3,required:true,choices:[
        {name:"Add",value:"add"},
        {name:"Remove",value:"remove"},
        {name:"List",value:"list"},
      ]},
      {name:"user",            description:"User to add or remove (not needed for list)",type:6,required:false},
    ]},
    {name:"quotelist",         description:"[Owner] List all images in the quotes folder"},
    {name:"quotedelete",       description:"[Owner] Delete an image from the quotes folder",options:[
      {name:"filename",        description:"Exact filename to delete (use /quotelist to find it)",type:3,required:true},
    ]},
    {name:"quotemanage",       description:"[Owner] Browse and delete quotes with image preview",options:[
      {name:"index",           description:"Start at a specific image number (default: 1)",type:4,required:false},
    ]},
    {name:"dailyquote",        description:"Set up a daily quote post in a channel (Manage Server)",options:[
      {name:"action",          description:"What to do",type:3,required:true,choices:[
        {name:"Set channel",   value:"set"},
        {name:"Disable",       value:"disable"},
        {name:"Status",        value:"status"},
      ]},
      {name:"channel",         description:"Channel to post daily quotes in (required for set)",type:7,required:false},
      {name:"hour",            description:"UTC hour to post (0–23, default: 9)",type:4,required:false},
    ]},
    {name:"library",           description:"Browse images a user has uploaded to the quotes folder",options:[
      {name:"user",            description:"User whose uploads to browse",type:6,required:true},
    ]},
    {name:"activity-check",   description:"Send an activity check (Manage Server)",options:[
      {name:"channel",         description:"Channel to send the activity check in",type:7,required:true},
      {name:"deadline",        description:"Hours until check closes (default: 24)",type:4,required:false},
      {name:"message",         description:"Custom message text (optional)",type:3,required:false},
      {name:"ping",            description:"Ping the required roles in the message? (default: true)",type:5,required:false},
      {name:"schedule",        description:"Send automatically at this time every week (e.g. Monday 09:00)",type:3,required:false},
    ]},
    {name:"raconfig",         description:"Set up RA and LOA roles for this server (Manage Server)",options:[
      {name:"action",          description:"What to do",type:3,required:true,choices:[
        {name:"Create roles automatically",value:"create"},
        {name:"Set existing RA role",value:"set_ra"},
        {name:"Set existing LOA role",value:"set_loa"},
        {name:"View current config",value:"view"},
      ]},
      {name:"role",            description:"Existing role to use (for set_ra / set_loa)",type:8,required:false},
    ]},
    {name:"reduced-activity", description:"Give or remove the Reduced Activity role from a member",options:[
      {name:"user",            description:"Member to apply RA to",type:6,required:true},
      {name:"action",          description:"Give or remove",type:3,required:true,choices:[{name:"Give",value:"give"},{name:"Remove",value:"remove"}]},
      {name:"duration",        description:"How long to keep the RA role (hours, optional — permanent if omitted)",type:4,required:false},
    ]},
    {name:"loa",              description:"Give or remove the LOA role from a member",options:[
      {name:"user",            description:"Member to apply LOA to",type:6,required:true},
      {name:"action",          description:"Give or remove",type:3,required:true,choices:[{name:"Give",value:"give"},{name:"Remove",value:"remove"}]},
      {name:"duration",        description:"How long to keep the LOA role (hours, optional — permanent if omitted)",type:4,required:false},
    ]},
  ];
}



// ── Command registration ──────────────────────────────────────────────────────
function discordRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const noBody = method === "GET" || method === "DELETE";
    const data   = noBody ? null : (body !== null && body !== undefined ? JSON.stringify(body) : "[]");
    const headers = { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" };
    if (!noBody) headers["Content-Length"] = Buffer.byteLength(data);
    const opts = { hostname: "discord.com", port: 443, path, method, headers };
    const req = https.request(opts, res => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    if (!noBody) req.write(data);
    req.end();
  });
}

async function clearGlobalCommands() {
  try {
    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/commands`, []);
    if (r.status === 200) console.log("✅ Global commands wiped");
    else console.warn(`⚠️ clearGlobalCommands HTTP ${r.status}: ${r.body.slice(0,200)}`);
  } catch(e) { console.warn("clearGlobalCommands error:", e.message); }
}

// Commands that should ONLY be guild-registered (instant propagation, no global cache lag).
// Keep owner-only commands here so changes show up immediately without the 1hr global delay.
// These commands are registered per-guild (instant, <1s propagation) instead of globally.
// Use this for commands where choices/options change and you can't wait 1hr for global cache.
const GUILD_ONLY_CMDS = ["admingive","buy","open","shop","inventory","premiere","forcemarry","forcedivorce","shadowdelete","clankerify","purge","rolespingfix","library","activity-check","raconfig","reduced-activity","loa","fakemessage","quotedelete","quotelist","quotemanage","dailyquote","goodquote","badquote"];

// Wipe stale global versions of guild-only commands.
// When a command moves from global to guild-only, its global entry lingers until explicitly deleted.
async function wipeStaleGlobalCmds() {
  try {
    // Fetch all currently registered global commands
    const r = await discordRequest("GET", `/api/v10/applications/${CLIENT_ID}/commands`, null);
    if (r.status !== 200) return;
    const global = JSON.parse(r.body);
    // Delete any that are now guild-only
    for (const cmd of global) {
      if (GUILD_ONLY_CMDS.includes(cmd.name)) {
        await discordRequest("DELETE", `/api/v10/applications/${CLIENT_ID}/commands/${cmd.id}`, null);
        console.log(`🗑️ Deleted stale global command: ${cmd.name}`);
      }
    }
  } catch(e) { console.warn("wipeStaleGlobalCmds error:", e.message); }
}

async function registerGlobalCommands() {
  try {
    const cmds = buildCommands().filter(c => !GUILD_ONLY_CMDS.includes(c.name));
    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/commands`, cmds);
    if (r.status === 200) {
      const registered = JSON.parse(r.body);
      console.log(`✅ Global: ${registered.length} commands registered`);
    } else {
      console.error(`❌ Global commands HTTP ${r.status}: ${r.body.slice(0,300)}`);
    }
  } catch(e) { console.error("registerGlobalCommands error:", e.message); }
}

async function registerGuildOnlyCommands(guildId, force = false) {
  try {
    const cmds = buildCommands().filter(c => GUILD_ONLY_CMDS.includes(c.name));
    // Build a fingerprint of the current guild-only command definitions (full structure, not just names)
    const fingerprint = JSON.stringify(cmds.map(c => JSON.stringify(c)).sort());

    if (!force) {
      // Fetch what's currently registered for this guild
      const existing = await discordRequest("GET", `/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`, null);
      if (existing.status === 200) {
        const registered = JSON.parse(existing.body);
        // Rebuild a comparable fingerprint from the registered definitions
        // We only compare the fields we control: name, description, options
        const normalize = c => JSON.stringify({ name: c.name, description: c.description, options: c.options ?? [] });
        const registeredFingerprint = JSON.stringify(registered.map(normalize).sort());
        const localFingerprint      = JSON.stringify(cmds.map(normalize).sort());
        if (registeredFingerprint === localFingerprint) {
          console.log(`⏭️ Guild [${guildId}]: guild-only commands unchanged, skipping`);
          return;
        }
      }
    }

    const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`, cmds);
    if (r.status === 200) {
      console.log(`✅ Guild [${guildId}]: ${JSON.parse(r.body).length} guild-only commands registered`);
    } else {
      console.warn(`⚠️ Guild-only commands [${guildId}] HTTP ${r.status}: ${r.body.slice(0,200)}`);
    }
  } catch(e) { console.warn(`registerGuildOnlyCommands [${guildId}]:`, e.message); }
}


// Wipe ALL guild-level commands for a server — used to clear old stale registrations
// that would cause doubling alongside global commands.
// Pass skipGuildOnly=true to wipe everything; false to re-register guild-only after wipe.
async function clearGuildCommands(guildId, andReregister = true) {
  try {
    // Check what's currently registered before wiping
    const existing = await discordRequest("GET", `/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`, null);
    if (existing.status === 200) {
      const registered = JSON.parse(existing.body);
      const guildOnlyNames = buildCommands().filter(c => GUILD_ONLY_CMDS.includes(c.name)).map(c => c.name).sort();
      const registeredNames = registered.map(c => c.name).sort();
      // Only wipe+reregister if there are stale/extra commands or the set differs
      const hasStale = registered.some(c => !GUILD_ONLY_CMDS.includes(c.name));
      const sameSet = JSON.stringify(registeredNames) === JSON.stringify(guildOnlyNames);
      if (!hasStale && sameSet) {
        console.log(`⏭️ Guild [${guildId}]: commands already clean, skipping wipe`);
        return;
      }
    }
    // Wipe and reregister only if needed
const r = await discordRequest("PUT", `/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`, []);
    if (r.status === 200) {
      if (andReregister) {
        await registerGuildOnlyCommands(guildId, true);
      } else {
        console.log(`✅ Guild commands wiped: ${guildId}`);
      }
    } else if (r.status === 400 && r.body.includes("30034")) {
      const retryAfter = JSON.parse(r.body).retry_after || 60;
      console.warn(`⚠️ Guild [${guildId}]: hit 200/day limit. Retrying in ${Math.ceil(retryAfter)}s…`);
      await new Promise(res => setTimeout(res, (retryAfter + 2) * 1000));
      await registerGuildOnlyCommands(guildId, true);
} else {
      console.warn(`⚠️ clearGuildCommands [${guildId}] HTTP ${r.status}`);
    }
  } catch(e) { console.warn(`clearGuildCommands [${guildId}]:`, e.message); }
}

// ── Bot events ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`Not even sure that this is real: ${client.user.tag} [${INSTANCE_ID}] in ${client.guilds.cache.size} servers`);
  try { const owner = await client.users.fetch(OWNER_ID); await acquireInstanceLock(owner); }
  catch(e) { console.error("Lock error:", e); instanceLocked = true; }

  // Don't register commands if this instance lost the lock and is about to exit
  if (!instanceLocked) return;

  // Step 0: Delete any stale global versions of guild-only commands.
  await wipeStaleGlobalCmds();

  // Step 1: Register global commands (all except guild-only ones).
  await registerGlobalCommands();

  // Step 2: For every guild — register guild-only commands (skips if already registered).
  const guilds = [...client.guilds.cache.values()];
  for (let i = 0; i < guilds.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 1000));
    await clearGuildCommands(guilds[i].id, true);
  }

  // Snapshot invites for invite competitions
  for (const guild of guilds) {
    snapshotInvites(guild).catch(() => {});
  }
});

client.on("guildCreate", async g => {
  console.log(`Joined: ${g.name} (${g.id})`);
  // Register guild-only commands instantly when joining a new server
  await registerGuildOnlyCommands(g.id);
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

  // ── Quote vote tracking ──────────────────────────────────────────────────────
  const quoteName = quoteVoteMessages.get(reaction.message.id);
  if (quoteName) {
    const emoji = reaction.emoji.name;
    if (emoji === "👍" || emoji === "👎") {
      const v = quoteVotes.get(quoteName) || { up: 0, down: 0 };
      if (emoji === "👍") v.up++;
      else                v.down++;
      quoteVotes.set(quoteName, v);
      saveData();
    }
    return; // don't fall through to reaction-role logic
  }

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

  // ── Quote vote removal ───────────────────────────────────────────────────────
  const quoteName = quoteVoteMessages.get(reaction.message.id);
  if (quoteName) {
    const emoji = reaction.emoji.name;
    if (emoji === "👍" || emoji === "👎") {
      const v = quoteVotes.get(quoteName) || { up: 0, down: 0 };
      if (emoji === "👍") v.up   = Math.max(0, v.up - 1);
      else                v.down = Math.max(0, v.down - 1);
      quoteVotes.set(quoteName, v);
      saveData();
    }
    return;
  }

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
  const shadowPct=shadowDelete.get(msg.author.id);
  if(shadowPct&&Math.random()*100<shadowPct){
    msg.delete().catch(()=>{});
  }

  // ── Clankerify: delete message and resend via webhook as the user ───────────
  const clankEntry = clankerify.get(msg.author.id);
  if(clankEntry){
    const now = Date.now();
    // Check expiry
    if(clankEntry.expiresAt !== null && clankEntry.expiresAt <= now){
      clankerify.delete(msg.author.id);
      saveData();
    } else {
      try {
        // Gather content / attachments before deleting
        const content    = msg.content || null;
        const attachUrls = [...msg.attachments.values()].map(a => a.url);
        const stickers   = [...msg.stickers.values()].map(s => s.name);

        await msg.delete().catch(()=>{});

        const member    = await msg.guild.members.fetch(msg.author.id).catch(()=>null);
        let displayName = member?.displayName || msg.author.displayName || msg.author.globalName || msg.author.username;
        let avatarURL   = msg.author.displayAvatarURL({ size: 256, dynamic: true });
        let sendContent = content;

        // ── Mode transforms ────────────────────────────────────────────────────
        const mode = clankEntry.mode ?? null;

        if(mode === "evil"){
          displayName = `Evil ${displayName}`;
          if(sendContent) sendContent = sendContent + " I'M SO EVIL THOOO";
        }

        if(mode === "freaky"){
          displayName = `𝓕𝓻𝓮𝓪𝓴𝔂 ${displayName}`;
          if(sendContent) sendContent = `𝓕𝓻𝓮𝓪𝓴𝔂 ${sendContent}`;
        }

        if(mode === "american"){
          displayName = `American ${displayName}`;
          if(sendContent){
            sendContent = sendContent.toUpperCase() +
              " LAWD BLESS MERICA 🦅🦅🦅🔥🔥🔥🇺🇸🇺🇸🇺🇸";
          }
        }

        if(mode === "british"){
          displayName = `${displayName} innit`;
          if(sendContent){
            const britishSwaps = [
              // American vocab → British vocab
              [/\btrash\b/gi,"rubbish"],[/\bgarbage\b/gi,"rubbish"],[/\bjunk\b/gi,"rubbish"],
              [/\belevator\b/gi,"lift"],[/\bapartment\b/gi,"flat"],[/\bcondo\b/gi,"flat"],
              [/\bcookies\b/gi,"biscuits"],[/\bcandy\b/gi,"sweets"],[/\bchocolate bar\b/gi,"chocolate bar"],
              [/\bchips\b/gi,"crisps"],[/\bfries\b/gi,"chips"],[/\bfrench fries\b/gi,"chips"],
              [/\bcell phone\b/gi,"mobile"],[/\bphone\b/gi,"mobile"],[/\bsidewalk\b/gi,"pavement"],
              [/\bgas\b/gi,"petrol"],[/\btrunk\b/gi,"boot"],[/\bhood\b/gi,"bonnet"],
              [/\bdiaper\b/gi,"nappy"],[/\bvacation\b/gi,"holiday"],[/\bmath\b/gi,"maths"],
              [/\bfreeway\b/gi,"motorway"],[/\bhighway\b/gi,"motorway"],[/\bsoccer\b/gi,"football"],
              [/\bstore\b/gi,"shop"],[/\bsupermarket\b/gi,"Tesco"],[/\bgrocery store\b/gi,"Tesco"],
              [/\bsneakers\b/gi,"trainers"],[/\btennis shoes\b/gi,"trainers"],[/\bshoes\b/gi,"trainers"],
              [/\bpants\b/gi,"trousers"],[/\bunderwear\b/gi,"pants"],[/\bboxers\b/gi,"pants"],
              [/\bjacket\b/gi,"jumper"],[/\bsweater\b/gi,"jumper"],[/\bhoodie\b/gi,"hoodie"],
              [/\bsub\b/gi,"sarnie"],[/\bsandwich\b/gi,"sarnie"],[/\bwrap\b/gi,"sarnie"],
              [/\bfries\b/gi,"chips"],[/\bketchup\b/gi,"tomato sauce"],[/\bbeer\b/gi,"lager"],
              [/\bdrunk\b/gi,"bladdered"],[/\bwasted\b/gi,"absolutely munted"],[/\btipsy\b/gi,"squiffy"],
              [/\bbar\b/gi,"pub"],[/\bclub\b/gi,"nightclub"],[/\bparty\b/gi,"do"],
              [/\brestaurant\b/gi,"restaurant"],[/\btakeout\b/gi,"takeaway"],[/\btakeaway\b/gi,"takeaway"],
              [/\bpizza\b/gi,"pizza"],[/\bmeal\b/gi,"tea"],[/\bdinner\b/gi,"tea"],[/\blunch\b/gi,"dinner"],
              [/\bbreakfast\b/gi,"brekkie"],[/\bcoffee\b/gi,"cuppa"],[/\btea\b/gi,"cuppa"],
              // Adjectives
              [/\bdumb\b/gi,"daft"],[/\bstupid\b/gi,"daft"],[/\bidiot\b/gi,"muppet"],
              [/\bcrazy\b/gi,"mental"],[/\binsane\b/gi,"absolutely mental"],[/\bwild\b/gi,"mental"],
              [/\bcool\b/gi,"brilliant"],[/\bawesome\b/gi,"dead brilliant"],[/\bamazing\b/gi,"well good"],
              [/\bgreat\b/gi,"proper"],[/\bgood\b/gi,"sound"],[/\bfine\b/gi,"alright"],
              [/\bbad\b/gi,"rubbish"],[/\bterrible\b/gi,"absolute mince"],[/\bawful\b/gi,"dreadful"],
              [/\bgross\b/gi,"minging"],[/\bdisgusting\b/gi,"absolutely minging"],[/\bsick\b/gi,"well dodgy"],
              [/\bweird\b/gi,"well dodgy"],[/\bsketchy\b/gi,"dodgy"],[/\bshady\b/gi,"well dodgy"],
              [/\btired\b/gi,"knackered"],[/\bexhausted\b/gi,"absolutely knackered"],[/\bbored\b/gi,"bored off me head"],
              [/\bangry\b/gi,"well narked"],[/\bfurious\b/gi,"absolutely livid"],[/\bupset\b/gi,"proper gutted"],
              [/\bhappy\b/gi,"chuffed"],[/\bexcited\b/gi,"dead chuffed"],[/\bproud\b/gi,"well chuffed"],
              [/\bscared\b/gi,"bricking it"],[/\bterrified\b/gi,"absolutely bricking it"],[/\bnervous\b/gi,"proper bricking it"],
              [/\bconfused\b/gi,"proper muddled"],[/\blost\b/gi,"all at sea"],[/\bstuck\b/gi,"proper stuck"],
              [/\bbig\b/gi,"massive"],[/\bhuge\b/gi,"absolutely massive"],[/\btiny\b/gi,"wee"],
              [/\bsmall\b/gi,"wee"],[/\ba lot\b/gi,"loads"],[/\bmany\b/gi,"loads of"],
              [/\bvery\b/gi,"dead"],[/\breally\b/gi,"proper"],[/\bso\b/gi,"well"],
              [/\bactually\b/gi,"to be fair"],[/\bhonestly\b/gi,"hand on heart"],[/\bbasically\b/gi,"right so"],
              // Nouns (people)
              [/\bguy\b/gi,"bloke"],[/\bdude\b/gi,"geezer"],[/\bman\b/gi,"lad"],
              [/\bfriend\b/gi,"mate"],[/\bbuddy\b/gi,"mate"],[/\bpal\b/gi,"mate"],
              [/\bgirl\b/gi,"lass"],[/\bwoman\b/gi,"bird"],[/\bwife\b/gi,"missus"],
              [/\bgirlfriend\b/gi,"missus"],[/\bboyfriend\b/gi,"fella"],[/\bhusband\b/gi,"fella"],
              [/\bboss\b/gi,"gaffer"],[/\bkid\b/gi,"nipper"],[/\bchild\b/gi,"nipper"],
              [/\bbaby\b/gi,"bairn"],[/\bgrandma\b/gi,"nan"],[/\bgrandpa\b/gi,"grandad"],
              [/\bmom\b/gi,"mum"],[/\bdad\b/gi,"dad"],[/\bbrother\b/gi,"bruv"],[/\bsis\b/gi,"sis"],
              // Verbs / phrases
              [/\bokay\b/gi,"alright"],[/\bok\b/gi,"alright"],[/\byes\b/gi,"aye"],[/\byeah\b/gi,"aye"],
              [/\bno\b/gi,"nah"],[/\bnope\b/gi,"nah mate"],[/\bsure\b/gi,"go on then"],
              [/\bwhat\b/gi,"pardon"],[/\bhuh\b/gi,"eh"],[/\bwhy\b/gi,"how come"],
              [/\bseriously\b/gi,"blimey"],[/\bwow\b/gi,"cor blimey"],[/\bomg\b/gi,"bloody hell"],
              [/\bwtf\b/gi,"what in the bloody hell"],[/\blol\b/gi,"ha"],[/\blmao\b/gi,"hahahaha"],
              [/\bbye\b/gi,"cheerio"],[/\bgoodbye\b/gi,"cheerio"],[/\bsee ya\b/gi,"ta-ra"],
              [/\bhello\b/gi,"alright"],[/\bhi\b/gi,"alright"],[/\bhey\b/gi,"oi oi"],
              [/\bsorry\b/gi,"sorry mate"],[/\bthanks\b/gi,"cheers"],[/\bthank you\b/gi,"cheers"],
              [/\bplease\b/gi,"go on"],[/\bhelp\b/gi,"sort out"],[/\bfix\b/gi,"sort out"],
              [/\bgo\b/gi,"crack on"],[/\bstart\b/gi,"crack on"],[/\bstop\b/gi,"pack it in"],
              [/\bshut up\b/gi,"do one"],[/\bget out\b/gi,"do one"],[/\bleave\b/gi,"do one"],
              [/\bmess up\b/gi,"cock up"],[/\bscrew up\b/gi,"cock up"],[/\bfailed\b/gi,"cocked it up"],
              [/\bsleep\b/gi,"kip"],[/\bnap\b/gi,"kip"],[/\bwork\b/gi,"graft"],[/\bjob\b/gi,"graft"],
              [/\bsteal\b/gi,"nick"],[/\btook\b/gi,"nicked"],[/\btook it\b/gi,"nicked it"],
              [/\bhit\b/gi,"lamp"],[/\bpunch\b/gi,"lamp"],[/\bfight\b/gi,"ruck"],
              [/\bnot sure\b/gi,"dunno"],[/\bI don't know\b/gi,"dunno"],[/\bidk\b/gi,"dunno"],
              [/\bthat's right\b/gi,"innit"],[/\bexactly\b/gi,"innit"],[/\bfor sure\b/gi,"dead right"],
              [/\bI think\b/gi,"reckon"],[/\bI believe\b/gi,"reckon"],[/\bmaybe\b/gi,"might do"],
              [/\bcan't\b/gi,"can't be arsed"],[/\bwon't\b/gi,"ain't gonna"],[/\bdon't\b/gi,"ain't"],
              [/\bI am\b/gi,"I'm"],[/\bI'm going\b/gi,"I'm off"],[/\bI'm leaving\b/gi,"I'm off"],
              [/\bneed to\b/gi,"need to sort"],[/\bhave to\b/gi,"gotta"],
              [/\bwait\b/gi,"hang on"],[/\bhold on\b/gi,"hang on a sec"],
              [/\bcome on\b/gi,"get a move on"],[/\bhurry\b/gi,"get a shift on"],
              [/\bnonsense\b/gi,"bollocks"],[/\bBS\b/g,"bollocks"],[/\blies\b/gi,"absolute bollocks"],
              [/\bproblem\b/gi,"faff"],[/\bissue\b/gi,"faff"],[/\bmess\b/gi,"shambles"],
              [/\bhe's\b/gi,"he's"],[/\bshe's\b/gi,"she's"],[/\bthey're\b/gi,"they're"],
              [/\bI've\b/gi,"I've"],[/\bwe've\b/gi,"we've"],[/\byou've\b/gi,"you've"],
            ];
            let t = sendContent;
            for(const [from, to] of britishSwaps) t = t.replace(from, to);
            const signoffs = [" innit bruv"," cheers mate"," bloody hell"];
            sendContent = t + signoffs[Math.floor(Math.random() * signoffs.length)];
          }
        }

        if(mode === "stupid"){
          displayName = `${displayName}`;
          if(sendContent){
            // Apply heavy typo + slurring transforms
            const slurMap = [
              [/th/gi,"d"],[/ing\b/gi,"in"],[/tion\b/gi,"shun"],
              [/er\b/gi,"ah"],[/or\b/gi,"ur"],[/are\b/gi,"r"],
              [/you\b/gi,"u"],[/your\b/gi,"ur"],[/the\b/gi,"da"],
              [/that\b/gi,"dat"],[/this\b/gi,"dis"],[/what\b/gi,"wut"],
              [/because\b/gi,"cuz"],[/with\b/gi,"wif"],[/s\b/gi,"z"],
              [/for\b/gi,"fer"],[/is\b/gi,"iz"],[/of\b/gi,"ov"],
              [/my\b/gi,"mah"],[/me\b/gi,"meh"],[/I\b/g,"i"],
            ];
            let t = sendContent;
            for(const [from, to] of slurMap) t = t.replace(from, to);
            // Randomly swap letters to add typos
            t = t.split("").map(ch => {
              if(/[a-zA-Z]/.test(ch) && Math.random() < 0.12){
                const near = {a:"qs",b:"vn",c:"xv",d:"sf",e:"wr",f:"gd",g:"fh",h:"gj",i:"uo",j:"hk",k:"jl",l:"ko",m:"n",n:"mb",o:"ip",p:"ol",q:"wa",r:"et",s:"ad",t:"ry",u:"yi",v:"bc",w:"qe",x:"zc",y:"tu",z:"xa"};
                const opts = near[ch.toLowerCase()] || "e";
                return opts[Math.floor(Math.random() * opts.length)];
              }
              return ch;
            }).join("");
            // Double some letters randomly (stuttering)
            t = t.replace(/[bcdfgklmnprstvwyz]/gi, ch => Math.random() < 0.08 ? ch+ch : ch);
            sendContent = t;
          }
        }

        if(mode === "boomer"){
          displayName = `${displayName} (Bob's dad)`;
          if(sendContent){
            // Boomer-ify the message
            const boomerSwaps = [
              [/lol\b/gi,"LOL (laugh out loud)"],[/omg\b/gi,"OH MY GOD"],
              [/btw\b/gi,"by the way"],[/idk\b/gi,"I don't know"],
              [/ngl\b/gi,"not gonna lie"],[/imo\b/gi,"in my opinion"],
              [/tbh\b/gi,"to be honest"],[/smh\b/gi,"shaking my head"],
              [/fr\b/gi,"for real"],[/npc\b/gi,"robot person"],
              [/based\b/gi,"sensible"],[/cringe\b/gi,"embarrassing"],
              [/slay\b/gi,"good job"],[/lowkey\b/gi,"secretly"],
              [/vibe\b/gi,"feeling"],[/sus\b/gi,"suspicious"],
              [/no cap\b/gi,"and I mean that"],[/cap\b/gi,"lie"],
            ];
            let t = sendContent;
            for(const [from, to] of boomerSwaps) t = t.replace(from, to);
            // Random boomer outro
            const outros = [
              " Anyway, have you tried turning it off and on again? 📧",
              " I'll have to ask my grandson about this. 🖥️",
              " Back in MY day we didn't have this nonsense. 📰",
              " I'm going to need you to explain this like I'm 5. 🤷",
              " This is why I prefer a phone call. ☎️",
              " Make sure to LIKE and SUBSCRIBE!! 👍",
              " Is this the Reddit? 🖱️",
              " Forwarding this to the group chat. 📲",
              " I don't understand why young people today... 😤",
            ];
            sendContent = t + outros[Math.floor(Math.random() * outros.length)];
          }
        }
        if(mode === "conspiracy"){
          displayName = `🔺 ${displayName} [AWAKE]`;
          if(sendContent){
            const theories = [
              " (the government doesn't want you to know this)",
              " — wake up sheeple 🐑",
              " and THAT'S why they took down the old internet",
              " — do your own research before they delete this",
              " (they're putting something in the water btw)",
              " — the moon isn't real btw just saying",
              " — big pharma is shaking rn",
              " and the lizard people are FURIOUS about it",
            ];
            const prefixes = [
              "okay so nobody is talking about this but ",
              "THEY don't want you to know: ",
              "i've been doing research and ",
              "follow the money: ",
              "connect the dots people — ",
              "sources won't say this but trust me: ",
            ];
            sendContent = prefixes[Math.floor(Math.random()*prefixes.length)] + sendContent + theories[Math.floor(Math.random()*theories.length)];
          }
        }

        if(mode === "npc"){
          displayName = `${displayName} [NPC #${Math.floor(Math.random()*9999)+1}]`;
          if(sendContent){
            const npcPhrases = [
              "Have you tried the items at the general store?",
              "I used to be an adventurer like you...",
              "Ah, a traveler! These are dark times.",
              "The crops have been struggling this season.",
              "I heard there's trouble at the old mill.",
              "You didn't hear this from me, but...",
              "Quest updated: Talk to the village elder.",
              "My knee hurts when it's about to rain.",
              "Strange things have been happening in the forest.",
              "Can't stop now, got places to be. Same places as yesterday.",
            ];
            sendContent = npcPhrases[Math.floor(Math.random()*npcPhrases.length)];
          } else {
            const idle = ["...", "*stares into the distance*", "*sweeping noises*", "*coughs*", "..."];
            sendContent = idle[Math.floor(Math.random()*idle.length)];
          }
        }

        if(mode === "sigma"){
          displayName = `Σ ${displayName}`;
          if(sendContent){
            const sigmaSwaps = [
              [/\bi\b/gi,"the sigma"], [/\bme\b/gi,"the sigma"],
              [/\bmy\b/gi,"the sigma's"], [/\bwe\b/gi,"the pack"],
              [/\byou\b/gi,"fellow grindset individual"],
              [/\bfriend\b/gi,"business associate"],
              [/\blove\b/gi,"strategically value"],
              [/\bsleep\b/gi,"recharge my grindset"],
              [/\beat\b/gi,"fuel the sigma body"],
              [/\bwork\b/gi,"the grindset"],
              [/\bgame\b/gi,"the hustle"],
              [/\bhelp\b/gi,"provide value to"],
              [/\bfun\b/gi,"optimal recreation"],
              [/\bmoney\b/gi,"resources"],
            ];
            let t = sendContent;
            for(const [from, to] of sigmaSwaps) t = t.replace(from, to);
            const outros = [
              " — no cap, stay sigma.",
              " — the grindset never stops.",
              " — lions don't lose sleep over sheep.",
              " — emotionless. strategic. inevitable.",
              " — your mindset is your weapon. sharpen it.",
              " — hustle in silence. let the results speak.",
            ];
            sendContent = t + outros[Math.floor(Math.random()*outros.length)];
          }
        }

        if(mode === "medieval"){
          displayName = `Sir ${displayName} of the Realm`;
          if(sendContent){
            const medievalSwaps = [
              [/\byou\b/gi,"thee"],[/\byour\b/gi,"thy"],[/\bthe\b/gi,"ye"],
              [/\bare\b/gi,"art"],[/\bis\b/gi,"ist"],[/\bhave\b/gi,"hast"],
              [/\bdo\b/gi,"dost"],[/\bwill\b/gi,"shalt"],[/\bcan\b/gi,"canst"],
              [/\bwhat\b/gi,"what manner of"],[/\bwhy\b/gi,"for what reason dost"],
              [/\byes\b/gi,"verily"],[/\bno\b/gi,"nay"],[/\bhi\b/gi,"hail"],
              [/\bhello\b/gi,"good morrow"],[/\bokay\b/gi,"very well, m'lord"],
              [/\bsorry\b/gi,"I beseech thy forgiveness"],[/\bgood\b/gi,"most virtuous"],
              [/\bbad\b/gi,"most foul"],[/\bcool\b/gi,"most gallant"],
              [/\bfriend\b/gi,"loyal companion"],[/\benemy\b/gi,"most wretched knave"],
              [/\bgo\b/gi,"make haste"],[/\bcome\b/gi,"approach"],
              [/\bhelp\b/gi,"render aid unto"],[/\bpls\b/gi,"I prithee"],
              [/\bplease\b/gi,"prithee"],[/\bomg\b/gi,"by the saints"],
              [/\blol\b/gi,"*hearty laughter doth fill the great hall*"],
            ];
            let t = sendContent;
            for(const [from, to] of medievalSwaps) t = t.replace(from, to);
            const closings = [
              " — so it is written, so it shall be done. ⚔️",
              " — hear ye, hear ye! 📯",
              " — upon mine honour. 🛡️",
              " — God save the king! 👑",
              " — fare thee well, traveler. 🏰",
            ];
            sendContent = t + closings[Math.floor(Math.random()*closings.length)];
          }
        }

        if(mode === "ghost"){
          displayName = `👻 ${displayName}'s Ghost`;
          if(sendContent){
            const hauntings = [
              "...you won't believe what happened to me. I died. anyway — ",
              "speaking from beyond the grave: ",
              "the living still don't know but — ",
              "[ghostly wailing] ...sorry. anyway — ",
              "i have UNFINISHED BUSINESS and it is: ",
            ];
            const ghostOutros = [
              " ...tell my family i said hey 👻",
              " ...the cold spot in the room? that's me. sorry.",
              " ...i keep moving the furniture and nobody notices.",
              " ...death is just like life but quieter and colder.",
              " ...anyway i gotta go haunt the basement. later.",
              " ...RIP me btw 💀 (literally)",
            ];
            sendContent = hauntings[Math.floor(Math.random()*hauntings.length)] + sendContent + ghostOutros[Math.floor(Math.random()*ghostOutros.length)];
          } else {
            const spooks = ["*rattles chains*","*knocks something off the shelf*","*breathes coldly*","*appears in mirror for 0.3 seconds*"];
            sendContent = spooks[Math.floor(Math.random()*spooks.length)];
          }
        }

        // ── End mode transforms ────────────────────────────────────────────────

        // Get or create a webhook for this channel
        const webhooks = await msg.channel.fetchWebhooks().catch(()=>null);
        let webhook    = webhooks?.find(w => w.owner?.id === CLIENT_ID && w.name === "RoyalBot Proxy");
        if(!webhook){
          webhook = await msg.channel.createWebhook("RoyalBot Proxy", { avatar: avatarURL }).catch(()=>null);
        }
        if(!webhook) return; // no permission to create webhooks

        const sendOpts = { username: displayName, avatarURL, allowedMentions: { parse: [] } };
        if(sendContent)       sendOpts.content = sendContent;
        if(attachUrls.length) sendOpts.files   = attachUrls;
        // If only stickers (no content/attachments), send sticker names as text
        if(!sendContent && !attachUrls.length && stickers.length){
          sendOpts.content = stickers.map(n => `[Sticker: ${n}]`).join(" ");
        }
        if(sendOpts.content || sendOpts.files) await webhook.send(sendOpts).catch(()=>{});
      } catch(e){ console.error("clankerify error:", e.message); }
      return; // skip XP etc. for clankerified messages
    }
  }
  const newLevel=tryAwardXP(msg.author.id,msg.author.username);
  if(newLevel){
    const luc = levelUpConfig.get(msg.guild.id);
    const enabled = luc ? luc.enabled : !disabledLevelUp.has(msg.guild.id);
    if(enabled){
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
          getScore(msg.author.id,msg.author.username).coins+=CONFIG.win_countgame;
          saveData();
          await msg.react("🎉").catch(()=>{});
          await safeSend(msg.channel,`🎉 **100!** <@${msg.author.id}> got the final count and wins **${CONFIG.win_countgame} coins**! The count game is over.`);
        }else{await msg.react("✅").catch(()=>{});}
      }else{
        const was=cg.count;cg.count=0;cg.lastUserId=null;
        await msg.react("❌").catch(()=>{});
        await safeSend(msg.channel,`❌ <@${msg.author.id}> said **${num}** but expected **${was+1}**! Back to **0**.`);
      }
    }
  }

  // ── Permanent counting channel ────────────────────────────────────────────
  const cc=countingChannels.get(msg.channelId);
  if(cc){
    const trimmed=msg.content.trim();
    const num=parseInt(trimmed);
    // Only process pure integer messages — ignore anything else silently
    if(!isNaN(num)&&/^-?\d+$/.test(trimmed)){
      if(msg.author.id===cc.lastUserId){
        // Double count — reset and commit immediately
        cc.count=0;cc.lastUserId=null;
        saveDataAndCommitNow().catch(()=>{});
        await msg.react("❌").catch(()=>{});
        await safeSend(msg.channel,`<@${msg.author.id}> messed the counting up! Shame on them! Start from zero.`);
      }else if(num===cc.count+1){
        // Correct — save to disk immediately, commit debounced
        cc.count++;cc.lastUserId=msg.author.id;
        if(cc.count>(cc.highScore||0)){cc.highScore=cc.count;}
        saveData();
        await msg.react("✅").catch(()=>{});
      }else{
        // Wrong number — reset and commit immediately
        cc.count=0;cc.lastUserId=null;
        saveDataAndCommitNow().catch(()=>{});
        await msg.react("❌").catch(()=>{});
        await safeSend(msg.channel,`<@${msg.author.id}> messed the counting up! Shame on them! Start from zero.`);
      }
    }
  }
});

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

    // ── Clankerify mode selection ─────────────────────────────────────────────
    if(cid.startsWith("clankerify_mode_")){
      // Only the owner who triggered the command can use this dropdown
      if(!OWNER_IDS.includes(uid)){
        try{await interaction.reply({content:"Not for you.",ephemeral:true});}catch{}
        return;
      }
      // customId format: clankerify_mode_{targetId}_{duration|"perm"}
      const parts    = cid.split("_");
      // parts: ["clankerify","mode",targetId,durKey]
      const targetId = parts[2];
      const durKey   = parts[3];
      const duration = durKey === "perm" ? null : parseInt(durKey, 10);
      const mode     = interaction.values[0] === "none" ? null : interaction.values[0];

      const expiresAt = duration ? Date.now() + duration * 60_000 : null;
      clankerify.set(targetId, { expiresAt, mode });
      saveData();

      // Auto-remove when timer fires
      if(expiresAt){
        setTimeout(() => {
          clankerify.delete(targetId);
          saveData();
        }, duration * 60_000);
      }

      const durationStr = duration ? `**${duration} minute(s)**` : "**permanently**";
      const modeStr     = mode ? ` in **${mode.charAt(0).toUpperCase()+mode.slice(1)}** mode` : "";
      try{
        await interaction.update({
          content:`🤖 <@${targetId}> has been clankerified ${durationStr}${modeStr}. Their messages will be deleted and resent as a webhook.`,
          components:[]
        });
      }catch{}
      return;
    }

    // ── Activity check role selection ─────────────────────────────────────────
    if(cid.startsWith("ac_required_")||cid.startsWith("ac_excluded_")){
      if(!interaction.client._acPending) interaction.client._acPending = new Map();
      const pending = interaction.client._acPending.get(interaction.user.id);
      if(!pending){ try{await interaction.reply({content:"Session expired. Run /activity-check again.",ephemeral:true});}catch{}return; }

      const isRequired = cid.startsWith("ac_required_");
      const selected = interaction.values;

      if(isRequired) pending.requiredIds = selected;
      else           pending.excludedIds = selected;

      interaction.client._acPending.set(interaction.user.id, pending);

      // If both have been touched, show a Send button
      const readyToSend = pending.requiredIds.length > 0;
      const reqNames  = pending.requiredIds.map(id=>interaction.guild.roles.cache.get(id)?.name||id).join(", ")||"none";
      const exclNames = pending.excludedIds.map(id=>interaction.guild.roles.cache.get(id)?.name||id).join(", ")||"none (RA/LOA always excluded)";

      const sendBtn = new MessageActionRow().addComponents(
        new MessageButton().setCustomId("ac_send_"+interaction.user.id).setLabel("Send Activity Check").setStyle("SUCCESS").setDisabled(!readyToSend)
      );

      try {
        await interaction.update({
          content:[
            `📋 **Activity Check Setup**`,
            `✅ Required roles: **${reqNames}**`,
            `🚫 Excluded roles: **${exclNames}**`,
            readyToSend ? `\nClick **Send Activity Check** when ready.` : `\nSelect at least one required role first.`
          ].join("\n"),
          components:[...interaction.message.components.slice(0,2), sendBtn]
        });
      } catch{}
      return;
    }

    if(cid.startsWith("ac_send_")){
      const userId = cid.slice(8);
      if(interaction.user.id !== userId){ try{await interaction.reply({content:"Not your activity check.",ephemeral:true});}catch{}return; }
      if(!interaction.client._acPending) interaction.client._acPending = new Map();
      const pending = interaction.client._acPending.get(userId);
      if(!pending){ try{await interaction.reply({content:"Session expired. Run /activity-check again.",ephemeral:true});}catch{}return; }
      interaction.client._acPending.delete(userId);

      const { channel, deadlineHr, customMsg, doPing, requiredIds, excludedIds, parsedSchedule, scheduleStr } = pending;
      const cfg = raConfig.get(interaction.guildId)||{};
      const autoExcluded = [cfg.raRoleId, cfg.loaRoleId].filter(Boolean);
      const allExcluded  = [...new Set([...excludedIds, ...autoExcluded])];

      const deadlineTs   = Math.floor((Date.now()+deadlineHr*3600000)/1000);
      const roleMentions = requiredIds.map(id=>`<@&${id}>`).join(", ");
      const pingText     = doPing ? requiredIds.map(id=>`<@&${id}>`).join(" ")+"\n" : "";

      const msgContent = [
        pingText,
        `📋 **Activity Check**`,
        ``,
        customMsg||"React with ✅ to confirm you're active!",
        ``,
        `**Required roles:** ${roleMentions}`,
        `**Deadline:** <t:${deadlineTs}:R> (<t:${deadlineTs}:f>)`,
        ``,
        `React below with ✅ to check in.`
      ].join("\n");

      try { await interaction.update({content:"✅ Sending activity check…",components:[]}); } catch{}

      let sentMsg;
      try {
        sentMsg = await safeSend(channel, msgContent);
        if(!sentMsg) return;
        await sentMsg.react("✅");
      } catch(e) {
        await interaction.followUp({content:`❌ Failed to send: ${e.message}`,ephemeral:true}).catch(()=>{});
        return;
      }

      activityChecks.set(sentMsg.id,{
        guildId:    interaction.guildId,
        channelId:  channel.id,
        roleIds:    requiredIds,
        excludedIds: allExcluded,
        deadline:   Date.now()+deadlineHr*3600000,
        messageId:  sentMsg.id,
      });

      // If a recurring schedule was requested, save it now that we have the final role sets
      if (parsedSchedule) {
        const scKey = `${interaction.guildId}:${channel.id}`;
        scheduledChecks.set(scKey, {
          guildId:     interaction.guildId,
          channelId:   channel.id,
          dayOfWeek:   parsedSchedule.dayOfWeek,
          hour:        parsedSchedule.hour,
          minute:      parsedSchedule.minute,
          deadlineHr,
          customMsg,
          doPing,
          roleIds:     requiredIds,
          excludedIds: allExcluded,
          scheduleStr,
        });
      }

      saveData();

      setTimeout(async()=>{
        const check = activityChecks.get(sentMsg.id);
        if(!check) return;
        activityChecks.delete(sentMsg.id);
        saveData();

        let reacted = new Set();
        try {
          const freshMsg = await channel.messages.fetch(sentMsg.id);
          const reaction = freshMsg.reactions.cache.get("✅");
          if(reaction){
            const users = await reaction.users.fetch();
            users.forEach(u=>{ if(!u.bot) reacted.add(u.id); });
          }
        } catch(e){ console.error("activity-check fetch error:",e); }

        let missing = [];
        try {
          const members = await interaction.guild.members.fetch();
          members.forEach(m=>{
            if(m.user.bot) return;
            const hasRequired = check.roleIds.some(rid=>m.roles.cache.has(rid));
            if(!hasRequired) return;
            const isExcluded = check.excludedIds.some(rid=>m.roles.cache.has(rid));
            if(isExcluded) return;
            if(!reacted.has(m.id)) missing.push(`<@${m.id}>`);
          });
        } catch(e){ console.error("activity-check member fetch error:",e); }

        const respondedCount = reacted.size;
        const missingText = missing.length ? missing.join(", ") : "None — everyone checked in! ✅";

        await safeSend(channel,[
          `📋 **Activity Check Closed**`,
          ``,
          `✅ **Checked in:** ${respondedCount} member${respondedCount!==1?"s":""}`,
          `❌ **Did not respond:** ${missingText}`,
        ].join("\n")).catch(()=>{});
      }, deadlineHr*3600000);

      return;
    }

    // ── Marriage proposal accept/decline ──────────────────────────────────────
    if(cid.startsWith("marry_accept_")||cid.startsWith("marry_decline_")){
      // customId format: marry_accept_{proposerId}_{targetId}
      const isAccept = cid.startsWith("marry_accept_");
      const parts = (isAccept ? cid.slice(13) : cid.slice(14)).split("_");
      const proposerId = parts[0];
      const targetId   = parts[1];

      // Only the intended target can respond
      if(uid !== targetId){
        try{await interaction.reply({content:"This proposal isn't for you!",ephemeral:true});}catch{}
        return;
      }

      const proposerScore = getScore(proposerId, null);
      const targetScore   = getScore(targetId, null);

      // Verify the proposal is still pending
      if(targetScore.pendingProposal !== proposerId){
        try{await interaction.reply({content:"This proposal has already expired or been resolved.",ephemeral:true});}catch{}
        return;
      }

      if(!(await btnAck(interaction)))return;

      if(isAccept){
        if(proposerScore.marriedTo){
          targetScore.pendingProposal = null;
          saveData();
          try{await interaction.editReply({content:`💔 The proposal can no longer be accepted — the proposer is already married to someone else.`,components:[]});}catch{}
          return;
        }
        if(targetScore.marriedTo){
          targetScore.pendingProposal = null;
          saveData();
          try{await interaction.editReply({content:`💔 You are already married to someone else!`,components:[]});}catch{}
          return;
        }
        proposerScore.marriedTo       = targetId;
        targetScore.marriedTo         = proposerId;
        targetScore.pendingProposal   = null;
        saveData();
        try{await interaction.editReply({content:`💍 **${interaction.user.username}** said YES! 🎉\n<@${proposerId}> and <@${targetId}> are now married! Congratulations! 💕`,components:[]});}catch{}
      } else {
        targetScore.pendingProposal = null;
        saveData();
        try{await interaction.editReply({content:`💔 **${interaction.user.username}** declined the proposal. Maybe next time, <@${proposerId}>.`,components:[]});}catch{}
      }
      return;
    }
    // ── Library navigation ────────────────────────────────────────────────────
    if(cid.startsWith("lib_")){
      // customId: lib_prev_{targetUserId}_{currentIndex} or lib_next_{...}
      const parts = cid.split("_"); // ["lib","prev"|"next", userId, index]
      const dir = parts[1];
      const targetUserId = parts[2];
      const currentIdx = parseInt(parts[3]);
      const targetScore = getScore(targetUserId, null);
      const files = targetScore.uploadedImages || [];
      if(!files.length){ try{await interaction.reply({content:"No images found.",ephemeral:true});}catch{}return; }
      const newIdx = dir==="prev" ? Math.max(0,currentIdx-1) : Math.min(files.length-1,currentIdx+1);
      const fileName = files[newIdx];
      const imageUrl = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(fileName)}`;
      const targetUser = await client.users.fetch(targetUserId).catch(()=>null);
      const displayName = targetUser?.username || "Unknown";
      const row = new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`lib_prev_${targetUserId}_${newIdx}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(newIdx===0),
        new MessageButton().setCustomId(`lib_next_${targetUserId}_${newIdx}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(newIdx===files.length-1),
      );
      try{
        await interaction.update({
          content:`🖼️ **${displayName}'s Library** — Image ${newIdx+1} of ${files.length}\n**\`${fileName}\`**\n${imageUrl}`,
          components:[row]
        });
      }catch{}
      return;
    }

    // ── Quote manager navigation & delete buttons ─────────────────────────────
    if(cid.startsWith("qm_")){
      if(!OWNER_IDS.includes(uid)){ await btnEphemeral(interaction,"Owner only."); return; }

      // Delete button: qm_delete_{filename}
      if(cid.startsWith("qm_delete_")){
        const fileName = cid.slice(10);
        if(!(await btnAck(interaction))) return;
        try {
          const ghPath = `quotes/${fileName}`;
          const checkRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
            headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
          });
          if(!checkRes.ok){ await interaction.followUp({content:`❌ File not found or GitHub error (HTTP ${checkRes.status}).`,ephemeral:true}); return; }
          const fileData = await checkRes.json();
          const sha = fileData.sha;
          const delRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
            method:"DELETE",
            headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json","Content-Type":"application/json"},
            body: JSON.stringify({message:`chore: delete quote image ${fileName} via Discord`,sha})
          });
          if(!delRes.ok){ await interaction.followUp({content:`❌ GitHub delete failed (HTTP ${delRes.status}).`,ephemeral:true}); return; }
          // Clean from user libraries
          for(const [,s] of scores){
            if(Array.isArray(s.uploadedImages)&&s.uploadedImages.includes(fileName))
              s.uploadedImages = s.uploadedImages.filter(n=>n!==fileName);
          }
          saveData();
          try { await interaction.editReply({content:`🗑️ \`${fileName}\` deleted. Use \`/quotemanage\` to continue browsing.`,components:[]}); } catch{}
        } catch(e) {
          console.error("qm_delete error:",e);
          await interaction.followUp({content:"❌ Something went wrong during deletion.",ephemeral:true}).catch(()=>{});
        }
        return;
      }

      // Prev/Next buttons: qm_prev_{currentIdx} or qm_next_{currentIdx}_{total}
      const parts_qm = cid.split("_");
      const dir_qm   = parts_qm[1]; // "prev" or "next"
      const curIdx   = parseInt(parts_qm[2]);
      if(!(await btnAck(interaction))) return;
      try {
        const listRes = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes",{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        if(!listRes.ok){ await interaction.followUp({content:`❌ GitHub API error (HTTP ${listRes.status}).`,ephemeral:true}); return; }
        const files_qm = (await listRes.json()).filter(f=>f.type==="file"&&/\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if(!files_qm.length){ await interaction.editReply({content:"📭 No images left in the quotes folder.",components:[]}); return; }
        const newIdx_qm = dir_qm==="prev" ? Math.max(0,curIdx-1) : Math.min(files_qm.length-1,curIdx+1);
        const file_qm = files_qm[newIdx_qm];
        const imageUrl_qm = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(file_qm.name)}`;
        const navRow_qm = new MessageActionRow().addComponents(
          new MessageButton().setCustomId(`qm_prev_${newIdx_qm}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(newIdx_qm===0),
          new MessageButton().setCustomId(`qm_next_${newIdx_qm}_${files_qm.length}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(newIdx_qm>=files_qm.length-1),
          new MessageButton().setCustomId(`qm_delete_${file_qm.name}`).setLabel("🗑️ Delete This").setStyle("DANGER"),
        );
        await interaction.editReply({
          content:`🖼️ **Quote Manager** — ${newIdx_qm+1} of ${files_qm.length}\n\`${file_qm.name}\`\n${imageUrl_qm}`,
          components:[navRow_qm],
        });
      } catch(e) {
        console.error("qm nav error:",e);
        await interaction.followUp({content:"❌ Something went wrong.",ephemeral:true}).catch(()=>{});
      }
      return;
    }

    if(cid.startsWith("hm_")){
      const letter=cid.slice(3);
      const gd=activeGames.get(interaction.channelId);
      if(!gd||gd.type!=="hangman"){ try{await interaction.reply({content:"No active hangman game.",ephemeral:true});}catch{}return;}
      if(gd.playerId!==uid){ try{await interaction.reply({content:"Not your game!",ephemeral:true});}catch{}return;}
      if(!(await btnAck(interaction)))return;
      gd.guessed.add(letter);
      const wrong=[...gd.guessed].filter(l=>!gd.word.includes(l));
      const won=!gd.word.split("").some(l=>!gd.guessed.has(l));
      if(won){activeGames.delete(interaction.channelId);recordWin(uid,interaction.user.username,CONFIG.win_hangman);saveData();try{await interaction.editReply({content:`✅ **Got it!** Word was **${gd.word}**! 🎉 (+${CONFIG.win_hangman} coins)\n\n${renderHangman(gd.word,gd.guessed)}`,components:makeHangmanButtons(gd.word,gd.guessed,true)});}catch{}}
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
      if(result!=="ok"){activeGames.delete(interaction.channelId);const coins=gd.score*CONFIG.win_snake_per_point;if(coins>0)getScore(uid,interaction.user.username).coins+=coins;recordLoss(uid,interaction.user.username);saveData();try{await interaction.editReply({content:`💀 **Game Over!** Score: **${gd.score}**${coins>0?` (+${coins} coins)`:""}\n\n${renderSnake(gd)}`,components:makeSnakeButtons(true)});}catch{}}
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
      const mineCount=g.mineCount||{easy:3,medium:6,hard:10}[gd.diff||"easy"];
      const reward={easy:CONFIG.win_minesweeper_easy,medium:CONFIG.win_minesweeper_medium,hard:CONFIG.win_minesweeper_hard}[gd.diff||"easy"];
      try{
        // First click: place mines avoiding clicked cell and its neighbors, then flood reveal
        if(g.firstClick){
          placeMinesAvoiding(g,row,col);
          revealMS(g,row,col);
          const allDone=g.revealed.every((v,i)=>v||g.mines[i]);
          if(allDone){
            activeGames.delete(interaction.channelId);
            recordWin(uid,interaction.user.username,reward);
            saveData();
            await interaction.editReply({content:`🎉 **Board cleared!** +${reward} coins\n💣 **Minesweeper** (${gd.diff||"easy"}) — ${mineCount} mines`,components:makeMSButtons(g,true)});
          } else {
            const remaining=g.revealed.filter((v,i)=>!v&&!g.mines[i]).length;
            await interaction.editReply({content:`💣 **Minesweeper** (${gd.diff||"easy"}) — ${mineCount} mines | ${remaining} cells left`,components:makeMSButtons(g)});
          }
          return;
        }
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
      if(result){activeGames.delete(interaction.channelId);let txt;if(result==="draw"){recordDraw(p0,null);recordDraw(p1,null);txt="🤝 **Draw!**";}else{recordWin(gd.players[gd.turn],interaction.user.username,CONFIG.win_ttt);recordLoss(gd.players[1-gd.turn],null);txt=`🎉 <@${gd.players[gd.turn]}> wins! (+${CONFIG.win_ttt} coins)`;}saveData();try{await interaction.editReply({content:`❌⭕ **Tic Tac Toe**\n<@${p0}> ❌  vs  <@${p1}> ⭕\n\n${renderTTT(gd.board)}\n\n${txt}`,components:makeTTTButtons(gd.board,true)});}catch{}}
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
        recordWin(gd.players[gd.turn],interaction.user.username,CONFIG.win_c4);
        recordLoss(gd.players[1-gd.turn],null);
        saveData();
        try{await interaction.editReply({content:`🔴🔵 **Connect 4**\n<@${p0}> 🔴  vs  <@${p1}> 🔵\n\n${renderC4(gd.board)}\n🎉 <@${gd.players[gd.turn]}> wins! (+${CONFIG.win_c4} coins)`,components:makeC4Buttons(true)});}catch{}
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
      const bjFx=activeEffects.get(uid)||{};
      const bjCharm=bjFx.lucky_charm_expiry&&bjFx.lucky_charm_expiry>Date.now();
      const bjWin=(coins)=>bjCharm?Math.floor(coins*(1+CONFIG.lucky_charm_bonus/100)):coins; // apply charm to wins only
      if(action==="hit"){
        playerHand.push(deck.pop());const pv=handVal(playerHand);
        if(pv>21){activeGames.delete(interaction.channelId);playerScore.coins-=bet;recordLoss(uid,interaction.user.username);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n💥 **Bust!** Lost **${bet}** coins.\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}}
        else if(pv===21){while(handVal(dealerHand)<17)dealerHand.push(deck.pop());const dv=handVal(dealerHand);let msg;if(dv>21||pv>dv){const w=bjWin(bet);playerScore.coins+=w;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${w}** coins!`+(bjCharm?" 🍀":"");}else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push!`;}else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}activeGames.delete(interaction.channelId);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}}
        else{try{await interaction.editReply({content:showBoard(true),components:makeBJButtons()});}catch{}}
      }else{
        while(handVal(dealerHand)<17)dealerHand.push(deck.pop());const pv=handVal(playerHand),dv=handVal(dealerHand);let msg;if(dv>21||pv>dv){const w=bjWin(bet);playerScore.coins+=w;recordWin(uid,interaction.user.username,0);msg=`✅ You win **${w}** coins!`+(bjCharm?" 🍀":"");}else if(pv===dv){recordDraw(uid,interaction.user.username);msg=`🤝 Push!`;}else{playerScore.coins-=bet;recordLoss(uid,interaction.user.username);msg=`❌ Dealer wins. Lost **${bet}** coins.`;}activeGames.delete(interaction.channelId);saveData();try{await interaction.editReply({content:`${showBoard(false)}\n\n${msg}\n💰 Balance: **${playerScore.coins}**`,components:makeBJButtons(true)});}catch{}
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
        else if(beats[c1]===c2){recordWin(id1,gd.u1,CONFIG.win_rps);recordLoss(id2,null);txt=`🎉 <@${id1}> wins! ${names[c1]} beats ${names[c2]} (+${CONFIG.win_rps} coins)`;}
        else{recordWin(id2,gd.u2,CONFIG.win_rps);recordLoss(id1,null);txt=`🎉 <@${id2}> wins! ${names[c2]} beats ${names[c1]} (+${CONFIG.win_rps} coins)`;}
        saveData();
        const ch=client.channels.cache.get(gd.channelId);
        if(ch)await safeSend(ch,`✊✋✌️ **RPS Results!**\n<@${id1}>: ${names[c1]}\n<@${id2}>: ${names[c2]}\n\n${txt}`);
      }
      return;
    }

    // Help pagination
    if(cid.startsWith("help_page_")){
      const page=parseInt(cid.slice(10));
      const TOTAL=8;
      if(page<0||page>=TOTAL){try{await interaction.deferUpdate();}catch{}return;}
      if(!(await btnAck(interaction)))return;
      const HELP_PAGES=[
        {title:"🎉 Fun & Social  —  Page 1 / 8",description:["**Interactions**","`/action type:… user:…` — Hug, pat, poke, stare, wave, high five, boop, oil, diddle, or kill someone","`/punch` `/hug` `/kiss` `/slap` `/throw` — Quick social actions","`/rate type:… user:…` — Rate someone (gay, autistic, simp, cursed, npc, villain, sigma)","`/ppsize user:…` — Check pp size","`/ship user1:… user2:…` — Ship compatibility %","","**Romance**","`/marry user:…` — Propose 💍 — target gets Accept/Decline buttons","`/divorce` — End the marriage 💔","`/partner [user]` — See who someone is married to","","**Party Games**","`/party type:truth|dare|neverhavei` — Truth, Dare, or Never Have I Ever","","**Conversation**","`/topic` — Random conversation starter","`/roast [user]` — Roast someone 🔥","`/compliment user:…` — Compliment someone 💖","`/advice` — Life advice 🧙","`/fact` — Random fun fact 📚","`/horoscope sign:…` — Your daily horoscope ✨","`/poll question:…` — Quick yes/no poll (server only)"].join("\n")},
        {title:"📡 Media & Utility  —  Page 2 / 8",description:["**Media**","`/gif animal:…` — Random animal GIF 🐾 (cat, dog, fox, panda, duck, bunny, koala, raccoon)","`/joke` — Random joke 😂","`/meme` — Random meme 🐸","`/quote` — Inspirational quote image ✨","`/trivia` — Trivia question with spoiler answer 🧠","`/avatar user:…` — Get someone's avatar","","**Utility**","`/ping` — Bot latency 🏓","`/coinflip` — Heads or tails 🪙","`/roll [sides]` — Roll a dice (default d6) 🎲","`/choose options:a,b,c` — Pick from comma-separated options","`/echo [message] [embed] [image] [title] [color] [replyto]` — Make the bot say something","`/remind time:… message:…` — Set a reminder (1 min – 1 week)","`/upload source|link:…` — Upload an image to the quotes folder 🖼️ *(server only, authorized users)*","","**Info**","`/botinfo` — Bot stats","`/serverinfo` — Server member/channel/role info","`/userprofile [user]` — Full profile: level, XP, coins, items, cooldowns"].join("\n")},
        {title:"💰 Economy  —  Page 3 / 8",description:["**Balance & Transfers**","`/coins [user]` — Check coin balance","`/givecoin user:… amount:…` — Transfer coins","","**Earning**","`/work` — Work a shift (1hr cooldown, 50–200 coins)","`/beg` — Beg for coins (5min cooldown, 0–50 coins)","`/crime` — Commit a crime (2hr cooldown, risky!)","`/rob user:…` — Rob someone (1hr cooldown, 45% success)","","**Gambling**","`/slots [bet]` — Slot machine 🎰","`/coinbet bet:… side:heads|tails` — Bet on a coin flip","`/blackjack bet:…` — Blackjack vs the dealer 🃏","","**Shop**","`/shop` — View items","`/buy item:…` — Buy an item","> 🍀 Lucky Charm (200) · ⚡ XP Boost (300) · 🛡️ Shield (150)","`/inventory [user]` — View items","","**Daily**","`/games game:Daily Challenge` — Daily puzzle for coins + streak 📅"].join("\n")},
        {title:"📈 XP & Leaderboards  —  Page 4 / 8",description:["**XP**","You earn XP by sending messages (1 min cooldown). 5–15 XP per message.","Level formula: `floor(50 × level^1.5)` XP per level","","`/xp [user]` — Check XP, level, and progress bar","`/xpleaderboard [scope:global|server]` — Top 10 by XP","","**Stats & Leaderboards**","`/score [user]` — Wins, losses, win rate, streak","`/userprofile [user]` — Everything in one embed","`/leaderboard [type]` — Global top 10","`/serverleaderboard [type]` — Server top 10","> Types: `wins` `coins` `streak` `beststreak` `games` `winrate` `images`"].join("\n")},
        {title:"🎮 Games  —  Page 5 / 8",description:["**Solo** — `/games game:…`","> 🪢 Hangman · 🐍 Snake · 💣 Minesweeper (Easy/Med/Hard)","> 🔢 Number Guess · 🔀 Word Scramble · 📅 Daily Challenge","","**2-Player** — `/2playergames game:… [opponent:…]`","> ❌⭕ Tic Tac Toe *(server only)*","> 🔴🔵 Connect 4 *(server only)*","> ✊ Rock Paper Scissors *(choices sent via DM)*","> 🧮 Math Race · 🏁 Word Race · 🧠 Trivia Battle *(server only)*","> 🔢 Count Game — count to 100 together, no opponent needed *(server only)*","> 🏁 Scramble Race — 5-round word unscramble *(server only)*","","Wins award coins. Check `/score` or `/userprofile` for stats."].join("\n")},
        {title:"⚙️ Server Config  —  Page 6 / 8",description:["Most commands here require **Manage Server** permission.","","**Channels & Messages**","`/channelpicker channel:… [levelup]` — Set the bot's main channel","`/xpconfig setting:…` — Level-up messages (on/off, ping toggle, channel)","`/setwelcome channel:… [message]` — Welcome message (`{user}` `{server}` `{count}`)","`/setleave channel:… [message]` — Leave message","`/setboostmsg channel:… [message]` — Boost announcement","`/disableownermsg enabled:…` — Toggle bot owner broadcasts","`/purge amount:…` — Bulk delete (needs Manage Messages)","`/counting action:set|remove|status` — Set a permanent counting channel","","**Roles**","`/autorole [role]` — Auto-assign role on join (blank to disable)","`/reactionrole action:add|remove|list …` — Emoji reaction roles","`/rolespingfix` — List & fix roles that can @everyone","","**Competitions & Tickets**","`/invitecomp hours:…` — Invite competition with coin rewards","`/ticketsetup` · `/closeticket` · `/addtoticket` · `/removefromticket`","","**Overview**","`/serverconfig` — View all current settings"].join("\n")},
        {title:"🛡️ Activity & RA/LOA  —  Page 7 / 8",description:["**Activity Checks** *(Manage Server)*","`/activity-check channel:… [deadline] [message] [ping] [schedule]` — Send a check-in to staff","> Specify which roles must respond and who is excluded","> Auto-closes after the deadline and reports who didn't check in","> Add `schedule:Monday 09:00` (UTC) to repeat it weekly automatically","","**RA / LOA Setup** *(Manage Server)*","`/raconfig action:create` — Auto-create Reduced Activity + LOA roles","`/raconfig action:set_ra|set_loa role:…` — Use existing roles","`/raconfig action:view` — See current config","","**Assigning Roles** *(Manage Roles)*","`/reduced-activity user:… action:give|remove [duration]` — Give/remove RA role","`/loa user:… action:give|remove [duration]` — Give/remove LOA role","> `duration` is in hours — omit for permanent"].join("\n")},
        {title:"📺 YouTube Tracking  —  Page 8 / 8",description:["Track a YouTube channel's subscriber count live in Discord.","All commands require **Manage Server** permission.","","**Setup (do this first)**","`/ytsetup channel:… discord_channel:… [apikey:…]` — Connect a YouTube channel","> Accepts `@handle`, full URL, or channel ID starting with UC","> Provide your YouTube Data API v3 key on first use — it's saved to botdata","> Get a free key at console.cloud.google.com → enable YouTube Data API v3","","**Live Sub Count**","`/subcount threshold:1K|10K` — Post an embed that edits itself every 5 min","","**Sub Goal**","`/subgoal goal:N [message]` — Live progress bar towards a target sub count","> Fires a custom or default message when the goal is reached","","**Milestones**","`/milestones action:add subs:N [message]` — Announce when a sub count is crossed","`/milestones action:remove subs:N` — Remove a milestone","`/milestones action:list` — View all milestones and their status"].join("\n")},
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
    if(cid==="rolespingfix_fix"){
      if(!OWNER_IDS.includes(interaction.user.id)&&!interaction.member?.permissions.has("MANAGE_GUILD"))return interaction.reply({content:"❌ You need the **Manage Server** permission to use this.",ephemeral:true});
      await interaction.deferUpdate();
      const guild=interaction.guild;
      await guild.roles.fetch();
      const dangerous=guild.roles.cache.filter(r=>{
        if(r.managed||r.id===guild.id)return false;
        return r.permissions.has("MENTION_EVERYONE");
      });
      if(!dangerous.size){
        return interaction.editReply({embeds:[{title:"✅ Already clean",description:"No roles have Mention Everyone anymore.",color:0x57F287}],components:[]});
      }
      const results=[];
      for(const[,role]of dangerous){
        try{
          const newPerms=role.permissions.remove("MENTION_EVERYONE");
          await role.setPermissions(newPerms,`/rolespingfix used by ${interaction.user.tag}`);
          results.push(`✅ Fixed: \`${role.name}\``);
        }catch(e){
          results.push(`❌ Failed: \`${role.name}\` — ${e.message}`);
        }
      }
      return interaction.editReply({embeds:[{
        title:"🔧 Role Fix Complete",
        description:results.join("\n"),
        color:0x57F287,
        footer:{text:"Mention Everyone permission removed from all listed roles."},
      }],components:[]});
    }
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
          header=[`## 🎫 Ticket Setup — Complete!`,`\`${bar}\``,``,`**Configuration:**`,`📁 Category: ${catCh?`\`${catCh.name}\``:"—"}`,`🛡️ Roles: ${roleList||"—"}`,`📋 Log: ${logStr}`,`📜 Transcript: ${txStr}`,`📢 Panel channel: ${panelStr}`,`✉️ Message: ${cfg.panelMessage?`\`${pv.slice(0,80)}${pv.length>80?"…":""}\``:"*(default)*"}`,`🎫 Status: ${cfg.panelMessageId?`✅ Live in <#${cfg.panelChannelId}>`:"❌ Not posted yet"}`,``,`Click **Post Panel** to publish.`].join("\n");
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
      const existing=[...openTickets.values()].find(t=>t.guildId===guildId&&t.userId===uid&&t.status!=="deleted");
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
        openTickets.set(channel.id,{guildId,userId:uid,ticketId,channelId:channel.id,subject:"",openedAt:Date.now(),status:"open"});saveData();
        const activeRow=new MessageActionRow().addComponents(
          new MessageButton().setCustomId("ticket_close").setLabel("Close Ticket 🔒").setStyle("DANGER"),
          new MessageButton().setCustomId("ticket_claim").setLabel("Claim 🙋").setStyle("SUCCESS"),
        );
        await channel.send({content:`🎫 **Ticket #${ticketId}** — <@${uid}>\n\nHello <@${uid}>! Support will be with you shortly.${(cfg2.supportRoleIds||[]).map(r=>`<@&${r}>`).join(" ")?`\n${(cfg2.supportRoleIds||[]).map(r=>`<@&${r}>`).join(" ")}`:""}`,components:[activeRow]});
        if(cfg2.logChannelId){const logCh=guild.channels.cache.get(cfg2.logChannelId);if(logCh)await safeSend(logCh,`📂 **Ticket #${ticketId} opened** by <@${uid}> — <#${channel.id}>`);}
        try{await interaction.followUp({content:`✅ Your ticket has been created: <#${channel.id}>`,ephemeral:true});}catch{}
      }catch(e){console.error("ticket_open error:",e);try{await interaction.followUp({content:`❌ Failed to create ticket: ${e.message}`,ephemeral:true});}catch{}}
      return;
    }

    // Ticket close — removes user access, keeps channel for staff, shows Reopen + Delete buttons
    if(cid==="ticket_close"){
      if(!await btnAck(interaction))return;
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket){try{await interaction.followUp({content:"This doesn't look like a ticket channel.",ephemeral:true});}catch{}return;}
      const cfg=ticketConfigs.get(ticket.guildId);
      const member=interaction.member;
      const isStaff=OWNER_IDS.includes(uid)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>member.roles.cache.has(rid))||member.permissions.has("MANAGE_CHANNELS");
      const canClose=ticket.userId===uid||isStaff;
      if(!canClose){try{await interaction.followUp({content:"You don't have permission to close this ticket.",ephemeral:true});}catch{}return;}
      // Remove the ticket owner's access to the channel
      try{await interaction.channel.permissionOverwrites.edit(ticket.userId,{VIEW_CHANNEL:false,SEND_MESSAGES:false});}catch{}
      ticket.status="closed";
      ticket.closedBy=uid;
      ticket.closedAt=Date.now();
      saveData();
      const staffRow=new MessageActionRow().addComponents(
        new MessageButton().setCustomId("ticket_reopen").setLabel("Reopen 🔓").setStyle("SUCCESS"),
        new MessageButton().setCustomId("ticket_delete").setLabel("Delete Ticket 🗑️").setStyle("DANGER"),
      );
      try{
        await interaction.editReply({
          content:`🔒 **Ticket #${ticket.ticketId} closed** by <@${uid}>.\n\n*<@${ticket.userId}> no longer has access.*\n**Staff:** Use the buttons below to reopen or permanently delete this ticket.`,
          components:[staffRow]
        });
      }catch{}
      return;
    }

    // Ticket reopen — restores user access
    if(cid==="ticket_reopen"){
      if(!await btnAck(interaction))return;
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket){try{await interaction.followUp({content:"This doesn't look like a ticket channel.",ephemeral:true});}catch{}return;}
      const cfg=ticketConfigs.get(ticket.guildId);
      const member=interaction.member;
      const isStaff=OWNER_IDS.includes(uid)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>member.roles.cache.has(rid))||member.permissions.has("MANAGE_CHANNELS");
      if(!isStaff){try{await interaction.followUp({content:"Only support staff can reopen tickets.",ephemeral:true});}catch{}return;}
      // Restore the ticket owner's access
      try{await interaction.channel.permissionOverwrites.edit(ticket.userId,{VIEW_CHANNEL:true,SEND_MESSAGES:true,READ_MESSAGE_HISTORY:true});}catch{}
      ticket.status="open";
      delete ticket.closedBy;
      delete ticket.closedAt;
      saveData();
      const activeRow=new MessageActionRow().addComponents(
        new MessageButton().setCustomId("ticket_close").setLabel("Close Ticket 🔒").setStyle("DANGER"),
        new MessageButton().setCustomId("ticket_claim").setLabel("Claim 🙋").setStyle("SUCCESS"),
      );
      try{
        await interaction.editReply({
          content:`🔓 **Ticket #${ticket.ticketId} reopened** by <@${uid}>.\n\n<@${ticket.userId}> has been given access again.`,
          components:[activeRow]
        });
      }catch{}
      return;
    }

    // Ticket delete — staff only, transcripts and logs THEN deletes channel
    if(cid==="ticket_delete"){
      if(!await btnAck(interaction))return;
      const ticket=openTickets.get(interaction.channelId);
      if(!ticket){try{await interaction.followUp({content:"This doesn't look like a ticket channel.",ephemeral:true});}catch{}return;}
      const cfg=ticketConfigs.get(ticket.guildId);
      const member=interaction.member;
      const isStaff=OWNER_IDS.includes(uid)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>member.roles.cache.has(rid))||member.permissions.has("MANAGE_CHANNELS");
      if(!isStaff){try{await interaction.followUp({content:"Only support staff can delete tickets.",ephemeral:true});}catch{}return;}
      openTickets.delete(interaction.channelId);saveData();
      try{
        await interaction.editReply({content:`🗑️ **Ticket #${ticket.ticketId}** is being transcripted and deleted...`,components:[]});
        await sendTicketTranscript(interaction.channel,ticket,cfg,`@${interaction.user.username}`);
        if(cfg?.logChannelId){const logCh=interaction.guild.channels.cache.get(cfg.logChannelId);if(logCh)await safeSend(logCh,`🗑️ **Ticket #${ticket.ticketId} deleted** by <@${uid}>`);}
        setTimeout(()=>interaction.channel.delete().catch(()=>{}),3000);
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

  const ownerOnly=["servers","broadcast","fakecrash","identitycrisis","botolympics","sentience","legendrandom","dmuser","leaveserver","restart","botstats","setstatus","adminuser","adminreset","adminconfig","admingive","echo","forcemarry","forcedivorce","shadowdelete","clankerify","fakemessage"];
  if(ownerOnly.includes(cmd)&&!OWNER_IDS.includes(interaction.user.id))return safeReply(interaction,{content:"Owner only.",ephemeral:true});

  const manageServerCmds=["channelpicker","counting","xpconfig","setwelcome","setleave","setwelcomemsg","setleavemsg","disableownermsg","serverconfig","autorole","setboostmsg","invitecomp","purge","reactionrole","ticketsetup","ytsetup","subgoal","subcount","milestones","dailyquote"];
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

    // ── /marry — persistent proposal stored in botdata.json ──────────────────
    if(cmd==="marry"){
      const target=interaction.options.getUser("user");
      if(target.id===interaction.user.id)return safeReply(interaction,{content:"You can't marry yourself.",ephemeral:true});
      if(target.bot)return safeReply(interaction,{content:"You can't marry a bot.",ephemeral:true});

      const s  = getScore(interaction.user.id, interaction.user.username);
      const t  = getScore(target.id, target.username);

      // ── Case 1: target already proposed to ME — this is an acceptance ──────
      if(t.pendingProposal === interaction.user.id){
        // Both must be unmarried
        if(s.marriedTo) return safeReply(interaction,{content:`You're already married to <@${s.marriedTo}>! Use /divorce first.`,ephemeral:true});
        if(t.marriedTo) return safeReply(interaction,{content:`<@${target.id}> is already married to someone else!`,ephemeral:true});
        // Accept: marry both sides, clear the proposal
        s.marriedTo = target.id;
        t.marriedTo = interaction.user.id;
        t.pendingProposal = null;
        saveData();
        return safeReply(interaction,`💍 **${interaction.user.username}** accepted! 🎉\n<@${interaction.user.id}> and <@${target.id}> are now married! Congratulations! 💕`);
      }

      // ── Case 2: I'm proposing ─────────────────────────────────────────────
      if(s.marriedTo) return safeReply(interaction,{content:`You're already married to <@${s.marriedTo}>! Use /divorce first.`,ephemeral:true});
      if(t.marriedTo) return safeReply(interaction,{content:`<@${target.id}> is already married!`,ephemeral:true});
      // Check if target already has a different pending proposal incoming (from someone else)
      if(t.pendingProposal && t.pendingProposal !== interaction.user.id){
        return safeReply(interaction,{content:`<@${target.id}> already has a pending proposal from someone else.`,ephemeral:true});
      }
      // Check if I already proposed to this person
      if(t.pendingProposal === interaction.user.id){
        return safeReply(interaction,{content:`You already proposed to <@${target.id}>! They need to run \`/marry @${interaction.user.username}\` to accept.`,ephemeral:true});
      }
      // Store the proposal on the target's record so it survives bot restarts
      t.pendingProposal = interaction.user.id;
      saveData();
      const propRow = new MessageActionRow().addComponents(
        new MessageButton()
          .setCustomId(`marry_accept_${interaction.user.id}_${target.id}`)
          .setLabel("💍 Accept")
          .setStyle("SUCCESS"),
        new MessageButton()
          .setCustomId(`marry_decline_${interaction.user.id}_${target.id}`)
          .setLabel("💔 Decline")
          .setStyle("DANGER"),
      );
      return safeReply(interaction, {
        content: `💍 **Marriage Proposal!**\n\n<@${interaction.user.id}> has proposed to <@${target.id}>! 🌹\n\n<@${target.id}>, do you accept?`,
        components: [propRow],
      });
    }
    
    if(cmd==="forcemarry"){
  const u1=interaction.options.getUser("user1");
  const u2=interaction.options.getUser("user2");
  if(u1.id===u2.id)return safeReply(interaction,{content:"Can't marry someone to themselves.",ephemeral:true});
  const s1=getScore(u1.id,u1.username);
  const s2=getScore(u2.id,u2.username);
  if(s1.marriedTo)return safeReply(interaction,{content:`❌ <@${u1.id}> is already married to <@${s1.marriedTo}>.`,ephemeral:true});
  if(s2.marriedTo)return safeReply(interaction,{content:`❌ <@${u2.id}> is already married to <@${s2.marriedTo}>.`,ephemeral:true});
  s1.marriedTo=u2.id; s1.pendingProposal=null; s1.forceMarried=true;
  s2.marriedTo=u1.id; s2.pendingProposal=null; s2.forceMarried=true;
  saveData();
  return safeReply(interaction,{content:`💍 **Force married!** <@${u1.id}> and <@${u2.id}> are now married. Congrats (whether they like it or not). 💕`,ephemeral:true});
}
    if(cmd==="forcedivorce"){
  const u=interaction.options.getUser("user");
  const s=getScore(u.id,u.username);
  if(!s.marriedTo)return safeReply(interaction,{content:`❌ <@${u.id}> is not married.`,ephemeral:true});
  const partnerId=s.marriedTo;
  const partner=scores.get(partnerId);
  if(partner){
    partner.marriedTo=null;
    partner.pendingProposal=null;
    partner.forceMarried=false;
  }
  s.marriedTo=null;
  s.pendingProposal=null;
  s.forceMarried=false;
  saveData();
  return safeReply(interaction,{content:`💔 **Force divorced!** <@${u.id}> and <@${partnerId}> are no longer married.`,ephemeral:true});
}
    if(cmd==="shadowdelete"){
  const target = interaction.options.getUser("user");
  const pct = interaction.options.getInteger("percentage");
  if(pct < 0 || pct > 100) return safeReply(interaction,{content:"❌ Percentage must be 0–100.",ephemeral:true});
  if(pct === 0){
    shadowDelete.delete(target.id);
    saveData();
    return safeReply(interaction,{content:`✅ Shadow delete **disabled** for <@${target.id}>.`,ephemeral:true});
  }
  shadowDelete.set(target.id, pct);
  saveData();
  return safeReply(interaction,{content:`👻 Shadow delete set to **${pct}%** for <@${target.id}>.`,ephemeral:true});
}

if(cmd==="clankerify"){
  const target   = interaction.options.getUser("user");
  const duration = interaction.options.getInteger("duration") ?? null; // minutes, null = permanent

  // duration === 0 means disable
  if(duration === 0){
    clankerify.delete(target.id);
    saveData();
    return safeReply(interaction,{content:`✅ Clankerify **disabled** for <@${target.id}>.`,ephemeral:true});
  }

  // Encode target and duration into customId so the select handler can read them
  // Format: clankerify_mode_{targetId}_{duration|"perm"}
  const durKey = duration ? String(duration) : "perm";
  const modeMenu = new MessageActionRow().addComponents(
    new MessageSelectMenu()
      .setCustomId(`clankerify_mode_${target.id}_${durKey}`)
      .setPlaceholder("Pick a personality mode…")
      .addOptions([
        {label:"No mode (plain)",  value:"none",        emoji:"🤖"},
        {label:"Evil",             value:"evil",        emoji:"😈"},
        {label:"Freaky",           value:"freaky",      emoji:"😏"},
        {label:"American",         value:"american",    emoji:"🦅"},
        {label:"British",          value:"british",     emoji:"🫖"},
        {label:"Stupid",           value:"stupid",      emoji:"🪖"},
        {label:"Boomer",           value:"boomer",      emoji:"📰"},
        {label:"Conspiracy",       value:"conspiracy",  emoji:"🔺"},
        {label:"NPC",              value:"npc",         emoji:"🗺️"},
        {label:"Sigma",            value:"sigma",       emoji:"😤"},
        {label:"Medieval",         value:"medieval",    emoji:"⚔️"},
        {label:"Ghost",            value:"ghost",       emoji:"👻"},
      ])
  );
  const durationStr = duration ? `**${duration} minute(s)**` : "**permanently**";
  return safeReply(interaction,{
    content:`🤖 Clankerifying <@${target.id}> ${durationStr}. Pick a mode:`,
    components:[modeMenu],
    ephemeral:true
  });
}

if(cmd==="divorce"){
  const s=getScore(interaction.user.id,interaction.user.username);
  if(!s.marriedTo)return safeReply(interaction,{content:"You're not married.",ephemeral:true});
  if(s.forceMarried)return safeReply(interaction,{content:"💀 Your marriage was **force ordained**. There is no escape.",ephemeral:true});
  const t=scores.get(s.marriedTo);
  if(t){ t.marriedTo=null; t.pendingProposal=null; }
  s.marriedTo=null;
  s.pendingProposal=null;
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
;

if(cmd==="gif"){
      const animal=interaction.options.getString("animal");
      const fetchers={
        cat:    getCatGif,
        dog:    getDogImage,
        fox:    getFoxImage,
        panda:  getPandaImage,
        duck:   getDuckImage,
        bunny:  getBunnyImage,
        koala:  getKoalaImage,
        raccoon:getRaccoonImage,
      };
      const labels={cat:"Cat 🐱",dog:"Dog 🐶",fox:"Fox 🦊",panda:"Panda 🐼",duck:"Duck 🦆",bunny:"Bunny 🐇",koala:"Koala 🐨",raccoon:"Raccoon 🦝"};
      await interaction.deferReply();
      const url=await (fetchers[animal]?.())||null;
      if(!url)return safeReply(interaction,`Couldn't fetch a ${labels[animal]||animal} right now, try again!`);
      return safeReply(interaction,{embeds:[{title:`${labels[animal]||animal}`,image:{url},color:0xffaacc}]});
    }
    if(cmd==="joke") {await interaction.deferReply();return safeReply(interaction,await getJoke()      ||"No joke today.");}
    if(cmd==="meme") {await interaction.deferReply();return safeReply(interaction,await getMeme()      ||"Meme API down 😔");}
    if(cmd==="quote"){
      // 1.5 second per-user cooldown
      const now_q = Date.now();
      const last_q = quoteCooldown.get(interaction.user.id) || 0;
      if (now_q - last_q < 1500) {
        return safeReply(interaction, { content: "⏳ Slow down! You can only use `/quote` once every 1.5 seconds.", ephemeral: true });
      }
      quoteCooldown.set(interaction.user.id, now_q);
      try { await interaction.deferReply(); } catch { /* user-install context on foreign server — reply will still work */ }
      try {
        const chosen = await nextQuoteImage();
        if(!chosen) return safeReply(interaction, "Couldn't load quotes right now.");
        let sent;
        // ~5% chance to also show the upload promo message
        if(Math.random() < 0.05){
          sent = await safeReply(interaction, { content: "Do you want to be able to upload images to be used in /quote? Add **genuineleafy** or **royalvmusic** in discord to do so!", files: [chosen.download_url] });
        } else {
          sent = await safeReply(interaction, { files: [chosen.download_url] });
        }
        // Fetch the real Message object so we can react on it
        if(sent){
          try {
            const msg = sent.id ? sent : await interaction.fetchReply().catch(()=>null);
            if(msg){
              await msg.react("👍").catch(()=>{});
              await msg.react("👎").catch(()=>{});
              quoteVoteMessages.set(msg.id, chosen.name);
              saveData();
            }
          } catch {}
        }
        return;
      } catch(e) {
        return safeReply(interaction, "Something went wrong fetching a quote.");
      }
    }

    // ── /goodquote — higher-rated quote ──────────────────────────────────────
    if(cmd==="goodquote"){
      const now_q = Date.now();
      const last_q = quoteCooldown.get(interaction.user.id) || 0;
      if (now_q - last_q < 1500) {
        return safeReply(interaction, { content: "⏳ Slow down! You can only use `/goodquote` once every 1.5 seconds.", ephemeral: true });
      }
      quoteCooldown.set(interaction.user.id, now_q);
      try { await interaction.deferReply(); } catch {}
      try {
        const chosen = await nextGoodQuoteImage();
        if(!chosen) return safeReply(interaction, "Couldn't load quotes right now.");
        let sent;
        if(Math.random() < 0.05){
          sent = await safeReply(interaction, { content: "Do you want to be able to upload images to be used in /quote? Add **genuineleafy** or **royalvmusic** in discord to do so!", files: [chosen.download_url] });
        } else {
          sent = await safeReply(interaction, { files: [chosen.download_url] });
        }
        if(sent){
          try {
            const msg = sent.id ? sent : await interaction.fetchReply().catch(()=>null);
            if(msg){
              await msg.react("👍").catch(()=>{});
              await msg.react("👎").catch(()=>{});
              quoteVoteMessages.set(msg.id, chosen.name);
              saveData();
            }
          } catch {}
        }
        return;
      } catch(e) {
        return safeReply(interaction, "Something went wrong fetching a good quote.");
      }
    }

    // ── /badquote — lower-rated quote ────────────────────────────────────────
    if(cmd==="badquote"){
      const now_q = Date.now();
      const last_q = quoteCooldown.get(interaction.user.id) || 0;
      if (now_q - last_q < 1500) {
        return safeReply(interaction, { content: "⏳ Slow down! You can only use `/badquote` once every 1.5 seconds.", ephemeral: true });
      }
      quoteCooldown.set(interaction.user.id, now_q);
      try { await interaction.deferReply(); } catch {}
      try {
        const chosen = await nextBadQuoteImage();
        if(!chosen) return safeReply(interaction, "Couldn't load quotes right now.");
        let sent;
        if(Math.random() < 0.05){
          sent = await safeReply(interaction, { content: "Do you want to be able to upload images to be used in /quote? Add **genuineleafy** or **royalvmusic** in discord to do so!", files: [chosen.download_url] });
        } else {
          sent = await safeReply(interaction, { files: [chosen.download_url] });
        }
        if(sent){
          try {
            const msg = sent.id ? sent : await interaction.fetchReply().catch(()=>null);
            if(msg){
              await msg.react("👍").catch(()=>{});
              await msg.react("👎").catch(()=>{});
              quoteVoteMessages.set(msg.id, chosen.name);
              saveData();
            }
          } catch {}
        }
        return;
      } catch(e) {
        return safeReply(interaction, "Something went wrong fetching a bad quote.");
      }
    }
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

    if(cmd==="advice")        return safeReply(interaction,`🧙 ${pick(ADVICE)}`);
    if(cmd==="fact")          return safeReply(interaction,`📚 ${pick(FACTS)}`);
    if(cmd==="horoscope")     return safeReply(interaction,HOROSCOPES[interaction.options.getString("sign")]||"Unknown sign.");


    if(cmd==="echo"){
  const text      = interaction.options.getString("message")||"";
  const useEmbed  = interaction.options.getBoolean("embed")||false;
  const attachment= interaction.options.getAttachment("image")||null;
  const embedTitle= interaction.options.getString("title")||null;
  const colorHex  = interaction.options.getString("color")||null;
  const replyToId = interaction.options.getString("replyto")||null;
  if(!text&&!attachment&&!embedTitle)return safeReply(interaction,{content:"❌ Provide at least a message, image, or title.",ephemeral:true});
  await safeReply(interaction,{content:"✅",ephemeral:true});
  const targetCh = interaction.channel;
  let replyTarget = null;
  if(replyToId){
    replyTarget = await targetCh.messages.fetch(replyToId).catch(()=>null);
    if(!replyTarget) await interaction.followUp({content:`⚠️ Message ID \`${replyToId}\` not found — sending normally.`,ephemeral:true});
  }
  let resolvedColor = 0x5865F2;
  if(colorHex){const cleaned=colorHex.replace(/^#/,"");const parsed=parseInt(cleaned,16);if(!isNaN(parsed))resolvedColor=parsed;}
  let payload;
  if(useEmbed||attachment||embedTitle){
    const embed={description:text||null,title:embedTitle||null,color:resolvedColor,image:attachment?{url:attachment.url}:undefined};
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

    if(cmd==="premiere"){
      const hours   = interaction.options.getNumber("hours");
      const channel = interaction.options.getChannel("channel");
      const title   = interaction.options.getString("title") || "Upcoming Video";
      if(hours<=0||hours>720)return safeReply(interaction,{content:"❌ Hours must be between 0 and 720.",ephemeral:true});
      // Check bot can send in the target channel
      const perms=channel.permissionsFor(interaction.guild.me);
      if(!perms||!perms.has("SEND_MESSAGES")||!perms.has("EMBED_LINKS"))
        return safeReply(interaction,{content:`❌ I don't have permission to send embeds in <#${channel.id}>.`,ephemeral:true});

      const now      = Date.now();
      const endsAt   = now + Math.round(hours * 3600000);
      const id       = `${interaction.user.id}_${now}`;
      const premiere = { title, endsAt, startedAt:now, channelId:channel.id, userId:interaction.user.id, messageId:null, guildId:interaction.guildId };

      // Post the initial embed and store the message ID
      const embed = buildPremiereEmbed(premiere);
      const sent  = await channel.send(embed).catch(()=>null);
      if(!sent)return safeReply(interaction,{content:"❌ Failed to send the countdown message.",ephemeral:true});

      premiere.messageId = sent.id;
      premieres.set(id, premiere);
      saveData();

      const hrsLabel = hours === Math.floor(hours) ? `${hours}h` : `${hours}h`;
      return safeReply(interaction,{content:`🎬 Premiere countdown started in <#${channel.id}>!\n**${title}** drops in **${hrsLabel}** — the bar updates every 30 minutes.`,ephemeral:true});
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
      const member = inGuild ? await interaction.guild.members.fetch(u.id).catch(()=>null) : null;
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
      const ITEM_NAMES = { lucky_charm:"Lucky Charm 🍀", xp_boost:"XP Boost ⚡", shield:"Shield 🛡️", coin_magnet:"Coin Magnet 🧲", mystery_box:"Mystery Box 📦", item_mystery_box:"Item Mystery Box 🎲", rob_insurance:"Rob Insurance 📋" };
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
        `> 🖼️ Images uploaded: **${(s.imagesUploaded||0).toLocaleString()}**`,
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
      const HELP_PAGES=[
        {title:"🎉 Fun & Social  —  Page 1 / 8",description:["**Interactions**","`/action type:… user:…` — Hug, pat, poke, stare, wave, high five, boop, oil, diddle, or kill someone","`/punch` `/hug` `/kiss` `/slap` `/throw` — Quick social actions","`/rate type:… user:…` — Rate someone (gay, autistic, simp, cursed, npc, villain, sigma)","`/ppsize user:…` — Check pp size","`/ship user1:… user2:…` — Ship compatibility %","","**Romance**","`/marry user:…` — Propose 💍 — target gets Accept/Decline buttons","`/divorce` — End the marriage 💔","`/partner [user]` — See who someone is married to","","**Party Games**","`/party type:truth|dare|neverhavei` — Truth, Dare, or Never Have I Ever","","**Conversation**","`/topic` — Random conversation starter","`/roast [user]` — Roast someone 🔥","`/compliment user:…` — Compliment someone 💖","`/advice` — Life advice 🧙","`/fact` — Random fun fact 📚","`/horoscope sign:…` — Your daily horoscope ✨","`/poll question:…` — Quick yes/no poll (server only)"].join("\n")},
        {title:"📡 Media & Utility  —  Page 2 / 8",description:["**Media**","`/gif animal:…` — Random animal GIF 🐾 (cat, dog, fox, panda, duck, bunny, koala, raccoon)","`/joke` — Random joke 😂","`/meme` — Random meme 🐸","`/quote` — Inspirational quote image ✨","`/trivia` — Trivia question with spoiler answer 🧠","`/avatar user:…` — Get someone's avatar","","**Utility**","`/ping` — Bot latency 🏓","`/coinflip` — Heads or tails 🪙","`/roll [sides]` — Roll a dice (default d6) 🎲","`/choose options:a,b,c` — Pick from comma-separated options","`/echo [message] [embed] [image] [title] [color] [replyto]` — Make the bot say something","`/remind time:… message:…` — Set a reminder (1 min – 1 week)","`/upload source|link:…` — Upload an image to the quotes folder 🖼️ *(server only, authorized users)*","","**Info**","`/botinfo` — Bot stats","`/serverinfo` — Server member/channel/role info","`/userprofile [user]` — Full profile: level, XP, coins, items, cooldowns"].join("\n")},
        {title:"💰 Economy  —  Page 3 / 8",description:["**Balance & Transfers**","`/coins [user]` — Check coin balance","`/givecoin user:… amount:…` — Transfer coins","","**Earning**","`/work` — Work a shift (1hr cooldown, 50–200 coins)","`/beg` — Beg for coins (5min cooldown, 0–50 coins)","`/crime` — Commit a crime (2hr cooldown, risky!)","`/rob user:…` — Rob someone (1hr cooldown, 45% success)","","**Gambling**","`/slots [bet]` — Slot machine 🎰","`/coinbet bet:… side:heads|tails` — Bet on a coin flip","`/blackjack bet:…` — Blackjack vs the dealer 🃏","","**Shop**","`/shop` — View items","`/buy item:…` — Buy an item","> 🍀 Lucky Charm (200) · ⚡ XP Boost (300) · 🛡️ Shield (150)","`/inventory [user]` — View items","","**Daily**","`/games game:Daily Challenge` — Daily puzzle for coins + streak 📅"].join("\n")},
        {title:"📈 XP & Leaderboards  —  Page 4 / 8",description:["**XP**","You earn XP by sending messages (1 min cooldown). 5–15 XP per message.","Level formula: `floor(50 × level^1.5)` XP per level","","`/xp [user]` — Check XP, level, and progress bar","`/xpleaderboard [scope:global|server]` — Top 10 by XP","","**Stats & Leaderboards**","`/score [user]` — Wins, losses, win rate, streak","`/userprofile [user]` — Everything in one embed","`/leaderboard [type]` — Global top 10","`/serverleaderboard [type]` — Server top 10","> Types: `wins` `coins` `streak` `beststreak` `games` `winrate` `images`"].join("\n")},
        {title:"🎮 Games  —  Page 5 / 8",description:["**Solo** — `/games game:…`","> 🪢 Hangman · 🐍 Snake · 💣 Minesweeper (Easy/Med/Hard)","> 🔢 Number Guess · 🔀 Word Scramble · 📅 Daily Challenge","","**2-Player** — `/2playergames game:… [opponent:…]`","> ❌⭕ Tic Tac Toe *(server only)*","> 🔴🔵 Connect 4 *(server only)*","> ✊ Rock Paper Scissors *(choices sent via DM)*","> 🧮 Math Race · 🏁 Word Race · 🧠 Trivia Battle *(server only)*","> 🔢 Count Game — count to 100 together, no opponent needed *(server only)*","> 🏁 Scramble Race — 5-round word unscramble *(server only)*","","Wins award coins. Check `/score` or `/userprofile` for stats."].join("\n")},
        {title:"⚙️ Server Config  —  Page 6 / 8",description:["Most commands here require **Manage Server** permission.","","**Channels & Messages**","`/channelpicker channel:… [levelup]` — Set the bot's main channel","`/xpconfig setting:…` — Level-up messages (on/off, ping toggle, channel)","`/setwelcome channel:… [message]` — Welcome message (`{user}` `{server}` `{count}`)","`/setleave channel:… [message]` — Leave message","`/setboostmsg channel:… [message]` — Boost announcement","`/disableownermsg enabled:…` — Toggle bot owner broadcasts","`/purge amount:…` — Bulk delete (needs Manage Messages)","`/counting action:set|remove|status` — Set a permanent counting channel","","**Roles**","`/autorole [role]` — Auto-assign role on join (blank to disable)","`/reactionrole action:add|remove|list …` — Emoji reaction roles","`/rolespingfix` — List & fix roles that can @everyone","","**Competitions & Tickets**","`/invitecomp hours:…` — Invite competition with coin rewards","`/ticketsetup` · `/closeticket` · `/addtoticket` · `/removefromticket`","","**Overview**","`/serverconfig` — View all current settings"].join("\n")},
        {title:"🛡️ Activity & RA/LOA  —  Page 7 / 8",description:["**Activity Checks** *(Manage Server)*","`/activity-check channel:… [deadline] [message] [ping] [schedule]` — Send a check-in to staff","> Specify which roles must respond and who is excluded","> Auto-closes after the deadline and reports who didn't check in","> Add `schedule:Monday 09:00` (UTC) to repeat it weekly automatically","","**RA / LOA Setup** *(Manage Server)*","`/raconfig action:create` — Auto-create Reduced Activity + LOA roles","`/raconfig action:set_ra|set_loa role:…` — Use existing roles","`/raconfig action:view` — See current config","","**Assigning Roles** *(Manage Roles)*","`/reduced-activity user:… action:give|remove [duration]` — Give/remove RA role","`/loa user:… action:give|remove [duration]` — Give/remove LOA role","> `duration` is in hours — omit for permanent"].join("\n")},
        {title:"📺 YouTube Tracking  —  Page 8 / 8",description:["Track a YouTube channel's subscriber count live in Discord.","All commands require **Manage Server** permission.","","**Setup (do this first)**","`/ytsetup channel:… discord_channel:… [apikey:…]` — Connect a YouTube channel","> Accepts `@handle`, full URL, or channel ID starting with UC","> Provide your YouTube Data API v3 key on first use — it's saved to botdata","> Get a free key at console.cloud.google.com → enable YouTube Data API v3","","**Live Sub Count**","`/subcount threshold:1K|10K` — Post an embed that edits itself every 5 min","","**Sub Goal**","`/subgoal goal:N [message]` — Live progress bar towards a target sub count","> Fires a custom or default message when the goal is reached","","**Milestones**","`/milestones action:add subs:N [message]` — Announce when a sub count is crossed","`/milestones action:remove subs:N` — Remove a milestone","`/milestones action:list` — View all milestones and their status"].join("\n")},
      ];
      const TOTAL=HELP_PAGES.length;
      function buildHelpEmbed(page){
        const p=HELP_PAGES[page];
        return{
          embeds:[{title:p.title,description:p.description,color:0x5865F2,footer:{text:`Use the buttons to navigate • Page ${page+1} of ${TOTAL}`}}],
          components:[new MessageActionRow().addComponents(
            new MessageButton().setCustomId(`help_page_${page-1}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(page===0),
            new MessageButton().setCustomId(`help_page_${page+1}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(page>=TOTAL-1),
          )],
          ephemeral:true,
        };
      }
      return safeReply(interaction,buildHelpEmbed(0));
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
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      const bet=interaction.options.getInteger("bet")||10;
      if(bet<CONFIG.slots_min_bet)return safeReply(interaction,{content:`Min bet is ${CONFIG.slots_min_bet}.`,ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const reels=isOwner?["💎","💎","💎"]:spinSlots();
      const{mult,label}=slotPayout(reels);
      const fx=activeEffects.get(interaction.user.id)||{};
      const hasCharm=fx.lucky_charm_expiry&&fx.lucky_charm_expiry>Date.now();
      let winnings=Math.floor(bet*mult);
      if(hasCharm&&winnings>0)winnings=Math.floor(winnings*(1+CONFIG.lucky_charm_bonus/100));
      s.coins=s.coins-bet+winnings;
      saveData();
      const charmTag=hasCharm&&winnings>0?" 🍀 +"+CONFIG.lucky_charm_bonus+"%":"";
      return safeReply(interaction,`🎰 | ${reels.join(" | ")} |\n\n**${label}**\n`+(mult>=1?`✅ Won **${winnings}** coins! (+${winnings-bet})`:`❌ Lost **${bet}** coins.`)+`\n💰 Balance: **${s.coins}**`+charmTag);
    }
    if(cmd==="coinbet"){
      const bet=interaction.options.getInteger("bet"),side=interaction.options.getString("side");
      if(bet<1)return safeReply(interaction,{content:"Min bet is 1.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<bet)return safeReply(interaction,{content:`You only have **${s.coins}** coins.`,ephemeral:true});
      const result=Math.random()<(CONFIG.coinbet_win_chance/100)?"heads":"tails",won=result===side;s.coins+=won?bet:-bet;
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
      if(handVal(ph)===21){
        const bjFxDeal=activeEffects.get(interaction.user.id)||{};
        const bjCharmDeal=bjFxDeal.lucky_charm_expiry&&bjFxDeal.lucky_charm_expiry>Date.now();
        const reward=bjCharmDeal?Math.floor(Math.floor(bet*CONFIG.blackjack_natural_mult/100)*(1+CONFIG.lucky_charm_bonus/100)):Math.floor(bet*CONFIG.blackjack_natural_mult/100);
        ps.coins+=reward;ps.wins++;ps.gamesPlayed++;saveData();
        return safeReply(interaction,{content:`${showBoard(false)}\n\n🎉 **Blackjack!** Won **${reward}** coins!`+(bjCharmDeal?" 🍀":"")+`\n💰 Balance: **${ps.coins}**`,components:makeBJButtons(true)});
      }
      activeGames.set(cid,{type:"blackjack",deck,playerHand:ph,dealerHand:dh,bet,playerScore:ps,playerId:interaction.user.id});
      return safeReply(interaction,{content:showBoard(true),components:makeBJButtons()});
    }
    if(cmd==="work"){
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.work_cooldown_ms-(now-s.lastWorkTime);
      if(!isOwner&&rem>0)return safeReply(interaction,{content:`⏰ Rest first. Back in **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastWorkTime=now;
      const resp=pick(WORK_RESPONSES);
      let coins=isOwner?resp.hi:r(resp.lo,resp.hi);
      // Apply coin_magnet (single use, 3×)
      const hasMagnet=s.inventory&&s.inventory.includes("coin_magnet");
      if(hasMagnet){coins=Math.floor(coins*CONFIG.coin_magnet_mult/100);s.inventory.splice(s.inventory.indexOf("coin_magnet"),1);}
      // Apply lucky_charm (+10%)
      const fx=activeEffects.get(interaction.user.id)||{};
      const hasCharm=fx.lucky_charm_expiry&&fx.lucky_charm_expiry>now;
      if(hasCharm)coins=Math.floor(coins*(1+CONFIG.lucky_charm_bonus/100));
      s.coins+=coins;
      saveData();
      const ownerTag=isOwner?" 👑":"";
      const bonusTag=hasMagnet?" 🧲 3×":"";
      const charmTag=hasCharm?" 🍀 +"+CONFIG.lucky_charm_bonus+"%":"";
      return safeReply(interaction,resp.msg.replace("{c}",coins)+`\n💰 Balance: **${s.coins}**`+ownerTag+bonusTag+charmTag);
    }
    if(cmd==="beg"){
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.beg_cooldown_ms-(now-s.lastBegTime);
      if(!isOwner&&rem>0)return safeReply(interaction,{content:`⏰ Wait **${Math.ceil(rem/1000)}s** before begging again.`,ephemeral:true});
      s.lastBegTime=now;
      const givingResps=BEG_RESPONSES.filter(r=>r.give);
      const failResps=BEG_RESPONSES.filter(r=>!r.give);
      const success=isOwner||Math.random()<(CONFIG.beg_success_chance/100);
      const resp=success?pick(givingResps):pick(failResps);
      let coins=isOwner?resp.hi:(success?r(resp.lo,resp.hi):0);
      const fx=activeEffects.get(interaction.user.id)||{};
      const hasCharm=fx.lucky_charm_expiry&&fx.lucky_charm_expiry>now;
      if(hasCharm&&coins>0)coins=Math.floor(coins*(1+CONFIG.lucky_charm_bonus/100));
      s.coins+=coins;
      saveData();
      const charmTag=hasCharm&&coins>0?" 🍀 +"+CONFIG.lucky_charm_bonus+"%":"";
      return safeReply(interaction,resp.msg.replace("{c}",coins)+(coins>0?`\n💰 Balance: **${s.coins}**`+charmTag:""));
    }
    if(cmd==="crime"){
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.crime_cooldown_ms-(now-s.lastCrimeTime);
      if(!isOwner&&rem>0)return safeReply(interaction,{content:`⏰ Lay low for **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastCrimeTime=now;
      const successResps=CRIME_RESPONSES.filter(r=>r.success);
      const failResps2=CRIME_RESPONSES.filter(r=>!r.success);
      const crimeSuccess=isOwner||Math.random()<(CONFIG.crime_success_chance/100);
      const resp=crimeSuccess?pick(successResps):pick(failResps2);
      let coins=isOwner?resp.hi:r(resp.lo,resp.hi);
      const fx2=activeEffects.get(interaction.user.id)||{};
      const hasCharm=fx2.lucky_charm_expiry&&fx2.lucky_charm_expiry>now;
      // Charm only boosts successful crimes, not fines
      if(hasCharm&&(isOwner||crimeSuccess))coins=Math.floor(coins*(1+CONFIG.lucky_charm_bonus/100));
      if(isOwner||crimeSuccess)s.coins+=coins;else s.coins=Math.max(0,s.coins-coins);
      saveData();
      const charmTag=hasCharm&&(isOwner||crimeSuccess)?" 🍀 +"+CONFIG.lucky_charm_bonus+"%":"";
      return safeReply(interaction,resp.msg.replace("{c}",coins)+`\n💰 Balance: **${s.coins}**`+charmTag);
    }
    if(cmd==="rob"){
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      const target=interaction.options.getUser("user");
      if(target.id===interaction.user.id||target.bot)return safeReply(interaction,{content:"Invalid target.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username),now=Date.now(),rem=CONFIG.rob_cooldown_ms-(now-s.lastRobTime);
      if(!isOwner&&rem>0)return safeReply(interaction,{content:`⏰ Lay low for **${Math.ceil(rem/60000)}m**.`,ephemeral:true});
      s.lastRobTime=now;
      const t=getScore(target.id,target.username);
      if(t.inventory&&t.inventory.includes("shield")){t.inventory.splice(t.inventory.indexOf("shield"),1);saveData();return safeReply(interaction,`🛡️ <@${target.id}> had a **Shield**! Your robbery failed and the shield is now broken.`);}
      if(t.coins<10)return safeReply(interaction,`😅 <@${target.id}> is broke — not worth robbing.`);
      const success=isOwner||Math.random()<(CONFIG.rob_success_chance/100);
      if(success){const pct=isOwner?CONFIG.rob_steal_pct_max:r(CONFIG.rob_steal_pct_min,CONFIG.rob_steal_pct_max);const stolen=Math.floor(t.coins*pct/100);t.coins-=stolen;s.coins+=stolen;saveData();return safeReply(interaction,`🔫 <@${interaction.user.id}> robbed <@${target.id}> and stole **${stolen}** coins!\n💰 Your balance: **${s.coins}**`);}
      else{
        // Check rob_insurance
        const hasInsurance=s.inventory&&s.inventory.includes("rob_insurance");
        if(hasInsurance){s.inventory.splice(s.inventory.indexOf("rob_insurance"),1);saveData();return safeReply(interaction,`🚔 You tried to rob <@${target.id}> and got caught — but your **Rob Insurance 📋** covered the fine! Policy consumed.\n💰 Your balance: **${s.coins}**`);}
        const fine=Math.floor(s.coins*r(CONFIG.rob_fine_pct_min,CONFIG.rob_fine_pct_max)/100);s.coins=Math.max(0,s.coins-fine);saveData();return safeReply(interaction,`🚔 You tried to rob <@${target.id}> but got caught! Lost **${fine}** coins.\n💰 Your balance: **${s.coins}**`);
      }
    }
    if(cmd==="shop"){const lines=Object.entries(getShopItems()).map(([id,item])=>`**${item.name}** (\`${id}\`) — **${item.price}** coins\n> ${item.desc}`);return safeReply(interaction,`🛍️ **Item Shop**\n\n${lines.join("\n\n")}\n\nUse **/buy <item>** to purchase.`);}
    if(cmd==="buy"){
      const itemId=interaction.options.getString("item");
      const item=getShopItems()[itemId];if(!item)return safeReply(interaction,{content:"Unknown item.",ephemeral:true});
      const s=getScore(interaction.user.id,interaction.user.username);
      if(s.coins<item.price)return safeReply(interaction,{content:`You need **${item.price}** coins but only have **${s.coins}**.`,ephemeral:true});
      s.coins-=item.price;

      // Mystery boxes go to inventory — opened with /open
      if(itemId==="mystery_box"||itemId==="item_mystery_box"){
        s.inventory.push(itemId);
        saveData();
        return safeReply(interaction,`✅ Bought **${item.name}** for **${item.price}** coins! Use \`/open\` to open it.\n💰 Balance: **${s.coins}**`);
      }

      // Timed items activate immediately
      if(itemId==="lucky_charm"||itemId==="xp_boost"){
        const fx=activeEffects.get(interaction.user.id)||{};
        const now=Date.now();
        const key=itemId==="lucky_charm"?"lucky_charm_expiry":"xp_boost_expiry";
        // Stack: extend if already active
        const current=fx[key]||now;
        fx[key]=Math.max(current,now)+3600000; // +1hr
        activeEffects.set(interaction.user.id,fx);
        saveData();
        const expiresIn=Math.ceil((fx[key]-now)/60000);
        return safeReply(interaction,`✅ **${item.name}** activated! Effect lasts **${expiresIn} minutes**.\n💰 Balance: **${s.coins}**`);
      }

      // All other items go to inventory (shield, coin_magnet, rob_insurance)
      s.inventory.push(itemId);
      saveData();
      return safeReply(interaction,`✅ Bought **${item.name}** for **${item.price}** coins!\n💰 Balance: **${s.coins}**`);
    }
    if(cmd==="open"){
      const boxId=interaction.options.getString("box");
      const s=getScore(interaction.user.id,interaction.user.username);
      const SHOP=getShopItems();
      const boxName=SHOP[boxId]?.name||boxId;
      // Check inventory
      const idx=s.inventory.indexOf(boxId);
      if(idx===-1)return safeReply(interaction,{content:`❌ You don't have a **${boxName}** in your inventory. Buy one with \`/buy\`!`,ephemeral:true});
      // Remove from inventory
      s.inventory.splice(idx,1);
      // Roll the box
      const result=boxId==="mystery_box"?openMysteryBox():openItemMysteryBox();
      let rewardMsg,rewardDetail;
      if(result.type==="coins"){
        s.coins+=result.coins;
        saveData();
        rewardMsg=`💰 **${result.coins} coins**!`;
        rewardDetail=`💰 Balance: **${s.coins}**`;
      }else{
        const wonName=SHOP[result.itemId]?.name||result.itemId;
        // Timed items activate immediately
        if(result.itemId==="lucky_charm"||result.itemId==="xp_boost"){
          const fx=activeEffects.get(interaction.user.id)||{};
          const key=result.itemId==="lucky_charm"?"lucky_charm_expiry":"xp_boost_expiry";
          const now=Date.now();
          fx[key]=Math.max(fx[key]||now,now)+3600000;
          activeEffects.set(interaction.user.id,fx);
          rewardDetail="✨ Effect activated for 1hr!";
        }else{
          s.inventory.push(result.itemId);
          rewardDetail="🎒 Added to your inventory.";
        }
        saveData();
        rewardMsg=`🎁 **${wonName}**!`;
      }
      const emoji=boxId==="mystery_box"?"📦":"🎲";
      return safeReply(interaction,`${emoji} **${boxName} opened!**\n\nYou got: ${rewardMsg}\n${rewardDetail}`);
    }
    if(cmd==="inventory"){
      const u=interaction.options.getUser("user")||interaction.user;
      const s=getScore(u.id,u.username);
      if(!s.inventory||!s.inventory.length)return safeReply(interaction,`🎒 **${u.username}'s Inventory** is empty.`);
      const counts={};s.inventory.forEach(i=>counts[i]=(counts[i]||0)+1);
      const lines=Object.entries(counts).map(([id,qty])=>`**${getShopItems()[id]?.name||id}** × ${qty}`);
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
      else if(type==="images"){sorted=[...entries].sort(([,a],[,b])=>(b.imagesUploaded||0)-(a.imagesUploaded||0));title=`${titlePrefix} — Images Uploaded 🖼️`;fmt=([,s])=>`${s.imagesUploaded||0} image${(s.imagesUploaded||0)!==1?"s":""}`;}
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
        col.on("collect",async m=>{if(m.content.trim().toLowerCase()===ch.answer.toLowerCase()){col.stop("won");dailyCompletions.add(uid);const s=recordDaily(uid,interaction.user.username);saveData();const bonus=(s.dailyStreak-1)*CONFIG.daily_streak_bonus;await m.reply(`🎉 **Correct!** +${CONFIG.daily_base_coins+bonus} coins\n🔥 Streak: **${s.dailyStreak}**${s.dailyStreak===s.bestStreak&&s.dailyStreak>1?" 🏆 New best!":""}\n💰 Balance: **${s.coins}**`);}else{const ps=getScore(m.author.id,m.author.username);const penalty=CONFIG.daily_wrong_penalty;ps.coins=Math.max(0,ps.coins-penalty);saveData();await m.reply(`❌ Not quite! Keep trying... (-${penalty} coins)\n💰 Balance: **${ps.coins}**`);}});
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
        col.on("collect",async m=>{const guess=parseInt(m.content.trim());attempts++;if(guess===target){col.stop();activeGames.delete(interaction.channelId);recordWin(interaction.user.id,interaction.user.username,CONFIG.win_numberguess);saveData();await m.reply(`🎉 **${target}** in **${attempts}** attempt(s)! (+${CONFIG.win_numberguess} coins)`);}else if(attempts>=10){col.stop();activeGames.delete(interaction.channelId);recordLoss(interaction.user.id,interaction.user.username);saveData();await m.reply(`💀 Out of attempts! It was **${target}**.`);}else await m.reply(guess<target?`📈 Too low! ${10-attempts} left.`:`📉 Too high! ${10-attempts} left.`);});
        col.on("end",(_,reason)=>{if(reason==="idle"){activeGames.delete(interaction.channelId);safeSend(getTargetChannel(interaction),`⏰ Timed out! It was **${target}**.`);}});
        return;
      }
      if(game==="wordscramble"){
        const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
        activeGames.set(interaction.channelId,{type:"wordscramble"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🔀 **Word Scramble!** Unscramble: **\`${scrambled}\`**`);
        const col=targetCh.createMessageCollector({filter:m=>m.author.id===interaction.user.id,idle:60*1000});
        col.on("collect",async m=>{if(m.content.trim().toLowerCase()===word){col.stop();activeGames.delete(interaction.channelId);recordWin(interaction.user.id,interaction.user.username,CONFIG.win_wordscramble);saveData();await m.reply(`🎉 **${word}**! (+${CONFIG.win_wordscramble} coins)`);}else await m.reply("❌ Not quite! Keep trying...");});
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
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim()===answer,max:1,time:30000,errors:["time"]});activeGames.delete(interaction.channelId);const w=col.first().author,l=w.id===interaction.user.id?opp:interaction.user;recordWin(w.id,w.username,CONFIG.win_mathrace);recordLoss(l.id,l.username);saveData();await col.first().reply(`🎉 **${w.username} wins!** Answer: **${answer}** (+${CONFIG.win_mathrace} coins)`);}
        catch{activeGames.delete(interaction.channelId);await safeSend(getTargetChannel(interaction),`⏰ Time's up! Answer: **${answer}**.`);}
        return;
      }
      if(game==="wordrace"){
        const word=pick(HANGMAN_WORDS),scrambled=word.split("").sort(()=>Math.random()-0.5).join("");
        activeGames.set(interaction.channelId,{type:"wordrace"});
        const targetCh=getTargetChannel(interaction);
        await safeReply(interaction,`🏁 **Word Race!** <@${interaction.user.id}> vs <@${opp.id}>\n\nUnscramble: **\`${scrambled}\`**`);
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===word,max:1,time:60000,errors:["time"]});activeGames.delete(interaction.channelId);const w=col.first().author,l=w.id===interaction.user.id?opp:interaction.user;recordWin(w.id,w.username,CONFIG.win_wordrace);recordLoss(l.id,l.username);saveData();await col.first().reply(`🎉 **${w.username} wins!** Word: **${word}** (+${CONFIG.win_wordrace} coins)`);}
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
        try{const col=await targetCh.awaitMessages({filter:m=>[interaction.user.id,opp.id].includes(m.author.id)&&m.content.trim().toLowerCase()===t.correct.toLowerCase(),max:1,time:30000,errors:["time"]});activeGames.delete(interaction.channelId);const winner=col.first().author,loser=winner.id===interaction.user.id?opp:interaction.user;recordWin(winner.id,winner.username,CONFIG.win_trivia);recordLoss(loser.id,loser.username);saveData();await col.first().reply(`🎉 **${winner.username}** wins! Answer: **${t.correct}** (+${CONFIG.win_trivia} coins)`);}
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
              if(s0>s1){recordWin(interaction.user.id,interaction.user.username,CONFIG.win_scramblerace);recordLoss(opp.id,opp.username);txt=`🎉 <@${interaction.user.id}> wins **${s0}–${s1}**! (+${CONFIG.win_scramblerace} coins)`;}
              else if(s1>s0){recordWin(opp.id,opp.username,CONFIG.win_scramblerace);recordLoss(interaction.user.id,interaction.user.username);txt=`🎉 <@${opp.id}> wins **${s1}–${s0}**! (+${CONFIG.win_scramblerace} coins)`;}
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

    if(cmd==="counting"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const action=interaction.options.getString("action");
      const chId=interaction.channelId;
      if(action==="set"){
        if(countingChannels.has(chId)){
          const cc=countingChannels.get(chId);
          return safeReply(interaction,{content:`This channel is already a counting channel! Current count: **${cc.count}** | High score: **${cc.highScore||0}**`,ephemeral:true});
        }
        countingChannels.set(chId,{guildId:interaction.guildId,count:0,lastUserId:null,highScore:0});
        saveData();
        return safeReply(interaction,`🔢 **Counting channel activated!**\n\nThis channel is now a counting channel. Start counting from **1**!\n\n> Numbers only — count one at a time, no counting twice in a row.\n> Mess up and the count resets back to **0**.`);
      }
      if(action==="remove"){
        if(!countingChannels.has(chId))return safeReply(interaction,{content:"This channel is not a counting channel.",ephemeral:true});
        countingChannels.delete(chId);
        saveData();
        return safeReply(interaction,`✅ Counting channel removed from <#${chId}>.`);
      }
      if(action==="status"){
        if(!countingChannels.has(chId))return safeReply(interaction,{content:"This channel is not a counting channel.",ephemeral:true});
        const cc=countingChannels.get(chId);
        return safeReply(interaction,`🔢 **Counting Channel Status**\nCurrent count: **${cc.count}**\nHigh score: **${cc.highScore||0}**\nNext number: **${cc.count+1}**`);
      }
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

      // Fetch quotes folder count from GitHub
      let quotesCount = "?";
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/quotes`,{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        if(ghRes.ok){
          const files = await ghRes.json();
          if(Array.isArray(files)) quotesCount = files.filter(f=>f.type==="file").length;
        }
      } catch(e){ console.error("botstats quotes fetch:",e.message); }

      const content=`**Bot Stats**\nServers: **${client.guilds.cache.size.toLocaleString()}**\nTotal users (across servers): **${totalUsers.toLocaleString()}**\nApp installs (Discord estimate): **${typeof ui==="number"?ui.toLocaleString():ui}**\nTracked app users (interacted outside servers): **${appUserCount}**\n🖼️ Images in quotes folder: **${quotesCount}**\n\n${serverList}`;
      const btn=new MessageActionRow().addComponents(new MessageButton().setCustomId("botstats_users").setLabel(`View App Users (${appUserCount})`).setStyle("SECONDARY").setDisabled(appUserCount===0));
      return safeReply(interaction,{content,components:[btn]});
    }
    if(cmd==="dmuser"){
      await interaction.deferReply({ephemeral:true});
      const userId=interaction.options.getUser("user").id,message=interaction.options.getString("message");
      try{const u=await client.users.fetch(userId);await u.send(message);return safeReply(interaction,"DM sent");}
      catch{return safeReply(interaction,"Could not send DM");}
    }
    if(cmd==="fakemessage"){
      if(!interaction.guildId)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      const target=interaction.options.getUser("user");
      const msgText=interaction.options.getString("message");
      const fileAttach=interaction.options.getAttachment("file");
      if(!msgText&&!fileAttach)return safeReply(interaction,{content:"❌ Provide a message and/or a file.",ephemeral:true});
      try{
        const member=await interaction.guild.members.fetch(target.id).catch(()=>null);
        const displayName=member?.displayName||target.username;
        const avatarURL=target.displayAvatarURL({size:256,dynamic:true});
        const webhooks=await interaction.channel.fetchWebhooks();
        let webhook=webhooks.find(w=>w.owner?.id===CLIENT_ID);
        if(!webhook)webhook=await interaction.channel.createWebhook("RoyalBot Proxy",{avatar:avatarURL});
        const sendOpts={username:displayName,avatarURL};
        if(msgText)sendOpts.content=msgText;
        if(fileAttach)sendOpts.files=[{attachment:fileAttach.url,name:fileAttach.name}];
        await webhook.send(sendOpts);
        return safeReply(interaction,{content:"✅ Message sent.",ephemeral:true});
      }catch(e){return safeReply(interaction,{content:`❌ Failed: ${e.message}`,ephemeral:true});}
    }
    if(cmd==="leaveserver"){const guild=client.guilds.cache.get(interaction.options.getString("server"));if(!guild)return safeReply(interaction,{content:"Server not found.",ephemeral:true});const name=guild.name;await guild.leave();return safeReply(interaction,{content:`Left ${name}`,ephemeral:true});}
    if(cmd==="restart"){await safeReply(interaction,{content:"Restarting…",ephemeral:true});process.exit(0);}
    if(cmd==="setstatus"){const text=interaction.options.getString("text"),type=interaction.options.getString("type")||"PLAYING";client.user.setActivity(text,{type});return safeReply(interaction,{content:`Status → ${type}: ${text}`,ephemeral:true});}
    if(cmd==="adminuser"){
      const target=interaction.options.getUser("user"),field=interaction.options.getString("field"),value=interaction.options.getInteger("value");
      if(!["coins","wins","gamesPlayed","dailyStreak","bestStreak","xp","level","imagesUploaded"].includes(field))return safeReply(interaction,{content:"Invalid field.",ephemeral:true});
      if(value<0)return safeReply(interaction,{content:"Value must be ≥ 0.",ephemeral:true});
      const s=getScore(target.id,target.username),old=s[field];s[field]=value;
      if(field==="dailyStreak"&&value>s.bestStreak)s.bestStreak=value;
      if(field==="xp"||field==="level")xpInfo(s);
      saveData();
      return safeReply(interaction,{content:`✅ **${target.username}**.${field}: \`${old}\` → \`${value}\``,ephemeral:true});
    }
    if(cmd==="adminreset"){
      const target=interaction.options.getUser("user");
      scores.set(target.id,{username:target.username,wins:0,gamesPlayed:0,coins:0,dailyStreak:0,bestStreak:0,lastDailyDate:"",xp:0,level:1,lastWorkTime:0,lastBegTime:0,lastCrimeTime:0,lastRobTime:0,inventory:[],marriedTo:null,pendingProposal:null});
      saveData();
      return safeReply(interaction,{content:`✅ Reset all stats for **${target.username}**.`,ephemeral:true});
    }
    if(cmd==="adminconfig"){
      const key=interaction.options.getString("key"),value=interaction.options.getInteger("value");
      if(!key){
        const groups=[
          ["📈 XP",["xp_per_msg_min","xp_per_msg_max","xp_cooldown_ms"]],
          ["⏱️ Cooldowns (ms)",["work_cooldown_ms","beg_cooldown_ms","crime_cooldown_ms","rob_cooldown_ms"]],
          ["💰 Economy",["daily_base_coins","daily_streak_bonus","daily_wrong_penalty","starting_coins"]],
          ["🎲 Chances (%)",["beg_success_chance","crime_success_chance","rob_success_chance","coinbet_win_chance"]],
          ["🔫 Rob",["rob_steal_pct_min","rob_steal_pct_max","rob_fine_pct_min","rob_fine_pct_max"]],
          ["🎰 Slots",["slots_min_bet","slots_jackpot_mult","slots_bigwin_mult","slots_triple_mult","slots_pair_mult"]],
          ["🃏 BJ & Effects",["blackjack_natural_mult","lucky_charm_bonus","xp_boost_mult","coin_magnet_mult"]],
          ["🛍️ Shop prices",["shop_lucky_charm_price","shop_xp_boost_price","shop_shield_price","shop_coin_magnet_price","shop_mystery_box_price","shop_item_mystery_box_price","shop_rob_insurance_price"]],
          ["📦 Mystery Box weights",["mb_coins_small","mb_coins_large","mb_lucky_charm","mb_xp_boost","mb_shield","mb_coin_magnet","mb_rob_insurance"]],
          ["🎲 Item Box weights",["imb_coins_tiny","imb_coins_small","imb_lucky_charm","imb_xp_boost","imb_shield","imb_coin_magnet","imb_rob_insurance"]],
          ["🎮 Solo wins",["win_hangman","win_snake_per_point","win_minesweeper_easy","win_minesweeper_medium","win_minesweeper_hard","win_numberguess","win_wordscramble"]],
          ["🕹️ 2P wins",["win_ttt","win_c4","win_rps","win_mathrace","win_wordrace","win_trivia","win_scramblerace","win_countgame"]],
          ["🏅 Events",["olympics_win_coins","invite_comp_1st","invite_comp_2nd","invite_comp_3rd","invite_comp_per_invite"]],
        ];
        const fields=groups.map(([g,keys])=>({
          name:g,
          value:keys.map(k=>`\`${k}\` → **${CONFIG[k]}**`).join("\n"),
          inline:false,
        }));
        return safeReply(interaction,{embeds:[{
          title:"⚙️ Global Config",
          description:"Use `/adminconfig key:<name> value:<number>` to edit.\nAll 70 keys shown below.",
          fields,
          color:0x5865F2,
        }],ephemeral:true});
      }
      if(!(key in CONFIG))return safeReply(interaction,{content:`❌ Unknown key \`${key}\`. Run \`/adminconfig\` with no arguments to see all valid keys.`,ephemeral:true});
      if(value==null)return safeReply(interaction,{content:`⚙️ **${key}** = \`${CONFIG[key]}\``,ephemeral:true});
      const old=CONFIG[key];CONFIG[key]=value;
      saveData();
      return safeReply(interaction,{content:`✅ **${key}**: \`${old}\` → \`${value}\``,ephemeral:true});
    }

        if(cmd==="admingive"){
      // Hard OWNER_IDS guard — belt and suspenders on top of ownerOnly array
      if(!OWNER_IDS.includes(interaction.user.id))
        return safeReply(interaction,{content:"❌ Owner only.",ephemeral:true});
      if(!inGuild)
        return safeReply(interaction,{content:"❌ This command only works in servers.",ephemeral:true});

      const target   = interaction.options.getUser("user");
      const action   = interaction.options.getString("action") || "give"; // default to give
      const amount   = interaction.options.getInteger("amount") ?? null;
      const itemId   = interaction.options.getString("item") || null;
      const itemQty  = Math.max(1, interaction.options.getInteger("item_quantity") ?? 1);
      const isGive   = action !== "take";

      if(amount === null && !itemId)
        return safeReply(interaction,{content:"❌ You must provide an `amount`, an `item`, or both.",ephemeral:true});
      if(amount !== null && amount < 0)
        return safeReply(interaction,{content:"❌ Amount must be 0 or positive.",ephemeral:true});

      // Fetch the score — if user isn't tracked yet this creates a fresh entry
      const s    = getScore(target.id, target.username);
      const SHOP = getShopItems();
      const lines = [];

      // ── Coins ──────────────────────────────────────────────────────────────
      if(amount !== null && amount > 0){
        if(isGive){
          s.coins += amount;
          lines.push(`💰 Gave **${amount} coins** → balance now **${s.coins}**`);
        } else {
          const taken = Math.min(amount, s.coins);
          s.coins    -= taken;
          lines.push(`💸 Took **${taken} coins** → balance now **${s.coins}**`);
        }
      }

      // ── Items ───────────────────────────────────────────────────────────────
      if(itemId){
        const itemName = SHOP[itemId]?.name || itemId;

        if(isGive){
          if(itemId === "lucky_charm" || itemId === "xp_boost"){
            // Timed effects — activate directly, each qty = +1hr stacked
            const fx  = activeEffects.get(target.id) || {};
            const key = itemId === "lucky_charm" ? "lucky_charm_expiry" : "xp_boost_expiry";
            const now = Date.now();
            fx[key]   = Math.max(fx[key] || now, now) + 3600000 * itemQty;
            activeEffects.set(target.id, fx);
            const hrsLeft = Math.ceil((fx[key] - now) / 60000);
            lines.push(`✨ Activated **${itemName}** × ${itemQty} → ${hrsLeft}min remaining`);
          } else {
            // All other items go to inventory
            for(let i = 0; i < itemQty; i++) s.inventory.push(itemId);
            lines.push(`🎒 Added **${itemQty}× ${itemName}** to inventory (total: ${s.inventory.filter(x=>x===itemId).length})`);
          }
        } else {
          // Taking items
          if(itemId === "lucky_charm" || itemId === "xp_boost"){
            const fx  = activeEffects.get(target.id) || {};
            const key = itemId === "lucky_charm" ? "lucky_charm_expiry" : "xp_boost_expiry";
            if(!fx[key] || fx[key] < Date.now()){
              return safeReply(interaction,{content:`❌ **${target.username}** doesn't have an active **${itemName}** effect.`,ephemeral:true});
            }
            delete fx[key];
            activeEffects.set(target.id, fx);
            lines.push(`🚫 Removed active **${itemName}** effect`);
          } else {
            let removed = 0;
            for(let i = 0; i < itemQty; i++){
              const idx = s.inventory.indexOf(itemId);
              if(idx === -1) break;
              s.inventory.splice(idx, 1);
              removed++;
            }
            if(removed === 0)
              return safeReply(interaction,{content:`❌ **${target.username}** has no **${itemName}** in their inventory.`,ephemeral:true});
            lines.push(`🗑️ Removed **${removed}× ${itemName}** from inventory (remaining: ${s.inventory.filter(x=>x===itemId).length})`);
          }
        }
      }

      if(!lines.length)
        return safeReply(interaction,{content:"❌ Nothing changed — amount was 0 and no item provided.",ephemeral:true});

      saveData();
      return safeReply(interaction,{
        content:`**Admin action on ${target.username}** (${target.id})\n${lines.join("\n")}`,
        ephemeral:true,
      });
    }

    // Server management extras
    if(cmd==="rolespingfix"){
      const isOwner=OWNER_IDS.includes(interaction.user.id);
      if(!isOwner&&!interaction.member?.permissions.has("MANAGE_GUILD"))return safeReply(interaction,{content:"❌ You need the **Manage Server** permission to use this.",ephemeral:true});
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      const guild=interaction.guild;
      await guild.roles.fetch();
      const dangerous=guild.roles.cache.filter(r=>{
        if(r.managed||r.id===guild.id)return false;
        return r.permissions.has("MENTION_EVERYONE");
      });
      if(!dangerous.size){
        return safeReply(interaction,{embeds:[{
          title:"✅ No dangerous roles found",
          description:"No roles have the **Mention Everyone** permission.",
          color:0x57F287,
        }],ephemeral:true});
      }
      const lines=dangerous.map(r=>`<@&${r.id}> — \`${r.name}\` (ID: ${r.id})`).join("\n");
      const fixBtn=new MessageActionRow().addComponents(
        new MessageButton().setCustomId("rolespingfix_fix").setLabel(`Fix All (${dangerous.size} role${dangerous.size!==1?"s":""})`).setStyle("DANGER").setEmoji("🔧")
      );
      return safeReply(interaction,{embeds:[{
        title:"⚠️ Roles with @everyone Permission",
        description:`The following **${dangerous.size}** role(s) can ping @everyone:\n\n${lines}\n\nClick **Fix All** to remove the Mention Everyone permission from all of them.`,
        color:0xFEE75C,
        footer:{text:"This only removes the Mention Everyone permission — all other permissions stay intact."},
      }],components:[fixBtn],ephemeral:true});
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
      const filter=interaction.options.getString("filter")||null;
      const contains=interaction.options.getString("contains")||null;
      if(amount<1||amount>100)return safeReply(interaction,{content:"Amount must be 1–100.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      try{
        const messages=await interaction.channel.messages.fetch({limit:amount});
        let toDelete=[...messages.values()];
        if(filter==="humans") toDelete=toDelete.filter(m=>!m.author.bot);
        if(filter==="bots")   toDelete=toDelete.filter(m=>m.author.bot);
        if(contains)          toDelete=toDelete.filter(m=>m.content.toLowerCase().includes(contains.toLowerCase()));
        if(!toDelete.length)return safeReply(interaction,{content:"❌ No messages matched your filters.",ephemeral:true});
        const cutoff=Date.now()-(14*24*60*60*1000);
        const fresh=toDelete.filter(m=>m.createdTimestamp>cutoff);
        const old=toDelete.filter(m=>m.createdTimestamp<=cutoff);
        let deletedCount=0;
        // Bulk delete fresh messages (under 14 days)
        if(fresh.length){
          const bulk=await interaction.channel.bulkDelete(fresh,true);
          deletedCount+=bulk.size;
        }
        // One-by-one delete old messages (over 14 days)
        if(old.length){
          await safeReply(interaction,{content:`⏳ Deleting **${old.length}** old message(s) one by one, this may take a moment…`,ephemeral:true});
          for(const m of old){
            await m.delete().catch(()=>{});
            deletedCount++;
            await new Promise(res=>setTimeout(res,1000)); // 1 second delay to avoid rate limits
          }
        }
        const filterDesc=filter?` (${filter} only)`:"";
        const containsDesc=contains?` containing **"${contains}"**`:"";
        return safeReply(interaction,{content:`🗑️ Deleted **${deletedCount}** message(s)${filterDesc}${containsDesc}.`,ephemeral:true});
      }
      catch(e){return safeReply(interaction,{content:`Failed: ${e.message}`,ephemeral:true});}
    }


    // ── YouTube commands ───────────────────────────────────────────────────────
    if(cmd==="ytsetup"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      const input     =interaction.options.getString("channel");
      const discordCh =interaction.options.getChannel("discord_channel");
      const newApiKey =interaction.options.getString("apikey")||null;
      if(discordCh.type!=="GUILD_TEXT")return safeReply(interaction,{content:"❌ Please select a text channel.",ephemeral:true});
      const existing=ytConfig.get(interaction.guildId)||{};
      const apiKey=newApiKey||existing.apiKey||null;
      if(!apiKey)return safeReply(interaction,{content:"❌ No API key found. Provide one with the `apikey:` option.\n\nGet a free key at https://console.cloud.google.com — enable the **YouTube Data API v3**, then create an API key credential.",ephemeral:true});
      const ytChId=await resolveYouTubeChannelId(input,apiKey);
      if(!ytChId)return safeReply(interaction,{content:`❌ Could not find a YouTube channel for \`${input}\`. Try the full URL or a channel ID starting with UC.`,ephemeral:true});
      const stats=await getYouTubeStats(ytChId,apiKey);
      if(!stats)return safeReply(interaction,{content:"❌ Could not fetch stats. Double-check the API key and that YouTube Data API v3 is enabled.",ephemeral:true});
      ytConfig.set(interaction.guildId,{
        ...existing,apiKey,ytChannelId:ytChId,channelTitle:stats.title,
        discordChannelId:discordCh.id,lastSubs:stats.subs,lastSubsTimestamp:Date.now(),
        history:existing.history||[{ts:Date.now(),subs:stats.subs}],
      });
      saveData();
      return safeReply(interaction,{content:`✅ Connected to **${stats.title}** (${fmtSubs(stats.subs)} subs)\nUpdates post to <#${discordCh.id}>.\n${newApiKey?"🔑 API key saved to botdata.\n":""}\nNow use \`/subgoal\`, \`/subcount\`, \`/milestones\`, and \`/growth\`.`,ephemeral:true});
    }

    if(cmd==="subgoal"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const cfg=ytConfig.get(interaction.guildId);
      if(!cfg?.ytChannelId)return safeReply(interaction,{content:"❌ No YouTube channel set up. Use `/ytsetup` first.",ephemeral:true});
      const apiKey=cfg.apiKey;
      if(!apiKey)return safeReply(interaction,{content:"❌ No API key stored. Re-run `/ytsetup` and provide the `apikey:` option.",ephemeral:true});
      const goal=interaction.options.getInteger("goal");
      const goalMessage=interaction.options.getString("message")||null;
      if(goal<1)return safeReply(interaction,{content:"❌ Goal must be at least 1.",ephemeral:true});
      await interaction.deferReply();
      const stats=await getYouTubeStats(cfg.ytChannelId,apiKey);
      if(!stats)return safeReply(interaction,{content:"❌ Could not fetch current sub count."});
      const pct=Math.min(100,Math.round(stats.subs/goal*100));
      const ch=interaction.guild.channels.cache.get(cfg.discordChannelId);
      if(!ch)return safeReply(interaction,{content:"❌ Configured Discord channel not found. Re-run `/ytsetup`."});
      const embedMsg=await ch.send({embeds:[{
        title:`🎯 ${stats.title} — Sub Goal`,
        description:`**${fmtSubs(stats.subs)}** / **${fmtSubs(goal)}**\n\`[${buildBar(stats.subs,goal)}]\` **${pct}%**`,
        color:pct>=100?0x00FF00:0xFF0000,footer:{text:"Updates every 5 minutes"},timestamp:new Date().toISOString(),
      }]});
      cfg.goal=goal;cfg.goalMessage=goalMessage;cfg.goalReached=stats.subs>=goal;
      cfg.goalDiscordId=cfg.discordChannelId;cfg.goalMessageId=embedMsg.id;
      saveData();
      const goalNote=goalMessage?`\nCustom goal message saved: _"${goalMessage}"_`:"";
      return safeReply(interaction,{content:`✅ Sub goal set to **${fmtSubs(goal)}**! Progress bar posted in <#${cfg.discordChannelId}>.${goalNote}`});
    }

    if(cmd==="subcount"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const cfg=ytConfig.get(interaction.guildId);
      if(!cfg?.ytChannelId)return safeReply(interaction,{content:"❌ No YouTube channel set up. Use `/ytsetup` first.",ephemeral:true});
      const apiKey=cfg.apiKey;
      if(!apiKey)return safeReply(interaction,{content:"❌ No API key stored. Re-run `/ytsetup` with `apikey:`.",ephemeral:true});
      const threshold=parseInt(interaction.options.getString("threshold"));
      await interaction.deferReply();
      const stats=await getYouTubeStats(cfg.ytChannelId,apiKey);
      if(!stats)return safeReply(interaction,{content:"❌ Could not fetch current sub count."});
      const ch=interaction.guild.channels.cache.get(cfg.discordChannelId);
      if(!ch)return safeReply(interaction,{content:"❌ Configured Discord channel not found. Re-run `/ytsetup`."});
      const rounded=Math.floor(stats.subs/threshold)*threshold;
      const embedMsg=await ch.send({embeds:[{
        title:`📊 ${stats.title} — Live Sub Count`,
        description:`## ${fmtSubs(stats.subs)}\n*~${fmtSubs(rounded)} (rounded to nearest ${fmtSubs(threshold)})*`,
        color:0xFF0000,footer:{text:"Updates every 5 minutes"},timestamp:new Date().toISOString(),
      }]});
      cfg.subcountDiscordId=cfg.discordChannelId;cfg.subcountMessageId=embedMsg.id;cfg.subcountThreshold=threshold;
      saveData();
      return safeReply(interaction,{content:`✅ Live sub count posted in <#${cfg.discordChannelId}>. Updates every 5 minutes, rounded to nearest **${fmtSubs(threshold)}**.`});
    }

    if(cmd==="milestones"){
      if(!inGuild)return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const cfg=ytConfig.get(interaction.guildId);
      if(!cfg?.ytChannelId)return safeReply(interaction,{content:"❌ No YouTube channel set up. Use `/ytsetup` first.",ephemeral:true});
      const action=interaction.options.getString("action");
      if(!cfg.milestones)cfg.milestones=[];
      if(!cfg.milestoneDiscordId)cfg.milestoneDiscordId=cfg.discordChannelId;
      if(action==="list"){
        if(!cfg.milestones.length)return safeReply(interaction,{content:"No milestones set yet. Use `/milestones action:Add milestone subs:…`.",ephemeral:true});
        const lines=cfg.milestones.map(m=>`${m.reached?"✅":"⏳"} **${fmtSubs(m.subs)} subs**${m.message?` — _${m.message}_`:""}`);
        return safeReply(interaction,{content:`🏆 **Milestones for ${cfg.channelTitle||"your channel"}**\nAnnouncements → <#${cfg.milestoneDiscordId}>\n\n${lines.join("\n")}`,ephemeral:true});
      }
      const subs=interaction.options.getInteger("subs");
      if(!subs)return safeReply(interaction,{content:"❌ Please provide a `subs` value.",ephemeral:true});
      if(action==="add"){
        if(cfg.milestones.find(m=>m.subs===subs))return safeReply(interaction,{content:`❌ A milestone at ${fmtSubs(subs)} already exists.`,ephemeral:true});
        const message=interaction.options.getString("message")||null;
        cfg.milestones.push({subs,message,reached:(cfg.lastSubs||0)>=subs});
        cfg.milestones.sort((a,b)=>a.subs-b.subs);
        saveData();
        const addedNote=message?` — "${message}"`:"";
        return safeReply(interaction,{content:`✅ Milestone added: **${fmtSubs(subs)} subs**${addedNote}`});
      }
      if(action==="remove"){
        const before=cfg.milestones.length;
        cfg.milestones=cfg.milestones.filter(m=>m.subs!==subs);
        if(cfg.milestones.length===before)return safeReply(interaction,{content:`❌ No milestone found at ${fmtSubs(subs)}.`,ephemeral:true});
        saveData();
        return safeReply(interaction,{content:`✅ Milestone at **${fmtSubs(subs)}** removed.`});
      }
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
      if(ticket.status==="closed")return safeReply(interaction,{content:"This ticket is already closed.",ephemeral:true});
      const cfg=ticketConfigs.get(ticket.guildId);
      const isStaff=OWNER_IDS.includes(interaction.user.id)||(cfg?.supportRoleIds||[cfg?.supportRoleId]).filter(Boolean).some(rid=>interaction.member.roles.cache.has(rid))||interaction.member.permissions.has("MANAGE_CHANNELS");
      const canClose=ticket.userId===interaction.user.id||isStaff;
      if(!canClose)return safeReply(interaction,{content:"You don't have permission to close this ticket.",ephemeral:true});
      try{await interaction.channel.permissionOverwrites.edit(ticket.userId,{VIEW_CHANNEL:false,SEND_MESSAGES:false});}catch{}
      ticket.status="closed";
      ticket.closedBy=interaction.user.id;
      ticket.closedAt=Date.now();
      saveData();
      const staffRow=new MessageActionRow().addComponents(
        new MessageButton().setCustomId("ticket_reopen").setLabel("Reopen 🔓").setStyle("SUCCESS"),
        new MessageButton().setCustomId("ticket_delete").setLabel("Delete Ticket 🗑️").setStyle("DANGER"),
      );
      return safeReply(interaction,{content:`🔒 **Ticket #${ticket.ticketId} closed** by <@${interaction.user.id}>.\n\n*<@${ticket.userId}> no longer has access.*\n**Staff:** Use the buttons below to reopen or permanently delete this ticket.`,components:[staffRow]});
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
        const medals=["🥇","🥈","🥉"],rewards=[CONFIG.invite_comp_1st,CONFIG.invite_comp_2nd,CONFIG.invite_comp_3rd];
        const top=sorted.slice(0,3);
        const lines=top.map(([id,d],i)=>`${medals[i]} <@${id}> — **${d.count}** invite${d.count!==1?"s":""} (+${rewards[i]} coins)`);
        top.forEach(([id,d],i)=>{getScore(id,d.username).coins+=rewards[i];});
        saveData();
        await safeSend(ch,`🏆 **Invite Competition Ended!**\n\n${lines.join("\n")}`);
      },hours*3600000);
      return;
    }
    if(cmd==="library"){
      if(!inGuild) return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const targetUser = interaction.options.getUser("user");
      const targetScore = getScore(targetUser.id, targetUser.username);
      const files = targetScore.uploadedImages || [];
      if(!files.length)
        return safeReply(interaction,{content:`📭 **${targetUser.username}** hasn't uploaded any images yet.`,ephemeral:true});
      const idx = 0;
      const fileName = files[idx];
      const imageUrl = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(fileName)}`;
      const row = new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`lib_prev_${targetUser.id}_${idx}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(true),
        new MessageButton().setCustomId(`lib_next_${targetUser.id}_${idx}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(files.length<=1),
      );
      return safeReply(interaction,{
        content:`🖼️ **${targetUser.username}'s Library** — Image ${idx+1} of ${files.length}\n**\`${fileName}\`**\n${imageUrl}`,
        components:[row]
      });
    }

    if(cmd==="managememers"){
      if(!OWNER_IDS.includes(interaction.user.id))
        return safeReply(interaction,{content:"❌ Owner only.",ephemeral:true});
      const action = interaction.options.getString("action");
      const target = interaction.options.getUser("user")||null;

      if(action==="list"){
        const list = [...MEMERS].map(id=>`<@${id}>`).join("\n")||"*(none)*";
        return safeReply(interaction,{content:`📋 **Upload allowlist (${MEMERS.size}):**\n${list}`,ephemeral:true});
      }

      if(!target)
        return safeReply(interaction,{content:"❌ Provide a user for add/remove.",ephemeral:true});

      if(action==="add"){
        if(MEMERS.has(target.id))
          return safeReply(interaction,{content:`ℹ️ <@${target.id}> is already in the allowlist.`,ephemeral:true});
        MEMERS.add(target.id);
        saveData();
        return safeReply(interaction,{content:`✅ Added <@${target.id}> to the upload allowlist.`,ephemeral:true});
      }

      if(action==="remove"){
        if(!MEMERS.has(target.id))
          return safeReply(interaction,{content:`ℹ️ <@${target.id}> isn't in the allowlist.`,ephemeral:true});
        MEMERS.delete(target.id);
        saveData();
        return safeReply(interaction,{content:`✅ Removed <@${target.id}> from the upload allowlist.`,ephemeral:true});
      }

      return safeReply(interaction,{content:"❌ Unknown action.",ephemeral:true});
    }


    // ── /dailyquote ────────────────────────────────────────────────────────────
    if(cmd==="dailyquote"){
      if(!inGuild) return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const action  = interaction.options.getString("action");
      const channel = interaction.options.getChannel("channel")||null;
      const hour    = interaction.options.getInteger("hour")??9;

      if(action==="disable"){
        dailyQuoteChannels.delete(interaction.guildId);
        saveData();
        return safeReply(interaction,{content:"🔇 Daily quote **disabled** for this server.",ephemeral:true});
      }

      if(action==="status"){
        const cfg = dailyQuoteChannels.get(interaction.guildId);
        if(!cfg) return safeReply(interaction,{content:"❌ No daily quote set up in this server. Use `/dailyquote action:Set channel` to enable it.",ephemeral:true});
        return safeReply(interaction,{content:`📅 **Daily Quote Status**\n📢 Channel: <#${cfg.channelId}>\n🕐 Posts at: **${cfg.hour}:00 UTC** every day`,ephemeral:true});
      }

      // action === "set"
      if(!channel) return safeReply(interaction,{content:"❌ Please provide a `channel` when using Set channel.",ephemeral:true});
      if(channel.type!=="GUILD_TEXT") return safeReply(interaction,{content:"❌ Please select a text channel.",ephemeral:true});
      if(hour<0||hour>23) return safeReply(interaction,{content:"❌ Hour must be between 0 and 23 (UTC).",ephemeral:true});
      const perms = channel.permissionsFor(interaction.guild.me);
      if(!perms||!perms.has("SEND_MESSAGES")||!perms.has("ATTACH_FILES"))
        return safeReply(interaction,{content:`❌ I don't have permission to send files in <#${channel.id}>.`,ephemeral:true});
      dailyQuoteChannels.set(interaction.guildId,{channelId:channel.id, hour});
      saveData();
      return safeReply(interaction,{content:`✅ **Daily quote enabled!**\n📢 Channel: <#${channel.id}>\n🕐 Posts at: **${hour}:00 UTC** every day`,ephemeral:true});
    }

    // ── /quotemanage — owner only, paginated image browser with inline delete ──
    if(cmd==="quotemanage"){
      if(!OWNER_IDS.includes(interaction.user.id))
        return safeReply(interaction,{content:"❌ Owner only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      try {
        const listRes = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes",{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        if(!listRes.ok) return safeReply(interaction,{content:`❌ GitHub API error (HTTP ${listRes.status}).`,ephemeral:true});
        const files = await listRes.json();
        const images = files.filter(f=>f.type==="file"&&/\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if(!images.length) return safeReply(interaction,{content:"📭 No images in the quotes folder.",ephemeral:true});
        const startIdx = Math.max(0, Math.min((interaction.options.getInteger("index")||1)-1, images.length-1));
        const file = images[startIdx];
        const imageUrl = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(file.name)}`;
        const navRow = new MessageActionRow().addComponents(
          new MessageButton().setCustomId(`qm_prev_${startIdx}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(startIdx===0),
          new MessageButton().setCustomId(`qm_next_${startIdx}_${images.length}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(startIdx>=images.length-1),
          new MessageButton().setCustomId(`qm_delete_${file.name}`).setLabel("🗑️ Delete This").setStyle("DANGER"),
        );
        return safeReply(interaction,{
          content:`🖼️ **Quote Manager** — ${startIdx+1} of ${images.length}\n\`${file.name}\`\n${imageUrl}`,
          components:[navRow],
        });
      } catch(e) {
        console.error("quotemanage error:",e);
        return safeReply(interaction,{content:"❌ Something went wrong.",ephemeral:true});
      }
    }

    if(cmd==="quotelist"){
      if(!OWNER_IDS.includes(interaction.user.id))
        return safeReply(interaction,{content:"❌ Owner only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      try {
        const listRes = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes",{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        if(!listRes.ok) return safeReply(interaction,{content:`❌ GitHub API error (HTTP ${listRes.status}).`,ephemeral:true});
        const files = await listRes.json();
        const images = files.filter(f => f.type==="file" && /\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if(!images.length) return safeReply(interaction,{content:"📭 No images in the quotes folder.",ephemeral:true});
        // Split into chunks of 50 filenames per message to stay under Discord's 2000 char limit
        const names = images.map((f,i) => `${i+1}. \`${f.name}\``);
        const chunks = [];
        let chunk = [];
        for(const line of names){
          if((chunk.join("\n").length + line.length + 1) > 1800){ chunks.push(chunk); chunk = []; }
          chunk.push(line);
        }
        if(chunk.length) chunks.push(chunk);
        await safeReply(interaction,{content:`🖼️ **Quotes folder — ${images.length} image${images.length!==1?"s":""}:**\n${chunks[0].join("\n")}`,ephemeral:true});
        for(let i=1;i<chunks.length;i++){
          await interaction.followUp({content:chunks[i].join("\n"),ephemeral:true}).catch(()=>{});
        }
        return;
      } catch(e) {
        console.error("quotelist error:",e);
        return safeReply(interaction,{content:"❌ Something went wrong fetching the quotes list.",ephemeral:true});
      }
    }

    if(cmd==="quotedelete"){
      if(!OWNER_IDS.includes(interaction.user.id))
        return safeReply(interaction,{content:"❌ Owner only.",ephemeral:true});
      const fileName = interaction.options.getString("filename").trim();
      await interaction.deferReply({ephemeral:true});
      try {
        const ghPath = `quotes/${fileName}`;
        // Fetch the file's SHA (required for deletion)
        const checkRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        if(checkRes.status===404) return safeReply(interaction,{content:`❌ File \`${fileName}\` not found in the quotes folder.`,ephemeral:true});
        if(!checkRes.ok) return safeReply(interaction,{content:`❌ GitHub API error (HTTP ${checkRes.status}).`,ephemeral:true});
        const fileData = await checkRes.json();
        const sha = fileData.sha;
        if(!sha) return safeReply(interaction,{content:"❌ Couldn't retrieve file SHA for deletion.",ephemeral:true});
        // Delete the file
        const delRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
          method:"DELETE",
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json","Content-Type":"application/json"},
          body: JSON.stringify({ message:`chore: delete quote image ${fileName} via Discord`, sha })
        });
        if(!delRes.ok){
          const err = await delRes.text();
          console.error("quotedelete GitHub error:",err);
          return safeReply(interaction,{content:`❌ GitHub delete failed (HTTP ${delRes.status}).`,ephemeral:true});
        }
        // Remove from any user's uploadedImages list so their library stays accurate
        for(const [,s] of scores){
          if(Array.isArray(s.uploadedImages) && s.uploadedImages.includes(fileName)){
            s.uploadedImages = s.uploadedImages.filter(n=>n!==fileName);
          }
        }
        saveData();
        return safeReply(interaction,{content:`🗑️ \`${fileName}\` deleted from the quotes folder.`,ephemeral:true});
      } catch(e) {
        console.error("quotedelete error:",e);
        return safeReply(interaction,{content:"❌ Something went wrong during deletion.",ephemeral:true});
      }
    }

    if(cmd==="upload"){
      // Both source and link are restricted to MEMERS
      if(!MEMERS.has(interaction.user.id))
        return safeReply(interaction,{content:"❌ You don't have permission to use /upload.",ephemeral:true});

      const attachment = interaction.options.getAttachment("source")||null;
      const link       = interaction.options.getString("link")||null;

      if(!attachment && !link)
        return safeReply(interaction,{content:"❌ Provide either a file (source) or a URL (link).",ephemeral:true});

      await interaction.deferReply({ephemeral:true});

      try {
        let fileBuffer, fileName;

        if(attachment){
          if(!/^image\//i.test(attachment.contentType||""))
            return safeReply(interaction,{content:"❌ Attachment must be an image file.",ephemeral:true});
          const res = await fetch(attachment.url);
          if(!res.ok) return safeReply(interaction,{content:"❌ Failed to download the attachment.",ephemeral:true});
          fileBuffer = Buffer.from(await res.arrayBuffer());
          fileName   = attachment.name;
        } else {
          let parsedUrl;
          try { parsedUrl = new URL(link); } catch { return safeReply(interaction,{content:"❌ That doesn't look like a valid URL.",ephemeral:true}); }
          if(!/^https?:/.test(parsedUrl.protocol)) return safeReply(interaction,{content:"❌ URL must be http or https.",ephemeral:true});
          const res = await fetch(link);
          if(!res.ok) return safeReply(interaction,{content:"❌ Couldn't fetch the image from that URL.",ephemeral:true});
          const ct = res.headers.get("content-type")||"";
          if(!/^image\//i.test(ct)) return safeReply(interaction,{content:"❌ That URL doesn't point to an image.",ephemeral:true});
          fileBuffer = Buffer.from(await res.arrayBuffer());
          const pathParts = parsedUrl.pathname.split("/");
          fileName = pathParts[pathParts.length-1]||"image.jpg";
          if(!/\.(png|jpe?g|gif|webp)$/i.test(fileName)) fileName += ".jpg";
        }

        const ghPath  = `quotes/${fileName}`;
        const encoded = fileBuffer.toString("base64");

        if(fileBuffer.length > 1_000_000)
          return safeReply(interaction,{content:`❌ File is too large (${(fileBuffer.length/1024/1024).toFixed(1)} MB). GitHub's API only accepts images under 1 MB.`,ephemeral:true});

        const checkRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
          headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,"Accept":"application/vnd.github+json"}
        });
        let sha = null;
        if(checkRes.ok){ const j=await checkRes.json(); sha=j.sha||null; }

        const putRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`,{
          method:"PUT",
          headers:{
            "User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`,
            "Accept":"application/vnd.github+json","Content-Type":"application/json"
          },
          body: JSON.stringify({
            message:`feat: upload quote image ${fileName} via Discord`,
            content: encoded,
            ...(sha?{sha}:{})
          })
        });

        if(!putRes.ok){
          const err = await putRes.text();
          console.error("GitHub upload failed:",err);
          return safeReply(interaction,{content:`❌ GitHub upload failed (HTTP ${putRes.status}).`,ephemeral:true});
        }

        const s = getScore(interaction.user.id, interaction.user.username);
        s.imagesUploaded = (s.imagesUploaded || 0) + 1;
        if (!Array.isArray(s.uploadedImages)) s.uploadedImages = [];
        if (!s.uploadedImages.includes(fileName)) s.uploadedImages.push(fileName);
        saveData();
        return safeReply(interaction,{content:`✅ \`${fileName}\` uploaded to the quotes folder!`,ephemeral:true});
      } catch(e) {
        console.error("upload error:",e);
        return safeReply(interaction,{content:"❌ Something went wrong during upload.",ephemeral:true});
      }
    }

    if(cmd==="activity-check"){
      if(!inGuild) return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const hasPerms = OWNER_IDS.includes(interaction.user.id)||interaction.member.permissions.has("MANAGE_GUILD");
      if(!hasPerms) return safeReply(interaction,{content:"❌ You need Manage Server permission.",ephemeral:true});

      const channel    = interaction.options.getChannel("channel");
      const deadlineHr = interaction.options.getInteger("deadline")??24;
      const customMsg  = interaction.options.getString("message")||null;
      const doPing     = interaction.options.getBoolean("ping")??true;
      const scheduleStr= interaction.options.getString("schedule")||null;

      // If a schedule string is provided, parse and save it — then go through role selection
      const parsedSchedule = scheduleStr ? parseSchedule(scheduleStr) : null;
      if (scheduleStr && !parsedSchedule) {
        return safeReply(interaction,{content:"❌ Couldn't parse that schedule. Use a format like `Monday 09:00` or `Wed 14:30` (UTC).",ephemeral:true});
      }

      // Build role list for dropdowns — cap at 25, exclude @everyone and managed roles
      const cfg = raConfig.get(interaction.guildId)||{};
      const excludedByDefault = new Set([cfg.raRoleId, cfg.loaRoleId].filter(Boolean));
      const allRoles = [...interaction.guild.roles.cache.values()]
        .filter(r => r.id !== interaction.guild.id && !r.managed)
        .sort((a,b) => b.position - a.position)
        .slice(0, 25);

      if(!allRoles.length) return safeReply(interaction,{content:"❌ No assignable roles found in this server.",ephemeral:true});

      const makeOptions = (selectedIds=[]) => allRoles.map(r => ({
        label: r.name.slice(0,25),
        value: r.id,
        default: selectedIds.includes(r.id),
      }));

      const requiredMenu = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId(`ac_required_${channel.id}_${deadlineHr}_${doPing}`)
          .setPlaceholder("Select required roles (staff who must check in)")
          .setMinValues(1).setMaxValues(Math.min(allRoles.length,25))
          .addOptions(makeOptions())
      );
      const excludedMenu = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId(`ac_excluded_${channel.id}_${deadlineHr}_${doPing}`)
          .setPlaceholder("Select excluded roles (optional — RA/LOA auto-excluded)")
          .setMinValues(0).setMaxValues(Math.min(allRoles.length,25))
          .addOptions(makeOptions([...excludedByDefault]))
      );
      const msgLine = customMsg ? `\n📝 Message: *${customMsg}*` : "";
      const schedLine = parsedSchedule ? `\n🕐 Schedule: **${scheduleStr}** (UTC, weekly)` : "";
      await safeReply(interaction,{
        content:`📋 **Activity Check Setup**\nChannel: ${channel}\nDeadline: **${deadlineHr}h**${msgLine}${schedLine}\n\nSelect the roles below, then click **Send Check** once both dropdowns are set.`,
        components:[requiredMenu, excludedMenu],
        ephemeral:true
      });
      // Store pending config keyed by user so the select handler can retrieve it
      if(!interaction.client._acPending) interaction.client._acPending = new Map();
      interaction.client._acPending.set(interaction.user.id, { channel, deadlineHr, customMsg, doPing, requiredIds:[], excludedIds:[...excludedByDefault], parsedSchedule, scheduleStr });
      return;
    }

    if(cmd==="raconfig"){
      if(!inGuild) return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const hasPerms = OWNER_IDS.includes(interaction.user.id)||interaction.member.permissions.has("MANAGE_GUILD");
      if(!hasPerms) return safeReply(interaction,{content:"❌ You need Manage Server permission.",ephemeral:true});
      const action = interaction.options.getString("action");
      const roleArg = interaction.options.getRole("role")||null;
      const cfg = raConfig.get(interaction.guildId)||{};

      if(action==="view"){
        const raRole  = cfg.raRoleId  ? interaction.guild.roles.cache.get(cfg.raRoleId)  : null;
        const loaRole = cfg.loaRoleId ? interaction.guild.roles.cache.get(cfg.loaRoleId) : null;
        return safeReply(interaction,{content:[
          `📋 **RA/LOA Config for ${interaction.guild.name}**`,
          `🟡 Reduced Activity role: ${raRole?`<@&${raRole.id}> (${raRole.name})`:"Not set"}`,
          `🔴 LOA role: ${loaRole?`<@&${loaRole.id}> (${loaRole.name})`:"Not set"}`,
        ].join("\n"),ephemeral:true});
      }

      if(action==="create"){
        await interaction.deferReply({ephemeral:true});
        try {
          const raRole  = await interaction.guild.roles.create({name:"Reduced Activity",color:"Yellow",reason:"RoyalBot RA/LOA setup"});
          const loaRole = await interaction.guild.roles.create({name:"LOA",color:"Red",reason:"RoyalBot RA/LOA setup"});
          raConfig.set(interaction.guildId,{raRoleId:raRole.id,loaRoleId:loaRole.id});
          saveData();
          return safeReply(interaction,{content:`✅ Created <@&${raRole.id}> and <@&${loaRole.id}>. All set!`,ephemeral:true});
        } catch(e) {
          return safeReply(interaction,{content:`❌ Failed to create roles: ${e.message}`,ephemeral:true});
        }
      }

      if(action==="set_ra"){
        if(!roleArg) return safeReply(interaction,{content:"❌ Provide a role.",ephemeral:true});
        cfg.raRoleId = roleArg.id;
        raConfig.set(interaction.guildId,cfg);
        saveData();
        return safeReply(interaction,{content:`✅ Reduced Activity role set to <@&${roleArg.id}>.`,ephemeral:true});
      }

      if(action==="set_loa"){
        if(!roleArg) return safeReply(interaction,{content:"❌ Provide a role.",ephemeral:true});
        cfg.loaRoleId = roleArg.id;
        raConfig.set(interaction.guildId,cfg);
        saveData();
        return safeReply(interaction,{content:`✅ LOA role set to <@&${roleArg.id}>.`,ephemeral:true});
      }

      return safeReply(interaction,{content:"❌ Unknown action.",ephemeral:true});
    }

    if(cmd==="reduced-activity"||cmd==="loa"){
      if(!inGuild) return safeReply(interaction,{content:"Server only.",ephemeral:true});
      const hasPerms = OWNER_IDS.includes(interaction.user.id)||interaction.member.permissions.has("MANAGE_ROLES");
      if(!hasPerms) return safeReply(interaction,{content:"❌ You need Manage Roles permission.",ephemeral:true});

      const cfg = raConfig.get(interaction.guildId)||{};
      const isRA = cmd==="reduced-activity";
      const roleId = isRA ? cfg.raRoleId : cfg.loaRoleId;
      const roleLabel = isRA ? "Reduced Activity" : "LOA";
      if(!roleId) return safeReply(interaction,{content:`❌ The ${roleLabel} role hasn't been set up. Run \`/raconfig\` first.`,ephemeral:true});

      const role = interaction.guild.roles.cache.get(roleId);
      if(!role) return safeReply(interaction,{content:`❌ The configured ${roleLabel} role no longer exists. Run \`/raconfig\` to set it again.`,ephemeral:true});

      const target   = interaction.options.getUser("user");
      const action   = interaction.options.getString("action");
      const duration = interaction.options.getInteger("duration")||null; // hours

      const member = await interaction.guild.members.fetch(target.id).catch(()=>null);
      if(!member) return safeReply(interaction,{content:"❌ Couldn't find that member.",ephemeral:true});

      const timerKey = `${interaction.guildId}:${target.id}:${cmd}`;

      if(action==="give"){
        try { await member.roles.add(role); } catch(e) { return safeReply(interaction,{content:`❌ Failed to add role: ${e.message}`,ephemeral:true}); }
        // Cancel any existing timer for this user+type
        if(raTimers.has(timerKey)){ clearTimeout(raTimers.get(timerKey)); raTimers.delete(timerKey); }
        let reply = `✅ Gave <@&${roleId}> to <@${target.id}>.`;
        if(duration){
          const ms = duration*3600000;
          const t = setTimeout(async()=>{
            raTimers.delete(timerKey);
            const m = await interaction.guild.members.fetch(target.id).catch(()=>null);
            if(m) await m.roles.remove(roleId).catch(()=>{});
          }, ms);
          raTimers.set(timerKey, t);
          reply += ` Role will be removed automatically <t:${Math.floor((Date.now()+ms)/1000)}:R>.`;
        }
        return safeReply(interaction,{content:reply,ephemeral:true});
      }

      if(action==="remove"){
        // Cancel timer if any
        if(raTimers.has(timerKey)){ clearTimeout(raTimers.get(timerKey)); raTimers.delete(timerKey); }
        try { await member.roles.remove(role); } catch(e) { return safeReply(interaction,{content:`❌ Failed to remove role: ${e.message}`,ephemeral:true}); }
        return safeReply(interaction,{content:`✅ Removed <@&${roleId}> from <@${target.id}>.`,ephemeral:true});
      }

      return safeReply(interaction,{content:"❌ Unknown action.",ephemeral:true});
    }

    // Count game
  }catch(err){
    console.error("Command error:",err);
    safeReply(interaction,{content:"An error occurred.",ephemeral:true});
  }
});

client.login(TOKEN);
