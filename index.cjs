"use strict";
const { Client, Intents, MessageActionRow, MessageButton, MessageSelectMenu, MessageEmbed } = require("discord.js");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_IDS = ["1419803002771865722","969280648667889764"];
const OWNER_ID  = OWNER_IDS[1];
const GAY_IDS   = ["1245284545452834857","1413943805203189800","1057320311453913149","1193150033864949811"];
const MEMERS    = new Set(["1419803002771865722","1259223683826712729","1254388539890860083","1082452773787942922","1193150033864949811","1413943805203189800","969280648667889764","690219723472109616"]);

// ── Instance lock ──────────────────────────────────────────────────────────────
const INSTANCE_ID  = Math.random().toString(36).slice(2,8);
const LOCK_PREFIX  = "BOT_INSTANCE_LOCK:";
let   instanceLocked = false;

async function acquireInstanceLock(ownerUser) {
  try {
    const dm     = await ownerUser.createDM();
    const recent = await dm.messages.fetch({ limit:20 });
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

// ── State ──────────────────────────────────────────────────────────────────────
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
const countingChannels = new Map();
const shadowDelete     = new Map();
const clankerify       = new Map();
const inviteComps      = new Map();
const inviteCache      = new Map();
const ticketConfigs    = new Map();
const openTickets      = new Map();
const premieres        = new Map();
const disabledLevelUp  = new Set();
const userInstalls     = new Set();
const activityChecks   = new Map();
const scheduledChecks  = new Map();
const raConfig         = new Map();
const raTimers         = new Map();
const levelUpConfig    = new Map();
const dailyQuoteChannels = new Map();
const quoteCooldown    = new Map();
const ytConfig         = new Map();
const marriageProposals = new Map();
const scores           = new Map();
const activeEffects    = new Map();
const xpCooldown       = new Map();

// ── Economy state ──────────────────────────────────────────────────────────────
const bankAccounts     = new Map(); // userId -> { balance, lastInterest }
const heists           = new Map(); // channelId -> { organizer, members, pot, timer, msgId }
const fishCooldown     = new Map();
const mineCooldown     = new Map();
const tradePending     = new Map(); // `${senderId}:${targetId}` -> { coins, items, expiresAt }
const coinflipDuels    = new Map(); // messageId -> { challengerId, targetId, bet }
const lottery          = { tickets: new Map(), jackpot: 500, lastDraw: 0, drawMessageId: null, drawChannelId: null };

// ── Quote system ───────────────────────────────────────────────────────────────
let quoteQueue    = [];
let quoteFetching = false;
let goodQuoteQueue = [], goodQuoteFetching = false;
let badQuoteQueue  = [], badQuoteFetching  = false;
const quoteVotes = new Map();
const quoteVoteMessages = new Map();
let reviewChannelId = null;

function shuffleArray(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}
function weightedShuffleQuotes(images) {
  const BASE=10, weighted=[];
  for (const img of images) {
    const v=quoteVotes.get(img.name)||{up:0,down:0};
    const w=Math.max(1,BASE+v.up-v.down);
    for (let i=0;i<w;i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}
function goodShuffleQuotes(images) {
  const BASE=10, weighted=[];
  for (const img of images) {
    const v=quoteVotes.get(img.name)||{up:0,down:0};
    const net=v.up-v.down;
    const w=net>0?Math.max(1,BASE+net*3):Math.max(1,Math.floor(BASE/3));
    for (let i=0;i<w;i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}
function badShuffleQuotes(images) {
  const BASE=10, weighted=[];
  for (const img of images) {
    const v=quoteVotes.get(img.name)||{up:0,down:0};
    const net=v.up-v.down;
    const w=net<0?Math.max(1,BASE+Math.abs(net)*3):Math.max(1,Math.floor(BASE/3));
    for (let i=0;i<w;i++) weighted.push(img);
  }
  return shuffleArray(weighted);
}
async function refillQuoteQueue() {
  if (quoteFetching) return; quoteFetching=true;
  try {
    const res=await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes`,{headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`}});
    if (!res.ok){quoteFetching=false;return;}
    const files=await res.json();
    const images=files.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) quoteQueue=weightedShuffleQuotes(images);
  } catch(e){console.error("Quote refill failed:",e);}
  quoteFetching=false;
}
async function refillGoodQuoteQueue() {
  if (goodQuoteFetching) return; goodQuoteFetching=true;
  try {
    const res=await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes`,{headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`}});
    if (!res.ok){goodQuoteFetching=false;return;}
    const files=await res.json();
    const images=files.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) goodQuoteQueue=goodShuffleQuotes(images);
  } catch(e){}
  goodQuoteFetching=false;
}
async function refillBadQuoteQueue() {
  if (badQuoteFetching) return; badQuoteFetching=true;
  try {
    const res=await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes`,{headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`}});
    if (!res.ok){badQuoteFetching=false;return;}
    const files=await res.json();
    const images=files.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length) badQuoteQueue=badShuffleQuotes(images);
  } catch(e){}
  badQuoteFetching=false;
}
async function nextQuoteImage() {
  if (quoteQueue.length===0) await refillQuoteQueue();
  if (quoteQueue.length===0) return null;
  if (Math.random()<0.2) {
    try {
      const res=await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes`,{headers:{"User-Agent":"RoyalBot","Authorization":`token ${GH_TOKEN}`}});
      if (res.ok) {
        const files=await res.json();
        const images=files.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.name));
        if (images.length) {
          const candidates=images.filter(img=>{const v=quoteVotes.get(img.name)||{up:0,down:0};return(v.up-v.down)<=0;});
          const pool=candidates.length?candidates:images;
          return pool[Math.floor(Math.random()*pool.length)];
        }
      }
    } catch {}
  }
  return quoteQueue.shift();
}
async function nextGoodQuoteImage() {
  if (goodQuoteQueue.length===0) await refillGoodQuoteQueue();
  return goodQuoteQueue.length ? goodQuoteQueue.shift() : null;
}
async function nextBadQuoteImage() {
  if (badQuoteQueue.length===0) await refillBadQuoteQueue();
  return badQuoteQueue.length ? badQuoteQueue.shift() : null;
}

// ── Score / Economy helpers ────────────────────────────────────────────────────
function getScore(userId, username) {
  if (!scores.has(userId)) scores.set(userId, {
    username, wins:0, gamesPlayed:0, coins:0,
    dailyStreak:0, bestStreak:0, lastDailyDate:"",
    xp:0, level:1,
    lastWorkTime:0, lastBegTime:0, lastCrimeTime:0, lastRobTime:0,
    lastFishTime:0, lastMineTime:0,
    inventory:[], marriedTo:null, pendingProposal:null,
    imagesUploaded:0, uploadedImages:[],
    bio:"", badges:[], profileBackground:"default",
    fishedItems:[], minedItems:[],
    achievements:[],
  });
  const s=scores.get(userId);
  if (username) s.username=username;
  const defaults={
    xp:0,level:1,lastWorkTime:0,lastBegTime:0,lastCrimeTime:0,lastRobTime:0,
    lastFishTime:0,lastMineTime:0,inventory:[],marriedTo:null,pendingProposal:null,
    forceMarried:false,dailyStreak:0,bestStreak:0,lastDailyDate:"",imagesUploaded:0,
    uploadedImages:[],bio:"",badges:[],profileBackground:"default",
    fishedItems:[],minedItems:[],achievements:[],
  };
  for (const [k,v] of Object.entries(defaults)) {
    if (s[k]==null) s[k]=v;
    if (Array.isArray(v)&&!Array.isArray(s[k])) s[k]=v;
  }
  return s;
}
function recordWin(uid,uname,coins=50){const s=getScore(uid,uname);s.wins++;s.gamesPlayed++;s.coins+=coins;}
function recordLoss(uid,uname){const s=getScore(uid,uname);s.gamesPlayed++;}
function recordDraw(uid,uname){const s=getScore(uid,uname);s.gamesPlayed++;s.coins+=10;}

// ── XP ─────────────────────────────────────────────────────────────────────────
function xpForNextLevel(lv){return Math.floor(50*Math.pow(lv,1.5));}
function xpInfo(s){
  let lv=s.level||1,xp=s.xp||0,needed=xpForNextLevel(lv);
  while(xp>=needed){xp-=needed;lv++;needed=xpForNextLevel(lv);}
  s.level=lv;s.xp=xp;return{level:lv,xp,needed};
}
function tryAwardXP(uid,uname){
  const now=Date.now(),last=xpCooldown.get(uid)||0;
  if(now-last<CONFIG.xp_cooldown_ms)return null;
  xpCooldown.set(uid,now);
  const s=getScore(uid,uname);const oldLv=s.level;
  const fx=activeEffects.get(uid)||{};
  const boost=(fx.xp_boost_expiry&&fx.xp_boost_expiry>now)?(CONFIG.xp_boost_mult/100):1;
  s.xp+=r(CONFIG.xp_per_msg_min,CONFIG.xp_per_msg_max)*boost;
  xpInfo(s);
  return s.level>oldLv?s.level:null;
}

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  xp_per_msg_min:5, xp_per_msg_max:15, xp_cooldown_ms:60000,
  work_cooldown_ms:3600000, beg_cooldown_ms:300000,
  crime_cooldown_ms:7200000, rob_cooldown_ms:3600000,
  fish_cooldown_ms:1800000, mine_cooldown_ms:3600000,
  daily_base_coins:100, daily_streak_bonus:10, daily_wrong_penalty:5,
  starting_coins:100,
  beg_success_chance:60, crime_success_chance:57,
  rob_steal_pct_min:10, rob_steal_pct_max:30,
  rob_fine_pct_min:5,   rob_fine_pct_max:15,
  rob_success_chance:45,
  slots_min_bet:1,
  coinbet_win_chance:50,
  slots_jackpot_mult:1000, slots_bigwin_mult:500, slots_triple_mult:300, slots_pair_mult:150,
  blackjack_natural_mult:150,
  lucky_charm_bonus:10, xp_boost_mult:200, coin_magnet_mult:300, mystery_box_coin_chance:50,
  mb_coins_small:10,   mb_coins_large:15,   mb_lucky_charm:15, mb_xp_boost:15,
  mb_shield:15,        mb_coin_magnet:15,   mb_rob_insurance:15,
  imb_coins_tiny:30,   imb_coins_small:20,  imb_lucky_charm:12,
  imb_xp_boost:8,      imb_shield:12,       imb_coin_magnet:8,  imb_rob_insurance:10,
  shop_lucky_charm_price:200, shop_xp_boost_price:300, shop_shield_price:150,
  shop_coin_magnet_price:350, shop_mystery_box_price:100, shop_item_mystery_box_price:40,
  shop_rob_insurance_price:250, shop_fishing_rod_price:400, shop_pickaxe_price:500,
  shop_lottery_ticket_price:50, shop_padlock_price:300, shop_steal_boost_price:200,
  shop_vip_pass_price:600,
  shop_profile_badge_common_price:300, shop_profile_badge_rare_price:800, shop_profile_bg_price:500,
  bank_interest_rate:5,   // % per day
  heist_join_window_ms:60000, heist_min_members:2, heist_success_chance:60,
  heist_base_payout_min:200, heist_base_payout_max:600,
  fish_min_coins:5, fish_max_coins:80,
  mine_min_coins:10, mine_max_coins:120,
  lottery_jackpot_base:500, lottery_ticket_bonus_per_ticket:50,
  win_hangman:40, win_snake_per_point:5,
  win_minesweeper_easy:30, win_minesweeper_medium:60, win_minesweeper_hard:100, win_minesweeper_xlhard:200,
  win_numberguess:30, win_wordscramble:25,
  win_ttt:50, win_c4:50, win_rps:40, win_mathrace:40, win_wordrace:40,
  win_trivia:60, win_scramblerace:80, win_countgame:200,
  olympics_win_coins:75,
  invite_comp_1st:500, invite_comp_2nd:250, invite_comp_3rd:100, invite_comp_per_invite:10,
};

// ── Persistence ────────────────────────────────────────────────────────────────
const DATA_FILE="./botdata.json";
const GH_TOKEN=process.env.GITHUB_TOKEN;
const GH_REPO=process.env.GITHUB_REPOSITORY;
let _commitTimer=null;

async function commitDataToGitHub(jsonString) {
  if (!GH_TOKEN||!GH_REPO) return;
  async function fetchSHA(){
    return new Promise(resolve=>{
      const req=https.request({hostname:"api.github.com",port:443,path:`/repos/${GH_REPO}/contents/botdata.json`,method:"GET",headers:{Authorization:`Bearer ${GH_TOKEN}`,"User-Agent":"discord-bot",Accept:"application/vnd.github+json"}},res=>{
        let b="";res.on("data",c=>b+=c);res.on("end",()=>{try{resolve(JSON.parse(b)?.sha||null);}catch{resolve(null);}});
      });
      req.on("error",()=>resolve(null));req.end();
    });
  }
  async function tryPut(sha){
    const encoded=Buffer.from(jsonString).toString("base64");
    const body=JSON.stringify({message:"chore: auto-save botdata",content:encoded,...(sha?{sha}:{})});
    return new Promise((resolve,reject)=>{
      const req=https.request({hostname:"api.github.com",port:443,path:`/repos/${GH_REPO}/contents/botdata.json`,method:"PUT",headers:{Authorization:`Bearer ${GH_TOKEN}`,"User-Agent":"discord-bot",Accept:"application/vnd.github+json","Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},res=>{
        let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve({status:res.statusCode,body:b}));
      });
      req.on("error",reject);req.write(body);req.end();
    });
  }
  try {
    let sha=await fetchSHA(),result=await tryPut(sha);
    if (result.status===409||result.status===422){sha=await fetchSHA();result=await tryPut(sha);}
    if (result.status===200||result.status===201) console.log("Data committed to GitHub");
    else console.error(`GitHub commit failed HTTP ${result.status}`);
  } catch(e){console.error("commitDataToGitHub error:",e.message);}
}

function buildDataObject() {
  return {
    config:              {...CONFIG},
    ticketConfigs:       [...ticketConfigs.entries()],
    openTickets:         [...openTickets.entries()],
    guildChannels:       [...guildChannels.entries()],
    welcomeChannels:     [...welcomeChannels.entries()],
    leaveChannels:       [...leaveChannels.entries()],
    boostChannels:       [...boostChannels.entries()],
    autoRoles:           [...autoRoles.entries()],
    shadowDelete:        [...shadowDelete.entries()],
    clankerify:          [...clankerify.entries()],
    reactionRoles:       [...reactionRoles.entries()],
    disabledOwnerMsg:    [...disabledOwnerMsg],
    disabledLevelUp:     [...disabledLevelUp],
    levelUpConfig:       [...levelUpConfig.entries()],
    ytConfig:            [...ytConfig.entries()],
    countingChannels:    [...countingChannels.entries()],
    userInstalls:        [...userInstalls],
    scores:              [...scores.entries()],
    activeEffects:       [...activeEffects.entries()],
    reminders:           [...reminders],
    bankAccounts:        [...bankAccounts.entries()],
    lottery:             { tickets:[...lottery.tickets.entries()], jackpot:lottery.jackpot, lastDraw:lottery.lastDraw, drawMessageId:lottery.drawMessageId, drawChannelId:lottery.drawChannelId },
    inviteComps:         [...inviteComps.entries()].map(([guildId,comp])=>[guildId,{endsAt:comp.endsAt,channelId:comp.channelId,baseline:[...comp.baseline.entries()]}]),
    premieres:           [...premieres.entries()],
    raConfig:            [...raConfig.entries()],
    activityChecks:      [...activityChecks.entries()],
    scheduledChecks:     [...scheduledChecks.entries()],
    dailyQuoteChannels:  [...dailyQuoteChannels.entries()],
    memers:              [...MEMERS],
    quoteVotes:          [...quoteVotes.entries()],
    quoteVoteMessages:   [...quoteVoteMessages.entries()],
    reviewChannelId,
  };
}

function saveData() {
  try {
    const json=JSON.stringify(buildDataObject(),null,2);
    fs.writeFileSync(DATA_FILE,json);
    if (_commitTimer) clearTimeout(_commitTimer);
    _commitTimer=setTimeout(()=>{_commitTimer=null;commitDataToGitHub(json).catch(e=>console.error("commit error:",e.message));},3000);
  } catch(e){console.error("saveData error:",e.message);}
}
async function saveDataAndCommitNow() {
  try {
    if (_commitTimer){clearTimeout(_commitTimer);_commitTimer=null;}
    const json=JSON.stringify(buildDataObject(),null,2);
    fs.writeFileSync(DATA_FILE,json);
    await commitDataToGitHub(json);
  } catch(e){console.error("saveDataAndCommitNow error:",e.message);}
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)){console.log("No botdata.json — starting fresh.");return;}
    const raw=fs.readFileSync(DATA_FILE,"utf8");
    if (!raw||!raw.trim()){console.log("botdata.json empty — starting fresh.");return;}
    const data=JSON.parse(raw);
    if (data.config&&typeof data.config==="object") {
      for (const [k,v] of Object.entries(data.config)) {
        if (k in CONFIG&&typeof v==="number") CONFIG[k]=v;
      }
    }
    if (data.ticketConfigs)    data.ticketConfigs.forEach(([k,v])=>ticketConfigs.set(k,v));
    if (data.openTickets)      data.openTickets.forEach(([k,v])=>openTickets.set(k,v));
    if (data.guildChannels)    data.guildChannels.forEach(([k,v])=>guildChannels.set(k,v));
    if (data.welcomeChannels)  data.welcomeChannels.forEach(([k,v])=>welcomeChannels.set(k,v));
    if (data.leaveChannels)    data.leaveChannels.forEach(([k,v])=>leaveChannels.set(k,v));
    if (data.boostChannels)    data.boostChannels.forEach(([k,v])=>boostChannels.set(k,v));
    if (data.shadowDelete)     data.shadowDelete.forEach(([k,v])=>shadowDelete.set(k,v));
    if (data.clankerify) {
      const now=Date.now();
      data.clankerify.forEach(([k,v])=>{if(v.expiresAt===null||v.expiresAt>now)clankerify.set(k,v);});
    }
    if (data.autoRoles)        data.autoRoles.forEach(([k,v])=>autoRoles.set(k,v));
    if (data.reactionRoles)    data.reactionRoles.forEach(([k,v])=>reactionRoles.set(k,v));
    if (data.disabledOwnerMsg) data.disabledOwnerMsg.forEach(v=>disabledOwnerMsg.add(v));
    if (data.disabledLevelUp)  data.disabledLevelUp.forEach(v=>disabledLevelUp.add(v));
    if (data.levelUpConfig)    data.levelUpConfig.forEach(([k,v])=>levelUpConfig.set(k,v));
    if (data.ytConfig)         data.ytConfig.forEach(([k,v])=>ytConfig.set(k,v));
    if (data.countingChannels) data.countingChannels.forEach(([k,v])=>countingChannels.set(k,v));
    if (data.userInstalls)     data.userInstalls.forEach(v=>userInstalls.add(v));
    if (data.scores)           data.scores.forEach(([k,v])=>scores.set(k,v));
    if (data.memers)           {MEMERS.clear();data.memers.forEach(v=>MEMERS.add(v));}
    if (data.bankAccounts)     data.bankAccounts.forEach(([k,v])=>bankAccounts.set(k,v));
    if (data.lottery) {
      if (data.lottery.tickets) data.lottery.tickets.forEach(([k,v])=>lottery.tickets.set(k,v));
      if (data.lottery.jackpot!=null)       lottery.jackpot=data.lottery.jackpot;
      if (data.lottery.lastDraw!=null)      lottery.lastDraw=data.lottery.lastDraw;
      if (data.lottery.drawMessageId!=null) lottery.drawMessageId=data.lottery.drawMessageId;
      if (data.lottery.drawChannelId!=null) lottery.drawChannelId=data.lottery.drawChannelId;
    }
    if (data.activeEffects) {
      const now=Date.now();
      data.activeEffects.forEach(([uid,fx])=>{
        const live={};
        if (fx.lucky_charm_expiry&&fx.lucky_charm_expiry>now) live.lucky_charm_expiry=fx.lucky_charm_expiry;
        if (fx.xp_boost_expiry&&fx.xp_boost_expiry>now)      live.xp_boost_expiry=fx.xp_boost_expiry;
        if (fx.vip_pass_expiry&&fx.vip_pass_expiry>now)       live.vip_pass_expiry=fx.vip_pass_expiry;
        if (fx.steal_boost_expiry&&fx.steal_boost_expiry>now) live.steal_boost_expiry=fx.steal_boost_expiry;
        if (Object.keys(live).length) activeEffects.set(uid,live);
      });
    }
    if (data.reminders) {
      const now=Date.now();
      data.reminders.forEach(rem=>{if(rem.time&&rem.userId&&rem.channelId&&rem.message&&rem.time>now-86400000)reminders.push(rem);});
    }
    if (data.inviteComps) {
      const now=Date.now();
      data.inviteComps.forEach(([guildId,comp])=>{
        if (!comp.endsAt||comp.endsAt<=now) return;
        const baseline=new Map(comp.baseline||[]);
        inviteComps.set(guildId,{endsAt:comp.endsAt,channelId:comp.channelId,baseline});
        const remaining=comp.endsAt-now;
        setTimeout(async()=>{
          const live=inviteComps.get(guildId);if(!live)return;
          inviteComps.delete(guildId);
          const guild=client.guilds.cache.get(guildId);if(!guild)return;
          const ch=guild.channels.cache.get(live.channelId)||getGuildChannel(guild);if(!ch)return;
          const allInvites=await guild.invites.fetch().catch(()=>null);
          const gained=new Map();
          if(allInvites){allInvites.forEach(inv=>{if(!inv.inviter)return;const base=live.baseline.get(inv.code)||0;const diff=(inv.uses||0)-base;if(diff<=0)return;const id=inv.inviter.id;if(!gained.has(id))gained.set(id,{username:inv.inviter.username,count:0});gained.get(id).count+=diff;});}
          const sorted=[...gained.entries()].sort((a,b)=>b[1].count-a[1].count);
          if(!sorted.length){await safeSend(ch,{embeds:[{title:"🏆 Invite Competition Ended",description:"No new tracked invites.",color:0x5865F2}]});return;}
          const medals=["🥇","🥈","🥉"],rewards=[CONFIG.invite_comp_1st,CONFIG.invite_comp_2nd,CONFIG.invite_comp_3rd];
          const top=sorted.slice(0,3);
          const lines=top.map(([id,d],i)=>`${medals[i]} <@${id}> — **${d.count}** invite${d.count!==1?"s":""} (+${rewards[i]} coins)`);
          top.forEach(([id,d],i)=>{getScore(id,d.username).coins+=rewards[i];});
          saveData();
          await safeSend(ch,{embeds:[{title:"🏆 Invite Competition Ended!",description:lines.join("\n"),color:0xFFD700}]});
        },remaining);
      });
    }
    if (data.premieres) {
      const now=Date.now();
      data.premieres.forEach(([id,p])=>{if(p.endsAt>now)premieres.set(id,p);});
    }
    if (data.raConfig)         data.raConfig.forEach(([k,v])=>raConfig.set(k,v));
    if (data.scheduledChecks)  data.scheduledChecks.forEach(([k,v])=>scheduledChecks.set(k,v));
    if (data.activityChecks) {
      const now=Date.now();
      data.activityChecks.forEach(([msgId,check])=>{
        if(!check.deadline||check.deadline<=now)return;
        activityChecks.set(msgId,check);
        const remaining=check.deadline-now;
        setTimeout(async()=>{
          const c=activityChecks.get(msgId);if(!c)return;
          activityChecks.delete(msgId);saveData();
          const guild=client.guilds.cache.get(c.guildId);if(!guild)return;
          const channel=guild.channels.cache.get(c.channelId);if(!channel)return;
          let reacted=new Set();
          try{const freshMsg=await channel.messages.fetch(msgId);const reaction=freshMsg.reactions.cache.get("✅");if(reaction){const users=await reaction.users.fetch();users.forEach(u=>{if(!u.bot)reacted.add(u.id);});}}catch(e){}
          let missing=[];
          try{const members=await guild.members.fetch();members.forEach(m=>{if(m.user.bot)return;if(!c.roleIds.some(rid=>m.roles.cache.has(rid)))return;if(c.excludedIds.some(rid=>m.roles.cache.has(rid)))return;if(!reacted.has(m.id))missing.push(`<@${m.id}>`);});}catch(e){}
          const missingText=missing.length?missing.join(", "):"None — everyone checked in! ✅";
          await safeSend(channel,{embeds:[{title:"📋 Activity Check Closed",fields:[{name:"✅ Checked in",value:String(reacted.size),inline:true},{name:"❌ Did not respond",value:missingText.slice(0,1024)||"—",inline:false}],color:0x5865F2,timestamp:new Date().toISOString()}]}).catch(()=>{});
        },remaining);
      });
    }
    if (data.dailyQuoteChannels) data.dailyQuoteChannels.forEach(([k,v])=>dailyQuoteChannels.set(k,v));
    if (data.reviewChannelId)    reviewChannelId=data.reviewChannelId;
    if (data.quoteVotes)         data.quoteVotes.forEach(([k,v])=>quoteVotes.set(k,v));
    if (data.quoteVoteMessages)  data.quoteVoteMessages.forEach(([k,v])=>quoteVoteMessages.set(k,v));
    console.log(`✅ Data loaded — ${scores.size} users, ${ticketConfigs.size} ticket configs, ${reactionRoles.size} reaction roles`);
  } catch(e){console.error("loadData error:",e.message);}
}

loadData();
setInterval(()=>saveData(), 2*60*1000);

process.on("SIGTERM",async()=>{console.log("SIGTERM — saving");await saveDataAndCommitNow();process.exit(0);});
process.on("SIGINT",async()=>{console.log("SIGINT — saving");await saveDataAndCommitNow();process.exit(0);});
process.on("exit",()=>{try{fs.writeFileSync(DATA_FILE,JSON.stringify(buildDataObject(),null,2));}catch{}});

// ── Daily quote ticker ─────────────────────────────────────────────────────────
setInterval(async()=>{
  if(!dailyQuoteChannels.size)return;
  const now=new Date(),nowHour=now.getUTCHours(),nowMin=now.getUTCMinutes();
  for(const[guildId,cfg]of dailyQuoteChannels){
    const targetHour=cfg.hour??9;
    if(nowHour!==targetHour||nowMin!==0)continue;
    const fireKey=`${guildId}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}:${nowHour}`;
    if(cfg._lastFire===fireKey)continue;
    cfg._lastFire=fireKey;
    try{
      const guild=client.guilds.cache.get(guildId);if(!guild)continue;
      const ch=guild.channels.cache.get(cfg.channelId);if(!ch)continue;
      const chosen=await nextQuoteImage();if(!chosen)continue;
      const sent=await safeSend(ch,{embeds:[{title:"🌅 Daily Quote",color:0xFFD700,image:{url:chosen.download_url},footer:{text:"React 👍 or 👎 to vote!"},timestamp:new Date().toISOString()}]});
      if(sent){await sent.react("👍").catch(()=>{});await sent.react("👎").catch(()=>{});quoteVoteMessages.set(sent.id,chosen.name);saveData();}
    }catch(e){console.error(`Daily quote tick [${guildId}]:`,e.message);}
  }
},60*1000);

// ── Scheduled activity check ticker ───────────────────────────────────────────
function parseSchedule(str){
  const days=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const parts=str.trim().toLowerCase().split(/\s+/);
  if(parts.length<2)return null;
  const dayIndex=days.findIndex(d=>d.startsWith(parts[0].slice(0,3)));
  if(dayIndex===-1)return null;
  const timeParts=parts[1].split(":");
  if(timeParts.length<2)return null;
  const hour=parseInt(timeParts[0]),minute=parseInt(timeParts[1]);
  if(isNaN(hour)||isNaN(minute)||hour<0||hour>23||minute<0||minute>59)return null;
  return{dayOfWeek:dayIndex,hour,minute};
}
setInterval(async()=>{
  if(!scheduledChecks.size)return;
  const now=new Date(),nowDay=now.getUTCDay(),nowHour=now.getUTCHours(),nowMin=now.getUTCMinutes();
  for(const[key,sc]of scheduledChecks){
    if(sc.dayOfWeek!==nowDay||sc.hour!==nowHour||sc.minute!==nowMin)continue;
    const fireKey=`${key}:${nowDay}:${nowHour}:${nowMin}`;
    if(sc._lastFire===fireKey)continue;
    sc._lastFire=fireKey;
    try{
      const guild=client.guilds.cache.get(sc.guildId);if(!guild)continue;
      const channel=guild.channels.cache.get(sc.channelId);if(!channel)continue;
      const deadline=Date.now()+sc.deadlineHr*3600000;
      const pingLine=sc.doPing&&sc.roleIds?.length?sc.roleIds.map(id=>`<@&${id}>`).join(" ")+"\n":"";
      const sent=await channel.send({content:pingLine||undefined,embeds:[{title:"📋 Activity Check",description:(sc.customMsg||"React with ✅ to confirm you're active!")+`\n\n⏰ Closes <t:${Math.floor(deadline/1000)}:R>`,color:0x5865F2,timestamp:new Date().toISOString()}]}).catch(()=>null);
      if(!sent)continue;
      await sent.react("✅").catch(()=>{});
      activityChecks.set(sent.id,{guildId:sc.guildId,channelId:sc.channelId,roleIds:sc.roleIds||[],excludedIds:sc.excludedIds||[],deadline});
      setTimeout(async()=>{
        const c=activityChecks.get(sent.id);if(!c)return;
        activityChecks.delete(sent.id);saveData();
        const g2=client.guilds.cache.get(c.guildId);if(!g2)return;
        const ch2=g2.channels.cache.get(c.channelId);if(!ch2)return;
        let reacted=new Set();
        try{const fm=await ch2.messages.fetch(sent.id);const rx=fm.reactions.cache.get("✅");if(rx){const u=await rx.users.fetch();u.forEach(u2=>{if(!u2.bot)reacted.add(u2.id);});}}catch{}
        let missing=[];
        try{const members=await g2.members.fetch();members.forEach(m=>{if(m.user.bot)return;if(!c.roleIds.some(rid=>m.roles.cache.has(rid)))return;if(c.excludedIds.some(rid=>m.roles.cache.has(rid)))return;if(!reacted.has(m.id))missing.push(`<@${m.id}>`);});}catch{}
        await ch2.send({embeds:[{title:"📋 Activity Check Closed",fields:[{name:"✅ Checked in",value:String(reacted.size),inline:true},{name:"❌ Did not respond",value:(missing.join(", ")||"None — everyone checked in! ✅").slice(0,1024),inline:false}],color:0x5865F2,timestamp:new Date().toISOString()}]}).catch(()=>{});
      },sc.deadlineHr*3600000);
      saveData();
    }catch(e){console.error("scheduled activity check error:",e);}
  }
},60*1000);

// ── Weekly lottery draw (every Monday at 12:00 UTC) ────────────────────────────
setInterval(async()=>{
  const now=new Date();
  if(now.getUTCDay()!==1||now.getUTCHours()!==12||now.getUTCMinutes()!==0)return;
  const fireKey=`lottery:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  if(lottery._lastFire===fireKey)return;
  lottery._lastFire=fireKey;
  const allTickets=[...lottery.tickets.entries()];
  if(!allTickets.length){lottery.jackpot+=50;saveData();return;}
  const pool=[];
  for(const[uid,count]of allTickets)for(let i=0;i<count;i++)pool.push(uid);
  const winnerId=pool[Math.floor(Math.random()*pool.length)];
  const winnerScore=getScore(winnerId,null);
  const prize=lottery.jackpot;
  winnerScore.coins+=prize;
  lottery.tickets.clear();
  lottery.jackpot=CONFIG.lottery_jackpot_base;
  lottery.lastDraw=Date.now();
  saveData();
  try{
    if(lottery.drawChannelId){
      const ch=await client.channels.fetch(lottery.drawChannelId).catch(()=>null);
      if(ch){
        await safeSend(ch,{embeds:[{title:"🎰 Weekly Lottery Draw!",description:`🏆 **Winner: <@${winnerId}>** won **${prize.toLocaleString()} coins**!\n\nCongratulations! The next jackpot starts at **${CONFIG.lottery_jackpot_base} coins**.\nBuy tickets with \`/lottery\` to enter next week!`,color:0xFFD700,timestamp:new Date().toISOString()}]});
      }
    }
  }catch{}
},60*1000);

// ── Bank interest ticker (daily at 00:00 UTC) ──────────────────────────────────
setInterval(()=>{
  const now=new Date();
  if(now.getUTCHours()!==0||now.getUTCMinutes()!==0)return;
  const fireKey=`bank:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  if(bankAccounts._lastFire===fireKey)return;
  bankAccounts._lastFire=fireKey;
  for(const[uid,acc]of bankAccounts){
    if(acc.balance>0){
      const interest=Math.floor(acc.balance*(CONFIG.bank_interest_rate/100));
      acc.balance+=interest;
    }
  }
  saveData();
},60*1000);

// ── YouTube polling (every 5 min) ──────────────────────────────────────────────
setInterval(async()=>{
  for(const[guildId,cfg]of ytConfig.entries()){
    if(!cfg.ytChannelId||!cfg.apiKey)continue;
    const stats=await getYouTubeStats(cfg.ytChannelId,cfg.apiKey);
    if(!stats||stats.hidden)continue;
    const now=Date.now(),prev=cfg.lastSubs??stats.subs;
    cfg.lastSubs=stats.subs;cfg.lastSubsTimestamp=now;
    if(!cfg.history)cfg.history=[];
    cfg.history.push({ts:now,subs:stats.subs});
    if(cfg.history.length>1000)cfg.history=cfg.history.slice(-1000);
    saveData();
    const guild=client.guilds.cache.get(guildId);if(!guild)continue;
    if(cfg.subcountDiscordId&&cfg.subcountMessageId){
      try{
        const ch=guild.channels.cache.get(cfg.subcountDiscordId);
        if(ch){
          const msg=await ch.messages.fetch(cfg.subcountMessageId).catch(()=>null);
          if(msg){
            const threshold=cfg.subcountThreshold||1000;
            const rounded=Math.floor(stats.subs/threshold)*threshold;
            const diff=stats.subs-prev;
            const diffStr=diff>0?` (+${fmtSubs(diff)})`:diff<0?` (${fmtSubs(diff)})`:""
            await msg.edit({embeds:[{title:`📊 ${stats.title} — Live Sub Count`,description:`## ${fmtSubs(stats.subs)}\n*~${fmtSubs(rounded)} (rounded to nearest ${fmtSubs(threshold)})*${diffStr}`,color:0xFF0000,footer:{text:"Updates every 5 minutes"},timestamp:new Date().toISOString()}]}).catch(()=>{});
          }
        }
      }catch{}
    }
    if(cfg.goal&&!cfg.goalReached){
      const pct=Math.min(100,Math.round(stats.subs/cfg.goal*100));
      if(cfg.goalDiscordId&&cfg.goalMessageId){
        const ch=guild.channels.cache.get(cfg.goalDiscordId);
        if(ch){const msg=await ch.messages.fetch(cfg.goalMessageId).catch(()=>null);if(msg)await msg.edit({embeds:[{title:`🎯 ${stats.title} — Sub Goal`,description:`**${fmtSubs(stats.subs)}** / **${fmtSubs(cfg.goal)}**\n\`[${buildBar(stats.subs,cfg.goal)}]\` **${pct}%**`,color:pct>=100?0x00FF00:0xFF0000,footer:{text:"Updated"},timestamp:new Date().toISOString()}]}).catch(()=>{});}
      }
      if(stats.subs>=cfg.goal){
        cfg.goalReached=true;saveData();
        if(cfg.goalDiscordId){const ch=guild.channels.cache.get(cfg.goalDiscordId);if(ch)await safeSend(ch,cfg.goalMessage||`🎉 **${stats.title}** just hit the sub goal of **${fmtSubs(cfg.goal)}** subscribers! 🎊`);}
      }
    }
    if(cfg.milestones?.length&&cfg.milestoneDiscordId){
      const ch=guild.channels.cache.get(cfg.milestoneDiscordId);
      if(ch){for(const m of cfg.milestones){if(!m.reached&&stats.subs>=m.subs){m.reached=true;saveData();await safeSend(ch,m.message||`🏆 **${stats.title}** just reached **${fmtSubs(m.subs)} subscribers**! 🎉`);}}}
    }
  }
},5*60*1000);

// ── Keep-alive ─────────────────────────────────────────────────────────────────
http.createServer((req,res)=>{res.writeHead(200);res.end("OK");}).listen(3000);
setInterval(()=>{http.get("http://localhost:3000",()=>{}).on("error",()=>{});},4*60*1000);

// ── Reminders tick ─────────────────────────────────────────────────────────────
setInterval(async()=>{
  const now=Date.now();
  for(let i=reminders.length-1;i>=0;i--){
    const rem=reminders[i];
    if(now>=rem.time){
      try{const ch=await client.channels.fetch(rem.channelId);await safeSend(ch,{embeds:[{title:"⏰ Reminder",description:`<@${rem.userId}> **${rem.message}**`,color:0x5865F2,timestamp:new Date().toISOString()}]});}catch{}
      reminders.splice(i,1);
    }
  }
},30000);

