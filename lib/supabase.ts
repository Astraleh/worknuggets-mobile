import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.EXPO_PUBLIC_SUPA_URL!;
const SUPA_PUBLISH_API_KEY = process.env.EXPO_PUBLIC_SUPA_PUBLISH_API_KEY!;

if (!SUPA_URL) console.error("❌ Missing SUPABASE_URL");
if (!SUPA_PUBLISH_API_KEY) console.error("❌ Missing SUPABASE_PUBLISH_KEY");

export const supabase = createClient(SUPA_URL, SUPA_PUBLISH_API_KEY);
