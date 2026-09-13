// Paste your two Supabase values here.
// Supabase dashboard -> Project Settings -> API
//
// These two are SAFE to publish. The anon key only works together with the
// Row Level Security rules in supabase-schema.sql, which stop one user from
// reading another user's rows.
//
// Your AI provider key is NOT safe to publish, which is why it lives on the
// server in api/chat.js instead of in this file.

export const SUPABASE_URL = "https://szilwgcvbjwglxkwktwr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_bQLLF22pwSXawOdiWTdY3Q_21RHGyzm";

// Used by the "Look around with the demo account" button.
// Create this user once in Supabase -> Authentication -> Users -> Add user.
export const DEMO_EMAIL = "demo@rehearse.app";
export const DEMO_PASSWORD = "demo1234";
