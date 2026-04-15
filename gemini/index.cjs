const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { exec } = require("child_process");

const dataPath = path.join(__dirname, "botdata.json");

function loadData(){
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function saveData(data){
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function commitToGit(){
  exec(`git add gemini/botdata.json && git commit -m "update botdata" && git push`, (err)=>{
    if(err) console.error("Git error:", err);
  });
}

function setInstruction(instruction){
  const data = loadData();
  data.customInstruction = instruction;
  saveData(data);
  commitToGit();
}

async function askGemini(prompt){
  const API_KEY = process.env.GEMINI_API_KEY;
  const data = loadData();

  const fullPrompt = data.customInstruction
    ? `${data.customInstruction}\n\nUser: ${prompt}`
    : prompt;

  const res = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        contents:[{ parts:[{ text: fullPrompt }] }]
      })
    }
  );

  const json = await res.json();

  if(!json.candidates) return "No response.";

  return json.candidates[0].content.parts[0].text;
}

module.exports = { askGemini, setInstruction };
