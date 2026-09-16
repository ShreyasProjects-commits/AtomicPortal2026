import { supabase } from "./supabase.js"

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginPanel = document.getElementById('login-panel');
const signupPanel = document.getElementById('signup-panel');
const showSignup = document.getElementById('show-signup');
const showLogin = document.getElementById('show-login');
const loginError = document.getElementById('login-error');
const signupError = document.getElementById('signup-error');

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

signupForm?.addEventListener("submit", async function(event) {
    event.preventDefault();
    signupError.hidden = true;

    const email = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("signup-confirm-password").value;
    const role = document.getElementById("signup-role").value;

    if (password !== confirmPassword) {
        signupError.textContent = "Passwords do not match.";
        signupError.hidden = false;
        return;
    }

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: { role: role },
        },
    })
    if (error) {
        console.error(error);
        signupError.textContent = error.message;
        signupError.hidden = false;
        return;
    }
})