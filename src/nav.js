import { supabase } from "./supabase.js"

// Shows the signed-in user's name + a logout button in the top nav bar.
// Included on every page that has <nav class="topnav">.

async function renderAuthNav() {
    const nav = document.querySelector(".topnav");
    if (!nav) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", user.id)
        .single();

    const name = profile ? `${profile.first_name} ${profile.last_name}` : user.email;

    const loginLink = nav.querySelector("a.login-btn");
    loginLink?.remove();

    const nameEl = document.createElement("span");
    nameEl.className = "nav-user";
    nameEl.textContent = name;

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn btn-sm logout-btn";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async function() {
        await supabase.auth.signOut();
        window.location.href = "index.html";
    });

    nav.append(nameEl, logoutBtn);
}

renderAuthNav();
