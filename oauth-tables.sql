CREATE SCHEMA oauth;

CREATE TABLE oauth.sessions (
  sid character varying NOT NULL,
  sess json NOT NULL,
  expire timestamp(6) without time zone NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (sid)
);

CREATE SEQUENCE oauth.users_id_seq
  INCREMENT 1
  MINVALUE 1
  MAXVALUE 9223372036854775807
  START 1
  CACHE 1;

CREATE TABLE oauth.users (
  id integer NOT NULL DEFAULT nextval('oauth.users_id_seq'::regclass),
  admin boolean NOT NULL DEFAULT false,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE oauth.users_sessions (
  user_id integer NOT NULL,
  session_id character varying REFERENCES oauth.sessions (sid) ON DELETE CASCADE,
  CONSTRAINT users_sessions_pkey PRIMARY KEY (user_id, session_id)
);

CREATE TABLE oauth.users_providers (
  user_id integer REFERENCES oauth.users ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  data json,
  CONSTRAINT users_providers_pkey PRIMARY KEY (user_id, provider, provider_user_id)
);
