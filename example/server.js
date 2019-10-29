const PORT = process.env.PORT

var argv = require('minimist')(process.argv.slice(2))
var express = require('express')
var fs = require('fs')
var cors = require('cors')
var yaml = require('js-yaml')
var oauth = require('./../index')

var app = express()

app.use(cors({
  origin: true,
  credentials: true
}))

var entries = []

if (!argv.config) {
  console.error('Please supply path to configuration file with --config')
  process.exit(1)
}

var config = {}

try {
  config = yaml.safeLoad(fs.readFileSync(argv.config, 'utf8'))
} catch (e) {
  console.error('Error reading YAML file %s: %s', argv.config, e.message)
  process.exit(1)
}

function updateUserIds (oldUserIds, newUserId, callback) {
  // SQL equivalent:
  //   UPDATE oauth.entries SET user_id = $1
  //   WHERE user_id = ANY($2);

  entries.forEach((entry) => {
    if (oldUserIds.indexOf(entry.userId) > -1) {
      entry.userId = newUserId
    }
  })

  callback()
}

app.use(oauth(config, updateUserIds))

app.get('/entries', function (req, res) {
  res.send(entries
    .filter((entry) => entry.userId === req.session.user.id)
    .map((entry) => entry.data))
})

app.get('/submit', (req, res) => {
  var data = {
    a: Math.round(Math.random() * 1000000),
    b: Math.round(Math.random() * 1000000)
  }

  entries.push({
    userId: req.session.user.id,
    data: data
  })

  res.send({
    ok: 'true'
  })
})

app.get('/count', (req, res) => {
  res.send({count: entries
    .filter((entry) => entry.userId === req.session.user.id)
    .length})
})

app.listen(PORT, () => {
  console.log(`OAuth Test App listening on port ${PORT}!`)
})
