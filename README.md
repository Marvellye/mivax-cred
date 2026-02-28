# Miva LMS Scraper API

A hybrid scraper API for the **Miva University LMS** (Moodle-based). It uses **Playwright** for robust browser-based authentication and **Axios + Cheerio** for fast, lightweight data extraction.

**Base URL (Production):** `https://mivax-cred.onrender.com`  
**Base URL (Local):** `http://localhost:3000`

---

## Architecture

| Path      | Technology                     | Purpose                                                       |
| --------- | ------------------------------ | ------------------------------------------------------------- |
| **Heavy** | Playwright (headless Chromium) | Login — handles redirects, JS-rendered pages, session capture |
| **Light** | Axios + Cheerio                | All data routes — direct HTTP + HTML parsing, ~20× faster     |

Sessions are stored as JSON files in `./sessions/` on the server. Each file holds the Moodle cookies required to authenticate subsequent requests.

---

## Routes Overview

| Method | Endpoint                     | Description                               |
| ------ | ---------------------------- | ----------------------------------------- |
| `GET`  | `/`                          | Health check                              |
| `POST` | `/login`                     | Authenticate and get a `sessionId`        |
| `GET`  | `/courses/:sessionId`        | List all enrolled courses                 |
| `GET`  | `/course/:id/:sessionId`     | Get course structure (sections + modules) |
| `GET`  | `/mod/:type/:id/:sessionId`  | Get content for a specific module         |
| `GET`  | `/img/:base64url/:sessionId` | Image proxy (bypasses Moodle CORS)        |

---

## Endpoints

### `GET /`

Health check. Returns a plain text confirmation that the server is running.

**Response:**

```
Miva LMS Scraper API is running!
```

---

### `POST /login`

Authenticates with the Miva LMS using a headless browser. On success, saves the session cookies to disk and returns a `sessionId` token used for all subsequent requests.

> ⚠️ This route can take **15–45 seconds** due to the Playwright browser launch and page load.

**Request Body:**

```json
{
  "username": "student@miva.university",
  "password": "yourpassword"
}
```

**Success Response `200`:**

```json
{
  "sessionId": "5c0a3d18-004f-4279-8523-0c682339637d"
}
```

**Error Response `500` — wrong credentials:**

```json
{
  "error": "Incorrect email or password"
}
```

---

### `GET /courses/:sessionId`

Fetches the student's full list of enrolled courses using the Moodle AJAX service (`theme_remui_get_myoverviewcourses`). Sorted by last access (most recent first).

**Path Parameters:**

| Param       | Type     | Description                       |
| ----------- | -------- | --------------------------------- |
| `sessionId` | `string` | Token returned from `POST /login` |

**Success Response `200`:**

```json
{
  "courses": [
    {
      "id": 673,
      "fullname": "MIVA-SEN 403 - Software Reverse Engineering",
      "shortname": "MIVA-SEN 403",
      "summary": "<p>This course introduces students to...</p>",
      "activitydata": "4 out of 84 activities completed",
      "viewurl": "https://lms.miva.university/course/view.php?id=673",
      "courseimage": "https://mivax-cred.onrender.com/img/aHR0cHM6Ly8.../5c0a3d18-004f-4279-8523-0c682339637d"
    }
  ]
}
```

> 📌 `courseimage` is automatically routed through the image proxy so it loads without CORS issues on any client.

**Field Reference:**

| Field          | Type     | Description                         |
| -------------- | -------- | ----------------------------------- |
| `id`           | `number` | Moodle course ID                    |
| `fullname`     | `string` | Full course title                   |
| `shortname`    | `string` | Course code                         |
| `summary`      | `string` | HTML course description             |
| `activitydata` | `string` | Human-readable completion progress  |
| `viewurl`      | `string` | Direct link to the course on Moodle |
| `courseimage`  | `string` | Proxied course banner image URL     |

---

### `GET /course/:id/:sessionId`

Fetches the full internal structure of a course: metadata, instructor info, completion progress, and a nested list of sections/modules.

**Path Parameters:**

| Param       | Type     | Description                        |
| ----------- | -------- | ---------------------------------- |
| `id`        | `string` | Moodle course ID (from `/courses`) |
| `sessionId` | `string` | Token returned from `POST /login`  |

**Success Response `200`:**

```json
{
  "id": "673",
  "title": "Software Reverse Engineering",
  "category": "Software Engineering",
  "backgroundImage": "https://mivax-cred.onrender.com/img/aHR0cHM6Ly8.../5c0a3d18-004f-4279-8523-0c682339637d",
  "description": "This course introduces students to reverse engineering techniques...",
  "instructors": ["Dr. Jane Doe"],
  "progress": "4%",
  "sections": [
    {
      "id": "1234",
      "name": "Week 1: Introduction to Reverse Engineering",
      "modules": [
        {
          "id": "5678",
          "type": "page",
          "name": "Introduction Slides",
          "url": "https://lms.miva.university/mod/page/view.php?id=5678",
          "isCompleted": true
        },
        {
          "id": "5679",
          "type": "quiz",
          "name": "Week 1 Quiz",
          "url": "https://lms.miva.university/mod/quiz/view.php?id=5679",
          "isCompleted": false
        }
      ]
    }
  ]
}
```

**Field Reference — Top Level:**

| Field             | Type               | Description                                |
| ----------------- | ------------------ | ------------------------------------------ |
| `id`              | `string`           | Course ID (echoed from request)            |
| `title`           | `string`           | Course title from the page header          |
| `category`        | `string`           | Faculty/department badge                   |
| `backgroundImage` | `string` \| `null` | Proxied course header image                |
| `description`     | `string`           | Plain-text course summary                  |
| `instructors`     | `string[]`         | Deduplicated list of instructor names      |
| `progress`        | `string`           | Completion percentage string (e.g. `"4%"`) |
| `sections`        | `Section[]`        | Ordered list of course sections            |

