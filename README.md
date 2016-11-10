# express-pg-oauth

Express middleware for OAuth authentication with a PostgreSQL backend, built on:

- https://github.com/expressjs/express
- https://github.com/expressjs/session
- https://github.com/voxpelli/node-connect-pg-simple
- https://github.com/simov/grant
- https://github.com/simov/purest

Currently, is used by NYPL's [brick-by-brick](https://github.com/nypl-spacetime/brick-by-brick), a simple JSON API for crowdsourcing tasks.

express-pg-oauth assigns a new user ID for each new session, but merges user IDs when it finds out that multiple sessions belong to the same user. When uses log in using one of the available OAuth providers (Google, Twitter, Facebook and GitHub by default, but it's very easy to add more), the OAuth credentials are stored, enabling the module to identify when this merging needs to happen.

Note: __express-pg-oauth user IDs are not stable__, they change when users sign in to the same OAuth provider from different sessions. Each time this happens, express-pg-oauth calls a function, see the section below for details.

## Installation & usage

To use express-pg-oauth in your Express project, run `npm install`:

    npm install --save nypl-spacetime/express-pg-oauth

Afterwards, run the SQL queries in [`oauth-tables.sql`](oauth-tables.sql) in the database you are going to use for your project.

Now, you can set your Express app to use express-pg-oauth as middleware:

```js
app.use(oauth(config, updateUserIds))
```

express-pg-oauth expects to parameters:

  1. A configuration object, with the OAuth keys and secrets of the OAuth providers to be used, as well as a PostgreSQL connection string, your servers hostname and the URL and name of your app
  2. A callback function which is called when user IDs need to be updated

```js
const PORT = process.env.PORT
var express = require('express')
var app = express()
var oauth = require('./index')

var config = {
  server: {
    host: 'oauth-test.dev',
    secret: 'OAUTH_TEST12345'
  },
  database: {
    url: 'postgres://postgres:postgres@localhost/oauth-test'
  },

  // OAuth providers:
  twitter: {
    key: 'twitter_key',
    secret: 'twitter_secret'
  },
  facebook: {
    key: 'facebook_key',
    secret: 'facebook_secret'
  },
  google: {
    key: 'google_key',
    secret: 'google_secret'
  },
  github: {
    key: 'github_key',
    secret: 'github_secret'
  }
}

function updateUserIds (oldUserIds, newUserId, callback) {
  // Here, update your database, change all occurrences of oldUserIds to newUserId
  callback()
}

app.use(oauth(config, updateUserIds))

app.listen(PORT, () => {
  console.log(`express-pg-oauth listening on port ${PORT}!`)
})
```

### Usage with JSON API from web client

If you're using [`fetch`](https://developers.google.com/web/updates/2015/03/introduction-to-fetch), you should include the `credentials: 'include'` option:

```js
fetch(apiUrl + 'oauth/disconnect', {
  credentials: 'include'
})
```

## OAuth Providers

express-pg-oauth uses [Grant](https://github.com/simov/grant) for all things OAuth. By default, express-pg-oauth uses Google, Twitter, Facebook and GitHub as OAuth providers, but it's easy to add more: just edit [`config.js`](config.js) and add keys and secrets for the new provider(s) in your configuration JSON file as well.

### Google

https://console.developers.google.com/projectselector/apis/library

Set callback URL to http://hostname/oauth/callback/google

### Twitter

https://apps.twitter.com/

Set callback URL to http://hostname/oauth/callback/twitter

### Facebook

https://developers.facebook.com/apps/

Set callback URL to http://hostname/oauth/callback/facebook

### GitHub

https://github.com/settings/developers

Set callback URL to http://hostname/oauth/callback/github

## Example

This example uses [Hotel](https://github.com/typicode/hotel) to map `localhost:port` addresses to local `.dev` domains. Some OAuth providers (Facebook, for example) do not accept `localhost` as valid app domains, Hotel helps solving this problem.

First, install [Hotel](https://github.com/typicode/hotel) and make sure you have created all the necessary OAuth apps.

Then, clone this repository:

    git clone https://github.com/nypl-spacetime/express-pg-oauth.git

Install Node.js dependencies:

    cd express-pg-oauth
    npm install

Go to the `example` directory:

    cd example

Add a Hotel server for the example `server.js`:

    hotel add -n oauth-test 'nodemon --watch ./ --watch ./../ server.js --config path_to_configuration_yaml_or_json' -o oauth.log

Add a Hotel server for the example web app:

    hotel add -n oauth-test-app 'python -m SimpleHTTPServer $PORT'

Now, an example server is running on http://oauth-test.dev/oauth, and the example web client is available on http://oauth-test-app.dev/.