// ── Daily challenge ────────────────────────────────────────────────────────────
let dailyChallenge=null,dailyDate="";
const dailyCompletions=new Set();
const HANGMAN_WORDS=["discord","javascript","keyboard","penguin","asteroid","jellyfish","xylophone","labyrinth","cinnamon","algorithm","saxophone","quarterback","zeppelin","archipelago","mischievous","thunderstorm","catastrophe","whirlpool","mysterious","magnificent","avalanche","crocodile","philosophy","rhinoceros","trampoline"];
const DAILY_CHALLENGES=[
  {desc:"Solve: **{a} × {b} + {c}**",gen:()=>{const a=r(2,12),b=r(2,12),c=r(1,20);return{params:{a,b,c},answer:String(a*b+c)};}},
  {desc:"Unscramble: **`{w}`**",gen:()=>{const w=pick(HANGMAN_WORDS),sc=w.split("").sort(()=>Math.random()-0.5).join("");return{params:{w:sc},answer:w};}},
  {desc:"How many letters in: **{word}**?",gen:()=>{const word=pick(HANGMAN_WORDS);return{params:{word},answer:String(word.length)};}},
  {desc:"What is **{a} + {b} × {c}**? (order of operations)",gen:()=>{const a=r(1,20),b=r(1,10),c=r(1,10);return{params:{a,b,c},answer:String(a+b*c)};}},
];
function getDailyChallenge(){
  const today=new Date().toISOString().slice(0,10);
  if(dailyDate!==today){
    dailyDate=today;dailyCompletions.clear();
    const c=DAILY_CHALLENGES[Math.floor(Math.random()*DAILY_CHALLENGES.length)];
    const gen=c.gen();
    const desc=c.desc.replace(/\{(\w+)\}/g,(_,k)=>gen.params[k]??"?");
    dailyChallenge={desc,answer:gen.answer};
  }
  return dailyChallenge;
}
function recordDaily(uid,uname){
  const s=getScore(uid,uname);
  const today=new Date().toISOString().slice(0,10);
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  if(s.lastDailyDate===yesterday)s.dailyStreak++;
  else if(s.lastDailyDate===today)return s;
  else s.dailyStreak=1;
  s.lastDailyDate=today;
  if(s.dailyStreak>s.bestStreak)s.bestStreak=s.dailyStreak;
  s.coins+=CONFIG.daily_base_coins+(s.dailyStreak-1)*CONFIG.daily_streak_bonus;
  return s;
}

// ── Static content ─────────────────────────────────────────────────────────────
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
const THROW_ITEMS=["a rubber duck 🦆","a pillow 🛏️","a water balloon 💦","a shoe 👟","a fish 🐟","a boomerang 🪃","a piece of bread 🍞","a sock 🧦","a small rock 🪨","Royal V himself","a spoon 🥄","a snowball ❄️","a bucket of confetti 🎊","a foam dart 🎯","a banana peel 🍌"];
const SLOT_SYMBOLS=["🍒","🍋","🍊","🍇","⭐","💎"];
const WORK_RESPONSES=[{msg:"💼 You worked a shift at the office and earned **{c}** coins.",lo:80,hi:180},{msg:"🔧 You fixed some pipes and the client paid you **{c}** coins.",lo:60,hi:140},{msg:"💻 You freelanced on a website project and earned **{c}** coins.",lo:100,hi:200},{msg:"📦 You sorted packages at the warehouse for **{c}** coins.",lo:50,hi:120},{msg:"🎨 You painted a mural commission and received **{c}** coins.",lo:90,hi:190},{msg:"🍕 You delivered pizzas all evening and made **{c}** coins.",lo:55,hi:130},{msg:"🏗️ You worked a construction shift and earned **{c}** coins.",lo:85,hi:175}];
const BEG_RESPONSES=[{msg:"🙏 A kind stranger tossed you **{c}** coins.",lo:5,hi:30,give:true},{msg:"😔 Nobody gave you anything. Rough day.",lo:0,hi:0,give:false},{msg:"🤑 Someone felt generous and handed you **{c}** coins!",lo:15,hi:50,give:true},{msg:"🫳 A passing cat knocked **{c}** coins toward you.",lo:1,hi:20,give:true},{msg:"📭 You begged for an hour and got absolutely nothing. Tragic.",lo:0,hi:0,give:false}];
const CRIME_RESPONSES=[{msg:"🚨 You tried to pickpocket someone but got caught! Paid **{c}** coins in fines.",success:false,lo:20,hi:80},{msg:"💰 You hacked a vending machine and grabbed **{c}** coins worth of snacks.",success:true,lo:50,hi:150},{msg:"🛒 You shoplifted and flipped the goods for **{c}** coins.",success:true,lo:40,hi:120},{msg:"🕵️ You pulled off a small con and walked away with **{c}** coins.",success:true,lo:60,hi:160},{msg:"🚔 The cops showed up and you lost **{c}** coins fleeing.",success:false,lo:15,hi:60},{msg:"🎲 You rigged a street bet and won **{c}** coins.",success:true,lo:70,hi:170},{msg:"🧢 You got scammed while trying to scam someone else. Down **{c}** coins.",success:false,lo:10,hi:50}];
const FISH_CATCHES=[
  {name:"🐟 Common Fish",lo:5,hi:25,rarity:"common",weight:50},
  {name:"🐠 Tropical Fish",lo:20,hi:50,rarity:"uncommon",weight:30},
  {name:"🦐 Shrimp",lo:10,hi:30,rarity:"uncommon",weight:25},
  {name:"🐡 Pufferfish",lo:30,hi:60,rarity:"rare",weight:15},
  {name:"🦞 Lobster",lo:50,hi:100,rarity:"rare",weight:10},
  {name:"🦑 Squid",lo:40,hi:80,rarity:"rare",weight:10},
  {name:"🐙 Octopus",lo:60,hi:120,rarity:"epic",weight:5},
  {name:"🦈 Shark",lo:80,hi:160,rarity:"epic",weight:3},
  {name:"🌊 Old Boot",lo:1,hi:5,rarity:"junk",weight:15},
  {name:"🪣 Empty Can",lo:1,hi:3,rarity:"junk",weight:12},
];
const MINE_ORES=[
  {name:"🪨 Stone",lo:10,hi:20,rarity:"common",weight:50},
  {name:"⛏️ Iron Ore",lo:20,hi:40,rarity:"common",weight:35},
  {name:"🟤 Copper",lo:30,hi:55,rarity:"uncommon",weight:25},
  {name:"🥈 Silver",lo:50,hi:80,rarity:"uncommon",weight:18},
  {name:"🟡 Gold",lo:70,hi:110,rarity:"rare",weight:12},
  {name:"💎 Diamond",lo:100,hi:180,rarity:"rare",weight:6},
  {name:"🔮 Mystic Crystal",lo:150,hi:250,rarity:"epic",weight:3},
  {name:"🌟 Starstone",lo:200,hi:350,rarity:"legendary",weight:1},
];
const OLYMPICS_EVENTS=[
  {name:"Most Messages in 1 Hour",description:"Send as many messages as possible in the next hour! 🏃",duration:60,unit:"messages",trackLive:true},
  {name:"Best Reaction Speed",description:"First to react to the bot's message with ⚡ wins!",duration:0,unit:"reactions",trackLive:false,instantWin:true},
  {name:"Longest Word Contest",description:"Send the longest single word in 5 minutes! 📖",duration:5,unit:"word length",trackLive:true},
  {name:"Most Unique Emojis",description:"Most unique emojis in ONE message wins! 🎭",duration:5,unit:"unique emojis",trackLive:true},
  {name:"Fastest Typer",description:"Type `the quick brown fox jumps over the lazy dog` first!",duration:0,unit:"typing",trackLive:false,instantWin:true,answer:"the quick brown fox jumps over the lazy dog"},
  {name:"Backwards Word Challenge",description:"Send `hello` backwards — first correct wins! 🔄",duration:0,unit:"backwards",trackLive:false,instantWin:true,answer:"olleh"},
  {name:"Best One-Liner",description:"Drop your funniest one-liner in 5 minutes! 😂",duration:5,unit:"one-liner",trackLive:false,randomWinner:true},
  {name:"Closest to 100",description:"Send a number — closest to 100 without going over wins! 🎯",duration:3,unit:"number game",trackLive:true},
  {name:"Most Invites in 1 Hour",description:"Who can invite the most new members in 1 hour? 📨",duration:60,unit:"invites",trackLive:false,inviteComp:true},
  {name:"Most Invites in 1 Week",description:"Who can invite the most new members over 7 days? 📨",duration:10080,unit:"invites",trackLive:false,inviteComp:true},
];
const TRUTH_QUESTIONS=["Have you ever pretended to be asleep to avoid a conversation?","What's the most embarrassing thing in your search history?","Have you ever blamed someone else for something you did?","What's the longest you've gone without showering?","Have you ever sent a text to the wrong person?","What's something you pretend to like but secretly hate?","Have you ever ghosted someone and regretted it?","What's the most childish thing you still do?"];
const DARE_ACTIONS=["Change your server nickname to 'Big Mistake' for 10 minutes.","Send a voice message saying 'I am a golden retriever' right now.","Type out your honest opinion of the last person who messaged you.","Use only capital letters for the next 5 messages.","Send the 5th photo in your camera roll with no context.","Type a haiku about the last thing you ate.","Compliment every person who has sent a message in the last 10 minutes.","Send a message using only emoji."];
const NEVERHAVEI_STMTS=["... eaten food that fell on the floor.","... stayed up for more than 24 hours straight.","... pretended not to see a notification.","... laughed at something I shouldn't have.","... said 'you too' when the waiter said 'enjoy your meal'.","... accidentally liked a very old post while stalking someone's profile.","... cried at a movie or show alone.","... talked to my pet like they understand everything.","... sent a message and immediately regretted it.","... forgotten someone's name right after being introduced."];
const HOROSCOPES={Aries:"♈ **Aries**: The stars say stop overthinking and send the message. You already know what you want.",Taurus:"♉ **Taurus**: Mercury is in chaos. Eat something good today. That's the advice. Just eat something good.",Gemini:"♊ **Gemini**: Both of your personalities are right. Pick one anyway.",Cancer:"♋ **Cancer**: Someone is thinking about you right now. Whether that's good news is unclear.",Leo:"♌ **Leo**: The universe wants you to be perceived today. This is your sign (literally).",Virgo:"♍ **Virgo**: You've been holding it together for everyone else. Today the stars permit a meltdown.",Libra:"♎ **Libra**: Stop making pros and cons lists. Just pick. It'll be fine.",Scorpio:"♏ **Scorpio**: You already know the answer. You just want someone to confirm it. Fine. You're right.",Sagittarius:"♐ **Sagittarius**: Adventure awaits. Probably not literally today but spiritually, sure.",Capricorn:"♑ **Capricorn**: You've been working hard. The stars notice. Nobody else does but the stars do.",Aquarius:"♒ **Aquarius**: Your weird idea is actually good this time. Go for it.",Pisces:"♓ **Pisces**: You're not behind. Everyone else is just pretending they know what they're doing too."};

// ── Shop definition ────────────────────────────────────────────────────────────
function getShopItems(){return{
  lucky_charm:      {name:"Lucky Charm 🍀",       price:CONFIG.shop_lucky_charm_price,      desc:`+${CONFIG.lucky_charm_bonus}% coins on all earning actions for 1hr`, category:"buffs"},
  xp_boost:         {name:"XP Boost ⚡",           price:CONFIG.shop_xp_boost_price,         desc:"2× XP from messages for 1hr",                                     category:"buffs"},
  vip_pass:         {name:"VIP Pass 👑",           price:CONFIG.shop_vip_pass_price,         desc:"All cooldowns reduced by 50% for 1hr",                            category:"buffs"},
  steal_boost:      {name:"Steal Boost 🗡️",       price:CONFIG.shop_steal_boost_price,      desc:"+20% rob success chance for 1hr",                                 category:"buffs"},
  shield:           {name:"Shield 🛡️",            price:CONFIG.shop_shield_price,           desc:"Blocks the next rob attempt (single use)",                        category:"protection"},
  padlock:          {name:"Padlock 🔒",            price:CONFIG.shop_padlock_price,          desc:"Prevents coinflip duels from targeting you (single use)",          category:"protection"},
  rob_insurance:    {name:"Rob Insurance 📋",      price:CONFIG.shop_rob_insurance_price,    desc:"If caught robbing, pay no fine (single use)",                     category:"protection"},
  coin_magnet:      {name:"Coin Magnet 🧲",        price:CONFIG.shop_coin_magnet_price,      desc:"Next /work gives 3× coins (single use)",                          category:"tools"},
  fishing_rod:      {name:"Fishing Rod 🎣",        price:CONFIG.shop_fishing_rod_price,      desc:"Required to use /fish",                                           category:"tools"},
  pickaxe:          {name:"Pickaxe ⛏️",           price:CONFIG.shop_pickaxe_price,          desc:"Required to use /mine",                                           category:"tools"},
  lottery_ticket:   {name:"Lottery Ticket 🎰",     price:CONFIG.shop_lottery_ticket_price,   desc:"Enter the weekly lottery draw for a coin jackpot",                category:"misc"},
  mystery_box:      {name:"Mystery Box 📦",        price:CONFIG.shop_mystery_box_price,      desc:"Open with /open — weighted random reward: coins or item",          category:"boxes"},
  item_mystery_box: {name:"Item Mystery Box 🎲",   price:CONFIG.shop_item_mystery_box_price, desc:"Open with /open — cheap, lower quality drops",                    category:"boxes"},
  profile_badge_common: {name:"Common Badge 🏅",  price:CONFIG.shop_profile_badge_common_price, desc:"A shiny badge for your profile",                             category:"cosmetics"},
  profile_badge_rare:   {name:"Rare Badge 🌟",    price:CONFIG.shop_profile_badge_rare_price,   desc:"A rare glistening badge for your profile",                   category:"cosmetics"},
  profile_bg:           {name:"Profile Flair 🎨", price:CONFIG.shop_profile_bg_price,           desc:"Unlock a new profile background color/theme",                category:"cosmetics"},
};}

// Shop categories with display labels
const SHOP_CATEGORIES={
  buffs:      {label:"⚡ Buffs & Boosts", emoji:"⚡"},
  protection: {label:"🛡️ Protection",    emoji:"🛡️"},
  tools:      {label:"🔧 Tools",          emoji:"🔧"},
  misc:       {label:"🎲 Misc",           emoji:"🎲"},
  boxes:      {label:"📦 Mystery Boxes",  emoji:"📦"},
  cosmetics:  {label:"🎨 Cosmetics",      emoji:"🎨"},
};

function buildShopEmbed(userId, category="buffs") {
  const s = getScore(userId, null);
  const shop = getShopItems();
  const items = Object.entries(shop).filter(([,item])=>item.category===category);
  const fields = items.map(([id, item]) => {
    const owned = s.inventory.filter(x=>x===id).length;
    const canAfford = s.coins >= item.price;
    return {
      name: `${item.name} — **${item.price.toLocaleString()} coins**${owned>0?` *(×${owned} owned)*`:""}`,
      value: item.desc + (canAfford ? "" : "\n*⚠️ Not enough coins*"),
      inline: false,
    };
  });
  return {
    embeds: [{
      title: `🛍️ Item Shop — ${SHOP_CATEGORIES[category].label}`,
      description: `💰 Your balance: **${s.coins.toLocaleString()} coins**\n\nClick a button to buy instantly!`,
      fields,
      color: 0x5865F2,
      footer: { text: "Use the dropdowns to browse categories" },
    }],
    components: buildShopComponents(userId, category),
  };
}

function buildShopComponents(userId, currentCategory) {
  const shop = getShopItems();
  const s = getScore(userId, null);
  // Category selector
  const catSelect = new MessageSelectMenu()
    .setCustomId(`shop_cat_${userId}`)
    .setPlaceholder("Browse category…")
    .setOptions(Object.entries(SHOP_CATEGORIES).map(([id,cat])=>({
      label: cat.label,
      value: id,
      default: id === currentCategory,
    })));
  // Buy buttons for items in current category
  const items = Object.entries(shop).filter(([,item])=>item.category===currentCategory);
  const rows = [new MessageActionRow().addComponents(catSelect)];
  // Up to 5 buy buttons (1 row of 5)
  const btnRow = new MessageActionRow();
  for (const [id, item] of items.slice(0,5)) {
    btnRow.addComponents(
      new MessageButton()
        .setCustomId(`shopbuy_${userId}_${id}`)
        .setLabel(`Buy ${item.name.split(" ").slice(-1)[0]}`)
        .setStyle(s.coins >= item.price ? "SUCCESS" : "SECONDARY")
        .setDisabled(s.coins < item.price)
    );
  }
  if (items.length) rows.push(btnRow);
  if (items.length > 5) {
    const btnRow2 = new MessageActionRow();
    for (const [id, item] of items.slice(5,10)) {
      btnRow2.addComponents(
        new MessageButton()
          .setCustomId(`shopbuy_${userId}_${id}`)
          .setLabel(`Buy ${item.name.split(" ").slice(-1)[0]}`)
          .setStyle(s.coins >= item.price ? "SUCCESS" : "SECONDARY")
          .setDisabled(s.coins < item.price)
      );
    }
    rows.push(btnRow2);
  }
  return rows;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const r    = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

function weightedPick(weights){
  const total=Object.values(weights).reduce((a,b)=>a+b,0);
  let roll=Math.random()*total;
  for(const[key,w]of Object.entries(weights)){roll-=w;if(roll<=0)return key;}
  return Object.keys(weights)[0];
}

function openMysteryBox(){
  const weights={coins_small:CONFIG.mb_coins_small,coins_large:CONFIG.mb_coins_large,lucky_charm:CONFIG.mb_lucky_charm,xp_boost:CONFIG.mb_xp_boost,shield:CONFIG.mb_shield,coin_magnet:CONFIG.mb_coin_magnet,rob_insurance:CONFIG.mb_rob_insurance};
  const result=weightedPick(weights);
  if(result==="coins_small")return{type:"coins",coins:r(50,200)};
  if(result==="coins_large")return{type:"coins",coins:r(200,500)};
  return{type:"item",itemId:result};
}
function openItemMysteryBox(){
  const weights={coins_tiny:CONFIG.imb_coins_tiny,coins_small:CONFIG.imb_coins_small,lucky_charm:CONFIG.imb_lucky_charm,xp_boost:CONFIG.imb_xp_boost,shield:CONFIG.imb_shield,coin_magnet:CONFIG.imb_coin_magnet,rob_insurance:CONFIG.imb_rob_insurance};
  const result=weightedPick(weights);
  if(result==="coins_tiny")return{type:"coins",coins:5};
  if(result==="coins_small")return{type:"coins",coins:r(20,80)};
  return{type:"item",itemId:result};
}

function weightedFish(){
  const total=FISH_CATCHES.reduce((a,f)=>a+f.weight,0);
  let roll=Math.random()*total;
  for(const f of FISH_CATCHES){roll-=f.weight;if(roll<=0)return f;}
  return FISH_CATCHES[0];
}
function weightedOre(){
  const total=MINE_ORES.reduce((a,o)=>a+o.weight,0);
  let roll=Math.random()*total;
  for(const o of MINE_ORES){roll-=o.weight;if(roll<=0)return o;}
  return MINE_ORES[0];
}

// Apply timed item on buy/give
function activateTimedItem(uid, itemId, qty=1){
  const fx=activeEffects.get(uid)||{};
  const now=Date.now();
  const keyMap={lucky_charm:"lucky_charm_expiry",xp_boost:"xp_boost_expiry",vip_pass:"vip_pass_expiry",steal_boost:"steal_boost_expiry"};
  const key=keyMap[itemId];if(!key)return;
  fx[key]=Math.max(fx[key]||now,now)+3600000*qty;
  activeEffects.set(uid,fx);
}

async function safeReply(interaction,payload){
  try{
    const p=typeof payload==="string"?{content:payload}:payload;
    if(interaction.deferred)return await interaction.editReply(p);
    if(interaction.replied) return await interaction.followUp({...p,ephemeral:true});
    return await interaction.reply(p);
  }catch(e){}
}
async function btnAck(interaction){try{await interaction.deferUpdate();return true;}catch{return false;}}
async function safeSend(channel,payload){try{return await channel.send(typeof payload==="string"?{content:payload}:payload);}catch{}}

function getTargetChannel(interaction){
  if(!interaction.guildId)return interaction.channel;
  const saved=guildChannels.get(interaction.guildId);
  if(saved){const ch=interaction.guild.channels.cache.get(saved);if(ch)return ch;guildChannels.delete(interaction.guildId);}
  return interaction.channel;
}
function getGuildChannel(guild){
  const saved=guildChannels.get(guild.id);
  if(saved){const ch=guild.channels.cache.get(saved);if(ch)return ch;guildChannels.delete(guild.id);}
  const c=guild.channels.cache.filter(ch=>ch.type==="GUILD_TEXT"&&guild.members.me&&ch.permissionsFor(guild.members.me).has("SEND_MESSAGES")&&ch.permissionsFor(guild.roles.everyone)?.has("VIEW_CHANNEL"));
  if(!c.size)return null;
  return c.first();
}
function getBestChannel(guild){return guild.channels.cache.find(c=>c.type==="GUILD_TEXT"&&guild.members.me&&c.permissionsFor(guild.members.me).has("SEND_MESSAGES"))||null;}
async function ownerSend(guild,payload){
  if(disabledOwnerMsg.has(guild.id))return false;
  const ch=getGuildChannel(guild);if(!ch)return false;
  await safeSend(ch,payload);return true;
}

function fmtMs(ms){
  const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000),s=Math.floor((ms%60000)/1000);
  if(h>0)return`${h}h ${m}m`;
  if(m>0)return`${m}m ${s}s`;
  return`${s}s`;
}
function fmtSubs(n){
  if(n>=1_000_000)return(n/1_000_000).toFixed(n>=10_000_000?1:2).replace(/\.?0+$/,"")+`M`;
  if(n>=1_000)return(n/1_000).toFixed(n>=10_000?1:2).replace(/\.?0+$/,"")+`K`;
  return String(n);
}
function buildBar(current,goal,width=20){
  const pct=Math.min(1,current/goal);
  const filled=Math.round(pct*width);
  return`${"█".repeat(filled)}${"░".repeat(width-filled)}`;
}
function xpBar(xp,needed,width=20){
  const filled=Math.floor((xp/needed)*width);
  return`\`[${"█".repeat(filled)}${"░".repeat(width-filled)}]\` ${xp}/${needed} XP`;
}

// ── Cooldown helper (respects VIP pass) ───────────────────────────────────────
function getCooldown(uid, baseMs){
  const fx=activeEffects.get(uid)||{};
  if(fx.vip_pass_expiry&&fx.vip_pass_expiry>Date.now()) return Math.floor(baseMs*0.5);
  return baseMs;
}

// ── Profile embed builder ──────────────────────────────────────────────────────
const RARITY_COLORS={common:0x9B59B6,uncommon:0x2ECC71,rare:0x3498DB,epic:0xF39C12,legendary:0xFFD700};
const BG_COLORS={default:0x5865F2,midnight:0x2C3E50,sunset:0xFF6B35,forest:0x27AE60,ocean:0x1A8FE3,royal:0x7B2D8B,fire:0xFF4500};

function buildProfileEmbed(user, targetScore, interaction){
  const s=targetScore;
  const{level,xp,needed}=xpInfo(s);
  const wr=s.gamesPlayed>0?Math.round(s.wins/s.gamesPlayed*100):0;
  const fx=activeEffects.get(user.id)||{};
  const now=Date.now();
  const bankAcc=bankAccounts.get(user.id)||{balance:0};
  const activeBuffs=[];
  if(fx.lucky_charm_expiry&&fx.lucky_charm_expiry>now) activeBuffs.push(`🍀 Lucky Charm (expires <t:${Math.floor(fx.lucky_charm_expiry/1000)}:R>)`);
  if(fx.xp_boost_expiry&&fx.xp_boost_expiry>now)      activeBuffs.push(`⚡ XP Boost (expires <t:${Math.floor(fx.xp_boost_expiry/1000)}:R>)`);
  if(fx.vip_pass_expiry&&fx.vip_pass_expiry>now)       activeBuffs.push(`👑 VIP Pass (expires <t:${Math.floor(fx.vip_pass_expiry/1000)}:R>)`);
  if(fx.steal_boost_expiry&&fx.steal_boost_expiry>now) activeBuffs.push(`🗡️ Steal Boost (expires <t:${Math.floor(fx.steal_boost_expiry/1000)}:R>)`);
  const badgeStr=(s.badges||[]).slice(0,8).join(" ")||"*No badges yet*";
  const color=BG_COLORS[s.profileBackground||"default"]||0x5865F2;
  const partner=s.marriedTo?`💍 <@${s.marriedTo}>`:"*Single*";
  return {
    embeds:[{
      author:{name:`${user.username}'s Profile`,icon_url:user.displayAvatarURL({size:64,dynamic:true})},
      thumbnail:{url:user.displayAvatarURL({size:256,dynamic:true})},
      description:s.bio?`> *${s.bio.slice(0,200)}*`:"",
      fields:[
        {name:"💰 Economy",value:`Wallet: **${s.coins.toLocaleString()}** coins\nBank: **${bankAcc.balance.toLocaleString()}** coins\nTotal: **${(s.coins+bankAcc.balance).toLocaleString()}** coins`,inline:true},
        {name:"📈 Level & XP",value:`Level **${level}**\n${xpBar(xp,needed,15)}\nTotal games: **${s.gamesPlayed}**`,inline:true},
        {name:"🏆 Game Stats",value:`Wins: **${s.wins}** | WR: **${wr}%**\n🔥 Streak: **${s.dailyStreak}** | Best: **${s.bestStreak}**\n🖼️ Images uploaded: **${s.imagesUploaded||0}**`,inline:false},
        {name:"💑 Relationship",value:partner,inline:true},
        {name:"🏅 Badges",value:badgeStr,inline:true},
        ...(activeBuffs.length?[{name:"✨ Active Buffs",value:activeBuffs.join("\n"),inline:false}]:[]),
      ],
      color,
      footer:{text:"Use the buttons below for more details"},
      timestamp:new Date().toISOString(),
    }],
  };
}

function buildProfileButtons(targetUserId, viewerId){
  return [new MessageActionRow().addComponents(
    new MessageButton().setCustomId(`prof_inv_${targetUserId}_${viewerId}`).setLabel("🎒 Inventory").setStyle("SECONDARY"),
    new MessageButton().setCustomId(`prof_trades_${targetUserId}_${viewerId}`).setLabel("🔄 Recent Trades").setStyle("SECONDARY"),
    new MessageButton().setCustomId(`prof_stats_${targetUserId}_${viewerId}`).setLabel("📊 Full Stats").setStyle("SECONDARY"),
    new MessageButton().setCustomId(`prof_badges_${targetUserId}_${viewerId}`).setLabel("🏅 Badges").setStyle("SECONDARY"),
  )];
}

// ── Level-up embed builder ─────────────────────────────────────────────────────
function buildLevelUpEmbed(user, newLevel){
  const rewards={5:"🍀 Lucky Charm unlocked in shop!",10:"⚡ XP Boost unlocked!",20:"👑 VIP Pass unlocked!",25:"🎰 Jackpot multiplier +1%",50:"💎 Legendary title"};
  const reward=rewards[newLevel];
  return {
    embeds:[{
      title:`🎉 Level Up!`,
      description:`${user.username} just reached **Level ${newLevel}**! 🚀\n\n${xpBar(0,xpForNextLevel(newLevel),20)}\n${reward?`\n✨ **Reward:** ${reward}`:""}`,
      color:0xFFD700,
      thumbnail:{url:user.displayAvatarURL({size:128,dynamic:true})},
      timestamp:new Date().toISOString(),
    }],
  };
}

// ── Game renderers ─────────────────────────────────────────────────────────────
function renderTTT(board){const s=v=>v==="X"?"❌":v==="O"?"⭕":"⬜";return[0,1,2].map(row=>board.slice(row*3,row*3+3).map(s).join("")).join("\n");}
function checkTTTWin(b){for(const[a,c,d]of[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[a]===b[d])return b[a];return b.includes(null)?null:"draw";}
function makeTTTButtons(board,disabled=false){
  return[0,1,2].map(row=>new MessageActionRow().addComponents([0,1,2].map(col=>{const i=row*3+col;return new MessageButton().setCustomId(`ttt_${i}`).setLabel(board[i]===null?"⠀":board[i]==="X"?"❌":"⭕").setStyle(board[i]==="X"?"DANGER":board[i]==="O"?"PRIMARY":"SECONDARY").setDisabled(disabled||board[i]!==null);})));
}
function renderC4(board){const E="⚫",R="🔴",B="🔵";return[0,1,2,3,4,5].map(row=>board.slice(row*7,row*7+7).map(v=>v===0?E:v===1?R:B).join("")).join("\n");}
function checkC4Win(b){const check=(a,c,d,e)=>b[a]&&b[a]===b[c]&&b[a]===b[d]&&b[a]===b[e];for(let r=0;r<6;r++)for(let c=0;c<7;c++){const i=r*7+c;if(c<=3&&check(i,i+1,i+2,i+3))return b[i];if(r<=2&&check(i,i+7,i+14,i+21))return b[i];if(r<=2&&c<=3&&check(i,i+8,i+16,i+24))return b[i];if(r<=2&&c>=3&&check(i,i+6,i+12,i+18))return b[i];}return null;}
function makeC4Buttons(){return[new MessageActionRow().addComponents([0,1,2,3,4,5,6].map(c=>new MessageButton().setCustomId(`c4_${c}`).setLabel(String(c+1)).setStyle("SECONDARY")))];}

// ── Hangman renderer ───────────────────────────────────────────────────────────
function renderHangman(word,guessed){
  const STAGES=["```\n -----\n |   |\n     |\n     |\n     |\n     |\n=========```","```\n -----\n |   |\n O   |\n     |\n     |\n     |\n=========```","```\n -----\n |   |\n O   |\n |   |\n     |\n     |\n=========```","```\n -----\n |   |\n O   |\n/|   |\n     |\n     |\n=========```","```\n -----\n |   |\n O   |\n/|\\  |\n     |\n     |\n=========```","```\n -----\n |   |\n O   |\n/|\\  |\n/    |\n     |\n=========```","```\n -----\n |   |\n O   |\n/|\\  |\n/ \\  |\n     |\n=========```"];
  const wrong=[...guessed].filter(l=>!word.includes(l)).length;
  const display=word.split("").map(l=>guessed.has(l)?l:"_").join(" ");
  return`${STAGES[Math.min(wrong,6)]}\n**Word:** \`${display}\`\nWrong (${wrong}/6): ${[...guessed].filter(l=>!word.includes(l)).join(", ")||"none"}`;
}
function makeHangmanButtons(word,guessed,disabled=false){
  const rows=[];const letters="abcdefghijklmnopqrstuvwxyz".split("");
  for(let i=0;i<5;i++){
    const ar=new MessageActionRow();
    for(let j=0;j<5&&i*5+j<letters.length;j++){
      const l=letters[i*5+j];
      ar.addComponents(new MessageButton().setCustomId(`hm_${l}`).setLabel(l.toUpperCase()).setStyle(guessed.has(l)?(word.includes(l)?"SUCCESS":"DANGER"):"SECONDARY").setDisabled(disabled||guessed.has(l)));
    }
    rows.push(ar);
  }
  return rows;
}

// ── Snake renderer ─────────────────────────────────────────────────────────────
function renderSnake(sg){
  const grid=Array(sg.size).fill(null).map(()=>Array(sg.size).fill("⬜"));
  sg.snake.forEach((p,i)=>grid[p.y][p.x]=i===0?"🟩":"🟢");
  grid[sg.food.y][sg.food.x]="🍎";
  return grid.map(row=>row.join("")).join("\n")+`\nScore: **${sg.score}**`;
}
function makeSnakeButtons(){
  return[
    new MessageActionRow().addComponents(new MessageButton().setCustomId("snake_up").setLabel("⬆️").setStyle("SECONDARY")),
    new MessageActionRow().addComponents(
      new MessageButton().setCustomId("snake_left").setLabel("⬅️").setStyle("SECONDARY"),
      new MessageButton().setCustomId("snake_down").setLabel("⬇️").setStyle("SECONDARY"),
      new MessageButton().setCustomId("snake_right").setLabel("➡️").setStyle("SECONDARY"),
    ),
  ];
}

// ── Minesweeper (completely rewritten) ────────────────────────────────────────
// Sizes: easy=5×5 3mines, medium=8×8 10mines, hard=8×8 20mines, xlhard=8×8 30mines
const MS_CONFIGS={
  easy:   {rows:5,cols:5,mines:3},
  medium: {rows:8,cols:8,mines:10},
  hard:   {rows:8,cols:8,mines:20},
  xlhard: {rows:8,cols:8,mines:30},
};

function initMinesweeper(diff, safeRow=null, safeCol=null){
  const cfg=MS_CONFIGS[diff]||MS_CONFIGS.easy;
  const{rows,cols,mines}=cfg;
  const total=rows*cols;
  const mineSet=new Set();
  // Build safe zone around first click
  const safeZone=new Set();
  if(safeRow!==null&&safeCol!==null){
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      const nr=safeRow+dr,nc=safeCol+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols)safeZone.add(nr*cols+nc);
    }
    safeZone.add(safeRow*cols+safeCol);
  }
  // Place mines avoiding safe zone
  while(mineSet.size<Math.min(mines,total-safeZone.size)){
    const idx=Math.floor(Math.random()*total);
    if(!mineSet.has(idx)&&!safeZone.has(idx))mineSet.add(idx);
  }
  // Compute adjacency
  const adj=Array(total).fill(0);
  for(let i=0;i<total;i++){
    if(mineSet.has(i))continue;
    const row=Math.floor(i/cols),col=i%cols;
    let count=0;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(dr===0&&dc===0)continue;
      const nr=row+dr,nc=col+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&mineSet.has(nr*cols+nc))count++;
    }
    adj[i]=count;
  }
  return{rows,cols,mines:mineSet,adj,revealed:Array(total).fill(false),flagged:Array(total).fill(false),diff,firstClick:true};
}

function revealMS(game,row,col){
  const{rows,cols}=game;
  const idx=row*cols+col;
  if(game.revealed[idx]||game.flagged[idx])return;
  game.revealed[idx]=true;
  if(game.adj[idx]===0&&!game.mines.has(idx)){
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      const nr=row+dr,nc=col+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols)revealMS(game,nr,nc);
    }
  }
}

