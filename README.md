# cf_ai_answer_copilot

A simple AI-powered web app that helps CS students write better internship and job application answers.

You can save a short profile about yourself and generate tailored responses to application questions based on your background, tone, and word count preferences.

**Live demo:** https://cf-ai-answer-copilot.pages.dev/

---

## How it works
- Frontend UI built with plain HTML, CSS, and JavaScript
- Backend built with Cloudflare Workers
- Uses Workers AI (Llama 3.3) to generate responses
- Uses Durable Objects to store user profile and recent chat history

---

## Tech stack
- Cloudflare Workers
- Workers AI (Llama 3.3)
- Durable Objects (SQLite-backed)
- Cloudflare Pages
- Vanilla HTML / CSS / JS

---

## Local development
1. Clone the repo
2. Run the Worker:
   ```bash
   cd api
   npx wrangler dev

## Screenshot
<img width="1917" height="997" alt="cf-ai" src="https://github.com/user-attachments/assets/19b07826-305a-4cc7-8d92-78e8b9632fb8" />
