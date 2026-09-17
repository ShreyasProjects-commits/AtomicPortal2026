import { supabase } from "./supabase.js"

const loginForm = document.getElementById('login-form');
const loginPanel = document.getElementById('login-panel');
const showLogin = document.getElementById('show-login');
const loginError = document.getElementById('login-error');

showSignup?.addEventListener("click", function(event) {
    event.preventDefault();
    loginPanel.hidden = true;
    signupPanel.hidden = false;
});

showLogin?.addEventListener("click", function(event) {
    event.preventDefault();
    signupPanel.hidden = true;
    loginPanel.hidden = false;
});

loginForm.addEventListener("submit", async function(event) {
    event.preventDefault();
    loginError.hidden = true;

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
    })
    if(error) {
        console.error(error);
        loginError.textContent = error.message;
        loginError.hidden = false;
        return;
    }
})

// MOVE INTO ADMIN DASHBOARD
// signupForm?.addEventListener("submit", async function(event) {
//     event.preventDefault();
//     signupError.hidden = true;

//     const email = document.getElementById("signup-email").value;
//     const password = document.getElementById("signup-password").value;
//     const confirmPassword = document.getElementById("signup-confirm-password").value;
//     const role = document.getElementById("signup-role").value;

//     if (password !== confirmPassword) {
//         signupError.textContent = "Passwords do not match.";
//         signupError.hidden = false;
//         return;
//     }

//     const { data, error } = await supabase.auth.signUp({
//         email: email,
//         password: password,
//         options: {
//             data: { role: role },
//         },
//     })
//     if (error) {
//         console.error(error);
//         signupError.textContent = error.message;
//         signupError.hidden = false;
//         return;
//     }
// })

// Returns the current user object, null if not authenticated.
export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if(!user || error) return null;
    return user;
}

// Checks authentication, returns true if signed in, false otherwise.
export async function isAuth() {
    const user = await getCurrentUser();
    return user != null;
}

// Checks authentication, redirects to home if not signed in.
export async function requireAuth() {
    const authenticated = await isAuth();
    if(!authenticated) {
        window.location.replace("/login.html");
    }
    return;
}

// Checks authorisation, returns true if user is correct role, false otherwise.
export async function requireRole(requiredRole) {
    const user = await getCurrentUser();
    if(!user) return false;

    const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

    if(error || !data) return false;

    const role = data.role;

    return role === requiredRole;
}

// Signs out the current user, true if successful, false otherwise.
export async function signOut() {
    const { error } = await supabase.auth.signOut();

    if(error) {
        console.error(error);
        return false;
    }
    return true;
}