const express    = require("express")
const app        = express()
const http       = require("http").createServer(app)
const io         = require("socket.io")(http)
const { MongoClient } = require("mongodb")

/* ======================
   KONFIGURACJA
====================== */

const PASSWORD  = "platforma"
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kawulokdarek8_db_user:platforma@cluster0.kdommpz.mongodb.net/global_timers?retryWrites=true&w=majority&appName=Cluster0"
const DB_NAME   = "global_timers"
const COL_NAME  = "state"
const DOC_ID    = "main"

/* Hasło sprawdzane przez Socket.io — brak blokady URL */

app.use(express.static("public"))

// Proxy ikonek z wiki Metin2
const https = require("https")
app.get("/wiki-icon/:filename", (req, res) => {
  const filename = req.params.filename
  const url = `https://pl-wiki.metin2.gameforge.com/index.php/Specjalna:Redirect/file/${filename}`
  const request = https.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 5000
  }, response => {
    if (response.statusCode === 302 || response.statusCode === 301) {
      // Podąża za redirectem
      const redirectUrl = response.headers.location
      if (!redirectUrl) return res.status(404).end()
      https.get(redirectUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, r2 => {
        res.setHeader("Content-Type", r2.headers["content-type"] || "image/png")
        res.setHeader("Cache-Control", "public, max-age=86400")
        r2.pipe(res)
      }).on("error", () => res.status(404).end())
    } else if (response.statusCode === 200) {
      res.setHeader("Content-Type", response.headers["content-type"] || "image/png")
      res.setHeader("Cache-Control", "public, max-age=86400")
      response.pipe(res)
    } else {
      res.status(404).end()
    }
  })
  request.on("error", () => res.status(404).end())
  request.on("timeout", () => { request.destroy(); res.status(504).end() })
})

/* ======================
   STAN W PAMIĘCI
====================== */

let timers        = {}
let characters    = {}
let charsList     = {}   // {name: iconPath}
let skarbiec      = { inwestycje: {}, udzialy: {}, sprzedaz: [], zakupy: [] }
let runningTimers       = new Set()  // które timery były uruchomione
let runningCustomTimers = new Set()  // które custom timery były uruchomione
let tasks         = {}
let resetHour     = 23
let resetMinute   = 59
let customPlaces  = []
let customTimers  = {}
let grotaPings    = {}
let grotaHistory  = []
let grotaGenerals = {}
let grotaSnapshots= []
let grotaDeadHistory = []  // historia zbitych metinów z timerami
let grotaGenState    = {}  // stan generałów per CH
let grotaGenHistory  = []  // historia pozycji generałów
let grotaRoutes      = []  // wspólne trasy groty v1
// Grota v2
let grota2Pings={}, grota2History=[], grota2Generals={}, grota2Snapshots=[], grota2DeadHistory=[]
let grota2GenState={}, grota2GenHistory=[], grota2Routes=[]
let charOrder     = []

/* ======================
   MONGODB
====================== */

let db, col

