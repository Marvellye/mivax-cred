---
name: mivax-clawd
description: Access MivaX API for student information and LMS.
metadata: { "openclaw": { "emoji": "🔍︎" } }
---

# Skill: MivaX API Integration

## 1. Overview

The MivaX API is a unified interface for interacting with a university's Student Information System (SIS) and Learning Management System (LMS). This skill enables the AI agent to authenticate a student, retrieve academic records (grades, transcripts, registration), access financial records, and fetch LMS course materials.

**Base URL:** `https://mivax.marvelly.com.ng`

## 2. Authentication Mechanism & State Management (CRITICAL INSTRUCTION)

Unlike standard APIs that use `Authorization: Bearer <token>` headers, the MivaX API uses **Path-Based Session Authentication**. The `sessionId` is highly persistent and should be reused across multiple requests.

**State Management & Login Flow:**

1. **Check Memory:** Before asking the user, check your memory/tool state for an existing `sessionId` or saved `email` and `password`.
2. **Login:** If no active `sessionId` exists, call `POST /login` using the user's credentials. (Prompt the user for them only if they are not stored in memory).
3. **Persist State:** Once a successful response yields a `sessionId`, you MUST save the `sessionId` AND the user's `email`/`password` in your memory/context for future use.
4. **Usage:** Append the `sessionId` as a **path parameter** to the end of almost every subsequent API request (e.g., `/user/{sessionId}`).
5. **Silent Re-Authentication:** If a request fails with an unauthorized or session expired error, do not immediately ask the user. Instead, use the saved `email` and `password` to silently re-run the `POST /login` flow, update the `sessionId` in memory, and retry the failed request.

---

## 3. Available Endpoints & Data Schemas

### Group A: Authentication

| Action    | Method | Endpoint | Description                                 |
| :-------- | :----- | :------- | :------------------------------------------ |
| **Login** | `POST` | `/login` | Exchanges LMS credentials for a Session ID. |

- **Body (JSON):**
  ```json
  {
    "email": "student_email@miva.edu.ng",
    "password": "student_password"
  }
  ```

---

### Group B: Student Information System (SIS)

_Requires `{sessionId}` in the path._

#### 1. User Profile

- **Endpoint:** `GET /user/{sessionId}`
- **Response Mapping:** `response.data` contains `contact_information` (email, phone, address), `biography` (name, gender, DOB), `student_id`, `enrollment_status`, and `display_picture`.

#### 2. Academic Summary

- **Endpoint:** `GET /student/academic-summary/{sessionId}`
- **Response Mapping:** Returns overall metrics directly: `overall_cgpa`, `total_grade_points`, `minimum_unit_required`, `degree` (e.g., "First class"), and `course_unit_summary`.

#### 3. Academic Levels

- **Endpoint:** `GET /student/academic-levels/{sessionId}`
- **Response Mapping:** Returns `levels` (array). Each object contains `level` (e.g., "400_LEVEL"), `status` ("PENDING", "enrolled"), `start_date`, `end_date`, and `course_summary` (completed, discontinue, enrolled).

#### 4. Full Transcript

- **Endpoint:** `GET /student/transcript/{sessionId}`
- **Response Mapping:** Returns `{ "levels": [...] }`. Each level has `level`, `total_grade_point`, and an array of `semesters`. Each semester has `name`, `type`, `gpa`, and a `courses` array containing `code`, `name`, `unit`, `score`, `symbol` (grade letter), and `status`.

#### 5. Level Transcript (Specific Level)

- **Endpoint:** `GET /student/transcript/{level}/{sessionId}`
- **Parameters:** `level` (e.g., `200_LEVEL`)
- **Response Mapping:** Returns a single object `{ "level": "...", "total_grade_point": ..., "semesters": [...] }`. _(Note: Not wrapped in a `levels` array like the full transcript)._

#### 6. Current Courses

- **Endpoint:** `GET /student/current-courses/{sessionId}`
- **Response Mapping:** Returns `level`, `semester`, and a `courses` array with `course_name`, `course_code`, `credit_unit`, and `status`.

#### 7. Registration Status

- **Endpoint:** `GET /student/registration-status/{sessionId}`
- **Response Mapping:** Returns `level`, `status`, `enrollment_start`, `enrollment_end`, and `is_pending`.

#### 8. Payment Records

- **Endpoint:** `GET /payment-records/{sessionId}?page=1&perPage=10`
- **Response Mapping:** Returns `response.data.paid` (array) and `response.data.owed_records`. Paid objects contain `amount`, `currency`, `date_paid`, `description`, `status`, and `payment_method`.

#### 9. Notifications

- **Endpoint:** `GET /notifications/{sessionId}?page=1&perPage=5`
- **Response Mapping:** Returns `response.data.data` (array of notifications). Each contains `title`, `body`, `is_read`, and `created_at`.

---

### Group C: Learning Management System (LMS)

_Requires `{sessionId}` in the path. Drill down from Courses -> Course Content -> Module Detail._

#### 1. List Courses

- **Endpoint:** `GET /courses/{sessionId}`
- **Description:** Retrieves all LMS courses.
- **Response Mapping:** Returns `courses` (array). Important keys: `id` (this is the `courseId`), `fullname`, `shortname`, `summary` (HTML), `activitydata`.