**Field Reference — `Section`:**

| Field     | Type       | Description                               |
| --------- | ---------- | ----------------------------------------- |
| `id`      | `string`   | Section ID                                |
| `name`    | `string`   | Section title                             |
| `modules` | `Module[]` | Ordered list of activities in the section |

**Field Reference — `Module`:**

| Field         | Type      | Description                                                                 |
| ------------- | --------- | --------------------------------------------------------------------------- |
| `id`          | `string`  | Module/activity ID                                                          |
| `type`        | `string`  | One of: `page`, `quiz`, `url`, `forum`, `assignment`, `feedback`, `unknown` |
| `name`        | `string`  | Activity name (suffix labels stripped)                                      |
| `url`         | `string`  | Direct Moodle link to the activity                                          |
| `isCompleted` | `boolean` | Whether the activity is marked done                                         |

---

### `GET /mod/:type/:id/:sessionId`

Fetches content details for a specific module/activity. The response shape varies by `type`.

**Path Parameters:**

| Param       | Type     | Description                                                       |
| ----------- | -------- | ----------------------------------------------------------------- |
| `type`      | `string` | Module type: `page`, `quiz`, `url`, `assign`, `forum`, `feedback` |
| `id`        | `string` | Module ID (from `/course` response)                               |
| `sessionId` | `string` | Token returned from `POST /login`                                 |

---

#### Response — `type: page` or `type: url`

```json
{
  "id": "5678",
  "title": "Introduction Slides",
  "type": "page",
  "iframes": [
    {
      "src": "https://player.vimeo.com/video/123456789",
      "title": "Week 1 Lecture",
      "width": "800",
      "height": "450"
    }
  ],
  "contentHtml": "<div><p>Full HTML content of the page...</p></div>",
  "navigation": {
    "prev": { "type": "quiz", "id": "5677" },
    "next": { "type": "url", "id": "5679" }
  }
}
```

> 📌 `contentHtml` is only present for `type: page`. `type: url` returns `iframes` only.

#### Response — `type: quiz`

```json
{
  "id": "5679",
  "title": "Week 1 Quiz",
  "type": "quiz",
  "description": "This quiz covers the fundamentals of binary analysis.",
  "quizInfo": ["Time limit: 30 minutes", "Attempts allowed: 2"],
  "status": "available",
  "navigation": {
    "prev": { "type": "page", "id": "5678" },
    "next": null
  }
}
```

**Field Reference — `type: quiz`:**

| Field         | Type       | Description                              |
| ------------- | ---------- | ---------------------------------------- |
| `description` | `string`   | Activity description text                |
| `quizInfo`    | `string[]` | Time limits, attempt rules, etc.         |
| `status`      | `string`   | `"available"` or `"locked_or_completed"` |

**Field Reference — `navigation` (all types):**

| Field  | Type                     | Description                     |
| ------ | ------------------------ | ------------------------------- |
| `prev` | `{ type, id }` \| `null` | Previous activity in the course |
| `next` | `{ type, id }` \| `null` | Next activity in the course     |

---

### `GET /img/:base64url/:sessionId`

An authenticated image proxy. **All image URLs returned by this API already point here** — you do not need to call this route manually.

**How it works:**

1. Decodes the `base64url` parameter back to the original Moodle image URL
2. Loads the session cookies from `sessionId`
3. Fetches the image from Moodle with auth headers
4. Streams the image back to the client with the correct `Content-Type`
5. Caches the response for **24 hours** (`Cache-Control: public, max-age=86400`)

**To manually construct a proxy URL** (e.g. on the frontend):

```js
const originalUrl =
  "https://lms.miva.university/pluginfile.php/.../course-image.jpg";
const proxyUrl = `https://mivax-cred.onrender.com/img/${btoa(originalUrl)}/${sessionId}`;
```

**Error Responses:**

| Status | Body                                                     | Cause                                 |
| ------ | -------------------------------------------------------- | ------------------------------------- |
| `400`  | `{ "error": "Invalid image URL" }`                       | Decoded URL doesn't start with `http` |
| `400`  | `{ "error": "Failed to decode URL" }`                    | Base64 param is malformed             |
| `502`  | `{ "error": "Failed to fetch image", "details": "..." }` | Moodle returned an error or timed out |

---

## Error Handling

All data routes share a consistent error format:

```json
{ "error": "Human-readable error message" }
```

| Status | Meaning           | Notes                                                        |
| ------ | ----------------- | ------------------------------------------------------------ |
| `400`  | Bad request       | Invalid or malformed parameter                               |
| `401`  | Session expired   | Session file deleted automatically. Call `POST /login` again |
| `404`  | Session not found | The `sessionId` has no matching file in `./sessions/`        |
| `500`  | Server error      | Unexpected error or Moodle exception                         |
| `502`  | Upstream error    | Image fetch from Moodle failed                               |

---

## Session Lifecycle

```
POST /login
    └─→ Playwright logs in → saves cookies to ./sessions/<uuid>.json
              └─→ Returns sessionId

GET /courses/:sessionId  ──┐
GET /course/:id/:sessionId  ├─→ Reads cookies from ./sessions/<uuid>.json
GET /mod/:type/:id/:sessionId ─┘

Session expires on Moodle (typically after inactivity)
    └─→ API detects redirect to /login/index.php
          └─→ Deletes session file → returns 401
                └─→ Client must call POST /login again
```

---

## Local Setup

```bash
# Install dependencies
npm install

# Install Playwright browser (first time only)
npx playwright install chromium

# Start the server
node index.js
# → Server running on http://localhost:3000
```