async function connectDB() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  db  = client.db(DB_NAME)
  col = db.collection(COL_NAME)
  console.log("Połączono z MongoDB")

  // Wczytaj stan
  const doc = await col.findOne({ _id: DOC_ID })
  if (doc) {
    timers         = doc.timers         || {}
    characters     = doc.characters     || {}
    tasks          = doc.tasks          || {}
    resetHour      = doc.resetHour      ?? 23
    resetMinute    = doc.resetMinute    ?? 59
    customPlaces   = doc.customPlaces   || []
    customTimers   = doc.customTimers   || {}
    grotaPings     = doc.grotaPings     || {}
    grotaHistory   = doc.grotaHistory   || []
    grotaGenerals  = doc.grotaGenerals  || {}
    grotaSnapshots = doc.grotaSnapshots || []
    // Wczytaj dead history, odfiltruj wygasłe (>35min)
    grotaDeadHistory = (doc.grotaDeadHistory || []).filter(d => Date.now() - d.killedAt < 35*60*1000)
    grotaGenState    = doc.grotaGenState    || {}
    grotaGenHistory  = doc.grotaGenHistory  || []
    grotaRoutes      = doc.grotaRoutes      || []
    grota2Pings      = doc.grota2Pings      || {}
    grota2History    = doc.grota2History    || []
    grota2Generals   = doc.grota2Generals   || {}
    grota2Snapshots  = doc.grota2Snapshots  || []
    grota2DeadHistory= (doc.grota2DeadHistory||[]).filter(d=>Date.now()-d.killedAt<35*60*1000)
    grota2GenState   = doc.grota2GenState   || {}
    grota2GenHistory = doc.grota2GenHistory || []
    grota2Routes     = doc.grota2Routes     || []
    charOrder           = doc.charOrder           || []
  charsList           = doc.charsList           || {}
  skarbiec            = doc.skarbiec            || { inwestycje: {}, udzialy: {}, sprzedaz: [], zakupy: [] }
  if (!skarbiec.udzialy)  skarbiec.udzialy  = {}
  if (!skarbiec.zakupy)   skarbiec.zakupy   = []
    runningTimers       = new Set(doc.runningTimers       || [])
    runningCustomTimers = new Set(doc.runningCustomTimers || [])

    // Migracja charsList — zawsze uzupełniaj brakujące postacie
    const defaultIcons = {
      Medal: '/icons/warrior.png', Bieluszek: '/icons/ninja.png',
      Pojara: '/icons/shaman.png', Suczka: '/icons/shaman.png',
      Czantorianka: '/icons/shaman.png', EwaZajączkowska: '/icons/warriorw.png',
      Yodasz: '/icons/sura.png'
    }
    // Dodaj do charsList wszystkich z characters których tam nie ma
    for (const char in characters) {
      if (!charsList[char]) charsList[char] = defaultIcons[char] || '/icons/warrior.png'
    }
    // Dodaj do charsList wszystkich z tasks których tam nie ma
    for (const char in tasks) {
      if (!charsList[char]) charsList[char] = defaultIcons[char] || '/icons/warrior.png'
    }

    // Migracja
    for (const char in characters) {
      const ch = characters[char]
      if (ch.horseTimer && !ch.hasMedal) ch.hasMedal = true
      if (ch.hasStone && !ch.stones) {
        ch.stones = { stone_legacy: { name: 'Kamień Duchowy', timerEnd: ch.spiritStoneTimer || null } }
        delete ch.hasStone
        delete ch.spiritStoneTimer
      }
      if (!ch.stones) ch.stones = {}
    }
    // Nadrabiaj czas który minął podczas restartu
    if (doc.shutdownAt && doc.runningTimers && doc.runningTimers.length > 0) {
      const elapsed = Math.floor((Date.now() - doc.shutdownAt) / 1000)
      if (elapsed > 0 && elapsed < 3600) { // max 1h nadrabiania
        for (const id of doc.runningTimers) {
          if (timers[id] !== undefined) timers[id] += elapsed
        }
        for (const key of (doc.runningCustomTimers || [])) {
          if (customTimers[key] !== undefined) customTimers[key] += elapsed
        }
        console.log("Nadrobiono " + elapsed + "s przestoju")
      }
    }
    console.log("Dane wczytane z MongoDB")
  } else {
    console.log("Brak dokumentu — start od zera")
  }
}

// Debounced save — nie zapisuj częściej niż co 2s
let saveTimer = null
async function saveNow() {
  if (!col) return
  try {
    await col.replaceOne(
      { _id: DOC_ID },
      { _id: DOC_ID, timers, characters, tasks, resetHour, resetMinute,
        customPlaces, customTimers, grotaPings, grotaHistory,
        grotaGenerals, grotaSnapshots, grotaDeadHistory,
        grotaGenState, grotaGenHistory, grotaRoutes,
        grota2Pings, grota2History, grota2Generals, grota2Snapshots,
        grota2DeadHistory, grota2GenState, grota2GenHistory, grota2Routes,
        charOrder, charsList, skarbiec,
        runningTimers: [...runningTimers],
        runningCustomTimers: [...runningCustomTimers] },
      { upsert: true }
    )
  } catch(e) {
    console.error("Błąd zapisu:", e.message)
  }
}

function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

/* ======================
   TIMERY (Giganty/Małpy)
====================== */

let intervals = {}

function startTimer(id){
  if(intervals[id]) return
  if(!timers[id]) timers[id]=0
  runningTimers.add(id)
  intervals[id]=setInterval(()=>{
    timers[id]++
    saveData()
    io.emit("update", timers)
  },1000)
}
function stopTimer(id){
  clearInterval(intervals[id])
  intervals[id]=null
  runningTimers.delete(id)
  saveData()
}
function resetTimer(id){
  timers[id]=0
  stopTimer(id)
  saveData()
  io.emit("update", timers)
}

/* ======================
   CUSTOM TIMERY
====================== */

let customIntervals = {}

