# Frontend (Messages UI)

Pure static site - HTML/CSS/JS, koi build step nahi, koi backend code nahi.
Kisi bhi static host pe deploy ho sakta hai: Vercel, Netlify, S3+CloudFront,
nginx, ya sirf `python3 -m http.server` se local test.

## Files
- `index.html` - structure
- `style.css` - saara design
- `app.js` - saara behavior, backend ko sirf `fetch()` se HTTP calls karta hai
- `config.js` - **yahan backend ka URL set karo** (sirf ek jagah)

## Backend se connect karna

`config.js` khol ke `API_BASE` change karo:
```js
const API_BASE = window.MESSAGES_API_BASE || 'https://your-backend.onrender.com';
```

## Local run
```bash
python3 -m http.server 5500
# ya
npx serve .
```
Fir `backend/.env` me `ALLOWED_ORIGIN=http://localhost:5500` set karke backend chalao.

## Important
Agar frontend aur backend **alag domains** pe hain (jaise frontend Vercel pe, backend Render pe),
to backend ke `.env` me `COOKIE_SAME_SITE=none` set karna hoga, aur backend **HTTPS pe hi** chalna
chahiye (Render automatically HTTPS deta hai) - warna browser login cookie ko block kar dega.
