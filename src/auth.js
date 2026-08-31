import { supabase } from "./supabase.js"

const form = document.getElementById('login-form');


form.addEventListener("submit", async function(event) {
    event.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
    })
    if(error) {
        console.error(error);
        return;
    }
})