function startCustomTimer(key){
  if(customIntervals[key]) return
  if(!customTimers[key]) customTimers[key]=0
  runningCustomTimers.add(key)
  customIntervals[key]=setInterval(()=>{
    customTimers[key]++
    saveData()
    io.emit("customTimersUpdate", customTimers)
  },1000)
}
function stopCustomTimer(key){
  clearInterval(customIntervals[key])
  customIntervals[key]=null
  runningCustomTimers.delete(key)
  saveData()
}
function resetCustomTimer(key){
  customTimers[key]=0
  stopCustomTimer(key)
  saveData()
  io.emit("customTimersUpdate", customTimers)
}

/* ======================
   RESET DZIENNY
====================== */

const PROTECTED_KEYS = new Set(['horseTimer','hasMedal','horseLevel','stones',
  'spiritStoneTimer','hasStone','bioCurrent','bioDoneToday','bioDoneTotal','bioDoneChecked'])

let lastResetDay = null

function checkReset(){
  const now    = new Date()
  const polish = new Date(now.toLocaleString("en-US",{timeZone:"Europe/Warsaw"}))
  const hour   = polish.getHours()
  const minute = polish.getMinutes()
  const day    = polish.toDateString()
  if(hour===resetHour && minute===resetMinute && lastResetDay!==day){
    for(let char in characters){
      const old   = characters[char]
      const fresh = {
        horseTimer:     old.horseTimer     || null,
        hasMedal:       old.hasMedal       || false,
        horseLevel:     old.horseLevel     || 0,
        stones:         old.stones         || {},
        bioCurrent:     old.bioCurrent     || null,
        bioDoneToday:   0,
        bioDoneChecked: false,
        bioTriedToday:  false,
        medalGivenToday: false,
        bioDoneTotal:   old.bioDoneTotal   || 0
      }
      for(let key in old){ if(!PROTECTED_KEYS.has(key)) fresh[key] = false }
      characters[char] = fresh
    }
    lastResetDay = day
    saveData()
    io.emit("charactersUpdate", characters)
  }
}
setInterval(checkReset, 30000)

/* ======================
   SOCKET
====================== */

