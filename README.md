# Miva LMS Scraper API

A hybrid scraper for the Miva University LMS (Moodle). It utilizes **Playwright** for robust authentication (handling complex logins and session generation) and **Axios/Cheerio** for lightning-fast data extraction across all other modules.

## Architecture

- **Heavy Path (Login)**: Uses a headless Chromium browser to handle authentication, redirects, and session state persistence.
- **Light Path (Data)**: Uses direct HTTP requests and HTML parsing for maximum speed (up to 20x faster than browser-based scraping).

---

## API Documentation

The server runs on `http://localhost:3000` by default.

### 1. Login

**Endpoint**: `POST /login`  
**Description**: Authenticates with the LMS and generates a reusable `sessionId`.

- **Request Body**:
  ```json
  {
    "username": "your_email@miva.university",
    "password": "your_password"
  }
  ```
- **Success Response (200)**:
  ```json
  {
    "sessionId": "5c0a3d18-004f-4279-8523-0c682339637d"
  }
  ```

### 2. Get Courses

**Endpoint**: `GET /courses/:sessionId`  
**Description**: Fetches the list of enrolled courses with metadata via the Moodle AJAX service.

- **Success Response (200)**:
  ```json
  {
    "courses": [
      {
        "id": 673,
        "fullname": "MIVA-SEN 403 - Software Reverse Engineering",
        "shortname": "MIVA-SEN 403",
        "summary": "<p>Course Description...</p>",
        "activitydata": "4 out of 84 activities completed",
        "viewurl": "https://lms.miva.university/course/view.php?id=673",
        "courseimage": "https://lms.miva.university/pluginfile.php/..."
      }
    ]
  }
  ```

### 3. Get Course Details

**Endpoint**: `GET /course/:id/:sessionId`  
**Description**: Fetches the internal structure of a specific course, including sections and modules (quizzes, pages, URLs).

- **Success Response (200)**:
  ```json
  {
    "id": "673",
    "title": "Software Reverse Engineering",
    "category": "Software Engineering",
    "backgroundImage": "https://...",
    "description": "Course introduction text...",
    "instructors": ["Dr. Jane Doe"],
    "progress": "4%",
    "sections": [
      {
        "id": "1234",
        "name": "Week 1: Introduction",
        "modules": [
          {
            "id": "5678",
            "type": "page",
            "name": "Introduction Slides",
            "url": "https://...",
            "isCompleted": true
          }
        ]
      }
    ]
  }
  ```

### 4. Get Module Content

**Endpoint**: `GET /mod/:type/:id/:sessionId`  
**Description**: Fetches specific content for a module type (e.g., `page`, `quiz`, `url`).

- **Path Parameters**:
  - `type`: `page`, `quiz`, `url`, `assign`, `forum`, `feedback`.
- **Success Response (200 - Page Example)**:
  ```json
  {
    "id": "5678",
    "title": "Introduction Slides",
    "type": "page",
    "iframes": [
      { "src": "https://player.vimeo.com/...", "title": "Video Lecture" }
    ],
    "contentHtml": "<div>Full page HTML content...</div>",
    "navigation": {
      "prev": { "type": "quiz", "id": "5677" },
      "next": { "type": "url", "id": "5679" }
    }
  }
  ```

---

## Error Handling

| Status Code | Description         | Action                                                                                                  |
| :---------- | :------------------ | :------------------------------------------------------------------------------------------------------ |
| **401**     | **Session Expired** | The session file has been automatically deleted. You must call `/login` again to get a new `sessionId`. |
| **404**     | **Not Found**       | The session ID provided does not exist in the `sessions/` directory.                                    |
| **500**     | **Server Error**    | An unexpected error occurred or Moodle returned an internal exception.                                  |

## Storage

Active sessions are stored in the `./sessions` directory as JSON files. These files contain the cookies and auth state required for the "Lightweight" routes to function.
