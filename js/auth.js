// ================================================================
// Supabase 客户端 + 鉴权工具
// ================================================================
const { createClient } = supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// 小朋友没有邮箱: 输入用户名, 前端自动拼装成假邮箱
// e.g. "xiaobao" -> "xiaobao@ktasks.local"
function normalizeLogin(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase();
  // 用户名: 只保留字母数字下划线, 转小写
  const clean = s.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return clean + "@ktasks.local";
}

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function getProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("user_id, family_id, role, display_name")
    .eq("user_id", session.user.id)
    .single();
  if (error) {
    console.warn("getProfile error", error);
    return null;
  }
  return data;
}

async function requireAuth(redirectTo = "login.html") {
  const session = await getSession();
  if (!session) {
    location.href = redirectTo;
    return null;
  }
  const profile = await getProfile();
  if (!profile) {
    await sb.auth.signOut();
    location.href = redirectTo;
    return null;
  }
  return { session, profile };
}

async function signOut() {
  await sb.auth.signOut();
  location.href = "login.html";
}

async function signUpParent({ email, password, familyName, displayName }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        family_name: familyName,
        display_name: displayName || "家长",
      },
    },
  });
  if (error) throw error;
  return data;
}

async function signUpJoin({ email, password, joinCode, displayName, role }) {
  const { data, error } = await sb.auth.signUp({
    email: normalizeLogin(email),
    password,
    options: {
      data: {
        join_code: joinCode,
        display_name: displayName || "成员",
        role: role || "kid",
      },
    },
  });
  if (error) throw error;
  return data;
}

async function signIn({ email, password }) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: normalizeLogin(email),
    password,
  });
  if (error) throw error;
  return data;
}

async function getFamilyInfo() {
  const { data, error } = await sb
    .from("families")
    .select("id, name, join_code")
    .single();
  if (error) {
    console.warn("getFamilyInfo error", error);
    return null;
  }
  return data;
}

async function getFamilyMembers() {
  const { data, error } = await sb
    .from("profiles")
    .select("user_id, display_name, role, created_at")
    .order("created_at");
  if (error) {
    console.warn("getFamilyMembers error", error);
    return [];
  }
  return data || [];
}

async function rotateJoinCode() {
  const { data, error } = await sb.rpc("rotate_join_code");
  if (error) throw error;
  return data;
}

window.sb = sb;
window.Auth = {
  getSession, getProfile, requireAuth, signOut,
  signUpParent, signUpJoin, signIn,
  getFamilyInfo, getFamilyMembers, rotateJoinCode,
};