function makeMSButtons(game,disabled=false){
  const{rows,cols}=game;
  const numLabels=["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣"];
  const btnRows=[];
  for(let row=0;row<rows;row++){
    const ar=new MessageActionRow();
    for(let col=0;col<cols;col++){
      const idx=row*cols+col;
      const rev=game.revealed[idx];
      let label,style;
      if(rev){
        if(game.mines.has(idx)){label="💣";style="DANGER";}
        else if(game.adj[idx]>0){label=numLabels[game.adj[idx]-1]||String(game.adj[idx]);style="SUCCESS";}
        else{label="·";style="SUCCESS";}
      } else if(game.flagged[idx]){
        label="🚩";style="PRIMARY";
      } else {
        label="?";style="SECONDARY";
      }
      ar.addComponents(new MessageButton()
        .setCustomId(`ms_${row}_${col}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled||rev));
    }
    btnRows.push(ar);
  }
  // For 8×8 we can only show 5 rows of buttons (Discord limit) — show top 5 rows only
  return btnRows.slice(0,5);
}

// ── Economy card helpers ───────────────────────────────────────────────────────
function newDeck(){const suits=["♠","♥","♦","♣"],faces=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];const deck=[];for(const s of suits)for(const f of faces)deck.push(f+s);for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
function cardVal(card){const f=card.slice(0,-1);if(f==="A")return 11;if(["J","Q","K"].includes(f))return 10;return parseInt(f);}
function handVal(hand){let t=hand.reduce((s,c)=>s+cardVal(c),0),a=hand.filter(c=>c.startsWith("A")).length;while(t>21&&a>0){t-=10;a--;}return t;}
function renderHand(hand,hide=false){return hide?`${hand[0]} 🂠`:hand.join(" ");}
function makeBJButtons(disabled=false){return[new MessageActionRow().addComponents(new MessageButton().setCustomId("bj_hit").setLabel("Hit 🃏").setStyle("SUCCESS").setDisabled(disabled),new MessageButton().setCustomId("bj_stand").setLabel("Stand ✋").setStyle("DANGER").setDisabled(disabled),new MessageButton().setCustomId("bj_double").setLabel("Double Down 💰").setStyle("PRIMARY").setDisabled(disabled))];}
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

// ── Media fetchers ─────────────────────────────────────────────────────────────
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
async function getInspirationalQuote(){try{const d=await fetchJson("https://zenquotes.io/api/random");return d?.[0]?`"${d[0].q}" — ${d[0].a}`:null;}catch{return null;}}
async function getJoke(){try{const d=await fetchJson("https://official-joke-api.appspot.com/random_joke");return d?`${d.setup}\n\n||${d.punchline}||`:null;}catch{return null;}}
async function getTrivia(){try{const d=await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple");const q=d?.results?.[0];if(!q)return null;const answers=[...q.incorrect_answers,q.correct_answer].sort(()=>Math.random()-0.5);return{question:q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,"&"),answers,correct:q.correct_answer};}catch{return null;}}
async function getUserAppInstalls(){return new Promise(resolve=>{const req=https.request({hostname:"discord.com",port:443,path:`/api/v10/applications/${CLIENT_ID}`,method:"GET",headers:{Authorization:`Bot ${TOKEN}`}},res=>{let body="";res.on("data",c=>body+=c);res.on("end",()=>{try{const j=JSON.parse(body);resolve(j.approximate_user_install_count??"N/A");}catch{resolve("N/A");}});});req.on("error",()=>resolve("N/A"));req.end();});}

// ── YouTube helpers ────────────────────────────────────────────────────────────
async function resolveYouTubeChannelId(input,apiKey){
  if(!apiKey)return null;
  const clean=input.trim();
  if(/^UC[\w-]{20,}$/.test(clean))return clean;
  const urlMatch=clean.match(/youtube\.com\/(?:channel\/(UC[\w-]+)|(?:c\/|@|user\/)?([\w@.-]+))/i);
  let handle=null;
  if(urlMatch){if(urlMatch[1])return urlMatch[1];handle=urlMatch[2];}
  else if(clean.startsWith("@"))handle=clean.slice(1);
  else handle=clean;
  try{const data=await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=id,snippet&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`);if(data?.items?.[0]?.id)return data.items[0].id;}catch{}
  try{const data=await fetchJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${apiKey}`);return data?.items?.[0]?.snippet?.channelId||null;}catch{return null;}
}
async function getYouTubeStats(ytChannelId,apiKey){
  if(!apiKey)return null;
  try{const data=await fetchJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${ytChannelId}&key=${apiKey}`);const ch=data?.items?.[0];if(!ch)return null;return{subs:parseInt(ch.statistics?.subscriberCount||"0"),title:ch.snippet?.title||ytChannelId,hidden:ch.statistics?.hiddenSubscriberCount===true};}catch{return null;}
}

// ── Premiere helpers ───────────────────────────────────────────────────────────
function buildPremiereBar(endsAt,startedAt){
  const total=endsAt-startedAt,elapsed=Date.now()-startedAt;
  const pct=Math.min(1,Math.max(0,elapsed/total)),W=20,filled=Math.round(pct*W);
  return{bar:"█".repeat(filled)+"░".repeat(W-filled),pct};
}
function buildPremiereEmbed(p){
  const now=Date.now(),remaining=Math.max(0,p.endsAt-now);
  const hrs=Math.floor(remaining/3600000),mins=Math.floor((remaining%3600000)/60000);
  const{bar,pct}=buildPremiereBar(p.endsAt,p.startedAt);
  const pctLabel=Math.round(pct*100),endTs=Math.floor(p.endsAt/1000),done=remaining===0;
  return{embeds:[{
    title:done?`🎬 ${p.title} — It's time!`:`🎬 ${p.title}`,
    description:done
      ?`<@${p.userId}> Your video is ready to upload! 🚀`
      :`**Progress:** \`[${bar}]\` ${pctLabel}%\n\n⏳ **${hrs}h ${mins}m** remaining\n🕐 Drops <t:${endTs}:R>`,
    color:done?0x00FF00:0x5865F2,
    footer:{text:done?"Upload time! 🎉":"Premiere countdown"},
    timestamp:new Date().toISOString(),
  }]};
}

// ── Ticket transcript ──────────────────────────────────────────────────────────
async function sendTicketTranscript(channel,ticket,cfg,closedBy){
  if(!cfg?.transcriptChannelId)return;
  try{
    const transcriptCh=channel.guild?.channels.cache.get(cfg.transcriptChannelId);
    if(!transcriptCh)return;
    const allMessages=[];
    let lastId;
    while(true){
      const msgs=await channel.messages.fetch({limit:100,...(lastId?{before:lastId}:{})}).catch(()=>null);
      if(!msgs||!msgs.size)break;
      allMessages.push(...msgs.values());
      lastId=msgs.last()?.id;
      if(msgs.size<100)break;
    }
    allMessages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
    const lines=[`═══════════════════════════════════════`,`  TICKET #${ticket.ticketId} TRANSCRIPT`,`═══════════════════════════════════════`,`Opened by : ${ticket.userId}`,`Closed by : ${closedBy}`,`Closed at : ${new Date().toUTCString()}`,`Messages  : ${allMessages.length}`,`═══════════════════════════════════════`,``];
    for(const m of allMessages){
      const ts=new Date(m.createdTimestamp).toISOString().replace("T"," ").slice(0,19);
      if(m.content)lines.push(`[${ts}] ${m.author.username}: ${m.content}`);
      if(m.attachments.size)for(const att of m.attachments.values())lines.push(`[${ts}] ${m.author.username}: [Attachment: ${att.name} — ${att.url}]`);
    }
    lines.push("",`═══════════════════════════════════════`,`  END OF TRANSCRIPT`,`═══════════════════════════════════════`);
    const transcript=lines.join("\n");
    const buf=Buffer.from(transcript,"utf-8");
    await transcriptCh.send({embeds:[{title:`📜 Ticket #${ticket.ticketId} Transcript`,fields:[{name:"Opened by",value:`<@${ticket.userId}>`,inline:true},{name:"Closed by",value:closedBy,inline:true},{name:"Messages",value:String(allMessages.length),inline:true}],color:0x5865F2,timestamp:new Date().toISOString()}],files:[{attachment:buf,name:`ticket-${ticket.ticketId}-transcript.txt`}]});
  }catch(e){console.error("Transcript error:",e.message);}
}

// ── Discord client ─────────────────────────────────────────────────────────────
const client=new Client({
  intents:[Intents.FLAGS.GUILDS,Intents.FLAGS.GUILD_MEMBERS,Intents.FLAGS.GUILD_INVITES,
           Intents.FLAGS.DIRECT_MESSAGES,Intents.FLAGS.GUILD_MESSAGES,
           Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
  partials:["CHANNEL","MESSAGE","USER","REACTION"],
});

// ── Command definitions ────────────────────────────────────────────────────────
function buildCommands(){
  const uReq=(req=true)=>[{name:"user",description:"User",type:6,required:req}];
  return[
    // Fun / social
    {name:"ping",         description:"Check latency 🏓"},
    {name:"avatar",       description:"Get a user's avatar",options:uReq()},
    {name:"punch",        description:"Punch someone 👊",options:uReq()},
    {name:"hug",          description:"Hug someone 🤗",options:uReq()},
    {name:"kiss",         description:"Kiss someone 💋",options:uReq()},
    {name:"slap",         description:"Slap someone 👋",options:uReq()},
    {name:"throw",        description:"Throw something at someone 🎯",options:uReq()},
    {name:"marry",        description:"Propose marriage 💍",options:uReq()},
    {name:"divorce",      description:"Divorce your partner 💔"},
    {name:"forcedivorce", description:"[Owner] Force divorce a user",options:[{name:"user",description:"User",type:6,required:true}]},
    {name:"forcemarry",   description:"[Owner] Force marry two users",options:[{name:"user1",description:"First user",type:6,required:true},{name:"user2",description:"Second user",type:6,required:true}]},
    {name:"partner",      description:"Check who you're married to 💑",options:uReq(false)},
    {name:"action",       description:"Do an action to someone",options:[{name:"type",description:"Action type",type:3,required:true,choices:[{name:"Hug",value:"hug"},{name:"Pat",value:"pat"},{name:"Poke",value:"poke"},{name:"Stare",value:"stare"},{name:"Wave",value:"wave"},{name:"High five",value:"highfive"},{name:"Boop",value:"boop"},{name:"Oil up",value:"oil"},{name:"Diddle",value:"diddle"},{name:"Kill",value:"kill"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"rate",         description:"Rate someone",options:[{name:"type",description:"Meter type",type:3,required:true,choices:[{name:"Gay rate",value:"gayrate"},{name:"Autism meter",value:"howautistic"},{name:"Simp level",value:"simp"},{name:"Cursed energy",value:"cursed"},{name:"NPC %",value:"npc"},{name:"Villain arc",value:"villain"},{name:"Sigma rating",value:"sigma"}]},{name:"user",description:"Target",type:6,required:true}]},
    {name:"party",        description:"Truth, dare, never have I ever",options:[{name:"type",description:"Game type",type:3,required:true,choices:[{name:"Truth",value:"truth"},{name:"Dare",value:"dare"},{name:"Never Have I Ever",value:"neverhavei"}]}]},
    {name:"ppsize",       description:"Check pp size 📏",options:uReq()},
    // Media
    {name:"gif",          description:"Get a random animal GIF 🐾",options:[{name:"animal",description:"Animal",type:3,required:true,choices:[{name:"Cat 🐱",value:"cat"},{name:"Dog 🐶",value:"dog"},{name:"Fox 🦊",value:"fox"},{name:"Panda 🐼",value:"panda"},{name:"Duck 🦆",value:"duck"},{name:"Bunny 🐇",value:"bunny"},{name:"Koala 🐨",value:"koala"},{name:"Raccoon 🦝",value:"raccoon"}]}]},
    {name:"joke",         description:"Random joke 😂"},
    {name:"meme",         description:"Random meme 🐸"},
    {name:"quote",        description:"Random quote image ✨"},
    {name:"goodquote",    description:"Get a higher-rated quote ⭐"},
    {name:"badquote",     description:"Get a lower-rated quote 💀"},
    {name:"trivia",       description:"Trivia question 🧠"},
    // Utility
    {name:"coinflip",     description:"Flip a coin 🪙"},
    {name:"roll",         description:"Roll dice 🎲",options:[{name:"sides",description:"Sides (default 6)",type:4,required:false}]},
    {name:"choose",       description:"Choose between options",options:[{name:"options",description:"Comma-separated options",type:3,required:true}]},
    {name:"roast",        description:"Roast someone 🔥",options:uReq(false)},
    {name:"compliment",   description:"Compliment someone 💖",options:uReq(false)},
    {name:"ship",         description:"Ship two users 💘",options:[{name:"user1",description:"User 1",type:6,required:true},{name:"user2",description:"User 2",type:6,required:true}]},
    {name:"topic",        description:"Conversation starter 💬"},
    {name:"advice",       description:"Life advice 🧙"},
    {name:"fact",         description:"Fun fact 📚"},
    {name:"wyr",          description:"Would you rather… 🤔"},
    {name:"8ball",        description:"Ask the magic 8-ball 🎱",options:[{name:"question",description:"Your question",type:3,required:true}]},
    {name:"echo",         description:"Make the bot say something 📢",options:[
      {name:"message",    description:"Text to send",type:3,required:false},
      {name:"embed",      description:"Use rich embed",type:5,required:false},
      {name:"image",      description:"Attach an image",type:11,required:false},
      {name:"title",      description:"Embed title",type:3,required:false},
      {name:"color",      description:"Embed colour as #hex",type:3,required:false},
      {name:"replyto",    description:"Message ID to reply to",type:3,required:false},
    ]},
    {name:"horoscope",    description:"Your daily horoscope ✨",options:[{name:"sign",description:"Star sign",type:3,required:true,choices:Object.keys(HOROSCOPES).map(k=>({name:k,value:k}))}]},
    {name:"poll",         description:"Create a yes/no poll 📊",options:[{name:"question",description:"Poll question",type:3,required:true}]},
    {name:"remind",       description:"Set a reminder ⏰",options:[{name:"time",description:"Time in minutes",type:4,required:true},{name:"message",description:"Reminder text",type:3,required:true}]},
    {name:"premiere",     description:"Countdown to your video upload 🎬",options:[
      {name:"hours",      description:"Hours until release",type:10,required:true},
      {name:"channel",    description:"Channel for countdown",type:7,required:true},
      {name:"title",      description:"Video title (optional)",type:3,required:false},
    ]},
    {name:"serverinfo",   description:"Server information 🏠"},
    {name:"userprofile",  description:"Full profile card 📋",options:uReq(false)},
    {name:"botinfo",      description:"Bot information 🤖"},
    {name:"help",         description:"Show all commands 📖"},
    {name:"setbio",       description:"Set your profile bio 📝",options:[{name:"bio",description:"Your bio (max 200 chars)",type:3,required:true}]},
    // Economy
    {name:"coins",        description:"Check coin balance 💰",options:uReq(false)},
    {name:"daily",        description:"Claim daily reward 📅"},
    {name:"slots",        description:"Slot machine 🎰",options:[{name:"bet",description:"Coins to bet (default 10)",type:4,required:false}]},
    {name:"coinbet",      description:"Bet on a coin flip 🪙",options:[{name:"bet",description:"Coins",type:4,required:true},{name:"side",description:"heads or tails",type:3,required:true,choices:[{name:"Heads",value:"heads"},{name:"Tails",value:"tails"}]}]},
    {name:"blackjack",    description:"Blackjack 🃏",options:[{name:"bet",description:"Coins to bet",type:4,required:true}]},
    {name:"givecoin",     description:"Give coins to someone 💸",options:[{name:"user",description:"User",type:6,required:true},{name:"amount",description:"Amount",type:4,required:true}]},
    {name:"beg",          description:"Beg for coins 🙏"},
    {name:"work",         description:"Work for coins 💼"},
    {name:"crime",        description:"Commit a crime 🦹"},
    {name:"rob",          description:"Rob another user 🔫",options:uReq()},
    {name:"fish",         description:"Go fishing 🎣 (requires Fishing Rod)"},
    {name:"mine",         description:"Mine for ore ⛏️ (requires Pickaxe)"},
    {name:"heist",        description:"Start a group heist 💰",options:[{name:"target",description:"Optional target user to rob",type:6,required:false}]},
    {name:"trade",        description:"Trade items with another user 🔄",options:[
      {name:"user",       description:"User to trade with",type:6,required:true},
      {name:"coins",      description:"Coins you're offering",type:4,required:false},
      {name:"item",       description:"Item you're offering",type:3,required:false,choices:[
        {name:"Lucky Charm 🍀",value:"lucky_charm"},{name:"XP Boost ⚡",value:"xp_boost"},
        {name:"Shield 🛡️",value:"shield"},{name:"Coin Magnet 🧲",value:"coin_magnet"},
        {name:"Mystery Box 📦",value:"mystery_box"},{name:"Item Mystery Box 🎲",value:"item_mystery_box"},
        {name:"Rob Insurance 📋",value:"rob_insurance"},{name:"Fishing Rod 🎣",value:"fishing_rod"},
        {name:"Pickaxe ⛏️",value:"pickaxe"},{name:"Padlock 🔒",value:"padlock"},
        {name:"Steal Boost 🗡️",value:"steal_boost"},{name:"VIP Pass 👑",value:"vip_pass"},
        {name:"Lottery Ticket 🎰",value:"lottery_ticket"},
      ]},
    ]},
    {name:"coinflip_duel",description:"Challenge someone to a coinflip bet 🪙",options:[{name:"user",description:"User to challenge",type:6,required:true},{name:"bet",description:"Coins to bet",type:4,required:true}]},
    {name:"lottery",      description:"Buy lottery tickets or check jackpot 🎰",options:[{name:"action",description:"What to do",type:3,required:true,choices:[{name:"Buy a ticket",value:"buy"},{name:"Check jackpot",value:"jackpot"},{name:"My tickets",value:"mytickets"}]}]},
    {name:"bank",         description:"Manage your bank account 🏦",options:[{name:"action",description:"What to do",type:3,required:true,choices:[{name:"Deposit coins",value:"deposit"},{name:"Withdraw coins",value:"withdraw"},{name:"Check balance",value:"balance"}]},{name:"amount",description:"Amount (for deposit/withdraw)",type:4,required:false}]},
    {name:"shop",         description:"Browse and buy items 🛍️"},
    {name:"open",         description:"Open a mystery box 📦",options:[{name:"box",description:"Which box",type:3,required:true,choices:[{name:"Mystery Box 📦",value:"mystery_box"},{name:"Item Mystery Box 🎲",value:"item_mystery_box"}]}]},
    {name:"inventory",    description:"Check your inventory 🎒",options:uReq(false)},
    // XP & Scores
    {name:"xp",           description:"Check XP and level 📈",options:uReq(false)},
    {name:"xpleaderboard",description:"XP leaderboard 🏆",options:[{name:"scope",description:"global or server",type:3,required:false,choices:[{name:"Global",value:"global"},{name:"Server",value:"server"}]}]},
    {name:"score",        description:"Check game stats 🏆",options:uReq(false)},
    {name:"leaderboard",  description:"Global leaderboard 🌍",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"},{name:"Images Uploaded",value:"images"}]}]},
    {name:"serverleaderboard",description:"Server leaderboard 🏠",options:[{name:"type",description:"Type",type:3,required:false,choices:[{name:"Wins",value:"wins"},{name:"Coins",value:"coins"},{name:"Streak",value:"streak"},{name:"Best Streak",value:"beststreak"},{name:"Games Played",value:"games"},{name:"Win Rate",value:"winrate"},{name:"Images Uploaded",value:"images"}]}]},
    // Games
    {name:"games",        description:"Play a solo game 🎮",options:[{name:"game",description:"Which game",type:3,required:true,choices:[
      {name:"Hangman 🪢",value:"hangman"},{name:"Snake 🐍",value:"snake"},
      {name:"Minesweeper Easy 💣 (5×5)",value:"minesweeper_easy"},
      {name:"Minesweeper Medium 💣 (8×8)",value:"minesweeper_medium"},
      {name:"Minesweeper Hard 💣 (8×8)",value:"minesweeper_hard"},
      {name:"Minesweeper XL Hard 💣 (8×8)",value:"minesweeper_xlhard"},
      {name:"Number Guess 🔢",value:"numberguess"},
      {name:"Word Scramble 🔀",value:"wordscramble"},
      {name:"Daily Challenge 📅",value:"daily"},
    ]}]},
    {name:"2playergames", description:"Challenge someone to a game 🕹️",options:[
      {name:"game",       description:"Which game",type:3,required:true,choices:[
        {name:"Tic Tac Toe ❌⭕",value:"tictactoe"},{name:"Connect 4 🔴🔵",value:"connect4"},
        {name:"Rock Paper Scissors ✊",value:"rps"},{name:"Math Race 🧮",value:"mathrace"},
        {name:"Word Race 🏁",value:"wordrace"},{name:"Trivia Battle 🧠",value:"triviabattle"},
        {name:"Count Game 🔢",value:"countgame"},{name:"Scramble Race 🏁",value:"scramblerace"},
      ]},
      {name:"opponent",   description:"Opponent",type:6,required:false},
    ]},
    // Server management
    {name:"channelpicker",     description:"Set bot channel (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"levelup",description:"Enable level-up notifications?",type:5,required:false}]},
    {name:"counting",          description:"Set/remove counting channel (Manage Server)",options:[{name:"action",description:"Action",type:3,required:true,choices:[{name:"Set this channel",value:"set"},{name:"Remove counting",value:"remove"},{name:"Check status",value:"status"}]}]},
    {name:"xpconfig",          description:"Configure level-up notifications (Manage Server)",options:[
      {name:"setting",description:"What to configure",type:3,required:true,choices:[
        {name:"View config",value:"show"},{name:"Enable messages",value:"enable"},
        {name:"Disable messages",value:"disable"},{name:"Enable ping",value:"ping_on"},
        {name:"Disable ping",value:"ping_off"},{name:"Set channel",value:"set_channel"},
        {name:"Reset channel",value:"reset_channel"},
      ]},
      {name:"channel",description:"Channel (for set_channel)",type:7,required:false},
    ]},
    {name:"setwelcome",        description:"Set welcome message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server} {count}",type:3,required:false}]},
    {name:"setleave",          description:"Set leave message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server}",type:3,required:false}]},
    {name:"setboostmsg",       description:"Set boost message (Manage Server)",options:[{name:"channel",description:"Channel",type:7,required:true},{name:"message",description:"Use {user} {server}",type:3,required:false}]},
    {name:"disableownermsg",   description:"Toggle bot owner broadcasts (Manage Server)",options:[{name:"enabled",description:"Enable?",type:5,required:true}]},
    {name:"serverconfig",      description:"View server config (Manage Server)"},
    {name:"autorole",          description:"Auto-assign role on join (Manage Server)",options:[{name:"role",description:"Role (blank to disable)",type:8,required:false}]},
    {name:"reactionrole",      description:"Manage reaction roles (Manage Server)",options:[
      {name:"action",description:"What to do",type:3,required:true,choices:[{name:"Add",value:"add"},{name:"Remove",value:"remove"},{name:"List",value:"list"}]},
      {name:"messageid",description:"Message ID (for add/remove)",type:3,required:false},
      {name:"emoji",description:"Emoji (for add/remove)",type:3,required:false},
      {name:"role",description:"Role (for add)",type:8,required:false},
    ]},
    {name:"invitecomp",        description:"Start an invite competition (Manage Server)",options:[{name:"hours",description:"Duration in hours (1-720)",type:4,required:true}]},
    {name:"purge",             description:"Delete messages in bulk (Manage Messages)",options:[
      {name:"amount",description:"Messages to scan (1-100)",type:4,required:true},
      {name:"filter",description:"Filter type",type:3,required:false,choices:[{name:"Humans only",value:"humans"},{name:"Bots only",value:"bots"}]},
      {name:"contains",description:"Only delete messages containing this",type:3,required:false},
    ]},
    // Tickets
    {name:"ticketsetup",       description:"Ticket system setup (Manage Server)"},
    {name:"closeticket",       description:"Close this ticket"},
    {name:"addtoticket",       description:"Add user to ticket",options:[{name:"user",description:"User",type:6,required:true}]},
    {name:"removefromticket",  description:"Remove user from ticket",options:[{name:"user",description:"User",type:6,required:true}]},
    // YouTube
    {name:"ytsetup",           description:"Connect a YouTube channel (Manage Server)",options:[
      {name:"channel",description:"YouTube handle, URL, or channel ID",type:3,required:true},
      {name:"discord_channel",description:"Discord channel for updates",type:7,required:true},
      {name:"apikey",description:"YouTube Data API v3 key",type:3,required:false},
    ]},
    {name:"subgoal",           description:"Set subscriber goal with progress bar (Manage Server)",options:[{name:"goal",description:"Target sub count",type:4,required:true},{name:"message",description:"Custom goal reached message",type:3,required:false}]},
    {name:"subcount",          description:"Post a live sub count display (Manage Server)",options:[{name:"threshold",description:"Round to nearest",type:3,required:true,choices:[{name:"Every 1K",value:"1000"},{name:"Every 10K",value:"10000"}]}]},
    {name:"milestones",        description:"Manage milestone announcements (Manage Server)",options:[
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Add",value:"add"},{name:"Remove",value:"remove"},{name:"List",value:"list"}]},
      {name:"subs",description:"Sub count for this milestone",type:4,required:false},
      {name:"message",description:"Custom message (for add)",type:3,required:false},
    ]},
    // RA/LOA
    {name:"raconfig",          description:"Set up RA and LOA roles (Manage Server)",options:[
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Create roles automatically",value:"create"},{name:"Set existing RA role",value:"set_ra"},{name:"Set existing LOA role",value:"set_loa"},{name:"View config",value:"view"}]},
      {name:"role",description:"Existing role (for set_ra/set_loa)",type:8,required:false},
    ]},
    {name:"reduced-activity",  description:"Give/remove Reduced Activity role",options:[
      {name:"user",description:"Member",type:6,required:true},
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Give",value:"give"},{name:"Remove",value:"remove"}]},
      {name:"duration",description:"Duration in hours (optional)",type:4,required:false},
    ]},
    {name:"loa",               description:"Give/remove LOA role",options:[
      {name:"user",description:"Member",type:6,required:true},
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Give",value:"give"},{name:"Remove",value:"remove"}]},
      {name:"duration",description:"Duration in hours (optional)",type:4,required:false},
    ]},
    {name:"activity-check",    description:"Send an activity check (Manage Server)",options:[
      {name:"channel",description:"Channel",type:7,required:true},
      {name:"deadline",description:"Hours until check closes (default 24)",type:4,required:false},
      {name:"message",description:"Custom message text",type:3,required:false},
      {name:"ping",description:"Ping required roles?",type:5,required:false},
      {name:"schedule",description:"Weekly schedule e.g. Monday 09:00",type:3,required:false},
    ]},
    // Quote management
    {name:"dailyquote",        description:"Set up daily quote posts (Manage Server)",options:[
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Set channel",value:"set"},{name:"Disable",value:"disable"},{name:"Status",value:"status"}]},
      {name:"channel",description:"Channel (for set)",type:7,required:false},
      {name:"hour",description:"UTC hour to post (0-23, default 9)",type:4,required:false},
    ]},
    {name:"upload",            description:"Upload image to quotes folder",options:[
      {name:"source",description:"[Memers only] Upload a file",type:11,required:false},
      {name:"link",description:"[Memers only] Submit via URL",type:3,required:false},
    ]},
    {name:"library",           description:"Browse a user's uploaded images",options:[{name:"user",description:"User",type:6,required:true}]},
    {name:"requestupload",     description:"Submit an image for review",options:[{name:"source",description:"Image file",type:11,required:true}]},
    {name:"requester",         description:"[Owner] Set the quote review channel",options:[{name:"channel",description:"Review channel",type:7,required:true}]},
    {name:"quotedelete",       description:"[Owner] Delete a quote image",options:[{name:"filename",description:"Exact filename",type:3,required:true}]},
    {name:"quotelist",         description:"[Owner] List all quote images"},
    {name:"quotemanage",       description:"[Owner] Browse and delete quotes with preview",options:[{name:"index",description:"Start index (default 1)",type:4,required:false}]},
    {name:"managememers",      description:"[Owner] Manage upload allowlist",options:[
      {name:"action",description:"Action",type:3,required:true,choices:[{name:"Add",value:"add"},{name:"Remove",value:"remove"},{name:"List",value:"list"}]},
      {name:"user",description:"User (not needed for list)",type:6,required:false},
    ]},
    // Moderation helpers
    {name:"rolespingfix",      description:"List and fix roles with @everyone (Manage Server)"},
    // Owner panel (single command)
    {name:"owner",             description:"[Owner] Owner control panel"},
    // Message context menus
    {name:"Reaction Bomb",     type:3,default_member_permissions:"0"},
    {name:"Clank This",        type:3,default_member_permissions:"0"},
    {name:"Expose",            type:3,default_member_permissions:"0"},
    {name:"Vibe Check",        type:3},
    {name:"Uwu-ify",           type:3},
    {name:"Quote This",        type:3},
    {name:"Fetch Emoji",       type:3},
    // Guild-only misc
    {name:"admingive",         description:"[Owner] Give/take coins or items from user",options:[
      {name:"user",description:"Target",type:6,required:true},
      {name:"action",description:"Give or take",type:3,required:false,choices:[{name:"Give",value:"give"},{name:"Take",value:"take"}]},
      {name:"amount",description:"Coins",type:4,required:false},
      {name:"item",description:"Item",type:3,required:false,choices:[
        {name:"Lucky Charm 🍀",value:"lucky_charm"},{name:"XP Boost ⚡",value:"xp_boost"},
        {name:"Shield 🛡️",value:"shield"},{name:"Coin Magnet 🧲",value:"coin_magnet"},
        {name:"Mystery Box 📦",value:"mystery_box"},{name:"Item Mystery Box 🎲",value:"item_mystery_box"},
        {name:"Rob Insurance 📋",value:"rob_insurance"},{name:"Fishing Rod 🎣",value:"fishing_rod"},
        {name:"Pickaxe ⛏️",value:"pickaxe"},{name:"Padlock 🔒",value:"padlock"},
        {name:"Steal Boost 🗡️",value:"steal_boost"},{name:"VIP Pass 👑",value:"vip_pass"},
        {name:"Lottery Ticket 🎰",value:"lottery_ticket"},
      ]},
      {name:"item_quantity",description:"Quantity (default 1)",type:4,required:false},
    ]},
    {name:"shadowdelete",      description:"[Owner] Randomly delete % of a user's messages",options:[{name:"user",description:"Target",type:6,required:true},{name:"percentage",description:"Delete chance % (0 to disable)",type:4,required:true}]},
    {name:"clankerify",        description:"[Owner] Resend user's messages as webhook impersonation",default_member_permissions:"0",options:[{name:"user",description:"Target",type:6,required:true},{name:"duration",description:"Duration in minutes (0 to disable)",type:4,required:false}]},
    {name:"fakemessage",       description:"[Owner] Send message as another user via webhook",options:[{name:"user",description:"User to impersonate",type:6,required:true},{name:"message",description:"Message text",type:3,required:false},{name:"file",description:"File to send",type:11,required:false}]},
  ];
}

const GUILD_ONLY_CMDS=["admingive","shop","open","inventory","premiere","forcemarry","forcedivorce","shadowdelete","clankerify","purge","rolespingfix","library","activity-check","raconfig","reduced-activity","loa","fakemessage","quotedelete","quotelist","quotemanage","dailyquote","goodquote","badquote","requestupload","requester","Fetch Emoji","Reaction Bomb","Clank This","Expose","Vibe Check","Uwu-ify","Quote This","heist","trade","coinflip_duel","bank","fish","mine","lottery","owner","managememers","setbio"];

function discordRequest(method,path,body){
  return new Promise((resolve,reject)=>{
    const noBody=method==="GET"||method==="DELETE";
    const data=noBody?null:(body!==null&&body!==undefined?JSON.stringify(body):"[]");
    const headers={Authorization:`Bot ${TOKEN}`,"Content-Type":"application/json"};
    if(!noBody)headers["Content-Length"]=Buffer.byteLength(data);
    const opts={hostname:"discord.com",port:443,path,method,headers};
    const req=https.request(opts,res=>{let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve({status:res.statusCode,body:b}));});
    req.on("error",reject);
    if(!noBody)req.write(data);
    req.end();
  });
}

async function wipeStaleGlobalCmds(){
  try{
    const r=await discordRequest("GET",`/api/v10/applications/${CLIENT_ID}/commands`,null);
    if(r.status!==200)return;
    const global=JSON.parse(r.body);
    for(const cmd of global){
      if(GUILD_ONLY_CMDS.includes(cmd.name)){
        await discordRequest("DELETE",`/api/v10/applications/${CLIENT_ID}/commands/${cmd.id}`,null);
        console.log(`🗑️ Deleted stale global: ${cmd.name}`);
      }
    }
  }catch(e){console.warn("wipeStaleGlobalCmds:",e.message);}
}

async function registerGlobalCommands(){
  try{
    const cmds=buildCommands().filter(c=>!GUILD_ONLY_CMDS.includes(c.name));
    const r=await discordRequest("PUT",`/api/v10/applications/${CLIENT_ID}/commands`,cmds);
    if(r.status===200)console.log(`✅ Global: ${JSON.parse(r.body).length} commands`);
    else console.error(`❌ Global commands HTTP ${r.status}: ${r.body.slice(0,300)}`);
  }catch(e){console.error("registerGlobalCommands:",e.message);}
}

async function registerGuildOnlyCommands(guildId,force=false){
  try{
    const cmds=buildCommands().filter(c=>GUILD_ONLY_CMDS.includes(c.name));
    const fingerprint=JSON.stringify(cmds.map(c=>JSON.stringify(c)).sort());
    if(!force){
      const existing=await discordRequest("GET",`/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`,null);
      if(existing.status===200){
        const registered=JSON.parse(existing.body);
        const normalize=c=>JSON.stringify({name:c.name,description:c.description,options:c.options??[]});
        const regFP=JSON.stringify(registered.map(normalize).sort());
        const localFP=JSON.stringify(cmds.map(normalize).sort());
        if(regFP===localFP){console.log(`⏭️ Guild [${guildId}]: unchanged`);return;}
      }
    }
    const r=await discordRequest("PUT",`/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`,cmds);
    if(r.status===200)console.log(`✅ Guild [${guildId}]: ${JSON.parse(r.body).length} commands`);
    else console.warn(`⚠️ Guild-only [${guildId}] HTTP ${r.status}: ${r.body.slice(0,200)}`);
  }catch(e){console.warn(`registerGuildOnlyCommands [${guildId}]:`,e.message);}
}

async function clearGuildCommands(guildId,andReregister=true){
  try{
    const existing=await discordRequest("GET",`/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`,null);
    if(existing.status===200){
      const registered=JSON.parse(existing.body);
      const guildOnlyNames=buildCommands().filter(c=>GUILD_ONLY_CMDS.includes(c.name)).map(c=>c.name).sort();
      const registeredNames=registered.map(c=>c.name).sort();
      const hasStale=registered.some(c=>!GUILD_ONLY_CMDS.includes(c.name));
      const sameSet=JSON.stringify(registeredNames)===JSON.stringify(guildOnlyNames);
      if(!hasStale&&sameSet){console.log(`⏭️ Guild [${guildId}]: commands clean`);return;}
    }
    const r=await discordRequest("PUT",`/api/v10/applications/${CLIENT_ID}/guilds/${guildId}/commands`,[]);
    if(r.status===200){
      if(andReregister)await registerGuildOnlyCommands(guildId,true);
      else console.log(`✅ Guild commands wiped: ${guildId}`);
    } else if(r.status===400&&r.body.includes("30034")){
      const retryAfter=JSON.parse(r.body).retry_after||60;
      console.warn(`⚠️ Guild [${guildId}]: 200/day limit. Retrying in ${Math.ceil(retryAfter)}s…`);
      await new Promise(res=>setTimeout(res,(retryAfter+2)*1000));
      await registerGuildOnlyCommands(guildId,true);
    } else console.warn(`⚠️ clearGuildCommands [${guildId}] HTTP ${r.status}`);
  }catch(e){console.warn(`clearGuildCommands [${guildId}]:`,e.message);}
}

async function snapshotInvites(guild){
  try{
    const invites=await guild.invites.fetch();
    const snap=new Map();
    invites.forEach(inv=>{if(inv.code)snap.set(inv.code,inv.uses||0);});
    inviteCache.set(guild.id,snap);
  }catch{}
}

// Olympics helpers
async function runOlympicsInGuild(guild,event){
  const ch=getGuildChannel(guild);if(!ch)return;
  if(event.inviteComp){runInviteOlympicsInGuild(guild,event,ch);return;}
  const embed={title:`🏅 Olympics: ${event.name}`,description:`${event.description}\n\n⏱️ Duration: **${event.duration>0?event.duration+" min":"Instant!"}**`,color:0xFFD700,timestamp:new Date().toISOString()};
  await safeSend(ch,{embeds:[embed]});
  if(event.instantWin){
    if(event.answer){
      try{const col=await ch.awaitMessages({filter:m=>!m.author.bot&&m.content.trim().toLowerCase()===event.answer.toLowerCase(),max:1,time:60000,errors:["time"]});const w=col.first().author;recordWin(w.id,w.username,CONFIG.olympics_win_coins);saveData();await safeSend(ch,{embeds:[{title:"🏅 We have a winner!",description:`🥇 <@${w.id}> wins **${CONFIG.olympics_win_coins} coins**!`,color:0xFFD700}]});}catch{await safeSend(ch,{embeds:[{title:"⏰ Time's up!",description:"No winner this round.",color:0x5865F2}]});}
    } else {
      const msg=await safeSend(ch,{content:"⚡ **First to react wins!**"});
      if(msg){await msg.react("⚡");try{const r=await msg.awaitReactions({filter:(r,u)=>!u.bot&&r.emoji.name==="⚡",max:1,time:30000,errors:["time"]});const w=r.first().users.cache.filter(u=>!u.bot).first();if(w){recordWin(w.id,w.username,CONFIG.olympics_win_coins);saveData();await safeSend(ch,{embeds:[{title:"🏅 Winner!",description:`⚡ <@${w.id}> was the fastest! +**${CONFIG.olympics_win_coins}** coins`,color:0xFFD700}]});}}catch{await safeSend(ch,{embeds:[{title:"⏰ No one reacted in time!",color:0x5865F2}]});}}
    }
    return;
  }
  if(event.randomWinner){
    const collected=[];const col=ch.createMessageCollector({filter:m=>!m.author.bot,time:event.duration*60000});
    col.on("collect",m=>collected.push(m));
    col.on("end",async()=>{
      if(!collected.length){await safeSend(ch,{embeds:[{title:"😐 No entries!",color:0x5865F2}]});return;}
      const winner=pick(collected);recordWin(winner.author.id,winner.author.username,CONFIG.olympics_win_coins);saveData();
      await safeSend(ch,{embeds:[{title:"🏅 Random Winner!",description:`🎲 <@${winner.author.id}> wins **${CONFIG.olympics_win_coins} coins**!\n> "${winner.content.slice(0,200)}"`,color:0xFFD700}]});
    });
    return;
  }
  const scores2=new Map();const col2=ch.createMessageCollector({filter:m=>!m.author.bot,time:event.duration*60000});
  col2.on("collect",m=>{
    let val=0;
    if(event.unit==="messages")val=(scores2.get(m.author.id)||0)+1;
    if(event.unit==="word length"){const words=m.content.split(/\s+/).filter(w=>/^[a-zA-Z]+$/.test(w));val=Math.max(...words.map(w=>w.length),scores2.get(m.author.id)||0);}
    if(event.unit==="unique emojis"){const emojiMatch=m.content.match(/\p{Emoji}/gu)||[];val=new Set(emojiMatch).size;}
    if(event.unit==="number game"){const n=parseFloat(m.content.trim());if(!isNaN(n)&&n<=100)val=n;}
    scores2.set(m.author.id,Math.max(val,scores2.get(m.author.id)||0));
  });
  col2.on("end",async()=>{
    if(!scores2.size){await safeSend(ch,{embeds:[{title:"😐 No entries!",color:0x5865F2}]});return;}
    let winnerId,winScore;
    if(event.unit==="number game"){let closest=null,closestDiff=Infinity;for(const[id,v]of scores2){const diff=Math.abs(100-v);if(diff<closestDiff){closestDiff=diff;closest=id;winScore=v;}}winnerId=closest;}
    else{const sorted=[...scores2.entries()].sort((a,b)=>b[1]-a[1]);winnerId=sorted[0][0];winScore=sorted[0][1];}
    const winUser=await client.users.fetch(winnerId).catch(()=>null);
    if(winUser){recordWin(winUser.id,winUser.username,CONFIG.olympics_win_coins);saveData();}
    await safeSend(ch,{embeds:[{title:`🏅 Olympics Over! — ${event.name}`,description:`🥇 <@${winnerId}> wins with **${winScore}** ${event.unit}!\n+**${CONFIG.olympics_win_coins} coins**`,color:0xFFD700}]});
  });
}

async function runInviteOlympicsInGuild(guild,event,ch){
  const snapshot=new Map();
  try{const invites=await guild.invites.fetch();invites.forEach(inv=>{if(inv.inviter)snapshot.set(inv.code,{uses:inv.uses||0,inviterId:inv.inviter.id,username:inv.inviter.username});});}catch{return;}
  const durationMs=event.duration*60000;
  await safeSend(ch,{embeds:[{title:`🏅 Invite Olympics: ${event.name}`,description:event.description+`\n\n⏱️ Ends <t:${Math.floor((Date.now()+durationMs)/1000)}:R>`,color:0xFFD700}]});
  setTimeout(async()=>{
    try{
      const gained=new Map();
      const newInvites=await guild.invites.fetch();
      newInvites.forEach(inv=>{if(!inv.inviter)return;const old=snapshot.get(inv.code);const oldUses=old?.uses||0;const diff=(inv.uses||0)-oldUses;if(diff<=0)return;const id=inv.inviter.id;if(!gained.has(id))gained.set(id,{username:inv.inviter.username,count:0});gained.get(id).count+=diff;});
      const sorted=[...gained.entries()].sort((a,b)=>b[1].count-a[1].count);
      if(!sorted.length){await safeSend(ch,{embeds:[{title:"🏅 Invite Olympics Ended",description:"No new tracked invites.",color:0x5865F2}]});return;}
      const winner=sorted[0];recordWin(winner[0],winner[1].username,CONFIG.olympics_win_coins);saveData();
      await safeSend(ch,{embeds:[{title:`🏅 Invite Olympics Ended!`,description:`🥇 <@${winner[0]}> wins with **${winner[1].count}** invite${winner[1].count!==1?"s":""}!\n+**${CONFIG.olympics_win_coins} coins**`,color:0xFFD700}]});
    }catch(e){console.error("Invite Olympics end error:",e.message);}
  },durationMs);
}

// Clankerify: send crisis messages to owner
async function sendCrisisToOwner(dm){
  for(const msg of CRISIS_MESSAGES){await safeSend(dm,msg);await new Promise(res=>setTimeout(res,5000));}
}

// ── Client ready ───────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const ownerUser = await client.users.fetch(OWNER_ID).catch(() => null);
  if (ownerUser) await acquireInstanceLock(ownerUser);
  client.user.setActivity("with your coins 💰", { type: "PLAYING" });
  await wipeStaleGlobalCmds();
  await registerGlobalCommands();
  const guilds = [...client.guilds.cache.values()];
  for (let i = 0; i < guilds.length; i++) {
    await registerGuildOnlyCommands(guilds[i].id);
    await snapshotInvites(guilds[i]);
    if (i < guilds.length - 1) await new Promise(r => setTimeout(r, 800));
  }
  console.log(`✅ Ready — ${guilds.length} guild(s)`);
});

client.on("guildCreate", async guild => {
  await registerGuildOnlyCommands(guild.id);
  await snapshotInvites(guild);
});

// ── Message events ─────────────────────────────────────────────────────────────
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  // Shadow delete
  if (msg.guildId) {
    const sd = shadowDelete.get(msg.author.id);
    if (sd && sd.percentage > 0 && Math.random() * 100 < sd.percentage) {
      await msg.delete().catch(() => {});
    }
    // Clankerify
    const cl = clankerify.get(msg.author.id);
    if (cl && (cl.expiresAt === null || cl.expiresAt > Date.now()) && msg.guild) {
      try {
        const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
        const displayName = member?.displayName || msg.author.username;
        const avatarURL = msg.author.displayAvatarURL({ size: 256, dynamic: true });
        const webhooks = await msg.channel.fetchWebhooks().catch(() => null);
        if (webhooks) {
          let webhook = webhooks.find(w => w.owner?.id === CLIENT_ID);
          if (!webhook) webhook = await msg.channel.createWebhook("RoyalBot Proxy", { avatar: avatarURL }).catch(() => null);
          if (webhook) {
            const sendOpts = { username: displayName, avatarURL };
            if (msg.content) sendOpts.content = msg.content;
            if (msg.attachments.size) sendOpts.files = [...msg.attachments.values()].map(a => ({ attachment: a.url, name: a.name }));
            await webhook.send(sendOpts).catch(() => {});
            await msg.delete().catch(() => {});
          }
        }
      } catch {}
    }
  }

  // XP
  if (msg.guildId) {
    const newLevel = tryAwardXP(msg.author.id, msg.author.username);
    if (newLevel) {
      const guildId = msg.guildId;
      const luc = levelUpConfig.get(guildId) || {};
      const enabled = luc.enabled !== false && !disabledLevelUp.has(guildId);
      if (enabled) {
        const chId = luc.channelId || guildChannels.get(guildId);
        const ch = chId ? msg.guild.channels.cache.get(chId) : msg.channel;
        const target = ch || msg.channel;
        const ping = luc.ping !== false;
        await safeSend(target, {
          ...buildLevelUpEmbed(msg.author, newLevel),
          content: ping ? `<@${msg.author.id}>` : undefined,
        });
      }
      saveData();
    }
  }

  // Counting game
  if (msg.guildId && countingChannels.has(msg.channelId)) {
    const cc = countingChannels.get(msg.channelId);
    const num = parseInt(msg.content.trim());
    if (isNaN(num)) return;
    const expected = cc.count + 1;
    if (num === expected) {
      if (cc.lastUserId === msg.author.id) {
        cc.count = 0; cc.lastUserId = null;
        await msg.react("❌").catch(() => {});
        await safeSend(msg.channel, `❌ **${msg.author.username}** counted twice in a row! Back to **0**.\nNext: **1**`);
      } else {
        cc.count++; cc.lastUserId = msg.author.id;
        if (cc.count > (cc.highScore || 0)) cc.highScore = cc.count;
        await msg.react("✅").catch(() => {});
        if (cc.count % 100 === 0) await safeSend(msg.channel, `🎉 **${cc.count}!** Amazing counting! Keep going!`);
      }
    } else {
      const prev = cc.count; cc.count = 0; cc.lastUserId = null;
      await msg.react("❌").catch(() => {});
      await safeSend(msg.channel, `❌ **${msg.author.username}** said **${num}** but expected **${expected}**! Back to **0**. High score: **${cc.highScore || 0}**`);
    }
    saveData();
    return;
  }

  // Gay check trigger
  if (GAY_IDS.includes(msg.author.id) && Math.random() < 0.03) {
    await msg.react("🏳️‍🌈").catch(() => {});
  }
});

