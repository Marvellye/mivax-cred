# MivaX

**MivaX** is the open-source backend infrastructure for **Miva Open University** students. It provides a robust, high-performance API that bridges both the **LMS (Moodle)** and the **SIS (Student Information System)** into a single, unified interface.

It uses a **Hybrid Architecture**:

- **Heavy (Playwright):** Used only for authentication to handle complex redirects and session generation.
- **Light (Axios + Cheerio):** Used for all data-fetching routes to ensure sub-second response times and minimal CPU/Memory overhead.

---

## 🚀 Getting Started

### Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Marvellye/mivax-cred.git
   cd mivax-cred
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Install Browser Engine**:
   ```bash
   npx playwright install chromium
   ```
4. **Start the server**:
   ```bash
   node index.js
   ```
   _The server will run on `http://localhost:3000`_

---

## 📬 Testing with Postman

We have provided a fully configured Postman collection to help you get started in seconds.

1. Import `MivaX.postman_collection.json` into Postman.
2. Go to the **Variables** tab in the collection.
3. Set your `email`, `password`, and `baseUrl` (http://localhost:3000).
4. Run the **Login** request to get a `sessionId`.
5. The collection is configured to automatically use that `sessionId` for all other requests.

---

## 🛠️ API Reference

### 1. Authentication

#### `POST /login`

Authenticates with Miva LMS/SIS and returns a `sessionId`.

- **Body**: `{ "email": "...", "password": "..." }`
- **Returns**: `{ "sessionId": "UUID" }`
- **Note**: This is the only route that launches a browser (Playwright). It takes ~15-30s.

---

### 2. Student (SIS) Data

These routes fetch data directly from the Student Information System backend.

#### `GET /user/:sessionId`

Returns the student's full profile, biography, and contact details.

#### `GET /student/academic-summary/:sessionId`

Returns overall performance stats: **CGPA**, **Degree Class**, and Total Credits.

#### `GET /student/academic-levels/:sessionId`

Lists all academic levels (100L, 200L, etc.) with completion status and dates.

#### `GET /student/transcript/:sessionId`

Returns a **Full Transcript** containing all levels, semesters, and every course result ever recorded.

#### `GET /student/transcript/:level/:sessionId`

Returns a detailed transcript for a **specific level** (e.g., `200_LEVEL`).

#### `GET /student/current-courses/:sessionId`

Returns only the courses the student is **currently** enrolled in for the active semester.

#### `GET /payment-records/:sessionId`

Returns a paginated list of all financial transactions and payment history.

#### `GET /notifications/:sessionId`

Returns student-specific notifications from the university.

#### `GET /dashboard/:sessionId`

Returns the **Raw SIS Dashboard** JSON (very heavy, use specialized routes above for performance).

---

### 3. LMS (Course) Data

These routes interact with the Learning Management System (Moodle).

#### `GET /courses/:sessionId`

Lists all courses currently visible on the LMS dashboard with progress indicators.

#### `GET /course/:id/:sessionId`

Returns the internal structure of a course, including all sections and modules.

#### `GET /mod/:type/:id/:sessionId`

Fetches the content for a specific module (Video URLs, HTML Content, Quiz metadata).

- **Types**: `page`, `quiz`, `assign`, `forum`, `url`.

#### `GET /img/:base64url/:sessionId`

An authenticated proxy to fetch LMS images without CORS issues.

---

## 🏗️ Architecture

| Layer          | Component          | Role                                                 |
| :------------- | :----------------- | :--------------------------------------------------- |
| **Route**      | `src/routes/`      | Express route definitions                            |
| **Controller** | `src/controllers/` | Request handling & response formatting               |
| **Service**    | `src/services/`    | Business logic (Scraping, Parsing, Token Management) |
| **Storage**    | `sessions/`        | Local JSON files storing encrypted session state     |

---

## 📜 License

Released under the **MIT License**. Built with ❤️ for the Miva Student Developer Community.
