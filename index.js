var R = require('ramda')
const Config = require('./config')
var express = require('express')
var request = require('request')
var Grant = require('grant-express')
var purest = require('purest')({request})
var purestConfig = require('@purest/providers')
var pg = require('pg')
var session = require('express-session')
var PGSession = require('connect-pg-simple')(session)
var app = express()

module.exports = function (config, updateUserIds) {
  // Merge user config (with provider keys and secrets)
  // with baseConfig in config.js
  config = Config(config)

  const serverUrl = `${config.server.protocol}://${config.server.host}${config.server.path}`

  var grant = new Grant(config)

  const getProviders = () => Object.keys(config)
      .filter((provider) => config[provider].key && config[provider].secret)

  const getProvidersFull = () => getProviders().map((provider) => ({
    name: provider,
    title: config[provider].title,
    url: `${serverUrl}/authenticate/${provider}`,
    icon: `${serverUrl}/icons/${provider}.svg`
  }))

  var providers = R.fromPairs(getProviders().map((provider) => {
    return [
      provider,
      purest({
        provider: provider,
        config: purestConfig,
        key: config[provider].purest.authInConstructor ? config[provider].key : undefined,
        secret: config[provider].purest.authInConstructor ? config[provider].secret : undefined
      })
    ]
  }))

  app.use('/oauth', express.static(__dirname + '/public'))

  app.use(session({
    saveUninitialized: false,
    store: new PGSession({
      pg: pg,
      conString: config.database.url,
      schemaName: 'oauth',
      tableName: 'sessions'
    }),
    secret: config.server.secret,
    resave: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
  }))

  function send500 (res, err) {
    res.status(500).send({
      error: err.message
    })
  }

  app.use('/oauth', grant)

  function executeQuery (query, params, callback) {
    pg.connect(config.database.url, (err, client, done) => {
      var handleError = (err) => {
        if (!err) {
          return false
        }

        if (client) {
          done(client)
        }

        callback(err)
        return true
      }

      if (handleError(err)) {
        return
      }

      client.query(query, params, (err, result) => {
        if (handleError(err)) {
          return
        }
        done()
        callback(null, result)
      })
    })
  }

  function getUserIdForSession (req, res, next) {
    // TODO: do in one transaction!!!

    var newUserQuery = `
      SELECT user_id
      FROM oauth.users_sessions
      WHERE session_id = $1;
    `

    executeQuery(newUserQuery, [req.session.id], (err, results) => {
      if (err) {
        send500(res, err)
        return
      }

      if (results.rows.length) {
        var userId = results.rows[0].user_id
        req.session.user = {
          id: userId
        }
        next()
      } else {
        var newUserQuery = `
          INSERT INTO oauth.users VALUES (DEFAULT)
          RETURNING id;
        `

        executeQuery(newUserQuery, [], (err, results) => {
          if (err) {
            send500(res, err)
            return
          }

          var userId = results.rows[0].id

          req.session.user = {
            id: userId
          }

          req.session.save((err) => {
            if (err) {
              send500(res, err)
              return
            }

            var usersSessionsQuery = `
              INSERT INTO oauth.users_sessions VALUES ($1, $2);
            `

            executeQuery(usersSessionsQuery, [userId, req.session.id], (err, results) => {
              if (err) {
                send500(res, err)
                return
              }

              next()
            })
          })
        })
      }
    })
  }

  app.use(getUserIdForSession)

  app.get('/oauth', (req, res) => {
    res.send({
      providers: getProvidersFull(),
      disconnect: `${serverUrl}/disconnect`,
      user: req.session.user,
      oauth: req.session.oauth,
      error: req.session.error
    })
  })

  app.get('/oauth/authenticate/:provider', (req, res) => {
    const callbackUrl = req.headers.referer
    req.session.callbackUrl = callbackUrl
    res.redirect(`/oauth/connect/${req.params.provider}`)
  })

  app.get('/oauth/disconnect', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        send500(res, err)
        return
      }

      res.send({
        ok: true
      })
    })
  })

  function getUserInfo (req, res, next) {
    var session = req.session

    session.oauth = undefined
    session.error = undefined

    if (req.query.error) {
      session.error = req.query.error
      next()
    } else {
      if (session && session.grant && session.grant.response && session.grant.response.access_token) {
        var provider = session.grant.provider

        providers[provider]
          .query(config[provider].purest.query)
          .options({
            headers: {
              'user-agent': 'brick-by-brick'
            }
          })
          .get(config[provider].purest.get)
          // .auth(session.grant.response.access_token)
          .auth(session.grant.response.access_token, session.grant.response.raw.oauth_token_secret)
          .request(function (err, res, body) {
            if (err) {
              session.error = err
            } else {
              session.oauth = {
                provider: provider,
                id: config[provider].purest.id ? body[config[provider].purest.id] : body.id,
                data: config[provider].purest.data ? config[provider].purest.data(body) : undefined
              }
            }
            next()
          })
      } else {
        next()
      }
    }
  }

  function updateUsersProviders (req, res, next) {
    var userId = req.session.user.id
    var provider = req.session.oauth.provider
    var providerUserId = req.session.oauth.id
    var data = req.session.oauth.data

    var query = `
      INSERT INTO oauth.users_providers VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, provider, provider_user_id)
      DO UPDATE SET
        data = EXCLUDED.data;
    `

    executeQuery(query, [userId, provider, providerUserId, data], (err, result) => {
      if (err) {
        send500(res, err)
        return
      }

      next()
    })
  }

  function mergeUsers (req, res, next) {
    if (!(req.session.user && req.session.oauth)) {
      next()
      return
    }

    var userId = req.session.user.id
    var provider = req.session.oauth.provider
    var providerUserId = req.session.oauth.id

    var getSameProviderQuery = `
      SELECT user_id
      FROM oauth.users_providers
      WHERE
        provider = $1 AND
        provider_user_id = $2 AND
        user_id != $3;
    `

    executeQuery(getSameProviderQuery, [provider, providerUserId, userId], (err, result) => {
      if (err) {
        send500(res, err)
        return
      }

      if (result.rows.length) {
        var oldUserIds = result.rows.map((row) => row.user_id)

        var updateUsersSessionsQuery = `
          UPDATE oauth.users_sessions
          SET user_id = $1
          WHERE user_id = ANY($2);
        `

        var mergeOldUsersProvidersQuery = `
          INSERT INTO oauth.users_providers (user_id, provider, provider_user_id, data)
            SELECT $1, provider, provider_user_id, data
            FROM oauth.users_providers
            WHERE user_id = ANY($2)
          ON CONFLICT (user_id, provider, provider_user_id)
            DO NOTHING;
        `

        var deleteOldUsersQuery = `
          DELETE FROM oauth.users
          WHERE id = ANY($1);
        `

        updateUserIds(oldUserIds, userId, (err) => {
          if (err) {
            send500(res, err)
            return
          }

          executeQuery(updateUsersSessionsQuery, [userId, oldUserIds], (err, result) => {
            if (err) {
              send500(res, err)
              return
            }

            executeQuery(mergeOldUsersProvidersQuery, [userId, oldUserIds], (err, result) => {
              if (err) {
                send500(res, err)
                return
              }

              executeQuery(deleteOldUsersQuery, [oldUserIds], (err, result) => {
                if (err) {
                  send500(res, err)
                  return
                }

                updateUsersProviders(req, res, next)
              })
            })
          })
        })
      } else {
        updateUsersProviders(req, res, next)
      }
    })
  }

  function backToApp (req, res) {
    res.redirect(req.session.callbackUrl)
  }

  app.get('/oauth/callback', getUserInfo, mergeUsers, function (req, res) {
    backToApp(req, res)
  })

  return app
}