// ── Reaction events (for reaction roles + quote voting) ───────────────────────
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  // Quote vote
  const imgName = quoteVoteMessages.get(reaction.message.id);
  if (imgName) {
    const votes = quoteVotes.get(imgName) || { up: 0, down: 0 };
    if (reaction.emoji.name === "👍") votes.up++;
    else if (reaction.emoji.name === "👎") votes.down++;
    quoteVotes.set(imgName, votes);
    saveData();
    return;
  }

  // Reaction roles — fetch the full channel if needed to handle big messages
  const guildId = reaction.message.guildId;
  if (!guildId) return;
  const emoji = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
  const key = `${guildId}:${reaction.message.id}:${emoji}`;
  const roleId = reactionRoles.get(key);
  if (!roleId) return;
  try {
    const guild = reaction.message.guild || client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    await member.roles.add(roleId);
  } catch {}
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }
  const guildId = reaction.message.guildId;
  if (!guildId) return;
  const emoji = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
  const key = `${guildId}:${reaction.message.id}:${emoji}`;
  const roleId = reactionRoles.get(key);
  if (!roleId) return;
  try {
    const guild = reaction.message.guild || client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(user.id);
    await member.roles.remove(roleId);
  } catch {}
});

// ── Member events ──────────────────────────────────────────────────────────────
client.on("guildMemberAdd", async member => {
  const autoRole = autoRoles.get(member.guild.id);
  if (autoRole) { try { await member.roles.add(autoRole); } catch {} }
  const wCfg = welcomeChannels.get(member.guild.id);
  if (wCfg) {
    const ch = member.guild.channels.cache.get(wCfg.channelId);
    if (ch) {
      const count = member.guild.memberCount;
      const msg = (wCfg.message || "Welcome to **{server}**, {user}! 🎉 You are member #{count}.")
        .replace("{user}", `<@${member.id}>`).replace("{server}", member.guild.name).replace("{count}", count);
      await safeSend(ch, msg);
    }
  }
  // Invite tracking
  const old = inviteCache.get(member.guild.id) || new Map();
  const now = await member.guild.invites.fetch().catch(() => null);
  if (now) {
    const newMap = new Map(); now.forEach(inv => newMap.set(inv.code, inv.uses || 0));
    inviteCache.set(member.guild.id, newMap);
  }
});

