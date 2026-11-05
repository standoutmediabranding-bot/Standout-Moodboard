// Paste your Supabase project values here (Project Settings -> API).
// The anon key is safe to ship in the browser; access is controlled by login + the policies in setup.sql.
window.CONFIG = {
  SUPABASE_URL: "https://tpildkammrydgaubgzol.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwaWxka2FtbXJ5ZGdhdWJnem9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MzU1MTEsImV4cCI6MjEwOTAxMTUxMX0.Izil1A-FxAkiYnLQ-abxI1CeZAxP1CXi3enDUHNe7d4",
  MAX_FILE_MB: 50, // Supabase free plan caps uploads at 50 MB per file
  VAPID_PUBLIC_KEY: "BD7TLlrEvZmqVSiHAKXVjnVL2u-gZvc5SRNl7wa_jG87R8teIF7GYSB7zLiadN3PkzU5SUUGphtId8B9PFIyaDc", // for phone notifications; the public half of the key pair (the private half goes in Supabase, never here)
};
