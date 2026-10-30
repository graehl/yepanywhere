export const PUBLIC_SERVER_IDENTITY_SCHEMA = `
CREATE TABLE public_server_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  server_id TEXT NOT NULL
);
`;