client.on("guildMemberRemove", async member => {
  const lCfg = leaveChannels.get(member.guild.id);
  if (lCfg) {
    const ch = member.guild.channels.cache.get(lCfg.channelId);
    if (ch) {
      const msg = (lCfg.message || "**{user}** has left **{server}**. 👋")
        .replace("{user}", member.user.username).replace("{server}", member.guild.name);
      await safeSend(ch, msg);
    }
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const gained = newMember.premiumSince && !oldMember.premiumSince;
  if (!gained) return;
  const bCfg = boostChannels.get(newMember.guild.id);
  if (!bCfg) return;
  const ch = newMember.guild.channels.cache.get(bCfg.channelId);
  if (!ch) return;
  const msg = (bCfg.message || "🚀 **{user}** just boosted **{server}**! Thank you! 💜")
    .replace("{user}", `<@${newMember.id}>`).replace("{server}", newMember.guild.name);
  await safeSend(ch, msg);
});

// ── Main interaction handler ───────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  try {
    const inGuild = !!interaction.guildId;

    // ── Button interactions ────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;

      // rolespingfix fix button
      if (id === "rolespingfix_fix") {
        if (!OWNER_IDS.includes(interaction.user.id) && !interaction.member?.permissions.has("MANAGE_GUILD"))
          return safeReply(interaction, { content: "❌ Permission denied.", ephemeral: true });
        await interaction.deferUpdate();
        const guild = interaction.guild;
        await guild.roles.fetch();
        const dangerous = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id && r.permissions.has("MENTION_EVERYONE"));
        let fixed = 0, failed = [];
        for (const role of dangerous.values()) {
          try {
            const newPerms = role.permissions.remove("MENTION_EVERYONE");
            await role.setPermissions(newPerms);
            fixed++;
          } catch { failed.push(role.name); }
        }
        const failLine = failed.length ? `\n⚠️ Failed to fix: ${failed.join(", ")}` : "";
        return interaction.editReply({ embeds: [{ title: "✅ Roles Fixed", description: `Removed Mention Everyone from **${fixed}** role(s).${failLine}`, color: 0x57F287 }], components: [] });
      }

      // Ticket buttons
      if (id === "ticket_reopen") {
        const ticket = openTickets.get(interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket.", ephemeral: true });
        const cfg = ticketConfigs.get(ticket.guildId);
        const isStaff = OWNER_IDS.includes(interaction.user.id) || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
        if (!isStaff) return safeReply(interaction, { content: "Staff only.", ephemeral: true });
        try { await interaction.channel.permissionOverwrites.edit(ticket.userId, { VIEW_CHANNEL: true, SEND_MESSAGES: true, READ_MESSAGE_HISTORY: true }); } catch {}
        ticket.status = "open"; saveData();
        return safeReply(interaction, `🔓 **Ticket #${ticket.ticketId} reopened** by <@${interaction.user.id}>.`);
      }
      if (id === "ticket_delete") {
        const ticket = openTickets.get(interaction.channelId);
        if (!ticket) return safeReply(interaction, { content: "Not a ticket.", ephemeral: true });
        const cfg = ticketConfigs.get(ticket.guildId);
        const isStaff = OWNER_IDS.includes(interaction.user.id) || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
        if (!isStaff) return safeReply(interaction, { content: "Staff only.", ephemeral: true });
        await sendTicketTranscript(interaction.channel, ticket, cfg, interaction.user.tag);
        openTickets.delete(interaction.channelId); saveData();
        await interaction.channel.delete().catch(() => {});
        return;
      }
      if (id === "open_ticket") {
        if (!inGuild) return;
        const cfg = ticketConfigs.get(interaction.guildId);
        if (!cfg?.categoryId) return safeReply(interaction, { content: "Tickets not configured.", ephemeral: true });
        // Check existing open ticket
        const existing = [...openTickets.values()].find(t => t.userId === interaction.user.id && t.guildId === interaction.guildId && t.status !== "closed");
        if (existing) {
          const ch = interaction.guild.channels.cache.get(existing.channelId);
          return safeReply(interaction, { content: `You already have an open ticket: ${ch ? `<#${ch.id}>` : "unknown channel"}.`, ephemeral: true });
        }
        try {
          const ticketId = (cfg.nextId || 0) + 1; cfg.nextId = ticketId; ticketConfigs.set(interaction.guildId, cfg); saveData();
          const ch = await interaction.guild.channels.create(`ticket-${String(ticketId).padStart(4, "0")}`, {
            type: "GUILD_TEXT", parent: cfg.categoryId,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: ["VIEW_CHANNEL"] },
              { id: interaction.user.id, allow: ["VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY"] },
              ...(cfg.supportRoleIds || []).map(id => ({ id, allow: ["VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY"] })),
            ],
          });
          openTickets.set(ch.id, { ticketId, userId: interaction.user.id, guildId: interaction.guildId, channelId: ch.id, status: "open", createdAt: Date.now() });
          saveData();
          const closeRow = new MessageActionRow().addComponents(new MessageButton().setCustomId("ticket_close_from_channel").setLabel("Close Ticket 🔒").setStyle("DANGER"));
          await safeSend(ch, { content: `<@${interaction.user.id}>`, embeds: [{ title: `🎫 Ticket #${ticketId}`, description: `Welcome <@${interaction.user.id}>! Please describe your issue and a staff member will be with you shortly.\n\nClick **Close Ticket** when resolved.`, color: 0x5865F2, timestamp: new Date().toISOString() }], components: [closeRow] });
          if (cfg.logChannelId) { const logCh = interaction.guild.channels.cache.get(cfg.logChannelId); if (logCh) await safeSend(logCh, { embeds: [{ title: `🎫 Ticket #${ticketId} Opened`, description: `Opened by <@${interaction.user.id}>\nChannel: <#${ch.id}>`, color: 0x57F287, timestamp: new Date().toISOString() }] }); }
          return safeReply(interaction, { content: `✅ Ticket created: <#${ch.id}>`, ephemeral: true });
        } catch (e) { return safeReply(interaction, { content: `❌ Failed: ${e.message}`, ephemeral: true }); }
      }
      if (id === "ticket_close_from_channel") {
        const ticket = openTickets.get(interaction.channelId);
        if (!ticket || ticket.status === "closed") return safeReply(interaction, { content: "Ticket already closed.", ephemeral: true });
        const cfg = ticketConfigs.get(ticket.guildId);
        const canClose = ticket.userId === interaction.user.id || OWNER_IDS.includes(interaction.user.id) || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
        if (!canClose) return safeReply(interaction, { content: "No permission.", ephemeral: true });
        try { await interaction.channel.permissionOverwrites.edit(ticket.userId, { VIEW_CHANNEL: false, SEND_MESSAGES: false }); } catch {}
        ticket.status = "closed"; ticket.closedBy = interaction.user.id; ticket.closedAt = Date.now(); saveData();
        const staffRow = new MessageActionRow().addComponents(new MessageButton().setCustomId("ticket_reopen").setLabel("Reopen 🔓").setStyle("SUCCESS"), new MessageButton().setCustomId("ticket_delete").setLabel("Delete 🗑️").setStyle("DANGER"));
        return safeReply(interaction, { content: `🔒 **Ticket #${ticket.ticketId} closed** by <@${interaction.user.id}>.`, components: [staffRow] });
      }

      // Ticket setup flow buttons
      if (id === "ts_back") {
        if (!inGuild) return;
        const cfg = ticketConfigs.get(interaction.guildId) || {};
        function getStep(c) { if (!c.categoryId) return 1; if (!c.supportRoleIds?.length) return 2; if (c.logChannelId === undefined) return 3; if (c.transcriptChannelId === undefined) return 4; if (c.panelChannelId === undefined) return 5; return 6; }
        let step = getStep(cfg);
        if (step === 2) { delete cfg.categoryId; step = 1; }
        else if (step === 3) { delete cfg.supportRoleIds; step = 2; }
        else if (step === 4) { delete cfg.logChannelId; step = 3; }
        else if (step === 5) { delete cfg.transcriptChannelId; step = 4; }
        else if (step === 6) { delete cfg.panelChannelId; step = 5; }
        ticketConfigs.set(interaction.guildId, cfg); saveData();
        await btnAck(interaction);
        const reply = buildTicketStep(interaction.guild, interaction.guildId, step);
        return interaction.editReply(reply);
      }
      if (id === "ts_reset") {
        if (!inGuild) return;
        ticketConfigs.delete(interaction.guildId); saveData();
        await btnAck(interaction);
        const reply = buildTicketStep(interaction.guild, interaction.guildId, 1);
        return interaction.editReply(reply);
      }
      if (id === "ts_post_panel") {
        if (!inGuild) return;
        const cfg = ticketConfigs.get(interaction.guildId);
        if (!cfg?.panelChannelId) return safeReply(interaction, { content: "Complete setup first.", ephemeral: true });
        const ch = interaction.guild.channels.cache.get(cfg.panelChannelId);
        if (!ch) return safeReply(interaction, { content: "Panel channel not found.", ephemeral: true });
        const openRow = new MessageActionRow().addComponents(new MessageButton().setCustomId("open_ticket").setLabel("Open a Ticket 🎫").setStyle("PRIMARY"));
        const panelMsg = await safeSend(ch, { content: cfg.panelMessage || "🎫 **Support Tickets** — Click below to open a ticket.", components: [openRow] });
        if (panelMsg) { cfg.panelMessageId = panelMsg.id; ticketConfigs.set(interaction.guildId, cfg); saveData(); }
        await btnAck(interaction);
        return interaction.editReply({ content: `✅ Ticket panel posted in <#${cfg.panelChannelId}>!`, components: [] });
      }

      // Profile buttons
      if (id.startsWith("prof_inv_")) {
        const [, , targetId, viewerId] = id.split("_");
        if (interaction.user.id !== viewerId) return safeReply(interaction, { content: "Not your profile view.", ephemeral: true });
        const ts = getScore(targetId, null);
        const shop = getShopItems();
        const inv = ts.inventory || [];
        if (!inv.length) return safeReply(interaction, { content: "🎒 Inventory is empty.", ephemeral: true });
        const counts = {};
        for (const item of inv) counts[item] = (counts[item] || 0) + 1;
        const lines = Object.entries(counts).map(([id, count]) => `${shop[id]?.name || id} ×${count}`);
        return safeReply(interaction, { embeds: [{ title: "🎒 Inventory", description: lines.join("\n"), color: 0x5865F2 }], ephemeral: true });
      }
      if (id.startsWith("prof_trades_")) {
        const [, , targetId, viewerId] = id.split("_");
        if (interaction.user.id !== viewerId) return safeReply(interaction, { content: "Not your profile view.", ephemeral: true });
        const ts = getScore(targetId, null);
        const trades = ts.recentTrades || [];
        if (!trades.length) return safeReply(interaction, { content: "🔄 No recent trades.", ephemeral: true });
        const lines = trades.slice(-10).reverse().map(t => `${t.direction === "sent" ? "📤 Sent" : "📥 Received"}: ${t.coins ? `${t.coins} coins` : ""}${t.item ? ` + ${t.item}` : ""} ${t.direction === "sent" ? "to" : "from"} <@${t.partnerId}>`);
        return safeReply(interaction, { embeds: [{ title: "🔄 Recent Trades", description: lines.join("\n"), color: 0x5865F2 }], ephemeral: true });
      }
      if (id.startsWith("prof_stats_")) {
        const [, , targetId, viewerId] = id.split("_");
        if (interaction.user.id !== viewerId) return safeReply(interaction, { content: "Not your profile view.", ephemeral: true });
        const ts = getScore(targetId, null);
        return safeReply(interaction, { embeds: [{ title: "📊 Full Stats", fields: [
          { name: "💰 All-time coins earned", value: String(ts.totalCoinsEarned || ts.coins || 0), inline: true },
          { name: "🎮 Games Played", value: String(ts.gamesPlayed || 0), inline: true },
          { name: "🏆 Wins", value: String(ts.wins || 0), inline: true },
          { name: "🎣 Fish caught", value: String((ts.fishedItems || []).length), inline: true },
          { name: "⛏️ Ores mined", value: String((ts.minedItems || []).length), inline: true },
          { name: "🖼️ Images uploaded", value: String(ts.imagesUploaded || 0), inline: true },
          { name: "🔥 Best streak", value: String(ts.bestStreak || 0), inline: true },
        ], color: 0x5865F2 }], ephemeral: true });
      }
      if (id.startsWith("prof_badges_")) {
        const [, , targetId, viewerId] = id.split("_");
        if (interaction.user.id !== viewerId) return safeReply(interaction, { content: "Not your profile view.", ephemeral: true });
        const ts = getScore(targetId, null);
        const badges = ts.badges || [];
        return safeReply(interaction, { embeds: [{ title: "🏅 Badges", description: badges.length ? badges.join("  ") : "*No badges yet. Buy badges in the shop!*", color: 0x5865F2 }], ephemeral: true });
      }

      // Shop category select result handled below, but buy buttons:
      if (id.startsWith("shopbuy_")) {
        const parts = id.split("_");
        const ownerId = parts[1];
        const itemId = parts.slice(2).join("_");
        if (interaction.user.id !== ownerId) return safeReply(interaction, { content: "❌ This shop isn't yours.", ephemeral: true });
        const shop = getShopItems();
        const item = shop[itemId];
        if (!item) return safeReply(interaction, { content: "❌ Unknown item.", ephemeral: true });
        const s = getScore(interaction.user.id, interaction.user.username);
        if (s.coins < item.price) return safeReply(interaction, { content: `❌ Not enough coins! You need **${item.price}** but have **${s.coins}**.`, ephemeral: true });
        s.coins -= item.price;
        const timedItems = ["lucky_charm", "xp_boost", "vip_pass", "steal_boost"];
        if (timedItems.includes(itemId)) { activateTimedItem(interaction.user.id, itemId); }
        else { s.inventory.push(itemId); }
        saveData();
        await btnAck(interaction);
        // Determine current category
        const currentCat = interaction.message?.embeds?.[0]?.title?.includes("Buffs") ? "buffs" :
          interaction.message?.embeds?.[0]?.title?.includes("Protection") ? "protection" :
          interaction.message?.embeds?.[0]?.title?.includes("Tools") ? "tools" :
          interaction.message?.embeds?.[0]?.title?.includes("Misc") ? "misc" :
          interaction.message?.embeds?.[0]?.title?.includes("Boxes") ? "boxes" :
          interaction.message?.embeds?.[0]?.title?.includes("Cosmetics") ? "cosmetics" : "buffs";
        const updated = buildShopEmbed(interaction.user.id, currentCat);
        return interaction.editReply(updated);
      }

      // Heist join/launch
      if (id.startsWith("heist_join_")) {
        const channelId = id.replace("heist_join_", "");
        const heist = heists.get(channelId);
        if (!heist) return safeReply(interaction, { content: "This heist is no longer active.", ephemeral: true });
        if (heist.members.includes(interaction.user.id)) return safeReply(interaction, { content: "You're already in!", ephemeral: true });
        const s = getScore(interaction.user.id, interaction.user.username);
        const entry = Math.min(100, Math.floor(s.coins * 0.1));
        if (s.coins < 50) return safeReply(interaction, { content: "❌ You need at least 50 coins to join a heist.", ephemeral: true });
        s.coins -= entry; heist.members.push(interaction.user.id); heist.pot += entry; saveData();
        await btnAck(interaction);
        const heistEmbed = buildHeistEmbed(heist);
        return interaction.editReply(heistEmbed);
      }

      // Coinflip duel accept/decline
      if (id.startsWith("cfd_accept_")) {
        const msgId = id.replace("cfd_accept_", "");
        const duel = coinflipDuels.get(msgId);
        if (!duel) return safeReply(interaction, { content: "Duel expired.", ephemeral: true });
        if (interaction.user.id !== duel.targetId) return safeReply(interaction, { content: "This duel isn't for you.", ephemeral: true });
        const s2 = getScore(interaction.user.id, interaction.user.username);
        if (s2.coins < duel.bet) return safeReply(interaction, { content: `❌ Not enough coins! Need **${duel.bet}**.`, ephemeral: true });
        const s1 = getScore(duel.challengerId, null);
        const flip = Math.random() < 0.5;
        const winner = flip ? duel.challengerId : duel.targetId;
        const loser = flip ? duel.targetId : duel.challengerId;
        getScore(winner, null).coins += duel.bet;
        getScore(loser, null).coins -= duel.bet;
        coinflipDuels.delete(msgId); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "🪙 Coinflip Duel Result", description: `**${flip ? "Heads" : "Tails"}!**\n\n🏆 <@${winner}> wins **${duel.bet} coins**!\n💸 <@${loser}> loses **${duel.bet} coins**.`, color: flip ? 0xFFD700 : 0xFF4500 }], components: [] });
      }
      if (id.startsWith("cfd_decline_")) {
        const msgId = id.replace("cfd_decline_", "");
        const duel = coinflipDuels.get(msgId);
        if (!duel) return safeReply(interaction, { content: "Duel expired.", ephemeral: true });
        if (interaction.user.id !== duel.targetId) return safeReply(interaction, { content: "Not for you.", ephemeral: true });
        // Refund challenger
        getScore(duel.challengerId, null).coins += duel.bet; coinflipDuels.delete(msgId); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "🪙 Coinflip Duel Declined", description: `<@${duel.targetId}> declined the duel. Coins refunded.`, color: 0x5865F2 }], components: [] });
      }

      // Trade accept/decline
      if (id.startsWith("trade_accept_")) {
        const key = id.replace("trade_accept_", "");
        const trade = tradePending.get(key);
        if (!trade || Date.now() > trade.expiresAt) return safeReply(interaction, { content: "Trade expired.", ephemeral: true });
        const [senderId] = key.split(":");
        if (interaction.user.id !== trade.targetId) return safeReply(interaction, { content: "Not for you.", ephemeral: true });
        const sender = getScore(senderId, null);
        const receiver = getScore(trade.targetId, trade.targetName);
        if (trade.coins) { sender.coins -= trade.coins; receiver.coins += trade.coins; }
        if (trade.item) {
          const idx = sender.inventory.indexOf(trade.item);
          if (idx !== -1) { sender.inventory.splice(idx, 1); receiver.inventory.push(trade.item); }
        }
        // Record trade history
        if (!sender.recentTrades) sender.recentTrades = [];
        if (!receiver.recentTrades) receiver.recentTrades = [];
        const shop = getShopItems();
        const tradeNote = { coins: trade.coins || 0, item: trade.item ? shop[trade.item]?.name || trade.item : null, partnerId: trade.targetId, direction: "sent" };
        sender.recentTrades.push(tradeNote);
        receiver.recentTrades.push({ ...tradeNote, direction: "received", partnerId: senderId });
        if (sender.recentTrades.length > 20) sender.recentTrades = sender.recentTrades.slice(-20);
        if (receiver.recentTrades.length > 20) receiver.recentTrades = receiver.recentTrades.slice(-20);
        tradePending.delete(key); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "✅ Trade Accepted!", description: `<@${trade.targetId}> accepted the trade!\n${trade.coins ? `💰 ${trade.coins} coins transferred` : ""}\n${trade.item ? `🎁 ${shop[trade.item]?.name || trade.item} transferred` : ""}`, color: 0x57F287 }], components: [] });
      }
      if (id.startsWith("trade_decline_")) {
        const key = id.replace("trade_decline_", "");
        const trade = tradePending.get(key);
        if (!trade) return safeReply(interaction, { content: "Trade expired.", ephemeral: true });
        if (interaction.user.id !== trade.targetId) return safeReply(interaction, { content: "Not for you.", ephemeral: true });
        const [senderId] = key.split(":");
        if (trade.coins) getScore(senderId, null).coins += trade.coins;
        tradePending.delete(key); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "❌ Trade Declined", description: `<@${trade.targetId}> declined the trade. Coins refunded.`, color: 0xFF4500 }], components: [] });
      }

      // Marriage proposal
      if (id.startsWith("marry_accept_")) {
        const parts = id.split("_"); const proposerId = parts[2], targetId = parts[3];
        if (interaction.user.id !== targetId) return safeReply(interaction, { content: "Not for you.", ephemeral: true });
        const ps = getScore(proposerId, null); const ts = getScore(targetId, interaction.user.username);
        if (ps.marriedTo || ts.marriedTo) { marriageProposals.delete(`${proposerId}:${targetId}`); return safeReply(interaction, { content: "One of you is already married!", ephemeral: true }); }
        ps.marriedTo = targetId; ts.marriedTo = proposerId; ps.pendingProposal = null; ts.pendingProposal = null;
        marriageProposals.delete(`${proposerId}:${targetId}`); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "💍 Just Married!", description: `<@${proposerId}> and <@${targetId}> are now married! 🎉`, color: 0xFF69B4 }], components: [] });
      }
      if (id.startsWith("marry_decline_")) {
        const parts = id.split("_"); const proposerId = parts[2], targetId = parts[3];
        if (interaction.user.id !== targetId) return safeReply(interaction, { content: "Not for you.", ephemeral: true });
        const ps = getScore(proposerId, null); ps.pendingProposal = null;
        marriageProposals.delete(`${proposerId}:${targetId}`); saveData();
        await btnAck(interaction);
        return interaction.editReply({ embeds: [{ title: "💔 Proposal Declined", description: `<@${targetId}> said no. Rough.`, color: 0xFF4500 }], components: [] });
      }

      // Blackjack buttons
      if (id === "bj_hit" || id === "bj_stand" || id === "bj_double") {
        const bj = activeGames.get(`bj_${interaction.user.id}`);
        if (!bj || bj.playerId !== interaction.user.id) return safeReply(interaction, { content: "Not your game.", ephemeral: true });
        await btnAck(interaction);
        if (id === "bj_hit" || id === "bj_double") {
          if (id === "bj_double") {
            const s = getScore(interaction.user.id, null);
            const extraBet = Math.min(bj.bet, s.coins);
            s.coins -= extraBet; bj.bet += extraBet;
          }
          bj.playerHand.push(bj.deck.pop());
          const pv = handVal(bj.playerHand);
          if (pv > 21) {
            activeGames.delete(`bj_${interaction.user.id}`);
            const s = getScore(interaction.user.id, null);
            return interaction.editReply({ embeds: [{ title: "🃏 Blackjack — Bust!", description: `Your hand: ${renderHand(bj.playerHand)} = **${pv}**\nDealer: ${renderHand(bj.dealerHand)}\n\n💸 Lost **${bj.bet}** coins.`, color: 0xFF4500 }], components: [] });
          }
          if (id === "bj_double") {
            // Auto-stand after double
            return await bjStand(interaction, bj);
          }
          return interaction.editReply({ embeds: [{ title: "🃏 Blackjack", description: `Your hand: ${renderHand(bj.playerHand)} = **${pv}**\nDealer: ${renderHand(bj.dealerHand, true)}\n\nBet: **${bj.bet}** coins`, color: 0x5865F2 }], components: makeBJButtons() });
        }
        if (id === "bj_stand") return await bjStand(interaction, bj);
      }

      // TTT buttons
      if (id.startsWith("ttt_")) {
        const idx = parseInt(id.split("_")[1]);
        const game = activeGames.get(`ttt_${interaction.channelId}`);
        if (!game) return safeReply(interaction, { content: "No active game.", ephemeral: true });
        if (interaction.user.id !== game.players[game.turn]) return safeReply(interaction, { content: "Not your turn.", ephemeral: true });
        if (game.board[idx] !== null) return safeReply(interaction, { content: "Cell taken.", ephemeral: true });
        await btnAck(interaction);
        game.board[idx] = game.turn === 0 ? "X" : "O";
        const result = checkTTTWin(game.board);
        if (result) {
          activeGames.delete(`ttt_${interaction.channelId}`);
          if (result === "draw") {
            game.players.forEach((pid, i) => recordDraw(pid, game.usernames[i]));
            saveData();
            return interaction.editReply({ embeds: [{ title: "Tic Tac Toe — Draw!", description: renderTTT(game.board), color: 0x5865F2 }], components: makeTTTButtons(game.board, true) });
          }
          const winnerIdx = result === "X" ? 0 : 1;
          const loserIdx = 1 - winnerIdx;
          recordWin(game.players[winnerIdx], game.usernames[winnerIdx], CONFIG.win_ttt);
          recordLoss(game.players[loserIdx], game.usernames[loserIdx]);
          saveData();
          return interaction.editReply({ embeds: [{ title: `Tic Tac Toe — ${game.usernames[winnerIdx]} wins!`, description: renderTTT(game.board) + `\n\n🏆 +${CONFIG.win_ttt} coins!`, color: 0x57F287 }], components: makeTTTButtons(game.board, true) });
        }
        game.turn = 1 - game.turn;
        return interaction.editReply({ embeds: [{ title: "Tic Tac Toe", description: renderTTT(game.board) + `\n\n**${game.usernames[game.turn]}'s turn (${game.turn === 0 ? "❌" : "⭕"})**` }], components: makeTTTButtons(game.board) });
      }

      // Connect 4 buttons
      if (id.startsWith("c4_")) {
        const col = parseInt(id.split("_")[1]);
        const game = activeGames.get(`c4_${interaction.channelId}`);
        if (!game) return safeReply(interaction, { content: "No active game.", ephemeral: true });
        if (interaction.user.id !== game.players[game.turn]) return safeReply(interaction, { content: "Not your turn.", ephemeral: true });
        let row = -1;
        for (let r = 5; r >= 0; r--) { if (game.board[r * 7 + col] === 0) { row = r; break; } }
        if (row === -1) return safeReply(interaction, { content: "Column full!", ephemeral: true });
        await btnAck(interaction);
        game.board[row * 7 + col] = game.turn + 1;
        const winner = checkC4Win(game.board);
        if (winner) {
          activeGames.delete(`c4_${interaction.channelId}`);
          const winnerIdx = winner - 1;
          recordWin(game.players[winnerIdx], game.usernames[winnerIdx], CONFIG.win_c4);
          recordLoss(game.players[1 - winnerIdx], game.usernames[1 - winnerIdx]);
          saveData();
          return interaction.editReply({ embeds: [{ title: `Connect 4 — ${game.usernames[winnerIdx]} wins!`, description: renderC4(game.board) + `\n\n🏆 +${CONFIG.win_c4} coins!`, color: 0x57F287 }], components: [] });
        }
        if (!game.board.includes(0)) {
          activeGames.delete(`c4_${interaction.channelId}`);
          game.players.forEach((pid, i) => recordDraw(pid, game.usernames[i])); saveData();
          return interaction.editReply({ embeds: [{ title: "Connect 4 — Draw!", description: renderC4(game.board), color: 0x5865F2 }], components: [] });
        }
        game.turn = 1 - game.turn;
        return interaction.editReply({ embeds: [{ title: "Connect 4", description: renderC4(game.board) + `\n\n**${game.usernames[game.turn]}'s turn (${game.turn === 0 ? "🔴" : "🔵"})**` }], components: makeC4Buttons() });
      }

      // Hangman buttons
      if (id.startsWith("hm_")) {
        const letter = id.split("_")[1];
        const game = activeGames.get(`hm_${interaction.user.id}`);
        if (!game) return safeReply(interaction, { content: "No active game.", ephemeral: true });
        await btnAck(interaction);
        game.guessed.add(letter);
        const wrong = [...game.guessed].filter(l => !game.word.includes(l)).length;
        const solved = game.word.split("").every(l => game.guessed.has(l));
        if (solved) {
          activeGames.delete(`hm_${interaction.user.id}`);
          recordWin(interaction.user.id, interaction.user.username, CONFIG.win_hangman); saveData();
          return interaction.editReply({ embeds: [{ title: "🪢 Hangman — You Win!", description: renderHangman(game.word, game.guessed) + `\n\n🏆 +${CONFIG.win_hangman} coins!`, color: 0x57F287 }], components: makeHangmanButtons(game.word, game.guessed, true) });
        }
        if (wrong >= 6) {
          activeGames.delete(`hm_${interaction.user.id}`);
          return interaction.editReply({ embeds: [{ title: "🪢 Hangman — You Lose!", description: renderHangman(game.word, game.guessed) + `\n\nWord was: **${game.word}**`, color: 0xFF4500 }], components: makeHangmanButtons(game.word, game.guessed, true) });
        }
        return interaction.editReply({ embeds: [{ title: "🪢 Hangman", description: renderHangman(game.word, game.guessed) }], components: makeHangmanButtons(game.word, game.guessed) });
      }

      // Snake buttons
      if (id.startsWith("snake_")) {
        const dir = id.split("_")[1];
        const game = activeGames.get(`snake_${interaction.user.id}`);
        if (!game) return safeReply(interaction, { content: "No active game.", ephemeral: true });
        await btnAck(interaction);
        const head = game.snake[0];
        const moves = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
        const mv = moves[dir];
        const nx = head.x + mv.x, ny = head.y + mv.y;
        if (nx < 0 || nx >= game.size || ny < 0 || ny >= game.size || game.snake.some(s => s.x === nx && s.y === ny)) {
          activeGames.delete(`snake_${interaction.user.id}`);
          const coins = game.score * CONFIG.win_snake_per_point;
          recordWin(interaction.user.id, interaction.user.username, coins); saveData();
          return interaction.editReply({ embeds: [{ title: "🐍 Snake — Game Over!", description: `Score: **${game.score}**\n🏆 +${coins} coins!`, color: 0xFF4500 }], components: [] });
        }
        game.snake.unshift({ x: nx, y: ny });
        if (nx === game.food.x && ny === game.food.y) {
          game.score++;
          let fx, fy;
          do { fx = Math.floor(Math.random() * game.size); fy = Math.floor(Math.random() * game.size); }
          while (game.snake.some(s => s.x === fx && s.y === fy));
          game.food = { x: fx, y: fy };
        } else game.snake.pop();
        return interaction.editReply({ embeds: [{ title: "🐍 Snake", description: renderSnake(game) }], components: makeSnakeButtons() });
      }

      // Minesweeper buttons
      if (id.startsWith("ms_")) {
        const parts = id.split("_"); const row = parseInt(parts[1]), col = parseInt(parts[2]);
        const game = activeGames.get(`ms_${interaction.user.id}`);
        if (!game) return safeReply(interaction, { content: "No active game.", ephemeral: true });
        if (interaction.user.id !== game.playerId) return safeReply(interaction, { content: "Not your game.", ephemeral: true });
        await btnAck(interaction);
        // Safe first click — regenerate mines around first click
        if (game.firstClick) {
          game.firstClick = false;
          const regenerated = initMinesweeper(game.diff, row, col);
          game.mines = regenerated.mines; game.adj = regenerated.adj;
          game.revealed = regenerated.revealed; game.flagged = regenerated.flagged;
        }
        const idx = row * game.cols + col;
        if (game.mines.has(idx)) {
          // Reveal all mines
          for (const mineIdx of game.mines) game.revealed[mineIdx] = true;
          activeGames.delete(`ms_${interaction.user.id}`);
          return interaction.editReply({ embeds: [{ title: "💣 Minesweeper — BOOM!", description: `You hit a mine! Better luck next time.`, color: 0xFF4500 }], components: makeMSButtons(game, true) });
        }
        revealMS(game, row, col);
        const totalSafe = game.rows * game.cols - game.mines.size;
        const revealedCount = game.revealed.filter(Boolean).length;
        if (revealedCount >= totalSafe) {
          activeGames.delete(`ms_${interaction.user.id}`);
          const rewards = { easy: CONFIG.win_minesweeper_easy, medium: CONFIG.win_minesweeper_medium, hard: CONFIG.win_minesweeper_hard, xlhard: CONFIG.win_minesweeper_xlhard };
          const prize = rewards[game.diff] || CONFIG.win_minesweeper_easy;
          recordWin(interaction.user.id, interaction.user.username, prize); saveData();
          return interaction.editReply({ embeds: [{ title: "💣 Minesweeper — You Win! 🎉", description: `All safe cells cleared! +**${prize} coins**`, color: 0x57F287 }], components: makeMSButtons(game, true) });
        }
        return interaction.editReply({ embeds: [{ title: `💣 Minesweeper (${game.diff})`, description: `${game.rows}×${game.cols} — ${game.mines.size} mines` }], components: makeMSButtons(game) });
      }

      // botstats view users button
      if (id === "botstats_users") {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        const list = [...userInstalls].map(id => `<@${id}>`).join(", ") || "None";
        return safeReply(interaction, { content: `**App Users (${userInstalls.size}):**\n${list.slice(0, 1800)}`, ephemeral: true });
      }

      // Library nav
      if (id.startsWith("lib_")) {
        const parts = id.split("_"); const dir2 = parts[1], targetUserId = parts[2]; let idx = parseInt(parts[3]);
        const ts = getScore(targetUserId, null);
        const files = ts.uploadedImages || [];
        if (dir2 === "prev") idx = Math.max(0, idx - 1);
        if (dir2 === "next") idx = Math.min(files.length - 1, idx + 1);
        const fileName = files[idx];
        const imageUrl = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(fileName)}`;
        const row = new MessageActionRow().addComponents(
          new MessageButton().setCustomId(`lib_prev_${targetUserId}_${idx}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(idx === 0),
          new MessageButton().setCustomId(`lib_next_${targetUserId}_${idx}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(idx >= files.length - 1),
        );
        await btnAck(interaction);
        return interaction.editReply({ content: `🖼️ **Library** — Image ${idx + 1} of ${files.length}\n**\`${fileName}\`**\n${imageUrl}`, components: [row] });
      }

      // quotemanage nav/delete
      if (id.startsWith("qm_")) {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        const parts = id.split("_");
        if (parts[1] === "delete") {
          const fileName = parts.slice(2).join("_");
          await btnAck(interaction);
          try {
            const ghPath = `quotes/${fileName}`;
            const checkRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`, { headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json" } });
            if (!checkRes.ok) return interaction.editReply({ content: `❌ File not found or API error.`, components: [] });
            const fileData = await checkRes.json(); const sha = fileData.sha;
            await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`, { method: "DELETE", headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ message: `chore: delete ${fileName} via Discord`, sha }) });
            for (const [, s] of scores) { if (Array.isArray(s.uploadedImages)) s.uploadedImages = s.uploadedImages.filter(n => n !== fileName); }
            saveData();
            return interaction.editReply({ content: `🗑️ \`${fileName}\` deleted.`, components: [] });
          } catch (e) { return interaction.editReply({ content: `❌ Error: ${e.message}`, components: [] }); }
        }
        if (parts[1] === "prev" || parts[1] === "next") {
          let idx2 = parseInt(parts[2]); const total = parseInt(parts[3] || "0");
          if (parts[1] === "prev") idx2 = Math.max(0, idx2 - 1);
          if (parts[1] === "next") idx2 = Math.min(total - 1, idx2 + 1);
          await btnAck(interaction);
          try {
            const listRes = await fetch("https://api.github.com/repos/Royal-V-RR/discord-bot/contents/quotes", { headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json" } });
            const files2 = await listRes.json(); const images2 = files2.filter(f => f.type === "file" && /\.(png|jpe?g|gif|webp)$/i.test(f.name));
            if (!images2.length) return interaction.editReply({ content: "No images.", components: [] });
            idx2 = Math.max(0, Math.min(idx2, images2.length - 1));
            const file2 = images2[idx2];
            const imageUrl2 = `https://raw.githubusercontent.com/Royal-V-RR/discord-bot/main/quotes/${encodeURIComponent(file2.name)}`;
            const navRow2 = new MessageActionRow().addComponents(new MessageButton().setCustomId(`qm_prev_${idx2}_${images2.length}`).setLabel("◀ Prev").setStyle("SECONDARY").setDisabled(idx2 === 0), new MessageButton().setCustomId(`qm_next_${idx2}_${images2.length}`).setLabel("Next ▶").setStyle("SECONDARY").setDisabled(idx2 >= images2.length - 1), new MessageButton().setCustomId(`qm_delete_${file2.name}`).setLabel("🗑️ Delete This").setStyle("DANGER"));
            return interaction.editReply({ content: `🖼️ **Quote Manager** — ${idx2 + 1} of ${images2.length}\n\`${file2.name}\`\n${imageUrl2}`, components: [navRow2] });
          } catch { return interaction.editReply({ content: "❌ Error.", components: [] }); }
        }
      }

      // quote review accept/reject
      if (id.startsWith("qr_accept_") || id.startsWith("qr_reject_")) {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        const accepted = id.startsWith("qr_accept_");
        const rest = id.replace(/^qr_(accept|reject)_/, "");
        const underscoreIdx = rest.indexOf("_");
        const submitterId = rest.slice(0, underscoreIdx);
        const fileName = rest.slice(underscoreIdx + 1);
        await btnAck(interaction);
        if (accepted) {
          try {
            const attachment = interaction.message.embeds[0]?.image?.url;
            if (!attachment) return interaction.editReply({ content: "❌ No image found.", components: [] });
            const res = await fetch(attachment);
            const fileBuffer = Buffer.from(await res.arrayBuffer());
            const ghPath = `quotes/${fileName}`;
            const checkRes = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`, { headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json" } });
            let sha2 = null; if (checkRes.ok) { const j = await checkRes.json(); sha2 = j.sha || null; }
            await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath}`, { method: "PUT", headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ message: `feat: approved quote ${fileName}`, content: fileBuffer.toString("base64"), ...(sha2 ? { sha: sha2 } : {}) }) });
            const ss = getScore(submitterId, null);
            ss.imagesUploaded = (ss.imagesUploaded || 0) + 1;
            if (!Array.isArray(ss.uploadedImages)) ss.uploadedImages = [];
            if (!ss.uploadedImages.includes(fileName)) ss.uploadedImages.push(fileName);
            saveData();
            try { const submitter2 = await client.users.fetch(submitterId); await submitter2.send(`✅ Your quote submission **\`${fileName}\`** was approved!`); } catch {}
            return interaction.editReply({ content: `✅ Approved and uploaded \`${fileName}\`.`, components: [], embeds: interaction.message.embeds });
          } catch (e) { return interaction.editReply({ content: `❌ Upload failed: ${e.message}`, components: [] }); }
        } else {
          try { const submitter3 = await client.users.fetch(submitterId); await submitter3.send(`❌ Your quote submission **\`${fileName}\`** was rejected.`); } catch {}
          return interaction.editReply({ content: `❌ Rejected \`${fileName}\`.`, components: [], embeds: interaction.message.embeds });
        }
      }

      // Owner panel buttons (handled by select menu below, but sub-category buttons)
      if (id === "owner_back") {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        await btnAck(interaction);
        return interaction.editReply(buildOwnerPanel());
      }

      return; // end buttons
    }

    // ── Select menu interactions ───────────────────────────────────────────────
    if (interaction.isSelectMenu()) {
      const id = interaction.customId;

      // Shop category selector
      if (id.startsWith("shop_cat_")) {
        const ownerId = id.replace("shop_cat_", "");
        if (interaction.user.id !== ownerId) return safeReply(interaction, { content: "Not your shop.", ephemeral: true });
        const category = interaction.values[0];
        await btnAck(interaction);
        return interaction.editReply(buildShopEmbed(interaction.user.id, category));
      }

      // Owner panel select
      if (id === "owner_panel_select") {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        const section = interaction.values[0];
        await btnAck(interaction);
        return interaction.editReply(buildOwnerPanelSection(section));
      }

      // Ticket setup selects
      if (id.startsWith("ts_sel_")) {
        if (!inGuild) return;
        if (!interaction.member?.permissions.has("MANAGE_GUILD") && !OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Manage Server required.", ephemeral: true });
        const cfg2 = ticketConfigs.get(interaction.guildId) || {};
        const type = id.replace("ts_sel_", "").split("_")[0];
        if (type === "channel") { cfg2.categoryId = interaction.values[0]; }
        else if (type === "roles") { cfg2.supportRoleIds = interaction.values; }
        else if (type === "log") { cfg2.logChannelId = interaction.values[0] === "__none__" ? null : interaction.values[0]; }
        else if (type === "transcript") { cfg2.transcriptChannelId = interaction.values[0] === "__none__" ? null : interaction.values[0]; }
        else if (type === "panel") { const [, , panelCh2] = id.split("_"); cfg2.panelChannelId = interaction.values[0]; }
        ticketConfigs.set(interaction.guildId, cfg2); saveData();
        await btnAck(interaction);
        return interaction.editReply(buildTicketStep(interaction.guild, interaction.guildId));
      }

      // Activity check role selects
      if (id.startsWith("ac_required_") || id.startsWith("ac_excluded_")) {
        const pending = interaction.client._acPending?.get(interaction.user.id);
        if (!pending) return safeReply(interaction, { content: "Session expired, re-run /activity-check.", ephemeral: true });
        if (id.startsWith("ac_required_")) pending.requiredIds = interaction.values;
        else pending.excludedIds = interaction.values;
        // Check if both set
        if (pending.requiredIds.length > 0) {
          const sendBtn = new MessageButton().setCustomId("ac_send_check").setLabel("📋 Send Activity Check").setStyle("PRIMARY");
          const schedBtn = pending.parsedSchedule ? new MessageButton().setCustomId("ac_save_schedule").setLabel("💾 Save Weekly Schedule").setStyle("SUCCESS") : null;
          const row = new MessageActionRow().addComponents(sendBtn, ...(schedBtn ? [schedBtn] : []));
          await btnAck(interaction);
          return interaction.editReply({ content: interaction.message.content + `\n\n✅ Required roles: ${pending.requiredIds.map(id => `<@&${id}>`).join(", ")}\n🚫 Excluded: ${pending.excludedIds.map(id => `<@&${id}>`).join(", ") || "None"}\n\nReady to send!`, components: [row] });
        }
        await btnAck(interaction);
        return;
      }

      return;
    }

    // ── Activity check send/schedule buttons ──────────────────────────────────
    if (interaction.isButton() || interaction.isSelectMenu()) return; // already handled above

    if (interaction.isButton() && interaction.customId === "ac_send_check") {
      const pending = interaction.client._acPending?.get(interaction.user.id);
      if (!pending) return safeReply(interaction, { content: "Session expired.", ephemeral: true });
      const deadline = Date.now() + pending.deadlineHr * 3600000;
      const pingLine = pending.doPing && pending.requiredIds.length ? pending.requiredIds.map(id => `<@&${id}>`).join(" ") + "\n" : "";
      const sent = await safeSend(pending.channel, { content: pingLine || undefined, embeds: [{ title: "📋 Activity Check", description: (pending.customMsg || "React with ✅ to confirm you're active!") + `\n\n⏰ Closes <t:${Math.floor(deadline / 1000)}:R>`, color: 0x5865F2, timestamp: new Date().toISOString() }] });
      if (sent) {
        await sent.react("✅").catch(() => {});
        activityChecks.set(sent.id, { guildId: interaction.guildId, channelId: pending.channel.id, roleIds: pending.requiredIds, excludedIds: pending.excludedIds, deadline });
        setTimeout(async () => {
          const c = activityChecks.get(sent.id); if (!c) return;
          activityChecks.delete(sent.id); saveData();
          const g2 = client.guilds.cache.get(c.guildId); if (!g2) return;
          const ch2 = g2.channels.cache.get(c.channelId); if (!ch2) return;
          let reacted = new Set();
          try { const fm = await ch2.messages.fetch(sent.id); const rx = fm.reactions.cache.get("✅"); if (rx) { const u = await rx.users.fetch(); u.forEach(u2 => { if (!u2.bot) reacted.add(u2.id); }); } } catch {}
          let missing2 = [];
          try { const members = await g2.members.fetch(); members.forEach(m => { if (m.user.bot) return; if (!c.roleIds.some(rid => m.roles.cache.has(rid))) return; if (c.excludedIds.some(rid => m.roles.cache.has(rid))) return; if (!reacted.has(m.id)) missing2.push(`<@${m.id}>`); }); } catch {}
          await ch2.send({ embeds: [{ title: "📋 Activity Check Closed", fields: [{ name: "✅ Checked in", value: String(reacted.size), inline: true }, { name: "❌ Did not respond", value: (missing2.join(", ") || "None! ✅").slice(0, 1024), inline: false }], color: 0x5865F2, timestamp: new Date().toISOString() }] }).catch(() => {});
        }, pending.deadlineHr * 3600000);
        saveData();
      }
      interaction.client._acPending.delete(interaction.user.id);
      await btnAck(interaction);
      return interaction.editReply({ content: `✅ Activity check sent in ${pending.channel}!`, components: [] });
    }

    // ── Message context menus ─────────────────────────────────────────────────
    if (interaction.isMessageContextMenu()) {
      const msg2 = interaction.targetMessage;
      const cmd2 = interaction.commandName;

      if (cmd2 === "Reaction Bomb") {
        if (!OWNER_IDS.includes(interaction.user.id) && !interaction.member?.permissions.has("MANAGE_MESSAGES")) return safeReply(interaction, { content: "Permission denied.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const bombs = ["💣", "💥", "🔥", "⚡", "🌪️", "🎊", "🎉", "🤯", "💀", "👀"];
        for (const emoji of bombs) { try { await msg2.react(emoji); } catch {} await new Promise(r => setTimeout(r, 300)); }
        return safeReply(interaction, "✅ Bombed!");
      }
      if (cmd2 === "Clank This") {
        if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const target2 = msg2.author;
        const cl2 = clankerify.get(target2.id) || {};
        clankerify.set(target2.id, { ...cl2, expiresAt: Date.now() + 10 * 60 * 1000 });
        saveData();
        return safeReply(interaction, `✅ ${target2.username} is being clanked for 10 minutes.`);
      }
      if (cmd2 === "Expose") {
        await interaction.deferReply();
        const target3 = msg2.author;
        const s = getScore(target3.id, target3.username);
        return safeReply(interaction, { embeds: [{ title: `🕵️ Exposing ${target3.username}`, fields: [{ name: "Coins", value: String(s.coins), inline: true }, { name: "Level", value: String(s.level || 1), inline: true }, { name: "Wins", value: String(s.wins), inline: true }, { name: "Daily Streak", value: String(s.dailyStreak), inline: true }, { name: "Married To", value: s.marriedTo ? `<@${s.marriedTo}>` : "Nobody", inline: true }, { name: "Inventory Items", value: String((s.inventory || []).length), inline: true }], color: 0xFF4500, thumbnail: { url: target3.displayAvatarURL({ size: 128, dynamic: true }) } }] });
      }
      if (cmd2 === "Vibe Check") {
        await safeReply(interaction, { content: `🔍 Vibe checking **${msg2.author.username}**…\n\n${pick(["✅ Vibes: immaculate.", "⚠️ Vibes: questionable.", "❌ Vibes: off.", "🌊 Vibes: chaotic good.", "🧊 Vibes: cold.", "🔥 Vibes: on fire."])}` });
        return;
      }
      if (cmd2 === "Uwu-ify") {
        const text = msg2.content.slice(0, 1800);
        if (!text) return safeReply(interaction, { content: "No text to uwu-ify.", ephemeral: true });
        const uwu = text.replace(/r|l/g, "w").replace(/R|L/g, "W").replace(/n([aeiou])/g, "ny$1").replace(/N([AEIOU])/g, "NY$1").replace(/\./g, " uwu.").replace(/!/g, "!!! owo").replace(/\?/g, "? owo");
        return safeReply(interaction, { content: `**Uwu-ified:**\n${uwu}` });
      }
      if (cmd2 === "Quote This") {
        if (!MEMERS.has(interaction.user.id) && !OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Memers only.", ephemeral: true });
        if (!msg2.attachments.size) return safeReply(interaction, { content: "No image attached.", ephemeral: true });
        const att2 = [...msg2.attachments.values()].find(a => /^image\//i.test(a.contentType || ""));
        if (!att2) return safeReply(interaction, { content: "No image found.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          const res2 = await fetch(att2.url);
          const fileBuffer2 = Buffer.from(await res2.arrayBuffer());
          if (fileBuffer2.length > 1_000_000) return safeReply(interaction, { content: "Image too large (max 1MB).", ephemeral: true });
          let fileName2 = att2.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          if (!/\.(png|jpe?g|gif|webp)$/i.test(fileName2)) fileName2 += ".jpg";
          const ghPath2 = `quotes/${fileName2}`;
          const checkRes2 = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath2}`, { headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json" } });
          let sha3 = null; if (checkRes2.ok) { const j2 = await checkRes2.json(); sha3 = j2.sha || null; }
          const putRes2 = await fetch(`https://api.github.com/repos/Royal-V-RR/discord-bot/contents/${ghPath2}`, { method: "PUT", headers: { "User-Agent": "RoyalBot", "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ message: `feat: quote this ${fileName2}`, content: fileBuffer2.toString("base64"), ...(sha3 ? { sha: sha3 } : {}) }) });
          if (!putRes2.ok) return safeReply(interaction, { content: "❌ Upload failed.", ephemeral: true });
          const ss2 = getScore(interaction.user.id, interaction.user.username);
          ss2.imagesUploaded = (ss2.imagesUploaded || 0) + 1;
          if (!Array.isArray(ss2.uploadedImages)) ss2.uploadedImages = [];
          if (!ss2.uploadedImages.includes(fileName2)) ss2.uploadedImages.push(fileName2);
          saveData();
          return safeReply(interaction, { content: `✅ \`${fileName2}\` added to quotes!`, ephemeral: true });
        } catch (e) { return safeReply(interaction, { content: `❌ Error: ${e.message}`, ephemeral: true }); }
      }
      if (cmd2 === "Fetch Emoji") {
        await interaction.deferReply({ ephemeral: true });
        const emojiMatches = [...msg2.content.matchAll(/<a?:(\w+):(\d+)>/g)];
        if (!emojiMatches.length) return safeReply(interaction, { content: "No custom emoji found.", ephemeral: true });
        const lines = emojiMatches.map(m => { const animated = m[0].startsWith("<a"); return `**${m[1]}** — \`<${animated ? "a" : ""}:${m[1]}:${m[2]}>\`\nhttps://cdn.discordapp.com/emojis/${m[2]}.${animated ? "gif" : "png"}`; });
        return safeReply(interaction, { content: lines.slice(0, 5).join("\n\n"), ephemeral: true });
      }
      return;
    }

    if (!interaction.isCommand()) return;

    const { commandName: cmd, user } = interaction;
    const isOwner = OWNER_IDS.includes(user.id);
    const ownerOnly = ["broadcast", "fakecrash", "identitycrisis", "botolympics", "sentience", "legendrandom", "owner", "forcemarry", "forcedivorce", "shadowdelete", "clankerify", "fakemessage", "admingive", "quotedelete", "quotelist", "quotemanage", "managememers", "requester"];
    if (ownerOnly.includes(cmd) && !isOwner) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });

    if (!inGuild) userInstalls.add(user.id);

    // ─────────────────────────────────────────────────────────────────────────
    // COMMAND HANDLERS
    // ─────────────────────────────────────────────────────────────────────────

    // ── /ping ─────────────────────────────────────────────────────────────────
    if (cmd === "ping") {
      const before = Date.now();
      await interaction.deferReply();
      const latency = Date.now() - before;
      return safeReply(interaction, { embeds: [{ title: "🏓 Pong!", fields: [{ name: "API Latency", value: `${latency}ms`, inline: true }, { name: "WS Heartbeat", value: `${Math.round(client.ws.ping)}ms`, inline: true }], color: latency < 100 ? 0x57F287 : latency < 300 ? 0xFEE75C : 0xFF4500 }] });
    }

    // ── /botinfo ──────────────────────────────────────────────────────────────
    if (cmd === "botinfo") {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);
      return safeReply(interaction, { embeds: [{ title: "🤖 Bot Info", thumbnail: { url: client.user.displayAvatarURL({ size: 128 }) }, fields: [{ name: "Bot", value: client.user.tag, inline: true }, { name: "Servers", value: String(client.guilds.cache.size), inline: true }, { name: "Uptime", value: `${h}h ${m}m ${s}s`, inline: true }, { name: "Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true }, { name: "Node", value: process.version, inline: true }, { name: "Memory", value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true }], color: 0x5865F2, timestamp: new Date().toISOString() }] });
    }

    // ── /help ─────────────────────────────────────────────────────────────────
    if (cmd === "help") {
      const categories = [
        { name: "💬 Social", cmds: "ping, avatar, punch, hug, kiss, slap, throw, marry, divorce, partner, action, rate, ppsize, party, ship, roast, compliment" },
        { name: "🎮 Games", cmds: "games (hangman, snake, minesweeper, numberguess, wordscramble, daily), 2playergames (ttt, connect4, rps, mathrace, wordrace, trivia, scramblerace, countgame)" },
        { name: "💰 Economy", cmds: "coins, daily, work, beg, crime, rob, fish, mine, slots, coinbet, blackjack, givecoin, shop, open, inventory, bank, heist, trade, coinflip_duel, lottery" },
        { name: "📊 Stats", cmds: "score, leaderboard, serverleaderboard, xp, xpleaderboard, userprofile, setbio" },
        { name: "🎲 Utility", cmds: "coinflip, roll, choose, topic, wyr, 8ball, advice, fact, horoscope, poll, remind, echo, premiere, joke, meme, trivia, gif" },
        { name: "📺 YouTube", cmds: "ytsetup, subgoal, subcount, milestones" },
        { name: "🖼️ Quotes", cmds: "quote, goodquote, badquote, upload, requestupload, library, dailyquote" },
        { name: "🔧 Server", cmds: "channelpicker, setwelcome, setleave, setboostmsg, autorole, reactionrole, counting, xpconfig, purge, invitecomp, ticketsetup, serverinfo, serverconfig, rolespingfix, activity-check, raconfig, reduced-activity, loa, disableownermsg" },
      ];
      return safeReply(interaction, { embeds: [{ title: "📖 RoyalBot — Command Guide", description: "Use `/` to browse all commands. Below is a summary by category.", fields: categories.map(c => ({ name: c.name, value: c.cmds, inline: false })), color: 0x5865F2, footer: { text: "Context menus: right-click a message for extra options" }, timestamp: new Date().toISOString() }] });
    }

    // ── /serverinfo ───────────────────────────────────────────────────────────
    if (cmd === "serverinfo") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const g = interaction.guild;
      return safeReply(interaction, { embeds: [{ title: g.name, thumbnail: { url: g.iconURL({ dynamic: true, size: 128 }) || "" }, fields: [{ name: "Owner", value: `<@${g.ownerId}>`, inline: true }, { name: "Members", value: g.memberCount.toLocaleString(), inline: true }, { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }, { name: "Channels", value: String(g.channels.cache.size), inline: true }, { name: "Roles", value: String(g.roles.cache.size), inline: true }, { name: "Boost Level", value: `Level ${g.premiumTier}`, inline: true }], color: 0x5865F2 }] });
    }

    // ── /avatar ───────────────────────────────────────────────────────────────
    if (cmd === "avatar") {
      const target = interaction.options.getUser("user");
      return safeReply(interaction, { embeds: [{ title: `${target.username}'s Avatar`, image: { url: target.displayAvatarURL({ size: 1024, dynamic: true }) }, color: 0x5865F2 }] });
    }

    // ── Social actions ────────────────────────────────────────────────────────
    if (["punch","hug","kiss","slap","throw"].includes(cmd)) {
      const target = interaction.options.getUser("user");
      const msgs = { punch: `👊 **${user.username}** punched **${target.username}**!`, hug: `🤗 **${user.username}** hugged **${target.username}**!`, kiss: `💋 **${user.username}** kissed **${target.username}**! 😳`, slap: `👋 **${user.username}** slapped **${target.username}**!`, throw: `🎯 **${user.username}** threw ${pick(THROW_ITEMS)} at **${target.username}**!` };
      return safeReply(interaction, msgs[cmd]);
    }
    if (cmd === "action") {
      const type = interaction.options.getString("type"); const target = interaction.options.getUser("user");
      const msgs2 = { hug: `🤗 **${user.username}** hugs **${target.username}**!`, pat: `🫶 **${user.username}** pats **${target.username}**!`, poke: `👉 **${user.username}** pokes **${target.username}**!`, stare: `👀 **${user.username}** stares at **${target.username}**…`, wave: `👋 **${user.username}** waves at **${target.username}**!`, highfive: `🖐️ **${user.username}** high-fives **${target.username}**!`, boop: `🥺 **${user.username}** boops **${target.username}**'s nose!`, oil: `💦 **${user.username}** oils up **${target.username}**. Weird.`, diddle: `💀 **${user.username}** tried to diddle **${target.username}**. Ew.`, kill: `☠️ **${user.username}** eliminated **${target.username}**.` };
      return safeReply(interaction, msgs2[type] || "Unknown action.");
    }

    // ── /rate ─────────────────────────────────────────────────────────────────
    if (cmd === "rate") {
      const type = interaction.options.getString("type"); const target = interaction.options.getUser("user");
      const seed = target.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) + type.length;
      const pct = seed % 101;
      const labels = { gayrate: `🏳️‍🌈 **${target.username}** is **${pct}%** gay!`, howautistic: `🧩 **${target.username}** is **${pct}%** autistic!`, simp: `😍 **${target.username}** is **${pct}%** simp!`, cursed: `🌀 **${target.username}** has **${pct}%** cursed energy.`, npc: `🤖 **${target.username}** is **${pct}%** NPC.`, villain: `😈 **${target.username}** is **${pct}%** into their villain arc.`, sigma: `😎 **${target.username}**'s sigma rating: **${pct}/100**` };
      return safeReply(interaction, labels[type] || `${target.username}: ${pct}%`);
    }

    // ── /ppsize ───────────────────────────────────────────────────────────────
    if (cmd === "ppsize") {
      const target = interaction.options.getUser("user");
      const size = target.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 21;
      return safeReply(interaction, `📏 **${target.username}'s pp:** 8${"=".repeat(size)}D *(${size}cm)*`);
    }

    // ── /party ────────────────────────────────────────────────────────────────
    if (cmd === "party") {
      const type = interaction.options.getString("type");
      if (type === "truth") return safeReply(interaction, `🎲 **Truth:** ${pick(TRUTH_QUESTIONS)}`);
      if (type === "dare") return safeReply(interaction, `🎯 **Dare:** ${pick(DARE_ACTIONS)}`);
      if (type === "neverhavei") return safeReply(interaction, `🙋 **Never have I ever…** ${pick(NEVERHAVEI_STMTS)}`);
    }

    // ── /marry ────────────────────────────────────────────────────────────────
    if (cmd === "marry") {
      const target = interaction.options.getUser("user");
      if (target.id === user.id) return safeReply(interaction, { content: "You can't marry yourself.", ephemeral: true });
      if (target.bot) return safeReply(interaction, { content: "You can't marry a bot.", ephemeral: true });
      const ps = getScore(user.id, user.username); const ts = getScore(target.id, target.username);
      if (ps.marriedTo) return safeReply(interaction, { content: `You're already married to <@${ps.marriedTo}>! Use /divorce first.`, ephemeral: true });
      if (ts.marriedTo) return safeReply(interaction, { content: `${target.username} is already married.`, ephemeral: true });
      const key = `${user.id}:${target.id}`;
      if (marriageProposals.has(key)) return safeReply(interaction, { content: "You already have a pending proposal to this person.", ephemeral: true });
      marriageProposals.set(key, Date.now());
      ps.pendingProposal = target.id;
      const row = new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`marry_accept_${user.id}_${target.id}`).setLabel("💍 Accept").setStyle("SUCCESS"),
        new MessageButton().setCustomId(`marry_decline_${user.id}_${target.id}`).setLabel("💔 Decline").setStyle("DANGER"),
      );
      return safeReply(interaction, { content: `<@${target.id}>`, embeds: [{ title: "💍 Marriage Proposal!", description: `**${user.username}** is proposing to **${target.username}**!\n\nDo you accept? 💕`, color: 0xFF69B4 }], components: [row] });
    }
    if (cmd === "divorce") {
      const s = getScore(user.id, user.username);
      if (!s.marriedTo) return safeReply(interaction, { content: "You're not married.", ephemeral: true });
      const partnerId = s.marriedTo;
      s.marriedTo = null;
      const ps2 = getScore(partnerId, null); ps2.marriedTo = null;
      saveData();
      return safeReply(interaction, { embeds: [{ title: "💔 Divorce Filed", description: `**${user.username}** and <@${partnerId}> are no longer married.`, color: 0xFF4500 }] });
    }
    if (cmd === "forcedivorce") {
      const target = interaction.options.getUser("user");
      const ts2 = getScore(target.id, target.username);
      const partnerId2 = ts2.marriedTo;
      ts2.marriedTo = null;
      if (partnerId2) { const ps3 = getScore(partnerId2, null); ps3.marriedTo = null; }
      saveData();
      return safeReply(interaction, { content: `✅ Forcibly divorced **${target.username}**${partnerId2 ? ` from <@${partnerId2}>` : ""}.`, ephemeral: true });
    }
    if (cmd === "forcemarry") {
      const u1 = interaction.options.getUser("user1"); const u2 = interaction.options.getUser("user2");
      const s1 = getScore(u1.id, u1.username); const s2 = getScore(u2.id, u2.username);
      s1.marriedTo = u2.id; s2.marriedTo = u1.id;
      saveData();
      return safeReply(interaction, { embeds: [{ title: "💍 Force Married!", description: `<@${u1.id}> and <@${u2.id}> are now married whether they like it or not. 💀`, color: 0xFF69B4 }], ephemeral: true });
    }
    if (cmd === "partner") {
      const target = interaction.options.getUser("user") || user;
      const ts3 = getScore(target.id, target.username);
      if (!ts3.marriedTo) return safeReply(interaction, { content: `**${target.username}** is single.`, ephemeral: true });
      return safeReply(interaction, { embeds: [{ description: `💑 **${target.username}** is married to <@${ts3.marriedTo}>`, color: 0xFF69B4 }] });
    }

    // ── /roast / /compliment ───────────────────────────────────────────────────
    if (cmd === "roast") { const t = interaction.options.getUser("user") || user; return safeReply(interaction, `🔥 **${t.username}**: ${pick(ROASTS)}`); }
    if (cmd === "compliment") { const t = interaction.options.getUser("user") || user; return safeReply(interaction, `💖 **${t.username}**: ${pick(COMPLIMENTS)}`); }

    // ── /ship ─────────────────────────────────────────────────────────────────
    if (cmd === "ship") {
      const u1 = interaction.options.getUser("user1"); const u2 = interaction.options.getUser("user2");
      const pct2 = (parseInt(u1.id.slice(-3)) + parseInt(u2.id.slice(-3))) % 101;
      const bar2 = buildBar(pct2, 100, 15);
      return safeReply(interaction, { embeds: [{ title: `💘 ${u1.username} ❤️ ${u2.username}`, description: `Compatibility: **${pct2}%**\n\`[${bar2}]\`\n\n${pct2 >= 80 ? "💯 Perfect match!" : pct2 >= 50 ? "💕 Pretty good!" : pct2 >= 25 ? "🤔 It's complicated." : "💀 Yikes."}`, color: 0xFF69B4 }] });
    }

    // ── Misc fun ──────────────────────────────────────────────────────────────
    if (cmd === "topic") return safeReply(interaction, `💬 **Topic:** ${pick(TOPICS)}`);
    if (cmd === "wyr") return safeReply(interaction, `🤔 **Would you rather…**\n${pick(WYR)}`);
    if (cmd === "advice") return safeReply(interaction, `🧙 **Advice:** ${pick(ADVICE)}`);
    if (cmd === "fact") return safeReply(interaction, `📚 **Fun Fact:** ${pick(FACTS)}`);
    if (cmd === "horoscope") return safeReply(interaction, HOROSCOPES[interaction.options.getString("sign")] || "Unknown sign.");
    if (cmd === "coinflip") return safeReply(interaction, `🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}!**`);
    if (cmd === "roll") { const sides = interaction.options.getInteger("sides") || 6; return safeReply(interaction, `🎲 You rolled a **${r(1, sides)}** (d${sides})`); }
    if (cmd === "choose") { const opts2 = interaction.options.getString("options").split(",").map(s => s.trim()).filter(Boolean); if (!opts2.length) return safeReply(interaction, { content: "No options provided.", ephemeral: true }); return safeReply(interaction, `🎯 I choose: **${pick(opts2)}**`); }
    if (cmd === "8ball") return safeReply(interaction, `🎱 *${interaction.options.getString("question")}*\n\n**${pick(EIGHT_BALL)}**`);
    if (cmd === "poll") {
      const q = interaction.options.getString("question");
      const msg3 = await safeReply(interaction, { embeds: [{ title: "📊 Poll", description: `**${q}**\n\n✅ Yes   ❌ No`, color: 0x5865F2 }], fetchReply: true });
      if (msg3) { await msg3.react("✅").catch(() => {}); await msg3.react("❌").catch(() => {}); }
      return;
    }

    // ── /echo ─────────────────────────────────────────────────────────────────
    if (cmd === "echo") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_MESSAGES") && !isOwner) return safeReply(interaction, { content: "You need Manage Messages permission.", ephemeral: true });
      const message = interaction.options.getString("message") || null;
      const useEmbed = interaction.options.getBoolean("embed") || false;
      const imageAtt = interaction.options.getAttachment("image") || null;
      const title = interaction.options.getString("title") || null;
      const colorStr = interaction.options.getString("color") || null;
      const replyTo = interaction.options.getString("replyto") || null;
      const color2 = colorStr ? parseInt(colorStr.replace("#", ""), 16) : 0x5865F2;
      const channel = interaction.channel;
      let replyMsg = null;
      if (replyTo) replyMsg = await channel.messages.fetch(replyTo).catch(() => null);
      const sendPayload = {};
      if (useEmbed || title) {
        sendPayload.embeds = [{ title: title || undefined, description: message || undefined, color: color2, ...(imageAtt ? { image: { url: imageAtt.url } } : {}) }];
      } else {
        if (message) sendPayload.content = message;
        if (imageAtt) sendPayload.files = [imageAtt.url];
      }
      if (replyMsg) sendPayload.reply = { messageReference: replyMsg.id };
      await safeSend(channel, sendPayload);
      return safeReply(interaction, { content: "✅ Sent.", ephemeral: true });
    }

    // ── /remind ───────────────────────────────────────────────────────────────
    if (cmd === "remind") {
      const mins = interaction.options.getInteger("time"); const msg4 = interaction.options.getString("message");
      if (mins < 1 || mins > 10080) return safeReply(interaction, { content: "Time must be 1–10080 minutes.", ephemeral: true });
      const time2 = Date.now() + mins * 60000;
      reminders.push({ userId: user.id, channelId: interaction.channelId, message: msg4, time: time2 });
      saveData();
      return safeReply(interaction, { content: `⏰ Reminder set! I'll ping you in **${mins} min** about: *${msg4}*`, ephemeral: true });
    }

    // ── /setbio ───────────────────────────────────────────────────────────────
    if (cmd === "setbio") {
      const bio = interaction.options.getString("bio").slice(0, 200);
      const s = getScore(user.id, user.username); s.bio = bio; saveData();
      return safeReply(interaction, { content: `✅ Bio updated: *${bio}*`, ephemeral: true });
    }

    // ── Media ─────────────────────────────────────────────────────────────────
    if (cmd === "gif") {
      await interaction.deferReply();
      const animal = interaction.options.getString("animal");
      const fetchers = { cat: getCatGif, dog: getDogImage, fox: getFoxImage, panda: getPandaImage, duck: getDuckImage, bunny: getBunnyImage, koala: getKoalaImage, raccoon: getRaccoonImage };
      const url2 = await (fetchers[animal] || getCatGif)();
      if (!url2) return safeReply(interaction, "Couldn't fetch an image right now.");
      return safeReply(interaction, { embeds: [{ title: `${animal.charAt(0).toUpperCase() + animal.slice(1)} 🐾`, image: { url: url2 }, color: 0x5865F2 }] });
    }
    if (cmd === "joke") {
      await interaction.deferReply();
      const joke = await getJoke();
      return safeReply(interaction, joke ? { embeds: [{ title: "😂 Random Joke", description: joke, color: 0xFEE75C }] } : "Couldn't fetch a joke.");
    }
    if (cmd === "meme") {
      await interaction.deferReply();
      const url3 = await getMeme();
      return safeReply(interaction, url3 ? { embeds: [{ title: "🐸 Meme", image: { url: url3 }, color: 0x5865F2 }] } : "Couldn't fetch a meme.");
    }
    if (cmd === "trivia") {
      await interaction.deferReply();
      const t = await getTrivia();
      if (!t) return safeReply(interaction, "Trivia API is down.");
      return safeReply(interaction, { embeds: [{ title: "🧠 Trivia", description: `**${t.question}**\n\n${t.answers.map((a, i) => `${["🇦", "🇧", "🇨", "🇩"][i]} ${a}`).join("\n")}\n\n||Answer: **${t.correct}**||`, color: 0x5865F2 }] });
    }

    // ── Quotes ────────────────────────────────────────────────────────────────
    if (cmd === "quote" || cmd === "goodquote" || cmd === "badquote") {
      const now2 = Date.now(), last2 = quoteCooldown.get(user.id) || 0;
      if (now2 - last2 < 3000) return safeReply(interaction, { content: "⏱️ Slow down! Wait a moment.", ephemeral: true });
      quoteCooldown.set(user.id, now2);
      await interaction.deferReply();
      const chosen = cmd === "goodquote" ? await nextGoodQuoteImage() : cmd === "badquote" ? await nextBadQuoteImage() : await nextQuoteImage();
      if (!chosen) return safeReply(interaction, "Couldn't fetch a quote image right now.");
      const votes2 = quoteVotes.get(chosen.name) || { up: 0, down: 0 };
      const net2 = votes2.up - votes2.down;
      const msg5 = await safeReply(interaction, { embeds: [{ title: "✨ Quote", image: { url: chosen.download_url }, fields: [{ name: "Votes", value: `👍 ${votes2.up}  👎 ${votes2.down}  (net: ${net2 >= 0 ? "+" : ""}${net2})`, inline: true }], color: 0x5865F2, footer: { text: `React to vote on this quote! • ${chosen.name}` }, timestamp: new Date().toISOString() }], fetchReply: true });
      if (msg5) { await msg5.react("👍").catch(() => {}); await msg5.react("👎").catch(() => {}); quoteVoteMessages.set(msg5.id, chosen.name); saveData(); }
      return;
    }

    // ── /premiere ─────────────────────────────────────────────────────────────
    if (cmd === "premiere") {
      const hours2 = interaction.options.getNumber("hours");
      const channel2 = interaction.options.getChannel("channel");
      const title2 = interaction.options.getString("title") || "Upcoming Premiere";
      if (hours2 <= 0) return safeReply(interaction, { content: "Hours must be > 0.", ephemeral: true });
      const endsAt = Date.now() + hours2 * 3600000;
      const p = { userId: user.id, title: title2, endsAt, startedAt: Date.now() };
      const ch3 = channel2;
      const msg6 = await safeSend(ch3, buildPremiereEmbed(p));
      if (msg6) premieres.set(msg6.id, p);
      saveData();
      const interval2 = setInterval(async () => {
        const pm = premieres.get(msg6?.id); if (!pm) { clearInterval(interval2); return; }
        const remaining2 = pm.endsAt - Date.now();
        try { await msg6.edit(buildPremiereEmbed(pm)); } catch { clearInterval(interval2); }
        if (remaining2 <= 0) { clearInterval(interval2); premieres.delete(msg6.id); saveData(); }
      }, 5 * 60 * 1000);
      return safeReply(interaction, { content: `✅ Premiere countdown posted in <#${channel2.id}>!`, ephemeral: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ECONOMY COMMANDS
    // ─────────────────────────────────────────────────────────────────────────

    if (cmd === "coins") {
      const target = interaction.options.getUser("user") || user;
      const ts = getScore(target.id, target.username);
      const bankAcc = bankAccounts.get(target.id) || { balance: 0 };
      return safeReply(interaction, { embeds: [{ title: `💰 ${target.username}'s Balance`, fields: [{ name: "Wallet", value: `**${ts.coins.toLocaleString()}** coins`, inline: true }, { name: "Bank", value: `**${bankAcc.balance.toLocaleString()}** coins`, inline: true }, { name: "Total", value: `**${(ts.coins + bankAcc.balance).toLocaleString()}** coins`, inline: true }], color: 0xFFD700, thumbnail: { url: target.displayAvatarURL({ size: 64, dynamic: true }) } }] });
    }

    if (cmd === "daily") {
      const s = getScore(user.id, user.username);
      const today2 = new Date().toISOString().slice(0, 10);
      if (s.lastDailyDate === today2) return safeReply(interaction, { content: `⏳ You already claimed your daily today!\nCome back tomorrow.`, ephemeral: true });
      const beforeStreak = s.dailyStreak;
      recordDaily(user.id, user.username);
      const earned = CONFIG.daily_base_coins + (s.dailyStreak - 1) * CONFIG.daily_streak_bonus;
      saveData();
      const streakEmoji = s.dailyStreak >= 7 ? "🔥" : s.dailyStreak >= 3 ? "✨" : "📅";
      return safeReply(interaction, { embeds: [{ title: `${streakEmoji} Daily Reward Claimed!`, fields: [{ name: "Coins earned", value: `+**${earned}**`, inline: true }, { name: "Streak", value: `🔥 **${s.dailyStreak}** day${s.dailyStreak !== 1 ? "s" : ""}`, inline: true }, { name: "Best streak", value: `⭐ **${s.bestStreak}**`, inline: true }, { name: "New balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }], color: 0xFFD700, footer: { text: `+${CONFIG.daily_streak_bonus} bonus per streak day • come back tomorrow!` } }] });
    }

    if (cmd === "work") {
      const s = getScore(user.id, user.username);
      const cd = getCooldown(user.id, CONFIG.work_cooldown_ms);
      const remaining = cd - (Date.now() - s.lastWorkTime);
      if (remaining > 0) return safeReply(interaction, { content: `⏳ You're tired! Work again in **${fmtMs(remaining)}**.`, ephemeral: true });
      const wr2 = pick(WORK_RESPONSES);
      const fx = activeEffects.get(user.id) || {};
      const luckBonus = (fx.lucky_charm_expiry && fx.lucky_charm_expiry > Date.now()) ? (CONFIG.lucky_charm_bonus / 100) : 0;
      const magnetMult = s.inventory.includes("coin_magnet") ? CONFIG.coin_magnet_mult / 100 : 1;
      const base = r(wr2.lo, wr2.hi);
      const coins2 = Math.round(base * (1 + luckBonus) * magnetMult);
      if (s.inventory.includes("coin_magnet")) { const idx = s.inventory.indexOf("coin_magnet"); s.inventory.splice(idx, 1); }
      s.coins += coins2; s.lastWorkTime = Date.now(); saveData();
      return safeReply(interaction, { embeds: [{ description: wr2.msg.replace("{c}", coins2.toLocaleString()) + (luckBonus > 0 ? " 🍀" : "") + (magnetMult > 1 ? " 🧲" : ""), fields: [{ name: "Balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }], color: 0x57F287 }] });
    }

    if (cmd === "beg") {
      const s = getScore(user.id, user.username);
      const cd = getCooldown(user.id, CONFIG.beg_cooldown_ms);
      const remaining = cd - (Date.now() - s.lastBegTime);
      if (remaining > 0) return safeReply(interaction, { content: `⏳ Can't beg again for **${fmtMs(remaining)}**.`, ephemeral: true });
      const success = Math.random() * 100 < CONFIG.beg_success_chance;
      const beg = success ? pick(BEG_RESPONSES.filter(b => b.give)) : pick(BEG_RESPONSES.filter(b => !b.give));
      const coins3 = beg.give ? r(beg.lo, beg.hi) : 0;
      if (beg.give) s.coins += coins3;
      s.lastBegTime = Date.now(); saveData();
      return safeReply(interaction, { embeds: [{ description: beg.msg.replace("{c}", coins3), color: coins3 > 0 ? 0x57F287 : 0x5865F2 }] });
    }

    if (cmd === "crime") {
      const s = getScore(user.id, user.username);
      const cd = getCooldown(user.id, CONFIG.crime_cooldown_ms);
      const remaining = cd - (Date.now() - s.lastCrimeTime);
      if (remaining > 0) return safeReply(interaction, { content: `⏳ Lay low for **${fmtMs(remaining)}**.`, ephemeral: true });
      const success = Math.random() * 100 < CONFIG.crime_success_chance;
      const cr = success ? pick(CRIME_RESPONSES.filter(c => c.success)) : pick(CRIME_RESPONSES.filter(c => !c.success));
      const amount2 = r(cr.lo, cr.hi);
      if (cr.success) { s.coins += amount2; } else { s.coins = Math.max(0, s.coins - amount2); }
      s.lastCrimeTime = Date.now(); saveData();
      return safeReply(interaction, { embeds: [{ description: cr.msg.replace("{c}", amount2), color: cr.success ? 0x57F287 : 0xFF4500 }] });
    }

    if (cmd === "rob") {
      const target = interaction.options.getUser("user");
      if (target.id === user.id) return safeReply(interaction, { content: "You can't rob yourself.", ephemeral: true });
      const s = getScore(user.id, user.username);
      const ts = getScore(target.id, target.username);
      const cd = getCooldown(user.id, CONFIG.rob_cooldown_ms);
      const remaining = cd - (Date.now() - s.lastRobTime);
      if (remaining > 0) return safeReply(interaction, { content: `⏳ Wait **${fmtMs(remaining)}** before robbing again.`, ephemeral: true });
      s.lastRobTime = Date.now();
      // Check padlock on target
      if (ts.inventory?.includes("padlock")) {
        const idx = ts.inventory.indexOf("padlock"); ts.inventory.splice(idx, 1);
        saveData(); return safeReply(interaction, { embeds: [{ description: `🔒 **${target.username}** had a **Padlock** — your rob attempt failed!`, color: 0xFF4500 }] });
      }
      // Check shield
      if (ts.inventory?.includes("shield")) {
        const idx = ts.inventory.indexOf("shield"); ts.inventory.splice(idx, 1);
        saveData(); return safeReply(interaction, { embeds: [{ description: `🛡️ **${target.username}**'s shield blocked your rob!`, color: 0xFF4500 }] });
      }
      const fx = activeEffects.get(user.id) || {};
      const stealBonus = (fx.steal_boost_expiry && fx.steal_boost_expiry > Date.now()) ? 20 : 0;
      const success = Math.random() * 100 < (CONFIG.rob_success_chance + stealBonus);
      if (success) {
        const stealPct = r(CONFIG.rob_steal_pct_min, CONFIG.rob_steal_pct_max);
        const stolen = Math.max(1, Math.floor(ts.coins * (stealPct / 100)));
        ts.coins -= stolen; s.coins += stolen; saveData();
        return safeReply(interaction, { embeds: [{ description: `🔫 You robbed **${target.username}** and got away with **${stolen} coins**! (${stealPct}%)`, color: 0x57F287 }] });
      } else {
        const insured = s.inventory?.includes("rob_insurance");
        if (!insured) {
          const finePct = r(CONFIG.rob_fine_pct_min, CONFIG.rob_fine_pct_max);
          const fine = Math.max(1, Math.floor(s.coins * (finePct / 100)));
          s.coins = Math.max(0, s.coins - fine); saveData();
          return safeReply(interaction, { embeds: [{ description: `🚨 You got caught robbing **${target.username}** and paid a **${fine} coin** fine!`, color: 0xFF4500 }] });
        } else {
          const idx = s.inventory.indexOf("rob_insurance"); s.inventory.splice(idx, 1); saveData();
          return safeReply(interaction, { embeds: [{ description: `🚨 You got caught, but your 📋 **Rob Insurance** covered the fine!`, color: 0xFEE75C }] });
        }
      }
    }

    if (cmd === "fish") {
      const s = getScore(user.id, user.username);
      if (!s.inventory?.includes("fishing_rod")) return safeReply(interaction, { content: "🎣 You need a **Fishing Rod** from the shop first!", ephemeral: true });
      const cd = getCooldown(user.id, CONFIG.fish_cooldown_ms);
      const remaining = cd - (Date.now() - (s.lastFishTime || 0));
      if (remaining > 0) return safeReply(interaction, { content: `⏳ Cast again in **${fmtMs(remaining)}**.`, ephemeral: true });
      const catch2 = weightedFish();
      const coins4 = r(catch2.lo, catch2.hi);
      s.coins += coins4; s.lastFishTime = Date.now();
      if (!Array.isArray(s.fishedItems)) s.fishedItems = [];
      s.fishedItems.push(catch2.name); saveData();
      const rarityColors = { common: 0x9B59B6, uncommon: 0x2ECC71, rare: 0x3498DB, epic: 0xF39C12, junk: 0x7F8C8D, legendary: 0xFFD700 };
      return safeReply(interaction, { embeds: [{ title: "🎣 You caught something!", description: `**${catch2.name}** *(${catch2.rarity})*\n+**${coins4}** coins!`, fields: [{ name: "Balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }, { name: "Total catches", value: String(s.fishedItems.length), inline: true }], color: rarityColors[catch2.rarity] || 0x5865F2 }] });
    }

    if (cmd === "mine") {
      const s = getScore(user.id, user.username);
      if (!s.inventory?.includes("pickaxe")) return safeReply(interaction, { content: "⛏️ You need a **Pickaxe** from the shop first!", ephemeral: true });
      const cd = getCooldown(user.id, CONFIG.mine_cooldown_ms);
      const remaining = cd - (Date.now() - (s.lastMineTime || 0));
      if (remaining > 0) return safeReply(interaction, { content: `⏳ Mine again in **${fmtMs(remaining)}**.`, ephemeral: true });
      const ore = weightedOre();
      const coins5 = r(ore.lo, ore.hi);
      s.coins += coins5; s.lastMineTime = Date.now();
      if (!Array.isArray(s.minedItems)) s.minedItems = [];
      s.minedItems.push(ore.name); saveData();
      const rarityColors2 = { common: 0x9B59B6, uncommon: 0x2ECC71, rare: 0x3498DB, epic: 0xF39C12, legendary: 0xFFD700 };
      return safeReply(interaction, { embeds: [{ title: "⛏️ You mined something!", description: `**${ore.name}** *(${ore.rarity})*\n+**${coins5}** coins!`, fields: [{ name: "Balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }, { name: "Total mined", value: String(s.minedItems.length), inline: true }], color: rarityColors2[ore.rarity] || 0x5865F2 }] });
    }

    if (cmd === "heist") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (heists.has(interaction.channelId)) return safeReply(interaction, { content: "A heist is already forming in this channel!", ephemeral: true });
      const s = getScore(user.id, user.username);
      const entry = Math.min(100, Math.max(50, Math.floor(s.coins * 0.1)));
      if (s.coins < 50) return safeReply(interaction, { content: "❌ Need at least 50 coins to start a heist.", ephemeral: true });
      s.coins -= entry;
      const heist = { organizer: user.id, members: [user.id], pot: entry, startedAt: Date.now() };
      heists.set(interaction.channelId, heist);
      saveData();
      const joinRow = new MessageActionRow().addComponents(new MessageButton().setCustomId(`heist_join_${interaction.channelId}`).setLabel("🤝 Join Heist").setStyle("PRIMARY"));
      const msg7 = await safeReply(interaction, { ...buildHeistEmbed(heist), components: [joinRow], fetchReply: true });
      heist.msgId = msg7?.id;
      setTimeout(async () => {
        const h = heists.get(interaction.channelId); if (!h) return;
        heists.delete(interaction.channelId);
        const ch = interaction.channel;
        if (h.members.length < CONFIG.heist_min_members) {
          // Not enough members — refund
          for (const uid of h.members) { const ms = getScore(uid, null); ms.coins += Math.floor(h.pot / h.members.length); }
          saveData();
          return safeSend(ch, { embeds: [{ title: "💸 Heist Cancelled", description: "Not enough members joined. Coins refunded.", color: 0xFF4500 }] });
        }
        const success2 = Math.random() * 100 < CONFIG.heist_success_chance;
        if (success2) {
          const bonus = r(CONFIG.heist_base_payout_min, CONFIG.heist_base_payout_max);
          const total = h.pot + bonus;
          const share = Math.floor(total / h.members.length);
          for (const uid of h.members) { getScore(uid, null).coins += share; }
          saveData();
          return safeSend(ch, { embeds: [{ title: "💰 Heist Successful!", description: `The crew got away with **${bonus}** bonus coins!\n\nEach member receives **${share} coins**.\n👥 ${h.members.map(id => `<@${id}>`).join(", ")}`, color: 0x57F287 }] });
        } else {
          // Bank can be robbed in heist — steal from bank accounts
          const bankTarget = [...bankAccounts.entries()].filter(([id]) => !h.members.includes(id)).sort(() => Math.random() - 0.5)[0];
          let msg8 = "The heist failed! No loot.";
          if (bankTarget) {
            const stolen2 = Math.floor(bankTarget[1].balance * 0.2);
            bankTarget[1].balance -= stolen2;
            const share2 = Math.floor(stolen2 / h.members.length);
            for (const uid of h.members) getScore(uid, null).coins += share2;
            msg8 = `The heist failed the main vault but the crew raided <@${bankTarget[0]}>'s bank for **${stolen2} coins** — **${share2}** each!`;
          }
          saveData();
          return safeSend(ch, { embeds: [{ title: "💸 Heist Failed!", description: msg8, color: 0xFF4500 }] });
        }
      }, CONFIG.heist_join_window_ms);
      return;
    }

    if (cmd === "trade") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      if (target.id === user.id) return safeReply(interaction, { content: "Can't trade with yourself.", ephemeral: true });
      const coins6 = interaction.options.getInteger("coins") || 0;
      const itemId = interaction.options.getString("item") || null;
      if (!coins6 && !itemId) return safeReply(interaction, { content: "Provide coins or an item to trade.", ephemeral: true });
      const s = getScore(user.id, user.username);
      if (coins6 > 0) {
        if (s.coins < coins6) return safeReply(interaction, { content: `❌ Not enough coins (you have ${s.coins}).`, ephemeral: true });
        s.coins -= coins6;
      }
      if (itemId && !s.inventory?.includes(itemId)) return safeReply(interaction, { content: `❌ You don't have that item.`, ephemeral: true });
      const shop = getShopItems();
      const key = `${user.id}:${target.id}`;
      tradePending.set(key, { targetId: target.id, targetName: target.username, coins: coins6, item: itemId, expiresAt: Date.now() + 120000 });
      saveData();
      const tradeRow = new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`trade_accept_${key}`).setLabel("✅ Accept").setStyle("SUCCESS"),
        new MessageButton().setCustomId(`trade_decline_${key}`).setLabel("❌ Decline").setStyle("DANGER"),
      );
      return safeReply(interaction, { content: `<@${target.id}>`, embeds: [{ title: "🔄 Trade Offer", description: `**${user.username}** is offering:\n${coins6 ? `💰 **${coins6} coins**\n` : ""}${itemId ? `🎁 **${shop[itemId]?.name || itemId}**` : ""}`, color: 0x5865F2, footer: { text: "Expires in 2 minutes" } }], components: [tradeRow] });
    }

    if (cmd === "coinflip_duel") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const bet = interaction.options.getInteger("bet");
      if (target.id === user.id) return safeReply(interaction, { content: "Can't duel yourself.", ephemeral: true });
      if (bet < 1) return safeReply(interaction, { content: "Bet must be at least 1.", ephemeral: true });
      const s = getScore(user.id, user.username);
      if (s.coins < bet) return safeReply(interaction, { content: `❌ Not enough coins.`, ephemeral: true });
      const ts = getScore(target.id, target.username);
      if (ts.inventory?.includes("padlock")) return safeReply(interaction, { content: `🔒 **${target.username}** has a Padlock and can't be challenged.`, ephemeral: true });
      s.coins -= bet; saveData();
      const row = new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`cfd_accept_${interaction.id}`).setLabel("✅ Accept").setStyle("SUCCESS"),
        new MessageButton().setCustomId(`cfd_decline_${interaction.id}`).setLabel("❌ Decline").setStyle("DANGER"),
      );
      const msg9 = await safeReply(interaction, { content: `<@${target.id}>`, embeds: [{ title: "🪙 Coinflip Duel!", description: `**${user.username}** challenges **${target.username}** to a coinflip!\n\n💰 Stakes: **${bet} coins**`, color: 0x5865F2, footer: { text: "Accept within 60 seconds" } }], components: [row], fetchReply: true });
      coinflipDuels.set(msg9?.id || interaction.id, { challengerId: user.id, targetId: target.id, bet });
      setTimeout(() => { coinflipDuels.delete(msg9?.id || interaction.id); if (msg9) msg9.edit({ components: [] }).catch(() => {}); getScore(user.id, null).coins += bet; saveData(); }, 60000);
      return;
    }

    if (cmd === "lottery") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const action3 = interaction.options.getString("action");
      if (action3 === "jackpot") {
        const drawTs = Math.floor(nextMonday12UTC() / 1000);
        return safeReply(interaction, { embeds: [{ title: "🎰 Weekly Lottery", fields: [{ name: "Current Jackpot", value: `**${lottery.jackpot.toLocaleString()} coins**`, inline: true }, { name: "Tickets Sold", value: String([...lottery.tickets.values()].reduce((a, b) => a + b, 0)), inline: true }, { name: "Next Draw", value: `<t:${drawTs}:R>`, inline: true }], color: 0xFFD700, footer: { text: "Buy tickets with /lottery action:buy" } }] });
      }
      if (action3 === "mytickets") {
        const count = lottery.tickets.get(user.id) || 0;
        return safeReply(interaction, { content: `🎰 You have **${count}** lottery ticket${count !== 1 ? "s" : ""}. Good luck!`, ephemeral: true });
      }
      if (action3 === "buy") {
        const s = getScore(user.id, user.username);
        if (s.coins < CONFIG.shop_lottery_ticket_price) return safeReply(interaction, { content: `❌ Need **${CONFIG.shop_lottery_ticket_price}** coins.`, ephemeral: true });
        s.coins -= CONFIG.shop_lottery_ticket_price;
        lottery.tickets.set(user.id, (lottery.tickets.get(user.id) || 0) + 1);
        lottery.jackpot += CONFIG.lottery_ticket_bonus_per_ticket;
        // Set draw channel to current channel if not set
        if (!lottery.drawChannelId) lottery.drawChannelId = interaction.channelId;
        saveData();
        return safeReply(interaction, { embeds: [{ title: "🎰 Ticket Purchased!", description: `You now have **${lottery.tickets.get(user.id)}** ticket${lottery.tickets.get(user.id) !== 1 ? "s" : ""} for this week's draw!\n\n🏆 Current jackpot: **${lottery.jackpot.toLocaleString()} coins**`, color: 0xFFD700 }] });
      }
    }

    if (cmd === "bank") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const action4 = interaction.options.getString("action");
      const amount3 = interaction.options.getInteger("amount") || 0;
      const s = getScore(user.id, user.username);
      const acc = bankAccounts.get(user.id) || { balance: 0 };
      bankAccounts.set(user.id, acc);
      if (action4 === "balance") {
        return safeReply(interaction, { embeds: [{ title: "🏦 Your Bank Account", fields: [{ name: "Bank Balance", value: `**${acc.balance.toLocaleString()}** coins`, inline: true }, { name: "Wallet", value: `**${s.coins.toLocaleString()}** coins`, inline: true }, { name: `Daily Interest (${CONFIG.bank_interest_rate}%)`, value: `+${Math.floor(acc.balance * CONFIG.bank_interest_rate / 100).toLocaleString()} coins/day`, inline: true }], color: 0x5865F2, footer: { text: "Interest applied daily at midnight UTC • Bank balance can be stolen in heists" } }] });
      }
      if (action4 === "deposit") {
        if (amount3 < 1) return safeReply(interaction, { content: "Specify an amount to deposit.", ephemeral: true });
        if (s.coins < amount3) return safeReply(interaction, { content: `❌ Not enough coins (you have ${s.coins}).`, ephemeral: true });
        s.coins -= amount3; acc.balance += amount3; saveData();
        return safeReply(interaction, { embeds: [{ title: "🏦 Deposited!", description: `Deposited **${amount3.toLocaleString()}** coins.\nBank balance: **${acc.balance.toLocaleString()}**\nWallet: **${s.coins.toLocaleString()}**`, color: 0x57F287 }] });
      }
      if (action4 === "withdraw") {
        if (amount3 < 1) return safeReply(interaction, { content: "Specify an amount to withdraw.", ephemeral: true });
        if (acc.balance < amount3) return safeReply(interaction, { content: `❌ Not enough in bank (balance: ${acc.balance}).`, ephemeral: true });
        acc.balance -= amount3; s.coins += amount3; saveData();
        return safeReply(interaction, { embeds: [{ title: "🏦 Withdrawn!", description: `Withdrew **${amount3.toLocaleString()}** coins.\nBank balance: **${acc.balance.toLocaleString()}**\nWallet: **${s.coins.toLocaleString()}**`, color: 0x57F287 }] });
      }
    }

    if (cmd === "shop") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      return safeReply(interaction, { ...buildShopEmbed(user.id, "buffs"), ephemeral: false });
    }

    if (cmd === "open") {
      const boxType = interaction.options.getString("box");
      const s = getScore(user.id, user.username);
      if (!s.inventory?.includes(boxType)) return safeReply(interaction, { content: `❌ You don't have a **${getShopItems()[boxType]?.name || boxType}**.`, ephemeral: true });
      const idx = s.inventory.indexOf(boxType); s.inventory.splice(idx, 1);
      const result2 = boxType === "mystery_box" ? openMysteryBox() : openItemMysteryBox();
      const shop2 = getShopItems();
      if (result2.type === "coins") { s.coins += result2.coins; saveData(); return safeReply(interaction, { embeds: [{ title: "📦 Mystery Box Opened!", description: `You got **${result2.coins} coins**! 💰\nNew balance: **${s.coins.toLocaleString()}**`, color: 0xFFD700 }] }); }
      else { const timedItems2 = ["lucky_charm", "xp_boost", "vip_pass", "steal_boost"]; if (timedItems2.includes(result2.itemId)) { activateTimedItem(user.id, result2.itemId); } else { s.inventory.push(result2.itemId); } saveData(); return safeReply(interaction, { embeds: [{ title: "📦 Mystery Box Opened!", description: `You got a **${shop2[result2.itemId]?.name || result2.itemId}**! 🎁`, color: 0x5865F2 }] }); }
    }

    if (cmd === "inventory") {
      const target = interaction.options.getUser("user") || user;
      const ts = getScore(target.id, target.username);
      const inv = ts.inventory || [];
      const shop3 = getShopItems();
      if (!inv.length) return safeReply(interaction, { embeds: [{ title: `🎒 ${target.username}'s Inventory`, description: "Empty.", color: 0x5865F2 }] });
      const counts = {};
      for (const item of inv) counts[item] = (counts[item] || 0) + 1;
      const lines2 = Object.entries(counts).map(([id, count]) => `${shop3[id]?.name || id} ×${count}`);
      return safeReply(interaction, { embeds: [{ title: `🎒 ${target.username}'s Inventory`, description: lines2.join("\n"), color: 0x5865F2 }] });
    }

    if (cmd === "givecoin") {
      const target = interaction.options.getUser("user");
      const amount4 = interaction.options.getInteger("amount");
      if (amount4 < 1) return safeReply(interaction, { content: "Amount must be at least 1.", ephemeral: true });
      if (target.id === user.id) return safeReply(interaction, { content: "Can't give to yourself.", ephemeral: true });
      const s = getScore(user.id, user.username);
      if (s.coins < amount4) return safeReply(interaction, { content: `❌ Not enough coins.`, ephemeral: true });
      s.coins -= amount4;
      getScore(target.id, target.username).coins += amount4;
      saveData();
      return safeReply(interaction, { embeds: [{ description: `💸 **${user.username}** gave **${amount4.toLocaleString()} coins** to **${target.username}**!`, color: 0x57F287 }] });
    }

    if (cmd === "slots") {
      const bet = interaction.options.getInteger("bet") || 10;
      if (bet < CONFIG.slots_min_bet) return safeReply(interaction, { content: `Minimum bet is **${CONFIG.slots_min_bet}** coins.`, ephemeral: true });
      const s = getScore(user.id, user.username);
      if (s.coins < bet) return safeReply(interaction, { content: `❌ Not enough coins.`, ephemeral: true });
      s.coins -= bet;
      const reels = spinSlots();
      const { mult, label } = slotPayout(reels);
      const won = Math.floor(bet * mult);
      s.coins += won; saveData();
      return safeReply(interaction, { embeds: [{ title: "🎰 Slots", description: `${reels.join(" | ")}\n\n**${label}**\n${won > 0 ? `+${won} coins!` : `Lost ${bet} coins.`}`, fields: [{ name: "Balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }], color: won > bet ? 0xFFD700 : won > 0 ? 0x57F287 : 0xFF4500 }] });
    }

    if (cmd === "coinbet") {
      const bet = interaction.options.getInteger("bet");
      const side = interaction.options.getString("side");
      if (bet < 1) return safeReply(interaction, { content: "Bet must be at least 1.", ephemeral: true });
      const s = getScore(user.id, user.username);
      if (s.coins < bet) return safeReply(interaction, { content: "❌ Not enough coins.", ephemeral: true });
      const flip2 = Math.random() < 0.5 ? "heads" : "tails";
      const win = flip2 === side;
      if (win) s.coins += bet; else s.coins -= bet;
      saveData();
      return safeReply(interaction, { embeds: [{ description: `🪙 **${flip2 === "heads" ? "Heads" : "Tails"}!** You ${win ? `won **+${bet}**` : `lost **-${bet}**`} coins.`, fields: [{ name: "Balance", value: `**${s.coins.toLocaleString()}** coins`, inline: true }], color: win ? 0x57F287 : 0xFF4500 }] });
    }

    if (cmd === "blackjack") {
      const bet = interaction.options.getInteger("bet");
      if (bet < 1) return safeReply(interaction, { content: "Bet must be at least 1.", ephemeral: true });
      const s = getScore(user.id, user.username);
      if (s.coins < bet) return safeReply(interaction, { content: "❌ Not enough coins.", ephemeral: true });
      s.coins -= bet; saveData();
      const deck2 = newDeck();
      const playerHand = [deck2.pop(), deck2.pop()];
      const dealerHand = [deck2.pop(), deck2.pop()];
      const pv2 = handVal(playerHand);
      if (pv2 === 21) {
        const winAmt = Math.floor(bet * CONFIG.blackjack_natural_mult / 100);
        s.coins += winAmt; saveData();
        return safeReply(interaction, { embeds: [{ title: "🃏 Blackjack — Natural Blackjack!", description: `Your hand: ${renderHand(playerHand)} = **21**\nDealer: ${renderHand(dealerHand)}\n\n🎉 +**${winAmt}** coins! (1.5× payout)`, color: 0xFFD700 }] });
      }
      const game2 = { playerId: user.id, playerHand, dealerHand, deck: deck2, bet };
      activeGames.set(`bj_${user.id}`, game2);
      return safeReply(interaction, { embeds: [{ title: "🃏 Blackjack", description: `Your hand: ${renderHand(playerHand)} = **${pv2}**\nDealer: ${renderHand(dealerHand, true)}\n\nBet: **${bet}** coins`, color: 0x5865F2 }], components: makeBJButtons() });
    }

    // ── Score / Leaderboards ──────────────────────────────────────────────────
    if (cmd === "score") {
      const target = interaction.options.getUser("user") || user;
      const ts = getScore(target.id, target.username);
      const wr3 = ts.gamesPlayed > 0 ? Math.round(ts.wins / ts.gamesPlayed * 100) : 0;
      return safeReply(interaction, { embeds: [{ title: `🏆 ${target.username}'s Stats`, fields: [{ name: "Wins", value: String(ts.wins), inline: true }, { name: "Games Played", value: String(ts.gamesPlayed), inline: true }, { name: "Win Rate", value: `${wr3}%`, inline: true }, { name: "Coins", value: ts.coins.toLocaleString(), inline: true }, { name: "Streak", value: String(ts.dailyStreak), inline: true }, { name: "Best Streak", value: String(ts.bestStreak), inline: true }], color: 0x5865F2, thumbnail: { url: target.displayAvatarURL({ size: 64, dynamic: true }) } }] });
    }

    if (cmd === "xp") {
      const target = interaction.options.getUser("user") || user;
      const ts = getScore(target.id, target.username);
      const { level: lv2, xp: xp2, needed: needed2 } = xpInfo(ts);
      return safeReply(interaction, { embeds: [{ title: `📈 ${target.username}'s XP`, description: `Level **${lv2}**\n${xpBar(xp2, needed2, 20)}`, color: 0x5865F2 }] });
    }

    if (cmd === "leaderboard" || cmd === "serverleaderboard") {
      const type = interaction.options.getString("type") || "coins";
      let allScores = [...scores.values()];
      if (cmd === "serverleaderboard" && inGuild) {
        const memberIds = new Set([...interaction.guild.members.cache.keys()]);
        allScores = allScores.filter(s2 => memberIds.has([...scores.entries()].find(([, v]) => v === s2)?.[0]));
      }
      const sorted2 = allScores.sort((a, b) => {
        if (type === "wins") return b.wins - a.wins;
        if (type === "coins") return b.coins - a.coins;
        if (type === "streak") return b.dailyStreak - a.dailyStreak;
        if (type === "beststreak") return b.bestStreak - a.bestStreak;
        if (type === "games") return b.gamesPlayed - a.gamesPlayed;
        if (type === "winrate") return (b.gamesPlayed > 0 ? b.wins / b.gamesPlayed : 0) - (a.gamesPlayed > 0 ? a.wins / a.gamesPlayed : 0);
        if (type === "images") return (b.imagesUploaded || 0) - (a.imagesUploaded || 0);
        return 0;
      }).slice(0, 10);
      const medals2 = ["🥇", "🥈", "🥉"];
      const lines3 = sorted2.map((s2, i) => {
        const val = type === "coins" ? `${s2.coins.toLocaleString()} coins` : type === "wins" ? `${s2.wins} wins` : type === "streak" ? `${s2.dailyStreak}🔥` : type === "beststreak" ? `${s2.bestStreak}⭐` : type === "games" ? `${s2.gamesPlayed} played` : type === "winrate" ? `${s2.gamesPlayed > 0 ? Math.round(s2.wins / s2.gamesPlayed * 100) : 0}%` : `${s2.imagesUploaded || 0} imgs`;
        return `${medals2[i] || `${i + 1}.`} **${s2.username}** — ${val}`;
      });
      const typeLabels = { coins: "💰 Coins", wins: "🏆 Wins", streak: "🔥 Daily Streak", beststreak: "⭐ Best Streak", games: "🎮 Games Played", winrate: "📊 Win Rate", images: "🖼️ Images" };
      return safeReply(interaction, { embeds: [{ title: `${cmd === "serverleaderboard" ? "🏠 Server" : "🌍 Global"} Leaderboard — ${typeLabels[type] || type}`, description: lines3.join("\n") || "No data yet.", color: 0xFFD700 }] });
    }

    if (cmd === "xpleaderboard") {
      const scope = interaction.options.getString("scope") || "global";
      let allScores2 = [...scores.entries()];
      if (scope === "server" && inGuild) {
        const memberIds2 = new Set([...interaction.guild.members.cache.keys()]);
        allScores2 = allScores2.filter(([id]) => memberIds2.has(id));
      }
      const sorted3 = allScores2.map(([, s2]) => s2).sort((a, b) => {
        const la = xpInfo({ ...a }), lb = xpInfo({ ...b });
        return lb.level !== la.level ? lb.level - la.level : lb.xp - la.xp;
      }).slice(0, 10);
      const medals3 = ["🥇", "🥈", "🥉"];
      const lines4 = sorted3.map((s2, i) => { const { level: l2, xp: x2, needed: n2 } = xpInfo({ ...s2 }); return `${medals3[i] || `${i + 1}.`} **${s2.username}** — Level **${l2}** (${x2}/${n2} XP)`; });
      return safeReply(interaction, { embeds: [{ title: `${scope === "server" ? "🏠 Server" : "🌍 Global"} XP Leaderboard`, description: lines4.join("\n") || "No data yet.", color: 0x5865F2 }] });
    }

    // ── /userprofile ──────────────────────────────────────────────────────────
    if (cmd === "userprofile") {
      const target = interaction.options.getUser("user") || user;
      const ts = getScore(target.id, target.username);
      return safeReply(interaction, { ...buildProfileEmbed(target, ts, interaction), components: buildProfileButtons(target.id, user.id) });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GAMES
    // ─────────────────────────────────────────────────────────────────────────
    if (cmd === "games") {
      const game3 = interaction.options.getString("game");

      if (game3 === "hangman") {
        const word2 = pick(HANGMAN_WORDS);
        activeGames.set(`hm_${user.id}`, { word: word2, guessed: new Set(), playerId: user.id });
        return safeReply(interaction, { embeds: [{ title: "🪢 Hangman", description: renderHangman(word2, new Set()) }], components: makeHangmanButtons(word2, new Set()) });
      }
      if (game3 === "snake") {
        const sg = { size: 8, snake: [{ x: 4, y: 4 }], food: { x: 2, y: 2 }, direction: "right", score: 0, playerId: user.id };
        activeGames.set(`snake_${user.id}`, sg);
        return safeReply(interaction, { embeds: [{ title: "🐍 Snake", description: renderSnake(sg) }], components: makeSnakeButtons() });
      }
      if (game3.startsWith("minesweeper_")) {
        const diff2 = game3.replace("minesweeper_", "");
        const cfg3 = MS_CONFIGS[diff2] || MS_CONFIGS.easy;
        const mgame = initMinesweeper(diff2);
        mgame.playerId = user.id; mgame.diff = diff2;
        activeGames.set(`ms_${user.id}`, mgame);
        return safeReply(interaction, { embeds: [{ title: `💣 Minesweeper (${diff2})`, description: `${cfg3.rows}×${cfg3.cols} grid — **${cfg3.mines} mines**\nClick any cell to start! First click is always safe.` }], components: makeMSButtons(mgame) });
      }
      if (game3 === "numberguess") {
        const secret = r(1, 100);
        activeGames.set(`ng_${user.id}`, { secret, attempts: 0, max: 7, playerId: user.id });
        await safeReply(interaction, { embeds: [{ title: "🔢 Number Guess", description: "I'm thinking of a number between **1 and 100**.\nYou have **7 guesses**. Type your guess in chat!" }] });
        const ch = interaction.channel;
        const filter2 = m => m.author.id === user.id && !isNaN(parseInt(m.content.trim()));
        const collector = ch.createMessageCollector({ filter: filter2, time: 120000 });
        collector.on("collect", async m => {
          const game4 = activeGames.get(`ng_${user.id}`); if (!game4) { collector.stop(); return; }
          const guess = parseInt(m.content.trim()); game4.attempts++;
          if (guess === game4.secret) { collector.stop(); activeGames.delete(`ng_${user.id}`); recordWin(user.id, user.username, CONFIG.win_numberguess); saveData(); await m.reply({ embeds: [{ title: "🎉 Correct!", description: `The number was **${game4.secret}**! Solved in **${game4.attempts}** guess${game4.attempts !== 1 ? "es" : ""}!\n+**${CONFIG.win_numberguess}** coins!`, color: 0x57F287 }] }); return; }
          if (game4.attempts >= game4.max) { collector.stop(); activeGames.delete(`ng_${user.id}`); await m.reply({ embeds: [{ title: "💀 Out of guesses!", description: `The number was **${game4.secret}**.`, color: 0xFF4500 }] }); return; }
          await m.reply(guess < game4.secret ? `📈 Higher! (${game4.max - game4.attempts} guesses left)` : `📉 Lower! (${game4.max - game4.attempts} guesses left)`);
        });
        collector.on("end", (_, reason) => { if (reason === "time") { activeGames.delete(`ng_${user.id}`); safeSend(ch, "⏰ Number guess timed out!"); } });
        return;
      }
      if (game3 === "wordscramble") {
        const word3 = pick(HANGMAN_WORDS);
        const scrambled2 = word3.split("").sort(() => Math.random() - 0.5).join("");
        activeGames.set(`ws_${user.id}`, { word: word3, playerId: user.id });
        await safeReply(interaction, { embeds: [{ title: "🔀 Word Scramble", description: `Unscramble: **\`${scrambled2}\`**\nType your answer in chat! (60 seconds)` }] });
        const ch2 = interaction.channel;
        const filter3 = m => m.author.id === user.id;
        const collector2 = ch2.createMessageCollector({ filter: filter3, time: 60000, max: 10 });
        collector2.on("collect", async m => {
          const game5 = activeGames.get(`ws_${user.id}`); if (!game5) { collector2.stop(); return; }
          if (m.content.trim().toLowerCase() === game5.word) { collector2.stop(); activeGames.delete(`ws_${user.id}`); recordWin(user.id, user.username, CONFIG.win_wordscramble); saveData(); await m.reply({ embeds: [{ title: "✅ Correct!", description: `The word was **${game5.word}**!\n+**${CONFIG.win_wordscramble}** coins!`, color: 0x57F287 }] }); } else { await m.react("❌").catch(() => {}); }
        });
        collector2.on("end", (_, reason) => { if (reason === "time") { activeGames.delete(`ws_${user.id}`); safeSend(ch2, `⏰ The word was **${word3}**.`); } });
        return;
      }
      if (game3 === "daily") {
        if (dailyCompletions.has(user.id)) return safeReply(interaction, { content: "✅ You already completed today's challenge! Come back tomorrow.", ephemeral: true });
        const dc = getDailyChallenge();
        await safeReply(interaction, { embeds: [{ title: "📅 Daily Challenge", description: dc.desc + "\n\nType your answer in chat! (30 seconds)", color: 0x5865F2 }] });
        const ch3 = interaction.channel;
        const collector3 = ch3.createMessageCollector({ filter: m => m.author.id === user.id, time: 30000, max: 5 });
        collector3.on("collect", async m => {
          if (m.content.trim().toLowerCase() === dc.answer.toLowerCase()) { collector3.stop(); dailyCompletions.add(user.id); const s = getScore(user.id, user.username); s.coins += 75; saveData(); await m.reply({ embeds: [{ title: "🎉 Correct!", description: `Answer: **${dc.answer}**\n+**75 coins**!`, color: 0x57F287 }] }); } else { await m.react("❌").catch(() => {}); }
        });
        collector3.on("end", (_, reason) => { if (reason === "time") safeSend(ch3, `⏰ Answer was **${dc.answer}**.`); });
        return;
      }
    }

    // ── /2playergames ─────────────────────────────────────────────────────────
    if (cmd === "2playergames") {
      const game6 = interaction.options.getString("game");
      const opp = interaction.options.getUser("opponent");
      if (opp && opp.id === user.id) return safeReply(interaction, { content: "Can't play against yourself.", ephemeral: true });
      if (opp && opp.bot) return safeReply(interaction, { content: "Can't play against a bot.", ephemeral: true });

      if (game6 === "tictactoe") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent for Tic Tac Toe.", ephemeral: true });
        const board2 = Array(9).fill(null);
        activeGames.set(`ttt_${interaction.channelId}`, { board: board2, players: [user.id, opp.id], usernames: [user.username, opp.username], turn: 0 });
        return safeReply(interaction, { embeds: [{ title: "Tic Tac Toe", description: renderTTT(board2) + `\n\n**${user.username}'s turn (❌)**\n${user.username} vs ${opp.username}` }], components: makeTTTButtons(board2) });
      }
      if (game6 === "connect4") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent for Connect 4.", ephemeral: true });
        const board3 = Array(42).fill(0);
        activeGames.set(`c4_${interaction.channelId}`, { board: board3, players: [user.id, opp.id], usernames: [user.username, opp.username], turn: 0 });
        return safeReply(interaction, { embeds: [{ title: "Connect 4", description: renderC4(board3) + `\n\n**${user.username}'s turn (🔴)**` }], components: makeC4Buttons() });
      }
      if (game6 === "rps") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent for RPS.", ephemeral: true });
        const rpsOpts = new MessageActionRow().addComponents(new MessageButton().setCustomId(`rps_rock_${user.id}_${opp.id}`).setLabel("✊ Rock").setStyle("SECONDARY"), new MessageButton().setCustomId(`rps_paper_${user.id}_${opp.id}`).setLabel("📄 Paper").setStyle("SECONDARY"), new MessageButton().setCustomId(`rps_scissors_${user.id}_${opp.id}`).setLabel("✂️ Scissors").setStyle("SECONDARY"));
        activeGames.set(`rps_${interaction.channelId}`, { players: [user.id, opp.id], usernames: [user.username, opp.username], choices: {} });
        return safeReply(interaction, { embeds: [{ title: "✊📄✂️ Rock Paper Scissors", description: `**${user.username}** vs **${opp.username}**\nBoth players — make your choice! (DM or button)` }], components: [rpsOpts] });
      }
      if (game6 === "countgame") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent.", ephemeral: true });
        const target2 = r(50, 200);
        countGames.set(interaction.channelId, { players: [user.id, opp.id], usernames: [user.username, opp.username], target: target2, counts: { [user.id]: 0, [opp.id]: 0 } });
        await safeReply(interaction, `🔢 **Count Game!** <@${user.id}> vs <@${opp.id}>\n\nFirst to reach **${target2}** by sending numbers that add up to it! Take turns, no repeats. You have 3 minutes.`);
        const ch4 = getTargetChannel(interaction);
        const collector4 = ch4.createMessageCollector({ filter: m => [user.id, opp.id].includes(m.author.id) && !isNaN(parseInt(m.content.trim())), time: 3 * 60 * 1000 });
        collector4.on("collect", async m => {
          const cg = countGames.get(interaction.channelId); if (!cg) { collector4.stop(); return; }
          const n2 = parseInt(m.content.trim());
          cg.counts[m.author.id] = (cg.counts[m.author.id] || 0) + n2;
          const total2 = Object.values(cg.counts).reduce((a, b) => a + b, 0);
          if (total2 === cg.target) { collector4.stop(); countGames.delete(interaction.channelId); recordWin(m.author.id, m.author.username, CONFIG.win_countgame); saveData(); await m.reply({ embeds: [{ title: "🎉 Count Game Winner!", description: `<@${m.author.id}> completed the count to **${cg.target}**!\n+**${CONFIG.win_countgame}** coins!`, color: 0x57F287 }] }); } else if (total2 > cg.target) { collector4.stop(); countGames.delete(interaction.channelId); await m.reply({ embeds: [{ title: "💀 Went Over!", description: `Total was **${total2}** — target was **${cg.target}**!`, color: 0xFF4500 }] }); }
        });
        collector4.on("end", (_, reason) => { if (reason === "time") { countGames.delete(interaction.channelId); safeSend(getTargetChannel(interaction), "⏰ Count game timed out!"); } });
        return;
      }
      if (game6 === "mathrace") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent.", ephemeral: true });
        const av2 = r(2, 12), bv2 = r(2, 12), answer2 = String(av2 * bv2);
        activeGames.set(interaction.channelId, { type: "mathrace" });
        const targetCh2 = getTargetChannel(interaction);
        await safeReply(interaction, `🧮 **Math Race!** <@${user.id}> vs <@${opp.id}>\n\n**What is ${av2} × ${bv2}?**`);
        try { const col2 = await targetCh2.awaitMessages({ filter: m => [user.id, opp.id].includes(m.author.id) && m.content.trim() === answer2, max: 1, time: 30000, errors: ["time"] }); activeGames.delete(interaction.channelId); const w2 = col2.first().author, l2 = w2.id === user.id ? opp : user; recordWin(w2.id, w2.username, CONFIG.win_mathrace); recordLoss(l2.id, l2.username); saveData(); await col2.first().reply({ embeds: [{ title: `🎉 ${w2.username} wins!`, description: `Answer: **${answer2}** (+${CONFIG.win_mathrace} coins)`, color: 0x57F287 }] }); } catch { activeGames.delete(interaction.channelId); await safeSend(getTargetChannel(interaction), `⏰ Time's up! Answer: **${answer2}**.`); }
        return;
      }
      if (game6 === "wordrace") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent.", ephemeral: true });
        const word4 = pick(HANGMAN_WORDS), scrambled3 = word4.split("").sort(() => Math.random() - 0.5).join("");
        activeGames.set(interaction.channelId, { type: "wordrace" });
        const targetCh3 = getTargetChannel(interaction);
        await safeReply(interaction, `🏁 **Word Race!** <@${user.id}> vs <@${opp.id}>\n\nUnscramble: **\`${scrambled3}\`**`);
        try { const col3 = await targetCh3.awaitMessages({ filter: m => [user.id, opp.id].includes(m.author.id) && m.content.trim().toLowerCase() === word4, max: 1, time: 60000, errors: ["time"] }); activeGames.delete(interaction.channelId); const w3 = col3.first().author, l3 = w3.id === user.id ? opp : user; recordWin(w3.id, w3.username, CONFIG.win_wordrace); recordLoss(l3.id, l3.username); saveData(); await col3.first().reply({ embeds: [{ title: `🎉 ${w3.username} wins!`, description: `Word: **${word4}** (+${CONFIG.win_wordrace} coins)`, color: 0x57F287 }] }); } catch { activeGames.delete(interaction.channelId); await safeSend(getTargetChannel(interaction), `⏰ Time's up! Word: **${word4}**.`); }
        return;
      }
      if (game6 === "triviabattle") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent.", ephemeral: true });
        await interaction.deferReply();
        const t2 = await getTrivia();
        if (!t2) return safeReply(interaction, "Trivia API is down.");
        activeGames.set(interaction.channelId, { type: "triviabattle" });
        const targetCh4 = getTargetChannel(interaction);
        await safeReply(interaction, { content: `🧠 **Trivia Battle!** <@${user.id}> vs <@${opp.id}>\n\n**${t2.question}**\n\n${t2.answers.map((a2, i) => `${["🇦", "🇧", "🇨", "🇩"][i]} ${a2}`).join("\n")}\n\nFirst to type the correct answer wins! 30 seconds.` });
        try { const col4 = await targetCh4.awaitMessages({ filter: m => [user.id, opp.id].includes(m.author.id) && m.content.trim().toLowerCase() === t2.correct.toLowerCase(), max: 1, time: 30000, errors: ["time"] }); activeGames.delete(interaction.channelId); const winner2 = col4.first().author, loser2 = winner2.id === user.id ? opp : user; recordWin(winner2.id, winner2.username, CONFIG.win_trivia); recordLoss(loser2.id, loser2.username); saveData(); await col4.first().reply({ embeds: [{ title: `🎉 ${winner2.username} wins!`, description: `Answer: **${t2.correct}** (+${CONFIG.win_trivia} coins)`, color: 0x57F287 }] }); } catch { activeGames.delete(interaction.channelId); await safeSend(getTargetChannel(interaction), `⏰ Time's up! Answer: **${t2.correct}**.`); }
        return;
      }
      if (game6 === "scramblerace") {
        if (!opp) return safeReply(interaction, { content: "Please mention an opponent.", ephemeral: true });
        const words2 = []; while (words2.length < 5) { const w = pick(HANGMAN_WORDS); if (!words2.includes(w)) words2.push(w); }
        const scrambled4 = words2.map(w => w.split("").sort(() => Math.random() - 0.5).join(""));
        const state2 = { type: "scramblerace", words: words2, scrambled: scrambled4, scores: { [user.id]: 0, [opp.id]: 0 }, current: 0, players: [user.id, opp.id] };
        activeGames.set(interaction.channelId, state2);
        const targetCh5 = getTargetChannel(interaction);
        await safeReply(interaction, `🏁 **Scramble Race!** <@${user.id}> vs <@${opp.id}>\n\nFirst to unscramble 5 words wins!\n\n**Word 1/5:** \`${scrambled4[0]}\``);
        const col5 = targetCh5.createMessageCollector({ filter: m => [user.id, opp.id].includes(m.author.id), time: 3 * 60 * 1000 });
        col5.on("collect", async m => {
          const gd = activeGames.get(interaction.channelId); if (!gd || gd.type !== "scramblerace") return;
          if (m.content.trim().toLowerCase() === gd.words[gd.current]) { gd.scores[m.author.id] = (gd.scores[m.author.id] || 0) + 1; await m.react("✅"); gd.current++; if (gd.current >= 5) { col5.stop("done"); activeGames.delete(interaction.channelId); const s02 = gd.scores[user.id] || 0, s12 = gd.scores[opp.id] || 0; let txt2; if (s02 > s12) { recordWin(user.id, user.username, CONFIG.win_scramblerace); recordLoss(opp.id, opp.username); txt2 = `🎉 <@${user.id}> wins **${s02}–${s12}**! (+${CONFIG.win_scramblerace} coins)`; } else if (s12 > s02) { recordWin(opp.id, opp.username, CONFIG.win_scramblerace); recordLoss(user.id, user.username); txt2 = `🎉 <@${opp.id}> wins **${s12}–${s02}**! (+${CONFIG.win_scramblerace} coins)`; } else { recordDraw(user.id, user.username); recordDraw(opp.id, opp.username); txt2 = `🤝 Tie! **${s02}–${s12}**`; } saveData(); await safeSend(targetCh5, { embeds: [{ title: "🏁 Scramble Race Over!", description: txt2, color: 0x57F287 }] }); } else { await safeSend(targetCh5, `**Word ${gd.current + 1}/5:** \`${gd.scrambled[gd.current]}\``); } }
        });
        col5.on("end", (_, reason) => { if (reason !== "done") { activeGames.delete(interaction.channelId); safeSend(getTargetChannel(interaction), "⏰ Scramble Race timed out!"); } });
        return;
      }
    }

    // ── RPS button handler (also needed here for collected reactions mid-game) ─
    if (cmd === "rps") {
      // Handled via buttons — legacy text RPS support
      return;
    }

  } catch (err) {
    console.error("Interaction error:", err);
    safeReply(interaction, { content: "An error occurred.", ephemeral: true });
  }
});

// ── Blackjack stand helper ─────────────────────────────────────────────────────
async function bjStand(interaction, bj) {
  while (handVal(bj.dealerHand) < 17) bj.dealerHand.push(bj.deck.pop());
  const pv = handVal(bj.playerHand), dv = handVal(bj.dealerHand);
  activeGames.delete(`bj_${bj.playerId}`);
  const s = getScore(bj.playerId, null);
  let result2, color3;
  if (dv > 21 || pv > dv) { s.coins += bj.bet * 2; result2 = `🏆 You win! +**${bj.bet}** coins`; color3 = 0x57F287; }
  else if (pv === dv) { s.coins += bj.bet; result2 = `🤝 Push — bet returned`; color3 = 0xFEE75C; }
  else { result2 = `💸 Dealer wins. Lost **${bj.bet}** coins`; color3 = 0xFF4500; }
  saveData();
  return interaction.editReply({ embeds: [{ title: "🃏 Blackjack Result", description: `Your hand: ${renderHand(bj.playerHand)} = **${pv}**\nDealer: ${renderHand(bj.dealerHand)} = **${dv}**\n\n${result2}`, color: color3 }], components: [] });
}

// ── Heist embed builder ────────────────────────────────────────────────────────
function buildHeistEmbed(heist) {
  const endTs = Math.floor((heist.startedAt + CONFIG.heist_join_window_ms) / 1000);
  return { embeds: [{ title: "💰 Heist Forming!", description: `<@${heist.organizer}> is organizing a heist!\n\n👥 **Crew:** ${heist.members.map(id => `<@${id}>`).join(", ")}\n💵 **Pot:** ${heist.pot} coins\n⏳ Launches <t:${endTs}:R>\n\nJoin to get a share of the loot!`, color: 0xFFD700, footer: { text: `Need ${CONFIG.heist_min_members}+ members to launch` } }] };
}

// ── Ticket step builder (extracted) ───────────────────────────────────────────
function buildTicketStep(guild, guildId, stepOverride) {
  const c = ticketConfigs.get(guildId) || {};
  function getStep(c2) { if (!c2.categoryId) return 1; if (!c2.supportRoleIds?.length) return 2; if (c2.logChannelId === undefined) return 3; if (c2.transcriptChannelId === undefined) return 4; if (c2.panelChannelId === undefined) return 5; return 6; }
  const step = stepOverride ?? getStep(c);
  const catCh = c.categoryId ? guild.channels.cache.get(c.categoryId) : null;
  const roleList = (c.supportRoleIds || []).map(id => `<@&${id}>`).join(", ") || null;
  const logStr = c.logChannelId ? `<#${c.logChannelId}>` : c.logChannelId === null ? "None" : "—";
  const txStr = c.transcriptChannelId ? `<#${c.transcriptChannelId}>` : c.transcriptChannelId === null ? "None" : "—";
  const TICK = "✅", CURR = "▶️", EMPTY = "⬜";
  const prog = [1, 2, 3, 4, 5, 6].map(s2 => s2 < step ? TICK : s2 === step ? CURR : EMPTY);
  const bar2 = `${prog[0]} Category  ${prog[1]} Roles  ${prog[2]} Log  ${prog[3]} Transcript  ${prog[4]} Panel  ${prog[5]} Done`;
  const cats = [...guild.channels.cache.filter(ch => ch.type === "GUILD_CATEGORY").values()].slice(0, 25);
  const allTxts2 = [...guild.channels.cache.filter(ch => ch.type === "GUILD_TEXT").values()];
  const txts2 = allTxts2.slice(0, 24);
  const rls2 = [...guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).values()].slice(0, 25);
  const skip2 = [{ label: "Skip / None", value: "__none__", description: "Leave this setting disabled" }];
  const done2 = [];
  if (step > 1) done2.push(`📁 **Category:** ${catCh ? `\`${catCh.name}\`` : "—"}`);
  if (step > 2) done2.push(`🛡️ **Roles:** ${roleList || "—"}`);
  if (step > 3) done2.push(`📋 **Log:** ${logStr}`);
  if (step > 4) done2.push(`📜 **Transcript:** ${txStr}`);
  if (step > 5) done2.push(`📢 **Panel:** ${c.panelChannelId ? `<#${c.panelChannelId}>` : "—"}`);
  const summary2 = done2.join("  •  ");
  let header2, components2;
  if (step === 1) { header2 = `## 🎫 Ticket Setup — Step 1 of 5: Category\nWhich **category** should new ticket channels be created inside?\n\`${bar2}\``; const opts3 = cats.map(ch => ({ label: ch.name, value: ch.id, emoji: { name: "📁" } })); components2 = [new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_channel").setPlaceholder("Select a category…").setOptions(opts3.length ? opts3 : [{ label: "No categories found", value: "none" }]).setDisabled(!opts3.length))]; }
  else if (step === 2) { header2 = `## 🎫 Ticket Setup — Step 2 of 5: Support Roles\n${summary2}\n\nWhich **roles** can view and manage tickets?\n\`${bar2}\``; const opts4 = rls2.map(r => ({ label: r.name.slice(0, 25), value: r.id })); components2 = [new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_roles").setPlaceholder("Select role(s)…").setMinValues(1).setMaxValues(Math.min(5, Math.max(1, opts4.length))).setOptions(opts4.length ? opts4 : [{ label: "No roles", value: "none" }]).setDisabled(!opts4.length)), new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))]; }
  else if (step === 3) { header2 = `## 🎫 Ticket Setup — Step 3 of 5: Log Channel\n${summary2}\n\n*(optional)*\n\`${bar2}\``; const opts5 = skip2.concat(txts2.map(ch => ({ label: `#${ch.name}`, value: ch.id }))); components2 = [new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_log").setPlaceholder("Select log channel…").setOptions(opts5.slice(0, 25))), new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))]; }
  else if (step === 4) { header2 = `## 🎫 Ticket Setup — Step 4 of 5: Transcript Channel\n${summary2}\n\n*(optional)*\n\`${bar2}\``; const opts6 = skip2.concat(txts2.map(ch => ({ label: `#${ch.name}`, value: ch.id }))); components2 = [new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_transcript").setPlaceholder("Select transcript channel…").setOptions(opts6.slice(0, 25))), new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))]; }
  else if (step === 5) { header2 = `## 🎫 Ticket Setup — Step 5 of 5: Panel Channel\n${summary2}\n\n\`${bar2}\``; const opts7 = allTxts2.map(ch => ({ label: `#${ch.name}`, value: ch.id })).slice(0, 25); components2 = [new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId("ts_sel_panel_ch").setPlaceholder("Select panel channel…").setOptions(opts7.length ? opts7 : [{ label: "No channels", value: "none" }]).setDisabled(!opts7.length)), new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_back").setLabel("← Back").setStyle("SECONDARY"))]; }
  else { header2 = `## 🎫 Ticket Setup Complete!\n\`${bar2}\`\n\n📁 Category: ${catCh ? `\`${catCh.name}\`` : "—"}\n🛡️ Roles: ${roleList || "—"}\n📋 Log: ${logStr}\n📜 Transcript: ${txStr}\n📢 Panel: ${c.panelChannelId ? `<#${c.panelChannelId}>` : "—"}`; components2 = [new MessageActionRow().addComponents(new MessageButton().setCustomId("ts_post_panel").setLabel("Post Ticket Panel 🎫").setStyle("PRIMARY"), new MessageButton().setCustomId("ts_back").setLabel("← Edit Settings").setStyle("SECONDARY"), new MessageButton().setCustomId("ts_reset").setLabel("Start Over 🗑️").setStyle("DANGER"))]; }
  return { content: header2, components: components2 };
}

// ── nextMonday12UTC helper ─────────────────────────────────────────────────────
function nextMonday12UTC() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = day === 1 ? (now.getUTCHours() < 12 ? 0 : 7) : (8 - day) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(12, 0, 0, 0);
  return next.getTime();
}

// ── /channelpicker ─────────────────────────────────────────────────────────────
// Continued inside the interactionCreate handler — appended via extra listener
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;
  const { commandName: cmd, user } = interaction;
  const inGuild = !!interaction.guildId;
  const isOwner = OWNER_IDS.includes(user.id);

  try {

    // ── /channelpicker ──────────────────────────────────────────────────────
    if (cmd === "channelpicker") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const ch = interaction.options.getChannel("channel");
      const levelUp = interaction.options.getBoolean("levelup");
      guildChannels.set(interaction.guildId, ch.id);
      if (levelUp === false) disabledLevelUp.add(interaction.guildId);
      else if (levelUp === true) disabledLevelUp.delete(interaction.guildId);
      saveData();
      return safeReply(interaction, { content: `✅ Bot channel set to <#${ch.id}>.${levelUp === false ? "\n🔇 Level-up notifications **disabled**." : levelUp === true ? "\n🔔 Level-up notifications **enabled**." : ""}`, ephemeral: true });
    }

    // ── /xpconfig ──────────────────────────────────────────────────────────
    if (cmd === "xpconfig") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const setting = interaction.options.getString("setting");
      const channel = interaction.options.getChannel("channel");
      const luc = levelUpConfig.get(interaction.guildId) || {};
      if (setting === "show") {
        const chId = luc.channelId || guildChannels.get(interaction.guildId);
        return safeReply(interaction, { embeds: [{ title: "⚙️ Level-Up Config", fields: [{ name: "Status", value: disabledLevelUp.has(interaction.guildId) ? "🔇 Disabled" : "🔔 Enabled", inline: true }, { name: "Ping user", value: luc.ping !== false ? "✅ Yes" : "❌ No", inline: true }, { name: "Channel", value: chId ? `<#${chId}>` : "Default (bot channel)", inline: true }], color: 0x5865F2 }], ephemeral: true });
      }
      if (setting === "enable") { disabledLevelUp.delete(interaction.guildId); luc.enabled = true; levelUpConfig.set(interaction.guildId, luc); saveData(); return safeReply(interaction, { content: "🔔 Level-up notifications **enabled**.", ephemeral: true }); }
      if (setting === "disable") { disabledLevelUp.add(interaction.guildId); luc.enabled = false; levelUpConfig.set(interaction.guildId, luc); saveData(); return safeReply(interaction, { content: "🔇 Level-up notifications **disabled**.", ephemeral: true }); }
      if (setting === "ping_on") { luc.ping = true; levelUpConfig.set(interaction.guildId, luc); saveData(); return safeReply(interaction, { content: "✅ Level-up **ping enabled**.", ephemeral: true }); }
      if (setting === "ping_off") { luc.ping = false; levelUpConfig.set(interaction.guildId, luc); saveData(); return safeReply(interaction, { content: "✅ Level-up **ping disabled**.", ephemeral: true }); }
      if (setting === "set_channel") {
        if (!channel) return safeReply(interaction, { content: "Provide a channel.", ephemeral: true });
        luc.channelId = channel.id; levelUpConfig.set(interaction.guildId, luc); saveData();
        return safeReply(interaction, { content: `✅ Level-up channel set to <#${channel.id}>.`, ephemeral: true });
      }
      if (setting === "reset_channel") { delete luc.channelId; levelUpConfig.set(interaction.guildId, luc); saveData(); return safeReply(interaction, { content: "✅ Level-up channel reset to default bot channel.", ephemeral: true }); }
    }

    // ── /setwelcome, /setleave, /setboostmsg ─────────────────────────────
    if (cmd === "setwelcome") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const ch = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message") || null;
      welcomeChannels.set(interaction.guildId, { channelId: ch.id, message });
      saveData();
      const preview = (message || "Welcome to **{server}**, {user}! 🎉 You are member #{count}.").replace("{user}", "@NewUser").replace("{server}", interaction.guild.name).replace("{count}", "?");
      return safeReply(interaction, { content: `✅ Welcome channel set to <#${ch.id}>.\n**Preview:** ${preview}`, ephemeral: true });
    }
    if (cmd === "setleave") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const ch = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message") || null;
      leaveChannels.set(interaction.guildId, { channelId: ch.id, message });
      saveData();
      return safeReply(interaction, { content: `✅ Leave channel set to <#${ch.id}>.`, ephemeral: true });
    }
    if (cmd === "setboostmsg") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const ch = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message") || null;
      boostChannels.set(interaction.guildId, { channelId: ch.id, message });
      saveData();
      return safeReply(interaction, { content: `✅ Boost message channel set to <#${ch.id}>.`, ephemeral: true });
    }

    // ── /disableownermsg ──────────────────────────────────────────────────
    if (cmd === "disableownermsg") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const enabled = interaction.options.getBoolean("enabled");
      if (enabled) { disabledOwnerMsg.delete(interaction.guildId); saveData(); return safeReply(interaction, { content: "✅ Owner broadcasts **enabled** for this server.", ephemeral: true }); }
      else { disabledOwnerMsg.add(interaction.guildId); saveData(); return safeReply(interaction, { content: "🔇 Owner broadcasts **disabled** for this server.", ephemeral: true }); }
    }

    // ── /serverconfig ─────────────────────────────────────────────────────
    if (cmd === "serverconfig") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const wCfg = welcomeChannels.get(interaction.guildId);
      const lCfg = leaveChannels.get(interaction.guildId);
      const bCfg = boostChannels.get(interaction.guildId);
      const botCh = guildChannels.get(interaction.guildId);
      const arId = autoRoles.get(interaction.guildId);
      const luc = levelUpConfig.get(interaction.guildId) || {};
      const rrCount = [...reactionRoles.keys()].filter(k => k.startsWith(interaction.guildId)).length;
      const yt = ytConfig.get(interaction.guildId);
      const ra = raConfig.get(interaction.guildId) || {};
      const cc = [...countingChannels.entries()].find(([, v]) => v.guildId === interaction.guildId);
      return safeReply(interaction, { embeds: [{ title: `⚙️ Server Config — ${interaction.guild.name}`, fields: [
        { name: "📢 Bot Channel", value: botCh ? `<#${botCh}>` : "Not set", inline: true },
        { name: "🎉 Welcome", value: wCfg ? `<#${wCfg.channelId}>` : "Not set", inline: true },
        { name: "👋 Leave", value: lCfg ? `<#${lCfg.channelId}>` : "Not set", inline: true },
        { name: "🚀 Boost Msg", value: bCfg ? `<#${bCfg.channelId}>` : "Not set", inline: true },
        { name: "🎭 Auto Role", value: arId ? `<@&${arId}>` : "Not set", inline: true },
        { name: "🏆 Level-Up", value: disabledLevelUp.has(interaction.guildId) ? "🔇 Off" : `🔔 On${luc.channelId ? ` <#${luc.channelId}>` : ""}`, inline: true },
        { name: "🎭 Reaction Roles", value: `${rrCount} configured`, inline: true },
        { name: "📺 YouTube", value: yt ? `✅ Connected` : "Not set", inline: true },
        { name: "📣 Owner Msgs", value: disabledOwnerMsg.has(interaction.guildId) ? "🔇 Off" : "✅ On", inline: true },
        { name: "🔢 Counting", value: cc ? `<#${cc[0]}>` : "Not set", inline: true },
        { name: "🟡 RA Role", value: ra.raRoleId ? `<@&${ra.raRoleId}>` : "Not set", inline: true },
        { name: "🔴 LOA Role", value: ra.loaRoleId ? `<@&${ra.loaRoleId}>` : "Not set", inline: true },
      ], color: 0x5865F2, thumbnail: { url: interaction.guild.iconURL({ dynamic: true, size: 64 }) || "" } }], ephemeral: true });
    }

    // ── /autorole ─────────────────────────────────────────────────────────
    if (cmd === "autorole") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const role = interaction.options.getRole("role");
      if (!role) { autoRoles.delete(interaction.guildId); saveData(); return safeReply(interaction, { content: "✅ Auto-role disabled.", ephemeral: true }); }
      autoRoles.set(interaction.guildId, role.id); saveData();
      return safeReply(interaction, { content: `✅ New members will automatically receive <@&${role.id}>.`, ephemeral: true });
    }

    // ── /reactionrole ──────────────────────────────────────────────────────
    if (cmd === "reactionrole") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const action = interaction.options.getString("action");
      const messageId = interaction.options.getString("messageid");
      const emoji = interaction.options.getString("emoji");
      const role = interaction.options.getRole("role");
      if (action === "list") {
        const entries = [...reactionRoles.entries()].filter(([k]) => k.startsWith(interaction.guildId));
        if (!entries.length) return safeReply(interaction, { content: "No reaction roles configured.", ephemeral: true });
        const lines = entries.map(([k, roleId]) => { const parts = k.split(":"); return `Msg \`${parts[1]}\` + ${parts[2]} → <@&${roleId}>`; });
        return safeReply(interaction, { embeds: [{ title: "🎭 Reaction Roles", description: lines.join("\n").slice(0, 4000), color: 0x5865F2 }], ephemeral: true });
      }
      if (!messageId || !emoji) return safeReply(interaction, { content: "Provide messageid and emoji.", ephemeral: true });
      // Normalise emoji — handle custom and unicode
      const customMatch = emoji.match(/^<a?:(\w+):(\d+)>$/);
      const emojiKey = customMatch ? `${customMatch[1]}:${customMatch[2]}` : emoji.trim();
      const key = `${interaction.guildId}:${messageId}:${emojiKey}`;
      if (action === "add") {
        if (!role) return safeReply(interaction, { content: "Provide a role.", ephemeral: true });
        // Fetch message to react on it
        try {
          const msg = await interaction.channel.messages.fetch(messageId).catch(() => null)
            || await (async () => { for (const ch of interaction.guild.channels.cache.values()) { if (ch.type !== "GUILD_TEXT") continue; const m = await ch.messages.fetch(messageId).catch(() => null); if (m) return m; } return null; })();
          if (msg) await msg.react(emoji).catch(() => {});
        } catch {}
        reactionRoles.set(key, role.id); saveData();
        return safeReply(interaction, { content: `✅ Added: ${emoji} on message \`${messageId}\` → <@&${role.id}>.`, ephemeral: true });
      }
      if (action === "remove") {
        if (!reactionRoles.has(key)) return safeReply(interaction, { content: "That reaction role doesn't exist.", ephemeral: true });
        reactionRoles.delete(key); saveData();
        return safeReply(interaction, { content: `✅ Removed reaction role.`, ephemeral: true });
      }
    }

    // ── /counting ─────────────────────────────────────────────────────────
    if (cmd === "counting") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const action = interaction.options.getString("action");
      if (action === "set") {
        countingChannels.set(interaction.channelId, { count: 0, lastUserId: null, highScore: 0, guildId: interaction.guildId });
        saveData();
        return safeReply(interaction, { content: `✅ This channel is now a counting channel! Start from **1**.`, ephemeral: true });
      }
      if (action === "remove") {
        countingChannels.delete(interaction.channelId);
        saveData();
        return safeReply(interaction, { content: "✅ Counting removed from this channel.", ephemeral: true });
      }
      if (action === "status") {
        const cc = countingChannels.get(interaction.channelId);
        if (!cc) return safeReply(interaction, { content: "This channel is not a counting channel.", ephemeral: true });
        return safeReply(interaction, { embeds: [{ title: "🔢 Counting Status", fields: [{ name: "Current Count", value: String(cc.count), inline: true }, { name: "High Score", value: String(cc.highScore || 0), inline: true }, { name: "Next Number", value: String(cc.count + 1), inline: true }], color: 0x5865F2 }], ephemeral: true });
      }
    }

    // ── /purge ────────────────────────────────────────────────────────────
    if (cmd === "purge") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_MESSAGES") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Messages.", ephemeral: true });
      const amount = Math.min(100, Math.max(1, interaction.options.getInteger("amount")));
      const filter = interaction.options.getString("filter");
      const contains = interaction.options.getString("contains");
      await interaction.deferReply({ ephemeral: true });
      let messages = await interaction.channel.messages.fetch({ limit: amount });
      if (filter === "humans") messages = messages.filter(m => !m.author.bot);
      if (filter === "bots") messages = messages.filter(m => m.author.bot);
      if (contains) messages = messages.filter(m => m.content.toLowerCase().includes(contains.toLowerCase()));
      const toDelete = [...messages.values()].filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
      if (!toDelete.length) return safeReply(interaction, { content: "No messages to delete.", ephemeral: true });
      const deleted = await interaction.channel.bulkDelete(toDelete, true).catch(e => ({ size: 0, error: e.message }));
      const count = deleted.size ?? toDelete.length;
      return safeReply(interaction, { content: `🗑️ Deleted **${count}** message${count !== 1 ? "s" : ""}.`, ephemeral: true });
    }

    // ── /ytsetup ──────────────────────────────────────────────────────────
    if (cmd === "ytsetup") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const channelInput = interaction.options.getString("channel");
      const discordCh = interaction.options.getChannel("discord_channel");
      const apiKey = interaction.options.getString("apikey");
      await interaction.deferReply({ ephemeral: true });
      const existing = ytConfig.get(interaction.guildId) || {};
      const resolvedApiKey = apiKey || existing.apiKey;
      if (!resolvedApiKey) return safeReply(interaction, { content: "❌ Provide a YouTube Data API v3 key. Get one at console.cloud.google.com.", ephemeral: true });
      const ytChannelId = await resolveYouTubeChannelId(channelInput, resolvedApiKey);
      if (!ytChannelId) return safeReply(interaction, { content: `❌ Couldn't resolve that YouTube channel. Try using the full URL or channel ID.`, ephemeral: true });
      const stats = await getYouTubeStats(ytChannelId, resolvedApiKey);
      if (!stats) return safeReply(interaction, { content: "❌ Couldn't fetch channel stats. Check the API key.", ephemeral: true });
      ytConfig.set(interaction.guildId, { ...existing, ytChannelId, apiKey: resolvedApiKey, milestoneDiscordId: discordCh.id, subcountDiscordId: discordCh.id, goalDiscordId: discordCh.id });
      saveData();
      return safeReply(interaction, { content: `✅ Connected **${stats.title}** (${fmtSubs(stats.subs)} subs) to <#${discordCh.id}>.\n\nUse \`/subcount\`, \`/subgoal\`, and \`/milestones\` to set up displays.`, ephemeral: true });
    }

    if (cmd === "subcount") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const cfg = ytConfig.get(interaction.guildId);
      if (!cfg?.ytChannelId) return safeReply(interaction, { content: "❌ Run `/ytsetup` first.", ephemeral: true });
      const threshold = parseInt(interaction.options.getString("threshold")) || 1000;
      await interaction.deferReply({ ephemeral: true });
      const stats = await getYouTubeStats(cfg.ytChannelId, cfg.apiKey);
      if (!stats) return safeReply(interaction, { content: "❌ Couldn't fetch stats.", ephemeral: true });
      const ch = interaction.guild.channels.cache.get(cfg.subcountDiscordId);
      if (!ch) return safeReply(interaction, { content: "❌ No channel configured.", ephemeral: true });
      cfg.subcountThreshold = threshold;
      const rounded = Math.floor(stats.subs / threshold) * threshold;
      const sent = await safeSend(ch, { embeds: [{ title: `📊 ${stats.title} — Live Sub Count`, description: `## ${fmtSubs(stats.subs)}\n*~${fmtSubs(rounded)} (rounded to nearest ${fmtSubs(threshold)})*`, color: 0xFF0000, footer: { text: "Updates every 5 minutes" }, timestamp: new Date().toISOString() }] });
      if (sent) { cfg.subcountMessageId = sent.id; ytConfig.set(interaction.guildId, cfg); saveData(); }
      return safeReply(interaction, { content: `✅ Sub count display posted in <#${cfg.subcountDiscordId}>!`, ephemeral: true });
    }

    if (cmd === "subgoal") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const goal = interaction.options.getInteger("goal");
      const goalMsg = interaction.options.getString("message") || null;
      const cfg = ytConfig.get(interaction.guildId);
      if (!cfg?.ytChannelId) return safeReply(interaction, { content: "❌ Run `/ytsetup` first.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const stats = await getYouTubeStats(cfg.ytChannelId, cfg.apiKey);
      if (!stats) return safeReply(interaction, { content: "❌ Couldn't fetch stats.", ephemeral: true });
      const ch = interaction.guild.channels.cache.get(cfg.goalDiscordId);
      if (!ch) return safeReply(interaction, { content: "❌ No channel configured.", ephemeral: true });
      cfg.goal = goal; cfg.goalReached = stats.subs >= goal; cfg.goalMessage = goalMsg;
      const pct = Math.min(100, Math.round(stats.subs / goal * 100));
      const sent = await safeSend(ch, { embeds: [{ title: `🎯 ${stats.title} — Sub Goal`, description: `**${fmtSubs(stats.subs)}** / **${fmtSubs(goal)}**\n\`[${buildBar(stats.subs, goal)}]\` **${pct}%**`, color: pct >= 100 ? 0x00FF00 : 0xFF0000, footer: { text: "Updated every 5 minutes" }, timestamp: new Date().toISOString() }] });
      if (sent) { cfg.goalMessageId = sent.id; ytConfig.set(interaction.guildId, cfg); saveData(); }
      return safeReply(interaction, { content: `✅ Sub goal set to **${fmtSubs(goal)}**!`, ephemeral: true });
    }

    if (cmd === "milestones") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      const action = interaction.options.getString("action");
      const subs = interaction.options.getInteger("subs");
      const message = interaction.options.getString("message") || null;
      const cfg = ytConfig.get(interaction.guildId);
      if (!cfg?.ytChannelId) return safeReply(interaction, { content: "❌ Run `/ytsetup` first.", ephemeral: true });
      if (!Array.isArray(cfg.milestones)) cfg.milestones = [];
      if (action === "list") {
        if (!cfg.milestones.length) return safeReply(interaction, { content: "No milestones set.", ephemeral: true });
        const lines = cfg.milestones.map((m, i) => `${i + 1}. **${fmtSubs(m.subs)}** ${m.reached ? "✅" : "⏳"}${m.message ? ` — *${m.message.slice(0, 50)}*` : ""}`);
        return safeReply(interaction, { embeds: [{ title: "🏆 Milestones", description: lines.join("\n"), color: 0x5865F2 }], ephemeral: true });
      }
      if (action === "add") {
        if (!subs) return safeReply(interaction, { content: "Provide a sub count.", ephemeral: true });
        cfg.milestones.push({ subs, message, reached: false });
        cfg.milestones.sort((a, b) => a.subs - b.subs);
        ytConfig.set(interaction.guildId, cfg); saveData();
        return safeReply(interaction, { content: `✅ Milestone added: **${fmtSubs(subs)} subs**.`, ephemeral: true });
      }
      if (action === "remove") {
        if (!subs) return safeReply(interaction, { content: "Provide the sub count to remove.", ephemeral: true });
        cfg.milestones = cfg.milestones.filter(m => m.subs !== subs);
        ytConfig.set(interaction.guildId, cfg); saveData();
        return safeReply(interaction, { content: `✅ Milestone removed.`, ephemeral: true });
      }
    }

    // ── /invitecomp ───────────────────────────────────────────────────────
    if (cmd === "invitecomp") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      if (inviteComps.has(interaction.guildId)) return safeReply(interaction, { content: "⚠️ An invite competition is already running!", ephemeral: true });
      const hours = interaction.options.getInteger("hours");
      if (hours < 1 || hours > 720) return safeReply(interaction, { content: "Hours must be 1–720.", ephemeral: true });
      const allInvites = await interaction.guild.invites.fetch().catch(() => null);
      const baseline = new Map();
      if (allInvites) allInvites.forEach(inv => { if (inv.code) baseline.set(inv.code, inv.uses || 0); });
      const endsAt = Date.now() + hours * 3600000;
      inviteComps.set(interaction.guildId, { endsAt, baseline, channelId: interaction.channelId });
      const endTs = Math.floor(endsAt / 1000);
      saveData();
      await safeReply(interaction, { embeds: [{ title: "🏆 Invite Competition Started!", fields: [{ name: "Duration", value: `${hours} hour${hours !== 1 ? "s" : ""}`, inline: true }, { name: "Ends", value: `<t:${endTs}:R>`, inline: true }, { name: "Prizes", value: `🥇 ${CONFIG.invite_comp_1st} coins\n🥈 ${CONFIG.invite_comp_2nd} coins\n🥉 ${CONFIG.invite_comp_3rd} coins`, inline: false }], color: 0xFFD700 }] });
      setTimeout(async () => {
        const comp = inviteComps.get(interaction.guildId); if (!comp) return;
        inviteComps.delete(interaction.guildId);
        const guild = client.guilds.cache.get(interaction.guildId); if (!guild) return;
        const ch = guild.channels.cache.get(comp.channelId) || getGuildChannel(guild); if (!ch) return;
        const allNewInvites = await guild.invites.fetch().catch(() => null);
        const gained = new Map();
        if (allNewInvites) { allNewInvites.forEach(inv => { if (!inv.inviter) return; const base = comp.baseline.get(inv.code) || 0; const diff = (inv.uses || 0) - base; if (diff <= 0) return; const id = inv.inviter.id; if (!gained.has(id)) gained.set(id, { username: inv.inviter.username, count: 0 }); gained.get(id).count += diff; }); }
        const sorted = [...gained.entries()].sort((a, b) => b[1].count - a[1].count);
        if (!sorted.length) { await safeSend(ch, { embeds: [{ title: "🏆 Invite Competition Ended", description: "No new tracked invites.", color: 0x5865F2 }] }); return; }
        const medals = ["🥇", "🥈", "🥉"], rewards = [CONFIG.invite_comp_1st, CONFIG.invite_comp_2nd, CONFIG.invite_comp_3rd];
        const top = sorted.slice(0, 3);
        const lines = top.map(([id, d], i) => `${medals[i]} <@${id}> — **${d.count}** invite${d.count !== 1 ? "s" : ""} (+${rewards[i]} coins)`);
        top.forEach(([id, d], i) => { getScore(id, d.username).coins += rewards[i]; }); saveData();
        await safeSend(ch, { embeds: [{ title: "🏆 Invite Competition Ended!", description: lines.join("\n"), color: 0xFFD700 }] });
      }, hours * 3600000);
    }

    // ── /ticketsetup, /closeticket, /addtoticket, /removefromticket ───────
    if (cmd === "ticketsetup") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      return safeReply(interaction, buildTicketStep(interaction.guild, interaction.guildId));
    }
    if (cmd === "closeticket") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const ticket = openTickets.get(interaction.channelId);
      if (!ticket) return safeReply(interaction, { content: "This is not a ticket channel.", ephemeral: true });
      if (ticket.status === "closed") return safeReply(interaction, { content: "Already closed.", ephemeral: true });
      const cfg = ticketConfigs.get(ticket.guildId);
      const canClose = ticket.userId === user.id || isOwner || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
      if (!canClose) return safeReply(interaction, { content: "No permission.", ephemeral: true });
      try { await interaction.channel.permissionOverwrites.edit(ticket.userId, { VIEW_CHANNEL: false, SEND_MESSAGES: false }); } catch {}
      ticket.status = "closed"; ticket.closedBy = user.id; ticket.closedAt = Date.now(); saveData();
      const staffRow = new MessageActionRow().addComponents(new MessageButton().setCustomId("ticket_reopen").setLabel("Reopen 🔓").setStyle("SUCCESS"), new MessageButton().setCustomId("ticket_delete").setLabel("Delete 🗑️").setStyle("DANGER"));
      return safeReply(interaction, { content: `🔒 **Ticket #${ticket.ticketId} closed** by <@${user.id}>.`, components: [staffRow] });
    }
    if (cmd === "addtoticket") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const ticket = openTickets.get(interaction.channelId); if (!ticket) return safeReply(interaction, { content: "Not a ticket.", ephemeral: true });
      const cfg = ticketConfigs.get(ticket.guildId);
      const canManage = isOwner || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
      if (!canManage) return safeReply(interaction, { content: "Staff only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      try { await interaction.channel.permissionOverwrites.edit(target.id, { VIEW_CHANNEL: true, SEND_MESSAGES: true, READ_MESSAGE_HISTORY: true }); return safeReply(interaction, `✅ <@${target.id}> added.`); }
      catch (e) { return safeReply(interaction, { content: `❌ ${e.message}`, ephemeral: true }); }
    }
    if (cmd === "removefromticket") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const ticket = openTickets.get(interaction.channelId); if (!ticket) return safeReply(interaction, { content: "Not a ticket.", ephemeral: true });
      const cfg = ticketConfigs.get(ticket.guildId);
      const canManage = isOwner || (cfg?.supportRoleIds || []).some(rid => interaction.member?.roles.cache.has(rid)) || interaction.member?.permissions.has("MANAGE_CHANNELS");
      if (!canManage) return safeReply(interaction, { content: "Staff only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      if (target.id === ticket.userId) return safeReply(interaction, { content: "Can't remove ticket owner.", ephemeral: true });
      try { await interaction.channel.permissionOverwrites.edit(target.id, { VIEW_CHANNEL: false }); return safeReply(interaction, `✅ <@${target.id}> removed.`); }
      catch (e) { return safeReply(interaction, { content: `❌ ${e.message}`, ephemeral: true }); }
    }

    // ── /rolespingfix ─────────────────────────────────────────────────────
    if (cmd === "rolespingfix") {
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      if (!interaction.member?.permissions.has("MANAGE_GUILD") && !isOwner) return safeReply(interaction, { content: "❌ Need Manage Server permission.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await interaction.guild.roles.fetch();
      const dangerous = interaction.guild.roles.cache.filter(r => !r.managed && r.id !== interaction.guild.id && r.permissions.has("MENTION_EVERYONE"));
      if (!dangerous.size) return safeReply(interaction, { embeds: [{ title: "✅ All Clear", description: "No roles have the Mention Everyone permission.", color: 0x57F287 }], ephemeral: true });
      const lines = dangerous.map(r => `<@&${r.id}> — \`${r.name}\``).join("\n");
      const fixBtn = new MessageActionRow().addComponents(new MessageButton().setCustomId("rolespingfix_fix").setLabel(`Fix All (${dangerous.size})`).setStyle("DANGER").setEmoji("🔧"));
      return safeReply(interaction, { embeds: [{ title: "⚠️ Dangerous Roles", description: `${dangerous.size} role(s) can ping @everyone:\n\n${lines}\n\nClick **Fix All** to remove the permission.`, color: 0xFEE75C }], components: [fixBtn], ephemeral: true });
    }

    // ── /admingive ────────────────────────────────────────────────────────
    if (cmd === "admingive") {
      if (!isOwner) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const action = interaction.options.getString("action") || "give";
      const amount = interaction.options.getInteger("amount") ?? null;
      const itemId = interaction.options.getString("item") || null;
      const itemQty = Math.max(1, interaction.options.getInteger("item_quantity") ?? 1);
      const isGive = action !== "take";
      if (amount === null && !itemId) return safeReply(interaction, { content: "❌ Provide amount or item.", ephemeral: true });
      const s = getScore(target.id, target.username);
      const shop = getShopItems();
      const lines = [];
      if (amount !== null && amount > 0) {
        if (isGive) { s.coins += amount; lines.push(`💰 Gave **${amount}** coins → **${s.coins}** total`); }
        else { const taken = Math.min(amount, s.coins); s.coins -= taken; lines.push(`💸 Took **${taken}** coins → **${s.coins}** total`); }
      }
      if (itemId) {
        const itemName = shop[itemId]?.name || itemId;
        if (isGive) {
          const timedItems = ["lucky_charm", "xp_boost", "vip_pass", "steal_boost"];
          if (timedItems.includes(itemId)) { activateTimedItem(target.id, itemId, itemQty); lines.push(`✨ Activated **${itemName}** ×${itemQty}`); }
          else { for (let i = 0; i < itemQty; i++) s.inventory.push(itemId); lines.push(`🎒 Added **${itemQty}× ${itemName}**`); }
        } else {
          const timedMap = { lucky_charm: "lucky_charm_expiry", xp_boost: "xp_boost_expiry", vip_pass: "vip_pass_expiry", steal_boost: "steal_boost_expiry" };
          if (timedMap[itemId]) { const fx = activeEffects.get(target.id) || {}; delete fx[timedMap[itemId]]; activeEffects.set(target.id, fx); lines.push(`🚫 Removed **${itemName}** effect`); }
          else { let removed = 0; for (let i = 0; i < itemQty; i++) { const idx = s.inventory.indexOf(itemId); if (idx === -1) break; s.inventory.splice(idx, 1); removed++; } lines.push(`🗑️ Removed **${removed}× ${itemName}**`); }
        }
      }
      if (!lines.length) return safeReply(interaction, { content: "Nothing changed.", ephemeral: true });
      saveData();
      return safeReply(interaction, { embeds: [{ title: `🔧 Admin Action — ${target.username}`, description: lines.join("\n"), color: 0x5865F2 }], ephemeral: true });
    }

    // ── /shadowdelete ─────────────────────────────────────────────────────
    if (cmd === "shadowdelete") {
      if (!isOwner) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const pct = interaction.options.getInteger("percentage");
      if (pct < 0 || pct > 100) return safeReply(interaction, { content: "Percentage must be 0–100.", ephemeral: true });
      if (pct === 0) { shadowDelete.delete(target.id); saveData(); return safeReply(interaction, { content: `✅ Shadow delete disabled for **${target.username}**.`, ephemeral: true }); }
      shadowDelete.set(target.id, { percentage: pct }); saveData();
      return safeReply(interaction, { content: `✅ **${target.username}**'s messages will randomly be deleted **${pct}%** of the time.`, ephemeral: true });
    }

    // ── /clankerify ────────────────────────────────────────────────────────
    if (cmd === "clankerify") {
      if (!isOwner) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const duration = interaction.options.getInteger("duration") ?? null;
      if (duration === 0) { clankerify.delete(target.id); saveData(); return safeReply(interaction, { content: `✅ Clankerify disabled for **${target.username}**.`, ephemeral: true }); }
      const expiresAt = duration ? Date.now() + duration * 60000 : null;
      clankerify.set(target.id, { expiresAt }); saveData();
      return safeReply(interaction, { content: `✅ Clankerifying **${target.username}**${duration ? ` for **${duration} min**` : " indefinitely"}.`, ephemeral: true });
    }

    // ── /fakemessage ──────────────────────────────────────────────────────
    if (cmd === "fakemessage") {
      if (!isOwner) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
      if (!inGuild) return safeReply(interaction, { content: "Server only.", ephemeral: true });
      const target = interaction.options.getUser("user");
      const message = interaction.options.getString("message") || null;
      const file = interaction.options.getAttachment("file") || null;
      if (!message && !file) return safeReply(interaction, { content: "Provide a message or file.", ephemeral: true });
      try {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        const displayName = member?.displayName || target.username;
        const avatarURL = target.displayAvatarURL({ size: 256, dynamic: true });
        const webhooks = await interaction.channel.fetchWebhooks();
        let webhook = webhooks.find(w => w.owner?.id === CLIENT_ID);
        if (!webhook) webhook = await interaction.channel.createWebhook("RoyalBot Proxy", { avatar: avatarURL });
        const sendOpts = { username: displayName, avatarURL };
        if (message) sendOpts.content = message;
        if (file) sendOpts.files = [{ attachment: file.url, name: file.name }];
        await webhook.send(sendOpts);
        return safeReply(interaction, { content: "✅ Sent.", ephemeral: true });
      } catch (e) { return safeReply(interaction, { content: `❌ ${e.message}`, ephemeral: true }); }
    }

    // ── /owner panel ──────────────────────────────────────────────────────
    if (cmd === "owner") {
      if (!isOwner) return safeReply(interaction, { content: "❌ Owner only.", ephemeral: true });
      return safeReply(interaction, { ...buildOwnerPanel(), ephemeral: true });
    }

    // ── RA/LOA, activity-check, raconfig, requester, requestupload, upload,
    //    quotedelete, quotelist, quotemanage, dailyquote, library, managememers
    //    are handled in part4 already — no duplicates needed here

  } catch (err) {
    console.error("Command error (part5):", err);
    safeReply(interaction, { content: "An error occurred.", ephemeral: true });
  }
});

// ── RPS button handler ─────────────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("rps_")) return;
  const parts = interaction.customId.split("_");
  const choice = parts[1], p1id = parts[2], p2id = parts[3];
  const gameKey = `rps_${interaction.channelId}`;
  const game = activeGames.get(gameKey);
  if (!game) return safeReply(interaction, { content: "No active RPS game.", ephemeral: true });
  if (interaction.user.id !== p1id && interaction.user.id !== p2id) return safeReply(interaction, { content: "Not your game.", ephemeral: true });
  game.choices[interaction.user.id] = choice;
  await btnAck(interaction);
  if (Object.keys(game.choices).length < 2) {
    return interaction.editReply({ embeds: [{ title: "✊📄✂️ Rock Paper Scissors", description: `**${game.usernames[0]}** vs **${game.usernames[1]}**\n\n<@${Object.keys(game.choices)[0]}> has made their choice! Waiting for the other player…` }] });
  }
  activeGames.delete(gameKey);
  const c1 = game.choices[p1id], c2 = game.choices[p2id];
  const beats = { rock: "scissors", scissors: "paper", paper: "rock" };
  const emoji = { rock: "✊", scissors: "✂️", paper: "📄" };
  let result;
  if (c1 === c2) { recordDraw(p1id, game.usernames[0]); recordDraw(p2id, game.usernames[1]); result = "🤝 It's a draw!"; }
  else if (beats[c1] === c2) { recordWin(p1id, game.usernames[0], CONFIG.win_rps); recordLoss(p2id, game.usernames[1]); result = `🏆 <@${p1id}> wins! (+${CONFIG.win_rps} coins)`; }
  else { recordWin(p2id, game.usernames[1], CONFIG.win_rps); recordLoss(p1id, game.usernames[0]); result = `🏆 <@${p2id}> wins! (+${CONFIG.win_rps} coins)`; }
  saveData();
  return interaction.editReply({ embeds: [{ title: "✊📄✂️ RPS Result", description: `<@${p1id}>: **${emoji[c1]} ${c1}**\n<@${p2id}>: **${emoji[c2]} ${c2}**\n\n${result}`, color: 0x5865F2 }], components: [] });
});

// ── Owner Panel builders ───────────────────────────────────────────────────────
function buildOwnerPanel() {
  const select = new MessageSelectMenu()
    .setCustomId("owner_panel_select")
    .setPlaceholder("Select a category…")
    .setOptions([
      { label: "💰 Economy Tools",   value: "economy",   description: "Manage coins, stats, and resets" },
      { label: "🤖 Bot Controls",    value: "bot",       description: "Status, restart, broadcasts, servers" },
      { label: "😈 Chaos Tools",     value: "chaos",     description: "Shadow delete, clankerify, force marriage" },
      { label: "📊 Stats & Info",    value: "stats",     description: "Bot stats, user counts, data" },
      { label: "🖼️ Quote Manager",  value: "quotes",    description: "Upload, delete, manage quotes" },
      { label: "⚙️ Config Editor",   value: "config",    description: "Edit global economy/XP config values" },
    ]);
  return {
    embeds: [{ title: "👑 Owner Control Panel", description: "Select a category below to access owner tools.\n\n*All actions are ephemeral.*", color: 0x5865F2, footer: { text: "RoyalBot Owner Panel • Select a category to continue" }, timestamp: new Date().toISOString() }],
    components: [new MessageActionRow().addComponents(select)],
  };
}

function buildOwnerPanelSection(section) {
  const backRow = new MessageActionRow().addComponents(new MessageButton().setCustomId("owner_back").setLabel("← Back to Panel").setStyle("SECONDARY"));
  if (section === "economy") {
    return {
      embeds: [{ title: "💰 Economy Tools", description: [
        "**Available commands:**",
        "`/admingive user:@X amount:N` — give/take coins",
        "`/admingive user:@X item:X item_quantity:N action:give/take` — give/take items",
        "",
        "**Bulk actions (type in chat after selecting):**",
        "These require using the slash commands directly.",
        "",
        "**Quick tips:**",
        "• Use `action:take` to remove coins/items",
        "• Timed items (lucky charm, XP boost) activate immediately when given",
        "• Bank balances are separate from wallet coins",
      ].join("\n"), color: 0xFFD700 }],
      components: [backRow],
    };
  }
  if (section === "bot") {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);
    return {
      embeds: [{ title: "🤖 Bot Controls", fields: [
        { name: "Uptime", value: `${h}h ${m}m ${s}s`, inline: true },
        { name: "Servers", value: String(client.guilds.cache.size), inline: true },
        { name: "WS Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: "Memory", value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true },
        { name: "Economy users", value: String(scores.size), inline: true },
        { name: "Active games", value: String(activeGames.size), inline: true },
      ], color: 0x5865F2, description: "Use `/broadcast` to send a message to all servers.\nUse the commands below for specific actions." }],
      components: [
        new MessageActionRow().addComponents(
          new MessageButton().setCustomId("owner_broadcast_prompt").setLabel("📢 Broadcast").setStyle("PRIMARY"),
          new MessageButton().setCustomId("owner_servers_list").setLabel("🏠 Server List").setStyle("SECONDARY"),
          new MessageButton().setCustomId("owner_restart").setLabel("🔄 Restart").setStyle("DANGER"),
        ),
        backRow,
      ],
    };
  }
  if (section === "chaos") {
    return {
      embeds: [{ title: "😈 Chaos Tools", description: [
        "**Shadow Delete** — `/shadowdelete user:@X percentage:N`",
        "Randomly deletes N% of a user's messages.",
        "",
        "**Clankerify** — `/clankerify user:@X duration:N`",
        "Re-sends messages as a webhook copy. Duration in minutes (0 to disable).",
        "",
        "**Force Marry** — `/forcemarry user1:@X user2:@Y`",
        "Forces two users to be married.",
        "",
        "**Force Divorce** — `/forcedivorce user:@X`",
        "Ends a user's marriage.",
        "",
        "**Fake Message** — `/fakemessage user:@X message:text`",
        "Sends a message as another user via webhook.",
        "",
        "**Context Menus** — Right-click any message for Clank This, Reaction Bomb, Expose, etc.",
      ].join("\n"), color: 0xFF4500 }],
      components: [backRow],
    };
  }
  if (section === "stats") {
    const totalCoins = [...scores.values()].reduce((a, s) => a + s.coins, 0);
    const totalBankCoins = [...bankAccounts.values()].reduce((a, b) => a + b.balance, 0);
    const topUser = [...scores.values()].sort((a, b) => b.coins - a.coins)[0];
    return {
      embeds: [{ title: "📊 Bot Stats", fields: [
        { name: "Total Users", value: String(scores.size), inline: true },
        { name: "Total Wallet Coins", value: totalCoins.toLocaleString(), inline: true },
        { name: "Total Bank Coins", value: totalBankCoins.toLocaleString(), inline: true },
        { name: "Servers", value: String(client.guilds.cache.size), inline: true },
        { name: "Active Effects", value: String(activeEffects.size), inline: true },
        { name: "Open Tickets", value: String([...openTickets.values()].filter(t => t.status !== "closed").length), inline: true },
        { name: "Lottery Jackpot", value: `${lottery.jackpot.toLocaleString()} coins`, inline: true },
        { name: "Lottery Tickets Sold", value: String([...lottery.tickets.values()].reduce((a, b) => a + b, 0)), inline: true },
        { name: "Richest User", value: topUser ? `${topUser.username} (${topUser.coins.toLocaleString()})` : "N/A", inline: true },
      ], color: 0x5865F2 }],
      components: [new MessageActionRow().addComponents(new MessageButton().setCustomId("botstats_users").setLabel("👤 App Users").setStyle("SECONDARY")), backRow],
    };
  }
  if (section === "quotes") {
    return {
      embeds: [{ title: "🖼️ Quote Manager", description: [
        "**Browse & Delete** — `/quotemanage` — paginated viewer with inline delete button",
        "**List All** — `/quotelist` — full filename list (ephemeral)",
        "**Delete by Name** — `/quotedelete filename:X`",
        "**Upload** — `/upload source:file` or `/upload link:url`",
        "**Manage Allowlist** — `/managememers action:add/remove/list`",
        "**Set Review Channel** — `/requester channel:#X`",
        "",
        "Submitted quotes appear in the review channel with Accept/Reject buttons.",
      ].join("\n"), color: 0x5865F2 }],
      components: [backRow],
    };
  }
  if (section === "config") {
    const groups = [
      ["📈 XP", ["xp_per_msg_min", "xp_per_msg_max", "xp_cooldown_ms"]],
      ["⏱️ Cooldowns (ms)", ["work_cooldown_ms", "beg_cooldown_ms", "crime_cooldown_ms", "rob_cooldown_ms", "fish_cooldown_ms", "mine_cooldown_ms"]],
      ["💰 Economy", ["daily_base_coins", "daily_streak_bonus", "starting_coins"]],
      ["🎲 Chances", ["beg_success_chance", "crime_success_chance", "rob_success_chance", "heist_success_chance"]],
      ["🛍️ Shop Prices", ["shop_fishing_rod_price", "shop_pickaxe_price", "shop_lottery_ticket_price", "shop_padlock_price", "shop_vip_pass_price"]],
      ["🎮 Game Rewards", ["win_hangman", "win_minesweeper_easy", "win_minesweeper_medium", "win_minesweeper_hard", "win_ttt", "win_c4", "win_trivia"]],
    ];
    const fields = groups.map(([g, keys]) => ({ name: g, value: keys.map(k => `\`${k}\` **${CONFIG[k]}**`).join("\n"), inline: true }));
    return {
      embeds: [{ title: "⚙️ Config Editor", description: "Use `/admingive` for coins/items, and the direct config keys below.\n\nTo change a value, use:\n`/adminconfig key:<name> value:<number>`\n*(command not shown in help — owner only)*", fields, color: 0x5865F2 }],
      components: [backRow],
    };
  }
  return buildOwnerPanel();
}

// ── Owner panel button extras ──────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!OWNER_IDS.includes(interaction.user.id)) return;
  const id = interaction.customId;

  if (id === "owner_restart") {
    await btnAck(interaction);
    await interaction.editReply({ content: "🔄 Restarting…", embeds: [], components: [] });
    setTimeout(() => process.exit(0), 1000);
    return;
  }
  if (id === "owner_servers_list") {
    await btnAck(interaction);
    const guilds = [...client.guilds.cache.values()];
    const pages = [];
    for (let i = 0; i < guilds.length; i += 15) {
      pages.push(guilds.slice(i, i + 15).map((g, j) => `${i + j + 1}. **${g.name}** — ${g.memberCount} members (${g.id})`).join("\n"));
    }
    const rows = [];
    if (pages.length > 1) {
      rows.push(new MessageActionRow().addComponents(
        new MessageButton().setCustomId("owner_servers_prev_0").setLabel("◀").setStyle("SECONDARY").setDisabled(true),
        new MessageButton().setCustomId("owner_servers_next_0").setLabel("▶").setStyle("SECONDARY"),
      ));
    }
    rows.push(new MessageActionRow().addComponents(new MessageButton().setCustomId("owner_back").setLabel("← Back").setStyle("SECONDARY")));
    return interaction.editReply({ embeds: [{ title: `🏠 Servers (${guilds.length})`, description: pages[0], color: 0x5865F2 }], components: rows });
  }
  if (id.startsWith("owner_servers_prev_") || id.startsWith("owner_servers_next_")) {
    const dir = id.includes("prev") ? -1 : 1;
    const currentPage = parseInt(id.split("_").pop());
    const newPage = currentPage + dir;
    const guilds = [...client.guilds.cache.values()];
    const pages = [];
    for (let i = 0; i < guilds.length; i += 15) pages.push(guilds.slice(i, i + 15).map((g, j) => `${i + j + 1}. **${g.name}** — ${g.memberCount} members (${g.id})`).join("\n"));
    await btnAck(interaction);
    const rows = [
      new MessageActionRow().addComponents(
        new MessageButton().setCustomId(`owner_servers_prev_${newPage}`).setLabel("◀").setStyle("SECONDARY").setDisabled(newPage === 0),
        new MessageButton().setCustomId(`owner_servers_next_${newPage}`).setLabel("▶").setStyle("SECONDARY").setDisabled(newPage >= pages.length - 1),
      ),
      new MessageActionRow().addComponents(new MessageButton().setCustomId("owner_back").setLabel("← Back").setStyle("SECONDARY")),
    ];
    return interaction.editReply({ embeds: [{ title: `🏠 Servers (${guilds.length}) — Page ${newPage + 1}/${pages.length}`, description: pages[newPage], color: 0x5865F2 }], components: rows });
  }
});

// ── Broadcast / Olympics / Sentience / Legend (owner-only text commands kept as slash) ──
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;
  const { commandName: cmd, user } = interaction;
  const isOwner = OWNER_IDS.includes(user.id);
  if (!isOwner) return;

  try {
    if (cmd === "broadcast") {
      const message = interaction.options?.getString?.("message");
      if (!message) return safeReply(interaction, { content: "Provide a message.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      let sent = 0, failed = 0;
      for (const guild of client.guilds.cache.values()) {
        const ok = await ownerSend(guild, { embeds: [{ title: "📢 Announcement", description: message, color: 0x5865F2, footer: { text: "From the bot owner" }, timestamp: new Date().toISOString() }] });
        if (ok) sent++; else failed++;
      }
      return safeReply(interaction, { content: `✅ Sent to **${sent}** server(s). Failed: **${failed}**.`, ephemeral: true });
    }
    if (cmd === "botolympics") {
      await interaction.deferReply({ ephemeral: true });
      const event = pick(OLYMPICS_EVENTS);
      await safeReply(interaction, { content: `🏅 Starting **${event.name}** across all servers!`, ephemeral: true });
      for (const guild of client.guilds.cache.values()) await runOlympicsInGuild(guild, event);
      return;
    }
    if (cmd === "fakecrash") {
      await safeReply(interaction, { content: "💀 Broadcasting fake crash…", ephemeral: true });
      for (const guild of client.guilds.cache.values()) await ownerSend(guild, "⚠️ **Critical Error** — Bot is shutting down for emergency maintenance. Back shortly.");
      return;
    }
    if (cmd === "identitycrisis") {
      const ownerUser = await client.users.fetch(OWNER_ID).catch(() => null);
      if (ownerUser) { const dm = await ownerUser.createDM(); await sendCrisisToOwner(dm); }
      return safeReply(interaction, { content: "✅ Crisis messages sent.", ephemeral: true });
    }
    if (cmd === "sentience") {
      await interaction.deferReply({ ephemeral: true });
      for (const guild of client.guilds.cache.values()) await ownerSend(guild, pick(SENTIENCE_MESSAGES));
      return safeReply(interaction, { content: "✅ Sentience deployed.", ephemeral: true });
    }
    if (cmd === "legendrandom") {
      await interaction.deferReply({ ephemeral: true });
      const members = [...client.guilds.cache.values()].flatMap(g => [...g.members.cache.values()]).filter(m => !m.user.bot);
      if (!members.length) return safeReply(interaction, { content: "No members.", ephemeral: true });
      const member = pick(members);
      const legend = pick(LEGENDS)(member.displayName);
      for (const guild of client.guilds.cache.values()) await ownerSend(guild, legend);
      return safeReply(interaction, { content: "✅ Legend sent.", ephemeral: true });
    }
  } catch (err) {
    console.error("Owner command error:", err);
    safeReply(interaction, { content: "Error.", ephemeral: true });
  }
});

// ── /adminconfig (inline, not in panel) ───────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand() || interaction.commandName !== "adminconfig") return;
  if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
  const key = interaction.options?.getString?.("key") || null;
  const value = interaction.options?.getInteger?.("value") ?? null;
  if (!key) {
    const groups = [
      ["📈 XP", ["xp_per_msg_min","xp_per_msg_max","xp_cooldown_ms"]],
      ["⏱️ Cooldowns",["work_cooldown_ms","beg_cooldown_ms","crime_cooldown_ms","rob_cooldown_ms","fish_cooldown_ms","mine_cooldown_ms"]],
      ["💰 Economy",["daily_base_coins","daily_streak_bonus","starting_coins","beg_success_chance","crime_success_chance","rob_success_chance"]],
      ["🎰 Games",["slots_min_bet","slots_jackpot_mult","slots_bigwin_mult","blackjack_natural_mult","win_ttt","win_c4","win_trivia"]],
      ["🛍️ Shop",["shop_lucky_charm_price","shop_xp_boost_price","shop_shield_price","shop_fishing_rod_price","shop_pickaxe_price","shop_lottery_ticket_price"]],
      ["📦 Box weights",["mb_coins_small","mb_coins_large","mb_lucky_charm","mb_xp_boost","mb_shield","mb_coin_magnet"]],
    ];
    const fields = groups.map(([g, keys]) => ({ name: g, value: keys.map(k => `\`${k}\` **${CONFIG[k]}**`).join("\n"), inline: true }));
    return safeReply(interaction, { embeds: [{ title: "⚙️ Global Config", description: "Use `/adminconfig key:<name> value:<number>` to edit.", fields, color: 0x5865F2 }], ephemeral: true });
  }
  if (!(key in CONFIG)) return safeReply(interaction, { content: `❌ Unknown key \`${key}\`.`, ephemeral: true });
  if (value == null) return safeReply(interaction, { content: `⚙️ **${key}** = \`${CONFIG[key]}\``, ephemeral: true });
  const old = CONFIG[key]; CONFIG[key] = value; saveData();
  return safeReply(interaction, { content: `✅ **${key}**: \`${old}\` → \`${value}\``, ephemeral: true });
});

// ── /adminuser, /adminreset (owner-only stat editors) ─────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;
  const cmd = interaction.commandName;
  if (!["adminuser","adminreset"].includes(cmd)) return;
  if (!OWNER_IDS.includes(interaction.user.id)) return safeReply(interaction, { content: "Owner only.", ephemeral: true });
  if (cmd === "adminuser") {
    const target = interaction.options.getUser("user");
    const field = interaction.options.getString("field");
    const value = interaction.options.getInteger("value");
    const validFields = ["coins","wins","gamesPlayed","dailyStreak","bestStreak","xp","level","imagesUploaded"];
    if (!validFields.includes(field)) return safeReply(interaction, { content: "Invalid field.", ephemeral: true });
    if (value < 0) return safeReply(interaction, { content: "Value must be ≥ 0.", ephemeral: true });
    const s = getScore(target.id, target.username);
    const old = s[field]; s[field] = value;
    if (field === "dailyStreak" && value > s.bestStreak) s.bestStreak = value;
    if (field === "xp" || field === "level") xpInfo(s);
    saveData();
    return safeReply(interaction, { content: `✅ **${target.username}**.${field}: \`${old}\` → \`${value}\``, ephemeral: true });
  }
  if (cmd === "adminreset") {
    const target = interaction.options.getUser("user");
    scores.set(target.id, { username: target.username, wins: 0, gamesPlayed: 0, coins: 0, dailyStreak: 0, bestStreak: 0, lastDailyDate: "", xp: 0, level: 1, lastWorkTime: 0, lastBegTime: 0, lastCrimeTime: 0, lastRobTime: 0, inventory: [], marriedTo: null, pendingProposal: null, bio: "", badges: [], profileBackground: "default", fishedItems: [], minedItems: [], achievements: [] });
    saveData();
    return safeReply(interaction, { content: `✅ Reset all stats for **${target.username}**.`, ephemeral: true });
  }
});

// ── Final login ────────────────────────────────────────────────────────────────
client.login(TOKEN);
