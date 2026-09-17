import { isAuth, signOut } from "./auth.js"

const loginButton = document.getElementById("login-button");

const loggedIn = await isAuth();
if(loggedIn) {
    if(!loginButton) return;
    loginButton.textContent = "Sign Out";
    loginButton.href = "#";
    loginButton.addEventListener("click", async (event) => {
            event.preventDefault();

            const success = await signOut();

            if(success) window.location.replace("/login.html");
    });
}