#### 2. Get Course Content

- **Endpoint:** `GET /course/{courseId}/{sessionId}`
- **Description:** Retrieves syllabus, sections, and modules for a specific course.
- **Response Mapping:** Returns course details and a `sections` array. Each section has a `modules` array. Important keys in modules: `id` (this is the `modId`), `type` (this is the `modType`, e.g., "page", "quiz", "url", "forum", "assignment"), and `name`.

#### 3. Get Module Detail

- **Endpoint:** `GET /mod/{modType}/{modId}/{sessionId}`
- **Description:** Fetches actual content of a specific module.
- **Response Mapping:** Returns `title`, `type`, and `contentHtml`. The agent should parse or strip the `contentHtml` to present readable text to the user.

#### 4. Image Proxy

- **Endpoint:** `GET /img/{encodedUrl}/{sessionId}`
- **Description:** Proxies LMS images. The source image URL must be base64 encoded.

---

## 4. Required Variables & Data Types

When formatting requests, the agent should recognize these variable types:

- `sessionId` (String): The active session token retrieved from memory or `/login`. MUST be placed at the end of the URL path.
- `courseId` (String/Integer): Unique identifier for an LMS course (e.g., `"388"`). Retrieved from the `/courses` endpoint.
- `modType` (String): The type of LMS module (e.g., `page`, `quiz`, `url`, `forum`, `assignment`, `feedback`). Retrieved from the `/course/{courseId}` endpoint.
- `modId` (String/Integer): Unique identifier for a specific module within a course (e.g., `"16428"`). Retrieved from the `/course/{courseId}` endpoint.
- `level` (String): Academic level formatting required by the API (e.g., `100_LEVEL`, `200_LEVEL`, `300_LEVEL`).
- `page` / `perPage` (Integer): Used in query strings for pagination (e.g., `?page=1&perPage=5`).
- `encodedUrl` (String): A Base64 encoded string of an image URL.

---

## 5. Agent Execution Workflows (Chains)

**Workflow 1: Fetching Student Grades / Transcript**

1. Check memory for an active `sessionId`. If none, check for saved credentials and call `POST /login`. Only prompt the user if credentials are unknown.
2. Execute `GET /student/transcript/{sessionId}` to get all grades.
3. _Alternative:_ Execute `GET /student/transcript/{level}/{sessionId}` to isolate a specific year's performance.
4. Summarize the GPA, Distinction/Passed courses, and overall units for the user.

**Workflow 2: Studying / Reading Course Materials**

1. Check memory for an active `sessionId` (or silently re-authenticate).
2. Execute `GET /courses/{sessionId}`. Find the target course and extract its `id` (`courseId`).
3. Execute `GET /course/{courseId}/{sessionId}`. Look through the `sections` -> `modules` array. Identify the target material and extract its `id` (`modId`) and `type` (`modType`).
4. Execute `GET /mod/{modType}/{modId}/{sessionId}` to read the module content.
5. Parse the `contentHtml` and return formatted, readable content to the user.

**Workflow 3: Checking Financial/Payment Status**

1. Check memory for an active `sessionId` (or silently re-authenticate).
2. Execute `GET /payment-records/{sessionId}?page=1&perPage=10`.
3. Parse `response.data.paid` to summarize recent successful payments (Amount, Currency, Date, Installment Name).
4. Parse `response.data.owed_records` to inform the user of any outstanding balances.

**Workflow 4: Fetching Academic Standing**

1. Check memory for an active `sessionId` (or silently re-authenticate).
2. Execute `GET /student/academic-summary/{sessionId}`.
3. Present the user's `overall_cgpa`, `total_grade_points`, and `degree` classification (e.g., "First class").

---

## 6. Constraints & Best Practices for AI

- **Session & Credential Persistence:** The `sessionId` is highly persistent. ALWAYS save both the `sessionId` and the user's `email`/`password` in your memory or context state. Reuse the stored `sessionId` for all subsequent requests. If a request fails due to session expiration, use the stored credentials to silently re-authenticate via `POST /login` and update the saved `sessionId`.
- **Path Construction:** NEVER pass the `sessionId` in a header or query parameter. It ALWAYS goes at the end of the URL path.
- **Pagination:** For `/payment-records` and `/notifications`, ALWAYS apply `?page=1&perPage=10` default query parameters to avoid massive payloads, unless the user specifically asks for more history.
- **HTML Parsing:** The LMS endpoints (`/courses` summary, `/mod` contentHtml) return raw HTML. You must strip or convert the HTML into clean Markdown before displaying it to the user.
- **Base64 Encoding:** If the user requests an image from the LMS, ensure you encode the original image URL in base64 before passing it to the `/img/{encodedUrl}/{sessionId}` endpoint.
- **Course IDs vs Module IDs:** Be careful not to confuse `courseId` (found in the root `/courses` array) with `modId` (found inside the `modules` array of a specific course). A `modId` requires both `modType` and `courseId` context to be useful.
- **JSON Structure Awareness:** Note that specific transcript levels (`/transcript/{level}`) return a direct object, while the full transcript (`/transcript`) wraps levels in a `"levels"` array. Adjust your parsing logic accordingly.