io.on("connection",(socket)=>{

  // Weryfikacja hasła
  socket.on("checkPassword",(pass,cb)=>{ cb(pass===PASSWORD) })

  // Giganty / Małpy
  socket.on("start",  id => startTimer(id))
  socket.on("stop",   id => stopTimer(id))
  socket.on("reset",  id => resetTimer(id))

  // Postacie — zadania
  socket.on("toggleTask",(data)=>{
    const {char,task,value}=data
    if(!characters[char]) characters[char]={}
    characters[char][task]=value
    saveNow()  // natychmiastowy zapis — checkbox jest krytyczny
    io.emit("charactersUpdate",characters)
  })
  socket.on("addTask",(data)=>{
    const {char,task}=data
    if(!tasks[char]) tasks[char]=[]
    if(!tasks[char].includes(task)) tasks[char].push(task)
    saveData()
    io.emit("tasksUpdate",tasks)
  })
  socket.on("removeTask",(data)=>{
    const {char,task}=data
    if(!tasks[char]) return
    tasks[char]=tasks[char].filter(t=>t!==task)
    if(characters[char]) delete characters[char][task]
    saveData()
    io.emit("tasksUpdate",tasks)
    io.emit("charactersUpdate",characters)
  })

  // Medal
  socket.on("horseMedal",(char)=>{
    if(!characters[char]) characters[char]={}
    characters[char].horseTimer  = Date.now() + (23*60*60*1000)
    characters[char].horseLevel  = (characters[char].horseLevel||0) + 1
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("addMedal",(data)=>{
    const char  = typeof data==='string' ? data : data.char
    const level = typeof data==='object' ? (parseInt(data.level)||0) : 0
    if(!characters[char]) characters[char]={}
    characters[char].hasMedal   = true
    characters[char].horseLevel = level
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("removeMedal",(char)=>{
    if(!characters[char]) return
    delete characters[char].hasMedal
    delete characters[char].horseTimer
    delete characters[char].horseLevel
    delete characters[char].medalGivenToday
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("setHorseLevel",(data)=>{
    const {char,level}=data
    if(!characters[char]) characters[char]={}
    characters[char].horseLevel=parseInt(level)||0
    saveData()
    io.emit("charactersUpdate",characters)
  })

  // Kamień duchowy
  socket.on("addStone",(data)=>{
    const {char,stoneId,name}=data
    if(!characters[char]) characters[char]={}
    if(!characters[char].stones) characters[char].stones={}
    characters[char].stones[stoneId]={name:name||stoneId,timerEnd:null}
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("removeStone",(data)=>{
    const {char,stoneId}=data
    if(!characters[char]?.stones) return
    delete characters[char].stones[stoneId]
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("renameStone",(data)=>{
    const {char,stoneId,name}=data
    if(!characters[char]?.stones?.[stoneId]) return
    characters[char].stones[stoneId].name=name
    saveData()
    io.emit("charactersUpdate",characters)
  })
  socket.on("spiritStone",(data)=>{
    const {char,stoneId,hours}=data
    if(!characters[char]?.stones?.[stoneId]) return
    characters[char].stones[stoneId].timerEnd=Date.now()+(hours*3600*1000)
    saveData()
    io.emit("charactersUpdate",characters)
  })

  // Biolog
  socket.on("updateBio",(data)=>{
    const {char,current,doneToday,doneTotal,action,remove}=data
    if(!characters[char]) characters[char]={}
    if(current   !== undefined) characters[char].bioCurrent     = current
    if(doneToday !== undefined) characters[char].bioDoneToday   = parseInt(doneToday)||0
    if(doneTotal !== undefined) characters[char].bioDoneTotal   = parseInt(doneTotal)||0
    if(remove) {
      characters[char].bioCurrent     = null
      characters[char].bioDoneToday   = 0
      characters[char].bioDoneTotal   = 0
      characters[char].bioDoneChecked = false
    }
    if(action==='oddaj'){
      characters[char].bioDoneTotal   = (characters[char].bioDoneTotal||0)+1
      characters[char].bioDoneChecked = true
    }
    if(action==='oddaj_nie'){
      // Niepomyślne — zablokuj przycisk ale NIE dodawaj do licznika ani nie zaznaczaj jako oddane
      characters[char].bioTriedToday = true
    }
    saveData()
    io.emit("charactersUpdate",characters)
  })

  // Reset
  socket.on("setResetTime",(data)=>{
    resetHour   = data.hour
    resetMinute = data.minute
    saveData()
    io.emit("resetTime",{hour:resetHour,minute:resetMinute})
  })
  socket.on("manualReset",()=>{
    for(let char in characters){
      const old   = characters[char]
      const fresh = {
        horseTimer:     old.horseTimer     || null,
        hasMedal:       old.hasMedal       || false,
        horseLevel:     old.horseLevel     || 0,
        stones:         old.stones         || {},
        bioCurrent:     old.bioCurrent     || null,
        bioDoneToday:   0,
        bioDoneChecked: false,
        bioTriedToday:  false,
        medalGivenToday: false,
        bioDoneTotal:   old.bioDoneTotal   || 0
      }
      for(let key in old){ if(!PROTECTED_KEYS.has(key)) fresh[key] = false }
      characters[char] = fresh
    }
    saveData()
    io.emit("charactersUpdate",characters)
  })

  // Kolejność postaci
  // Skarbiec
  socket.on("skarbiecSetInwestycja",(data)=>{
    const {nick, kwota} = data
    if(!skarbiec.inwestycje) skarbiec.inwestycje = {}
    skarbiec.inwestycje[nick] = parseFloat(kwota)||0
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecSetUdzial",(data)=>{
    const {nick, udzial} = data
    if(!skarbiec.udzialy) skarbiec.udzialy = {}
    skarbiec.udzialy[nick] = parseFloat(udzial)||1
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecAddNick",(nick)=>{
    if(!skarbiec.inwestycje) skarbiec.inwestycje = {}
    if(skarbiec.inwestycje[nick]===undefined) skarbiec.inwestycje[nick] = 0
    if(!skarbiec.udzialy) skarbiec.udzialy = {}
    if(skarbiec.udzialy[nick]===undefined) skarbiec.udzialy[nick] = 1
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecRemoveNick",(nick)=>{
    if(skarbiec.inwestycje) delete skarbiec.inwestycje[nick]
    if(skarbiec.udzialy)    delete skarbiec.udzialy[nick]
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecAddSprzedaz",(data)=>{
    const {opis, kwota, imgUrl} = data
    if(!skarbiec.sprzedaz) skarbiec.sprzedaz = []
    skarbiec.sprzedaz.unshift({ id:'sp_'+Date.now(), opis, kwota:parseFloat(kwota)||0, imgUrl:imgUrl||'', ts:Date.now() })
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecRemoveSprzedaz",(id)=>{
    skarbiec.sprzedaz = (skarbiec.sprzedaz||[]).filter(s=>s.id!==id)
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecAddZakup",(data)=>{
    const {opis, kwota, kto, imgUrl} = data
    if(!skarbiec.zakupy) skarbiec.zakupy = []
    skarbiec.zakupy.unshift({ id:'buy_'+Date.now(), opis, kwota:parseFloat(kwota)||0, kto:kto||'', imgUrl:imgUrl||'', ts:Date.now() })
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })
  socket.on("skarbiecRemoveZakup",(id)=>{
    skarbiec.zakupy = (skarbiec.zakupy||[]).filter(b=>b.id!==id)
    saveNow(); io.emit("skarbiecUpdate", skarbiec)
  })

  socket.on("setCharOrder",(order)=>{
    charOrder=order
    saveData()
    io.emit("charOrderUpdate",charOrder)
  })

  socket.on("addChar",(data)=>{
    const {name, icon} = data
    if(!name || charsList[name]) return
    charsList[name] = icon || '/icons/warrior.png'
    if(!characters[name]) characters[name] = { stones: {} }
    if(!tasks[name]) tasks[name] = []
    saveData()
    io.emit("charsListUpdate", charsList)
    io.emit("tasksUpdate", tasks)
    io.emit("charactersUpdate", characters)
  })

  socket.on("removeChar",(name)=>{
    delete charsList[name]
    delete characters[name]
    delete tasks[name]
    charOrder = charOrder.filter(n => n !== name)
    saveData()
    io.emit("charsListUpdate", charsList)
    io.emit("charOrderUpdate", charOrder)
  })

  socket.on("setMedalGivenToday",(data)=>{
    const {char, given} = data
    if(!characters[char]) characters[char]={}
    characters[char].medalGivenToday = given
    saveData()
    io.emit("charactersUpdate", characters)
  })

  // Custom timery (Własne Timery)
  socket.on("addPlace",(data)=>{
    const {name,yellowSec,greenSec,channels}=data
    if(!name||!greenSec||!channels) return
    if(customPlaces.length>=10) return
    const id="p_"+Date.now()
    customPlaces.push({id,name,yellowSec:parseInt(yellowSec)||0,greenSec:parseInt(greenSec),channels:parseInt(channels)})
    saveData()
    io.emit("placesUpdate",customPlaces)
  })
  socket.on("removePlace",(placeId)=>{
    customPlaces=customPlaces.filter(p=>p.id!==placeId)
    for(let key in customTimers){
      if(key.startsWith(placeId+"_")){stopCustomTimer(key);delete customTimers[key]}
    }
    saveData()
    io.emit("placesUpdate",customPlaces)
    io.emit("customTimersUpdate",customTimers)
  })
  socket.on("editPlace",(data)=>{
    const {id,name,yellowSec,greenSec,channels}=data
    const place=customPlaces.find(p=>p.id===id)
    if(!place) return
    const oldCh=place.channels
    place.name=name; place.yellowSec=parseInt(yellowSec)||0
    place.greenSec=parseInt(greenSec); place.channels=parseInt(channels)
    if(place.channels<oldCh){
      for(let ch=place.channels+1;ch<=oldCh;ch++){
        const key=id+"_ch"+ch; stopCustomTimer(key); delete customTimers[key]
      }
    }
    saveData()
    io.emit("placesUpdate",customPlaces)
    io.emit("customTimersUpdate",customTimers)
  })
  socket.on("startCustom",  key => startCustomTimer(key))
  socket.on("stopCustom",   key => stopCustomTimer(key))
  socket.on("resetCustom",  key => resetCustomTimer(key))

  // Grota — metiny
  socket.on("grotaAddPing",(data)=>{
    const id="g_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grotaPings[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    grotaHistory.push({x:data.x,y:data.y,ts:Date.now()})
    if(grotaHistory.length>2000) grotaHistory=grotaHistory.slice(-2000)
    saveData()
    io.emit("grotaPingsUpdate",grotaPings)
    io.emit("grotaHistoryUpdate",grotaHistory)
  })
  // Dead history handlers
  socket.on("grotaAddDead", (dead) => {
    if (!dead || !dead.id) return
    grotaDeadHistory.push(dead)
    // Usuń wygasłe
    grotaDeadHistory = grotaDeadHistory.filter(d => Date.now() - d.killedAt < 35*60*1000)
    io.emit("grotaDeadHistoryUpdate", grotaDeadHistory)
    saveData()
  })

  socket.on("grotaRemoveDead", (id) => {
    grotaDeadHistory = grotaDeadHistory.filter(d => d.id !== id)
    io.emit("grotaDeadHistoryUpdate", grotaDeadHistory)
    saveData()
  })

  socket.on("grotaResetHistory", () => {
    grotaHistory = []
    io.emit("grotaHistoryUpdate", grotaHistory)
    saveData()
  })

  socket.on("grotaClearSnapshots", () => {
    grotaSnapshots = []
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
    saveData()
  })

  socket.on("grotaRemovePing",(id)=>{
    delete grotaPings[id]
    saveData()
    io.emit("grotaPingsUpdate",grotaPings)
  })

  // Grota — generałowie
  socket.on("grotaAddGeneral",(data)=>{
    const id="g_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grotaGenerals[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    saveData()
    io.emit("grotaGeneralsUpdate",grotaGenerals)
  })
  socket.on("grotaRemoveGeneral",(id)=>{
    delete grotaGenerals[id]
    saveData()
    io.emit("grotaGeneralsUpdate",grotaGenerals)
  })

  // Grota — snapshoty
  socket.on("grotaSaveSnapshot",(data)=>{
    const snap={
      id:"snap_"+Date.now(),
      name:data.name||"Snapshot",
      ts:Date.now(),
      pings:    JSON.parse(JSON.stringify(grotaPings)),
      generals: JSON.parse(JSON.stringify(grotaGenerals))
    }
    grotaSnapshots.unshift(snap)
    if(grotaSnapshots.length>10) grotaSnapshots=grotaSnapshots.slice(0,10)
    saveData()
    io.emit("grotaSnapshotsUpdate",grotaSnapshots)
  })
  socket.on("grotaLoadSnapshot",(snapId)=>{
    const snap=grotaSnapshots.find(s=>s.id===snapId)
    if(!snap) return
    grotaPings    = JSON.parse(JSON.stringify(snap.pings))
    grotaGenerals = JSON.parse(JSON.stringify(snap.generals))
    saveData()
    io.emit("grotaPingsUpdate",grotaPings)
    io.emit("grotaGeneralsUpdate",grotaGenerals)
  })
  socket.on("grotaDeleteSnapshot",(snapId)=>{
    grotaSnapshots=grotaSnapshots.filter(s=>s.id!==snapId)
    saveData()
    io.emit("grotaSnapshotsUpdate",grotaSnapshots)
  })

  // Wyślij stan do nowego klienta
  socket.emit("update",              timers)
  // charsListUpdate MUSI być pierwsza — buduje karty postaci
  socket.emit("charsListUpdate",     charsList)
  socket.emit("skarbiecUpdate",       skarbiec)
  socket.emit("charOrderUpdate",     charOrder)
  socket.emit("tasksUpdate",         tasks)
  socket.emit("charactersUpdate",    characters)
  socket.emit("resetTime",           {hour:resetHour,minute:resetMinute})
  socket.emit("placesUpdate",        customPlaces)
  socket.emit("customTimersUpdate",  customTimers)
  socket.emit("grotaPingsUpdate",    grotaPings)
  socket.emit("grotaHistoryUpdate",  grotaHistory)
  socket.emit("grotaGeneralsUpdate", grotaGenerals)
  socket.emit("grotaSnapshotsUpdate",grotaSnapshots)
  // Wyślij dead history (odfiltruj wygasłe)
  grotaDeadHistory = grotaDeadHistory.filter(d => Date.now() - d.killedAt < 35*60*1000)
  socket.emit("grotaDeadHistoryUpdate", grotaDeadHistory)
  socket.emit("grotaGenState",          grotaGenState)
  socket.emit("grotaGenHistoryUpdate",  grotaGenHistory)
  socket.emit("grotaRoutesUpdate",      grotaRoutes)
  // Grota v2
  socket.emit("grota2PingsUpdate",      grota2Pings)
  socket.emit("grota2HistoryUpdate",    grota2History)
  socket.emit("grota2GeneralsUpdate",   grota2Generals)
  socket.emit("grota2SnapshotsUpdate",  grota2Snapshots)
  grota2DeadHistory = grota2DeadHistory.filter(d=>Date.now()-d.killedAt<35*60*1000)
  socket.emit("grota2DeadHistoryUpdate",grota2DeadHistory)
  socket.emit("grota2GenState",         grota2GenState)
  socket.emit("grota2GenHistoryUpdate", grota2GenHistory)
  socket.emit("grota2RoutesUpdate",     grota2Routes)


  // ══ grota ══
  socket.on("grotaAddPing",(data)=>{
    const id="_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grotaPings[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    grotaHistory.push({x:data.x,y:data.y,ch:data.ch,ts:Date.now()})
    if(grotaHistory.length>2000) grotaHistory=grotaHistory.slice(-2000)
    io.emit("grotaPingsUpdate",grotaPings); io.emit("grotaHistoryUpdate",grotaHistory); saveData()
  })
  socket.on("grotaRemovePing",(id)=>{ delete grotaPings[id]; io.emit("grotaPingsUpdate",grotaPings); saveData() })
  socket.on("grotaAddGeneral",(data)=>{
    const id="g_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grotaGenerals[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    grotaGenHistory.push({x:data.x,y:data.y,ch:data.ch,ts:Date.now()})
    if(grotaGenHistory.length>2000) grotaGenHistory=grotaGenHistory.slice(-2000)
    io.emit("grotaGeneralsUpdate",grotaGenerals); io.emit("grotaGenHistoryUpdate",grotaGenHistory); saveData()
  })
  socket.on("grotaRemoveGeneral",(id)=>{ delete grotaGenerals[id]; io.emit("grotaGeneralsUpdate",grotaGenerals); saveData() })
  socket.on("grotaAddDead",(dead)=>{
    if(!dead||!dead.id) return
    grotaDeadHistory.push(dead); grotaDeadHistory=grotaDeadHistory.filter(d=>Date.now()-d.killedAt<35*60*1000)
    io.emit("grotaDeadHistoryUpdate",grotaDeadHistory); saveData()
  })
  socket.on("grotaRemoveDead",(id)=>{ grotaDeadHistory=grotaDeadHistory.filter(d=>d.id!==id); io.emit("grotaDeadHistoryUpdate",grotaDeadHistory); saveData() })
  socket.on("grotaResetHistory",()=>{ grotaHistory=[]; grotaGenHistory=[]; io.emit("grotaHistoryUpdate",grotaHistory); io.emit("grotaGenHistoryUpdate",grotaGenHistory); saveData() })
  socket.on("grotaClearSnapshots",()=>{ grotaSnapshots=[]; io.emit("grotaSnapshotsUpdate",grotaSnapshots); saveData() })
  socket.on("grotaSaveSnapshot",(data)=>{
    const id="snap_"+Date.now()
    grotaSnapshots.unshift({id,name:data.name,pings:{...grotaPings},ts:Date.now()})
    if(grotaSnapshots.length>20) grotaSnapshots=grotaSnapshots.slice(0,20)
    io.emit("grotaSnapshotsUpdate",grotaSnapshots); saveData()
  })
  socket.on("grotaLoadSnapshot",(id)=>{ const s=grotaSnapshots.find(x=>x.id===id); if(!s) return; grotaPings={...s.pings}; io.emit("grotaPingsUpdate",grotaPings) })
  socket.on("grotaDeleteSnapshot",(id)=>{ grotaSnapshots=grotaSnapshots.filter(x=>x.id!==id); io.emit("grotaSnapshotsUpdate",grotaSnapshots); saveData() })
  socket.on("grotaGenState",(data)=>{ grotaGenState=data||{}; io.emit("grotaGenState",grotaGenState); saveData() })
  socket.on("grotaAddRoute",(route)=>{
    if(!route||!route.id) return
    grotaRoutes=grotaRoutes.filter(r=>r.id!==route.id); grotaRoutes.push(route)
    io.emit("grotaRoutesUpdate",grotaRoutes); saveData()
  })
  socket.on("grotaDeleteRoute",(id)=>{ grotaRoutes=grotaRoutes.filter(r=>r.id!==id); io.emit("grotaRoutesUpdate",grotaRoutes); saveData() })
  socket.on("grotaUpdateRouteVisible",(data)=>{
    const r=grotaRoutes.find(r=>r.id===data.id); if(r) r.visible=data.visible
    io.emit("grotaRoutesUpdate",grotaRoutes); saveData()
  })

  // ══ grota2 ══
  socket.on("grota2AddPing",(data)=>{
    const id="2_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grota2Pings[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    grota2History.push({x:data.x,y:data.y,ch:data.ch,ts:Date.now()})
    if(grota2History.length>2000) grota2History=grota2History.slice(-2000)
    io.emit("grota2PingsUpdate",grota2Pings); io.emit("grota2HistoryUpdate",grota2History); saveData()
  })
  socket.on("grota2RemovePing",(id)=>{ delete grota2Pings[id]; io.emit("grota2PingsUpdate",grota2Pings); saveData() })
  socket.on("grota2AddGeneral",(data)=>{
    const id="g_"+Date.now()+"_"+Math.random().toString(36).slice(2,6)
    grota2Generals[id]={id,x:data.x,y:data.y,ch:data.ch,startedAt:Date.now()}
    grota2GenHistory.push({x:data.x,y:data.y,ch:data.ch,ts:Date.now()})
    if(grota2GenHistory.length>2000) grota2GenHistory=grota2GenHistory.slice(-2000)
    io.emit("grota2GeneralsUpdate",grota2Generals); io.emit("grota2GenHistoryUpdate",grota2GenHistory); saveData()
  })
  socket.on("grota2RemoveGeneral",(id)=>{ delete grota2Generals[id]; io.emit("grota2GeneralsUpdate",grota2Generals); saveData() })
  socket.on("grota2AddDead",(dead)=>{
    if(!dead||!dead.id) return
    grota2DeadHistory.push(dead); grota2DeadHistory=grota2DeadHistory.filter(d=>Date.now()-d.killedAt<35*60*1000)
    io.emit("grota2DeadHistoryUpdate",grota2DeadHistory); saveData()
  })
  socket.on("grota2RemoveDead",(id)=>{ grota2DeadHistory=grota2DeadHistory.filter(d=>d.id!==id); io.emit("grota2DeadHistoryUpdate",grota2DeadHistory); saveData() })
  socket.on("grota2ResetHistory",()=>{ grota2History=[]; grota2GenHistory=[]; io.emit("grota2HistoryUpdate",grota2History); io.emit("grota2GenHistoryUpdate",grota2GenHistory); saveData() })
  socket.on("grota2ClearSnapshots",()=>{ grota2Snapshots=[]; io.emit("grota2SnapshotsUpdate",grota2Snapshots); saveData() })
  socket.on("grota2SaveSnapshot",(data)=>{
    const id="snap_"+Date.now()
    grota2Snapshots.unshift({id,name:data.name,pings:{...grota2Pings},ts:Date.now()})
    if(grota2Snapshots.length>20) grota2Snapshots=grota2Snapshots.slice(0,20)
    io.emit("grota2SnapshotsUpdate",grota2Snapshots); saveData()
  })
  socket.on("grota2LoadSnapshot",(id)=>{ const s=grota2Snapshots.find(x=>x.id===id); if(!s) return; grota2Pings={...s.pings}; io.emit("grota2PingsUpdate",grota2Pings) })
  socket.on("grota2DeleteSnapshot",(id)=>{ grota2Snapshots=grota2Snapshots.filter(x=>x.id!==id); io.emit("grota2SnapshotsUpdate",grota2Snapshots); saveData() })
  socket.on("grota2GenState",(data)=>{ grota2GenState=data||{}; io.emit("grota2GenState",grota2GenState); saveData() })
  socket.on("grota2AddRoute",(route)=>{
    if(!route||!route.id) return
    grota2Routes=grota2Routes.filter(r=>r.id!==route.id); grota2Routes.push(route)
    io.emit("grota2RoutesUpdate",grota2Routes); saveData()
  })
  socket.on("grota2DeleteRoute",(id)=>{ grota2Routes=grota2Routes.filter(r=>r.id!==id); io.emit("grota2RoutesUpdate",grota2Routes); saveData() })
  socket.on("grota2UpdateRouteVisible",(data)=>{
    const r=grota2Routes.find(r=>r.id===data.id); if(r) r.visible=data.visible
    io.emit("grota2RoutesUpdate",grota2Routes); saveData()
  })
})

/* ======================
   START
====================== */

// Zapisz dane przed zamknięciem procesu (np. deploy)
async function gracefulShutdown(signal) {
  console.log("Zamykanie (" + signal + ") — zapisuję dane...")
  if (saveTimer) clearTimeout(saveTimer)
  // Zapisz timestamp zamknięcia żeby po restarcie nadrobić czas
  const shutdownTs = Date.now()
  if (col) {
    try {
      await col.updateOne({ _id: DOC_ID }, { $set: { shutdownAt: shutdownTs } })
    } catch(e) {}
  }
  await saveNow()
  console.log("Dane zapisane. Zamykam.")
  process.exit(0)
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT",  () => gracefulShutdown("SIGINT"))

connectDB().then(()=>{

  // ── Wznów timery Giganty/Małpy które były uruchomione przed restartem ──
  // timers{} zawiera sekundy zapisane w DB — jeśli > 0 to timer był aktywny
  // Problem: nie wiemy które BYŁY uruchomione, a które tylko zatrzymane z wartością > 0
  // Rozwiązanie: zapisujemy osobno listę "running" timerów
  for(const id in timers){
    if(runningTimers.has(id)){
      startTimer(id)
      console.log("Wznowiono timer:", id)
    }
  }
  for(const key in customTimers){
    if(runningCustomTimers.has(key)){
      startCustomTimer(key)
      console.log("Wznowiono custom timer:", key)
    }
  }

  http.listen(3000,()=>{ console.log("Server działa na porcie 3000") })
}).catch(err=>{
  console.error("Błąd połączenia z MongoDB:", err)
  process.exit(1)
})
