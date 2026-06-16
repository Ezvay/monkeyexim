const express = require('express')
const app     = express()
const http    = require('http').createServer(app)
const io      = require('socket.io')(http)
const { MongoClient } = require('mongodb')

const PASSWORD  = process.env.PASSWORD  || ''
const MONGO_URI = process.env.MONGO_URI || ''
const PORT      = process.env.PORT      || 3000
const DB_NAME   = 'characters_tracker'
const DOC_ID    = 'main'

app.use(express.static('public'))
app.get('/', (req, res) => res.redirect('/characters.html'))

// ── zmienne (identyczne jak w głównym projekcie) ──
let characters  = {}
let charsList   = {}
let charOrder   = []
let tasks       = {}
let resetHour   = 6
let resetMinute = 0

let db, col, saveTimer

async function saveNow() {
  if (!col) return
  try {
    await col.replaceOne(
      { _id: DOC_ID },
      { _id: DOC_ID, characters, charsList, charOrder, tasks, resetHour, resetMinute },
      { upsert: true }
    )
  } catch(e) { console.error('Błąd zapisu:', e.message) }
}
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

// ── reset dzienny ──
function scheduleReset() {
  const now  = new Date()
  const next = new Date()
  next.setHours(resetHour, resetMinute, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  setTimeout(() => { doReset(); scheduleReset() }, next - now)
}
function doReset() {
  for (const char in tasks) {
    for (const task in tasks[char]) {
      if (!tasks[char][task].custom) tasks[char][task].done = false
    }
  }
  for (const char in characters) {
    if (characters[char].medalGivenToday) characters[char].medalGivenToday = false
    if (characters[char].bioTriedToday)   characters[char].bioTriedToday   = false
    if (characters[char].bioDoneChecked)  characters[char].bioDoneChecked  = false
  }
  saveData()
  io.emit('tasksUpdate',      tasks)
  io.emit('charactersUpdate', characters)
  io.emit('resetTime', { hour: resetHour, minute: resetMinute })
}

// ── socket.io (handlery identyczne jak w głównym projekcie) ──
io.on('connection', socket => {
  // wyślij dane przy połączeniu — ta sama kolejność co w głównym projekcie
  socket.emit('charsListUpdate',  charsList)
  socket.emit('charOrderUpdate',  charOrder)
  socket.emit('tasksUpdate',      tasks)
  socket.emit('charactersUpdate', characters)
  socket.emit('resetTime', { hour: resetHour, minute: resetMinute })

  socket.on('checkPassword', (pass, cb) => { if (cb) cb(!PASSWORD || pass === PASSWORD) })

  socket.on('addChar', (data) => {
    const name = typeof data === 'object' ? data.name : data
    const icon = typeof data === 'object' ? (data.icon || '') : ''
    if (!name) return
    if (!charsList[name]) charsList[name] = icon
    if (!charOrder.includes(name)) charOrder.push(name)
    io.emit('charsListUpdate', charsList)
    io.emit('charOrderUpdate',  charOrder)
    saveData()
  })

  socket.on('removeChar', (name) => {
    delete charsList[name]
    delete characters[name]
    delete tasks[name]
    charOrder = charOrder.filter(c => c !== name)
    io.emit('charsListUpdate',  charsList)
    io.emit('charOrderUpdate',  charOrder)
    io.emit('tasksUpdate',      tasks)
    io.emit('charactersUpdate', characters)
    saveData()
  })

  socket.on('setCharOrder', (order) => {
    charOrder = order
    io.emit('charOrderUpdate', charOrder)
    saveData()
  })

  socket.on('addTask', (data) => {
    if (!tasks[data.char]) tasks[data.char] = {}
    tasks[data.char][data.task] = { done: false, custom: true }
    io.emit('tasksUpdate', tasks); saveData()
  })
  socket.on('toggleTask', (data) => {
    if (!tasks[data.char]) tasks[data.char] = {}
    if (!tasks[data.char][data.task]) tasks[data.char][data.task] = {}
    tasks[data.char][data.task].done = data.value
    io.emit('tasksUpdate', tasks); saveData()
  })
  socket.on('removeTask', (data) => {
    if (tasks[data.char]) delete tasks[data.char][data.task]
    io.emit('tasksUpdate', tasks); saveData()
  })

  socket.on('setHorseLevel', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    characters[data.char].horseLevel = data.level
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('horseMedal', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    characters[data.char].hasMedal    = data.has
    characters[data.char].horseLevel  = data.level ?? characters[data.char].horseLevel ?? 0
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('addMedal', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    characters[data.char].hasMedal   = true
    characters[data.char].horseLevel = data.level ?? 0
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('removeMedal', (char) => {
    if (characters[char]) {
      characters[char].hasMedal   = false
      characters[char].horseLevel = 0
    }
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('setMedalGivenToday', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    characters[data.char].medalGivenToday = data.value
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('addStone', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
    characters[data.char].spiritStones[data.stoneId] = {
      name: data.name, skillLevel: data.skillLevel, hours: 0
    }
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('removeStone', (data) => {
    if (characters[data.char]?.spiritStones) delete characters[data.char].spiritStones[data.stoneId]
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('renameStone', (data) => {
    if (characters[data.char]?.spiritStones?.[data.stoneId])
      characters[data.char].spiritStones[data.stoneId].name = data.name
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('spiritStone', (data) => {
    if (!characters[data.char]) characters[data.char] = {}
    if (!characters[data.char].spiritStones) characters[data.char].spiritStones = {}
    if (!characters[data.char].spiritStones[data.stoneId]) characters[data.char].spiritStones[data.stoneId] = {}
    characters[data.char].spiritStones[data.stoneId].hours = data.hours
    io.emit('charactersUpdate', characters); saveData()
  })
  socket.on('setStoneSkillLevel', (data) => {
    if (characters[data.char]?.spiritStones?.[data.stoneId])
      characters[data.char].spiritStones[data.stoneId].level = data.level
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('updateBio', (data) => {
    const { char, ...rest } = data
    if (!char) return
    if (!characters[char]) characters[char] = {}
    if (rest.remove) delete characters[char]
    else Object.assign(characters[char], rest)
    io.emit('charactersUpdate', characters); saveData()
  })

  socket.on('setResetTime', (data) => {
    resetHour   = data.hour   ?? resetHour
    resetMinute = data.minute ?? resetMinute
    saveData()
  })
  socket.on('manualReset', () => { doReset() })
})

// ── start ──
MongoClient.connect(MONGO_URI)
  .then(client => {
    db  = client.db(DB_NAME)
    col = db.collection('state')
    return col.findOne({ _id: DOC_ID })
  })
  .then(doc => {
    if (doc) {
      characters  = doc.characters  || {}
      charsList   = doc.charsList   || {}
      charOrder   = doc.charOrder   || []
      tasks       = doc.tasks       || {}
      resetHour   = doc.resetHour   ?? 6
      resetMinute = doc.resetMinute ?? 0
      console.log('Dane wczytane z MongoDB')
    }
    scheduleReset()
    http.listen(PORT, () => console.log('Serwer działa na porcie ' + PORT))
  })
  .catch(err => {
    console.error('Błąd MongoDB:', err.message)
    process.exit(1)
  })
