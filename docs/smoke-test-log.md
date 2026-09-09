 # FitPortal — Smoke Test Log
> Run after every merge to main. Record date, tester and results.

---

## Run 01
Date: 26/08/2026
Tester: Shreyas R
Branch: main
Deployment: Local (npx serve .)

| Test | Steps | Expected | Result | Notes |
|------|-------|----------|--------|-------|
| Home page loads | Open site URL | Page renders with no errors | Pass | |
| Navigation links work | Click Home, Orders, Integrations, About | Each page loads correctly | Pass | |
| Orders page loads | Navigate to /orders | Order queue displays | Pass | |
| Order details open | Click on an order | Details page loads | Pass | |
| View in 3D button visible | Open a solved order | Button is present | Pass | |
| CSV upload visible | Go to orders page | Import section visible | Pass | |
| No broken links | Click every link on every page | No 404 errors | Pass | |
| Mobile view works | Resize browser or use devtools | Layout adjusts correctly | Pass | |

Overall: All Pass

---

## Run 02
Date: 26/08/2026
Tester: Shreyas R
Branch: main
Deployment: Live (Vercel)

| Test | Steps | Expected | Result | Notes |
|------|-------|----------|--------|-------|
| Home page loads | Open site URL | Page renders with no errors | Pass | |
| Navigation links work | Click Home, Orders, Integrations, About | Each page loads correctly | Pass | |
| Orders page loads | Navigate to /orders | Order queue displays | Pass | |
| Order details open | Click on an order | Details page loads | Pass | Fixed with vercel.json cleanUrls |
| View in 3D button visible | Open a solved order | Button is present | Pass | |
| CSV upload visible | Go to orders page | Import section visible | Pass | |
| No broken links | Click every link on every page | No 404 errors | Pass | |
| Mobile view works | Resize browser or use devtools | Layout adjusts correctly | Pass | |

Overall: All Pass

---

## Run 03
Date:
Tester:
Branch:
Deployment:

| Test | Steps | Expected | Result | Notes |
|------|-------|----------|--------|-------|
| Home page loads | Open site URL | Page renders with no errors | | |
| Navigation links work | Click Home, Orders, Integrations, About | Each page loads correctly | | |
| Orders page loads | Navigate to /orders | Order queue displays | | |
| Order details open | Click on an order | Details page loads | | |
| View in 3D button visible | Open a solved order | Button is present | | |
| CSV upload visible | Go to orders page | Import section visible | | |
| No broken links | Click every link on every page | No 404 errors | | |
| Mobile view works | Resize browser or use devtools | Layout adjusts correctly | | |

Overall: