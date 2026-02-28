const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// Helper to extract course data from the page
async function getCourses(page) {
  // Wait specifically for course cards rendered by AJAX
  await page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 30000 });

  return await page.evaluate(() => {
    const courseElements = document.querySelectorAll('div[data-course-id][data-region="course-content"]');
    const results = [];
    courseElements.forEach(el => {
      const id = el.getAttribute('data-course-id');
      const link = el.querySelector('a.coursename');
      const name = link?.querySelector('span.multiline')?.textContent?.trim();
      const url = link?.href?.trim();

      const imgDiv = el.querySelector('div.card-img.dashboard-card-img');
      let image = null;
      if (imgDiv) {
        const bg = imgDiv.style.backgroundImage;
        const match = bg.match(/url\(["']?(.*?)["']?\)/);
        if (match) image = match[1];
      }

      if (id && name && url) {
        results.push({ id, name, url, image });
      }
    });
    return results;
  });
}


const app = express();
app.use(express.json());

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  });
})();

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto('https://lms.miva.university', { waitUntil: 'domcontentloaded' });
    
    // Check if we are already logged in (unlikely in new context, but safe)
    if (!page.url().includes('/my/')) {
      await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await page.fill('input[name="email"]', username);
      await page.fill('input[name="password"]', password);

      // Perform login click
      await page.click('button:has-text("Login")');

      // Wait for either the dashboard to load OR an error message to appear
      await Promise.race([
        page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 45000 }),
        page.waitForSelector('text=Incorrect email or password', { timeout: 15000 }).then(() => {
          throw new Error('Incorrect email or password');
        })
      ]).catch(e => {
          if (e.message.includes('timeout')) return;
          throw e;
      });
    }

    const courses = await getCourses(page);
    
    // Generate session ID and save storage state
    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    await context.storageState({ path: sessionPath });

    await context.close();
    res.json({ sessionId, courses });

  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get('/courses/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  try {
    const context = await browser.newContext({ storageState: sessionPath });
    const page = await context.newPage();

    // Route to block non-essential resources
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Go directly to dashboard
    await page.goto('https://lms.miva.university/my/courses.php', { waitUntil: 'domcontentloaded' });

    // Check if session is still valid
    if (page.url().includes('login/index.php') || page.url().includes('cas/login')) {
      await context.close();
      fs.unlinkSync(sessionPath); // Clean up expired session
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    const courses = await getCourses(page);
    
    // Update the session state (optional but good for long-lived sessions)
    await context.storageState({ path: sessionPath });

    await context.close();
    res.json({ courses });

  } catch (error) {
    console.error('Failed to get courses from session:', error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(3000, () => console.log('Server running'));