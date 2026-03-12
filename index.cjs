const { Client, Intents, Permissions } = require('discord.js');
const https = require('https');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.DIRECT_MESSAGES
  ]
});

function random(min,max){
  return Math.floor(Math.random()*(max-min+1))+min;
}

const eightBall = [
"Yes",
"No",
"Maybe",
"Definitely",
"Absolutely not",
"Ask again later",
"Without a doubt",
"Very unlikely",
"It is certain",
"I wouldn't count on it"
];

const commands = [

{name:"ping",description:"Check if bot is alive"},

{name:"echo",description:"Repeat a message",
options:[{name:"message",description:"Message",type:3,required:true}]},

{name:"coinflip",description:"Flip a coin"},

{name:"roll",description:"Roll number 1-100"},

{name:"invite",description:"Get invite link"},

{name:"punch",description:"Punch someone",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"kiss",description:"Kiss someone",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"hug",description:"Hug someone",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"slap",description:"Slap someone",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"ppsize",description:"Check pp size",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"gayrate",description:"How gay someone is",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"iq",description:"Check IQ",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"sus",description:"How sus someone is",
options:[{name:"user",description:"Target",type:6,required:true}]},

{name:"ship",description:"Ship two users",
options:[
{name:"user1",description:"User",type:6,required:true},
{name:"user2",description:"User",type:6,required:true}
]},

{name:"8ball",description:"Ask the magic 8ball",
options:[{name:"question",description:"Question",type:3,required:true}]},

{name:"servers",description:"List bot servers"},

{name:"leaveall",description:"Leave all servers"}

];

async function registerCommands(){

const data = JSON.stringify(commands);

const options = {
  hostname: 'discord.com',
  port: 443,
  path: /api/v10/applications/${CLIENT_ID}/commands,
  method: 'PUT',
  headers: {
    'Authorization': Bot ${TOKEN},
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req=https.request(options,res=>{

let body='';

res.on('data',chunk=>body+=chunk);

res.on('end',()=>{

if(res.statusCode===200||res.statusCode===201){
console.log("Slash commands registered");
}else{
console.log("Register error:",body);
}

});

});

req.on('error',err=>{
console.error("Register error:",err);
});

req.write(data);
req.end();

}

client.once("ready",async()=>{

console.log(Logged in as ${client.user.tag});

await registerCommands();

});

client.on("interactionCreate",async interaction=>{

if(!interaction.isCommand()) return;

const {commandName,user}=interaction;

try{

if(commandName==="ping"){
await interaction.reply("Pong");
}

else if(commandName==="echo"){
const msg=interaction.options.getString("message");
await interaction.reply(msg);
}

else if(commandName==="coinflip"){
const result=Math.random()<0.5?"Heads":"Tails";
await interaction.reply(Coin: **${result}**);
}

else if(commandName==="roll"){
const r=random(1,100);
await interaction.reply(Rolled **${r}**);
}

else if(commandName==="punch"){
const target=interaction.options.getUser("user");
await interaction.reply(👊 <@${user.id}> punched <@${target.id}>);
}

else if(commandName==="kiss"){
const target=interaction.options.getUser("user");
await interaction.reply(💋 <@${user.id}> kissed <@${target.id}>);
}

else if(commandName==="hug"){
const target=interaction.options.getUser("user");
await interaction.reply(🤗 <@${user.id}> hugged <@${target.id}>);
}

else if(commandName==="slap"){
const target=interaction.options.getUser("user");
await interaction.reply(🖐️ <@${user.id}> slapped <@${target.id}>);
}

else if(commandName==="ppsize"){

const target=interaction.options.getUser("user");

const size=random(3,30);

let pp="8";

for(let i=0;i<size;i++){
pp+="=";
}

pp+="D";

await interaction.reply(<@${target.id}> size:\n${pp});

}

else if(commandName==="gayrate"){

const target=interaction.options.getUser("user");

const percent=random(0,100);

await interaction.reply(<@${target.id}> is **${percent}% gay** 🌈);

}

else if(commandName==="iq"){

const target=interaction.options.getUser("user");

const iq=random(60,180);

await interaction.reply(<@${target.id}> IQ: **${iq}**);

}

else if(commandName==="sus"){

const target=interaction.options.getUser("user");

const sus=random(0,100);

await interaction.reply(<@${target.id}> is **${sus}% sus**);

}

else if(commandName==="ship"){

const u1=interaction.options.getUser("user1");
const u2=interaction.options.getUser("user2");

const percent=random(0,100);

await interaction.reply(❤️ **${u1.username} + ${u2.username}**\nCompatibility: **${percent}%**);

}

else if(commandName==="8ball"){

const question=interaction.options.getString("question");

const answer=eightBall[random(0,eightBall.length-1)];

await interaction.reply(🎱 Question: ${question}\nAnswer: **${answer}**);

}

else if(commandName==="invite"){

await interaction.reply(https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot);

}

else if(commandName==="servers"){

if(user.id!==OWNER_ID){
await interaction.reply({content:"Owner only",ephemeral:true});
return;
}

const list=client.guilds.cache.map(g=>${g.name} (${g.memberCount})).join("\n")||"none";

await interaction.reply({content:list,ephemeral:true});

}

else if(commandName==="leaveall"){

if(user.id!==OWNER_ID){
await interaction.reply({content:"Owner only",ephemeral:true});
return;
}

await interaction.reply({content:"Leaving servers",ephemeral:true});

for(const guild of client.guilds.cache.values()){
try{
await guild.leave();
}catch{}
}

}

}catch(err){

console.error(err);

if(!interaction.replied){
await interaction.reply({content:"Command error",ephemeral:true});
}

}

});

client.login(TOKEN);
