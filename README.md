# 🚀 MivaX: The Open Source Miva Student API 🎓

[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.x-blue.svg)](https://nodejs.org/)
[![Status: Open Source](https://img.shields.io/badge/Status-Open%20Source-green.svg)](#contributing-is-power-)
[![Built For: Students](https://img.shields.io/badge/Built%20For-Students-orange.svg)](#)

**MivaX** is a powerful, student-built backend infrastructure designed for the **Miva Open University** community. It bridges the gap between the **LMS (Moodle)** and the **SIS (Student Information System)**, providing a unified, high-performance API for building the next generation of campus tools.

---

## 🏗️ Hybrid Architecture

We combine two worlds to give you the best performance:

- 🏎️ **Light Layer (Axios + Cheerio):** 95% of data routes. Pure HTTP fetching and lightning-fast HTML parsing.
- 🤖 **Heavy Layer (Playwright):** Only used for the initial secure login to bypass complex redirects and capture session state.

> **Result:** Sub-second response times for courses, grades, and profiles after the initial login!

---

## 🚦 Quick Start

### 1. ⚙️ Setup Environment
```bash
# Clone the vision
git clone https://github.com/Marvellye/mivax-cred.git
cd mivax-cred

# Install components
npm install

# Setup the browser engine
npx playwright install chromium
```

### 2. ⚡ Launch Server
```bash
node index.js
```
_MivaX will be live at `http://localhost:3000`_ 🚀

---

## 📬 Testing with Postman

We want you to start building **immediately**. We've included a professional Postman collection in the root:

1. 📥 Import `MivaX.postman_collection.json` into Postman.
2. 🔑 Set your `email` and `password` in the **Variables** tab.
3. 🏃‍♂️ Run the **Login** request.
4. 🪄 All other routes will automatically use the generated `sessionId`!

---

## 🛠️ API Reference

### 🔐 1. Authentication
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/login` | Securely exchange credentials for a session UUID. |

### 👨‍🎓 2. Student (SIS) Data
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/user/:sessionId` | Full profile, biography & contact info. |
| `GET` | `/student/academic-summary/:sessionId` | **CGPA**, Degree Class, and Credits summary. |
| `GET` | `/student/transcript/:sessionId` | **Full Transcript** (100L - 400L) in one request. |
| `GET` | `/student/current-courses/:sessionId` | Only currently active semester courses. |
| `GET` | `/payment-records/:sessionId` | Full financial transaction history. |
| `GET` | `/notifications/:sessionId` | Real-time university notifications. |

### 📚 3. LMS (Course) Data
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/courses/:sessionId` | Dashboard course list with progress. |
| `GET` | `/course/:id/:sessionId` | Course structure (sections, modules, files). |
| `GET` | `/mod/:type/:id/:sessionId` | Content details (Video URLs, HTML, Quizzes). |
| `GET` | `/img/:base64url/:sessionId` | Authenticated proxy for LMS images. |

---

## 🤝 Contributing is Power! 🌟

**MivaX belongs to you.** We believe student-led innovation is the fastest way to improve our university experience.

- 🐛 **Found a bug?** Open an Issue.
- ✨ **Have an idea for a route?** Fork and PR.
- 🛠️ **Want to help?** Check our open issues!

Whether you're a Software Engineering student or just curious about APIs, your contribution matters. Let's build something amazing for Miva together!

---

## 📁 Repository Structure

| Layer | Component | Role |
| :--- | :--- | :--- |
| 🛣️ **Route** | `src/routes/` | Express route definitions |
| 🎮 **Controller** | `src/controllers/` | Request logic & formatters |
| ⚙️ **Service** | `src/services/` | Scraping, Parsing & Session Magic |
| 📂 **Storage** | `sessions/` | Encrypted local session persistence |

---

## ⚠️ Disclaimer

**MivaX is for educational purposes only.** It is intended as a tool for student developers to learn about API architecture, web scraping, and modular backend design. Please use this tool responsibly and in accordance with Miva Open University's policies regarding data access and privacy.

---

## 📜 License & Ethics

Released under the **MIT License**.
_Built with ❤️ for the Miva Student Developer Community. For students, by students._
